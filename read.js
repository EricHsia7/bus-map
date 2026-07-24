const protobuf = require('protobufjs');
const fs = require('node:fs');
const { decompressSync } = require('fflate');

const toObjectOptions = {
  enums: String, // enums as string names
  longs: Number, // longs as strings (requires long.js)
  bytes: String, // bytes as base64 encoded strings
  defaults: true, // includes default values
  arrays: true, // populates empty arrays (repeated fields) even if defaults=false
  objects: true, // populates empty objects (map fields) even if defaults=false
  oneofs: true
};

async function main() {
  const buf = fs.readFileSync('./chunks/13_6863_3502.osm.pbf');
  const view = new DataView(buf.buffer);

  const root = await protobuf.load('./fileformat.proto');
  const BlobHeaderType = root.lookupType('OSMPBF.BlobHeader');
  const BlobType = root.lookupType('OSMPBF.Blob');
  const HeaderBlock = root.lookupType('OSMPBF.HeaderBlock');
  const PrimitiveBlock = root.lookupType('OSMPBF.PrimitiveBlock');

  const Node = root.lookupType('OSMPBF.Node');
  const Way = root.lookupType('OSMPBF.Way');
  const Relation = root.lookupType('OSMPBF.Relation');

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
            nodes.push({
              id: Number(n.id),
              lat: toDeg(n.lat, latOff),
              lon: toDeg(n.lon, lonOff),
              tags: tags(n.keys, n.vals)
            });
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

  console.log(nodes[0]);
  console.log(ways[0]);
  console.log(relations[0]);
  console.log('Finished reading entire PBF');
}

main();
