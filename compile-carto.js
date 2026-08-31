const fs = require('node:fs');
const { looksLikeColorValue, parseCSSModel, extractRGBA, rgbaToString, looksLikeZoomGradientValue, parseZoomGradient, sampleZoomGradient } = require('./color');
const { looksLikeNumericalExpression, calc } = require('./calc');
const { invertRGB } = require('./invert');

// Usage: node compile-carto.js style.less > style.json

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

// --keep-scales: do NOT fold `*-scale` into its sibling size. The size stays a
// single reference value and the scale ships as a separate per-zoom scalar, so a
// client can rasterize glyphs once at the reference size and scale them on the GPU.
// Mapnik has no such property, so this is only for the label/GPU consumer.
const keepScales = process?.argv && Array.isArray(process.argv) && process.argv.includes('--keep-scales');

const rawVars = new Map();
const resolvedVars = new Map();
const resolving = new Set();

function substituteVarTokens(str) {
  return str.replace(/@[A-Za-z_][\w-]*/g, (token) => {
    if (rawVars.has(token)) {
      const resolved = resolveVariable(token);
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
    const evaluated = round4(calc(substituted));
    if (typeof evaluated === 'number' && Number.isFinite(evaluated)) {
      return String(evaluated);
    }
  }
  return substituted;
}

function resolveVariable(name) {
  if (resolvedVars.has(name)) return resolvedVars.get(name);
  if (resolving.has(name)) return rawVars.get(name); // guard against cycles
  resolving.add(name);
  const value = resolveValue(rawVars.get(name));
  resolving.delete(name);
  resolvedVars.set(name, value);
  return String(value);
}

// `--casing__line-width` -> `casing/line-width`; `--line-width` -> `line-width`.
// Anything that is not a custom property is passed through untouched, so a stylesheet may still be compiled mid-migration.
function normalizePaintProp(prop) {
  const name = String(prop).trim();
  if (!name.startsWith('--')) return name;
  const bare = name.slice(2);
  const sep = bare.indexOf('__');
  return sep === -1 ? bare : `${bare.slice(0, sep)}/${bare.slice(sep + 2)}`;
}

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
  const z = Number(bound);
  if (!Number.isFinite(z)) return;
  if (kind === 'min') zoom.min = Math.max(zoom.min, z);
  else zoom.max = Math.min(zoom.max, z);
}

// Collect the distinct layer ids named by a (comma-free) selector, in source
// order. Attribute values and pseudo-class arguments are blanked out first so
// that a `#` inside them (a hex colour, say) is never mistaken for an id.
function collectLayerIds(sel) {
  const bare = sel.replace(/\[[^\]]*\]/g, '[]').replace(/\(([^()]*)\)/g, '()');
  const ids = [];
  for (const m of bare.matchAll(/#([\w-]+)/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

// Parse a single (comma-free) selector like
//   #roads[highway="primary"]:zoom(12, 15)::casing
// into { layer, filters:[{key,op,value}], zoom:{min,max}, attachment }.
// Filters are ANDed and keep their source order.
function parseSelector(sel) {
  // A flattened selector can pick up more than one id when a nested rule
  // re-narrows a multi-layer parent:
  //
  //   #roads-casing, #bridges, #tunnels {
  //     &::bridges_and_tunnels_background {
  //       &[feature='highway_bridleway'] { &#bridges { ... } }
  //     }
  //   }
  //
  // flattens to `#roads-casing ... #bridges`, `#bridges ... #bridges` and
  // `#tunnels ... #bridges`. A feature belongs to exactly one Mapnik layer,
  // so `#a#b` with a != b is unsatisfiable: those combinations must be
  // DROPPED. Taking the first id instead (the previous behaviour) silently
  // widened every re-narrowed block back to all of its ancestor layers --
  // that is how bridge/tunnel casings ended up painted on plain roads.
  const ids = collectLayerIds(sel);
  const layer = ids.length ? ids[0] : null;
  const conflict = ids.length > 1;
  const attachment = (sel.match(/::([\w-]+)/) || [])[1] || null;
  const filters = [];
  const zoom = { min: ZOOM_MIN, max: ZOOM_MAX };

  let m;
  SELECTOR_TOKEN_RE.lastIndex = 0;
  while ((m = SELECTOR_TOKEN_RE.exec(sel))) {
    const [, notKey, notDq, notSq, notBare, eqKey, eqDq, eqSq, eqBare, fn, fnArgs] = m;

    if (notKey !== undefined) {
      const value = (notDq ?? notSq ?? notBare ?? '').trim();
      filters.push({ key: notKey, op: '!=', value });
      continue;
    }
    if (eqKey !== undefined) {
      const value = (eqDq ?? eqSq ?? eqBare ?? '').trim();
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
        if (lo !== undefined && lo !== '*') filters.push({ key, op: '>=', value: lo.trim() });
        if (hi !== undefined && hi !== '*') filters.push({ key, op: '<=', value: hi.trim() });
      }
      continue;
    }

    // :gte / :lte / :gt / :lt
    const [key, bound] = args;
    const op = COMPARISON_OP[fn];
    if (key === 'zoom') {
      const z = Number(bound);
      if (Number.isFinite(z)) {
        if (op === '>=') zoom.min = Math.max(zoom.min, z);
        else if (op === '>') zoom.min = Math.max(zoom.min, z + 1);
        else if (op === '<=') zoom.max = Math.min(zoom.max, z);
        else zoom.max = Math.min(zoom.max, z - 1);
      }
      continue;
    }
    filters.push({ key, op, value: (bound ?? '').trim() });
  }

  return { layer, filters, zoom, attachment, conflict };
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
    // Unsatisfiable layer intersection (`#a ... #b`): emit nothing.
    if (p.conflict) continue;
    const group = { layer: p.layer, zoom: p.zoom, and: p.filters };
    const key = JSON.stringify(group);
    if (!seen.has(key)) {
      seen.add(key);
      groups.push(group);
    }
  }
  return groups;
}

function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

// Value of a ladder at one integer zoom, or undefined when the ladder has not started yet (zoom below its first stop).
function evaluateZoomGradient(value, z, prop, resolve = resolveValue) {
  if (looksLikeZoomGradientValue(value)) {
    const gradient = parseZoomGradient(value);
    if (gradient === undefined) {
      throw new Error(`Error parsing "${value}" on the property "${prop}".`);
    }

    const sampled = sampleZoomGradient(gradient, z);
    if (sampled !== undefined) return resolve(sampled);

    const firstPositioned = gradient.stops.find((s) => s.from !== undefined);
    const started = gradient.stops[0].from === undefined || (firstPositioned !== undefined && z >= firstPositioned.from);
    if (started) {
      // Distinguish "has not started yet" from "these stops cannot be blended".
      throw new Error(`Error sampling "${value}" on the property "${prop}" at z=${z}.\n${JSON.stringify(gradient, null, 2)}`);
    }
  }
}

// Scale properties
const SCALE_TARGETS = {
  'text-scale': 'text-size',
  'marker-scale': 'marker-width',
  'line-scale': 'line-width'
};

// `casing/text-scale` -> ['casing/', 'text-scale']; `text-scale` -> ['', 'text-scale'].
// A scale only ever applies to the size of its OWN instance.
function splitInstanceKey(key) {
  const sep = key.lastIndexOf('/');
  return sep === -1 ? ['', key] : [key.slice(0, sep + 1), key.slice(sep + 1)];
}

/* Exact decimal arithmetic (BigInt rationals).
 *
 * A reference size times a ratio such as 11/9 has to come back as exactly 11,
 * not 11.000000000000002. Floating point would leave that noise in the emitted
 * JSON and every folded size would differ from the hand-written ladder it
 * replaced, so the fold is done on rationals and only rounded as a fallback. */
function ratGcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

function ratReduce(n, d) {
  if (d === 0n) return undefined;
  const g = ratGcd(n, d) || 1n;
  let rn = n / g;
  let rd = d / g;
  if (rd < 0n) {
    rn = -rn;
    rd = -rd;
  }
  return { n: rn, d: rd };
}

function ratFromDecimal(text) {
  const m = String(text)
    .trim()
    .match(/^([+-]?)(\d*)(?:\.(\d+))?$/);
  if (!m || (m[2] === '' && m[3] === undefined)) return undefined;
  const sign = m[1] === '-' ? -1n : 1n;
  const frac = m[3] || '';
  return ratReduce(sign * BigInt((m[2] || '0') + frac), 10n ** BigInt(frac.length));
}

// A unitless number, or a division of two such numbers -- `11 / 9`, `(11 / 9)`.
// Division is the one shape a ratio needs that a decimal cannot always express.
function ratFromValue(text) {
  const raw = String(text)
    .trim()
    .replace(/^\((.*)\)$/s, '$1')
    .trim();
  const div = raw.split('/');
  if (div.length === 2) {
    const a = ratFromDecimal(div[0]);
    const b = ratFromDecimal(div[1]);
    if (a === undefined || b === undefined || b.n === 0n) return undefined;
    return ratReduce(a.n * b.d, a.d * b.n);
  }
  return ratFromDecimal(raw);
}

// Exact decimal string, or undefined when the fraction does not terminate.
function ratToDecimalString(r) {
  let d = r.d;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  if (d !== 1n) return undefined;
  const digits = Math.max(twos, fives);
  const scaled = ((r.n < 0n ? -r.n : r.n) * 10n ** BigInt(digits)) / r.d;
  const text = scaled.toString().padStart(digits + 1, '0');
  const intPart = digits ? text.slice(0, -digits) : text;
  const frac = digits ? text.slice(-digits).replace(/0+$/, '') : '';
  return `${r.n < 0n ? '-' : ''}${intPart}${frac ? `.${frac}` : ''}`;
}

// size * scale, exactly where possible.
function multiplyScaled(sizeValue, scaleValue, prop, resolve = resolveValue) {
  const size = ratFromValue(sizeValue);
  const scale = ratFromValue(scaleValue);
  if (size !== undefined && scale !== undefined) {
    const product = ratReduce(size.n * scale.n, size.d * scale.d);
    const exact = product && ratToDecimalString(product);
    if (exact !== undefined && exact !== null) return exact;
  }

  // Fallback: let the normal value pipeline reduce each side (variables,
  // arithmetic) and multiply numerically, rounded like every other ladder value.
  const sizeNum = Number(resolve(sizeValue));
  const scaleNum = Number(resolve(scaleValue));
  if (!Number.isFinite(sizeNum) || !Number.isFinite(scaleNum)) {
    throw new Error(`${prop}: cannot scale "${sizeValue}" by "${scaleValue}" (both must be numbers)`);
  }
  return String(round4(sizeNum * scaleNum));
}

// Fold every `*-scale` into its sibling size and drop the scale key.
// Returns the new paint plus the size keys that were rewritten.
function foldScales(paint, resolve = resolveValue) {
  // In --keep-scales mode the scale is a shipped property, not sugar: pass it
  // through untouched so the reference size and the scalar stay separate.
  if (keepScales) return { paint: { ...paint }, folded: new Set() };

  const out = { ...paint };
  const folded = new Set();
  for (const key of Object.keys(paint)) {
    const [instance, bare] = splitInstanceKey(key);
    const target = SCALE_TARGETS[bare];
    if (target === undefined) continue;

    delete out[key];
    const sizeKey = instance + target;
    // A scale with nothing to scale is inert: the size is not set at this zoom
    // (a gated ladder below its first stop), so there is no size to multiply.
    if (!(sizeKey in out)) continue;
    out[sizeKey] = multiplyScaled(out[sizeKey], paint[key], sizeKey, resolve);
    folded.add(sizeKey);
  }
  return { paint: out, folded };
}

// The paint object as it applies at one integer zoom.
function paintAtZoom(paint, z, resolve = resolveValue) {
  // Stage 1: sample ladders WITHOUT resolving, so a ratio like `(11 / 9)`
  // reaches the fold intact instead of arriving as a rounded decimal.
  const raw = {};
  const sampled = new Set();
  for (const [prop, value] of Object.entries(paint)) {
    if (!looksLikeZoomGradientValue(value)) {
      raw[prop] = value;
      continue;
    }
    const v = evaluateZoomGradient(value, z, prop, (x) => x);
    if (v !== undefined) {
      raw[prop] = v;
      sampled.add(prop);
    }
  }

  // Stage 2: fold scales into sizes.
  const { paint: merged, folded } = foldScales(raw, resolve);

  // Stage 3: resolve what stage 1 sampled or stage 2 rewrote. Everything else
  // was already resolved when the rule was read, so it is passed through
  // untouched and rules without ladders compile exactly as before.
  const out = {};
  for (const [prop, value] of Object.entries(merged)) {
    out[prop] = sampled.has(prop) || folded.has(prop) ? resolve(value) : value;
  }
  return out;
}

// nextRef * scale / curRef, exactly where possible.
// The shipped pair is anchored to ONE reference size (the one at z), but a rule
// can change its reference between z and z+1. Re-expressing the upper scale
// against the lower reference keeps a single `text-size` sufficient:
//   curRef * s1' === nextRef * s1
function renormalizeScale(curRef, nextRef, scaleValue, prop, resolve = resolveValue) {
  const a = ratFromValue(nextRef);
  const b = ratFromValue(curRef);
  const s = ratFromValue(scaleValue);
  if (a !== undefined && b !== undefined && s !== undefined && b.n !== 0n) {
    const product = ratReduce(a.n * s.n * b.d, a.d * s.d * b.n);
    const exact = product && ratToDecimalString(product);
    if (exact !== undefined && exact !== null) return exact;
  }

  const cr = Number(resolve(curRef));
  const nr = Number(resolve(nextRef));
  const sv = Number(resolve(scaleValue));
  if (!Number.isFinite(cr) || !Number.isFinite(nr) || !Number.isFinite(sv) || cr === 0) {
    throw new Error(`${prop}: cannot re-anchor scale across a reference-size change`);
  }
  return round4((nr * sv) / cr);
}

function asNumber(value, resolve = resolveValue) {
  const n = Number(resolve(value));
  return Number.isFinite(n) ? n : value;
}

// The paint as SHIPPED at one integer zoom. Identical to paintAtZoom unless
// --keep-scales, in which case every scale becomes the interval [s0, s1] that
// covers [z, z+1] -- exactly the range over which tile zoom z is displayed.
//
// Doing the lookahead here rather than in render.js means the label pass keeps
// its single matchRules/inferLayers call at tZ: layer membership can change
// with zoom, and sampling it twice would have to reconcile two memberships.
function shipPaintAtZoom(paint, z, resolve = resolveValue) {
  const cur = paintAtZoom(paint, z, resolve);
  if (!keepScales) return cur;

  // At ZOOM_MAX there is no next zoom to grow into, so the interval is flat.
  const next = z >= ZOOM_MAX ? cur : paintAtZoom(paint, z + 1, resolve);

  for (const key of Object.keys(cur)) {
    const [instance, bare] = splitInstanceKey(key);
    const target = SCALE_TARGETS[bare];
    if (target === undefined) continue;

    const sizeKey = instance + target;
    const curRef = cur[sizeKey];
    const s0 = cur[key];
    let s1 = next[key];
    const nextRef = next[sizeKey];

    if (s1 === undefined || curRef === undefined || nextRef === undefined) {
      // The rule stops emitting a size at z+1 (a gated ladder ending, or ZOOM_MAX): hold the value rather than interpolate toward nothing.
      s1 = s0;
    } else if (String(nextRef) !== String(curRef)) {
      s1 = renormalizeScale(curRef, nextRef, s1, key, resolve);
    }

    cur[key] = [asNumber(s0, resolve), asNumber(s1, resolve)];
  }
  return cur;
}

// Collapse zooms 0..24 into maximal runs that share an identical paint object.
function zoomBands(paint, resolve = resolveValue) {
  const bands = [];
  for (let z = ZOOM_MIN; z <= ZOOM_MAX; z++) {
    const p = shipPaintAtZoom(paint, z, resolve);
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

// Comment stripping
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
  for (const name of rawVars.keys()) resolveVariable(name);

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
      paint[normalizePaintProp(c.prop)] = looksLikeZoomGradientValue(c.value) ? substituteVarTokens(c.value.trim()) : resolveValue(c.value);
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
    // A constant --text-scale still has to be folded away here.
    const hasShippedScale = keepScales && Object.keys(paint).some((k) => SCALE_TARGETS[splitInstanceKey(k)[1]] !== undefined);

    if (!hasShippedScale && !Object.values(paint).some(looksLikeZoomGradientValue)) {
      const flat = foldScales(paint).paint;
      out.push(attachment ? { groups, paint: flat, attachment } : { groups, paint: flat });
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
  splitInstanceKey,
  multiplyScaled,
  foldScales,
  shipPaintAtZoom,
  renormalizeScale,
  paintAtZoom,
  zoomBands,
  clipGroupsToBand
};
