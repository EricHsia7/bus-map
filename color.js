/* forked from https://github.com/EricHsia7/auto-dark-mode/tree/main/src/lib */

function looksLikeColorValue(value) {
  value = value.trim().toLowerCase();

  // check for hex codes
  if (/^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(value)) {
    return true;
  }

  // other formats
  if (/^(rgb|rgba|hsl|hsla|hwb|linear-gradient|-webkit-linear-gradient|radial-gradient|-webkit-radial-gradient|conic-gradient|-webkit-conic-gradient|var|lighten|darken|saturate|desaturate|greyscale|grayscale|spin|fadein|fadeout|fade|mix|tint|shade)\(/i.test(value)) {
    if (!/calc\(.*\)/i.test(value) && !/clamp\(.*\)/i.test(value)) {
      return true;
    }
  }

  // transparent
  if (value.toLowerCase() === 'transparent') {
    return true;
  }

  // currentColor
  if (value.toLowerCase() === 'currentcolor') {
    return true;
  }

  // named colors
  if (namedColors.hasOwnProperty(value.toLowerCase())) {
    return true;
  }

  // system colors
  if (systemColors.hasOwnProperty(value.toLowerCase())) {
    return true;
  }

  return false;
}

const cssDelimiters = {
  'linear-gradient': [','],
  'radial-gradient': [','],
  'conic-gradient': [','],
  'rgb': [',', ' ', '/'],
  'rgba': [',', ' '],
  'hsl': [',', ' ', '/'],
  'hsla': [',', ' '],
  'hwb': [' ', ',', '/'],
  'var': [','],
  'color-mix': [',', '/'],
  'calc': [],
  'default': [',', ' ']
};

const cssPrimaryDelimiters = {
  'linear-gradient': ',',
  'radial-gradient': ',',
  'conic-gradient': ',',
  'rgb': ',',
  'rgba': ',',
  'hsl': ',',
  'hsla': ',',
  'hwb': ' ',
  'var': ',',
  'color-mix': ',',
  'calc': '',
  'default': ' '
};

function isTopLevelModel(value) {
  const trimmed = value.trim();
  const trimmedLen = trimmed.length;
  let leftBracket = 0;
  let rightBracket = 0;
  let depth = 0;
  let pairs = 0;
  let lastRightBracketIndex = -1;
  let firstLeftBracketIndex = trimmedLen - 1;
  for (let i = 0, l = trimmedLen; i < l; i++) {
    const char = trimmed[i];
    if (char === '(') {
      if (leftBracket === 0) firstLeftBracketIndex = i;
      leftBracket++;
      depth++;
    } else if (char === ')') {
      rightBracket++;
      depth--;
    }
    if (leftBracket === rightBracket && depth === 0 && char === ')') {
      pairs++;
      lastRightBracketIndex = i;
    }
    if (pairs > 1) {
      return false;
    }
  }
  if (pairs === 1) {
    // Check for any whitespace in the model name
    if (/\s+/g.test(trimmed.slice(0, firstLeftBracketIndex))) {
      return false;
    }
    // Check for any non-whitespace after the last closing parenthesis
    if (trimmedLen - 1 > lastRightBracketIndex) {
      return false;
    }
    return true;
  } else {
    return false;
  }
}

function splitByTopLevelDelimiter(value, legalDelimiters = [' ', ',']) {
  value = value.trim();
  let leftBracket = 0;
  let rightBracket = 0;
  let start = 0;
  const result = [];
  const delimiters = [];
  const len = value.length;
  for (let i = 0, l = len, l1 = len - 1; i < l; i++) {
    const char = value[i];
    if (char === '(') {
      leftBracket++;
    }
    if (char === ')') {
      rightBracket++;
    }
    if (leftBracket === rightBracket) {
      if (legalDelimiters.indexOf(char) > -1) {
        result.push(value.slice(start, i).trim());
        delimiters.push(char);
        start = i + 1;
      } else if (i === l1) {
        result.push(value.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  return { result, delimiters };
}

function stripTopLevelModel(value) {
  const trimmed = value.trim();
  const trimmedLen = trimmed.length;
  let start = 0;
  let end = 0;
  for (let i = 0, l = trimmedLen; i < l; i++) {
    const char = trimmed[i];
    if (char === '(') {
      start = i;
      break;
    }
  }
  for (let i = trimmedLen - 1; i >= start; i--) {
    const char = trimmed[i];
    if (char === ')') {
      end = i;
      break;
    }
  }
  return {
    result: trimmed.slice(start + 1, end).trim(),
    model: trimmed.slice(0, start).trim()
  };
}

function parseNumber(value) {
  if (/^[-+]?[0-9]+$/.test(value)) {
    // integer
    return {
      type: 'number',
      number: parseInt(value, 10),
      unit: ''
    };
  }

  if (/^[-+]?[0-9]*\.?[0-9]+$/.test(value)) {
    // float
    return {
      type: 'number',
      number: parseFloat(value),
      unit: ''
    };
  }

  const unitedIntegerMatch = value.match(/^([-+]?[0-9]+)([a-z%]+)$/i);
  if (unitedIntegerMatch) {
    // integer with unit
    return {
      type: 'number',
      number: parseInt(unitedIntegerMatch[1], 10),
      unit: unitedIntegerMatch[2].trim()
    };
  }

  const unitedFloatMatch = value.match(/^([-+]?[0-9]*\.?[0-9]+)([a-z%]+)$/i);
  if (unitedFloatMatch) {
    // float with unit
    return {
      type: 'number',
      number: parseFloat(unitedFloatMatch[1]),
      unit: unitedFloatMatch[2].trim()
    };
  }

  return undefined;
}

function parseModel(value) {
  if (isTopLevelModel(value)) {
    const strippedModel = stripTopLevelModel(value);
    const legalDelimiters = cssDelimiters[strippedModel.model] || cssDelimiters['default'];
    const array = splitByTopLevelDelimiter(strippedModel.result, legalDelimiters);

    const parsedComponents = array.result.map((a) => parseComponent(a)).filter((b) => b !== undefined);

    return {
      type: 'model',
      model: strippedModel.model,
      components: parsedComponents
    };
  }

  return undefined;
}

function parseComponent(value) {
  const parsedNumberComponent = parseNumber(value);
  if (parsedNumberComponent !== undefined) {
    return parsedNumberComponent;
  }

  const parsedModelComponent = parseModel(value);
  if (parsedModelComponent !== undefined) {
    return parsedModelComponent;
  }

  if (value !== '') {
    return {
      type: 'string',
      string: value
    };
  }

  return undefined;
}

function stringifyComponent(component) {
  if (component === undefined) return '';

  if (component.type === 'number') {
    return `${component.number}${component.unit}`;
  }

  if (component.type === 'string') {
    return component.string;
  }

  if (component.type === 'model') {
    // Join subcomponents with a delimiter (or use a white space by default)
    const delimiter = cssPrimaryDelimiters[component.model] || cssPrimaryDelimiters['default'];
    const inner = component.components.map((e) => stringifyComponent(e)).join(delimiter);
    return `${component.model}(${inner})`;
  }

  return '';
}

const namedColors = {
  aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215],
  aqua: [0, 255, 255],
  aquamarine: [127, 255, 212],
  azure: [240, 255, 255],
  beige: [245, 245, 220],
  bisque: [255, 228, 196],
  black: [0, 0, 0],
  blanchedalmond: [255, 235, 205],
  blue: [0, 0, 255],
  blueviolet: [138, 43, 226],
  brown: [165, 42, 42],
  burlywood: [222, 184, 135],
  cadetblue: [95, 158, 160],
  chartreuse: [127, 255, 0],
  chocolate: [210, 105, 30],
  coral: [255, 127, 80],
  cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220],
  crimson: [220, 20, 60],
  cyan: [0, 255, 255],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkgoldenrod: [184, 134, 11],
  darkgray: [169, 169, 169],
  darkgreen: [0, 100, 0],
  darkgrey: [169, 169, 169],
  darkkhaki: [189, 183, 107],
  darkmagenta: [139, 0, 139],
  darkolivegreen: [85, 107, 47],
  darkorange: [255, 140, 0],
  darkorchid: [153, 50, 204],
  darkred: [139, 0, 0],
  darksalmon: [233, 150, 122],
  darkseagreen: [143, 188, 143],
  darkslateblue: [72, 61, 139],
  darkslategray: [47, 79, 79],
  darkslategrey: [47, 79, 79],
  darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34],
  floralwhite: [255, 250, 240],
  forestgreen: [34, 139, 34],
  fuchsia: [255, 0, 255],
  gainsboro: [220, 220, 220],
  ghostwhite: [248, 248, 255],
  gold: [255, 215, 0],
  goldenrod: [218, 165, 32],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  greenyellow: [173, 255, 47],
  grey: [128, 128, 128],
  honeydew: [240, 255, 240],
  hotpink: [255, 105, 180],
  indianred: [205, 92, 92],
  indigo: [75, 0, 130],
  ivory: [255, 255, 240],
  khaki: [240, 230, 140],
  lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245],
  lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgoldenrodyellow: [250, 250, 210],
  lightgray: [211, 211, 211],
  lightgreen: [144, 238, 144],
  lightgrey: [211, 211, 211],
  lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122],
  lightseagreen: [32, 178, 170],
  lightskyblue: [135, 206, 250],
  lightslategray: [119, 136, 153],
  lightslategrey: [119, 136, 153],
  lightsteelblue: [176, 196, 222],
  lightyellow: [255, 255, 224],
  lime: [0, 255, 0],
  limegreen: [50, 205, 50],
  linen: [250, 240, 230],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  mediumaquamarine: [102, 205, 170],
  mediumblue: [0, 0, 205],
  mediumorchid: [186, 85, 211],
  mediumpurple: [147, 112, 219],
  mediumseagreen: [60, 179, 113],
  mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154],
  mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250],
  mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181],
  navajowhite: [255, 222, 173],
  navy: [0, 0, 128],
  oldlace: [253, 245, 230],
  olive: [128, 128, 0],
  olivedrab: [107, 142, 35],
  orange: [255, 165, 0],
  orangered: [255, 69, 0],
  orchid: [218, 112, 214],
  palegoldenrod: [238, 232, 170],
  palegreen: [152, 251, 152],
  paleturquoise: [175, 238, 238],
  palevioletred: [219, 112, 147],
  papayawhip: [255, 239, 213],
  peachpuff: [255, 218, 185],
  peru: [205, 133, 63],
  pink: [255, 192, 203],
  plum: [221, 160, 221],
  powderblue: [176, 224, 230],
  purple: [128, 0, 128],
  rebeccapurple: [102, 51, 153],
  red: [255, 0, 0],
  rosybrown: [188, 143, 143],
  royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19],
  salmon: [250, 128, 114],
  sandybrown: [244, 164, 96],
  seagreen: [46, 139, 87],
  seashell: [255, 245, 238],
  sienna: [160, 82, 45],
  silver: [192, 192, 192],
  skyblue: [135, 206, 235],
  slateblue: [106, 90, 205],
  slategray: [112, 128, 144],
  slategrey: [112, 128, 144],
  snow: [255, 250, 250],
  springgreen: [0, 255, 127],
  steelblue: [70, 130, 180],
  tan: [210, 180, 140],
  teal: [0, 128, 128],
  thistle: [216, 191, 216],
  tomato: [255, 99, 71],
  turquoise: [64, 224, 208],
  violet: [238, 130, 238],
  wheat: [245, 222, 179],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245],
  yellow: [255, 255, 0],
  yellowgreen: [154, 205, 50]
};

