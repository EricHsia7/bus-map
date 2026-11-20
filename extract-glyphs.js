#!/usr/bin/env node
'use strict';
// Offline/server only. Writes gzip-compressed JSON with delta-encoded vertices.
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('fflate');
const crypto = require('node:crypto');
const opentype = require('opentype.js');
const args = process.argv.slice(2),
  opt = {};
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]?.startsWith('--') || args[i + 1] == null) throw Error('Expected --key value');
  opt[args[i].slice(2)] = args[i + 1];
}
if (!opt.font || !opt.out) throw Error('Usage: node extract-glyphs.js --font regular.ttf|otf --out directory [--shard-size 256]');
const shardSize = Number(opt['shard-size'] || 256);
if (!Number.isInteger(shardSize) || shardSize < 1 || shardSize > 4096) throw Error('Invalid shard size');
const bytes = fs.readFileSync(opt.font),
  font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
if (font.tables.fvar) throw Error('Variable fonts require a static instance first');
const os2 = font.tables.os2;
if (!os2 || os2.usWeightClass !== 400 || (font.tables.head?.macStyle || 0) & 2 || (os2.fsSelection || 0) & 1) throw Error('Expected a static upright weight-400 face');
if (!font.encoding?.cmap?.glyphIndexMap) throw Error('Unicode cmap unavailable');
// CFF uses cubic controls in pairs; glyf has quadratic controls with implied midpoints.
const outline = font.outlinesFormat === 'truetype' ? 'quadratic' : font.outlinesFormat === 'cff' ? 'cubic' : null;
if (!outline) throw Error('Unsupported outline format: ' + font.outlinesFormat);
const faceId = crypto.createHash('sha256').update(bytes).digest('hex'),
  precision = 1000;
const q = (n) => {
  if (!Number.isFinite(n)) throw Error('Non-finite glyph coordinate');
  return Math.round(n * precision);
};
function contoursFor(g) {
  const p = g.path; // MUST force lazy parsing and composite expansion before getContours().
  if (outline === 'quadratic') return g.getContours().map((contour) => contour.map((pt) => [q(pt.x), q(pt.y), pt.onCurve ? 1 : 0]));
  const contours = [];
  let current = null;
  for (const c of p.commands) {
    switch (c.type) {
      case 'M':
        if (current) throw Error('Unclosed CFF contour');
        current = [[q(c.x), q(c.y), 1]];
        break;
      case 'L':
        if (!current) throw Error('CFF line without contour');
        current.push([q(c.x), q(c.y), 1]);
        break;
      case 'C':
        if (!current) throw Error('CFF cubic without contour');
        current.push([q(c.x1), q(c.y1), 0], [q(c.x2), q(c.y2), 0], [q(c.x), q(c.y), 1]);
        break;
      case 'Z':
        if (!current) throw Error('CFF close without contour');
        contours.push(current);
        current = null;
        break;
      default:
        throw Error('Unsupported CFF command ' + c.type);
    }
  }
  if (current) throw Error('Unclosed CFF contour');
  return contours;
}
fs.mkdirSync(opt.out, { recursive: true });
function write(name, obj) {
  fs.writeFileSync(path.join(opt.out, name), gzipSync(Buffer.from(JSON.stringify(obj)), { level: 7 }));
}
const map = Object.entries(font.encoding.cmap.glyphIndexMap)
  .map(([c, g]) => [Number(c), Number(g)])
  .filter(([c, g]) => Number.isInteger(c) && c >= 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) && Number.isInteger(g) && g > 0 && g < font.numGlyphs)
  .sort((a, b) => a[0] - b[0]);
const cps = [],
  gids = [];
let lastCp = 0,
  lastGid = 0;
for (const [cp, gid] of map) {
  cps.push(cp - lastCp);
  gids.push(gid - lastGid);
  lastCp = cp;
  lastGid = gid;
}
let pointTotal = 0,
  contourTotal = 0;
for (let base = 0; base < font.numGlyphs; base += shardSize) {
  const contourCounts = [],
    pointCounts = [],
    coords = [],
    flags = [],
    advances = [],
    bearings = [];
  let px = 0,
    py = 0;
  for (let id = base; id < Math.min(base + shardSize, font.numGlyphs); id++) {
    const g = font.glyphs.get(id),
      contours = contoursFor(g);
    contourCounts.push(contours.length);
    advances.push(g.advanceWidth ?? 0);
    bearings.push(g.leftSideBearing ?? 0);
    for (const contour of contours) {
      if (!contour.length) throw Error('Empty contour');
      pointCounts.push(contour.length);
      for (const [x, y, on] of contour) {
        // delta of quantized coordinates across the shard; encoded in design units.
        coords.push((x - px) / precision, (y - py) / precision);
        px = x;
        py = y;
        flags.push(on);
      }
    }
  }
  const bits = Buffer.alloc(Math.ceil(flags.length / 8));
  for (let i = 0; i < flags.length; i++) if (flags[i]) bits[i >> 3] |= 1 << (i & 7);
  write(`glyphs-${Math.floor(base / shardSize)}.gz`, { version: 2, faceId, base, contourCounts, pointCounts, coords, onCurve: bits.toString('base64'), advances, bearings });
  pointTotal += flags.length;
  contourTotal += pointCounts.length;
}
write('index.gz', { version: 2, faceId, weight: 400, outline, coordinatePrecision: precision, unitsPerEm: font.unitsPerEm, ascender: font.ascender, descender: font.descender, lineGap: font.tables.hhea?.lineGap || 0, glyphCount: font.numGlyphs, shardSize, codePointDeltas: cps, glyphIdDeltas: gids });
console.log(`Extracted ${font.numGlyphs} ${outline} glyphs, ${map.length} mappings, ${contourTotal} contours, ${pointTotal} vertices; face ${faceId}`);
