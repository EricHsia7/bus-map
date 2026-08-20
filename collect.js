#!/usr/bin/env node
//
// Unstyled feature collector.
//
// Reports features that no rule draws at ANY zoom. Three things differ from
// the first version:
//
//   1. Zoom ladder. inferLayers is itself zoom-aware, so probing only the
//      chunk zoom hides entire layers: at z12 the buildings layer never
//      appears, which made every building look unstyled.
//   2. tags and row are logged separately. matchRules is handed
//      { ...tags, ...layer.row }, so a merged record cannot tell you whether
//      a miss is a missing rule or a feature name you did not expect.
//   3. A feature is logged once, only if nothing matched anywhere. Verdicts
//      are per feature, not per inferred layer, so a road failing to match an
//      aerialway rule is no longer an entry.
//
// Output is one JSON record per distinct tag signature, not per feature, with
// an occurrence count. Memory stays proportional to the tag vocabulary.
//
// Usage:
//   node collect.js > unstyled.log
//   node collect.js --zooms 4,8,12,14,16,18,19 --summary summary.json
//   node collect.js --nodes --limit 4

const DEFAULT_ZOOMS = [4, 8, 10, 12, 13, 14, 15, 16, 17, 18, 19];

// Keys that steer inferLayers even when no style rule filters on them. The
// signature must include these or two features that resolve differently would
// share a cache entry.
const STRUCTURAL_KEYS = ['area', 'bridge', 'tunnel', 'covered', 'construction', 'proposed', 'link', 'layer', 'location', 'service', 'footway', 'access', 'intermittent', 'seasonal', 'disused', 'abandoned', 'building:part', 'admin_level', 'boundary', 'religion', 'denomination', 'oneway', 'is_building', 'indoor'];

const FEATURE_KEYS = ['aerialway', 'aeroway', 'amenity', 'attraction', 'barrier', 'boundary', 'building', 'craft', 'emergency', 'healthcare', 'highway', 'historic', 'landcover', 'landuse', 'leisure', 'man_made', 'military', 'natural', 'office', 'place', 'power', 'public_transport', 'railway', 'route', 'shop', 'sport', 'tourism', 'water', 'waterway', 'wetland'];

// ---------------------------------------------------------------------------
// Signature keys
//
// Every key any rule filters on, union the two lists above. Restricting the
// signature to these keys is what makes the cache effective: a name or an
// operator tag must not create a new signature.
// ---------------------------------------------------------------------------

function relevantKeys(style) {
  const keys = new Set([...FEATURE_KEYS, ...STRUCTURAL_KEYS, 'feature']);

  const rules = Array.isArray(style) ? style : style && style.rules ? style.rules : [];

  for (const rule of rules) {
    for (const group of rule.groups || []) {
      for (const clause of group.and || []) {
        if (clause && typeof clause.key === 'string') keys.add(clause.key);
      }
    }
  }

  return keys;
}

function signatureOf(tags, geometry, keys) {
  const parts = [];

  for (const key of Object.keys(tags)) {
    if (keys && !keys.has(key)) continue;

    parts.push(key + '=' + tags[key]);
  }

  parts.sort();

  return geometry + '|' + parts.join(',');
}

// ---------------------------------------------------------------------------
// Prober
//
// Answers one question per feature: does anything draw this, at any zoom, in
// any inferred layer.
// ---------------------------------------------------------------------------

