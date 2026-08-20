/**
 * infer-layer.js
 * -------------------------------------------------------------------------
 * Runtime companion to compile-mml.py. Given a feature's raw OSM tags, infer
 * which project.mml layer(s)/id it belongs to, and derive the computed
 * attribute row (feature, int_*, ...) that the layer's Datasource SQL would
 * have produced -- so it can be fed straight into match-rule.js.
 *
 *   const I = require('./infer-layer.js');
 *   I.loadMml('./mml.json');
 *   I.inferLayers({ waterway: 'river' });
 *   // -> [ { id:'water-lines', feature:'waterway_river', row:{...} }, ... ]
 *
 * The compiled conditions come from a real PostgreSQL parse of each layer's
 * SQL (see compile-mml.py). This evaluator walks that expression tree.
 *
 * Semantics notes:
 *  - Tag/column access: both `highway` (osm2pgsql column) and `tags->'x'`
 *    (hstore) resolve to tags[name]; osm2pgsql promotes tags to columns.
 *  - Render-time / spatial terms (!bbox! -> __bbox__, way, way_area, etc.)
 *    cannot be evaluated from tags; predicates touching them are treated as
 *    PASS (they gate on the tile/zoom, not on tags).
 *  - Custom Postgres functions (carto_*) are looked up in `registry`; a few
 *    common ones are approximated, the rest return UNKNOWN (and are treated
 *    permissively in boolean context). Extend `registry` for exact results.
 */

'use strict';
const fs = require('fs');
const path = require('path');

let MML = null;

function loadMml(file = path.join(__dirname, 'mml.json')) {
  MML = JSON.parse(fs.readFileSync(file, 'utf8'));
  return MML;
}
function setMml(arr) {
  MML = arr;
  return MML;
}

/* Sentinel for "cannot be determined from tags" (render-time / spatial). */
const UNKNOWN = Symbol('UNKNOWN');
const RENDER_TOKENS = new Set(['__bbox__', '__pixel_width__', '__pixel_height__', '__scale_denominator__', 'way', 'way_area']);

/* Spatial / render-time predicates. These gate on the tile or geometry, never on tags, so in boolean context they must PASS. Nearly every layer's base Datasource WHERE is exactly `way && !bbox!` (compiled to ARRAYOVERLAPS), so excluding them would reject every layer. */
const SPATIAL_PREDICATES = new Set([
  'ARRAYOVERLAPS', // the `&&` operator: way && !bbox!
  'ST_INTERSECTS',
  'ST_DWITHIN',
  'ST_CONTAINS',
  'ST_WITHIN',
  'ST_COVERS',
  'ST_COVEREDBY',
  'ST_OVERLAPS',
  'ST_CROSSES',
  'ST_TOUCHES',
  'ST_DISJOINT',
  'ST_EQUALS',
  'ST_ISVALID',
  'ST_ISEMPTY',
  'ST_INTERSECTSBOX2DF'
]);

/** True if any part of this expression tree touches a render-time/spatial
 * token (way, way_area, !bbox!, !scale_denominator!, ...). Such a term cannot
 * be decided from tags, so it must be treated permissively. */
function touchesRenderToken(n) {
  if (n == null || typeof n !== 'object') return false;
  if (Array.isArray(n)) return n.some(touchesRenderToken);
  if (n.t === 'col' && RENDER_TOKENS.has(n.name)) return true;
  if (n.t === 'tag' && n.key != null && RENDER_TOKENS.has(n.key)) return true;
  for (const v of Object.values(n)) {
    if (v && typeof v === 'object' && touchesRenderToken(v)) return true;
  }
  return false;
}

/* ----------------------------------------------------------------------- */
/* Custom SQL function registry (extend for exact osm-carto behaviour)      */
/* ----------------------------------------------------------------------- */
/**
 * Postgres substr(string, from, count) / substring(string from x for y).
 *
 * The positions are 1-based and, crucially, positions below 1 are skipped but
 * still consume `count`. project.mml relies on exactly that quirk to strip the
 * '_link' suffix:
 *
 *   substr('primary_link', 0, length('primary_link') - 4)
 *     -> from = 0, count = 8, so it spans positions 0..7 and yields 'primary'
 *
 * Getting this wrong by treating `from` as 1-based returns 'primary_', which is
 * why these names have to be computed rather than approximated.
 */
