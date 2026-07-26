/* forked from https://github.com/EricHsia7/auto-dark-mode/tree/main/src/lib */

function getPerChannelDifference(r, g, b) {
  return [Math.abs(r - g), Math.abs(g - b), Math.abs(b - r)];
}

function computeStats(colors) {
  const n = colors.length;
  let RG_total = 0,
    GB_total = 0,
    BR_total = 0;
  let RG_sq = 0,
    GB_sq = 0,
    BR_sq = 0;

  for (const c of colors) {
    const [prg, pgb, pbr] = getPerChannelDifference(c[0], c[1], c[2]);
    RG_total += prg;
    RG_sq += Math.pow(prg, 2);
    GB_total += pgb;
    GB_sq += Math.pow(pgb, 2);
    BR_total += pbr;
    BR_sq += Math.pow(pbr, 2);
  }

  const RG_avg = RG_total / n;
  const GB_avg = GB_total / n;
  const BR_avg = BR_total / n;

  const RG_stdev = Math.sqrt(RG_sq / n - Math.pow(RG_avg, 2));
  const GB_stdev = Math.sqrt(GB_sq / n - Math.pow(GB_avg, 2));
  const BR_stdev = Math.sqrt(BR_sq / n - Math.pow(BR_avg, 2));

  return {
    n,
    avg: [RG_avg, GB_avg, BR_avg],
    stdev: [RG_stdev, GB_stdev, BR_stdev]
  };
}

function mergeStats(avg1, stdev1, n1, avg2, stdev2, n2) {
  const merged_n = n1 + n2;
  const merged_avg = (n1 * avg1 + n2 * avg2) / merged_n;
  const merged_var = (n1 * (Math.pow(stdev1, 2) + Math.pow(avg1, 2)) + n2 * (Math.pow(stdev2, 2) + Math.pow(avg2, 2))) / merged_n - Math.pow(merged_avg, 2);
  return [merged_avg, Math.sqrt(merged_var)];
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

const baseColors = [
  [255, 255, 255],
  [192, 192, 192],
  [128, 128, 128],
  [64, 64, 64],
  [0, 0, 0],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255]
];

const baseStats = computeStats(baseColors); // Precompute once

function getColorVibrancy(red, green, blue) {
  const [prg, pgb, pbr] = getPerChannelDifference(red, green, blue);

  const [RG_avg, RG_stdev] = mergeStats(baseStats.avg[0], baseStats.stdev[0], baseStats.n, prg, 0, 1);
  const [GB_avg, GB_stdev] = mergeStats(baseStats.avg[1], baseStats.stdev[1], baseStats.n, pgb, 0, 1);
  const [BR_avg, BR_stdev] = mergeStats(baseStats.avg[2], baseStats.stdev[2], baseStats.n, pbr, 0, 1);

  const d = (prg - RG_avg) / RG_stdev;
  const e = (pgb - GB_avg) / GB_stdev;
  const f = (pbr - BR_avg) / BR_stdev;

  return (d + e + f) / 3;
}

const mergedNumber = baseStats.n + 1;
const a = (baseStats.avg[0] * baseStats.n) / mergedNumber;
const b = (baseStats.avg[1] * baseStats.n) / mergedNumber;
const c = (baseStats.avg[2] * baseStats.n) / mergedNumber;
const x = (Math.pow(baseStats.stdev[0], 2) + Math.pow(baseStats.avg[0], 2)) * baseStats.n;
const y = (Math.pow(baseStats.stdev[1], 2) + Math.pow(baseStats.avg[1], 2)) * baseStats.n;
const z = (Math.pow(baseStats.stdev[2], 2) + Math.pow(baseStats.avg[2], 2)) * baseStats.n;

function invertRGB(red, green, blue, darkened = true) {
  if (red === 0 && green === 0 && blue === 0) {
    if (darkened) return [red, green, blue];
    return [255, 255, 255];
  }

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);

  const minimumValue = 6 / 85;
  const saturation = (max - min) / max;

  const equalizerBase = Math.sqrt(saturation);
  const equalizer = -0.1 + equalizerBase * 1.1;

  const average = (red + green + blue) / 3;
  const R = red * (1 - equalizer) + average * equalizer;
  const G = green * (1 - equalizer) + average * equalizer;
  const B = blue * (1 - equalizer) + average * equalizer;

  const equalizedValue = Math.max(R, G, B) / 255;
  const newValue = minimumValue + (1 - minimumValue) * (1 - equalizedValue);

  if (darkened && newValue > equalizedValue) return [red, green, blue];

  const scaler = newValue / equalizedValue;
  const ratio = (getColorVibrancy(red, green, blue) + 0.49) / 2;
  const R1 = clamp(0, Math.round(R * scaler * (1 - ratio) + red * ratio), 255);
  const G1 = clamp(0, Math.round(G * scaler * (1 - ratio) + green * ratio), 255);
  const B1 = clamp(0, Math.round(B * scaler * (1 - ratio) + blue * ratio), 255);

  return [R1, G1, B1];
}
/*
  color = (r,g,b) where 0 <= r, g, b <= 1
  scaler = t where 0 < t <= 1
  newColor = color' = t * color = (tr,tg,tb)

  value:      v = max(r,g,b)
              v' = max(tr,tg,tb) = tv
  chroma:     c = v - min(r,g,b) = max(r,g,b) - min(r,g,b)
              c' = v' - min(tr,tg,tb) = max(tr,tg,tb) - min(tr,tg,tb) = t (max(r,g,b) - min(r,g,b)) = tc
  saturation: s = 0 [if v = 0], c / v [otherwise]
              s' = c' / v' = 0 [if tv = 0], tc / tv [otherwise]
  hue:        h = 60 * (g - b) / c [if v = r], 60 * (2 + (b - r) / c) [if v = g], 60 * (4 + (r - g) / c) [if v = b]
              h' = 60 * (tg - tb) / tc [if tv = tr], 60 * (2 + (tb - tr) / tc) [if tv = tg], 60 * (4 + (tr - tg) / tc) [if tv = tb]
  h' = h and s' = s and v' = tv
*/

module.exports = {
  invertRGB
};

// console.log(invertRGB(240, 243, 247)); // land-color
