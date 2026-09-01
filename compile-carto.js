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

// Scale properties
const SCALE_TARGETS = {
  'text-scale': 'text-size',
  'marker-scale': 'marker-width',
  'line-scale': 'line-width'
};

// Interpolatable properties
const INTERPOLATABLE_TARGETS = ['line-color', 'polygon-fill'];

/**
 * @typedef {Object} Filter A single data-driven constraint, ANDed with its siblings.
 * @property {string} key Feature attribute name.
 * @property {'='|'!='|'>='|'<='|'>'|'<'} op Comparison operator.
 * @property {string} value Right-hand side, always as source text.
 */

/**
 * @typedef {Object} ZoomWindow An inclusive zoom range. Empty when `min > max`.
 * @property {number} min Lowest matching zoom.
 * @property {number} max Highest matching zoom.
 */

/**
 * @typedef {Object} Group One AND-group: a layer, a zoom window and a filter chain.
 * @property {string|null} layer Mapnik layer id, without the `#`.
 * @property {ZoomWindow} zoom Zoom window this group matches.
 * @property {Filter[]} and Filters, in source order, all of which must hold.
 */

/**
 * @typedef {Object.<string, string|number|Array<number|string>>} Paint
 * Paint properties in classic Mapnik spelling (`line-width`, `casing/line-width`).
 * Values are resolved strings, except a shipped `*-scale` under `--keep-scales`,
 * which is the interval `[s0, s1]`.
 */

/**
 * @typedef {Object} Rule One output rule: OR of groups sharing one paint object.
 * @property {Group[]} groups Match if ANY group matches.
 * @property {Paint} paint Properties to apply.
 * @property {string} [attachment] Symbolizer this paint belongs to (`casing`, `halo`, ...).
 */

/**
 * @typedef {Object} ZoomBand A maximal run of zooms sharing an identical paint.
 * @property {number} min First zoom in the run.
 * @property {number} max Last zoom in the run.
 * @property {string} key JSON of `paint`, used to detect equal neighbours.
 * @property {Paint} paint The paint object for the whole run.
 */

/**
 * @typedef {Object} Rational An exact value as a reduced BigInt fraction.
 * @property {bigint} n Numerator, carrying the sign.
 * @property {bigint} d Denominator, always positive.
 */

const dark = process?.argv && Array.isArray(process.argv) && process.argv.includes('--dark');

// --keep-scales: do NOT fold `*-scale` into its sibling size. The size stays a
// single reference value and the scale ships as a separate per-zoom scalar, so a
// client can rasterize glyphs once at the reference size and scale them on the GPU.
// Mapnik has no such property, so this is only for the label/GPU consumer.
const keepScales = process?.argv && Array.isArray(process.argv) && process.argv.includes('--keep-scales');

const rawVars = new Map();
const resolvedVars = new Map();
const resolving = new Set();

/**
 * Substitute every known `@variable` token in a string with its resolved value.
 *
 * LESS deliberately does not interpolate custom property values, so the
 * compiler performs this substitution itself. Unknown tokens are left verbatim.
 *
 * @param {string} str Source text possibly containing `@name` tokens.
 * @returns {string} The text with known variables replaced.
 */
function substituteVarTokens(str) {
  return str.replace(/@[A-Za-z_][\w-]*/g, (token) => {
    if (rawVars.has(token)) {
      const resolved = resolveVariable(token);
      return resolved != null ? String(resolved) : token;
    }
    return token;
  });
}

/**
 * Reduce a declaration value to the form that is emitted: substitute variables,
 * then evaluate it as a colour or as arithmetic when it looks like either.
 *
 * Colours are normalised to `rgba(...)`, and inverted first under `--dark`.
 * Zoom ladders must not be passed here; they are sampled per zoom beforehand,
 * because the whole `zoom-gradient(...)` call is neither a colour nor an
 * expression.
 *
 * @param {string} str Raw declaration value.
 * @returns {string} The resolved value, or the substituted text unchanged.
 */
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

/**
 * Resolve one LESS `@variable` to its final value, memoising the result.
 *
 * A variable may be defined in terms of others; a reference cycle falls back to
 * the raw text instead of recursing forever.
 *
 * @param {string} name Variable name including the leading `@`.
 * @returns {string} The resolved value.
 */
function resolveVariable(name) {
  if (resolvedVars.has(name)) return resolvedVars.get(name);
  if (resolving.has(name)) return rawVars.get(name); // guard against cycles
  resolving.add(name);
  const value = resolveValue(rawVars.get(name));
  resolving.delete(name);
  resolvedVars.set(name, value);
  return String(value);
}

