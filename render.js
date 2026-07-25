const protobuf = require('protobufjs');
const fs = require('node:fs');
const path = require('node:path');
const { decompressSync } = require('fflate');
const { plotPolygon, plotLineString } = require('./plot.js');
const { getTileViewbox, getSubTiles, areaToTiles, getParentTile, tileToBoundingbox } = require('./coordinate.js');
const style = require('./style.json');
const M = require('./match-rule.js');
const I = require('./infer-layer.js');
const { paintToSvg } = require('./paint-to-svg.js');
const { assembleAreas } = require('./assemble.js');
const config = require('./config.json');
const { rasterize } = require('./rasterize.js');
const { makeDirectory } = require('./files.js');
const { paintToLabels } = require('./paint-to-label.js');

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
const mml = require('./mml.json');
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
const tileBackground = config.tiles.background;
const tilesMaxZ = config.tiles.z.max;
const safeMargin = 64;

// Overlay label/marker output. Text and point symbols are intentionally NOT
// rasterized (see paint-to-svg.js); instead we collect the features a MapLibre
// `symbol` layer *should* render and emit one GeoJSON FeatureCollection per
// tile, mirroring the raster pyramid at labels/z/x/y.geojson. Coordinates are
// WGS84 lon/lat, as required by the GeoJSON spec.
const labelsDir = (config.labels && config.labels.dir) || path.join(tilesDir, '..', 'labels');

// Representative point (vertex average) of a ring, for placing an area label.
function centroidOf(ring) {
  let x = 0,
    y = 0,
    n = 0;
  for (const p of ring) {
    if (!p) continue;
    x += p[0];
    y += p[1];
    n++;
  }
  return n ? [x / n, y / n] : null;
}

const backgroundElement = `<rect x="0" y="0" width="${tileSize}" height="${tileSize}" fill="${tileBackground}"/>`;

const chunkCache = new Map();

// Parse one chunk's .osm.pbf into { nodeMap, ways, relations }. Cached so the
// center chunk and its neighbors (loaded by adjacent renders) are parsed once.
// Returns null when the chunk file does not exist (edge of the extract).
async function parseChunk(cX, cY, cZ) {
  const key = `${cZ}_${cX}_${cY}`;
  if (chunkCache.has(key)) return chunkCache.get(key);
  const file = path.join(chunksDir, `${cZ}_${cX}_${cY}.osm.pbf`);
  if (!fs.existsSync(file)) {
    chunkCache.set(key, null);
    return null;
  }
  const buf = fs.readFileSync(file);
  const view = new DataView(buf.buffer);

  const root = await protobuf.load('./fileformat.proto');
  const BlobHeaderType = root.lookupType('OSMPBF.BlobHeader');
  const BlobType = root.lookupType('OSMPBF.Blob');
  const HeaderBlock = root.lookupType('OSMPBF.HeaderBlock');
  const PrimitiveBlock = root.lookupType('OSMPBF.PrimitiveBlock');

  const Node = root.lookupType('OSMPBF.Node');
  const Way = root.lookupType('OSMPBF.Way');
  const Relation = root.lookupType('OSMPBF.Relation');

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
            nodes.push({
              id: id,
              lat: toDeg(n.lat, latOff),
              lon: toDeg(n.lon, lonOff),
              tags: tags(n.keys, n.vals)
            });
            nodeMap.set(id, [toDeg(n.lon, lonOff), toDeg(n.lat, latOff)]);
          }

          // --- DenseNodes (this is where nodes usually are!) ---
          if (group.dense) {
            const d = group.dense;
            // console.log(123, d)
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
              nodes.push({ id, lat: toDeg(lat, latOff), lon: toDeg(lon, lonOff), tags: t });
              nodeMap.set(id, [toDeg(lon, lonOff), toDeg(lat, latOff)]);
            }
          }

          // --- Ways (refs are delta-coded) ---
          for (const w of group.ways) {
            let ref = 0;
            const refs = w.refs.map((r) => (ref += Number(r)));
            ways.push({ id: Number(w.id), refs, tags: tags(w.keys, w.vals) });
          }

          // --- Relations (memids delta-coded, roles are string IDs) ---
          for (const r of group.relations) {
            let mid = 0;
            const members = r.memids.map((m, i) => ({
              type: ['node', 'way', 'relation'][r.types[i]],
              ref: (mid += Number(m)),
              role: st[r.rolesSid[i]]
            }));
            relations.push({ id: Number(r.id), members, tags: tags(r.keys, r.vals) });
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

  // Only tagged nodes are potential POI/marker/label anchors; untagged nodes
  // are pure geometry vertices and would bloat memory.
  const taggedNodes = nodes.filter((n) => n.tags && Object.keys(n.tags).length);
  const result = { nodeMap, nodes: taggedNodes, ways, relations };
  chunkCache.set(key, result);
  return result;
}

