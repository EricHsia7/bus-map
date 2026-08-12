const measureTextWidth = require('./text-width.js');

const TAU = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;

const smoothing = 0.8;
const maxAngleDifference = 15 * DEG_TO_RAD;
const maxTotalAngle = 110 * DEG_TO_RAD;
const capHeightRatio = 0.72;
const sampleStepRatio = 1 / 3;
const paddingRatio = 1;
const repeatGapRatio = 8;
const tangentWindowRatio = 1 / 2;

function distance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Wrap an angle into (-PI, PI].
 */
function wrapAngle(angle) {
  return angle + TAU - Math.ceil((angle + Math.PI) / TAU) * TAU;
}

/**
 * Resample a polyline to approximately uniform arc-length spacing.
 *
 * This is important because OSM vertices are not uniformly distributed.
 * Glyph placement should operate in arc-length space rather than vertex space.
 */
function resamplePolyline(points, step) {
  if (points.length < 2 || step <= 0) {
    return points.map((p) => p.slice());
  }

  const result = [points[0].slice()];
  let remainder = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];

    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const segmentLength = Math.hypot(dx, dy);

    if (segmentLength === 0) continue;

    let consumed = 0;

    while (remainder + segmentLength - consumed >= step) {
      const distanceAlongSegment = consumed + step - remainder;
      const t = distanceAlongSegment / segmentLength;

      result.push([a[0] + dx * t, a[1] + dy * t]);

      consumed = distanceAlongSegment;
      remainder = 0;
    }

    remainder += segmentLength - consumed;
  }

  return result;
}

/**
 * Gaussian low-pass filter along arc length.
 */
function gaussianSmooth(points, sigma, step, closed = false) {
  if (sigma <= 0 || points.length < 2) {
    return points.map((p) => p.slice());
  }

  const radius = Math.max(1, Math.ceil((3 * sigma) / step));

  const weights = new Array(radius * 2 + 1);

  for (let k = -radius; k <= radius; k++) {
    weights[k + radius] = Math.exp(-((k * step) ** 2) / (2 * sigma * sigma));
  }

  const result = new Array(points.length);
  const n = points.length;

  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let weightSum = 0;

    for (let k = -radius; k <= radius; k++) {
      let index = i + k;

      if (closed) {
        index = ((index % n) + n) % n;
      } else if (index < 0 || index >= n) {
        continue;
      }

      const weight = weights[k + radius];

      x += points[index][0] * weight;
      y += points[index][1] * weight;
      weightSum += weight;
    }

    result[i] = [x / weightSum, y / weightSum];
  }

  // Preserve the exact endpoints of an open path.
  if (!closed) {
    result[0] = points[0].slice();
    result[n - 1] = points[n - 1].slice();
  }

  return result;
}

/**
 * Limit how far the smoothed spine may move away from the original path.
 */
function clampDeviation(smoothed, original, maxDeviation) {
  let largestDeviation = 0;

  for (let i = 0; i < smoothed.length; i++) {
    const dx = smoothed[i][0] - original[i][0];
    const dy = smoothed[i][1] - original[i][1];

    const deviation = Math.hypot(dx, dy);

    largestDeviation = Math.max(largestDeviation, Math.min(deviation, maxDeviation));

    if (deviation > maxDeviation && deviation > 0) {
      const scale = maxDeviation / deviation;

      smoothed[i][0] = original[i][0] + dx * scale;
      smoothed[i][1] = original[i][1] + dy * scale;
    }
  }

  return largestDeviation;
}

class Spine {
  constructor(points) {
    this.points = points;
    this.arcLengths = buildArcLengths(points);
    this.length = this.arcLengths.at(-1) ?? 0;
  }

  /**
   * Find the segment containing arc-length s.
   */
  segmentAt(s) {
    const lengths = this.arcLengths;

    let lo = 0;
    let hi = lengths.length - 1;

    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;

      if (lengths[mid] <= s) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    return lo;
  }

