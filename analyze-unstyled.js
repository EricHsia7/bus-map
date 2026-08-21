#!/usr/bin/env node
// Aggregate a collect.js unstyled log into a per-tag report.
//
// The log is one JSON record per (feature, unmatched inferred layer), which is
// far too granular to read. This collapses it to one row per key=value, and
// joins against the .less sources so that a tag which is simply not styled at
// the probe zoom can be told apart from a tag no rule mentions at all.
//
// Usage:
//   node analyze-unstyled.js --log unstyled1.log --style ../style/style [--top 60]
//     [--json out.json] [--csv out.csv] [--bucket no-layer|no-rule|all]

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const FEATURE_KEYS = ['aerialway', 'aeroway', 'amenity', 'attraction', 'barrier', 'boundary', 'building', 'craft', 'emergency', 'healthcare', 'highway', 'historic', 'landcover', 'landuse', 'leisure', 'man_made', 'military', 'natural', 'office', 'place', 'power', 'public_transport', 'railway', 'route', 'shop', 'sport', 'tourism', 'water', 'waterway', 'wetland'];

const IGNORE_VALUES = new Set(['yes', 'no', 'true', 'false', 'unknown']);

// Metadata keys that describe a feature rather than being one. They can never
// be styled on their own and would otherwise dominate the report.
const NOISE_KEYS = new Set(['name', 'alt_name', 'old_name', 'loc_name', 'short_name', 'official_name', 'nat_name', 'reg_name', 'source', 'level', 'layer', 'ele', 'ref', 'operator', 'brand', 'phone', 'website', 'opening_hours', 'wikidata', 'wikipedia', 'note', 'fixme', 'created_by', 'description', 'height', 'min_height', 'width', 'est_width', 'lanes', 'maxspeed', 'surface', 'start_date', 'material', 'colour', 'indoor', 'entrance', 'access', 'covered', 'location', 'support', 'direction', 'toll', 'lit', 'oneway', 'par', 'handicap', 'stairs', 'room', 'area', 'label', 'population', 'destination', 'network', 'route_ref', 'advertising']);

// Lifecycle prefixes describe a feature's state, not the feature. A tag like
// abandoned:aeroway=taxiway or was:building=office can never be styled, and
// left unfiltered these dominate the tail of the report.
const LIFECYCLE_PREFIXES = ['abandoned:', 'was:', 'disused:', 'demolished:', 'razed:', 'removed:', 'destroyed:', 'former:', 'proposed:', 'planned:', 'construction:', 'not:'];

function isNoiseKey(key) {
  if (NOISE_KEYS.has(key)) return true;

  for (const prefix of LIFECYCLE_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }

  // Namespaced variants of a key we already ignore, plus free-text and
  // dimension tags that are never selectors.
  const stem = key.split(':', 1)[0];

  if (NOISE_KEYS.has(stem)) return true;

  return key.startsWith('name:') || key.startsWith('addr:') || key.startsWith('building:') || key.startsWith('roof:') || key.startsWith('seamark:');
}

function fail(msg) {
  console.error('error: ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const o = { log: null, style: [], top: 60, json: null, csv: null, bucket: 'all', minCount: 1 };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--log') o.log = argv[++i];
    else if (a === '--style') o.style.push(argv[++i]);
    else if (a === '--top') o.top = Number(argv[++i]);
    else if (a === '--json') o.json = argv[++i];
    else if (a === '--csv') o.csv = argv[++i];
    else if (a === '--bucket') o.bucket = argv[++i];
    else if (a === '--min-count') o.minCount = Number(argv[++i]);
    else if (a === '-h' || a === '--help') {
      console.log('node analyze-unstyled.js --log <file> [--style <dir|file>]... [--top N] [--json f] [--csv f]');
      process.exit(0);
    } else fail('unknown argument ' + a);
  }

  if (!o.log) fail('--log is required');

  return o;
}

// ---------------------------------------------------------------------------
// Stylesheet index
//
// We only need a yes/no: is there any rule text that mentions this feature
// name, and is that text live or commented out. Full rule semantics are the
// collector's job, not ours.
// ---------------------------------------------------------------------------

