const fs = require('node:fs');
const { looksLikeColorValue, parseCSSModel, extractRGBA, rgbaToString, looksLikeZoomGradientValue, parseZoomGradient, sampleZoomGradient, stringifyComponent } = require('./color');
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

// Properties the renderer interpolates across the display range of a tile zoom.
// They ship as the interval [v(z), v(z + 1)] rather than a single value.
const INTERPOLATABLE_TARGETS = new Set(['line-color', 'polygon-fill', 'text-scale', 'marker-scale', 'line-width']);

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
 * Values are resolved strings, except an interpolatable target, which is the
 * interval `[v0, v1]` spanning the display range of one tile zoom.
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

const rawVars = new Map();
// Resolution is zoom-dependent, so both caches are keyed on zoom as well as on
// the text being resolved. `undefined` is a real cached outcome: it means a
// ladder involved in the value has not started at that zoom.
const resolvedVars = new Map(); // `${z}|@name` -> resolved value
const valueCache = new Map(); // `${z}|raw text` -> resolved value
const resolving = new Set();

/**
 * Whether a value mentions a zoom ladder anywhere, as opposed to BEING one.
 *
 * `zoom-gradient(...)` may now appear inside arithmetic, so the compiler can no
 * longer decide how to treat a value by testing its first token.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} True if a ladder appears anywhere in the text.
 */
function containsZoomGradient(value) {
  return typeof value === 'string' && value.toLowerCase().includes('zoom-gradient(');
}

function getNonInterpolatableList(paint) {
  const list = new Set();
  for (const key in paint) {
    const [instance, bare] = splitInstanceKey(key);
    if (bare === 'non-interpolatable') {
      const bareProperties = String(paint[key])
        .split(',')
        .map((item) => item.trim());
      for (const bareProperty of bareProperties) {
        list.add(`${instance}${bareProperty}`);
      }
    }
  }
  return list;
}

/**
 * Replace every `zoom-gradient(...)` call inside a larger expression with its
 * value at one zoom, so `@path-width * @path-scale + 2 * @paths-background-width`
 * reduces to plain arithmetic that {@link calc} can evaluate.
 *
 * Each sampled ladder is parenthesised, since a stop may itself be an
 * expression such as `(0.86 / 0.94)` and would otherwise bind to the
 * surrounding operators. A ladder that spans the whole value is substituted
 * verbatim instead, because the value may be a colour rather than a number.
 *
 * If any ladder in the value has not started at `z`, the whole value is
 * undefined and the property is not emitted -- the same rule a bare ladder has
 * always followed.
 *
 * @param {string} value Text possibly containing one or more ladders.
 * @param {number} z Integer zoom to sample at.
 * @param {string} prop Paint key, used only in diagnostics.
 * @returns {string|undefined} The text with ladders replaced, or `undefined`.
 */
function sampleEmbeddedGradients(value, z, prop) {
  let out = '';
  let i = 0;
  const lower = value.toLowerCase();
  while (true) {
    const at = lower.indexOf('zoom-gradient(', i);
    if (at === -1) return out + value.slice(i);
    out += value.slice(i, at);

    // Match the closing parenthesis of this call, ignoring nested ones.
    let depth = 0;
    let j = at + 'zoom-gradient'.length;
    for (; j < value.length; j++) {
      if (value[j] === '(') depth++;
      else if (value[j] === ')' && --depth === 0) break;
    }
    if (j >= value.length) {
      throw new Error(`Unclosed zoom-gradient in "${value}" on the property "${prop}".`);
    }

    const ladder = value.slice(at, j + 1);
    const sampled = evaluateZoomGradient(ladder, z, prop);
    if (sampled === undefined) return undefined; // ladder has not started yet
    const whole = at === 0 && j === value.length - 1;
    out += whole ? sampled : `(${sampled})`;
    i = j + 1;
  }
}

