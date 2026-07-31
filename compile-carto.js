const fs = require('node:fs');
const { looksLikeColorValue, parseCSSModel, extractRGBA, rgbaToString, looksLikeZoomGradientValue, parseZoomGradient, sampleZoomGradient } = require('./color');
const { looksLikeNumericalExpression, calc } = require('./calc');
const { invertRGB } = require('./invert');

// Usage: node compile-carto.js style.less > style.json
//
// -------------------------------------------------------------------------
// CartoLESS: CartoCSS re-expressed in standard LESS
// -------------------------------------------------------------------------
// The stylesheets this compiler consumes are plain LESS. Nothing in them
// needs a bespoke parser dialect: every construct below is valid CSS/LESS
// selector or declaration grammar, so editors, linters, prettier and lessc
// itself can all read the styles.
//
//   layer          #roads                     id selector
//   attachment     ::casing                   pseudo-element (always last)
//   equality       [feature="park"]           attribute selector
//   inequality     :not([ref=""])             negation pseudo-class
//   zoom range     :zoom(12, 15)              functional pseudo-class
//   zoom min/max   :zoom(12) / :zoom(*, 9)
//   numeric data   :gte(height, 20)           also :gt :lte :lt
//   numeric range  :range(score, 1e3, 1e6)
//   nesting        &[highway="primary"]       parent reference = AND
//   paint          --line-width: 2;           custom property
//   instances      --casing__line-width: 2;   `__` = CartoCSS `casing/`
//
// The three custom pseudo-classes (:zoom, the comparison family, :range) are
// *expanded by this compiler*, not by LESS. They exist so that a numeric,
// data-driven constraint is one readable token instead of a chain of
// non-standard `[key >= value]` filters, and so that zoom windows have a
// single canonical spelling.
//
// -------------------------------------------------------------------------
// AND / OR model
// -------------------------------------------------------------------------
// Selectors separated by commas are OR. A chain of filters on ONE selector is
// AND. Nesting ANDs the parent selector(s) onto the child selector(s) via `&`.
//
// For each declaration block the compiler emits:
//
//   {
//     "groups": [                       // <- OR  (block matches if ANY group does)
//       {
//         "layer": "amenity-points",
//         "zoom":  { "min": 17, "max": 24 },
//         "and":   [ {"key":"feature","op":"=","value":"amenity_bar"} ]  // <- AND
//       },
//       ...
//     ],
//     "paint": { ... }
//   }
//
// Each group carries its own layer + zoom because comma selectors may span
// different layers (e.g. `#roads-casing, #bridges, #tunnels { ... }`) or set
// zoom at different nesting levels.
//
// `paint` keys are emitted in classic Mapnik spelling (`line-width`,
// `casing/line-width`): the `--` prefix and `__` instance separator are a
// source-syntax concern only, so downstream consumers are unaffected.

const ZOOM_MIN = 0;
const ZOOM_MAX = 24;

const dark = process?.argv && Array.isArray(process.argv) && process.argv.includes('--dark');

const rawVars = new Map();
const resolvedVars = new Map();
const resolving = new Set();

function substituteVarTokens(str) {
  return str.replace(/@[A-Za-z_][\w-]*/g, (token) => {
    if (rawVars.has(token)) {
      const resolved = resolveVar(token);
      return resolved != null ? String(resolved) : token;
    }
    return token;
  });
}

function resolveValue(str) {
  if (typeof str !== 'string') return str;
  const substituted = substituteVarTokens(str.trim());
  if (looksLikeColorValue(substituted)) {
    const parsed = parseCSSModel(substituted);
    if (parsed) {
      const rgba = extractRGBA(parsed);
      if (dark) {
        const inverted = invertRGB(rgba[0], rgba[1], rgba[2]);
        return rgbaToString([inverted[0], inverted[1], inverted[2], rgba[3]]);
      } else {
        return rgbaToString(rgba);
      }
    }
  } else if (looksLikeNumericalExpression(substituted)) {
    const evaluated = calc(substituted);
    if (typeof evaluated === 'number' && Number.isFinite(evaluated)) {
      return String(evaluated);
    }
  }
  return substituted;
}

