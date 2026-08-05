#!/usr/bin/env node
'use strict';
const fs = require('fs');
const opentype = require('opentype.js');

/* ----------------------------- CLI ----------------------------- */
const argv = process.argv.slice(2);
const opt = { font: null, out: 'text-width.js', name: 'measureTextWidth', charset: 'latin', kern: true, liga: false, maxSwitchRun: 4 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--font') opt.font = argv[++i];
  else if (a === '--out') opt.out = argv[++i];
  else if (a === '--name') opt.name = argv[++i];
  else if (a === '--charset') opt.charset = argv[++i];
  else if (a === '--no-kern') opt.kern = false;
  else if (a === '--liga') opt.liga = true;
}
if (!opt.font) {
  console.error('usage: gen-width-fn.js --font <file> [--out f.js] [--name fn] ' + '[--charset latin|ascii|file:chars.txt|"U+20-7E,U+4E00-9FFF"] [--no-kern] [--liga]');
  process.exit(1);
}

/* -------------------------- charset ---------------------------- */
function resolveCharset(spec) {
  const set = new Set();
  const add = (lo, hi) => {
    for (let c = lo; c <= hi; c++) set.add(c);
  };
  if (spec === 'ascii') add(0x20, 0x7e);
  else if (spec === 'latin') {
    add(0x20, 0x7e);
    add(0xa0, 0x24f);
    add(0x2018, 0x201f);
    add(0x2013, 0x2014);
    [0x2026, 0x20ac, 0x2122, 0x00b7].forEach((c) => set.add(c));
  } else if (spec.startsWith('file:')) {
    for (const ch of fs.readFileSync(spec.slice(5), 'utf8')) {
      const cp = ch.codePointAt(0);
      if (cp > 0x1f) set.add(cp);
    }
  } else {
    for (const part of spec.split(',')) {
      const m = /^U\+([0-9a-f]+)(?:-(?:U\+)?([0-9a-f]+))?$/i.exec(part.trim());
      if (!m) throw new Error('bad charset range: ' + part);
      add(parseInt(m[1], 16), parseInt(m[2] || m[1], 16));
    }
  }
  return [...set].sort((a, b) => a - b);
}

/* ------------------------ font metrics ------------------------- */
const fontFile = fs.readFileSync(opt.font);
const font = opentype.parse(fontFile);
const UPEM = font.unitsPerEm;
const codepoints = resolveCharset(opt.charset);

const glyphByCp = new Map(); // cp -> opentype glyph
const advByCp = new Map(); // cp -> advanceWidth (design units)
const missing = [];
for (const cp of codepoints) {
  const g = font.charToGlyph(String.fromCodePoint(cp));
  if (!g || g.index === 0) {
    missing.push(cp);
    continue;
  } // fallback territory
  glyphByCp.set(cp, g);
  advByCp.set(cp, g.advanceWidth | 0);
}
if (!advByCp.size) throw new Error('font covers none of the requested charset');

// most common advance becomes the cheap default (huge win for CJK / monospace)
const freq = new Map();
for (const a of advByCp.values()) freq.set(a, (freq.get(a) || 0) + 1);
const DEFAULT_ADV = [...freq].sort((x, y) => y[1] - x[1])[0][0];

// run-length compress: contiguous codepoints sharing one advance
const runs = [];
for (const cp of [...advByCp.keys()].sort((a, b) => a - b)) {
  const adv = advByCp.get(cp),
    last = runs[runs.length - 1];
  if (last && last.adv === adv && cp === last.end + 1) last.end = cp;
  else runs.push({ start: cp, end: cp, adv });
}

/* --------------------------- kerning --------------------------- */
function makeKerner() {
  let lookups = null;
  try {
    lookups = font.position.getKerningTables('latn', 'dflt');
  } catch (_) {}
  return (gl, gr) => {
    if (lookups && lookups.length) {
      const v = font.position.getKerningValue(lookups, gl.index, gr.index);
      if (v) return v;
    }
    return font.getKerningValue(gl, gr) || 0;
  };
}
const kernPairs = [];
if (opt.kern) {
  const kern = makeKerner();
  const cps = [...glyphByCp.keys()];
  if (cps.length > 1200) console.warn(`! ${cps.length}^2 kern probes; consider --no-kern`);
  for (const a of cps)
    for (const b of cps) {
      const v = kern(glyphByCp.get(a), glyphByCp.get(b));
      if (v) kernPairs.push([a, b, v | 0]);
    }
}

/* -------------------------- ligatures -------------------------- */
const ligPairs = [];
if (opt.liga) {
  const cpByGid = new Map();
  for (const [cp, g] of glyphByCp) if (!cpByGid.has(g.index)) cpByGid.set(g.index, cp);
  let ligs = [];
  for (const feat of ['liga', 'clig']) {
    try {
      ligs = ligs.concat(font.substitution.getLigatures(feat, 'latn', 'dflt') || []);
    } catch (_) {}
  }
  for (const l of ligs) {
    if (!l.sub || l.sub.length !== 2) continue; // pairs only, keeps runtime O(n)
    const a = cpByGid.get(l.sub[0]),
      b = cpByGid.get(l.sub[1]);
    if (a == null || b == null) continue;
    const g = font.glyphs.get(l.by);
    if (g) ligPairs.push([a, b, g.advanceWidth | 0]);
  }
}