/**
 * Convert a CartoLESS custom property into a classic Mapnik paint key:
 * `--casing__line-width` -> `casing/line-width`, `--line-width` -> `line-width`.
 *
 * Only the FIRST `__` is the instance separator, so `--casing__line-dasharray`
 * round-trips correctly. Anything that is not a custom property is passed
 * through untouched, so a stylesheet may still be compiled mid-migration.
 *
 * @param {string} prop Declaration property name.
 * @returns {string} The compiled paint key.
 */
function normalizePaintProp(prop) {
  const name = String(prop).trim();
  if (!name.startsWith('--')) return name;
  const bare = name.slice(2);
  const sep = bare.indexOf('__');
  return sep === -1 ? bare : `${bare.slice(0, sep)}/${bare.slice(sep + 2)}`;
}

/**
 * Split a selector list on the commas that separate alternatives, i.e. those
 * NOT inside `[ ... ]` or `( ... )`.
 *
 * Parens matter now that filters are written as `:range(key, 1, 9)`, and
 * brackets matter for values such as `rgba(255, 255, 255, 0.6)`.
 *
 * @param {string} sel Selector text, possibly a comma-separated list.
 * @returns {string[]} One entry per alternative, untrimmed.
 * @example
 * splitTopLevelCommas('#a[b="x,y"], #c') // -> ['#a[b="x,y"]', ' #c']
 */
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

/**
 * Cartesian product of an array of arrays, used to expand one comma-separated
 * selector level against the next.
 *
 * @template T
 * @param {T[][]} arrays One array of alternatives per nesting level.
 * @returns {T[][]} Every combination, in row-major order.
 * @example
 * cartesian([['a', 'b'], ['c']]) // -> [['a', 'c'], ['b', 'c']]
 */
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

/**
 * Flatten one nesting chain into a single selector, honouring the LESS parent
 * reference: `&` is substituted with everything accumulated so far, which is
 * exactly how LESS itself flattens nested rules.
 *
 * A nested selector written without `&` would be a descendant selector in LESS,
 * which is meaningless for a Mapnik layer, so it is treated as AND instead.
 *
 * @param {string[]} parts Selectors from outermost ancestor to innermost rule.
 * @returns {string} The flattened, comma-free selector.
 */
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

/**
 * Split the argument list of a functional pseudo-class into trimmed,
 * non-empty arguments.
 *
 * @param {string} args Raw text between the parentheses.
 * @returns {string[]} The arguments, in source order.
 */
function splitArgs(args) {
  return args
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '');
}

/**
 * Narrow a zoom window in place with one inclusive bound. `*`, a missing bound
 * or a non-numeric bound leaves that end open.
 *
 * Bounds intersect rather than overwrite (`min = max(...)`, `max = min(...)`),
 * so a child can only ever tighten what an ancestor allowed.
 *
 * @param {ZoomWindow} zoom Window to narrow, mutated in place.
 * @param {string|undefined} bound Bound as written in the selector.
 * @param {'min'|'max'} kind Which end of the window `bound` constrains.
 * @returns {void}
 */
function clampZoom(zoom, bound, kind) {
  if (bound === undefined || bound === '*') return;
  const z = Number(bound);
  if (!Number.isFinite(z)) return;
  if (kind === 'min') zoom.min = Math.max(zoom.min, z);
  else zoom.max = Math.min(zoom.max, z);
}

/**
 * Collect the distinct layer ids named by a comma-free selector, in source
 * order.
 *
 * Attribute values and pseudo-class arguments are blanked out first, so a `#`
 * inside them (a hex colour, say) is never mistaken for an id.
 *
 * @param {string} sel A flattened, comma-free selector.
 * @returns {string[]} Layer ids without the leading `#`, deduplicated.
 */