function resolveVar(name) {
  if (resolvedVars.has(name)) return resolvedVars.get(name);
  if (resolving.has(name)) return rawVars.get(name); // guard against cycles
  resolving.add(name);
  const value = resolveValue(rawVars.get(name));
  resolving.delete(name);
  resolvedVars.set(name, value);
  return value;
}

function resolveVars(v) {
  if (rawVars.has(v)) return resolveVar(v);
  return v;
}

/* ----------------------------------------------------------------------- */
/* Paint properties (pure)                                                 */
/* ----------------------------------------------------------------------- */

// `--casing__line-width` -> `casing/line-width`; `--line-width` -> `line-width`.
// Anything that is not a custom property is passed through untouched, so a
// stylesheet may still be compiled mid-migration.
function normalizePaintProp(prop) {
  const name = prop.trim();
  if (!name.startsWith('--')) return name;
  const bare = name.slice(2);
  const sep = bare.indexOf('__');
  return sep === -1 ? bare : `${bare.slice(0, sep)}/${bare.slice(sep + 2)}`;
}

/* ----------------------------------------------------------------------- */
/* Selector helpers (pure)                                                 */
/* ----------------------------------------------------------------------- */

// Split a selector string on the commas that are NOT inside [ ... ] or ( ... ).
// Parens matter now that filters are written as :range(key, 1, 9).
// "#a[b=\"x,y\"], #c"  ->  ["#a[b='x,y']", " #c"]
function splitTopLevelCommas(sel) {
  const parts = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts;
}

// Cartesian product of an array of arrays.
// [[a,b],[c]] -> [[a,c],[b,c]]
function cartesian(arrays) {
  return arrays.reduce(
    (acc, cur) => {
      const next = [];
      for (const combo of acc) for (const item of cur) next.push(combo.concat([item]));
      return next;
    },
    [[]]
  );
}

// Resolve a nesting chain into one flat selector, honouring the LESS parent
// reference. `&` is substituted with everything accumulated so far, which is
// exactly how LESS itself flattens nested rules.
function joinChain(parts) {
  let acc = '';
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (!acc) {
      acc = part.replace(/&/g, '');
      continue;
    }
    // A nested selector without `&` would be a descendant selector in LESS,
    // which has no meaning for a Mapnik layer; treat it as AND for tolerance.
    acc = part.includes('&') ? part.replace(/&/g, acc) : acc + part;
  }
  return acc;
}

/* Ordered scan of every selector token this compiler understands. */
const SELECTOR_TOKEN_RE = new RegExp(
  [
    // :not([key="value"])
    /:not\(\s*\[\s*([\w:@-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]]*?))\s*\]\s*\)/.source,
    // [key="value"]
    /\[\s*([\w:@-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]]*?))\s*\]/.source,
    // :zoom(...) / :gte(...) / :range(...) / ...
    /:(zoom|gte|lte|gt|lt|range)\(([^)]*)\)/.source
  ].join('|'),
  'g'
);

const COMPARISON_OP = { gte: '>=', lte: '<=', gt: '>', lt: '<' };

function splitArgs(args) {
  return args
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '');
}

// Narrow a zoom window with one bound. `*` (or a missing bound) is open.
function clampZoom(zoom, bound, kind) {
  if (bound === undefined || bound === '*') return;
  const z = Number(resolveVars(bound));
  if (!Number.isFinite(z)) return;
  if (kind === 'min') zoom.min = Math.max(zoom.min, z);
  else zoom.max = Math.min(zoom.max, z);
}

