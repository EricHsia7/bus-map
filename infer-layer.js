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

const fs = require('fs');
const path = require('path');

let MML = null;

function loadMml(file = path.join(__dirname, 'mml.json')) {
  MML = JSON.parse(fs.readFileSync(file, 'utf8'));
  return MML;
}
function setMml(arr) { MML = arr; return MML; }

/* Sentinel for "cannot be determined from tags" (render-time / spatial). */
const UNKNOWN = Symbol('UNKNOWN');
const RENDER_TOKENS = new Set([
  '__bbox__', '__pixel_width__', '__pixel_height__', '__scale_denominator__',
  'way', 'way_area',
]);

/* ----------------------------------------------------------------------- */
/* Custom SQL function registry (extend for exact osm-carto behaviour)      */
/* ----------------------------------------------------------------------- */
const registry = {
  // Approximate: real definition lives in osm-carto functions.sql.
  carto_path_type(bicycle, horse) {
    const b = norm(bicycle), h = norm(horse);
    if (b === 'designated' && h !== 'designated') return 'cycleway';
    if (h === 'designated' && b !== 'designated') return 'bridleway';
    return 'path';
  },
  carto_highway_int_surface(surface) {
    const s = norm(surface);
    if (s == null) return null;
    const paved = new Set(['paved', 'asphalt', 'concrete', 'concrete:lanes', 'concrete:plates',
      'paving_stones', 'sett', 'unhewn_cobblestone', 'cobblestone', 'metal', 'wood', 'stepping_stones',
      'chipseal', 'bricks', 'paving_stones:lanes']);
    const unpaved = new Set(['unpaved', 'compacted', 'fine_gravel', 'gravel', 'gravel_turf', 'rock',
      'pebblestone', 'ground', 'dirt', 'earth', 'grass', 'grass_paver', 'mud', 'sand', 'woodchips',
      'snow', 'ice', 'salt', 'clay', 'tartan', 'artificial_turf', 'acrylic', 'carpet']);
    if (paved.has(s)) return 'paved';
    if (unpaved.has(s)) return 'unpaved';
    return null;
  },
};
function norm(v) { return v === UNKNOWN || v == null ? null : String(v); }

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
    case 'col': return refValue(n.name, row);
    case 'tag': return n.key == null ? UNKNOWN : refValue(n.key, row);
    case 'lit': return n.v === null ? null : (n.s ? n.v : n.v);
    case 'cast': return evalVal(n.x, row);
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
      let sawUnknown = false;
      for (const a of n.args) {
        const v = evalVal(a, row);
        if (v === UNKNOWN) { sawUnknown = true; continue; }
        if (v === null) return null;        // SQL: NULL || x = NULL
        out += String(v);
      }
      return sawUnknown && out === '' ? UNKNOWN : out;
    }
    case 'case': {
      for (const w of n.whens) {
        if (evalBool(w.cond, row) === true) return evalVal(w.then, row);
      }
      return n.else != null ? evalVal(n.else, row) : null;
    }
    case 'func': {
      const fn = registry[(n.name || '').toLowerCase()] || registry[n.name];
      if (!fn) return UNKNOWN;
      const args = n.args.map((a) => evalVal(a, row));
      try { return fn(...args); } catch { return UNKNOWN; }
    }
    case 'arith': {
      const l = evalVal(n.l, row), r = evalVal(n.r, row);
      if (l === UNKNOWN || r === UNKNOWN) return UNKNOWN;
      const a = Number(l), b = Number(r);
      if (Number.isNaN(a) || Number.isNaN(b)) return null;
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : a / b;
    }
    case 'raw': return UNKNOWN;
    default: return UNKNOWN;
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
    case 'and': return n.x.every((c) => evalBool(c, row));
    case 'or': return n.x.some((c) => evalBool(c, row));
    case 'not': return !evalBool(n.x, row);
    case 'isnull': {
      const v = evalVal(n.x, row);
      if (v === UNKNOWN) return false;          // spatial cols are not null
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
      try { return new RegExp(String(pat)).test(String(l)); } catch { return true; }
    }
    case 'cmp': {
      const l = evalVal(n.l, row), r = evalVal(n.r, row);
      if (l === UNKNOWN || r === UNKNOWN) return true;   // render-time: pass
      if (l === null || r === null) return false;        // NULL comparison
      switch (n.op) {
        case '=': return String(l) === String(r);
        case '!=': return String(l) !== String(r);
        default: {
          const a = Number(l), b = Number(r);
          if (Number.isNaN(a) || Number.isNaN(b)) return false;
          return n.op === '>' ? a > b : n.op === '>=' ? a >= b : n.op === '<' ? a < b : a <= b;
        }
      }
    }
    case 'func': {
      const v = evalVal(n, row);
      if (v === UNKNOWN) return true;                    // unknown predicate: pass
      return v === true || v === 'yes' || v === 't' || v === 'true';
    }
    case 'has': return evalVal(n, row) === true;
    case 'lit': return n.v === true;
    case 'raw': return true;                             // unparseable: pass
    default: return true;
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
        if (!evalBool(w.where, row)) { ok = false; break; }
        row = applyColumns(w.columns, row);
      }
      if (!ok) continue;
      out.push({ id: layer.id, feature: row.feature != null ? row.feature : null, row });
      break; // one match per layer is enough
    }
  }
  return out;
}


module.exports = {
  loadMml, setMml, inferLayers,
  evalBool, evalVal, applyColumns, registry, UNKNOWN,
};
