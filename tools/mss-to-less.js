#!/usr/bin/env node
/**
 * mss-to-less.js
 * -------------------------------------------------------------------------
 * One-shot migration: CartoCSS (.mss) -> CartoLESS (.less).
 *
 * CartoLESS is CartoCSS re-expressed in *standard LESS syntax only*:
 *
 *   1. Paint properties become custom properties:
 *        line-width: 2;            ->  --line-width: 2;
 *        background/line-width: 2; ->  --background__line-width: 2;
 *
 *   2. Non-standard comparison filters become functional pseudo-classes
 *      (`:foo(a, b)` is valid CSS/LESS selector grammar, `[a>=b]` is not):
 *        [zoom >= 12]              ->  :zoom(12)
 *        [zoom >= 12][zoom < 15]   ->  :zoom(12, 14)
 *        [zoom < 10]               ->  :zoom(*, 9)
 *        [height > 20]             ->  :gt(height, 20)
 *        [score >= 1][score <= 9]  ->  :range(score, 1, 9)
 *        [ref != 'x']              ->  :not([ref="x"])
 *
 *   3. Equality filters become real CSS attribute selectors with double
 *      quotes: [feature='park'] -> [feature="park"].
 *
 * Compound selectors are re-ordered to be spec-correct:
 *      #layer [attrs] :pseudo-fns ::attachment
 *
 * Usage: node mss-to-less.js <srcDir> <outDir>
 */

const fs = require('node:fs');
const path = require('node:path');

const ZOOM_MIN = 0;
const ZOOM_MAX = 24;

/* ----------------------------------------------------------------------- */
/* Line classification                                                     */
/* ----------------------------------------------------------------------- */

const VAR_DECL = /^@[\w-]+\s*:/;
const PAINT_DECL = /^([A-Za-z][\w-]*\/)?[a-z][\w-]*\s*:/;

/** Split a line into [code, trailingLineComment]. Quote-aware. */
function splitTrailingComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '/' && line[i + 1] === '/') return [line.slice(0, i), line.slice(i)];
  }
  return [line, ''];
}

/* ----------------------------------------------------------------------- */
/* Declarations                                                            */
/* ----------------------------------------------------------------------- */

/** `background/line-width: 2;` -> `--background__line-width: 2;` */
function convertDeclaration(code) {
  return code.replace(/^(\s*)([A-Za-z][\w-]*\/)?([a-z][\w-]*)(\s*:)/, (_m, indent, instance, prop, colon) => {
    const name = instance ? `${instance.slice(0, -1)}__${prop}` : prop;
    return `${indent}--${name}${colon}`;
  });
}

/* ----------------------------------------------------------------------- */
/* Selectors                                                               */
/* ----------------------------------------------------------------------- */

const FILTER_RE = /\[\s*([\w:@-]+)\s*(=|!=|>=|<=|>|<)\s*(?:'([^']*)'|"([^"]*)"|([^\]]*?))\s*\]/g;
const ATTACHMENT_RE = /::[\w-]+/g;

const NUMERIC_FN = { '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt' };

function isNumeric(v) {
  return v !== '' && Number.isFinite(Number(v));
}

