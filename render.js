const protobuf = require('protobufjs');
const fs = require('node:fs');
const path = require('node:path');
const { decompressSync, gzipSync } = require('fflate');
const { plotPolygon, plotLineString, plotPolygonLabel, plotPointLabel, plotLineStringLabel } = require('./plot.js');
const { getTileViewbox, getSubTiles, areaToTiles, getParentTile, tileToBoundingbox, getCentroid, projectLatitude, projectLongitude } = require('./coordinate.js');
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
const { createStyleTables, internStyle, resolveStyle, finalize } = require('./label-styles.js');

const toObjectOptions = {
  enums: String, // enums as string names
  longs: Number, // longs as strings (requires long.js)
  bytes: String, // bytes as base64 encoded strings
  defaults: true, // includes default values
  arrays: true, // populates empty arrays (repeated fields) even if defaults=false
  objects: true, // populates empty objects (map fields) even if defaults=false
  oneofs: true
};

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
// (ascending index == stylesheet source order). Paint cascades (last-wins)
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
      byAttachment.set(attachment, {});
      order.push(attachment);
    }
    const attachmentPaint = byAttachment.get(attachment);
    const paint = style[index].paint;
    for (const key in paint) {
      attachmentPaint[key] = paint[key];
    }
  }
  return order.map((attachment) => byAttachment.get(attachment));
}

const chunksDir = config.chunks.dir;

const tilesDir = config.tiles.dir;
const tileSize = config.tiles.size;
const tilePrecision = config.tiles.precision;
const labelQuantization = config.tiles.labelQuantization;
const tileBackground = config.tiles.background;
const tilesMaxZ = config.tiles.z.max;
const safeMargin = 64;

const backgroundElement = `<rect x="0" y="0" width="${tileSize}" height="${tileSize}" fill="${tileBackground}"/>`;
const encoder = new TextEncoder();

// Overlay label/marker output. Text and point symbols are intentionally NOT
// rasterized (see paint-to-svg.js); instead we collect the features a MapLibre
// `symbol` layer *should* render and emit one GeoJSON FeatureCollection per
// tile, mirroring the raster pyramid at labels/z/x/y.gz. Coordinates are
// WGS84 lon/lat, as required by the GeoJSON spec.
const labelsDir = (config.labels && config.labels.dir) || path.join(tilesDir, '..', 'labels');

