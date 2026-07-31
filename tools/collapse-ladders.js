// Collapse expanded &:zoom() ladders into zoom-gradient() declarations.
// Usage: node tools/collapse-ladders.js style [--write]
//
// Three rules keep the rewrite behaviour-preserving:
//   1. An expanded rung holds its value until the next rung takes over, so a
//      gap in the ladder becomes a hard stop, never an interpolation.
//   2. A value with its own top-level commas (line-dasharray: 0.1, 9) cannot
//      live in a comma-separated stop list, so it is left alone.
//   3. A rung with nested children still contributes its stop, because a
//      declaration left behind in a child would override the parent gradient.
const fs = require('node:fs');
const path = require('node:path');
const { parseLess, rungZoom, applyEdits } = require('./lessTree.js');

// Expand a range to whole lines when nothing else shares them.
function lineExpand(src, start, end) {
  let s = start;
  while (s > 0 && src[s - 1] !== '\n') {
    if (!/\s/.test(src[s - 1])) return { start, end };
    s--;
  }
  let e = end;
  while (e < src.length && src[e] !== '\n') {
    if (!/\s/.test(src[e])) return { start, end };
    e++;
  }
  return { start: s, end: Math.min(e + 1, src.length) };
}

function indentOf(src, offset) {
  let s = offset;
  while (s > 0 && src[s - 1] !== '\n') s--;
  const m = /^[\t ]*/.exec(src.slice(s, offset));
  return m ? m[0] : '';
}

function hasTopLevelComma(value) {
  let depth = 0;
  for (const ch of value) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

function stopText(value, zoom) {
  if (zoom.to === undefined) return `${value} ${zoom.from}z`;
  return `${value} ${zoom.from}z ${zoom.to}z`;
}

function buildGradient(base, stops) {
  if (stops.length === 0) return undefined;
  if (stops.length === 1 && base === undefined) return undefined;

  const parts = [];
  if (base !== undefined) parts.push(base);

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const next = stops[i + 1];

    if (stop.zoom.to !== undefined) {
      // A closed range reverts to the base once it ends, so it is only safe
      // when something follows immediately or a base can be restored.
      if (next !== undefined) {
        if (next.zoom.from !== stop.zoom.to + 1) return undefined;
      } else if (base === undefined) {
        return undefined;
      }
    }

    // Rule 1: hold the value across a gap instead of interpolating into it.
    // Adjacent stops need no range: there is no zoom in between them.
    let zoom = stop.zoom;
    if (zoom.to === undefined && next !== undefined && next.zoom.from > zoom.from + 1) {
      zoom = { from: zoom.from, to: next.zoom.from - 1 };
    }

    parts.push(stopText(stop.value, zoom));

    if (stop.zoom.to !== undefined && next === undefined && base !== undefined) {
      parts.push(`${base} ${stop.zoom.to + 1}z`);
    }
  }

  return `zoom-gradient(${parts.join(', ')})`;
}