function collectLayerIds(sel) {
  const bare = sel.replace(/\[[^\]]*\]/g, '[]').replace(/\(([^()]*)\)/g, '()');
  const ids = [];
  for (const m of bare.matchAll(/#([\w-]+)/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/**
 * Parse one flattened, comma-free selector such as
 * `#roads[highway="primary"]:zoom(12, 15)::casing` into its layer, filter
 * chain, zoom window and attachment.
 *
 * Filters are ANDed and keep their source order. `:zoom`, `:range(zoom, ...)`
 * and the comparison family applied to `zoom` narrow the window instead of
 * producing filters, with strict bounds converted to inclusive ones.
 *
 * @param {string} sel The selector to parse.
 * @returns {{layer: string|null, filters: Filter[], zoom: ZoomWindow, attachment: string|null, conflict: boolean}}
 *   `conflict` is true when the selector names two different layers, which is
 *   unsatisfiable and must be dropped rather than widened to the first id.
 */
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

/**
 * Turn a nesting chain of possibly comma-separated selectors into the OR list
 * of AND-groups emitted for a declaration block.
 *
 * Each level is split on top-level commas, the Cartesian product is taken
 * (parent AND child), and every combination is flattened and parsed into one
 * group. Groups naming two different layers are dropped, and duplicate groups
 * are collapsed.
 *
 * @param {string[]} chain Selectors from outermost ancestor to innermost rule.
 * @param {(sel: string) => ReturnType<typeof parseSelector>} [parseSel] Parser override, for tests.
 * @returns {Group[]} The satisfiable, deduplicated groups.
 */
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

/**
 * Round to 4 decimals, the precision every non-exact emitted number uses.
 *
 * @param {number} n Value to round.
 * @returns {number} The rounded value.
 */
function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Sample a `zoom-gradient(...)` ladder at one integer zoom.
 *
 * Stop values are resolved before sampling, since unresolved tokens cannot be
 * interpolated. Returns `undefined` when the ladder has not started yet, i.e.
 * the zoom is below its first positioned stop and there is no base value, in
 * which case the property is simply not emitted.
 *
 * @param {string} value The ladder as written in the stylesheet.
 * @param {number} z Integer zoom to sample at.
 * @param {string} prop Paint key, used only in diagnostics.
 * @param {(v: string) => string} [resolve] Value resolver, for tests.
 * @returns {string|undefined} The sampled value, or `undefined` if not started.
 * @throws {Error} If the ladder cannot be parsed, or its stops cannot be blended.
 */
function evaluateZoomGradient(value, z, prop, resolve = resolveValue) {
  if (looksLikeZoomGradientValue(value)) {
    const gradient = parseZoomGradient(value);
    if (gradient === undefined) {
      throw new Error(`Error parsing "${value}" on the property "${prop}".`);
    }

    const stops = gradient.stops;
    const stopsLength = stops.length;
    // Resolve the values before sampling since unresolved tokens cannot be interpolated.
    for (let i = 0; i < stopsLength; i++) {
      if (stops[i].value) stops[i].value = resolve(stops[i].value);
    }
    const sampled = sampleZoomGradient(gradient, z);
    if (sampled !== undefined) return sampled;

    const firstPositioned = gradient.stops.find((s) => s.from !== undefined);
    const started = gradient.stops[0].from === undefined || (firstPositioned !== undefined && z >= firstPositioned.from);
    if (started) {
      // Distinguish "has not started yet" from "these stops cannot be blended".
      throw new Error(`Error sampling "${value}" on the property "${prop}" at z=${z}.\n${JSON.stringify(gradient, null, 2)}`);
    }
  }
}

/**
 * Split a paint key into its instance prefix and bare property name:
 * `casing/text-scale` -> `['casing/', 'text-scale']`, `text-scale` -> `['', 'text-scale']`.
 *
 * A scale only ever applies to the size of its OWN instance, which is why the
 * prefix has to be carried around rather than discarded.
 *
 * @param {string} key A paint key in Mapnik spelling.
 * @returns {[string, string]} The instance prefix (with trailing `/`) and bare name.
 */
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
/**
 * Greatest common divisor of two BigInts, sign-insensitive.
 *
 * @param {bigint} a First value.
 * @param {bigint} b Second value.
 * @returns {bigint} The GCD of the absolute values.
 */
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

/**
 * Build a reduced rational with a positive denominator.
 *
 * @param {bigint} n Numerator.
 * @param {bigint} d Denominator.
 * @returns {Rational|undefined} The reduced fraction, or `undefined` if `d` is zero.
 */
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

/**
 * Parse a plain decimal literal such as `9`, `2.5` or `-0.75` exactly.
 *
 * @param {string|number} text Candidate literal.
 * @returns {Rational|undefined} The exact value, or `undefined` if not a plain decimal.
 */
function ratFromDecimal(text) {
  const m = String(text)
    .trim()
    .match(/^([+-]?)(\d*)(?:\.(\d+))?$/);
  if (!m || (m[2] === '' && m[3] === undefined)) return undefined;
  const sign = m[1] === '-' ? -1n : 1n;
  const frac = m[3] || '';
  return ratReduce(sign * BigInt((m[2] || '0') + frac), 10n ** BigInt(frac.length));
}

/**
 * Parse a unitless number, or a division of two such numbers -- `11 / 9`,
 * `(11 / 9)` -- exactly.
 *
 * Division is the one shape a ratio needs that a decimal cannot always express,
 * so it is understood here rather than being handed to floating point.
 *
 * @param {string|number} text Candidate value, optionally wrapped in parentheses.
 * @returns {Rational|undefined} The exact value, or `undefined` if not a number or ratio.
 */
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

/**
 * Render a rational as an exact decimal string, e.g. `11`, `2.5`.
 *
 * Only fractions whose denominator is a product of 2s and 5s terminate in base
 * 10; anything else has no exact decimal form and the caller must fall back to
 * rounded floating point.
 *
 * @param {Rational} r The value to render.
 * @returns {string|undefined} The exact decimal, or `undefined` if it does not terminate.
 */
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

/**
 * Multiply a reference size by a scale, exactly where possible.
 *
 * Both sides are multiplied as BigInt rationals, so `9 * (11 / 9)` emits `11`
 * rather than `11.000000000000002`. Only when a side is not a plain decimal or
 * division (a variable, an expression, a non-terminating fraction) does it fall
 * back to floating point rounded to 4 decimals, like every other ladder value.
 *
 * @param {string|number} sizeValue The reference size.
 * @param {string|number} scaleValue The multiplier.
 * @param {string} prop Size key being written, used in diagnostics.
 * @param {(v: string) => string} [resolve] Value resolver, for tests.
 * @returns {string} The product as a value string.
 * @throws {Error} If either side is not a number after resolution.
 */
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

/**
 * Fold every `*-scale` into the sibling size of its own instance and drop the
 * scale key, so scales never reach the output JSON.
 *
 * A scale with nothing to scale is inert: if the size is not emitted at this
 * zoom (a gated ladder below its first stop) the scale is simply dropped. Under
 * `--keep-scales` nothing is folded, because the scale is then a shipped
 * property rather than sugar.
 *
 * @param {Paint} paint Paint object for one zoom.
 * @param {(v: string) => string} [resolve] Value resolver, for tests.
 * @returns {{paint: Paint, folded: Set<string>}} The new paint and the size keys that were rewritten.
 */
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

/**
 * The paint object as it applies at one integer zoom.
 *
 * Three stages, in this order: sample ladders WITHOUT resolving, so a ratio
 * such as `(11 / 9)` reaches the fold intact instead of arriving rounded; fold
 * scales into sizes; then resolve only what was sampled or rewritten, so rules
 * without ladders compile exactly as before.
 *
 * @param {Paint} paint Paint object as read from the stylesheet.
 * @param {number} z Integer zoom to evaluate at.
 * @param {(v: string) => string} [resolve] Value resolver, for tests.
 * @returns {Paint} The properties that apply at `z`, fully resolved.
 */
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
    const v = evaluateZoomGradient(value, z, prop, resolveValue);
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

/**
 * Re-anchor a scale to a different reference size: `nextRef * scale / curRef`,
 * exactly where possible.
 *
 * A shipped pair is anchored to ONE reference size (the one at `z`), but a rule
 * can change its reference between `z` and `z + 1`. Re-expressing the upper
 * scale against the lower reference keeps a single `text-size` sufficient
 * across the interval: `curRef * s1' === nextRef * s1`.
 *
 * @param {string|number} curRef Reference size at `z`.
 * @param {string|number} nextRef Reference size at `z + 1`.
 * @param {string|number} scaleValue Scale at `z + 1`, anchored to `nextRef`.
 * @param {string} prop Scale key being written, used in diagnostics.
 * @param {(v: string) => string} [resolve] Value resolver, for tests.
 * @returns {string|number} The scale re-anchored to `curRef`.
 * @throws {Error} If the sizes are not numbers, or `curRef` is zero.
 */
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

/**
 * Resolve a value and return it as a number when it is one, so a shipped scale
 * interval is JSON numbers rather than strings.
 *
 * @param {string|number} value Value to coerce.
 * @param {(v: string) => string} [resolve] Value resolver, for tests.
 * @returns {number|string|number} The number, or the original value if it is not numeric.
 */
function asNumber(value, resolve = resolveValue) {
  const n = Number(resolve(value));
  return Number.isFinite(n) ? n : value;
}

/**
 * The paint as SHIPPED at one integer zoom.
 *
 * Identical to {@link paintAtZoom} unless `--keep-scales`, in which case every
 * scale becomes the interval `[s0, s1]` covering `[z, z + 1]` -- exactly the
 * range over which tile zoom `z` is displayed. If the size stops being emitted
 * at `z + 1`, or `z` is `ZOOM_MAX`, the interval is flat rather than
 * interpolating toward nothing.
 *
 * Doing the lookahead here rather than in `render.js` means the label pass
 * keeps its single `matchRules`/`inferLayers` call at tile zoom: layer
 * membership can change with zoom, and sampling it twice would have to
 * reconcile two memberships.
 *
 * @param {Paint} paint Paint object as read from the stylesheet.
 * @param {number} z Integer tile zoom.
 * @param {(v: string) => string} [resolve] Value resolver, for tests.
 * @returns {Paint} The shipped properties at `z`.
 */
function shipPaintAtZoom(paint, z, resolve = resolveValue) {
  const current = paintAtZoom(paint, z, resolve);
  if (!keepScales) return current;

  // At ZOOM_MAX there is no next zoom to grow into, so the interval is flat.
  const next = z >= ZOOM_MAX ? current : paintAtZoom(paint, z + 1, resolve);

  const originalKeys = [];
  for (const key in current) {
    originalKeys.push(key);
  }

  for (const key of originalKeys) {
    const [instance, bare] = splitInstanceKey(key);
    if (SCALE_TARGETS.hasOwnProperty(bare)) {
      const sizeKey = `${instance}${SCALE_TARGETS[bare]}`;

      const curRef = current[sizeKey];
      const nextRef = next[sizeKey];

      const s0 = current[key];
      let s1 = next[key];

      if (s1 === undefined || curRef === undefined || nextRef === undefined) {
        // The rule stops emitting a size at z+1 (a gated ladder ending, or ZOOM_MAX): hold the value rather than interpolate toward nothing.
        s1 = s0;
      } else if (String(nextRef) !== String(curRef)) {
        s1 = renormalizeScale(curRef, nextRef, s1, key, resolve);
      }

      current[key] = [asNumber(s0, resolve), asNumber(s1, resolve)];
    } else if (INTERPOLATABLE_TARGETS.indexOf(bare) > -1) {
      const v0 = current[key];
      const v1 = next[key];
      if (current.hasOwnProperty(key) && next.hasOwnProperty(key)) {
        current[key] = [v0, v1];
      } else {
        current[key] = [v0, v0];
      }
    }
  }
  return current;
}

/**
 * Collapse zooms `ZOOM_MIN..ZOOM_MAX` into maximal runs that share an identical
 * shipped paint object, so one ladder becomes one rule per band.
 *
 * Zooms where nothing is emitted produce no band, which is how a gated ladder
 * stays gated.
 *
 * @param {Paint} paint Paint object as read from the stylesheet.
 * @param {(v: string) => string} [resolve] Value resolver, for tests.
 * @returns {ZoomBand[]} The bands, in ascending zoom order.
 */
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

/**
 * Intersect each group's zoom window with a band, dropping the groups the band
 * excludes entirely.
 *
 * @param {Group[]} groups Groups of the original rule.
 * @param {ZoomBand} band The band being emitted.
 * @returns {Group[]} New groups, clipped to the band.
 */
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

/**
 * Strip inline and block comments from a stylesheet, leaving string literals untouched so a `//` inside a quoted value survives.
 *
 * @param {string} input Stylesheet source.
 * @returns {string} The source without comments.
 */
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

/**
 * Compile the stylesheet named on the command line and write the rule JSON to
 * stdout.
 *
 * Steps: parse with postcss + postcss-less; collect `@variables` and resolve
 * them; walk every rule, normalise its declarations into paint keys, derive the
 * OR list of AND-groups from the nesting chain, and emit either one rule (no
 * ladder) or one rule per zoom band. Rules are emitted in source order, which
 * downstream consumers rely on for layer order and cascading.
 *
 * @returns {void}
 */
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
    const hasInterpolatable = Object.keys(paint).some((k) => INTERPOLATABLE_TARGETS.indexOf(splitInstanceKey(k)[1]) > -1);
    if (!hasShippedScale && !hasInterpolatable && !Object.values(paint).some(looksLikeZoomGradientValue)) {
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