async function loadFileformat() {
  const root = await protobuf.load('./fileformat.proto');
  const BlobHeaderType = root.lookupType('OSMPBF.BlobHeader');
  const BlobType = root.lookupType('OSMPBF.Blob');
  const HeaderBlock = root.lookupType('OSMPBF.HeaderBlock');
  const PrimitiveBlock = root.lookupType('OSMPBF.PrimitiveBlock');
  const Node = root.lookupType('OSMPBF.Node');
  const Way = root.lookupType('OSMPBF.Way');
  const Relation = root.lookupType('OSMPBF.Relation');
  return { BlobHeaderType, BlobType, HeaderBlock, PrimitiveBlock, Node, Way, Relation };
}
// Parse one chunk's .osm.pbf into { nodeMap, ways, relations }.
// Returns null when the chunk file does not exist.
async function parseChunk(cX, cY, cZ, fileformat) {
  const key = `${cZ}_${cX}_${cY}`;
  const file = path.join(chunksDir, `${cZ}_${cX}_${cY}.osm.pbf`);
  if (!fs.existsSync(file)) return null;

  const buf = fs.readFileSync(file);
  const view = new DataView(buf.buffer);

  const { BlobHeaderType, BlobType, HeaderBlock, PrimitiveBlock, Node, Way, Relation } = fileformat;

  const nodeMap = new Map();
  let nodes = [];
  let ways = [];
  let relations = [];
  let offset = 0;

  while (offset < buf.length) {
    // Read header length
    if (offset + 4 > buf.length) break;
    const headerLength = view.getInt32(offset, false);
    offset += 4;

    if (offset + headerLength > buf.length) break;

    // Decode BlobHeader
    const blobHeaderBuffer = buf.subarray(offset, offset + headerLength);
    const blobHeader = BlobHeaderType.decode(blobHeaderBuffer);
    offset += headerLength;

    // Decode Blob
    const blobSize = blobHeader.datasize;
    if (offset + blobSize > buf.length) break;

    const blobBuffer = buf.subarray(offset, offset + blobSize);
    const blob = BlobType.decode(blobBuffer);
    offset += blobSize;

    // Inflate
    let data;
    try {
      if (blob.zlibData) {
        data = decompressSync(blob.zlibData);
      } else if (blob.raw) {
        data = blob.raw; // rare, but legal
      } else {
        continue;
      }
    } catch (e) {
      console.error('inflate failed:', e);
      continue;
    }

    // Interpret block type
    switch (blobHeader.type) {
      case 'OSMHeader': {
        const header = HeaderBlock.decode(data);
        console.log('HEADER BLOCK:', header);
        break;
      }
      case 'OSMData': {
        const block = PrimitiveBlock.decode(data);

        const gran = block.granularity ?? 100;
        const latOff = Number(block.lat_offset ?? 0);
        const lonOff = Number(block.lon_offset ?? 0);
        const dateGran = block.date_granularity ?? 1000;

        // stringtable.s are bytes -> decode to UTF-8 strings
        const st = block.stringtable.s.map((b) => Buffer.from(b).toString('utf8'));

        const toDeg = (v, off) => (off + gran * Number(v)) / 1e9;
        const tags = (keys, vals) => Object.fromEntries(keys.map((k, i) => [st[k], st[vals[i]]]));

        for (const group of block.primitivegroup) {
          // --- regular Nodes ---
          for (const n of group.nodes) {
            const id = Number(n.id);
            const longitude = projectLongitude(toDeg(n.lon, lonOff));
            const latitude = projectLatitude(toDeg(n.lat, latOff));
            const t = tags(n.keys, n.vals);
            if (Object.keys(t).length > 0) {
              nodes.push({
                id: id,
                lon: longitude,
                lat: latitude,
                tags: t
              });
            }
            nodeMap.set(id, [longitude, latitude]);
          }

          // --- DenseNodes (this is where nodes usually are!) ---
          if (group.dense) {
            const d = group.dense;
            let id = 0,
              lat = 0,
              lon = 0,
              kv = 0;
            for (let i = 0; i < d.id.length; i++) {
              id += Number(d.id[i]); // delta decode
              lat += Number(d.lat[i]);
              lon += Number(d.lon[i]);
              const t = {};

              // keysVals: (<keyId> <valId>)* 0  per node
              while (d.keysVals.length && d.keysVals[kv] !== 0) {
                const k = d.keysVals[kv++];
                const v = d.keysVals[kv++];
                t[st[k]] = st[v];
              }
              kv++; // skip the 0 delimiter
              const longitude = projectLongitude(toDeg(lon, lonOff));
              const latitude = projectLatitude(toDeg(lat, latOff));
              if (Object.keys(t).length > 0) {
                nodes.push({
                  id,
                  lon: longitude,
                  lat: latitude,
                  tags: t
                });
              }
              nodeMap.set(id, [longitude, latitude]);
            }
          }

          // --- Ways (refs are delta-coded) ---
          for (const w of group.ways) {
            let ref = 0;
            const refs = w.refs.map((r) => (ref += Number(r)));
            ways.push({
              id: Number(w.id),
              refs,
              tags: tags(w.keys, w.vals)
            });
          }

          // --- Relations (memids delta-coded, roles are string IDs) ---
          for (const r of group.relations) {
            let mid = 0;
            const members = r.memids.map((m, i) => ({
              type: ['node', 'way', 'relation'][r.types[i]],
              ref: (mid += Number(m)),
              role: st[r.rolesSid[i]]
            }));
            relations.push({
              id: Number(r.id),
              members,
              tags: tags(r.keys, r.vals)
            });
          }
        }
        break;
      }
      default: {
        // skip unsupported block
        break;
      }
    }
  }

  const result = { nodeMap, nodes, ways, relations };
  return result;
}

