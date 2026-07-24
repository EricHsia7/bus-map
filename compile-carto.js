const fs = require('node:fs');
const { looksLikeColorValue, parseCSSModel, extractRGBA, rgbaToString } = require('./color');

// Usage: node compile-carto.js style.mss > style.json
//
// -------------------------------------------------------------------------
// AND / OR model
// -------------------------------------------------------------------------
// A CartoCSS declaration block can be reached by several selectors that are
// separated by commas, and LESS lets those blocks nest. In CartoCSS/Mapnik:
//   * commas  => OR   (any of the listed selectors may match)
//   * a chain of [..][..] attribute selectors on ONE selector => AND
//   * nesting => the parent selector(s) are ANDed onto the child selector(s)
//
// The previous version concatenated the whole nested selector (commas and
// all) into a single string and scraped every [..] filter into one flat
// list, which silently merged OR groups into a bogus AND list (e.g.
// feature='amenity_bar' AND feature='amenity_cafe', which can never match).
//
// This version keeps the structure. For each declaration block it emits:
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

/* ----------------------------------------------------------------------- */
/* LESS @variable resolution (populated by main())                         */
/* ----------------------------------------------------------------------- */

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
      return rgbaToString(extractRGBA(parsed));
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
/* Selector helpers (pure)                                                 */
/* ----------------------------------------------------------------------- */

// Split a selector string on the commas that are NOT inside [ ... ].
// "#a[b='x,y'], #c"  ->  ["#a[b='x,y']", " #c"]
function splitTopLevelCommas(sel) {
  // TODO: splitByTopLevelDelimiter
  const parts = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
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

// Parse a single (comma-free) selector like #roads[highway='primary'][zoom>=12]
// into { layer, filters:[{key,op,value}], zoom:{min,max} }. Filters are ANDed.
function parseSelector(sel) {
  const layer = (sel.match(/#([\w-]+)/) || [])[1] || null;
  const filters = [];
  const zoom = { min: 0, max: 24 };
  const re = /\[\s*([\w:@-]+)\s*(=|!=|>=|<=|>|<)\s*'?([^\]']+)'?\s*\]/g;
  let m;
  while ((m = re.exec(sel))) {
    const [, key, op, raw] = m;
    const value = resolveVars(raw).trim();
    if (key === 'zoom') {
      const z = Number(value);
      if (op === '>=') zoom.min = Math.max(zoom.min, z);
      else if (op === '>') zoom.min = Math.max(zoom.min, z + 1);
      else if (op === '<=') zoom.max = Math.min(zoom.max, z);
      else if (op === '<') zoom.max = Math.min(zoom.max, z - 1);
      else if (op === '=') {
        zoom.min = z;
        zoom.max = z;
      }
    } else {
      filters.push({ key, op, value });
    }
  }
  return { layer, filters, zoom };
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
    const p = parseSel(combo.join(''));
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
      if (c.type === 'decl') paint[c.prop] = resolveValue(c.value);
    }); // shallow: direct decls only
    if (!Object.keys(paint).length) return;

    const groups = buildGroups(chain, parseSelector);
    out.push({ groups, paint });
  });

  process.stdout.write(JSON.stringify(out, null, 2));
}

if (require.main === module) main();

module.exports = {
  splitTopLevelCommas,
  cartesian,
  parseSelector,
  buildGroups,
  resolveValue,
  stripComments
};