function pgSubstring(str, from, count) {
  if (str === null || str === undefined) return null;

  const s = String(str);
  const start = Number(from);

  if (Number.isNaN(start)) return null;

  // Exclusive 1-based end position.
  const end = count === undefined || count === null ? s.length + 1 : start + Number(count);

  if (Number.isNaN(end)) return null;

  const lo = Math.max(1, start);
  const hi = Math.min(s.length + 1, end);

  if (hi <= lo) return '';

  return s.slice(lo - 1, hi - 1);
}

const registry = {
  // compile-mml.py names known functions after their sqlglot class, uppercased
  // (see its exp.Func branch), so `substr(...)` and `substring(...)` both
  // arrive here as SUBSTRING and are looked up lowercased.
  substring(str, from, count) {
    if (str === UNKNOWN || from === UNKNOWN || count === UNKNOWN) return UNKNOWN;

    // A two-argument node is ambiguous: sqlglot stores Substring as
    // (this, start, length), so `substring(x for 8)` and `substr(x, 8)`
    // both arrive as two arguments with no way to tell them apart. Refuse
    // rather than silently computing the wrong name.
    if (count === undefined) return UNKNOWN;

    return pgSubstring(norm(str), from, count);
  },
  length(str) {
    if (str === UNKNOWN) return UNKNOWN;

    const v = norm(str);

    return v === null ? null : v.length;
  },
  round(value, digits) {
    if (value === UNKNOWN || digits === UNKNOWN) return UNKNOWN;

    const n = Number(norm(value));

    if (Number.isNaN(n)) return null;

    const d = digits === undefined || digits === null ? 0 : Number(digits);
    const f = Math.pow(10, Number.isNaN(d) ? 0 : d);

    return Math.round(n * f) / f;
  },
  // Approximate: real definition lives in osm-carto functions.sql.
  carto_path_type(bicycle, horse) {
    const b = norm(bicycle),
      h = norm(horse);
    if (b === 'designated' && h !== 'designated') return 'cycleway';
    if (h === 'designated' && b !== 'designated') return 'bridleway';
    return 'path';
  },
  carto_highway_int_surface(surface) {
    const s = norm(surface);
    if (s == null) return null;
    const paved = new Set(['paved', 'asphalt', 'concrete', 'concrete:lanes', 'concrete:plates', 'paving_stones', 'sett', 'unhewn_cobblestone', 'cobblestone', 'metal', 'wood', 'stepping_stones', 'chipseal', 'bricks', 'paving_stones:lanes']);
    const unpaved = new Set(['unpaved', 'compacted', 'fine_gravel', 'gravel', 'gravel_turf', 'rock', 'pebblestone', 'ground', 'dirt', 'earth', 'grass', 'grass_paver', 'mud', 'sand', 'woodchips', 'snow', 'ice', 'salt', 'clay', 'tartan', 'artificial_turf', 'acrylic', 'carpet']);
    if (paved.has(s)) return 'paved';
    if (unpaved.has(s)) return 'unpaved';
    return null;
  }
};
function norm(v) {
  return v === UNKNOWN || v == null ? null : String(v);
}

/* -----------------------------------------------------------------------
 * hstore / array tag predicates (osm2pgsql). Their first argument is the
 * `tags` hstore column, so we evaluate them against the raw tag row directly
 * instead of the (undefined) evaluated `tags` value. These are what layer
 * Datasource WHEREs use to select niche features (e.g. roller coasters);
 * evaluating them exactly stops those layers from matching everything.
 * --------------------------------------------------------------------- */
const HSTORE_PREDICATES = new Set(['ARRAYCONTAINSALL', 'ARRAYCONTAINSANY', 'ARRAYCONTAINS']);
function parseHstoreLiteral(s) {
  // 'a=>x, b=>y' -> [['a','x'],['b','y']];  bare 'a' -> ['a', undefined] (key exists)
  return String(s)
    .split(',')
    .map((pair) => {
      const [k, v] = pair.split('=>');
      return [k.trim(), v === undefined ? undefined : v.trim()];
    });
}
function evalHstorePredicate(name, args, row) {
  const pairs = [];
  for (const a of args.slice(1)) {
    const v = a && a.t === 'lit' ? a.v : null;
    if (v == null) return UNKNOWN;
    for (const p of parseHstoreLiteral(v)) pairs.push(p);
  }
  if (!pairs.length) return UNKNOWN;
  const test = ([k, val]) => {
    const actual = row[k];
    if (val === undefined) return actual !== undefined && actual !== null && actual !== '';
    return actual != null && String(actual) === val;
  };
  return name === 'ARRAYCONTAINSANY' ? pairs.some(test) : pairs.every(test);
}