// Parse a single (comma-free) selector like
//   #roads[highway="primary"]:zoom(12, 15)::casing
// into { layer, filters:[{key,op,value}], zoom:{min,max}, attachment }.
// Filters are ANDed and keep their source order.
function parseSelector(sel) {
  const layer = (sel.match(/#([\w-]+)/) || [])[1] || null;
  const attachment = (sel.match(/::([\w-]+)/) || [])[1] || null;
  const filters = [];
  const zoom = { min: ZOOM_MIN, max: ZOOM_MAX };

  let m;
  SELECTOR_TOKEN_RE.lastIndex = 0;
  while ((m = SELECTOR_TOKEN_RE.exec(sel))) {
    const [, notKey, notDq, notSq, notBare, eqKey, eqDq, eqSq, eqBare, fn, fnArgs] = m;

    if (notKey !== undefined) {
      const value = resolveVars(notDq ?? notSq ?? notBare ?? '').trim();
      filters.push({ key: notKey, op: '!=', value });
      continue;
    }
    if (eqKey !== undefined) {
      const value = resolveVars(eqDq ?? eqSq ?? eqBare ?? '').trim();
      filters.push({ key: eqKey, op: '=', value });
      continue;
    }
    if (fn === undefined) continue;

    const args = splitArgs(fnArgs);
    if (fn === 'zoom') {
      // :zoom(min) | :zoom(min, max) | :zoom(*, max)
      clampZoom(zoom, args[0], 'min');
      if (args.length > 1) clampZoom(zoom, args[1], 'max');
      continue;
    }
    if (fn === 'range') {
      // :range(key, min, max) -- inclusive on both ends
      const [key, lo, hi] = args;
      if (key === 'zoom') {
        clampZoom(zoom, lo, 'min');
        clampZoom(zoom, hi, 'max');
      } else {
        if (lo !== undefined && lo !== '*') filters.push({ key, op: '>=', value: resolveVars(lo).trim() });
        if (hi !== undefined && hi !== '*') filters.push({ key, op: '<=', value: resolveVars(hi).trim() });
      }
      continue;
    }

    // :gte / :lte / :gt / :lt
    const [key, bound] = args;
    const op = COMPARISON_OP[fn];
    if (key === 'zoom') {
      const z = Number(resolveVars(bound));
      if (Number.isFinite(z)) {
        if (op === '>=') zoom.min = Math.max(zoom.min, z);
        else if (op === '>') zoom.min = Math.max(zoom.min, z + 1);
        else if (op === '<=') zoom.max = Math.min(zoom.max, z);
        else zoom.max = Math.min(zoom.max, z - 1);
      }
      continue;
    }
    filters.push({ key, op, value: resolveVars(bound ?? '').trim() });
  }

  return { layer, filters, zoom, attachment };
}

// Turn a nesting chain of (possibly comma-separated) selectors into the OR
// list of AND-groups. The chain is [ancestorSelector, ..., ruleSelector].
// Each level is split on top-level commas, the Cartesian product is taken
// (parent AND child), and every combination is parsed into one AND-group.
function buildGroups(chain, parseSel = parseSelector) {
  const perLevel = chain.map(splitTopLevelCommas);
  const combos = cartesian(perLevel);
  const groups = [];
  const seen = new Set();
  for (const combo of combos) {
    const p = parseSel(joinChain(combo));
    const group = { layer: p.layer, zoom: p.zoom, and: p.filters };
    const key = JSON.stringify(group);
    if (!seen.has(key)) {
      seen.add(key);
      groups.push(group);
    }
  }
  return groups;
}

/* ----------------------------------------------------------------------- */
/* Zoom ladders: step() and interpolate() (pure)                           */
/* ----------------------------------------------------------------------- */

// Mapnik has no runtime zoom expression: a symbolizer property is a constant
// for a given zoom level. `step()` and `interpolate()` are therefore SOURCE
// sugar -- the compiler evaluates them at every integer zoom and splits the
// rule into one output rule per band of zooms that share the same paint.
//
//   --line-width: step(0.5 12, 1 14, 2 16);
//     z12-13 -> 0.5,  z14-15 -> 1,  z16+ -> 2,  below z12 -> not emitted
//
//   --line-width: interpolate(0.5 12, 4 18);
//     one value per integer zoom, linearly between the stops, clamped after
//     the last stop. Stop zooms may be fractional; the value is still only
//     sampled at the integer zooms Mapnik actually renders.
const LADDER_RE = /^(step|interpolate)\s*\(([\s\S]*)\)\s*$/;

function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

function isLadder(value) {
  if (typeof value !== 'string') return false;
  return LADDER_RE.test(value.trim()) || looksLikeZoomGradientValue(value);
}

// "0.5 12" -> { value: "0.5", zoom: 12 }. The zoom is the LAST whitespace-
// separated token, so values may contain spaces: `darken(@c, 10%) 14`.
function parseStops(fn, body, prop) {
  const stops = splitTopLevelCommas(body)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((arg) => {
      const m = arg.match(/^([\s\S]+?)\s+(-?\d+(?:\.\d+)?)$/);
      if (!m) {
        throw new Error(`${fn}() on ${prop}: stop "${arg}" must be "<value> <zoom>"`);
      }
      const zoom = Number(m[2]);
      if (fn === 'step' && !Number.isInteger(zoom)) {
        throw new Error(`step() on ${prop}: stop zoom ${zoom} must be an integer (use interpolate() for fractional stops)`);
      }
      return { value: m[1].trim(), zoom };
    });
  if (!stops.length) throw new Error(`${fn}() on ${prop}: needs at least one stop`);
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].zoom <= stops[i - 1].zoom) {
      throw new Error(`${fn}() on ${prop}: stop zooms must strictly increase (${stops[i - 1].zoom} then ${stops[i].zoom})`);
    }
  }
  return stops;
}