const systemColors = {
  canvas: [255, 255, 255],
  canvastext: [0, 0, 0],
  linktext: [0, 136, 255],
  visitedtext: [97, 85, 245],
  activetext: [0, 136, 255],
  buttonface: [192, 192, 192],
  buttontext: [0, 0, 0],
  field: [255, 255, 255],
  fieldtext: [0, 0, 0],
  highlight: [181, 213, 255],
  highlighttext: [0, 0, 0],
  graytext: [128, 128, 128],
  mark: [247, 209, 84],
  marktext: [0, 0, 0],
  selecteditem: [128, 128, 128],
  selecteditemtext: [0, 0, 0]
};

const CSSColors = ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'color-mix'];
const CSSGradients = ['linear-gradient', 'radial-gradient', 'conic-gradient'];
const CSSAdjusters = ['lighten', 'darken', 'saturate', 'desaturate', 'greyscale', 'grayscale', 'spin', 'fadein', 'fadeout', 'fade', 'mix', 'tint', 'shade'];

function isColor(modelComponent) {
  return CSSColors.indexOf(modelComponent.model) > -1;
}

function isGradient(modelComponent) {
  return CSSGradients.indexOf(modelComponent.model) > -1;
}

function isVariable(modelComponent) {
  return modelComponent.model === 'var';
}