async function renderChunk(cX, cY, cZ, fileformat) {
  const center = await parseChunk(cX, cY, cZ, fileformat);
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
    count++;
    const [x0, y0, x1, y1] = getTileViewbox(tX, tY, tZ);
    const fills = []; // { order, svg } collected across ways + relations
    const lineEls = []; // { order, svg }
    const labels = []; // GeoJSON features for the text/marker overlay
    // Rule-level label style, interned per tile. Everything paintToLabels emits
    // except `kind` and `label` is a verbatim copy of the compiled paint, so it
    // is hoisted here and the feature keeps only an index. `${style}:${label}`
    // is then a complete glyph-cache key.
    const styleTables = createStyleTables();
    const startTime = performance.now();
    for (const way of ways) {
      if (memberWayIds.has(way.id)) continue; // drawn via its parent multipolygon
      const coords = way.refs.map((id) => nodeMap.get(id)).filter(Boolean);
      const closed = way.refs[0] === way.refs.at(-1);
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
          const svg = paintToSvg(passes[index], d, geometry, tileSize / 256);
          if (!svg) continue;
          // preserve attachment order within the layer
          if (closed) {
            fills.push({ base, index, svg }); // index = attachment index
          } else {
            lineEls.push({ base, index, svg });
          }
        }

        // Collect the text/markers this feature should render (placed live by
        // MapLibre, not rasterized). Lines keep their geometry for line
        // placement; closed areas get a representative point.
        const labelPaint = {};
        for (const idx of idxs) Object.assign(labelPaint, style[idx].paint);
        const descs = paintToLabels(labelPaint, feat);
        if (!descs) continue;
        for (const desc of descs) {
          const textScale = Array.isArray(desc.properties['text-scale']) ? desc.properties['text-scale'][0] : desc.properties['text-scale'] || 1; // resolve the placement at discrete scale (tZ)
          const labelGeometry = closed ? plotPolygonLabel(shape, x0, y0, x1, y1, labelQuantization) : plotLineStringLabel(shape, x0, y0, x1, y1, desc.properties.label, desc.properties['text-size'], textScale, tileSize, labelQuantization);
          if (!labelGeometry) continue;
          labels.push({ type: 'Feature', id: `w${way.id}`, geometry: labelGeometry, properties: internStyle(styleTables, desc, layer.id) });
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
          const svg = paintToSvg(passes[index], d, 'polygon', tileSize / 256);
          if (!svg) continue;
          fills.push({ base, index, svg });
        }

        // Area labels (place/landuse/building names): anchor at a
        // representative point, emitted only for the tile that contains it.
        const labelPaint = {};
        for (const idx of idxs) Object.assign(labelPaint, style[idx].paint);
        const descs = paintToLabels(labelPaint, featRow);
        if (!descs) continue;
        if (feat.polygons[0]) {
          const labelGeometry = plotPolygonLabel(feat.polygons[0], x0, y0, x1, y1, labelQuantization);
          for (const desc of descs) {
            labels.push({ type: 'Feature', id: `r${layer.id}:${labelGeometry.coordinates[0]}:${labelGeometry.coordinates[1]}`, geometry: labelGeometry, properties: internStyle(styleTables, desc, layer.id) });
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
        const labelPaint = {};
        for (const idx of idxs) Object.assign(labelPaint, style[idx].paint);
        const descs = paintToLabels(labelPaint, feat);
        if (!descs) continue;
        const labelGeometry = plotPointLabel([node.lon, node.lat], x0, y0, x1, y1, labelQuantization);
        for (const desc of descs) {
          labels.push({ type: 'Feature', id: `n${node.id}`, geometry: labelGeometry, properties: internStyle(styleTables, desc, layer.id) });
        }
      }
    }

    // Emit in OSM Carto layer order (stable sort keeps intra-layer feature
    // order). Fills first, then lines, so casings/labels stay on top.
    fills.sort(function (a, b) {
      if (a.base !== b.base) return a.base - b.base;
      return a.index - b.index;
    });
    lineEls.sort(function (a, b) {
      if (a.base !== b.base) return a.base - b.base;
      return a.index - b.index;
    });
    // `layer` moved into the style entry, so read it back through resolveStyle.
    // Ordering is the project.mml paint order (orderOf), the same authority used for fills and lines.
    labels.sort(function (a, b) {
      const aOrder = orderOf(resolveStyle(styleTables, a.properties).layer);
      const bOrder = orderOf(resolveStyle(styleTables, b.properties).layer);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.id.localeCompare(b.id);
    });
    const polygonElements = fills.map((f) => f.svg).join('');
    const lineElements = lineEls.map((l) => l.svg).join('');
    const svg = `<svg width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}" xmlns="http://www.w3.org/2000/svg">${backgroundElement}${polygonElements}${lineElements}</svg>`;
    await makeDirectory(path.join(tilesDir, tZ.toString(), tX.toString()));
    await rasterize(svg, path.join(tilesDir, tZ.toString(), tX.toString(), tY.toString()));
    await makeDirectory(path.join(labelsDir, tZ.toString(), tX.toString()));
    // `extent` is what tells the client these are tile-local integers; drop it and the worker would read them as lon/lat and place everything at the antimeridian.
    fs.writeFileSync(path.join(labelsDir, tZ.toString(), tX.toString(), `${tY}.gz`), Buffer.from(gzipSync(encoder.encode(JSON.stringify({ type: 'FeatureCollection', extent: labelQuantization, zoom: tZ, features: labels, ...finalize(styleTables) })))));
    const endTime = performance.now();
    console.log(`[${count}/${total}] Rendered (${tX} ${tY} ${tZ}) in (${cX} ${cY} ${cZ}) in ${Math.floor(endTime - startTime)}ms.`);
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
  const fileformat = await loadFileformat();
  const chunkTiles = areaToTiles(west, south, east, north, baseZ);
  const groups = splitByLength(chunkTiles, 4);
  for (const group of groups) {
    try {
      const groupResults = await Promise.allSettled(group.map((tile) => renderChunk(tile[0], tile[1], baseZ, fileformat)));
      console.log(groupResults);
    } catch (err) {
      console.log(baseZ, err);
    }
  }
}

main();