/**
 * Substitute every known `@variable` token in a string with its resolved value.
 *
 * LESS deliberately does not interpolate custom property values, so the
 * compiler performs this substitution itself. Unknown tokens are left verbatim.
 *
 * @param {string} str Source text possibly containing `@name` tokens.
 * @returns {string} The text with known variables replaced.
 */
function substituteVarTokens(str, z) {
  let gated = false;
  const out = str.replace(/@[A-Za-z_][\w-]*/g, (token) => {
    if (!rawVars.has(token)) return token;
    const resolved = resolveVariable(token, z);
    if (resolved === undefined) {
      // The variable is a ladder that has not started at this zoom, so nothing
      // built from it can be emitted either.
      gated = true;
      return token;
    }
    // A resolved variable may be an unevaluated expression such as
    // `4.2 - 2 * 0.4`; parenthesise it so it binds ahead of the operators
    // around the token. Only purely numeric text qualifies -- a colour, a font
    // name or a dasharray must never be wrapped.
    const text = String(resolved).trim();
    const numericExpression = /^[\d.+\-*/()\s]+$/.test(text) && /[+\-*/]/.test(text.slice(1));
    return numericExpression ? `(${text})` : text;
  });
  return gated ? undefined : out;
}

/**
 * Reduce a declaration value to the form that is emitted: substitute variables,
 * then evaluate it as a colour or as arithmetic when it looks like either.
 *
 * Colours are normalised to `rgba(...)`, and inverted first under `--dark`.
 *
 * Zoom ladders are sampled HERE, at `z`, whether the value is a bare ladder or
 * mentions one inside arithmetic, and whether it mentions one directly or
 * through a variable. That is what makes
 * `@path-width * @path-scale + 2 * @paths-background-width` legal: by the time
 * the colour and arithmetic tests run, every ladder has already collapsed to a
 * number. Results are memoised per `(zoom, text)` pair, so a ramp shared by 60
 * declarations is parsed once per zoom rather than once per site.
 *
 * @param {string} str Raw declaration value.
 * @param {number} [z] Integer zoom. Omitted only in zoom-independent contexts,
 *   where a ladder is left as text instead of being sampled.
 * @param {string} [prop] Paint key, used only in diagnostics.
 * @returns {string|undefined} The resolved value, the substituted text
 *   unchanged, or `undefined` when a ladder it depends on has not started.
 */
function resolveValue(str, z, prop) {
  if (typeof str !== 'string') return str;
  const cacheKey = `${z === undefined ? '-' : z}|${str}`;
  if (valueCache.has(cacheKey)) return valueCache.get(cacheKey);
  const value = computeValue(str, z, prop);
  valueCache.set(cacheKey, value);
  return value;
}

/**
 * The body of {@link resolveValue}, without the memoisation.
 *
 * @param {string} str Raw declaration value.
 * @param {number} [z] Integer zoom.
 * @param {string} [prop] Paint key, used only in diagnostics.
 * @returns {string|undefined} The resolved value.
 */