function isCalc(modelComponent) {
  return modelComponent.model === 'calc';
}

function isAdjuster(modelComponent) {
  return CSSAdjusters.indexOf(modelComponent.model) > -1;
}

function parseCSSModel(value) {
  const object = parseComponent(value);
  if (object === undefined) {
    return undefined;
  }

  if (object.type === 'string') {
    if (/^#[a-f0-9]{3,8}/i.test(object.string)) {
      const string = object.string;
      const len = string.length;

      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      switch (len) {
        case 4:
          // #fff
          red = parseInt(string[1] + string[1], 16);
          green = parseInt(string[2] + string[2], 16);
          blue = parseInt(string[3] + string[3], 16);
          alpha = 1;
          break;
        case 7:
          // #ffffff
          red = parseInt(string.slice(1, 3), 16);
          green = parseInt(string.slice(3, 5), 16);
          blue = parseInt(string.slice(5, 7), 16);
          alpha = 1;
          break;
        case 9:
          // #ffffffff
          red = parseInt(string.slice(1, 3), 16);
          green = parseInt(string.slice(3, 5), 16);
          blue = parseInt(string.slice(5, 7), 16);
          alpha = parseInt(string.slice(7, 9), 16) / 255;
          break;
        default:
          return undefined;
          break;
      }

      if (alpha === 1) {
        const result = {
          type: 'model',
          model: 'rgb',
          components: [
            { type: 'number', number: red, unit: '' },
            { type: 'number', number: green, unit: '' },
            { type: 'number', number: blue, unit: '' }
          ]
        };
        return result;
      } else {
        const result = {
          type: 'model',
          model: 'rgba',
          components: [
            { type: 'number', number: red, unit: '' },
            { type: 'number', number: green, unit: '' },
            { type: 'number', number: blue, unit: '' },
            { type: 'number', number: alpha, unit: '' }
          ]
        };
        return result;
      }
    }

    if (object.string === 'transparent') {
      const result = {
        type: 'model',
        model: 'rgba',
        components: [
          { type: 'number', number: 0, unit: '' },
          { type: 'number', number: 0, unit: '' },
          { type: 'number', number: 0, unit: '' },
          { type: 'number', number: 0, unit: '' }
        ]
      };
      return result;
    }

    if (namedColors.hasOwnProperty(object.string)) {
      const foundRGB = namedColors[object.string];
      const result = {
        type: 'model',
        model: 'rgb',
        components: [
          { type: 'number', number: foundRGB[0], unit: '' },
          { type: 'number', number: foundRGB[1], unit: '' },
          { type: 'number', number: foundRGB[2], unit: '' }
        ]
      };
      return result;
    }

    if (systemColors.hasOwnProperty(object.string)) {
      const foundRGB = systemColors[object.string];
      const result = {
        type: 'model',
        model: 'rgb',
        components: [
          { type: 'number', number: foundRGB[0], unit: '' },
          { type: 'number', number: foundRGB[1], unit: '' },
          { type: 'number', number: foundRGB[2], unit: '' }
        ]
      };
      return result;
    }
  }

  if (object.type === 'number') {
    return undefined;
  }

  if (object.type === 'model') {
    if (isColor(object) || isGradient(object) || isVariable(object) || isCalc(object) || isAdjuster(object)) {
      return object;
    }
  }

  return undefined;
}

