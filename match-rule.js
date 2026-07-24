/**
 * match-rule.js
 * -------------------------------------------------------------------------
 * Match an OSM feature against the compiled CartoCSS rules (style.json) and
 * return the index (or indices) of the rule(s) that apply.
 *
 *   input : tags   -> the feature's attribute row (see "About `tags`" below)
 *           style  -> the layer / style id (e.g. "roads-casing"); null = any
 *           zoom   -> integer zoom level; null = any
 *   output: rule index into the style.json array (matchRule), or
 *           all matching indices in paint order (matchRules)
 *
 * ------------------------------------------------------------------------
 * How the pieces fit together
 * ------------------------------------------------------------------------
 *  1. All *.mss stylesheets are concatenated into a single MSS.
 *  2. roads.mss is one representative example of those stylesheets.
 *  3. project.mml is the "tag mapping": each Layer's Datasource SQL turns raw
 *     OSM tags into the columns the MSS filters test (e.g. `feature`,
 *     `int_surface`, `way_pixels`). `feature` is the COALESCE'd
 *     "<category>_<value>" string, e.g. highway=primary -> "highway_primary".
 *  4. style.json is the compiled MSS (output of compile-carto.js).
 *
 * ------------------------------------------------------------------------
 * AND / OR rule shape (new compile-carto.js output)
 * ------------------------------------------------------------------------
 * Each compiled rule is:
 *   {
 *     groups: [                       // OR  -> rule matches if ANY group does
 *       { layer, zoom:{min,max}, and:[ {key,op,value}, ... ] }  // AND
 *     ],
 *     paint: {...}
 *   }
 * A group matches when its layer == style, zoom is in [min,max], and EVERY
 * filter in `and` matches. The rule matches when ANY group matches.
 *
 * For backward compatibility this matcher also accepts the OLD lossy shape
 * ({ layer, zoom, filters:[...] }) and reconstructs OR-groups heuristically.
 *
 * ------------------------------------------------------------------------
 * About `tags`
 * ------------------------------------------------------------------------
 * `tags` is the attribute row Mapnik sees for the feature: the columns
 * produced by the layer's Datasource in project.mml, including `feature`.
 * Helpers `deriveFeature` / `mapTags` build `feature` from raw OSM tags for
 * the common project.mml layers (best-effort; see notes on those functions).
 */

const fs = require('fs');
const path = require('path');

/* ----------------------------------------------------------------------- */
/* Loading                                                                 */
/* ----------------------------------------------------------------------- */

let STYLE = null;

/** Load and cache the compiled rules from a style.json file. */
function loadStyle(file = path.join(__dirname, 'style.json')) {
  STYLE = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const rule of STYLE) if (rule._groups) delete rule._groups;
  return STYLE;
}

/** Provide an already-parsed rules array (skips file loading). */
function setStyle(rules) {
  STYLE = rules;
  for (const rule of STYLE) if (rule._groups) delete rule._groups;
  return STYLE;
}

/* ----------------------------------------------------------------------- */
/* Group access: new `groups` shape, or reconstruct from old flat `filters` */
/* ----------------------------------------------------------------------- */

/**
 * Return the rule's OR-groups as [{ layer, zoom, and:[...] }, ...].
 * - New shape: rule.groups is used directly.
 * - Old shape: rule.filters is split back into OR-groups (see below) and each
 *   group inherits the rule's top-level layer/zoom.
 */
function getGroups(rule) {
  if (Array.isArray(rule.groups)) return rule.groups;
  if (rule._groups) return rule._groups;

  // --- backward compat: reconstruct OR-groups from a flat filter list ---
  // A new group starts whenever a (key, op) pair repeats -- EXCEPT `!=`,
  // which legitimately repeats to exclude several values; range chains use
  // different ops on one key and stay together.
  const zoom = rule.zoom || { min: 0, max: 24 };
  const layer = rule.layer;
  const filters = rule.filters || [];
  const groups = [];
  let cur = [];
  let seen = new Map();
  for (const f of filters) {
    const ops = seen.get(f.key);
    if (f.op !== '!=' && ops && ops.has(f.op)) {
      groups.push({ layer, zoom, and: cur });
      cur = [];
      seen = new Map();
    }
    cur.push(f);
    if (!seen.has(f.key)) seen.set(f.key, new Set());
    seen.get(f.key).add(f.op);
  }
  groups.push({ layer, zoom, and: cur }); // always at least one group (maybe empty `and`)

  Object.defineProperty(rule, '_groups', { value: groups, enumerable: false, configurable: true });
  return groups;
}

/* ----------------------------------------------------------------------- */
/* Filter evaluation (Mapnik-like semantics)                               */
/* ----------------------------------------------------------------------- */

function isAbsent(v) {
  return v === undefined || v === null || v === '';
}

/**
 * Evaluate one filter against the feature's value.
 *   =  / != : string comparison. The literal value 'null' means IS NULL, so
 *             [k=null] matches an absent field and [k!=null] a present one.
 *             For a concrete value, an absent field is "not equal".
 *   > >= < <=: numeric comparison; an absent / non-numeric field never matches.
 */