function createProber(options) {
  const inferLayers = options.inferLayers;
  const matchRules = options.matchRules;
  const zooms = options.zooms || DEFAULT_ZOOMS;
  // Never default to "all tags": a name or an operator tag would then make
  // every feature a fresh signature and the cache would never hit.
  const keys = options.keys || relevantKeys([]);
  const cacheCap = options.cacheCap == null ? 200000 : options.cacheCap;
  const fullSignature = Boolean(options.fullSignature);

  const cache = new Map();

  const info = { hits: 0, misses: 0, capped: false, probes: 0 };

  function evaluate(tags, geometry) {
    // layerId -> { layer, row, zooms }
    const inferred = new Map();

    let styled = null;

    for (const zoom of zooms) {
      let layers;

      try {
        layers = inferLayers(tags, { geometry, zoom }) || [];
      } catch (err) {
        layers = [];
      }

      for (const layer of layers) {
        let entry = inferred.get(layer.id);

        if (!entry) {
          entry = { layer: layer.id, row: layer.row || {}, zooms: [] };

          inferred.set(layer.id, entry);
        }

        entry.zooms.push(zoom);

        if (styled) continue;

        info.probes++;

        let idxs;

        try {
          idxs = matchRules({ ...tags, ...layer.row }, layer.id, zoom);
        } catch (err) {
          idxs = null;
        }

        if (idxs && idxs.length > 0) {
          styled = { layer: layer.id, zoom, rules: idxs.length };
        }
      }

      // First hit is enough. We are asking whether the feature is drawn, not
      // cataloguing every rule that draws it.
      if (styled) break;
    }

    if (styled) return { styled: true, at: styled };

    const layerList = [...inferred.values()];

    return {
      styled: false,
      reason: layerList.length === 0 ? 'no inferred layer at any probed zoom' : 'inferred but no rule matched at any probed zoom',
      layers: layerList
    };
  }

  function probe(tags, geometry) {
    const signature = fullSignature ? signatureOf(tags, geometry, null) : signatureOf(tags, geometry, keys);

    const cached = cache.get(signature);

    if (cached) {
      info.hits++;

      return { signature, verdict: cached };
    }

    info.misses++;

    const verdict = evaluate(tags, geometry);

    if (cache.size < cacheCap) cache.set(signature, verdict);
    else info.capped = true;

    return { signature, verdict };
  }

  return { probe, info, cacheSize: () => cache.size };
}

// ---------------------------------------------------------------------------
// Collector
//
// Holds one entry per unstyled signature. Styled features are counted and
// dropped immediately, which is the whole point: they are the overwhelming
// majority.
// ---------------------------------------------------------------------------

function createCollector(prober, options) {
  const opts = options || {};

  const sampleCap = opts.sampleCap == null ? 3 : opts.sampleCap;

  const unstyled = new Map();

  // Only ever holds unstyled features. Deduping every feature in the extract
  // is what made the first attempt unbounded; unstyled ones are rare by
  // construction, so this set stays small.
  const seenIds = new Set();

  const stats = {
    features: 0,
    styled: 0,
    unstyled: 0,
    duplicates: 0,
    noLayer: 0,
    ways: 0,
    relations: 0,
    nodes: 0
  };

  function add(feature) {
    const tags = feature.tags || {};

    if (Object.keys(tags).length === 0) return null;

    stats.features++;

    if (feature.source === 'way') stats.ways++;
    else if (feature.source === 'relation') stats.relations++;
    else if (feature.source === 'node') stats.nodes++;

    const { signature, verdict } = prober.probe(tags, feature.geometry);

    if (verdict.styled) {
      stats.styled++;

      return null;
    }

    // Chunks overlap at their edges, so the same way can be handed to us more
    // than once.
    const idKey = feature.source + ':' + feature.id;

    if (feature.id != null && seenIds.has(idKey)) {
      stats.duplicates++;

      return null;
    }

    if (feature.id != null) seenIds.add(idKey);

    stats.unstyled++;

    if (verdict.layers.length === 0) stats.noLayer++;

    let entry = unstyled.get(signature);

    if (!entry) {
      entry = {
        signature,
        // The raw OSM tags, exactly as they came off the wire.
        tags,
        // What inferLayers derived and matchRules actually saw, per layer.
        // Kept separate from tags on purpose.
        row: verdict.layers.map((l) => ({ layer: l.layer, zooms: l.zooms.slice(0, 4), row: l.row })),
        reason: verdict.reason,
        geometry: feature.geometry,
        count: 0,
        samples: []
      };

      unstyled.set(signature, entry);
    }

    entry.count++;

    if (entry.samples.length < sampleCap) {
      entry.samples.push({ source: feature.source, id: feature.id });
    }

    return entry;
  }

  return { add, stats, unstyled, size: () => unstyled.size };
}