// step() and interpolate() are sugar over the zoom-gradient component that
// lives in color.js, so all three share one sampler:
//
//   step(a 12, b 14)        ==  zoom-gradient(a 12z 13z, b 14z)
//   interpolate(a 12, b 18) ==  zoom-gradient(a 12z, b 18z)
function toZoomGradient(value, prop) {
  const raw = String(value).trim();

  if (looksLikeZoomGradientValue(raw)) {
    const parsed = parseZoomGradient(raw);
    if (parsed === undefined) {
      throw new Error(`zoom-gradient() on ${prop}: could not parse "${raw}" (stop positions need the z unit, e.g. "4 17z")`);
    }
    return parsed;
  }

  const m = LADDER_RE.exec(raw);
  if (!m) return undefined;

  const fn = m[1];
  const stops = parseStops(fn, m[2], prop);

  // interpolate -> point stops (blend between them)
  if (fn === 'interpolate') {
    return { type: 'zoom-gradient', stops: stops.map((s) => ({ value: s.value, from: s.zoom, to: undefined })) };
  }

  // step -> hard stops (constant across each band), like a CSS hard stop
  return {
    type: 'zoom-gradient',
    stops: stops.map((s, i) => ({
      value: s.value,
      from: s.zoom,
      to: i < stops.length - 1 ? stops[i + 1].zoom - 1 : undefined
    }))
  };
}

// Value of a ladder at one integer zoom, or undefined when the ladder has not
// started yet (zoom below its first stop).
function evalLadder(value, z, prop, resolve = resolveValue) {
  const gradient = toZoomGradient(value, prop);
  if (gradient === undefined) return resolve(value);

  const sampled = sampleZoomGradient(gradient, z);
  if (sampled !== undefined) return resolve(sampled);

  // Distinguish "has not started yet" from "these stops cannot be blended".
  const firstPositioned = gradient.stops.find((s) => s.from !== undefined);
  const started = gradient.stops[0].from === undefined || (firstPositioned !== undefined && z >= firstPositioned.from);
  if (started) {
    throw new Error(`${prop}: cannot interpolate between stops at zoom ${z} (numbers with matching units, or colors)`);
  }
  return undefined;
}

// The paint object as it applies at one integer zoom.
function paintAtZoom(paint, z, resolve = resolveValue) {
  const out = {};
  for (const [prop, value] of Object.entries(paint)) {
    if (!isLadder(value)) {
      out[prop] = value;
      continue;
    }
    const v = evalLadder(value, z, prop, resolve);
    if (v !== undefined) out[prop] = v;
  }
  return out;
}

// Collapse zooms 0..24 into maximal runs that share an identical paint object.
function zoomBands(paint, resolve = resolveValue) {
  const bands = [];
  for (let z = ZOOM_MIN; z <= ZOOM_MAX; z++) {
    const p = paintAtZoom(paint, z, resolve);
    if (!Object.keys(p).length) continue;
    const key = JSON.stringify(p);
    const prev = bands[bands.length - 1];
    if (prev && prev.key === key && prev.max === z - 1) {
      prev.max = z;
      continue;
    }
    bands.push({ min: z, max: z, key, paint: p });
  }
  return bands;
}

// Restrict a rule's groups to a band, dropping groups the band excludes.
function clipGroupsToBand(groups, band) {
  const out = [];
  for (const g of groups) {
    const min = Math.max(g.zoom.min, band.min);
    const max = Math.min(g.zoom.max, band.max);
    if (min > max) continue;
    out.push({ ...g, zoom: { min, max } });
  }
  return out;
}

