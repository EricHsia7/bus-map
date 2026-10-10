// chunk.js — parse an .osm.pbf, project every node to Web Mercator once, slice
// the data into self-contained base chunks (z = config.chunks.baseZ) and cache
// them as `<z>_<x>_<y>.chunk.pbf` (format: chunk.proto).
//
//   node chunk.js            build missing / stale chunks only
//   node chunk.js --force    rebuild every chunk
//
// Input requirements: the .osm.pbf must be sorted (nodes, then ways, then
// relations, each by ascending id) — the default for Geofabrik/planet
// extracts and anything written by osmium. Unsorted input: `osmium sort`.
//
// Slicing semantics (a superset of `osmium extract -s smart`):
//   * a way goes into every chunk its bounding box (+ margin) touches, with
//     complete geometry — so polygons that fully enclose a chunk without
//     having a single node inside it are no longer lost;
//   * a relation goes into every chunk its bounding box (+ margin) touches;
//     for "complete" relation types (default: any) all member ways come too,
//     so multipolygons can always be assembled;
//   * tagged nodes (POIs) go only into the chunk that contains them.
// The margin covers the render buffer so strokes crossing a chunk edge are
// still drawn in edge tiles.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const protobuf = require('protobufjs');
const { unzlibSync } = require('fflate');
const config = require('./config.json');
const { areaToTiles } = require('./coordinate');
const { FORMAT_VERSION, MEMBER_CODES, chunkFileName, writeChunk, readChunkHeader } = require('./chunk-format');

const R = 6378137;
const HALF = Math.PI * R; // half the Web Mercator world width, metres
const MAX_LAT = 85.0511287798066;
const DEG = Math.PI / 180;

// settings
const force = process.argv.includes('--force');
const inputPath = config.data;
const outputDir = config.chunks.dir;
const baseZ = config.chunks.baseZ;
// metres per stored unit. >= 1 cm keeps every world coordinate inside Int32.
const resolution = config.chunks.resolution ?? 0.01;
if (!(resolution >= 0.01)) throw new Error('config.chunks.resolution must be >= 0.01 (metres)');
// Fraction of a chunk added around each feature bbox before slicing. Default
// = the larger of render.js's raster safe margin and the vector buffer, both
// measured at baseZ (the coarsest tile rendered from a chunk).
const marginRatio = config.chunks.margin ?? Math.max(64 / (config.tiles.size || 256), (config.tiles.buffer || 0) / (config.tiles.extent || 4096));
// Relation types whose member ways are always copied in full: "any" or an array.
const completeRelations = config.chunks.completeRelations ?? 'any';
const compressionLevel = config.chunks.compression ?? 6;

const chunkWidth = (2 * HALF) / 2 ** baseZ; // metres
const chunkCount = 2 ** baseZ;