  pointAt(s) {
    s = clamp(s, 0, this.length);

    const i = this.segmentAt(s);

    const a = this.points[i];
    const b = this.points[i + 1] ?? a;

    const segmentLength = this.arcLengths[i + 1] - this.arcLengths[i];

    const t = segmentLength > 0 ? (s - this.arcLengths[i]) / segmentLength : 0;

    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  /**
   * Estimate the tangent angle using a window around s.
   *
   * Looking at a window instead of a single segment prevents tiny
   * geometric noise from producing large glyph rotations.
   */
  angleAt(s, window) {
    const a = this.pointAt(Math.max(0, s - window));

    const b = this.pointAt(Math.min(this.length, s + window));

    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  curvatureAt(s, halfWindow) {
    const a = this.angleAt(Math.max(0, s - halfWindow), halfWindow);

    const b = this.angleAt(Math.min(this.length, s + halfWindow), halfWindow);

    return Math.abs(wrapAngle(b - a)) / (2 * halfWindow);
  }
}

function buildArcLengths(points) {
  const lengths = new Array(points.length);

  lengths[0] = 0;

  for (let i = 1; i < points.length; i++) {
    lengths[i] = lengths[i - 1] + distance(points[i - 1], points[i]);
  }

  return lengths;
}

function clamp(value, min, max) {
  if (value < min) {
    return min;
  } else if (value > max) {
    return max;
  } else {
    return value;
  }
}

function buildGlyphs(text, fontSize, letterSpacing, wordSpacing) {
  const textLength = text.length;
  const result = [];
  for (let i = 0; i < textLength; i++) {
    result.push({
      char: text[i],
      advance: measureTextWidth(text[i], fontSize, letterSpacing, wordSpacing)
    });
  }
  return result;
}

function getGlyphRunLength(glyphs) {
  return glyphs.reduce((length, glyph) => length + glyph.advance, 0);
}

function prepareSpine(path, { fontSize, roadWidth, sampleStep }) {
  const resampled = resamplePolyline(path, sampleStep);

  if (resampled.length < 2) {
    return null;
  }

  const capHeight = capHeightRatio * fontSize;

  const sigma = smoothing * fontSize;

  const deviationBudget = Math.max(0, roadWidth / 2 - capHeight / 2 - 1);

  const smoothed = gaussianSmooth(resampled, sigma, sampleStep, false);

  const maxDeviation = clampDeviation(smoothed, resampled, deviationBudget);

  return {
    spine: new Spine(smoothed),
    source: new Spine(resampled),
    maxDeviation
  };
}

/**
 * Determine whether the label should be walked forward or backward.
 *
 * The direction is chosen from the average tangent over the entire
 * label window so that labels don't suddenly flip because of one
 * local segment.
 */
function chooseDirection(spine, start, length, tangentWindow) {
  let vx = 0;
  let vy = 0;

  for (let i = 0; i <= 8; i++) {
    const s = start + (length * i) / 8;

    const angle = spine.angleAt(s, tangentWindow);

    vx += Math.cos(angle);
    vy += Math.sin(angle);
  }

  if (vx < 0) {
    return -1;
  }

  // Near vertical: prefer downward screen direction.
  if (Math.abs(vx) < 1e-6 && vy < 0) {
    return -1;
  }

  return 1;
}

function layoutGlyphs(spine, start, glyphs, direction, fontSize, tangentWindow) {
  const capHeight = capHeightRatio * fontSize;

  const orderedGlyphs = direction > 0 ? glyphs : glyphs.slice().reverse();

  const placed = [];

  let s = start;
  let totalTurn = 0;
  let worstGlyphTurn = 0;
  let previousAngle = null;

  for (const glyph of orderedGlyphs) {
    const centerS = s + glyph.advance / 2;

    const tangent = spine.angleAt(centerS, tangentWindow);

    const angle = tangent + (direction < 0 ? Math.PI : 0);

    if (previousAngle !== null) {
      const turn = Math.abs(wrapAngle(angle - previousAngle));

      totalTurn += turn;
      worstGlyphTurn = Math.max(worstGlyphTurn, turn);
    }

    previousAngle = angle;

    const center = spine.pointAt(centerS);

    /*
     * The glyph center is placed at the cap-height
     * center of the path.
     *
     * Coordinate system:
     *   x → right
     *   y → down
     */
    const cx = center[0];
    const cy = center[1];

    const baselineX = cx - (capHeight / 2) * Math.sin(angle);

    const baselineY = cy + (capHeight / 2) * Math.cos(angle);

    const x = baselineX - (glyph.advance / 2) * Math.cos(angle);

    const y = baselineY - (glyph.advance / 2) * Math.sin(angle);

    placed.push({
      char: glyph.char,
      advance: glyph.advance,

      x,
      y,

      cx,
      cy,

      angle,
      tangent: angle,

      s: centerS
    });

    s += glyph.advance;
  }

  if (direction < 0) {
    placed.reverse();
  }

  return {
    glyphs: placed,
    usedLength: s - start,
    totalTurn,
    worstGlyphTurn,

    violates: worstGlyphTurn > maxAngleDifference
  };
}

function scoreCandidate(spine, layout, start, end, labelWidth, padding) {
  const midpoint = (start + end) / 2;

  const straightness = 1 - Math.min(1, layout.totalTurn / maxTotalAngle);

  const centrality = spine.length > 0 ? 1 - Math.abs(midpoint - spine.length / 2) / (spine.length / 2) : 0;

  const endRoom = Math.min(1, Math.min(start, spine.length - end) / (3 * padding));

  const meanAngle = spine.angleAt(midpoint, labelWidth / 2);

  const horizontalness = 1 - Math.abs(Math.sin(meanAngle));

  /*
   * Keep these weights explicit. This makes tuning the placement
   * behavior much easier than burying the formula in the scan loop.
   */
  const score = 0.45 * straightness + 0.15 * centrality + 0.1 * endRoom + 0.1 * horizontalness;

  return {
    score,
    terms: {
      straight: straightness,
      central: centrality,
      endRoom,
      horizontal: horizontalness
    }
  };
}

function generateCandidates(spine, glyphs, labelWidth, padding, tangentWindow, closed) {
  const scanStep = Math.max(padding / 3, labelWidth / 16);

  const maxStart = closed ? Math.min(spine.length - labelWidth - padding, spine.length) : spine.length - labelWidth - padding;

  const candidates = [];

  for (let start = padding; start <= maxStart; start += scanStep) {
    const direction = chooseDirection(spine, start, labelWidth, tangentWindow);

    const layout = layoutGlyphs(spine, start, glyphs, direction, padding, tangentWindow);

    const end = start + layout.usedLength;

    const scoring = scoreCandidate(spine, layout, start, end, labelWidth, padding);

    candidates.push({
      start,
      end,

      dir: direction,

      score: scoring.score,
      terms: scoring.terms,

      glyphs: layout.glyphs,
      usedLength: layout.usedLength,

      worstGlyphAngle: layout.worstGlyphTurn,

      totalTurn: layout.totalTurn
    });
  }

  return candidates;
}

function selectCandidates(candidates, maxLabels, repeatGap) {
  candidates.sort((a, b) => b.score - a.score);

  const selected = [];

  for (const candidate of candidates) {
    if (selected.length >= maxLabels) {
      break;
    }

    const overlaps = selected.some((existing) => candidate.start < existing.end + repeatGap && existing.start < candidate.end + repeatGap);

    if (!overlaps) {
      selected.push(candidate);
    }
  }

  selected.sort((a, b) => a.start - b.start);

  return selected;
}

function planTextPlacement(path, text, fontSize = 10, letterSpacing = 0, wordSpacing = 0, roadWidth = 10, closed = false, maxLabels = 1) {
  if (fontSize < 1 || !Array.isArray(path) || path.length < 2 || !text || maxLabels <= 0) {
    return null;
  }

  const sampleStep = sampleStepRatio * fontSize;
  const padding = paddingRatio * fontSize;
  const repeatGap = repeatGapRatio * fontSize;
  const tangentWindow = tangentWindowRatio * fontSize;
  const glyphs = buildGlyphs(text, fontSize, letterSpacing, wordSpacing);
  const labelWidth = getGlyphRunLength(glyphs);

  if (labelWidth <= 0) {
    return null;
  }

  const prepared = prepareSpine(path, {
    fontSize,
    roadWidth,
    sampleStep
  });

  if (!prepared) {
    return null;
  }

  const { spine, source, maxDeviation } = prepared;

  const requiredLength = labelWidth + 2 * padding;

  if (spine.length < requiredLength) {
    return null;
  }

  const candidates = generateCandidates(spine, glyphs, labelWidth, padding, tangentWindow, closed);

  return selectCandidates(candidates, maxLabels, repeatGap);
}

module.exports = {
  planTextPlacement,
  Spine,
  resamplePolyline,
  gaussianSmooth,
  clampDeviation
};