module.exports = {
  DEFAULT_ZOOMS,
  FEATURE_KEYS,
  STRUCTURAL_KEYS,
  relevantKeys,
  signatureOf,
  createProber,
  createCollector
};

// ===========================================================================
// Everything below runs only as a CLI. The requires are deliberately lazy so
// the logic above can be unit tested without protobufjs or a compiled style.
// ===========================================================================

function parseArgs(argv) {
  const o = {
    zooms: null,
    nodes: false,
    limit: null,
    parallel: 1,
    cacheCap: 200000,
    fullSignature: false,
    summary: null,
    minCount: 1,
    quiet: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--zooms')
      o.zooms = argv[++i]
        .split(',')
        .map((z) => Number(z.trim()))
        .filter((z) => Number.isFinite(z));
    else if (a === '--nodes') o.nodes = true;
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--parallel') o.parallel = Math.max(1, Number(argv[++i]));
    else if (a === '--cache-cap') o.cacheCap = Number(argv[++i]);
    else if (a === '--full-signature') o.fullSignature = true;
    else if (a === '--summary') o.summary = argv[++i];
    else if (a === '--min-count') o.minCount = Number(argv[++i]);
    else if (a === '--quiet') o.quiet = true;
    else if (a === '-h' || a === '--help') {
      console.error('node collect.js [--zooms 4,8,12,16,19] [--nodes] [--limit N] [--parallel N]');
      console.error('                 [--summary file.json] [--min-count N] [--full-signature]');
      console.error('');
      console.error('Writes one JSON record per unstyled tag signature to stdout.');
      process.exit(0);
    } else {
      console.error('unknown argument ' + a);
      process.exit(1);
    }
  }

  return o;
}

function loadDeps() {
  const protobuf = require('protobufjs');
  const fs = require('node:fs');
  const path = require('node:path');
  const { decompressSync } = require('fflate');

  const { areaToTiles, projectLatitude, projectLongitude } = require('./coordinate.js');
  const { assembleAreas } = require('./assemble.js');
  const style = require('./style.json');
  const mml = require('./mml.json');
  const M = require('./match-rule.js');
  const I = require('./infer-layer.js');
  const config = require('./config.json');

  M.loadStyle('./style.json');
  I.loadMml('./mml.json');

  return { protobuf, fs, path, decompressSync, areaToTiles, projectLatitude, projectLongitude, assembleAreas, style, mml, M, I, config };
}

async function loadFileformat(protobuf) {
  const root = await protobuf.load('./fileformat.proto');

  return {
    BlobHeaderType: root.lookupType('OSMPBF.BlobHeader'),
    BlobType: root.lookupType('OSMPBF.Blob'),
    HeaderBlock: root.lookupType('OSMPBF.HeaderBlock'),
    PrimitiveBlock: root.lookupType('OSMPBF.PrimitiveBlock')
  };
}

// Unchanged from render.js apart from dropping everything the renderer needs
// for drawing. One chunk is resident at a time.