function testFilter(actual, op, expected) {
  if (expected === 'null') {
    if (op === '=') return isAbsent(actual);
    if (op === '!=') return !isAbsent(actual);
  }
  switch (op) {
    case '=':
      return !isAbsent(actual) && String(actual) === expected;
    case '!=':
      return isAbsent(actual) || String(actual) !== expected;
    case '>':
    case '>=':
    case '<':
    case '<=': {
      if (isAbsent(actual)) return false;
      const a = Number(actual);
      const b = Number(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b;
    }
    default:
      return false;
  }
}

/** True when every AND filter in a group matches the tags. */
function andMatches(and, tags) {
  for (const f of and || []) {
    if (!testFilter(tags[f.key], f.op, f.value)) return false;
  }
  return true;
}

function zoomOk(zoom, z) {
  if (z == null) return true;
  const zr = zoom || { min: 0, max: 24 };
  return z >= zr.min && z <= zr.max;
}

/**
 * Does a group apply to (tags, style, zoom)?
 * - style === null/undefined -> ignore the layer check
 * - zoom  === null/undefined -> ignore the zoom check
 */
function groupApplies(group, tags, style, zoom) {
  if (style != null && group.layer !== style) return false;
  if (!zoomOk(group.zoom, zoom)) return false;
  return andMatches(group.and, tags);
}

/** Does a rule (OR of groups) apply? */
function ruleApplies(rule, tags, style, zoom) {
  const groups = getGroups(rule);
  for (const g of groups) if (groupApplies(g, tags, style, zoom)) return true;
  return false;
}

/* ----------------------------------------------------------------------- */
/* Public matching API                                                     */
/* ----------------------------------------------------------------------- */

/**
 * Return the indices of every rule that matches, in paint order.
 * @param {Object} tags   feature attribute row (should contain `feature`)
 * @param {string} [style] layer id to restrict to
 * @param {number} [zoom]  zoom level
 * @param {Object} [opts]  { rules } to match a custom rules array
 * @returns {number[]}
 */
function matchRules(tags, style, zoom, opts = {}) {
  const rules = opts.rules || STYLE || loadStyle();
  const out = [];
  for (let i = 0; i < rules.length; i++) {
    if (ruleApplies(rules[i], tags, style, zoom)) out.push(i);
  }
  return out;
}

/**
 * Return the index of the FIRST matching rule, or -1 if none match.
 * (Mapnik applies every matching rule in a style; use matchRules for all.)
 */
function matchRule(tags, style, zoom, opts = {}) {
  const rules = opts.rules || STYLE || loadStyle();
  for (let i = 0; i < rules.length; i++) {
    if (ruleApplies(rules[i], tags, style, zoom)) return i;
  }
  return -1;
}

/**
 * Return detailed matches: [{ ruleIndex, groupIndex, layer, zoom }].
 * Useful when a rule has groups spanning several layers.
 */
function matchGroups(tags, style, zoom, opts = {}) {
  const rules = opts.rules || STYLE || loadStyle();
  const out = [];
  for (let i = 0; i < rules.length; i++) {
    const groups = getGroups(rules[i]);
    for (let g = 0; g < groups.length; g++) {
      if (groupApplies(groups[g], tags, style, zoom)) {
        out.push({ ruleIndex: i, groupIndex: g, layer: groups[g].layer, zoom: groups[g].zoom });
      }
    }
  }
  return out;
}

/* ----------------------------------------------------------------------- */
/* project.mml tag mapping (best-effort helper)                            */
/* ----------------------------------------------------------------------- */

/**
 * Build { layerId -> { defs:[{prefix,column,values,alias}], coalesce:[alias] } }
 * from project.mml. Handles the common osm-carto pattern:
 *   ('<prefix>_' || (CASE WHEN <column> IN ('a','b',..) THEN <column> END)) AS <alias>
 *   ... COALESCE(<alias>, ...) AS feature
 * Columns expressed via tags->'x' or nested CASE are skipped (documented
 * limitation): for those layers, pass `feature` yourself.
 */
function parseMmlFeatureMap(mmlPath = path.join(__dirname, 'project.mml')) {
  const text = fs.readFileSync(mmlPath, 'utf8');
  const layers = {};
  const layerRe = /- id:\s*([\w-]+)([\s\S]*?)(?=\n  - id:|\nLayer:|\n[A-Za-z_]+:|$)/g;
  let lm;
  while ((lm = layerRe.exec(text))) {
    const id = lm[1];
    const body = lm[2];
    const defs = [];
    const caseRe = /\('([\w:-]+?)_'\s*\|\|\s*\(CASE WHEN\s+"?([\w]+)"?\s+IN\s*\(([^)]*)\)\s*THEN\s+"?[\w]+"?\s*END\)\)\s*AS\s+"?([\w]+)"?/g;
    let cm;
    while ((cm = caseRe.exec(body))) {
      const values = cm[3].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
      defs.push({ prefix: cm[1], column: cm[2], values, alias: cm[4] });
    }
    const coalesce = (body.match(/COALESCE\(([^)]*)\)\s*AS\s+feature/) || [])[1];
    layers[id] = {
      defs,
      coalesce: coalesce ? coalesce.split(',').map((s) => s.trim()) : defs.map((d) => d.alias),
    };
  }
  return layers;
}

/** Derive the `feature` string for raw OSM tags given a layer's parsed map. */
function deriveFeature(tags, layerMap) {
  if (!layerMap) return null;
  const computed = {};
  for (const d of layerMap.defs) {
    const v = tags[d.column];
    if (v != null && d.values.includes(String(v))) computed[d.alias] = d.prefix + '_' + v;
  }
  for (const alias of layerMap.coalesce) if (computed[alias] != null) return computed[alias];
  return null;
}

/** Return a copy of raw tags with a derived `feature` column added. */
function mapTags(rawTags, layerId, featureMap) {
  const map = (featureMap || parseMmlFeatureMap())[layerId];
  const feature = deriveFeature(rawTags, map);
  return feature != null ? { ...rawTags, feature } : { ...rawTags };
}

module.exports = {
  loadStyle,
  setStyle,
  matchRule,
  matchRules,
  matchGroups,
  ruleApplies,
  groupApplies,
  getGroups,
  testFilter,
  parseMmlFeatureMap,
  deriveFeature,
  mapTags,
};