/* ------------------------ code emission ------------------------ */
const KEY_BASE = 0x110000; // pair key = a*KEY_BASE + b (exact in f64)
const label = (c) => (c >= 0x21 && c <= 0x7e && c !== 0x2f ? String.fromCharCode(c) : 'U+' + c.toString(16).toUpperCase().padStart(4, '0'));

function emitAdvance() {
  const long = runs.filter((r) => r.end - r.start + 1 > opt.maxSwitchRun && r.adv !== DEFAULT_ADV);
  const short = runs.filter((r) => r.end - r.start + 1 <= opt.maxSwitchRun && r.adv !== DEFAULT_ADV);
  let s = 'function advanceOf(c) {\n';

  if (long.length) {
    s += '  // ── contiguous ranges: char-code comparison + if/else chain ──\n';
    long
      .sort((a, b) => a.start - b.start)
      .forEach((r, i) => {
        s += `  ${i ? 'else if' : 'if'} (c >= ${r.start} && c <= ${r.end}) return ${r.adv};` + ` // ${label(r.start)}..${label(r.end)}\n`;
      });
  }
  if (short.length) {
    const byAdv = new Map();
    for (const r of short)
      for (let c = r.start; c <= r.end; c++) {
        if (!byAdv.has(r.adv)) byAdv.set(r.adv, []);
        byAdv.get(r.adv).push(c);
      }
    s += '  // ── scattered outliers: switch-case, grouped by shared advance ──\n  switch (c) {\n';
    for (const [adv, cps] of [...byAdv].sort((x, y) => x[0] - y[0])) {
      for (let i = 0; i < cps.length; i += 10) {
        const chunk = cps
          .slice(i, i + 10)
          .map((c) => `case ${c}:`)
          .join(' ');
        const last = i + 10 >= cps.length;
        s += `    ${chunk}${last ? ` return ${adv}; // ${cps.slice(0, 20).map(label).join(' ')}` : ''}\n`;
      }
    }
    s += '  }\n';
  }
  s += `  return ${DEFAULT_ADV}; // default / uncovered\n}\n`;
  return s;
}

const pairTable = (name, rows, val) => (rows.length ? `const ${name} = new Map([\n` + rows.map((r) => `  [${r[0] * KEY_BASE + r[1]}, ${val(r)}], // ${label(r[0])}${label(r[1])}`).join('\n') + `\n]);\n` : `const ${name} = null;\n`);

const out = `/*
 * font        : ${font.names.fullName?.en || opt.font}  (${opt.font})
 * unitsPerEm  : ${UPEM}
 * codepoints  : ${advByCp.size} covered, ${missing.length} uncovered
 * kern pairs  : ${kernPairs.length}${opt.kern ? '' : ' (disabled)'}
 * ligatures   : ${ligPairs.length}${opt.liga ? '' : ' (disabled)'}
 *
 * width = (fontSize/unitsPerEm) * Σ(advance + kern) + letterSpacing*chars + wordSpacing*spaces
 */
'use strict';
const UPEM = ${UPEM};
const KEY_BASE = ${KEY_BASE};

${emitAdvance()}
${pairTable('KERN', kernPairs, (r) => r[2])}
${pairTable('LIGA', ligPairs, (r) => r[2])}

/**
 * @param {string} text
 * @param {number} fontSize (px, matches ctx.font size)
 * @param {number} ls letter spacing (px)
 * @param {number} ws word spacing (px)
 * @returns {number} advance width in CSS px
 */
function ${opt.name}(text, fontSize = 16, ls = 0, ws = 0) {
  const cps = [];
  for (const ch of text) cps.push(ch.codePointAt(0)); // iterate by codepoint, not UTF-16 unit
  let units = 0, chars = 0, spaces = 0, prev = -1;
  for (let i = 0; i < cps.length; i++) {
    let cp = cps[i], consumed = 1;
    // browsers drop liga when letter-spacing is non-zero
    if (LIGA && ls === 0 && i + 1 < cps.length) {
      const lig = LIGA.get(cp * KEY_BASE + cps[i + 1]);
      if (lig !== undefined) { units += lig; consumed = 2; prev = -1; i++; chars += 2;
                               if (cp === 32) spaces++; continue; }
    }
    units += advanceOf(cp);
    if (KERN && prev >= 0) { const k = KERN.get(prev * KEY_BASE + cp); if (k !== undefined) units += k; }
    if (cp === 32 || cp === 0xa0) spaces++;
    prev = cp; chars += consumed;
  }
  return units * (fontSize / UPEM) + ls * chars + ws * spaces;
}

${opt.name}.unitsPerEm = UPEM;
${opt.name}.advanceOf = advanceOf;
if (typeof module !== 'undefined') module.exports = ${opt.name};
`;

fs.writeFileSync(opt.out, out);
console.log(`${opt.out}: ${advByCp.size} cps → ${runs.length} runs, ` + `${kernPairs.length} kern pairs, ${ligPairs.length} ligs, ${(out.length / 1024).toFixed(1)} KiB`);
if (missing.length) console.warn(`! uncovered (would hit font fallback): ` + missing.slice(0, 20).map(label).join(' ') + (missing.length > 20 ? ' …' : ''));

// Usage: node text-width-function-generator.js --font ./fonts/NotoSansTC-Regular.ttf --charset "U+20-7E,U+3000-303F,U+4E00-9FFF" --no-kern