async function parseChunk(deps, cX, cY, cZ, fileformat) {
  const { fs, path, decompressSync, projectLatitude, projectLongitude, config } = deps;

  const file = path.join(config.chunks.dir, `${cZ}_${cX}_${cY}.osm.pbf`);

  if (!fs.existsSync(file)) return null;

  const buf = fs.readFileSync(file);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const { BlobHeaderType, BlobType, HeaderBlock, PrimitiveBlock } = fileformat;

  const nodeMap = new Map();
  const nodes = [];
  const ways = [];
  const relations = [];

  let offset = 0;

  while (offset < buf.length) {
    if (offset + 4 > buf.length) break;

    const headerLength = view.getInt32(offset, false);
    offset += 4;

    if (offset + headerLength > buf.length) break;

    const blobHeader = BlobHeaderType.decode(buf.subarray(offset, offset + headerLength));
    offset += headerLength;

    const blobSize = blobHeader.datasize;

    if (offset + blobSize > buf.length) break;

    const blob = BlobType.decode(buf.subarray(offset, offset + blobSize));
    offset += blobSize;

    let data;

    try {
      if (blob.zlibData) data = decompressSync(blob.zlibData);
      else if (blob.raw) data = blob.raw;
      else continue;
    } catch (err) {
      console.error('inflate failed:', err);
      continue;
    }

    if (blobHeader.type === 'OSMHeader') {
      HeaderBlock.decode(data);
      continue;
    }

    if (blobHeader.type !== 'OSMData') continue;

    const block = PrimitiveBlock.decode(data);

    const gran = block.granularity ?? 100;
    const latOff = Number(block.lat_offset ?? 0);
    const lonOff = Number(block.lon_offset ?? 0);

    const st = block.stringtable.s.map((b) => Buffer.from(b).toString('utf8'));

    const toDeg = (value, off) => (off + gran * Number(value)) / 1e9;

    const tagsOf = (keys, vals) => Object.fromEntries(keys.map((key, i) => [st[key], st[vals[i]]]));

    for (const group of block.primitivegroup) {
      for (const n of group.nodes) {
        const id = Number(n.id);
        const lon = projectLongitude(toDeg(n.lon, lonOff));
        const lat = projectLatitude(toDeg(n.lat, latOff));
        const t = tagsOf(n.keys, n.vals);

        if (Object.keys(t).length > 0) nodes.push({ id, lon, lat, tags: t });

        nodeMap.set(id, [lon, lat]);
      }

      if (group.dense) {
        const d = group.dense;

        let id = 0;
        let lat = 0;
        let lon = 0;
        let kv = 0;

        for (let i = 0; i < d.id.length; i++) {
          id += Number(d.id[i]);
          lat += Number(d.lat[i]);
          lon += Number(d.lon[i]);

          const t = {};

          while (d.keysVals.length && d.keysVals[kv] !== 0) {
            const k = d.keysVals[kv++];
            const v = d.keysVals[kv++];

            t[st[k]] = st[v];
          }

          kv++;

          const longitude = projectLongitude(toDeg(lon, lonOff));
          const latitude = projectLatitude(toDeg(lat, latOff));

          if (Object.keys(t).length > 0) nodes.push({ id, lon: longitude, lat: latitude, tags: t });

          nodeMap.set(id, [longitude, latitude]);
        }
      }

      for (const w of group.ways) {
        let ref = 0;

        ways.push({
          id: Number(w.id),
          refs: w.refs.map((r) => (ref += Number(r))),
          tags: tagsOf(w.keys, w.vals)
        });
      }

      for (const r of group.relations) {
        let mid = 0;

        relations.push({
          id: Number(r.id),
          members: r.memids.map((m, i) => ({
            type: ['node', 'way', 'relation'][r.types[i]],
            ref: (mid += Number(m)),
            role: st[r.rolesSid[i]]
          })),
          tags: tagsOf(r.keys, r.vals)
        });
      }
    }
  }

  return { nodeMap, nodes, ways, relations };
}

async function collectChunk(deps, collector, cX, cY, cZ, fileformat, opts) {
  const chunk = await parseChunk(deps, cX, cY, cZ, fileformat);

  if (!chunk) return false;

  const { ways, relations, nodes, nodeMap } = chunk;

  const wayMap = new Map();

  for (let i = ways.length - 1; i >= 0; i--) wayMap.set(ways[i].id, i);

  const { features: areaFeatures, memberWayIds } = deps.assembleAreas(relations, ways, wayMap, nodeMap);

  for (const way of ways) {
    if (memberWayIds.has(way.id)) continue;

    const closed = way.refs.length > 1 && way.refs[0] === way.refs.at(-1);

    collector.add({
      source: 'way',
      id: way.id,
      tags: way.tags,
      geometry: closed ? 'polygon' : 'linestring'
    });
  }

  for (const feature of areaFeatures) {
    collector.add({
      source: 'relation',
      id: feature.id,
      tags: feature.tags,
      geometry: 'polygon'
    });
  }

  // Off by default. Point styling does not depend on draw order, but a node
  // whose tags no rule matches is still a hole in the map, so it is available.
  if (opts.nodes) {
    for (const node of nodes) {
      collector.add({
        source: 'node',
        id: node.id,
        tags: node.tags,
        geometry: 'point'
      });
    }
  }

  return true;
}