// helpers
class Grow {
  constructor(Type, capacity = 1 << 16) {
    this.Type = Type;
    this.a = new Type(capacity);
    this.length = 0;
  }
  push(v) {
    if (this.length === this.a.length) {
      const b = new this.Type(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.length++] = v;
  }
  view() {
    return this.a.subarray(0, this.length);
  }
}

const toUnitsX = (lon) => Math.round((R * lon * DEG) / resolution);
const toUnitsY = (lat) => {
  const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return Math.round((R * Math.log(Math.tan(Math.PI / 4 + (l * DEG) / 2))) / resolution);
};
const chunkXOf = (ux) => Math.min(chunkCount - 1, Math.max(0, Math.floor((ux * resolution + HALF) / chunkWidth)));
const chunkYOf = (uy) => Math.min(chunkCount - 1, Math.max(0, Math.floor((HALF - uy * resolution) / chunkWidth)));

function lowerBound(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function indexOf(sorted, value) {
  const i = lowerBound(sorted, value);
  return i < sorted.length && sorted[i] === value ? i : -1;
}

function fingerprintOf() {
  const stat = fs.statSync(inputPath);
  const key = JSON.stringify([FORMAT_VERSION, path.resolve(inputPath), stat.size, stat.mtimeMs, baseZ, resolution, marginRatio, completeRelations]);
  return crypto.createHash('sha1').update(key).digest('hex');
}

// parsing
// Global string interning: tags are stored as Uint32 string ids, not JS objects.
const strings = [''];
const stringIds = new Map([['', 0]]);
function intern(s) {
  let id = stringIds.get(s);
  if (id === undefined) {
    id = strings.length;
    strings.push(s);
    stringIds.set(s, id);
  }
  return id;
}

function parse(bounds) {
  const root = protobuf.loadSync(path.join(__dirname, 'fileformat.proto'));
  const BlobHeader = root.lookupType('OSMPBF.BlobHeader');
  const Blob = root.lookupType('OSMPBF.Blob');
  const PrimitiveBlock = root.lookupType('OSMPBF.PrimitiveBlock');

  const nodeIds = new Grow(Float64Array, 1 << 20);
  const nodeX = new Grow(Int32Array, 1 << 20);
  const nodeY = new Grow(Int32Array, 1 << 20);
  // tagged nodes inside the requested area
  const taggedNode = new Grow(Int32Array); // node index
  const taggedStart = new Grow(Uint32Array);
  const taggedTags = new Grow(Uint32Array); // k, v, k, v, ...
  taggedStart.push(0);

  const wayIds = new Grow(Float64Array, 1 << 18);
  const wayRefStart = new Grow(Uint32Array, 1 << 18);
  const wayRefs = new Grow(Int32Array, 1 << 20); // node index, -1 = missing
  const wayTagStart = new Grow(Uint32Array, 1 << 18);
  const wayTags = new Grow(Uint32Array, 1 << 18);
  wayRefStart.push(0);
  wayTagStart.push(0);

  const relations = []; // { id, keys, vals, roles, memids, types } with global string ids

  let phase = 0; // 0 nodes, 1 ways, 2 relations
  let lastId = -Infinity;
  let sortedNodeIds = null;
  let missingRefs = 0;
  const enter = (p) => {
    if (p < phase) throw new Error(`${inputPath} is not sorted (nodes, ways, relations). Run: osmium sort -o sorted.osm.pbf ${inputPath}`);
    if (p > phase) {
      phase = p;
      lastId = -Infinity;
    }
    if (p >= 1 && !sortedNodeIds) sortedNodeIds = nodeIds.view();
  };
  const checkId = (id) => {
    if (id <= lastId) throw new Error(`${inputPath}: ids are not ascending (${id} after ${lastId}). Run: osmium sort.`);
    lastId = id;
  };

  const addNode = (id, lon, lat, keys, vals, st) => {
    checkId(id);
    const index = nodeIds.length;
    const ux = toUnitsX(lon);
    const uy = toUnitsY(lat);
    nodeIds.push(id);
    nodeX.push(ux);
    nodeY.push(uy);
    if (keys.length && ux >= bounds.minX && ux <= bounds.maxX && uy >= bounds.minY && uy <= bounds.maxY) {
      taggedNode.push(index);
      for (let i = 0; i < keys.length; i++) {
        taggedTags.push(intern(st[keys[i]]));
        taggedTags.push(intern(st[vals[i]]));
      }
      taggedStart.push(taggedTags.length);
    }
  };

  const fd = fs.openSync(inputPath, 'r');
  const fileSize = fs.fstatSync(fd).size;
  const lengthBuffer = Buffer.alloc(4);
  let offset = 0;
  let blocks = 0;
  let lastLog = Date.now();
  try {
    while (offset + 4 <= fileSize) {
      fs.readSync(fd, lengthBuffer, 0, 4, offset);
      const headerLength = lengthBuffer.readInt32BE(0);
      offset += 4;
      const headerBuffer = Buffer.alloc(headerLength);
      fs.readSync(fd, headerBuffer, 0, headerLength, offset);
      offset += headerLength;
      const header = BlobHeader.decode(headerBuffer);
      const blobBuffer = Buffer.alloc(header.datasize);
      fs.readSync(fd, blobBuffer, 0, header.datasize, offset);
      offset += header.datasize;
      if (header.type !== 'OSMData') continue; // OSMHeader carries nothing we need

      const blob = Blob.decode(blobBuffer);
      let data;
      if (blob.zlibData && blob.zlibData.length) data = unzlibSync(blob.zlibData);
      else if (blob.raw && blob.raw.length) data = blob.raw;
      else throw new Error('Unsupported blob compression (only raw/zlib). Re-encode with: osmium cat -o out.osm.pbf in.osm.pbf');

      const block = PrimitiveBlock.decode(data);
      const gran = block.granularity ?? 100;
      const latOff = block.latOffset ?? 0;
      const lonOff = block.lonOffset ?? 0;
      const st = block.stringtable.s.map((b) => Buffer.from(b).toString('utf8'));

      for (const group of block.primitivegroup) {
        if (group.nodes.length) {
          enter(0);
          for (const n of group.nodes) addNode(n.id, (lonOff + gran * n.lon) / 1e9, (latOff + gran * n.lat) / 1e9, n.keys, n.vals, st);
        }
        if (group.dense && group.dense.id.length) {
          enter(0);
          const d = group.dense;
          const kvs = d.keysVals;
          let id = 0;
          let lat = 0;
          let lon = 0;
          let kv = 0;
          const keys = [];
          const vals = [];
          for (let i = 0; i < d.id.length; i++) {
            id += d.id[i];
            lat += d.lat[i];
            lon += d.lon[i];
            keys.length = 0;
            vals.length = 0;
            if (kvs.length) {
              while (kv < kvs.length && kvs[kv] !== 0) {
                keys.push(kvs[kv++]);
                vals.push(kvs[kv++]);
              }
              kv++;
            }
            addNode(id, (lonOff + gran * lon) / 1e9, (latOff + gran * lat) / 1e9, keys, vals, st);
          }
        }
        if (group.ways.length) {
          enter(1);
          for (const w of group.ways) {
            checkId(w.id);
            wayIds.push(w.id);
            let ref = 0;
            for (let i = 0; i < w.refs.length; i++) {
              ref += w.refs[i];
              const index = indexOf(sortedNodeIds, ref);
              if (index < 0) missingRefs++;
              wayRefs.push(index);
            }
            wayRefStart.push(wayRefs.length);
            for (let i = 0; i < w.keys.length; i++) {
              wayTags.push(intern(st[w.keys[i]]));
              wayTags.push(intern(st[w.vals[i]]));
            }
            wayTagStart.push(wayTags.length);
          }
        }
        if (group.relations.length) {
          enter(2);
          for (const r of group.relations) {
            checkId(r.id);
            let mid = 0;
            relations.push({
              id: r.id,
              keys: r.keys.map((k) => intern(st[k])),
              vals: r.vals.map((v) => intern(st[v])),
              roles: r.rolesSid.map((s) => intern(st[s])),
              memids: r.memids.map((m) => (mid += m)),
              types: Array.from(r.types)
            });
          }
        }
      }

      blocks++;
      if (Date.now() - lastLog > 2000) {
        lastLog = Date.now();
        console.log(`parse ${((offset / fileSize) * 100).toFixed(1)}%  nodes ${nodeIds.length}  ways ${wayIds.length}  relations ${relations.length}`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  if (!sortedNodeIds) sortedNodeIds = nodeIds.view();
  if (missingRefs) console.warn(`warning: ${missingRefs} way node references are missing from the input (dropped)`);
  console.log(`parsed ${blocks} blocks: ${nodeIds.length} nodes, ${wayIds.length} ways, ${relations.length} relations`);

  return {
    nodeIds: sortedNodeIds,
    nodeX: nodeX.view(),
    nodeY: nodeY.view(),
    taggedNode: taggedNode.view(),
    taggedStart: taggedStart.view(),
    taggedTags: taggedTags.view(),
    wayIds: wayIds.view(),
    wayRefStart: wayRefStart.view(),
    wayRefs: wayRefs.view(),
    wayTagStart: wayTagStart.view(),
    wayTags: wayTags.view(),
    relations
  };
}

// slicing
// Chunk-index ranges [x0, x1] x [y0, y1] per feature; x0 = -1 means "no geometry".
function wayRanges(osm, marginUnits) {
  const count = osm.wayIds.length;
  const ranges = new Int32Array(count * 4).fill(-1);
  for (let w = 0; w < count; w++) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = osm.wayRefStart[w]; i < osm.wayRefStart[w + 1]; i++) {
      const n = osm.wayRefs[i];
      if (n < 0) continue;
      const x = osm.nodeX[n];
      const y = osm.nodeY[n];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (minX === Infinity) continue;
    ranges[w * 4] = chunkXOf(minX - marginUnits);
    ranges[w * 4 + 1] = chunkXOf(maxX + marginUnits);
    ranges[w * 4 + 2] = chunkYOf(maxY + marginUnits); // north -> smaller y
    ranges[w * 4 + 3] = chunkYOf(minY - marginUnits);
  }
  return ranges;
}

function relationRanges(osm, ways, marginUnits) {
  const count = osm.relations.length;
  const ranges = new Int32Array(count * 4).fill(-1);
  const state = new Uint8Array(count); // 0 todo, 1 visiting, 2 done
  const relationIds = Float64Array.from(osm.relations, (r) => r.id);

  const visit = (r) => {
    if (state[r] !== 0) return; // done, or a cycle in super-relations
    state[r] = 1;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const add = (a, b, c, d) => {
      if (a < 0) return;
      if (a < x0) x0 = a;
      if (b > x1) x1 = b;
      if (c < y0) y0 = c;
      if (d > y1) y1 = d;
    };
    const rel = osm.relations[r];
    for (let i = 0; i < rel.memids.length; i++) {
      const type = rel.types[i];
      if (type === MEMBER_CODES.way) {
        const w = indexOf(osm.wayIds, rel.memids[i]);
        if (w >= 0) add(ways[w * 4], ways[w * 4 + 1], ways[w * 4 + 2], ways[w * 4 + 3]);
      } else if (type === MEMBER_CODES.node) {
        const n = indexOf(osm.nodeIds, rel.memids[i]);
        if (n >= 0) {
          const x = osm.nodeX[n];
          const y = osm.nodeY[n];
          add(chunkXOf(x - marginUnits), chunkXOf(x + marginUnits), chunkYOf(y + marginUnits), chunkYOf(y - marginUnits));
        }
      } else {
        const child = indexOf(relationIds, rel.memids[i]);
        if (child >= 0) {
          visit(child);
          add(ranges[child * 4], ranges[child * 4 + 1], ranges[child * 4 + 2], ranges[child * 4 + 3]);
        }
      }
    }
    if (x0 !== Infinity) {
      ranges[r * 4] = x0;
      ranges[r * 4 + 1] = x1;
      ranges[r * 4 + 2] = y0;
      ranges[r * 4 + 3] = y1;
    }
    state[r] = 2;
  };
  for (let r = 0; r < count; r++) visit(r);
  return ranges;
}

function isComplete(rel) {
  if (completeRelations === 'any') return true;
  for (let i = 0; i < rel.keys.length; i++) {
    if (strings[rel.keys[i]] === 'type') return completeRelations.includes(strings[rel.vals[i]]);
  }
  return false;
}

// writing
function buildChunk(osm, bucket, scratch) {
  // ways: direct hits + members of complete relations, deduped, id order
  const wayList = Int32Array.from(bucket.ways).sort();
  const ways = [];
  for (let i = 0; i < wayList.length; i++) if (i === 0 || wayList[i] !== wayList[i - 1]) ways.push(wayList[i]);

  // nodes: everything referenced + tagged POIs inside the chunk, id order
  const used = [];
  for (const w of ways) {
    for (let i = osm.wayRefStart[w]; i < osm.wayRefStart[w + 1]; i++) {
      const n = osm.wayRefs[i];
      if (n >= 0 && scratch[n] === -1) {
        scratch[n] = 0;
        used.push(n);
      }
    }
  }
  const tagOf = new Map();
  for (const t of bucket.tagged) {
    const n = osm.taggedNode[t];
    tagOf.set(n, t);
    if (scratch[n] === -1) {
      scratch[n] = 0;
      used.push(n);
    }
  }
  const nodes = Int32Array.from(used).sort();
  for (let i = 0; i < nodes.length; i++) scratch[nodes[i]] = i; // global -> local index

  const local = [''];
  const localIds = new Map([[0, 0]]);
  const sid = (g) => {
    let id = localIds.get(g);
    if (id === undefined) {
      id = local.length;
      local.push(strings[g]);
      localIds.set(g, id);
    }
    return id;
  };

  const ids = new Array(nodes.length);
  const xs = new Array(nodes.length);
  const ys = new Array(nodes.length);
  const keysVals = [];
  let pid = 0;
  let px = bucket.originX;
  let py = bucket.originY;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const id = osm.nodeIds[n];
    ids[i] = id - pid;
    xs[i] = osm.nodeX[n] - px;
    ys[i] = osm.nodeY[n] - py;
    pid = id;
    px = osm.nodeX[n];
    py = osm.nodeY[n];
    if (tagOf.size) {
      const t = tagOf.get(n);
      if (t !== undefined) for (let k = osm.taggedStart[t]; k < osm.taggedStart[t + 1]; k++) keysVals.push(sid(osm.taggedTags[k]));
      keysVals.push(0);
    }
  }

  const wayMessages = new Array(ways.length);
  for (let j = 0; j < ways.length; j++) {
    const w = ways[j];
    const keys = [];
    const vals = [];
    for (let k = osm.wayTagStart[w]; k < osm.wayTagStart[w + 1]; k += 2) {
      keys.push(sid(osm.wayTags[k]));
      vals.push(sid(osm.wayTags[k + 1]));
    }
    const refs = [];
    let prev = 0;
    for (let i = osm.wayRefStart[w]; i < osm.wayRefStart[w + 1]; i++) {
      const n = osm.wayRefs[i];
      if (n < 0) continue;
      refs.push(scratch[n] - prev);
      prev = scratch[n];
    }
    wayMessages[j] = { id: osm.wayIds[w], keys, vals, refs };
  }

  const relationList = Array.from(new Set(bucket.relations)).sort((a, b) => a - b);
  const relationMessages = relationList.map((r) => {
    const rel = osm.relations[r];
    let prev = 0;
    return {
      id: rel.id,
      keys: rel.keys.map(sid),
      vals: rel.vals.map(sid),
      rolesSid: rel.roles.map(sid),
      memids: rel.memids.map((m) => {
        const d = m - prev;
        prev = m;
        return d;
      }),
      types: rel.types
    };
  });

  for (let i = 0; i < nodes.length; i++) scratch[nodes[i]] = -1; // reset for the next chunk

  return {
    counts: { nodeCount: nodes.length, wayCount: ways.length, relationCount: relationList.length },
    data: { strings: local, nodes: { id: ids, x: xs, y: ys, keysVals }, ways: wayMessages, relations: relationMessages }
  };
}

// main
function main() {
  const t0 = Date.now();
  const { west, south, east, north } = config.bbox;
  const tiles = areaToTiles(west, south, east, north, baseZ);
  fs.mkdirSync(outputDir, { recursive: true });

  const fingerprint = fingerprintOf();
  const xs = tiles.map((t) => t[0]);
  const ys = tiles.map((t) => t[1]);
  const rx0 = Math.min(...xs);
  const rx1 = Math.max(...xs);
  const ry0 = Math.min(...ys);
  const ry1 = Math.max(...ys);
  const rows = ry1 - ry0 + 1;
  const slotOf = (x, y) => (x - rx0) * rows + (y - ry0);

  // cache check: header-only read, payload never inflated
  const buckets = new Array((rx1 - rx0 + 1) * rows).fill(null);
  let stale = 0;
  for (const [x, y] of tiles) {
    const file = path.join(outputDir, chunkFileName(baseZ, x, y));
    const header = force ? null : readChunkHeader(file);
    if (header && header.fingerprint === fingerprint) continue;
    buckets[slotOf(x, y)] = {
      x,
      y,
      file,
      originX: Math.round((-HALF + x * chunkWidth) / resolution),
      originY: Math.round((HALF - (y + 1) * chunkWidth) / resolution),
      ways: [],
      relations: [],
      tagged: []
    };
    stale++;
  }
  if (stale === 0) {
    console.log(`all ${tiles.length} chunks are cached (${outputDir}); use --force to rebuild`);
    return;
  }
  console.log(`${stale}/${tiles.length} chunks to build`);

  // only POIs inside the requested area are kept with tags
  const bounds = {
    minX: Math.floor((-HALF + rx0 * chunkWidth) / resolution),
    maxX: Math.ceil((-HALF + (rx1 + 1) * chunkWidth) / resolution),
    minY: Math.floor((HALF - (ry1 + 1) * chunkWidth) / resolution),
    maxY: Math.ceil((HALF - ry0 * chunkWidth) / resolution)
  };
  const osm = parse(bounds);
  const t1 = Date.now();

  const marginUnits = (chunkWidth * marginRatio) / resolution;
  const ways = wayRanges(osm, marginUnits);
  const relations = relationRanges(osm, ways, marginUnits);

  const eachBucket = (range, i, fn) => {
    const x0 = Math.max(range[i * 4], rx0);
    const x1 = Math.min(range[i * 4 + 1], rx1);
    const y0 = Math.max(range[i * 4 + 2], ry0);
    const y1 = Math.min(range[i * 4 + 3], ry1);
    if (range[i * 4] < 0) return;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const bucket = buckets[slotOf(x, y)];
        if (bucket) fn(bucket);
      }
    }
  };

  for (let w = 0; w < osm.wayIds.length; w++) eachBucket(ways, w, (b) => b.ways.push(w));
  for (let r = 0; r < osm.relations.length; r++) {
    const rel = osm.relations[r];
    let members = null;
    if (isComplete(rel)) {
      members = [];
      for (let i = 0; i < rel.memids.length; i++) {
        if (rel.types[i] !== MEMBER_CODES.way) continue;
        const w = indexOf(osm.wayIds, rel.memids[i]);
        if (w >= 0) members.push(w);
      }
    }
    eachBucket(relations, r, (b) => {
      b.relations.push(r);
      if (members) for (const w of members) b.ways.push(w);
    });
  }
  for (let t = 0; t < osm.taggedNode.length; t++) {
    const n = osm.taggedNode[t];
    const x = chunkXOf(osm.nodeX[n]);
    const y = chunkYOf(osm.nodeY[n]);
    if (x < rx0 || x > rx1 || y < ry0 || y > ry1) continue;
    const bucket = buckets[slotOf(x, y)];
    if (bucket) bucket.tagged.push(t);
  }

  const scratch = new Int32Array(osm.nodeIds.length).fill(-1);
  let written = 0;
  let bytes = 0;
  for (const bucket of buckets) {
    if (!bucket) continue;
    const { counts, data } = buildChunk(osm, bucket, scratch);
    const header = { z: baseZ, x: bucket.x, y: bucket.y, resolution, originX: bucket.originX, originY: bucket.originY, fingerprint, ...counts };
    bytes += writeChunk(bucket.file, header, data, compressionLevel);
    written++;
    bucket.ways = bucket.relations = bucket.tagged = null; // free early
    console.log(`[${written}/${stale}] ${chunkFileName(baseZ, bucket.x, bucket.y)}  nodes ${counts.nodeCount}  ways ${counts.wayCount}  relations ${counts.relationCount}`);
  }
  console.log(`done: ${written} chunks, ${(bytes / 1048576).toFixed(1)} MiB, parse ${((t1 - t0) / 1000).toFixed(1)}s, slice+write ${((Date.now() - t1) / 1000).toFixed(1)}s`);
}

main();