// Returns true when this subtree produced edits. A block whose descendants
// were rewritten is deferred to the next pass: the parent may want to delete a
// declaration that a descendant just anchored an insertion to, and those two
// edits would overlap.
function collapseBlock(src, block, edits, stats) {
  let touched = false;
  for (const child of block.children) {
    if (collapseBlock(src, child, edits, stats)) touched = true;
  }
  if (touched) return true;

  const rungs = [];
  for (const child of block.children) {
    const zoom = rungZoom(child.selector);
    if (zoom === undefined) continue;
    rungs.push({ block: child, zoom }); // rule 3: children do not disqualify
  }
  if (rungs.length === 0) return false;

  for (let i = 1; i < rungs.length; i++) {
    if (rungs[i].zoom.from <= rungs[i - 1].zoom.from) return false;
  }

  const baseDecls = new Map();
  for (const decl of block.decls) baseDecls.set(decl.prop, decl);

  const byProp = new Map();
  for (const rung of rungs) {
    for (const decl of rung.block.decls) {
      if (!byProp.has(decl.prop)) byProp.set(decl.prop, []);
      byProp.get(decl.prop).push({ value: decl.value, zoom: rung.zoom, decl, rung });
    }
  }

  const absorbed = new Set();
  const inserts = [];

  for (const [prop, stops] of byProp) {
    const seen = new Set();
    let duplicated = false;
    for (const stop of stops) {
      if (seen.has(stop.rung)) duplicated = true;
      seen.add(stop.rung);
    }
    if (duplicated) continue;
    if (stops.some((s) => s.value === '' || s.value.includes('zoom-gradient('))) continue;
    if (stops.some((s) => hasTopLevelComma(s.value))) continue; // rule 2

    const baseDecl = baseDecls.get(prop);
    if (baseDecl && hasTopLevelComma(baseDecl.value)) continue;

    const gradient = buildGradient(baseDecl ? baseDecl.value : undefined, stops);
    if (gradient === undefined) continue;

    if (baseDecl) {
      edits.push({ start: baseDecl.valueStart, end: baseDecl.valueEnd, text: gradient });
    } else {
      inserts.push({ prop, gradient });
    }
    for (const stop of stops) absorbed.add(stop.decl);
    stats.properties++;
  }

  if (absorbed.size === 0) return false;

  if (inserts.length > 0) {
    const anchor = block.decls.length > 0 ? block.decls[block.decls.length - 1] : undefined;
    const indent = anchor ? indentOf(src, anchor.start) : `${indentOf(src, block.blockStart)}  `;
    const at = anchor ? anchor.end : block.bodyStart;
    const text = inserts.map((ins) => `\n${indent}${ins.prop}: ${ins.gradient};`).join('');
    edits.push({ start: at, end: at, text });
  }

  for (const rung of rungs) {
    const remaining = rung.block.decls.filter((decl) => !absorbed.has(decl));
    if (remaining.length === 0 && rung.block.children.length === 0) {
      const span = lineExpand(src, rung.block.blockStart, rung.block.blockEnd);
      edits.push({ start: span.start, end: span.end, text: '' });
      stats.rungs++;
      continue;
    }
    for (const decl of rung.block.decls) {
      if (!absorbed.has(decl)) continue;
      const span = lineExpand(src, decl.start, decl.end);
      edits.push({ start: span.start, end: span.end, text: '' });
    }
  }

  return true;
}

function collapsePass(src) {
  const root = parseLess(src);
  const edits = [];
  const stats = { properties: 0, rungs: 0 };
  for (const child of root.children) collapseBlock(src, child, edits, stats);
  return { output: applyEdits(src, edits), stats };
}

// Repeat until nothing is left to collapse, so deferred nested ladders still
// get their turn.
function collapseFile(src) {
  let output = src;
  const stats = { properties: 0, rungs: 0 };
  for (let pass = 0; pass < 20; pass++) {
    const result = collapsePass(output);
    if (result.stats.properties === 0) break;
    output = result.output;
    stats.properties += result.stats.properties;
    stats.rungs += result.stats.rungs;
  }
  return { output, stats };
}

function main() {
  const dir = process.argv[2] || 'style';
  const write = process.argv.includes('--write');
  let totalProps = 0;
  let totalRungs = 0;

  for (const name of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.less'))
    .sort()) {
    const file = path.join(dir, name);
    const src = fs.readFileSync(file, 'utf8');
    const { output, stats } = collapseFile(src);
    totalProps += stats.properties;
    totalRungs += stats.rungs;
    if (write && output !== src) fs.writeFileSync(file, output);
    if (stats.properties) {
      console.log(`${name}: ${stats.properties} properties collapsed, ${stats.rungs} rung blocks removed`);
    }
  }
  console.log(`TOTAL: ${totalProps} properties collapsed, ${totalRungs} rung blocks removed${write ? '' : ' (dry run)'}`);
}

if (require.main === module) main();
module.exports = { collapseFile, buildGradient };