/** Convert one comma-free selector segment. */
function convertSegment(segment, report) {
  const filters = [];
  const zoom = { min: ZOOM_MIN, max: ZOOM_MAX };
  let sawZoom = false;

  const base = segment.replace(FILTER_RE, (_m, key, op, sq, dq, bare) => {
    const value = (sq !== undefined ? sq : dq !== undefined ? dq : (bare ?? '')).trim();
    if (key === 'zoom') {
      const z = Number(value);
      if (!Number.isFinite(z)) {
        report.push(`non-numeric zoom: ${_m}`);
        return _m;
      }
      sawZoom = true;
      if (op === '>=') zoom.min = Math.max(zoom.min, z);
      else if (op === '>') zoom.min = Math.max(zoom.min, z + 1);
      else if (op === '<=') zoom.max = Math.min(zoom.max, z);
      else if (op === '<') zoom.max = Math.min(zoom.max, z - 1);
      else if (op === '=') {
        zoom.min = Math.max(zoom.min, z);
        zoom.max = Math.min(zoom.max, z);
      } else report.push(`unsupported zoom op: ${_m}`);
      return '';
    }
    filters.push({ key, op, value });
    return '';
  });

  // Pull the attachment out so it can be re-attached at the very end,
  // where a pseudo-element belongs.
  const attachments = base.match(ATTACHMENT_RE) || [];
  const head = base.replace(ATTACHMENT_RE, '');

  const parts = [];
  const pseudos = [];

  // Collapse `>=`/`<=` pairs on the same key into :range(key, min, max).
  const lower = new Map();
  const upper = new Map();
  for (const f of filters) {
    if (f.op === '>=' && isNumeric(f.value)) lower.set(f.key, (lower.get(f.key) || 0) + 1);
    if (f.op === '<=' && isNumeric(f.value)) upper.set(f.key, (upper.get(f.key) || 0) + 1);
  }
  const ranged = new Set();
  for (const key of lower.keys()) {
    if (lower.get(key) === 1 && upper.get(key) === 1) ranged.add(key);
  }
  const rangeEmitted = new Set();

  for (const f of filters) {
    if (ranged.has(f.key)) {
      if (rangeEmitted.has(f.key)) continue;
      rangeEmitted.add(f.key);
      const lo = filters.find((x) => x.key === f.key && x.op === '>=').value;
      const hi = filters.find((x) => x.key === f.key && x.op === '<=').value;
      pseudos.push(`:range(${f.key}, ${lo}, ${hi})`);
      continue;
    }
    if (f.op === '=') {
      parts.push(`[${f.key}="${f.value}"]`);
    } else if (f.op === '!=') {
      parts.push(`:not([${f.key}="${f.value}"])`);
    } else if (NUMERIC_FN[f.op]) {
      if (!isNumeric(f.value)) report.push(`non-numeric comparison: [${f.key} ${f.op} ${f.value}]`);
      pseudos.push(`:${NUMERIC_FN[f.op]}(${f.key}, ${f.value})`);
    } else {
      report.push(`unsupported op: [${f.key} ${f.op} ${f.value}]`);
    }
  }

  if (sawZoom) {
    const lo = zoom.min > ZOOM_MIN ? String(zoom.min) : '*';
    const hi = zoom.max < ZOOM_MAX ? String(zoom.max) : '*';
    if (lo !== '*' && hi !== '*') pseudos.push(`:zoom(${lo}, ${hi})`);
    else if (lo !== '*') pseudos.push(`:zoom(${lo})`);
    else if (hi !== '*') pseudos.push(`:zoom(*, ${hi})`);
    // both open == no constraint; drop it
  }

  const leading = head.match(/^\s*/)[0];
  const body = head.trim();
  const compound = body + parts.join('') + pseudos.join('') + attachments.join('');
  return leading + (compound || body);
}

/** Split on commas that are not inside [ ] or ( ). */
function splitTopLevelCommas(sel) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of sel) {
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else buf += ch;
  }
  out.push(buf);
  return out;
}

function convertSelectorLine(code, report, nested) {
  const trailing = code.match(/[\s,{]*$/)[0];
  const core = code.slice(0, code.length - trailing.length);
  return (
    splitTopLevelCommas(core)
      .map((s) => {
        const converted = convertSegment(s, report);
        if (!nested) return converted;
        // Nested CartoCSS selectors mean "AND onto the parent", which in
        // standard LESS is the parent reference `&`, not a descendant space.
        const indent = converted.match(/^\s*/)[0];
        const body = converted.slice(indent.length);
        return body.startsWith('&') ? converted : `${indent}&${body}`;
      })
      .join(',') + trailing
  );
}

/* ----------------------------------------------------------------------- */
/* File conversion                                                         */
/* ----------------------------------------------------------------------- */

/** Net brace delta of a line, ignoring braces inside quotes. */
function countBraces(code) {
  let quote = null;
  let delta = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') delta++;
    else if (c === '}') delta--;
  }
  return delta;
}

function convertFile(source) {
  const report = [];
  const lines = source.split('\n');
  let inBlockComment = false;
  let depth = 0;

  const out = lines.map((line) => {
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      return line;
    }
    const [code, comment] = splitTrailingComment(line);
    const trimmed = code.trim();

    if (trimmed.startsWith('/*')) {
      if (!code.includes('*/')) inBlockComment = true;
      return line;
    }
    if (!trimmed || trimmed === '}' || trimmed === '{') {
      depth += countBraces(code);
      return line;
    }
    if (VAR_DECL.test(trimmed)) {
      depth += countBraces(code);
      return line; // LESS variable: already standard
    }
    if (PAINT_DECL.test(trimmed) && !trimmed.endsWith('{')) {
      const converted = convertDeclaration(code) + comment;
      depth += countBraces(code);
      return converted;
    }
    if (/[#[&]|::/.test(trimmed)) {
      const converted = convertSelectorLine(code, report, depth > 0) + comment;
      depth += countBraces(code);
      return converted;
    }
    depth += countBraces(code);
    return line;
  });

  return { text: out.join('\n'), report };
}

/* ----------------------------------------------------------------------- */

function main() {
  const [srcDir, outDir] = process.argv.slice(2);
  if (!srcDir || !outDir) {
    console.error('Usage: node mss-to-less.js <srcDir> <outDir>');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith('.mss'))
    .sort()) {
    const { text, report } = convertFile(fs.readFileSync(path.join(srcDir, file), 'utf8'));
    const target = file.replace(/\.mss$/, '.less');
    fs.writeFileSync(path.join(outDir, target), text);
    console.error(`${file} -> ${target}${report.length ? `  (${report.length} warnings)` : ''}`);
    for (const w of [...new Set(report)]) console.error(`    ! ${w}`);
  }
}

if (require.main === module) main();

module.exports = { convertFile, convertSegment, convertDeclaration };