async function renderChunk(cX, cY, cZ) {
  const center = await parseChunk(cX, cY, cZ);
  if (!center) return;
  const { nodeMap, ways, relations } = center;

  // Load the 8 neighbor chunks so multipolygon rings whose connecting member
  // ways cross a chunk boundary can still be closed. Without this a cross-chunk
  // outer ring stays open and gets force-closed with a straight chord across
  // the interior -> the white-triangle / checkerboard fill artifact.
  const lookupChunks = [center];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nb = await parseChunk(cX + dx, cY + dy, cZ);
      if (nb) lookupChunks.push(nb);
    }
  }
  const mergedWayMap = new Map();
  for (const c of lookupChunks) {
    for (const w of c.ways) if (!mergedWayMap.has(w.id)) mergedWayMap.set(w.id, w);
  }
  const mergedNodes = {
    get: (id) => {
      for (const c of lookupChunks) {
        const p = c.nodeMap.get(id);
        if (p) return p;
      }
      return undefined;
    }
  };

  // Assemble multipolygon relations (wide rivers, lakes, landuse, ...) into
  // filled area geometry. Their tags live on the relation and their member
  // ways are usually untagged, so the per-way loop below never draws them.
  const { features: areaFeatures, memberWayIds } = assembleAreas(relations, mergedWayMap, mergedNodes);

  // reconstruct geometry
  const subTiles = getSubTiles(cX, cY, cZ, tilesMaxZ);
  const total = subTiles.length;
  let count = 0;
  for (const [tX, tY, tZ] of subTiles) {
    count++;
    const [x0, y0, x1, y1] = getTileViewbox(tX, tY, tZ);
    const [tw, ts, te, tn] = tileToBoundingbox(tX, tY, tZ); // lon/lat bounds of this tile
    const fills = []; // { order, svg } collected across ways + relations
    const lineEls = []; // { order, svg }
    const labels = []; // GeoJSON features for the text/marker overlay
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
        if (descs) {
          let geom = null;
          if (closed) {
            const c = centroidOf(coords);
            if (c && c[0] >= tw && c[0] <= te && c[1] >= ts && c[1] <= tn) geom = { type: 'Point', coordinates: c };
          } else {
            geom = { type: 'LineString', coordinates: coords };
          }
          if (geom)
            for (const desc of descs) {
              labels.push({ type: 'Feature', id: `w${way.id}:${layer.id}:${desc.instance || ''}`, geometry: geom, properties: { layer: layer.id, minzoom: tZ, ...desc.properties } });
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
          const svg = paintToSvg(passes[index], d, 'polygon', tileSize / 256);
          if (!svg) continue;
          fills.push({ base, index, svg });
        }

        // Area labels (place/landuse/building names): anchor at a
        // representative point, emitted only for the tile that contains it.
        const labelPaint = {};
        for (const idx of idxs) Object.assign(labelPaint, style[idx].paint);
        const descs = paintToLabels(labelPaint, featRow);
        if (descs) {
          const ring = feat.polygons[0] && feat.polygons[0][0];
          const c = ring && centroidOf(ring);
          if (c && c[0] >= tw && c[0] <= te && c[1] >= ts && c[1] <= tn) {
            for (const desc of descs) {
              labels.push({ type: 'Feature', id: `r:${layer.id}:${desc.instance || ''}:${c[0].toFixed(5)},${c[1].toFixed(5)}`, geometry: { type: 'Point', coordinates: c }, properties: { layer: layer.id, minzoom: tZ, ...desc.properties } });
            }
          }
        }
      }
    }

    // Point features (POIs / place names / stations) live on tagged nodes,
    // which are never drawn as background geometry. Emit each only for the tile
    // whose bbox contains it, so a point lands in exactly one tile.
    for (const node of center.nodes) {
      if (node.lon < tw || node.lon > te || node.lat < ts || node.lat > tn) continue;
      const nlayers = I.inferLayers(node.tags, { geometry: 'point', zoom: tZ });
      for (const layer of nlayers) {
        const feat = { ...node.tags, ...layer.row };
        const idxs = M.matchRules(feat, layer.id, tZ);
        if (idxs.length === 0) continue;
        const labelPaint = {};
        for (const idx of idxs) Object.assign(labelPaint, style[idx].paint);
        const descs = paintToLabels(labelPaint, feat);
        if (!descs) continue;
        for (const desc of descs) {
          labels.push({ type: 'Feature', id: `n${node.id}:${layer.id}:${desc.instance || ''}`, geometry: { type: 'Point', coordinates: [node.lon, node.lat] }, properties: { layer: layer.id, minzoom: tZ, ...desc.properties } });
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
    const polygonElements = fills.map((f) => f.svg).join('');
    const lineElements = lineEls.map((l) => l.svg).join('');
    const svg = `<svg width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}" xmlns="http://www.w3.org/2000/svg">${backgroundElement}${polygonElements}${lineElements}</svg>`;
    await makeDirectory(path.join(tilesDir, tZ.toString(), tX.toString()));
    await rasterize(svg, path.join(tilesDir, tZ.toString(), tX.toString(), tY.toString()));
    if (labels.length) {
      await makeDirectory(path.join(labelsDir, tZ.toString(), tX.toString()));
      fs.writeFileSync(path.join(labelsDir, tZ.toString(), tX.toString(), `${tY}.geojson`), JSON.stringify({ type: 'FeatureCollection', features: labels }));
    }
    const endTime = performance.now();
    console.log(`[${count}/${total}] Rendered (${tX} ${tY} ${tZ}) in (${cX} ${cY} ${cZ}) in ${((endTime - startTime) / 1000).toFixed(2)}s.`);
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

  // --- Chunk unloading ---------------------------------------------------
  // renderChunk keeps every parsed chunk (center + its 8 neighbors) in
  // chunkCache so a chunk shared by adjacent centers is parsed once. Left
  // unbounded this holds the whole extract in memory. A chunk at (x,y) can
  // only ever be needed by a center within its 3x3 neighborhood, i.e. the
  // centers (x+dx, y+dy) for dx,dy in {-1,0,1}. Once all of those centers have
  // been rendered, the chunk is unreachable and is dropped. Eviction is always
  // safe: parseChunk re-reads from disk on a miss, so at worst a wrongly-timed
  // drop costs a re-parse, never a wrong tile.
  const pending = new Set(chunkTiles.map(([x, y]) => `${x},${y}`)); // centers not yet rendered

  function unloadFinishedChunks() {
    for (const cacheKey of [...chunkCache.keys()]) {
      // cacheKey === `${cZ}_${cX}_${cY}` (cX/cY may be negative at the edge)
      const parts = cacheKey.split('_');
      const kx = Number(parts[1]);
      const ky = Number(parts[2]);
      let stillNeeded = false;
      for (let dx = -1; dx <= 1 && !stillNeeded; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (pending.has(`${kx + dx},${ky + dy}`)) {
            stillNeeded = true;
            break;
          }
        }
      }
      if (!stillNeeded) chunkCache.delete(cacheKey);
    }
  }

  const groups = splitByLength(chunkTiles, 4);
  for (const group of groups) {
    try {
      const groupResults = await Promise.allSettled(
        group.map(async (tile) => {
          const result = await renderChunk(tile[0], tile[1], baseZ);
          pending.delete(`${tile[0]},${tile[1]}`); // this center is now rendered
          return result;
        })
      );
      console.log(groupResults);
    } catch (err) {
      console.log(baseZ, err);
    }
    // Drop any cached chunk whose whole neighborhood is now rendered. Runs
    // after the group (not mid-group) so a chunk still in use by a sibling
    // render in the same group is never pulled out from under it.
    unloadFinishedChunks();
    console.log(`chunkCache: ${chunkCache.size} chunk(s) resident`);
  }
}

main();