function splitByLength(array, length = 3) {
  const groups = [];
  const quantity = Math.ceil(array.length / length);

  for (let i = 0; i < quantity; i++) groups.push(array.slice(i * length, i * length + length));

  return groups;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const deps = loadDeps();

  const fileformat = await loadFileformat(deps.protobuf);

  const zooms = opts.zooms && opts.zooms.length ? opts.zooms.slice().sort((a, b) => a - b) : DEFAULT_ZOOMS;

  const prober = createProber({
    inferLayers: (tags, o) => deps.I.inferLayers(tags, o),
    matchRules: (row, layerId, zoom) => deps.M.matchRules(row, layerId, zoom),
    zooms,
    keys: relevantKeys(deps.style),
    cacheCap: opts.cacheCap,
    fullSignature: opts.fullSignature
  });

  const collector = createCollector(prober, {});

  const { west, south, east, north } = deps.config.bbox;

  const baseZ = deps.config.chunks.baseZ;

  let chunkTiles = deps.areaToTiles(west, south, east, north, baseZ);

  if (opts.limit) chunkTiles = chunkTiles.slice(0, opts.limit);

  const started = Date.now();

  let processed = 0;
  let missing = 0;

  // Sequential by default. render.js can afford four chunks at once because it
  // is waiting on rasterize; here that would just multiply peak memory.
  for (const group of splitByLength(chunkTiles, opts.parallel)) {
    const results = await Promise.allSettled(group.map((tile) => collectChunk(deps, collector, tile[0], tile[1], baseZ, fileformat, opts)));

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value === false) missing++;
      else if (r.status === 'rejected') console.error('chunk failed:', r.reason);
    }

    processed += group.length;

    if (!opts.quiet) {
      const rss = Math.round(process.memoryUsage().rss / 1048576);

      console.error(`[${processed}/${chunkTiles.length}] features=${collector.stats.features} unstyled=${collector.size()} cache=${prober.cacheSize()} rss=${rss}MB`);
    }
  }

  const rows = [...collector.unstyled.values()].filter((entry) => entry.count >= opts.minCount).sort((a, b) => b.count - a.count);

  for (const entry of rows) {
    console.log(
      JSON.stringify({
        reason: entry.reason,
        geometry: entry.geometry,
        count: entry.count,
        tags: entry.tags,
        row: entry.row,
        samples: entry.samples
      })
    );
  }

  const summary = {
    generated: new Date().toISOString(),
    zooms,
    chunks: { processed: processed - missing, missing, listed: chunkTiles.length },
    stats: collector.stats,
    signatures: collector.size(),
    reported: rows.length,
    cache: { size: prober.cacheSize(), hits: prober.info.hits, misses: prober.info.misses, probes: prober.info.probes, capped: prober.info.capped },
    peakRssMb: Math.round(process.memoryUsage().rss / 1048576),
    elapsedSec: Math.round((Date.now() - started) / 1000)
  };

  if (opts.summary) require('node:fs').writeFileSync(opts.summary, JSON.stringify(summary, null, 2));

  if (!opts.quiet) {
    console.error('');
    console.error('features        ' + collector.stats.features);
    console.error('styled          ' + collector.stats.styled);
    console.error('unstyled        ' + collector.stats.unstyled + ' (' + collector.size() + ' distinct signatures)');
    console.error('  no layer      ' + collector.stats.noLayer);
    console.error('rule probes     ' + prober.info.probes + ' (cache ' + prober.info.hits + ' hit / ' + prober.info.misses + ' miss)');
    console.error('peak rss        ' + summary.peakRssMb + 'MB');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
