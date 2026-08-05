/*
 * font        : ./fonts/NotoSansTC-Regular.ttf  (./fonts/NotoSansTC-Regular.ttf)
 * unitsPerEm  : 1000
 * codepoints  : 15542 covered, 5609 uncovered
 * kern pairs  : 0 (disabled)
 * ligatures   : 0 (disabled)
 *
 * width = (fontSize/unitsPerEm) * Σ(advance + kern) + letterSpacing*chars + wordSpacing*spaces
 */
'use strict';
const UPEM = 1000;
const KEY_BASE = 1114112;

function advanceOf(c) {
  // ── contiguous ranges: char-code comparison + if/else chain ──
  if (c >= 48 && c <= 57) return 555; // 0..9
  // ── scattered outliers: switch-case, grouped by shared advance ──
  switch (c) {
    case 12330: case 12331: case 12332: case 12333: return 0; // U+302A U+302B U+302C U+302D
    case 32: return 224; // U+0020
    case 12334: case 12335: return 250; // U+302E U+302F
    case 124: return 270; // |
    case 105: case 106: return 275; // i j
    case 39: case 44: case 46: case 58: case 59: return 278; // ' , . : ;
    case 108: return 284; // l
    case 73: return 293; // I
    case 33: return 323; // !
    case 102: return 325; // f
    case 40: case 41: case 91: case 93: case 123: case 125: return 338; // ( ) [ ] { }
    case 45: return 347; // -
    case 116: return 377; // t
    case 114: return 388; // r
    case 47: case 92: return 392; // U+002F \
    case 42: return 467; // *
    case 115: return 468; // s
    case 34: case 63: return 474; // " ?
    case 122: return 475; // z
    case 120: return 498; // x
    case 99: return 510; // c
    case 118: case 121: return 521; // v y
    case 89: return 531; // Y
    case 74: return 535; // J
    case 76: return 543; // L
    case 70: case 107: return 552; // F k
    case 101: return 554; // e
    case 35: case 36: case 43: case 60: case 61: case 62: case 94: case 126: return 555; // # $ + < = > ^ ~
    case 95: return 559; // _
    case 97: return 563; // a
    case 103: return 564; // g
    case 88: return 573; // X
    case 86: return 575; // V
    case 69: return 589; // E
    case 83: return 596; // S
    case 84: return 599; // T
    case 90: return 603; // Z
    case 96: case 111: return 606; // ` o
    case 104: case 117: return 607; // h u
    case 65: return 608; // A
    case 110: return 610; // n
    case 98: return 618; // b
    case 100: case 112: case 113: return 620; // d p q
    case 80: return 633; // P
    case 82: return 635; // R
    case 67: return 638; // C
    case 75: return 646; // K
    case 66: return 657; // B
    case 38: return 680; // &
    case 68: return 688; // D
    case 71: return 689; // G
    case 85: return 721; // U
    case 78: return 723; // N
    case 72: return 728; // H
    case 79: case 81: return 742; // O Q
    case 119: return 802; // w
    case 77: return 812; // M
    case 87: return 878; // W
    case 37: return 921; // %
    case 109: return 926; // m
    case 64: return 946; // @
  }
  return 1000; // default / uncovered
}

const KERN = null;

const LIGA = null;


/**
 * @param {string} text
 * @param {number} fontSize (px, matches ctx.font size)
 * @param {number} ls letter spacing (px)
 * @param {number} ws word spacing (px)
 * @returns {number} advance width in CSS px
 */
function measureTextWidth(text, fontSize = 16, ls = 0, ws = 0) {
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

measureTextWidth.unitsPerEm = UPEM;
measureTextWidth.advanceOf = advanceOf;
if (typeof module !== 'undefined') module.exports = measureTextWidth;
