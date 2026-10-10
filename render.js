const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('fflate');
const { plotPolygon, plotLineString, plotPolygonLabel, plotPointLabel, plotLineStringLabel } = require('./plot.js');
const { getTileViewbox, getSubTiles, areaToTiles } = require('./coordinate.js');
const { readChunk, chunkFileName } = require('./chunk-format.js');
const style = require('./style.json');
const mml = require('./mml.json');
const M = require('./match-rule.js');
const I = require('./infer-layer.js');
const { paintToSvg } = require('./paint-to-svg.js');
const { assembleAreas } = require('./assemble.js');
const config = require('./config.json');
const { rasterize } = require('./rasterize.js');
const { makeDirectory } = require('./files.js');
const { paintToLabels } = require('./paint-to-label.js');
const { createLabelsStyleTables, registerLabelsStyle } = require('./label-styles.js');
const { registerChars, dumpCharsets } = require('./label-charset.js');
const { paintToVector } = require('./paint-to-vector.js');
const { createVectorStyleTables, registerVectorStyle } = require('./vector-styles.js');
const { deltaEncode } = require('./delta.js');

M.loadStyle('./style.json');
I.loadMml('./mml.json');

// Paint order: Mapnik/CartoCSS draw order is defined by the `Layer:` order in
// project.mml, NOT by the order of rules in the concatenated .mss (that only
// controls the within-layer cascade). mml.json preserves the project.mml layer
// order, so map each layer id to its index there. This is the authoritative
// stacking order and is independent of how the .mss files were concatenated.
const layerOrder = new Map();
mml.forEach((layer, i) => {
  const id = layer && (layer.id || layer.name);
  if (id != null && !layerOrder.has(id)) layerOrder.set(id, i);
});
const orderOf = (layerId) => (layerOrder.has(layerId) ? layerOrder.get(layerId) : Infinity);

// Group matched rule indices by attachment, preserving first-appearance order
// (ascending index == stylesheet source order). Each group also reports the
// rule index that resolved it, so the caller can order passes by rule before
// attachment. Paint cascades (last-wins)
// ONLY within an attachment; each attachment (::casing, ::fill, ...) becomes a
// separate symbolizer/stroke and must never overwrite another. Rules from a
// different layer are never in `idxs` because matchRules is layer-scoped, so
// other layers can't take precedence either.
function cascadeByAttachment(indices, style) {
  const byAttachment = new Map();
  const order = [];
  for (const index of indices) {
    const attachment = style[index].attachment || '';
    if (!byAttachment.has(attachment)) {
      byAttachment.set(attachment, { paint: {}, rule: index });
      order.push(attachment);
    }
    const group = byAttachment.get(attachment);
    const paint = style[index].paint;
    for (const key in paint) {
      group.paint[key] = paint[key];
    }
    // `indices` is ascending source order, so the highest contributor is the
    // rule that resolved this attachment. Mapnik would have emitted a
    // symbolizer at that rule's position, so that is where this pass draws.
    if (index > group.rule) group.rule = index;
  }
  return order.map((attachment) => byAttachment.get(attachment));
}

const chunksDir = config.chunks.dir;

const tilesDir = config.tiles.dir;
const tileSize = config.tiles.size;
const tilePrecision = config.tiles.precision;
const labelQuantization = config.tiles.labelQuantization;
const extent = config.tiles.extent;
const buffer = config.tiles.buffer;
const tileBackground = config.tiles.background;
const tilesMinZ = Math.min(config.tiles.z.raster.min, config.tiles.z.vector.min);
const tilesMaxZ = Math.max(config.tiles.z.raster.max, config.tiles.z.vector.max);
const safeMargin = 64;

const gzipOptions = { level: 7 };
const encoder = new TextEncoder();

const backgroundElement = `<rect x="0" y="0" width="${tileSize}" height="${tileSize}" fill="${tileBackground}"/>`;

// Overlay label/marker output. Text and point symbols are intentionally NOT
// rasterized (see paint-to-svg.js); instead we collect the features a MapLibre
// `symbol` layer *should* render and emit one GeoJSON FeatureCollection per
// tile, mirroring the raster pyramid at labels/z/x/y.gz. Coordinates are
// WGS84 lon/lat, as required by the GeoJSON spec.
const labelsDir = (config.labels && config.labels.dir) || path.join(tilesDir, '..', 'labels');