function computeValue(str, z, prop) {
  let substituted = substituteVarTokens(str.trim(), z);
  if (substituted === undefined) return undefined;
  if (containsZoomGradient(substituted)) {
    // Without a zoom there is nothing to sample against, so the ladder stays
    // as text; callers in a zoom context always pass one.
    if (z === undefined) return substituted;
    substituted = sampleEmbeddedGradients(substituted, z, prop);
    if (substituted === undefined) return undefined;
    if (containsZoomGradient(substituted)) {
      throw new Error(`Unsampled zoom-gradient in "${substituted}" on the property "${prop}" at z=${z}.`);
    }
  }
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
    // Rounding once, at the end, keeps a chain such as
    // `0.94 * (0.86 / 0.94) + 0.28` from accumulating error at each step.
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
 * Because a variable may hold a ladder -- `@road-scale` is the whole point of
 * this -- its resolved value depends on the zoom, and the memo is keyed on
 * both. A variable whose ladder has not started at `z` resolves to `undefined`,
 * which gates every value built from it.
 *
 * @param {string} name Variable name including the leading `@`.
 * @param {number} [z] Integer zoom.
 * @returns {string|undefined} The resolved value.
 */
function resolveVariable(name, z) {
  const key = `${z === undefined ? '-' : z}|${name}`;
  if (resolvedVars.has(key)) return resolvedVars.get(key);
  if (resolving.has(key)) return rawVars.get(name); // guard against cycles
  resolving.add(key);
  const value = resolveValue(rawVars.get(name), z, name);
  resolving.delete(key);
  resolvedVars.set(key, value);
  return value;
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
    // Resolve the values before sampling since unresolved tokens cannot be
    // interpolated. Stops are resolved at the SAME zoom, so a stop may itself
    // be written in terms of another zoom-dependent variable.
    for (let i = 0; i < stopsLength; i++) {
      stops[i].value = resolve(stops[i].value, z, prop);
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

/**
 * The paint object as it applies at one integer zoom.
 *
 * Paint arrives as raw stylesheet text and is resolved here, at this zoom:
 * variables, ladders (bare or embedded in arithmetic), colours and arithmetic
 * all collapse in one pass, so a value may mix them freely. A property whose
 * value depends on a ladder that has not started at `z` is not emitted.
 *
 * @param {Paint} paint Paint object as read from the stylesheet.
 * @param {number} z Integer zoom to evaluate at.
 * @param {(v: string, z?: number, prop?: string) => string|undefined} [resolve]
 *   Value resolver, for tests.
 * @returns {Paint} The properties that apply at `z`, fully resolved.
 */
function paintAtZoom(paint, z, resolve = resolveValue) {
  const result = {};
  for (const [prop, value] of Object.entries(paint)) {
    const v = resolve(value, z, prop);
    if (v !== undefined) result[prop] = v;
  }
  return result;
}

/**
 * The paint as SHIPPED at one integer zoom.
 *
 * Identical to {@link paintAtZoom} except that every interpolatable target
 * becomes the interval `[v0, v1]` covering `[z, z + 1]` -- exactly the range
 * over which tile zoom `z` is displayed. If the property stops being emitted at
 * `z + 1`, or `z` is `ZOOM_MAX`, the interval is flat rather than interpolating
 * toward nothing.
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
  const nonInterpolatableList = getNonInterpolatableList(current);

  // At ZOOM_MAX there is no next zoom to grow into, so the interval is flat.
  const next = z >= ZOOM_MAX ? current : paintAtZoom(paint, z + 1, resolve);

  const originalKeys = [];
  for (const key in current) {
    originalKeys.push(key);
  }

  for (const key of originalKeys) {
    const [instance, bare] = splitInstanceKey(key);
    if (INTERPOLATABLE_TARGETS.has(bare)) {
      const v0 = current[key];
      const v1 = next[key];

      if (!nonInterpolatableList.has(key)) {
        current[key] = [v0, v1 === undefined ? v0 : v1];
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
  // Variables resolve lazily now: their value depends on the zoom, so there is
  // nothing useful to precompute here.

  // 2) Walk rules, preserving AND (filter chains) and OR (comma selectors).
  const out = [];
  root.walkRules((rule) => {
    const chain = [];
    for (let n = rule; n && n.type === 'rule'; n = n.parent) chain.unshift(n.selector);

    const paint = {};
    rule.each((c) => {
      if (c.type !== 'decl') return;
      if (c.prop.startsWith('@')) return; // LESS variable, not paint
      // Values are kept as written and resolved per zoom, since a variable may
      // hold a ladder and therefore have no single zoom-independent value.
      paint[normalizePaintProp(c.prop)] = c.value.trim();
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
  resolveVariable,
  containsZoomGradient,
  sampleEmbeddedGradients,
  evaluateZoomGradient,
  stripComments,
  splitInstanceKey,
  shipPaintAtZoom,
  paintAtZoom,
  zoomBands,
  clipGroupsToBand
};
