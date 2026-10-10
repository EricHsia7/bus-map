// Shared reader/writer for the cached chunk format (see chunk.proto).
const fs = require('node:fs');
const path = require('node:path');
const protobuf = require('protobufjs');
const { zlibSync, unzlibSync } = require('fflate');

// Decode 64-bit integers as plain JS numbers (OSM ids and coordinates are far
// below 2^53) instead of Long objects: faster and no Number(...) wrapping.
protobuf.util.Long = null;
protobuf.configure();

const FORMAT_VERSION = 1;
const MEMBER_TYPES = ['node', 'way', 'relation'];
const MEMBER_CODES = { node: 0, way: 1, relation: 2 };

const root = protobuf.loadSync(path.join(__dirname, 'chunk.proto'));
const ChunkFile = root.lookupType('OSMCHUNK.ChunkFile');
const ChunkData = root.lookupType('OSMCHUNK.ChunkData');

function chunkFileName(z, x, y) {
  return `${z}_${x}_${y}.chunk.pbf`;
}

/**
 * Encode and atomically write a chunk. `data` uses chunk-local, already
 * delta-coded columns (see chunk.js), so this only serializes + compresses.
 */
function writeChunk(file, header, data, level = 6) {
  const raw = ChunkData.encode(data).finish(); // plain object with camelCase fields
  const message = ChunkFile.fromObject({
    header: { version: FORMAT_VERSION, createdAt: Date.now(), ...header },
    zlibData: zlibSync(raw, { level }),
    rawSize: raw.length
  });
  const bytes = ChunkFile.encode(message).finish();
  // tmp + rename: an interrupted run can never leave a truncated file that
  // later passes the cache check.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
  return bytes.length;
}

/** Read only the header (payload stays compressed). Returns null when missing/corrupt. */
function readChunkHeader(file) {
  try {
    const message = ChunkFile.decode(fs.readFileSync(file));
    return message.header;
  } catch {
    return null;
  }
}

/**
 * Read a chunk and rebuild the in-memory shape render.js has always used:
 *   nodeMap   Map<id, [x, y]>   projected metres (EPSG:3857)
 *   nodes     [{ id, lon, lat, tags }]  tagged nodes; lon/lat are projected metres
 *   ways      [{ id, refs, tags }]
 *   relations [{ id, members: [{ type, ref, role }], tags }]
 * Returns null when the file does not exist.
 */
function readChunk(file) {
  if (!fs.existsSync(file)) return null;
  const message = ChunkFile.decode(fs.readFileSync(file));
  const header = message.header;
  if (header.version !== FORMAT_VERSION) {
    throw new Error(`${file}: chunk format v${header.version}, expected v${FORMAT_VERSION}. Re-run chunk.js.`);
  }
  let payload;
  if (message.zlibData && message.zlibData.length) payload = unzlibSync(message.zlibData);
  else if (message.raw && message.raw.length) payload = message.raw;
  else payload = new Uint8Array(0);
  const data = ChunkData.decode(payload);

  const st = data.strings;
  const resolution = header.resolution;
  const originX = header.originX;
  const originY = header.originY;

  // nodes
  const table = data.nodes || { id: [], x: [], y: [], keysVals: [] };
  const count = table.id.length;
  const ids = new Array(count);
  const nodeMap = new Map();
  const nodes = [];
  const kvs = table.keysVals;
  const hasTags = kvs.length > 0;
  let id = 0;
  let ux = 0;
  let uy = 0;
  let kv = 0;
  for (let i = 0; i < count; i++) {
    id += table.id[i];
    ux += table.x[i];
    uy += table.y[i];
    const x = (originX + ux) * resolution;
    const y = (originY + uy) * resolution;
    ids[i] = id;
    nodeMap.set(id, [x, y]);
    if (hasTags) {
      if (kvs[kv] !== 0) {
        const tags = {};
        while (kv < kvs.length && kvs[kv] !== 0) {
          const k = kvs[kv++];
          const v = kvs[kv++];
          tags[st[k]] = st[v];
        }
        nodes.push({ id, lon: x, lat: y, tags });
      }
      kv++; // delimiter
    }
  }

  const tagsOf = (keys, vals) => {
    const tags = {};
    for (let i = 0; i < keys.length; i++) tags[st[keys[i]]] = st[vals[i]];
    return tags;
  };

  // ways: refs are delta-coded indices into the node table -> OSM node ids
  const ways = new Array(data.ways.length);
  for (let w = 0; w < data.ways.length; w++) {
    const way = data.ways[w];
    const refs = new Array(way.refs.length);
    let index = 0;
    for (let i = 0; i < refs.length; i++) {
      index += way.refs[i];
      refs[i] = ids[index];
    }
    ways[w] = { id: way.id, refs, tags: tagsOf(way.keys, way.vals) };
  }

  // relations
  const relations = new Array(data.relations.length);
  for (let r = 0; r < data.relations.length; r++) {
    const relation = data.relations[r];
    const members = new Array(relation.memids.length);
    let ref = 0;
    for (let i = 0; i < members.length; i++) {
      ref += relation.memids[i];
      members[i] = { type: MEMBER_TYPES[relation.types[i]], ref, role: st[relation.rolesSid[i]] };
    }
    relations[r] = { id: relation.id, members, tags: tagsOf(relation.keys, relation.vals) };
  }

  return { header, nodeMap, nodes, ways, relations };
}

module.exports = { FORMAT_VERSION, MEMBER_CODES, chunkFileName, writeChunk, readChunk, readChunkHeader };