/* ----------------------------------------------------------------------- */
/* Expression evaluation                                                   */
/* ----------------------------------------------------------------------- */

function refValue(name, row) {
  if (RENDER_TOKENS.has(name)) return UNKNOWN;
  const v = row[name];
  return v === undefined ? null : v;
}

/** Evaluate a value-producing node -> JS value | null | UNKNOWN. */
function evalVal(n, row) {
  if (n == null) return null;
  switch (n.t) {
    case 'col':
      return refValue(n.name, row);
    case 'tag':
      return n.key == null ? UNKNOWN : refValue(n.key, row);
    case 'lit':
      return n.v === null ? null : n.s ? n.v : n.v;
    case 'cast':
      return evalVal(n.x, row);
    case 'has': {
      const v = row[n.key];
      return v !== undefined && v !== null && v !== '';
    }
    case 'coalesce': {
      for (const a of n.args) {
        const v = evalVal(a, row);
        if (v !== null && v !== UNKNOWN) return v;
      }
      return null;
    }
    case 'concat': {
      let out = '';
      for (const a of n.args) {
        const v = evalVal(a, row);
        // An undeterminable operand makes the whole concatenation
        // undeterminable. Skipping it instead would emit a truncated name such
        // as 'highway_' that no style rule can ever match, and applyColumns
        // would store that as if it were a real feature name.
        if (v === UNKNOWN) return UNKNOWN;
        if (v === null) return null; // SQL: NULL || x = NULL
        out += String(v);
      }
      return out;
    }
    case 'case': {
      for (const w of n.whens) {
        if (evalBool(w.cond, row) === true) return evalVal(w.then, row);
      }
      return n.else != null ? evalVal(n.else, row) : null;
    }
    case 'func': {
      const fname = (n.name || '').toUpperCase();
      if (HSTORE_PREDICATES.has(fname)) return evalHstorePredicate(fname, n.args, row);
      const fn = registry[(n.name || '').toLowerCase()] || registry[n.name];
      if (!fn) return UNKNOWN;
      const args = n.args.map((a) => evalVal(a, row));
      try {
        return fn(...args);
      } catch {
        return UNKNOWN;
      }
    }
    case 'arith': {
      const l = evalVal(n.l, row),
        r = evalVal(n.r, row);
      if (l === UNKNOWN || r === UNKNOWN) return UNKNOWN;
      const a = Number(l),
        b = Number(r);
      if (Number.isNaN(a) || Number.isNaN(b)) return null;
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : a / b;
    }
    case 'raw':
      return UNKNOWN;
    default:
      return UNKNOWN;
  }
}

/**
 * Evaluate a boolean node -> true | false.
 * Permissive: terms that resolve to UNKNOWN (render-time / spatial / unknown
 * functions) are treated as PASS so tag-based selection is not over-filtered.
 */