// Load one cached base chunk (written by chunk.js, format: chunk.proto).
// Coordinates are already projected to Web Mercator metres, so nothing is
// re-projected here. Returns null when the chunk file does not exist.
function parseChunk(cX, cY, cZ) {
  return readChunk(path.join(chunksDir, chunkFileName(cZ, cX, cY)));
}

async function renderChunk(cX, cY, cZ) {
  const center = parseChunk(cX, cY, cZ);
  if (!center) return false;
  const { nodeMap, ways, relations } = center;

  const wayMap = new Map();
  for (let i = ways.length - 1; i >= 0; i--) {
    wayMap.set(ways[i].id, i);
  }

  // Assemble multipolygon relations (wide rivers, lakes, landuse, ...) into filled area geometry. Their tags live on the relation and their member ways are usually untagged, so the per-way loop below never draws them.
  const { features: areaFeatures, memberWayIds } = assembleAreas(relations, ways, wayMap, nodeMap);

  // reconstruct geometry
  const subTiles = getSubTiles(cX, cY, cZ, tilesMaxZ);
  const total = subTiles.length;
  let count = 0;
  for (const [tX, tY, tZ] of subTiles) {
    if (tZ < tilesMinZ) continue;
    count++;
    const [x0, y0, x1, y1] = getTileViewbox(tX, tY, tZ);

    // conditional rendering
    const shouldRenderRaster = config.tiles.z.raster.min <= tZ && tZ <= config.tiles.z.raster.max;
    const shouldRenderVector = config.tiles.z.vector.min <= tZ && tZ <= config.tiles.z.vector.max;
    const shouldRenderLabels = config.tiles.z.labels.min <= tZ && tZ <= config.tiles.z.labels.max;

    if (!shouldRenderRaster && !shouldRenderVector && !shouldRenderLabels) continue;

    // raster
    const polygons = []; // { base, rule, index, svg } collected across ways + relations
    const lines = []; // { base, rule, index, svg }

    // vector
    const vectorPolygons = []; // { base, rule, index, descriptors }
    const vectorLines = []; // { base, rule, index, descriptors }
    const vectorCircles = []; // { base, rule, index, descriptors }
    const vectorStyleTables = createVectorStyleTables();

    // labels
    const labels = []; // features for the text/marker overlay
    const labelsStyleTables = createLabelsStyleTables();
    const charsets = new Map();

    for (const way of ways) {
      if (memberWayIds.has(way.id)) continue; // drawn via its parent multipolygon
      const coords = way.refs.map((id) => nodeMap.get(id)).filter(Boolean);
      // A closed ring is only an *area* when its tags say so (osm2pgsql /
      // openstreetmap-carto.lua `isarea`). Closed highways, barriers, etc.
      // without area=yes stay linestrings, so they reach the road layers.
      const closed = way.refs.length >= 4 && way.refs[0] === way.refs.at(-1) && coords.length >= 4 && I.isArea(way.tags);
      const shape = closed
        ? { type: 'Polygon', coordinates: [coords] } // ring/area
        : { type: 'LineString', coordinates: coords };

      const geometry = closed ? 'polygon' : 'linestring';
      const d = closed ? plotPolygon(shape, x0, y0, x1, y1, tileSize, tilePrecision, safeMargin) : plotLineString(shape, x0, y0, x1, y1, tileSize, tilePrecision, safeMargin);
      if (!d) continue;

      const layers = I.inferLayers(way.tags, { geometry, zoom: tZ });

      for (const layer of layers) {
        const feat = { ...way.tags, ...layer.row }; // inject `feature` + computed cols
        const idxs = M.matchRules(feat, layer.id, tZ);
        if (idxs.length === 0) continue;

        const passes = cascadeByAttachment(idxs, style);
        const passesLength = passes.length;
        const base = orderOf(layer.id);
        for (let index = 0; index < passesLength; index++) {
          const { paint, rule } = passes[index];

          // raster
          if (shouldRenderRaster) {
            const svg = paintToSvg(paint, d, geometry, tileSize / 256);
            if (svg) {
              if (closed) {
                polygons.push({ base, rule, index, svg });
                // base = layer order, rule = stylesheet rule order, index = attachment
              } else {
                lines.push({ base, rule, index, svg });
              }
            }
          }

          // vector
          if (shouldRenderVector) {
            const { polygonDescriptors, lineDescriptors } = paintToVector(paint, shape, x0, y0, x1, y1, extent, buffer);
            if (polygonDescriptors.length > 0) vectorPolygons.push({ base, rule, index, descriptors: polygonDescriptors });
            if (lineDescriptors.length > 0) vectorLines.push({ base, rule, index, descriptors: lineDescriptors });
          }

          // labels
          if (shouldRenderLabels) {
            const descs = paintToLabels(paint, feat);
            if (descs) {
              for (const desc of descs) {
                // descriptor
                const textSize = desc.styleProperties['text-size'];
                if (!textSize) continue;
                const textScale = Array.isArray(desc.styleProperties['text-scale']) ? desc.styleProperties['text-scale'][0] : desc.styleProperties['text-scale'] || 1; // resolve the placement at discrete zoom level (tZ)
                const labelGeometry = closed ? plotPolygonLabel(shape, x0, y0, x1, y1, labelQuantization) : plotLineStringLabel(shape, x0, y0, x1, y1, desc.properties.label, textSize, textScale, tileSize, labelQuantization);
                if (!labelGeometry) continue;
                const styleReference = registerLabelsStyle(labelsStyleTables, desc);
                if (desc.properties.label) registerChars(charsets, desc.properties.label, desc.properties.kind, styleReference);
                labels.push({
                  base,
                  rule,
                  label: {
                    type: 'Feature',
                    id: `w${way.id}`,
                    geometry: labelGeometry,
                    properties: { ...desc.properties, style: styleReference }
                  }
                });
              }
            }
          }
        }
      }
    }

    // Multipolygon area features assembled from relations (drawn as fills, beneath the line elements).
    for (const feat of areaFeatures) {
      let d = '';
      for (const poly of feat.polygons) {
        d += plotPolygon({ type: 'Polygon', coordinates: poly }, x0, y0, x1, y1, tileSize, tilePrecision, safeMargin);
      }
      if (!d) continue;

      const layers = I.inferLayers(feat.tags, { geometry: 'polygon', zoom: tZ });
      for (const layer of layers) {
        const featRow = { ...feat.tags, ...layer.row };
        const idxs = M.matchRules(featRow, layer.id, tZ);
        if (idxs.length === 0) continue;

        const passes = cascadeByAttachment(idxs, style);
        const passesLength = passes.length;
        const base = orderOf(layer.id);
        for (let index = 0; index < passesLength; index++) {
          const { paint, rule } = passes[index];

          // raster
          if (shouldRenderRaster) {
            const svg = paintToSvg(paint, d, 'polygon', tileSize / 256);
            if (svg) polygons.push({ base, rule, index, svg });
          }

          // vector
          if (shouldRenderVector) {
            for (const poly of feat.polygons) {
              // The actual geometry depends on clipping and styling.
              // For example, after clipping, the stroke of a cross-tile polygon becomes an open line.
              const { polygonDescriptors, lineDescriptors } = paintToVector(paint, { type: 'Polygon', coordinates: poly }, x0, y0, x1, y1, extent, buffer);
              if (polygonDescriptors.length > 0) vectorPolygons.push({ base, rule, index, descriptors: polygonDescriptors });
              if (lineDescriptors.length > 0) vectorLines.push({ base, rule, index, descriptors: lineDescriptors });
            }
          }

          // labels
          if (shouldRenderLabels) {
            if (feat.polygons[0]) {
              const descs = paintToLabels(paint, featRow);
              if (descs) {
                const labelGeometry = plotPolygonLabel({ type: 'Polygon', coordinates: feat.polygons[0] }, x0, y0, x1, y1, labelQuantization);
                if (labelGeometry) {
                  for (const desc of descs) {
                    const styleReference = registerLabelsStyle(labelsStyleTables, desc);
                    if (desc.properties.label) registerChars(charsets, desc.properties.label, desc.properties.kind, styleReference);
                    labels.push({
                      base,
                      rule,
                      label: {
                        type: 'Feature',
                        id: `r${layer.id}:${labelGeometry.coordinates[0]}:${labelGeometry.coordinates[1]}`,
                        geometry: labelGeometry,
                        properties: { ...desc.properties, style: styleReference }
                      }
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    // Point features (POIs / place names / stations) live on tagged nodes,
    // which are never drawn as background geometry. Emit each only for the tile
    // whose bbox contains it, so a point lands in exactly one tile.

    for (const node of center.nodes) {
      if (node.lon < x0 || node.lon > x1 || node.lat < y0 || node.lat > y1) continue;
      const layers = I.inferLayers(node.tags, { geometry: 'point', zoom: tZ });

      for (const layer of layers) {
        const feat = { ...node.tags, ...layer.row };
        const idxs = M.matchRules(feat, layer.id, tZ);
        if (idxs.length === 0) continue;

        const passes = cascadeByAttachment(idxs, style);
        const passesLength = passes.length;
        const base = orderOf(layer.id);

        for (let index = 0; index < passesLength; index++) {
          const { paint, rule } = passes[index];

          // vector
          if (shouldRenderVector) {
            const shape = { type: 'Point', coordinates: [node.lon, node.lat] };
            const { circleDescriptors } = paintToVector(paint, shape, x0, y0, x1, y1, extent, buffer);
            if (circleDescriptors.length > 0) vectorCircles.push({ base, rule, index, descriptors: circleDescriptors });
          }

          // labels
          if (shouldRenderLabels) {
            const descs = paintToLabels(paint, feat);
            if (descs) {
              const labelGeometry = plotPointLabel([node.lon, node.lat], x0, y0, x1, y1, labelQuantization);
              if (labelGeometry) {
                for (const desc of descs) {
                  const styleReference = registerLabelsStyle(labelsStyleTables, desc);
                  if (desc.properties.label) registerChars(charsets, desc.properties.label, desc.properties.kind, styleReference);
                  labels.push({
                    base,
                    rule,
                    label: {
                      type: 'Feature',
                      id: `n${node.id}`,
                      geometry: labelGeometry,
                      properties: { ...desc.properties, style: styleReference }
                    }
                  });
                }
              }
            }
          }
        }
      }
    }

    // Emit in OSM Carto paint order: layer (project.mml) first, then the order
    // of the rules inside that layer, then the attachment. Collapsing a
    // feature's rules into one paint per attachment must not collapse their
    // position: two features in the same layer and attachment are separated
    // only by which rule matched them, so `rule` has to outrank `index`.
    // Stable sort keeps intra-rule feature order. Fills first, then lines.
    polygons.sort(function (a, b) {
      return a.base - b.base || a.rule - b.rule || a.index - b.index;
    });
    lines.sort(function (a, b) {
      return a.base - b.base || a.rule - b.rule || a.index - b.index;
    });
    labels.sort(function (a, b) {
      return a.base - b.base || a.rule - b.rule;
    });
    vectorPolygons.sort(function (a, b) {
      return a.base - b.base || a.rule - b.rule || a.index - b.index;
    });
    vectorLines.sort(function (a, b) {
      return a.base - b.base || a.rule - b.rule || a.index - b.index;
    });
    vectorCircles.sort(function (a, b) {
      return a.base - b.base || a.rule - b.rule || a.index - b.index;
    });

    // create directories
    await makeDirectory(path.join(tilesDir, tZ.toString(), tX.toString()));
    await makeDirectory(path.join(labelsDir, tZ.toString(), tX.toString()));

    // raster tiles
    if (shouldRenderRaster && polygons.length + lines.length > 0) {
      const polygonElements = polygons.map((f) => f.svg).join('');
      const lineElements = lines.map((l) => l.svg).join('');
      const svg = `<svg width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}" xmlns="http://www.w3.org/2000/svg">${backgroundElement}${polygonElements}${lineElements}</svg>`;
      await rasterize(svg, path.join(tilesDir, tZ.toString(), tX.toString(), tY.toString()));
    }

    // vector tiles
    if (shouldRenderVector && vectorPolygons.length + vectorLines.length + vectorCircles.length > 0) {
      // Flat parallel arrays instead of nested [[[x, y], ...], ...] descriptors,
      // so the client can adopt each one with a single typed-array constructor
      // (`new Int16Array(parsed.coordinates)`) and never allocate per point.
      // Nesting is carried by three levels of offsets:
      //   style run -> descriptor -> part (ring / line) -> point
      const vectorCoordinates = []; // interleaved x, y; Int16-safe: [-buffer, extent + buffer]
      const vectorPartStartIndices = [0]; // point offset of each part
      const vectorDescriptorStartIndices = [0]; // part offset of each descriptor
      const vectorDescriptorTypes = []; // 0 = polygon, 1 = line
      const vectorStyleReferences = [];
      const vectorStyleStartIndices = []; // descriptor offset of each style run

      let previousStyleReference = -1;

      // Append one descriptor's geometry and open a new style run when the style changes.
      const pushVectorDescriptor = (typeCode, geometry, styleReference) => {
        for (let p = 0, parts = geometry.length; p < parts; p++) {
          const part = geometry[p];
          for (let k = 0, points = part.length; k < points; k++) {
            vectorCoordinates.push(part[k][0], part[k][1]);
          }
          vectorPartStartIndices.push(vectorCoordinates.length / 2);
        }
        vectorDescriptorTypes.push(typeCode);
        vectorDescriptorStartIndices.push(vectorPartStartIndices.length - 1);
        if (styleReference !== previousStyleReference) {
          vectorStyleReferences.push(styleReference);
          vectorStyleStartIndices.push(vectorDescriptorTypes.length - 1);
          previousStyleReference = styleReference;
        }
      };

      const vectorPolygonsLength = vectorPolygons.length;
      const vectorLinesLength = vectorLines.length;
      const vectorCirclesLength = vectorCircles.length;
      for (let i = 0; i < vectorPolygonsLength; i++) {
        for (let j = 0, m = vectorPolygons[i].descriptors.length; j < m; j++) {
          const descriptor = vectorPolygons[i].descriptors[j];
          pushVectorDescriptor(0, descriptor.geometry, registerVectorStyle(vectorStyleTables, descriptor));
        }
      }
      for (let i = 0; i < vectorLinesLength; i++) {
        for (let j = 0, m = vectorLines[i].descriptors.length; j < m; j++) {
          const descriptor = vectorLines[i].descriptors[j];
          pushVectorDescriptor(1, descriptor.geometry, registerVectorStyle(vectorStyleTables, descriptor));
        }
      }
      for (let i = 0; i < vectorCirclesLength; i++) {
        for (let j = 0, m = vectorCircles[i].descriptors.length; j < m; j++) {
          const descriptor = vectorCircles[i].descriptors[j];
          pushVectorDescriptor(2, descriptor.geometry, registerVectorStyle(vectorStyleTables, descriptor));
        }
      }
      vectorStyleStartIndices.push(vectorDescriptorTypes.length);

      fs.writeFileSync(
        path.join(tilesDir, tZ.toString(), tX.toString(), `${tY}.gz`),
        Buffer.from(
          gzipSync(
            encoder.encode(
              JSON.stringify({
                type: 'Vector',
                extent,
                buffer,
                zoom: tZ,
                coordinates: deltaEncode(vectorCoordinates, 2),
                partStartIndices: deltaEncode(vectorPartStartIndices, 1),
                descriptorStartIndices: deltaEncode(vectorDescriptorStartIndices, 1),
                descriptorTypes: vectorDescriptorTypes,
                styleReferences: deltaEncode(vectorStyleReferences, 1),
                styleStartIndices: deltaEncode(vectorStyleStartIndices, 1),
                styles: vectorStyleTables.styles,
                palette: vectorStyleTables.palette0.concat(vectorStyleTables.palette1)
              })
            ),
            gzipOptions
          )
        )
      );
    }

    // labels
    if (shouldRenderLabels && labels.length > 0) {
      fs.writeFileSync(
        path.join(labelsDir, tZ.toString(), tX.toString(), `${tY}.gz`),
        Buffer.from(
          gzipSync(
            encoder.encode(
              JSON.stringify({
                type: 'FeatureCollection',
                extent: labelQuantization,
                zoom: tZ,
                features: labels.map((l) => l.label),
                textStyles: labelsStyleTables.textStyles,
                iconStyles: labelsStyleTables.iconStyles,
                circleStyles: labelsStyleTables.circleStyles,
                charsets: dumpCharsets(charsets)
              })
            ),
            gzipOptions
          )
        )
      );
    }

    if (count % 16 === 0 || count === total) console.log(`[${cX} ${cY} ${cZ}] ${Math.round((count / total) * 100)}%`);
  }
  return true;
}

function splitByLength(array, length = 3) {
  const groups = [];
  const quantity = Math.ceil(array.length / length);
  for (let i = 0; i < quantity; i++) {
    groups.push(array.slice(i * length, i * length + length));
  }
  return groups;
}

async function main() {
  const west = config.bbox.west;
  const south = config.bbox.south;
  const east = config.bbox.east;
  const north = config.bbox.north;
  const baseZ = config.chunks.baseZ;
  const chunkTiles = areaToTiles(west, south, east, north, baseZ);
  const groups = splitByLength(chunkTiles, 4);
  for (const group of groups) {
    try {
      const groupResults = await Promise.allSettled(group.map((tile) => renderChunk(tile[0], tile[1], baseZ)));
      console.log(groupResults);
    } catch (err) {
      console.log(baseZ, err);
    }
  }
}

main();