const toGRAD = 0.9; // 400grad = 1 full circle = 360deg
const toRAD = 180 / Math.PI;
const toTURN = 360;

function toArgumentAngle(deg) {
  if (0 <= deg && deg < 360) {
    return deg;
  }
  return deg % 360;
}

function angleToDegrees(numberComponent) {
  switch (numberComponent.unit) {
    case 'deg':
      return toArgumentAngle(numberComponent.number);
      break;
    case 'grad':
      return toArgumentAngle(numberComponent.number * toGRAD);
      break;
    case 'rad':
      return toArgumentAngle(numberComponent.number * toRAD);
      break;
    case 'turn':
      return toArgumentAngle(numberComponent.number * toTURN);
      break;
    default:
      return 0;
      break;
  }
}

function clamp(min, value, max) {
  if (value < min) {
    return min;
  } else if (value > max) {
    return max;
  } else {
    return value;
  }
}

const CSSLengthUnits = ['%', 'Q', 'cap', 'ch', 'cm', 'cqb', 'cqh', 'cqi', 'cqmax', 'cqmin', 'cqw', 'dvh', 'dvw', 'em', 'ic', 'in', 'lh', 'lvh', 'mm', 'pc', 'pt', 'px', 'rcap', 'rch', 'rem', 'ric', 'rlh', 'svh', 'svw', 'vb', 'vh', 'vi', 'vmax', 'vmin', 'vw'];