function evalBool(n, row) {
  if (n == null) return true;
  switch (n.t) {
    case 'and':
      return n.x.every((c) => evalBool(c, row));
    case 'or':
      return n.x.some((c) => evalBool(c, row));
    case 'not':
      return !evalBool(n.x, row);
    case 'isnull': {
      const v = evalVal(n.x, row);
      if (v === UNKNOWN) return false; // spatial cols are not null
      return v === null || v === '';
    }
    case 'in': {
      const l = evalVal(n.l, row);
      if (l === UNKNOWN) return true;
      if (l === null) return false;
      const set = n.vals.map((v) => evalVal(v, row));
      return set.some((v) => v !== UNKNOWN && v !== null && String(v) === String(l));
    }
    case 'regex': {
      const l = evalVal(n.l, row);
      if (l === UNKNOWN) return true;
      if (l === null) return false;
      const pat = evalVal(n.pat, row);
      if (pat === UNKNOWN || pat === null) return true;
      try {
        return new RegExp(String(pat)).test(String(l));
      } catch {
        return true;
      }
    }
    case 'cmp': {
      const l = evalVal(n.l, row),
        r = evalVal(n.r, row);
      if (l === UNKNOWN || r === UNKNOWN) return true; // render-time: pass
      if (l === null || r === null) return false; // NULL comparison
      switch (n.op) {
        case '=':
          return String(l) === String(r);
        case '!=':
          return String(l) !== String(r);
        default: {
          const a = Number(l),
            b = Number(r);
          if (Number.isNaN(a) || Number.isNaN(b)) return false;
          return n.op === '>' ? a > b : n.op === '>=' ? a >= b : n.op === '<' ? a < b : a <= b;
        }
      }
    }
    case 'func': {
      // Spatial / render-time predicates (way && !bbox!, ST_Intersects, ...)
      // gate on the tile, not on tags: PASS. Without this, the bbox predicate
      // that forms the entire base WHERE of most layers (notably every point
      // layer) would reject the feature and inferLayers would return [].
      const fname = (n.name || '').toUpperCase();
      if (SPATIAL_PREDICATES.has(fname) || touchesRenderToken(n)) return true;
      const v = evalVal(n, row);
      // An unknown FUNCTION predicate in a layer's WHERE almost always tests
      // tags to SELECT features (e.g. ARRAYCONTAINSALL, hstore ops). Treating
      // it as PASS makes the layer match everything -> cross-layer bleed
      // (tourism/roller-coaster painting over roads). Exclude instead.
      if (v === UNKNOWN) return false;
      return v === true || v === 'yes' || v === 't' || v === 'true';
    }
    case 'has':
      return evalVal(n, row) === true;
    case 'lit':
      return n.v === true;
    case 'raw':
      return true; // unparseable: pass
    default:
      return true;
  }
}

/* ----------------------------------------------------------------------- */
/* Column computation + layer inference                                     */
/* ----------------------------------------------------------------------- */

function applyColumns(columns, row) {
  if (!columns) return row;
  const next = { ...row };
  for (const [name, expr] of Object.entries(columns)) {
    const v = evalVal(expr, row);
    if (v !== UNKNOWN) next[name] = v === null ? null : v;
  }
  return next;
}

function geomMatches(layerGeom, want) {
  if (!want || !layerGeom) return true;
  const g = String(want).toLowerCase();
  const norm = g === 'line' ? 'linestring' : g === 'area' ? 'polygon' : g;
  return layerGeom === norm;
}

/**
 * Infer the layer(s) a feature belongs to from its tags.
 * @param {Object} tags   raw OSM attribute row
 * @param {Object} [opts] { geometry, zoom, mml }
 * @returns {Array<{id, feature, row}>}
 */
function inferLayers(tags, opts = {}) {
  const mml = opts.mml || MML || loadMml();
  const out = [];
  for (const layer of mml) {
    if (!layer.base || !layer.base.length) continue;
    if (!geomMatches(layer.geometry, opts.geometry)) continue;
    if (opts.zoom != null && (opts.zoom < layer.minzoom || opts.zoom > layer.maxzoom)) continue;

    for (const base of layer.base) {
      if (!evalBool(base.where, tags)) continue;
      let row = applyColumns(base.columns, tags);
      let ok = true;
      for (const w of layer.wrappers) {
        if (!evalBool(w.where, row)) {
          ok = false;
          break;
        }
        row = applyColumns(w.columns, row);
      }
      if (!ok) continue;
      out.push({ id: layer.id, feature: row.feature != null ? row.feature : null, row });
      break; // one match per layer is enough
    }
  }
  return out;
}

/**
 * Convenience: infer layers, then match style rules for each via match-rule.js.
 * @returns {Array<{layer, feature, ruleIndices}>}
 */
function inferAndMatch(tags, opts = {}) {
  const M = require('./match-rule.js');
  const layers = inferLayers(tags, opts);
  return layers.map(({ id, feature, row }) => ({
    layer: id,
    feature,
    ruleIndices: M.matchRules(row, id, opts.zoom)
  }));
}

module.exports = {
  loadMml,
  setMml,
  inferLayers,
  inferAndMatch,
  evalBool,
  evalVal,
  applyColumns,
  registry,
  UNKNOWN
};