function listLess(targets) {
  const files = [];

  for (const t of targets) {
    let st;

    try {
      st = fs.statSync(t);
    } catch (err) {
      fail('cannot read ' + t);
    }

    if (st.isDirectory()) {
      for (const name of fs.readdirSync(t).sort()) {
        if (name.endsWith('.less') || name.endsWith('.mss')) files.push(path.join(t, name));
      }
    } else {
      files.push(t);
    }
  }

  return files;
}

const PAIR_RE = /\[\s*([A-Za-z_][\w:]*)\s*=\s*'([^']*)'\s*\]/g;

function buildStyleIndex(targets) {
  const live = new Map();
  const dead = new Map();
  const layers = new Set();

  for (const file of listLess(targets)) {
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n');

    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let commented = false;

      if (inBlockComment) {
        commented = true;

        if (line.includes('*/')) inBlockComment = false;
      } else if (/^\s*\/\*/.test(line)) {
        commented = true;

        if (!line.includes('*/')) inBlockComment = true;
      } else if (/^\s*\/\//.test(line)) {
        commented = true;
      }

      // Layer selectors, so that a key styled generically by a whole layer
      // (buildings, for one) is not reported as unstyled just because no rule
      // names the individual value.
      if (!commented) {
        const lm = line.match(/^\s*#([A-Za-z][\w-]*)/);

        if (lm) layers.add(lm[1]);
      }

      PAIR_RE.lastIndex = 0;

      let m;

      while ((m = PAIR_RE.exec(line)) !== null) {
        const value = m[2];
        const target = commented ? dead : live;
        const site = path.basename(file) + ':' + (i + 1);

        if (!target.has(value)) target.set(value, []);

        const sites = target.get(value);

        if (sites.length < 4 && !sites.includes(site)) sites.push(site);
      }
    }
  }

  return { live, dead, layers };
}

module.exports = { buildStyleIndex, parseArgs, FEATURE_KEYS, IGNORE_VALUES, fail };

// ---------------------------------------------------------------------------
// Log aggregation
// ---------------------------------------------------------------------------

function pairsOf(tags) {
  const out = [];

  for (const key of FEATURE_KEYS) {
    const value = tags[key];

    if (typeof value !== 'string' || value === '') continue;
    if (IGNORE_VALUES.has(value)) continue;

    out.push(key + '=' + value);
  }

  // Fall back to the whole tag set so that records with no recognised feature
  // key are still visible rather than silently dropped.
  if (out.length === 0) {
    for (const key of Object.keys(tags)) {
      if (isNoiseKey(key)) continue;

      out.push(key + '=' + tags[key]);

      if (out.length >= 2) break;
    }
  }

  return out;
}

