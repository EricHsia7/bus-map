// npm install postcss postcss-less
// Usage: node compile-carto.js style.mss > style.json
const fs = require('fs');
const postcss = require('postcss');
const less = require('postcss-less');
const { looksLikeColorValue, parseCSSModel, extractRGBA, rgbaToString } = require('./color');

const root = postcss.parse(stripComments(fs.readFileSync(process.argv[2], { encoding: 'utf8' })), { syntax: less });

// 1) Collect LESS @variables.
//    NOTE: depending on postcss-less version these arrive as atrules with
//    `.variable === true` (older) or as decls whose prop starts with "@".

// Collect the RAW (unresolved) text of every @variable first, then resolve
// lazily. This lets a variable reference another variable and lets color
// adjustment functions (lighten/darken/mix/…) that reference @variables be
// resolved into rgba once every definition is known.
const rawVars = new Map();

// postcss-less parses "@name: value" as an AtRule.
//   no space:  at.name = "land-color:"   at.params = "#f2efe9"
//   w/ space:  at.name = "land-color"    at.params = ": #f2efe9"
root.walkAtRules((at) => {
  if (at.nodes) return; // skip @media {…}, detached rulesets, mixins
  let name = at.name;
  let value = at.params ?? '';

  if (name.endsWith(':')) {
    name = name.slice(0, -1); // strip glued colon
  } else if (value.startsWith(':')) {
    value = value.slice(1); // strip leading colon from params
  } else {
    return; // real at-rule (@import, @media, @charset…)
  }

  name = name.trim();
  value = value.trim();

  if (name && value) rawVars.set('@' + name, value); // store WITH '@' to match refs
});

// Some postcss-less versions emit vars as Declarations (type 'decl')
// with prop like "@land-color" instead. Cover that too.
root.walkDecls((decl) => {
  if (decl.prop && decl.prop.startsWith('@')) {
    rawVars.set(decl.prop, decl.value);
  }
});

const resolvedVars = new Map();
const resolving = new Set();

// Replace @variable tokens inside a value string with their resolved values.
function substituteVarTokens(str) {
  return str.replace(/@[A-Za-z_][\w-]*/g, (token) => {
    if (rawVars.has(token)) {
      const resolved = resolveVar(token);
      return resolved != null ? String(resolved) : token;
    }
    return token;
  });
}

// Resolve a value: substitute nested @vars, then—if it is a color (including a
// color adjustment function)—collapse it to an rgba(...) string.
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

// Eagerly resolve every variable so the cache is populated.
for (const name of rawVars.keys()) resolveVar(name);

function resolveVars(v) {
  if (rawVars.has(v)) return resolveVar(v);
  return v;
}

// 2) Parse a selector like  #roads[highway='primary'][zoom>=12]
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

// 3) Walk rules, flattening LESS nesting by concatenating parent selectors.
const out = [];
root.walkRules((rule) => {
  const chain = [];
  for (let n = rule; n && n.type === 'rule'; n = n.parent) chain.unshift(n.selector);
  const parsed = parseSelector(chain.join(''));

  const paint = {};
  rule.each((c) => {
    if (c.type === 'decl') paint[c.prop] = resolveValue(c.value);
  }); // shallow: direct decls only
  if (Object.keys(paint).length) out.push({ ...parsed, paint });
});

process.stdout.write(JSON.stringify(out, null, 2));

function stripComments(input) {
  let out = '';
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    const d = input[i + 1];
    // string literals: copy verbatim
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
    // line comment
    if (c === '/' && d === '/') {
      i += 2;
      while (i < n && input[i] !== '\n') i++;
      continue;
    }
    // block comment (handles /**/, /* * */ and multiline)
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