/* ----------------------------------------------------------------------- */
/* Comment stripping (pure)                                                */
/* ----------------------------------------------------------------------- */

function stripComments(input) {
  let out = '';
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    const d = input[i + 1];
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        out += input[i];
        if (input[i] === '\\') {
          out += input[i + 1] || '';
          i += 2;
          continue;
        }
        if (input[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '/' && d === '/') {
      i += 2;
      while (i < n && input[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* ----------------------------------------------------------------------- */
/* Main (only runs when invoked as a script)                               */
/* ----------------------------------------------------------------------- */

function main() {
  const postcss = require('postcss');
  const less = require('postcss-less');

  const root = postcss.parse(stripComments(fs.readFileSync(process.argv[2], { encoding: 'utf8' })), {
    syntax: less
  });

  // 1) Collect LESS @variables (raw), resolve lazily.
  //    Note: lessc treats the *value* of a custom property as verbatim text,
  //    so `--line-color: @grass` is not interpolated by LESS. This compiler
  //    performs that substitution itself, which keeps the stylesheets valid
  //    LESS while preserving CartoCSS variable semantics.
  root.walkAtRules((at) => {
    if (at.nodes) return; // skip @media {…}, detached rulesets, mixins
    let name = at.name;
    let value = at.params ?? '';
    if (name.endsWith(':')) {
      name = name.slice(0, -1);
    } else if (value.startsWith(':')) {
      value = value.slice(1);
    } else {
      return;
    }
    name = name.trim();
    value = value.trim();
    if (name && value) rawVars.set('@' + name, value);
  });
  root.walkDecls((decl) => {
    if (decl.prop && decl.prop.startsWith('@')) {
      rawVars.set(decl.prop, decl.value);
    }
  });
  for (const name of rawVars.keys()) resolveVar(name);

  // 2) Walk rules, preserving AND (filter chains) and OR (comma selectors).
  const out = [];
  root.walkRules((rule) => {
    const chain = [];
    for (let n = rule; n && n.type === 'rule'; n = n.parent) chain.unshift(n.selector);

    const paint = {};
    rule.each((c) => {
      if (c.type !== 'decl') return;
      if (c.prop.startsWith('@')) return; // LESS variable, not paint
      // A ladder is resolved per zoom band, not here: resolveValue would try to
      // read the whole function as a single color or arithmetic expression.
      // Variables still have to be substituted up front.
      paint[normalizePaintProp(c.prop)] = isLadder(c.value) ? substituteVarTokens(c.value.trim()) : resolveValue(c.value);
    }); // shallow: direct decls only
    if (!Object.keys(paint).length) return;

    // The attachment (::casing, ::fill, ...) can appear on any segment of the
    // nesting chain; the innermost/last one applies to this declaration block.
    // Each attachment is rendered as a SEPARATE symbolizer, so paint from one
    // attachment must never cascade onto another.
    const attachment =
      chain
        .map((s) => (s.match(/::([\w-]+)/) || [])[1])
        .filter(Boolean)
        .pop() || null;

    const groups = buildGroups(chain, parseSelector);

    // Fast path: no zoom ladder, so the rule maps 1:1 onto one output rule.
    if (!Object.values(paint).some(isLadder)) {
      out.push(attachment ? { groups, paint, attachment } : { groups, paint });
      return;
    }

    // A ladder splits the rule into one rule per band of equal paint.
    for (const band of zoomBands(paint)) {
      const banded = clipGroupsToBand(groups, band);
      if (!banded.length) continue;
      out.push(attachment ? { groups: banded, paint: band.paint, attachment } : { groups: banded, paint: band.paint });
    }
  });

  process.stdout.write(JSON.stringify(out, null, 2));
}

if (require.main === module) main();

module.exports = {
  splitTopLevelCommas,
  cartesian,
  joinChain,
  parseSelector,
  normalizePaintProp,
  buildGroups,
  resolveValue,
  stripComments,
  isLadder,
  parseStops,
  toZoomGradient,
  evalLadder,
  paintAtZoom,
  zoomBands,
  clipGroupsToBand
};