async function aggregate(opts) {
  const rows = new Map();

  const stats = {
    records: 0,
    malformed: 0,
    noLayer: 0,
    noRule: 0,
    features: 0,
    // collect2.js emits one record per tag signature carrying a count, and it
    // has already scanned the whole zoom ladder. Both change how the numbers
    // must be read, so detect it rather than assuming the old format.
    fullScan: false,
    zooms: new Map(),
    layers: new Map(),
    ids: new Set()
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(opts.log, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line) continue;

    let rec;

    try {
      rec = JSON.parse(line);
    } catch (err) {
      stats.malformed++;
      continue;
    }

    stats.records++;

    const noLayer = typeof rec.reason === 'string' && rec.reason.startsWith('no inferred layer');

    if (noLayer) stats.noLayer++;
    else stats.noRule++;

    // One signature record stands for `count` features on the ground.
    const weight = Number.isFinite(rec.count) && rec.count > 0 ? rec.count : 1;

    if (rec.count != null) stats.fullScan = true;

    stats.features += weight;

    if (rec.zoom != null) stats.zooms.set(rec.zoom, (stats.zooms.get(rec.zoom) || 0) + 1);

    // Old format: one layer per record. New format: an array of every layer
    // the feature was inferred into, each with the row matchRules saw.
    const layerEntries = Array.isArray(rec.row) ? rec.row.map((r) => r.layer || '<none>') : [rec.layer === null || rec.layer === undefined ? '<none>' : rec.layer];

    const derived = [];

    if (Array.isArray(rec.row)) {
      for (const r of rec.row) {
        const name = r && r.row && r.row.feature;

        if (typeof name === 'string' && name !== '') derived.push(name);
      }
    }

    for (const layerKey of layerEntries) {
      stats.layers.set(layerKey, (stats.layers.get(layerKey) || 0) + weight);
    }

    if (opts.bucket === 'no-layer' && !noLayer) continue;
    if (opts.bucket === 'no-rule' && noLayer) continue;

    const tags = rec.tags || {};

    for (const pair of pairsOf(tags)) {
      let row = rows.get(pair);

      if (!row) {
        row = {
          pair,
          key: pair.slice(0, pair.indexOf('=')),
          value: pair.slice(pair.indexOf('=') + 1),
          records: 0,
          weight: 0,
          noLayer: 0,
          noRule: 0,
          polygons: 0,
          lines: 0,
          relations: 0,
          ids: new Set(),
          derived: new Set(),
          layers: new Map()
        };

        rows.set(pair, row);
      }

      row.records++;
      row.weight += weight;

      if (noLayer) row.noLayer += weight;
      else row.noRule += weight;

      if (rec.geometry === 'polygon') row.polygons += weight;
      else if (rec.geometry === 'linestring') row.lines += weight;

      if (rec.source === 'relation') row.relations += weight;

      // Old format only: one way logs once per unmatched layer, so the record
      // count overstates how much of the map is affected.
      if (rec.id != null && row.ids.size < 200000) row.ids.add(rec.source + ':' + rec.id);

      for (const name of derived) {
        if (row.derived.size < 8) row.derived.add(name);
      }

      for (const layerKey of layerEntries) {
        row.layers.set(layerKey, (row.layers.get(layerKey) || 0) + weight);
      }
    }
  }

  return { rows, stats };
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

function verdict(row, index, fullScan) {
  // The collector filters on the mml-derived feature name, so that is the join
  // key back into the stylesheets.
  const featureName = row.key + '_' + row.value;

  // Join strictly on the composed feature name. Falling back to the bare
  // value is wrong: it makes building=residential look styled because
  // highway=residential is, which is a different feature entirely.
  const liveSites = index.live.get(featureName) || null;
  const deadSites = index.dead.get(featureName) || null;

  const genericLayer = index.layers.has(row.key) || index.layers.has(row.key + 's') || index.layers.has(row.key + '-area') ? row.key : null;

  if (liveSites && fullScan) {
    // The collector already tried every zoom, so this is not a zoom artifact.
    // The name is in the stylesheet and the pipeline still never matched it:
    // either the rule targets another geometry or another filter excludes it.
    return {
      status: 'never-matched',
      why: 'named at ' + liveSites.join(', ') + ' yet never matched at any zoom - check geometry or extra filters',
      sites: liveSites
    };
  }

  if (liveSites) {
    return {
      status: 'zoom-gated',
      why: 'styled at ' + liveSites.join(', ') + ' but no rule applies at the probe zoom',
      sites: liveSites
    };
  }

  if (deadSites) {
    return {
      status: 'commented-out',
      why: 'only rule is commented out at ' + deadSites.join(', '),
      sites: deadSites
    };
  }

  if (genericLayer) {
    return {
      status: 'key-generic',
      why: 'layer #' + genericLayer + ' styles this key without filtering on the value',
      sites: []
    };
  }

  if (row.noLayer === row.records) {
    // inferLayers is zoom-aware, so this can also mean the layer itself is not
    // active at the probe zoom. Only trustworthy if several zooms were probed.
    return { status: 'no-layer', why: 'no inferred layer at the probe zoom: mml maps nothing here', sites: [] };
  }

  return { status: 'unstyled', why: 'no rule text mentions this feature', sites: [] };
}

function pad(text, width) {
  const s = String(text);

  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padLeft(text, width) {
  const s = String(text);

  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const index = opts.style.length ? buildStyleIndex(opts.style) : { live: new Map(), dead: new Map() };

  aggregate(opts)
    .then(({ rows, stats }) => {
      const all = [...rows.values()].map((row) => {
        const v = verdict(row, index, stats.fullScan);

        return {
          tag: row.pair,
          status: v.status,
          why: v.why,
          sites: v.sites,
          derived: [...row.derived],
          records: row.records,
          // Per-signature logs carry their own count; per-feature logs need
          // distinct ids. Using ids.size on a signature log reports 1 for
          // everything, which is how this bug announced itself.
          features: stats.fullScan ? row.weight : row.ids.size,
          polygons: row.polygons,
          lines: row.lines,
          relations: row.relations,
          noLayer: row.noLayer,
          noRule: row.noRule,
          layers: [...row.layers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0])
        };
      });

      all.sort((a, b) => b.features - a.features || a.tag.localeCompare(b.tag));

      const kept = all.filter((r) => r.features >= opts.minCount);

      const zoomList = [...stats.zooms.entries()].sort((a, b) => b[1] - a[1]);

      console.log('LOG SUMMARY');
      console.log('  records            ' + stats.records.toLocaleString());
      console.log('  features           ' + stats.features.toLocaleString());
      console.log('  no inferred layer  ' + stats.noLayer.toLocaleString());
      console.log('  no matching rule   ' + stats.noRule.toLocaleString());
      console.log('  distinct tags      ' + rows.size.toLocaleString());
      console.log('  probe zooms        ' + zoomList.map((e) => e[0] + ' (' + e[1].toLocaleString() + ')').join(', '));

      if (stats.malformed) console.log('  malformed lines    ' + stats.malformed.toLocaleString());

      if (stats.fullScan) {
        console.log('');
        console.log('  Input is a full-zoom signature log. Counts are feature counts taken');
        console.log('  from each record, and a tag named in the stylesheet that still never');
        console.log('  matched is reported as never-matched rather than zoom-gated.');
      } else if (zoomList.length === 1) {
        console.log('');
        console.log('  WARNING: every record was probed at a single zoom (' + zoomList[0][0] + ').');
        console.log('  A feature whose rules start above that zoom is reported unmatched even');
        console.log('  though it is styled. Those rows are marked zoom-gated below.');
      }

      const byStatus = new Map();

      for (const r of kept) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);

      console.log('');
      console.log('  tags by verdict    ' + [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0] + ' ' + e[1]).join(', '));

      const sections = [
        ['UNSTYLED - polygons and lines, nothing in the stylesheets', (r) => r.status === 'unstyled'],
        ['NEVER MATCHED - the name is in the stylesheet but the pipeline never used it', (r) => r.status === 'never-matched'],
        ['COMMENTED OUT - rule exists but is disabled', (r) => r.status === 'commented-out'],
        ['NO INFERRED LAYER - mml produced no layer at the probe zoom', (r) => r.status === 'no-layer'],
        ['KEY STYLED GENERICALLY - a whole layer covers the key, value not filtered', (r) => r.status === 'key-generic'],
        ['ZOOM-GATED - styled elsewhere, absent only at the probe zoom (expected noise)', (r) => r.status === 'zoom-gated']
      ];

      for (const [title, pred] of sections) {
        const list = kept.filter(pred).slice(0, opts.top);

        console.log('');
        console.log('=== ' + title + ' ===');

        if (!list.length) {
          console.log('  (none)');
          continue;
        }

        console.log('  ' + pad('tag', 42) + padLeft('features', 9) + padLeft('poly', 8) + padLeft('line', 8) + '  why');

        for (const r of list) {
          console.log('  ' + pad(r.tag, 42) + padLeft(r.features.toLocaleString(), 9) + padLeft(r.polygons.toLocaleString(), 8) + padLeft(r.lines.toLocaleString(), 8) + '  ' + r.why);
        }
      }

      console.log('');
      console.log('=== NOISIEST LAYERS (records) ===');

      for (const [layer, count] of [...stats.layers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
        console.log('  ' + pad(layer, 30) + padLeft(count.toLocaleString(), 10));
      }

      if (opts.json) {
        fs.writeFileSync(opts.json, JSON.stringify({ generated: new Date().toISOString(), log: opts.log, stats: { records: stats.records, noLayer: stats.noLayer, noRule: stats.noRule, zooms: zoomList }, rows: kept }, null, 2));

        console.log('');
        console.log('wrote ' + opts.json);
      }

      if (opts.csv) {
        const out = ['tag,status,features,records,polygons,lines,relations,derived,why,sites'];

        for (const r of kept) {
          const cells = [r.tag, r.status, r.features, r.records, r.polygons, r.lines, r.relations, r.derived.join(' '), r.why, r.sites.join(' ')];

          out.push(cells.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(','));
        }

        fs.writeFileSync(opts.csv, out.join('\n') + '\n');

        console.log('wrote ' + opts.csv);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}

if (require.main === module) main();
