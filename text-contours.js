const fs = require('node:fs');
const opentype = require('opentype.js');
const { deltaEncode } = require('./delta');
const path = require('node:path');
const { gzipSync } = require('fflate');

const argv = process.argv.slice(2);
const opt = { font: null, out: 'contours' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--font') opt.font = argv[++i];
  else if (a === '--out') opt.out = argv[++i];
}
if (!opt.font) {
  console.error('usage: text-contours.js --font <file> --out <name>');
  process.exit(1);
}

const gzipOptions = { level: 7 };
const encoder = new TextEncoder();

function main() {
  const fontFile = fs.readFileSync(opt.font);
  const font = opentype.parse(fontFile);
  const UPEM = font.unitsPerEm;

  const list = [];
  for (let i = 0; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i);
    const unicode = glyph.unicode;
    if (!Number.isFinite(unicode)) continue;
    list.push([i, unicode]);
  }
  list.sort(function (a, b) {
    return a[1] - b[1];
  });
  const len = list.length;

  const unicodes = [];
  const onCurveFlags = [];
  const coordinates = [];
  const contourStartIndices = [0];
  const charStartIndices = [0];

  for (let i = 0; i < len; i++) {
    const glyph = font.glyphs.get(list[i][0]);
    const contours = glyph.getContours();
    const unicode = glyph.unicode;
    if (!Number.isFinite(unicode)) continue;
    for (const contour of contours) {
      for (const point of contour) {
        coordinates.push(point.x, point.y);
        onCurveFlags.push(point.onCurve ? 1 : 0);
      }
      contourStartIndices.push(coordinates.length / 2);
    }
    unicodes.push(unicode);
    charStartIndices.push(contourStartIndices.length - 1);
  }

  fs.writeFileSync(
    path.join(`${opt.out}.gz`),
    Buffer.from(
      gzipSync(
        encoder.encode(
          JSON.stringify({
            unitsPerEm: UPEM,
            unicodes: deltaEncode(unicodes, 1),
            onCurveFlags: onCurveFlags,
            coordinates: deltaEncode(coordinates, 2),
            contourStartIndices: deltaEncode(contourStartIndices, 1),
            charStartIndices: deltaEncode(charStartIndices, 1)
          })
        ),
        gzipOptions
      )
    )
  );
}

main();
