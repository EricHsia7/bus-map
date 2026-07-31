// Prove the collapsed stylesheets paint identically to the expanded ones.
// For every selector chain and every zoom 0..24, compute the effective paint
// from each tree and compare.
// Usage: node tools/verify-collapse.js <expanded-dir> <collapsed-dir>
const fs = require('node:fs');
const path = require('node:path');
const { parseLess } = require('./lessTree.js');
const c = require('../compile-carto.js');

const ZOOM_MIN = 0;
const ZOOM_MAX = 24;
const identity = (v) => v;

const ZOOM_TOKEN_RE = /:zoom\(\s*(\d+|\*)\s*(?:,\s*(\d+|\*)\s*)?\)/g;

function splitZoom(selector) {
  let min = ZOOM_MIN;
  let max = ZOOM_MAX;
  const rest = selector.replace(ZOOM_TOKEN_RE, (_m, a, b) => {
    if (b === undefined) {
      if (a !== '*') min = Math.max(min, Number(a));
    } else {
      if (a !== '*') min = Math.max(min, Number(a));
      if (b !== '*') max = Math.min(max, Number(b));
    }
    return '';
  });
  return { rest: rest.trim(), min, max };
}

function joinChain(parent, child) {
  if (parent === '') return child;
  if (child === '') return parent;
  if (child.includes('&')) return child.split('&').join(parent);
  return `${parent} ${child}`;
}

function collect(block, chain, min, max, paints) {
  for (const decl of block.decls) {
    for (let z = min; z <= max; z++) {
      let value;
      try {
        value = c.isLadder(decl.value) ? c.evalLadder(decl.value, z, decl.prop, identity) : decl.value;
      } catch (error) {
        value = `ERROR:${error.message}`;
      }
      if (value === undefined) continue;
      const key = `${chain}@${z}`;
      if (!paints.has(key)) paints.set(key, new Map());
      paints.get(key).set(decl.prop, value);
    }
  }
  for (const child of block.children) {
    const split = splitZoom(child.selector);
    for (const segment of split.rest.split(',').map((s) => s.trim())) {
      collect(child, joinChain(chain, segment), Math.max(min, split.min), Math.min(max, split.max), paints);
    }
  }
}

function paintsFor(dir, name) {
  const src = fs.readFileSync(path.join(dir, name), 'utf8');
  const root = parseLess(src);
  const paints = new Map();
  for (const child of root.children) {
    const split = splitZoom(child.selector);
    for (const segment of split.rest.split(',').map((s) => s.trim())) {
      collect(child, segment, split.min, split.max, paints);
    }
  }
  return paints;
}

function main() {
  const expandedDir = process.argv[2];
  const collapsedDir = process.argv[3];
  let compared = 0;
  let mismatches = 0;
  let changed = 0;

  for (const name of fs
    .readdirSync(expandedDir)
    .filter((f) => f.endsWith('.less'))
    .sort()) {
    const beforeSrc = fs.readFileSync(path.join(expandedDir, name), 'utf8');
    const afterSrc = fs.readFileSync(path.join(collapsedDir, name), 'utf8');
    if (beforeSrc !== afterSrc) changed++;

    const before = paintsFor(expandedDir, name);
    const after = paintsFor(collapsedDir, name);

    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(key) || new Map();
      const b = after.get(key) || new Map();
      for (const prop of new Set([...a.keys(), ...b.keys()])) {
        compared++;
        const av = a.get(prop);
        const bv = b.get(prop);
        if (av === bv) continue;
        mismatches++;
        if (mismatches <= 12) {
          console.log(`MISMATCH ${name} ${key} ${prop}\n  expanded:  ${av}\n  collapsed: ${bv}`);
        }
      }
    }
  }

  // A run where nothing changed proves nothing, so treat it as a failure.
  console.log(`${changed} files rewritten, ${compared} paint values compared, ${mismatches} mismatches`);
  process.exit(mismatches || changed === 0 ? 1 : 0);
}

main();
