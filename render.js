const protobuf = require('protobufjs');
const fs = require('node:fs');
const path = require('node:path');
const { decompressSync } = require('fflate');
const { plotPolygon, plotLineString } = require('./plot.js');
const { getTileViewbox, getSubTiles, areaToTiles, getParentTile } = require('./coordinate.js');
const style = require('./style.json');
const M = require('./match-rule.js');
const I = require('./infer-layer.js');
const { paintToSvg } = require('./paint-to-svg.js');
const { assembleAreas } = require('./assemble.js');
const config = require('./config.json');
const { rasterize } = require('./rasterize.js');
const { makeDirectory } = require('./files.js');

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

const backgroundElement = `<rect x="0" y="0" width="${tileSize}" height="${tileSize}" fill="${tileBackground}"/>`;

async function renderChunk(cX, cY, cZ) {
  const buf = fs.readFileSync(path.join(chunksDir, `${cZ}_${cX}_${cY}.osm.pbf`));
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
            nodeMap.set(id, [lon, lat]);
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

  // Assemble multipolygon relations (wide rivers, lakes, landuse, ...) into filled area geometry. Their tags live on the relation and their member ways are usually untagged, so the per-way loop below never draws them.
  const wayMap = new Map(ways.map((w) => [w.id, w]));
  const { features: areaFeatures, memberWayIds } = assembleAreas(relations, wayMap, nodeMap);

  // reconstruct geometry
  const subTiles = getSubTiles(cX, cY, cZ, tilesMaxZ);
  const total = subTiles.length;
  let count = 0;
  for (const [tX, tY, tZ] of subTiles) {
    count++;
    const [x0, y0, x1, y1] = getTileViewbox(tX, tY, tZ);
    const fills = []; // { order, svg } collected across ways + relations
    const lineEls = []; // { order, svg }
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
      }
    }

    // Emit in OSM Carto layer order (stable sort keeps intra-layer feature order). Fills first, then lines, so casings/labels stay on top.
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
  const groups = splitByLength(chunkTiles, 4);
  for (const group of groups) {
    try {
      const groupResults = await Promise.allSettled(group.map((tile) => renderChunk(tile[0], tile[1], baseZ)));
      console.log(groupResults);
    } catch (err) {
      console.log(cX, cY, baseZ, err);
    }
  }
}

main();