const CSSAngleUnits = ['deg', 'grad', 'rad', 'turn'];

function isPercentage(numberComponent) {
  return numberComponent.unit === '%';
}

function isLength(numberComponent) {
  if (numberComponent.number === 0 && numberComponent.unit === '') {
    return true;
  }

  if (CSSLengthUnits.indexOf(numberComponent.unit) > -1) {
    return true;
  }

  return false;
}

function isAngle(numberComponent) {
  if (numberComponent.number === 0 && numberComponent.unit === '') {
    return true;
  }

  if (CSSAngleUnits.indexOf(numberComponent.unit) > -1) {
    return true;
  }

  return false;
}

function hslToRgb(hue, saturation, lightness) {
  const i = hue / 60;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((i % 2) - 1));
  const m = lightness - c / 2;

  const pattern = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x]
  ][Math.floor(i) % 6];

  const [R, G, B] = pattern;

  // Convert to 0–255 and return
  const R1 = Math.round((R + m) * 255);
  const G1 = Math.round((G + m) * 255);
  const B1 = Math.round((B + m) * 255);

  return [R1, G1, B1];
}

function hwbToRgb(hue, white, black) {
  if (white + black >= 1) {
    const gray = Math.round((white / (white + black)) * 255);
    return [gray, gray, gray];
  }
  const [r, g, b] = hslToRgb(hue, 1, 0.5);
  const x = 1 - white - black;
  const y = white * 255;

  const R = Math.round(x * r + y);
  const G = Math.round(x * g + y);
  const B = Math.round(x * b + y);

  return [R, G, B];
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function numberComponentValue(component, fallback) {
  if (component && component.type === 'number') {
    return component.number;
  }
  return fallback;
}

// Resolve a parsed component (nested color model or color string) to rgba.
function componentToRGBA(component) {
  if (!component) return undefined;
  if (component.type === 'model') {
    return extractRGBA(component);
  }
  if (component.type === 'string') {
    const parsed = parseCSSModel(component.string);
    if (parsed !== undefined) {
      return extractRGBA(parsed);
    }
  }
  return undefined;
}

// LESS mix(): weight is the proportion (0-1) of color1.
function mixRGBA(color1, color2, weight) {
  const p = weight;
  const w = p * 2 - 1;
  const a = color1[3] - color2[3];
  const w1 = ((w * a === -1 ? w : (w + a) / (1 + w * a)) + 1) / 2;
  const w2 = 1 - w1;
  return [Math.round(color1[0] * w1 + color2[0] * w2), Math.round(color1[1] * w1 + color2[1] * w2), Math.round(color1[2] * w1 + color2[2] * w2), color1[3] * p + color2[3] * (1 - p)];
}

function rgbaToString(rgba) {
  const [r, g, b, a] = rgba;
  const alpha = Math.round(a * 1000) / 1000;
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}

function extractRGBA(modelComponent) {
  switch (modelComponent.model) {
    case 'rgb': {
      const [red, green, blue, alpha] = modelComponent.components;

      if (typeof red !== 'object' || typeof green !== 'object' || typeof blue !== 'object') return [0, 0, 0, 0];
      if (red?.type !== 'number' || green?.type !== 'number' || blue?.type !== 'number') return [0, 0, 0, 0];

      if (alpha === undefined) {
        return [red.number, green.number, blue.number, 1];
      } else if (alpha.type === 'number') {
        return [red.number, green.number, blue.number, alpha.number];
      }

      return [0, 0, 0, 0];
    }

    case 'rgba': {
      const [red, green, blue, alpha] = modelComponent.components;
      if (typeof red !== 'object' || typeof green !== 'object' || typeof blue !== 'object' || typeof alpha !== 'object') return [0, 0, 0, 0];
      if (red?.type !== 'number' || green?.type !== 'number' || blue?.type !== 'number' || alpha?.type !== 'number') return [0, 0, 0, 0];

      return [red.number, green.number, blue.number, alpha.number];
    }

    case 'hsl': {
      const [hue, saturation, lightness, alpha] = modelComponent.components;
      if (typeof hue !== 'object' || typeof saturation !== 'object' || typeof lightness !== 'object') return [0, 0, 0, 0];
      if (hue.type !== 'number' || saturation.type !== 'number' || lightness.type !== 'number') return [0, 0, 0, 0];
      if (hue.unit !== '' || saturation.unit !== '%' || lightness.unit !== '%') return [0, 0, 0, 0];

      const [R, G, B] = hslToRgb(hue.number, saturation.number / 100, lightness.number / 100);

      if (alpha === undefined) {
        return [R, G, B, 1];
      } else if (alpha.type === 'number') {
        return [R, G, B, alpha.number];
      }

      return [0, 0, 0, 0];
    }

    case 'hsla': {
      const [hue, saturation, lightness, alpha] = modelComponent.components;
      if (typeof hue !== 'object' || typeof saturation !== 'object' || typeof lightness !== 'object' || typeof alpha !== 'object') return [0, 0, 0, 0];
      if (hue.type !== 'number' || saturation.type !== 'number' || lightness.type !== 'number' || alpha.type !== 'number') return [0, 0, 0, 0];
      if (hue.unit !== '' || saturation.unit !== '%' || lightness.unit !== '%') return [0, 0, 0, 0];

      const [R, G, B] = hslToRgb(hue.number, saturation.number / 100, lightness.number / 100);

      return [R, G, B, alpha.number];
    }

    case 'hwb': {
      const [hue, white, black, alpha] = modelComponent.components;
      if (typeof hue !== 'object' || typeof black !== 'object' || typeof white !== 'object') return [0, 0, 0, 0];
      if (hue.type !== 'number' || white.type !== 'number' || black.type !== 'number') return [0, 0, 0, 0];
      if (!isAngle(hue)) return [0, 0, 0, 0];
      if (white.unit !== '' && white.unit !== '%') return [0, 0, 0, 0];
      if (black.unit !== '' && black.unit !== '%') return [0, 0, 0, 0];

      const [R, G, B] = hwbToRgb(angleToDegrees(hue.number), white.number / 100, black.number / 100);

      if (alpha === undefined) {
        return [R, G, B, 1];
      } else if (alpha.type === 'number') {
        return [R, G, B, alpha.number];
      }
    }

    case 'var': {
      const components = modelComponent.components;
      const componentsLen = components.length;
      const rgba = [0, 0, 0, 0];
      for (let i = componentsLen - 1; i >= 0; i--) {
        const component = components[i];
        if (component.type === 'model') {
          if (isColor(component) || isVariable(component)) {
            const extractedRGBA = extractRGBA(component);
            if (extractedRGBA[3] === 0) continue;
            rgba[0] += extractedRGBA[0] * extractedRGBA[3];
            rgba[1] += extractedRGBA[1] * extractedRGBA[3];
            rgba[2] += extractedRGBA[2] * extractedRGBA[3];
            rgba[3] += extractedRGBA[3];
          }
        } else if (component.type === 'string') {
          const parsed = parseCSSModel(component.string);
          if (parsed !== undefined) {
            if (isColor(parsed) || isVariable(parsed)) {
              const extractedRGBA = extractRGBA(parsed);
              if (extractedRGBA[3] === 0) continue;
              rgba[0] += extractedRGBA[0] * extractedRGBA[3];
              rgba[1] += extractedRGBA[1] * extractedRGBA[3];
              rgba[2] += extractedRGBA[2] * extractedRGBA[3];
              rgba[3] += extractedRGBA[3];
            }
          }
        }
      }

      if (rgba[3] === 0) return [0, 0, 0, 0];
      rgba[0] /= rgba[3];
      rgba[1] /= rgba[3];
      rgba[2] /= rgba[3];
      rgba[3] = clamp(0, rgba[3], 1);
      return rgba;
    }

    case 'lighten':
    case 'darken':
    case 'saturate':
    case 'desaturate':
    case 'greyscale':
    case 'grayscale': {
      const base = componentToRGBA(modelComponent.components[0]);
      if (base === undefined) return [0, 0, 0, 0];
      const hsl = rgbToHsl(base[0], base[1], base[2]);
      const amount = numberComponentValue(modelComponent.components[1], 0) / 100;
      switch (modelComponent.model) {
        case 'lighten':
          hsl.l = clamp(0, hsl.l + amount, 1);
          break;
        case 'darken':
          hsl.l = clamp(0, hsl.l - amount, 1);
          break;
        case 'saturate':
          hsl.s = clamp(0, hsl.s + amount, 1);
          break;
        case 'desaturate':
          hsl.s = clamp(0, hsl.s - amount, 1);
          break;
        case 'greyscale':
        case 'grayscale':
          hsl.s = 0;
          break;
      }
      const [R, G, B] = hslToRgb(hsl.h, hsl.s, hsl.l);
      return [R, G, B, base[3]];
    }

    case 'spin': {
      const base = componentToRGBA(modelComponent.components[0]);
      if (base === undefined) return [0, 0, 0, 0];
      const hsl = rgbToHsl(base[0], base[1], base[2]);
      const angle = numberComponentValue(modelComponent.components[1], 0);
      let hue = (hsl.h + angle) % 360;
      if (hue < 0) hue += 360;
      const [R, G, B] = hslToRgb(hue, hsl.s, hsl.l);
      return [R, G, B, base[3]];
    }

    case 'fadein':
    case 'fadeout':
    case 'fade': {
      const base = componentToRGBA(modelComponent.components[0]);
      if (base === undefined) return [0, 0, 0, 0];
      const amount = numberComponentValue(modelComponent.components[1], 0) / 100;
      let alpha;
      if (modelComponent.model === 'fadein') {
        alpha = base[3] + amount;
      } else if (modelComponent.model === 'fadeout') {
        alpha = base[3] - amount;
      } else {
        alpha = amount; // fade() sets absolute alpha
      }
      return [base[0], base[1], base[2], clamp(0, alpha, 1)];
    }

    case 'mix': {
      const color1 = componentToRGBA(modelComponent.components[0]);
      const color2 = componentToRGBA(modelComponent.components[1]);
      if (color1 === undefined || color2 === undefined) return [0, 0, 0, 0];
      const weight = numberComponentValue(modelComponent.components[2], 50) / 100;
      return mixRGBA(color1, color2, weight);
    }

    case 'tint': {
      const base = componentToRGBA(modelComponent.components[0]);
      if (base === undefined) return [0, 0, 0, 0];
      const weight = numberComponentValue(modelComponent.components[1], 50) / 100;
      return mixRGBA([255, 255, 255, 1], base, weight);
    }

    case 'shade': {
      const base = componentToRGBA(modelComponent.components[0]);
      if (base === undefined) return [0, 0, 0, 0];
      const weight = numberComponentValue(modelComponent.components[1], 50) / 100;
      return mixRGBA([0, 0, 0, 1], base, weight);
    }

    default:
      break;
  }

  return [0, 0, 0, 0];
}

module.exports = {
  looksLikeColorValue,
  parseCSSModel,
  extractRGBA,
  rgbaToString
};
