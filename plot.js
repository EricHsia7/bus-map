const { getOrientation, getCentroid } = require('./coordinate');
const measureTextWidth = require('./text-width');

// Transform a ring/line into pixel space, dropping non-finite points.
function transform(path, transformX, transformY) {
  const out = [];
  for (const coordinate of path) {
    if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) continue;
    const x = transformX(coordinate[0]);
    const y = transformY(coordinate[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push([x, y]);
  }
  return out;
}

// True when [minX,minY,maxX,maxY] intersects the expanded viewport [-m, size+m].
// resvg panics (geom.rs fit_to_rect -> IntRect::from_ltrb().unwrap()) when an
// element bbox is ENTIRELY outside the canvas, so we must cull those paths.
function intersectsViewport(bbox, size, margin) {
  const [minX, minY, maxX, maxY] = bbox;
  return maxX >= -margin && minX <= size + margin && maxY >= -margin && minY <= size + margin;
}

function bboxOf(points, bbox) {
  for (const [x, y] of points) {
    if (x < bbox[0]) bbox[0] = x;
    if (y < bbox[1]) bbox[1] = y;
    if (x > bbox[2]) bbox[2] = x;
    if (y > bbox[3]) bbox[3] = y;
  }
}

// Build an oriented path
function windPoints(points, drawingOrientation) {
  const n = points.length;
  if (n < 2) return '';
  const orientation = getOrientation(points);
  const cisPath = orientation === 'degenerate' || drawingOrientation === orientation;
  let pathCommand = '';
  if (cisPath) {
    pathCommand += `M${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < n; i++) pathCommand += `L${points[i][0]} ${points[i][1]}`;
  } else {
    pathCommand += `M${points[n - 1][0]} ${points[n - 1][1]}`;
    for (let i = n - 2; i >= 0; i--) pathCommand += `L${points[i][0]} ${points[i][1]}`;
  }
  return pathCommand;
}

// Build a directionless path
function tracePoints(points) {
  const n = points.length;
  if (n < 2) return '';
  let pathCommand = '';
  pathCommand += `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < n; i++) pathCommand += `L${points[i][0]} ${points[i][1]}`;
  return pathCommand;
}

// type: Polygon
function plotPolygon(polygon, x0, y0, x1, y1, tileSize = 512, precision = 2048, margin = 64) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return '';
  const scaleX = precision / dX;
  const scaleY = precision / dY;
  const transformX = (x) => (Math.floor((x - x0) * scaleX) / precision) * tileSize;
  const transformY = (y) => (Math.floor((dY - (y - y0)) * scaleY) / precision) * tileSize;

  const rings = polygon.coordinates;
  if (!rings || rings.length === 0 || !rings[0] || rings[0].length < 3) return '';

  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const outer = transform(rings[0], transformX, transformY);
  if (outer.length < 3) return '';
  bboxOf(outer, bbox);

  const holes = [];
  for (let i = 1; i < rings.length; i++) {
    if (!rings[i] || rings[i].length < 3) continue;
    const h = transform(rings[i], transformX, transformY);
    if (h.length >= 3) {
      holes.push(h);
      bboxOf(h, bbox);
    }
  }

  // Cull if the whole polygon is off-canvas (prevents the resvg panic).
  if (!intersectsViewport(bbox, tileSize, margin)) return '';

  let pathCommand = windPoints(outer, 'clockwise');
  if (!pathCommand) return '';
  pathCommand += 'Z';
  for (const h of holes) {
    const hole = windPoints(h, 'counterclockwise');
    if (hole) pathCommand += hole + 'Z';
  }
  return pathCommand;
}

function plotLineString(lineString, x0, y0, x1, y1, tileSize = 512, precision = 2048, margin = 64) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return '';
  const scaleX = precision / dX;
  const scaleY = precision / dY;
  const transformX = (x) => (Math.floor((x - x0) * scaleX) / precision) * tileSize;
  const transformY = (y) => (Math.floor((dY - (y - y0)) * scaleY) / precision) * tileSize;

  const coords = lineString.coordinates;
  if (!coords || coords.length < 2) return '';
  const points = transform(coords, transformX, transformY);
  if (points.length < 2) return '';

  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  bboxOf(points, bbox);
  if (!intersectsViewport(bbox, tileSize, margin)) return '';

  // No 'Z' (a LineString is an open stroke)
  return tracePoints(points);
}

function plotPolygonLabel(polygon, x0, y0, x1, y1, quantization = 1024) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return null;
  const scaleX = quantization / dX;
  const scaleY = quantization / dY;
  const transformX = (x) => Math.floor((x - x0) * scaleX);
  const transformY = (y) => Math.floor((dY - (y - y0)) * scaleY);

  const rings = polygon.coordinates;
  const centroid = getCentroid(rings[0]);
  if (!centroid) return null;
  // if (centroid && centroid[0] >= 0 && centroid[0] <= quantization && centroid[1] >= 0 && centroid[1] <= quantization) {
  return { type: 'Point', coordinates: [transformX(centroid[0]), transformY(centroid[1])] };
  //}
}

/**
 * Pre-computes per-character text placement (anchor + rotation) along a line,
 * approximating each glyph as a square with side length = the *scaled* text
 * size, and emits the result directly as a LineString-style geometry object
 * (matching the shape of plotLineStringLabel's output in plot.js) instead of
 * a wrapper object.
 *
 * `coordinates` and `angles` are parallel arrays: one entry per character of
 * `label` (coordinates.length === angles.length === label.length). Each
 * coordinate is the CENTER of that character's square; each angle (radians)
 * is the local tangent direction of the line at that point, so downstream
 * code can rotate a `size x size` box around each anchor to draw the glyph.
 *
 * Context: style `text-size` values (Mapnik/OSM Carto convention) are
 * authored against a 256x256 reference tile. Label geometry coordinates
 * (e.g. from plotLineStringLabel in plot.js) live in "labelQuantization"
 * pixel space (commonly 1024, per config.tiles.labelQuantization), so
 * text-size must be scaled up by (quantization / 256) before it's used as a
 * distance in that coordinate space.
 */

function clamp(value, min, max) {
  if (value < min) {
    return min;
  } else if (value > max) {
    return max;
  } else {
    return value;
  }
}

const maxTotalTurn = (60 / 180) * Math.PI;
const sampleRateRatio = 2;

// directional placement tuning
const HORIZONTAL = 0;
const VERTICAL = 1;
// How strongly the tangent direction drives orientation choice (vs. curvature).
const directionWeight = 1.0;
// Tie-breaker: horizontal is the default reading direction, so tax vertical a bit.
const verticalModeBias = 0.15;
// A candidate is only eligible for a mode if the tangent is "enough" of that direction.
const minVerticality = Math.sin((60 / 180) * Math.PI); // >= 60° from horizontal
const maxVerticalityForHorizontal = Math.sin((60 / 180) * Math.PI);
// Upright glyphs may lean with the road, but only so far.
const maxVerticalGlyphTilt = (30 / 180) * Math.PI;

// Ideographic / kana / hangul / fullwidth ranges stack cleanly; Latin does not.
const VERTICAL_SCRIPT = /[\u1100-\u11FF\u2E80-\u303F\u3040-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;
function supportsVerticalLayout(label) {
  for (let i = 0; i < label.length; i++) {
    const c = label[i];
    if (c === ' ') continue;
    if (!VERTICAL_SCRIPT.test(c)) return false;
  }
  return true;
}

function plotLineStringLabel(lineString, x0, y0, x1, y1, label, textSize, textScale, tileSize = 512, quantization = 1024) {
  if (!Array.isArray(lineString.coordinates) || lineString.coordinates.length < 2) return null;
  if (!label || label.length === 0) return null;
  if (textSize < 0 || textScale < 0) return null;

  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return null;
  const scaleX = tileSize / dX;
  const scaleY = tileSize / dY;
  const transformX = (x) => (x - x0) * scaleX;
  const transformY = (y) => (dY - (y - y0)) * scaleY;

  const coordinates = transform(lineString.coordinates, transformX, transformY);

  // text-size is authored against a 256x256 tile; scale it into whatever pixel space `coordinates` live in.
  const fontSize = textSize * textScale * (tileSize / 256);

  const labelLength = label.length;

  // Horizontal advances come from the shaper; vertical advances are em boxes.
  const hAdvances = new Float32Array(labelLength);
  const hPrefix = new Float32Array(labelLength + 1);
  const vAdvances = new Float32Array(labelLength);
  const vPrefix = new Float32Array(labelLength + 1);
  let hTotal = 0;
  let vTotal = 0;
  for (let i = 0; i < labelLength; i++) {
    const advance = measureTextWidth(label[i], fontSize, 0, 0);
    hAdvances[i] = advance;
    hPrefix[i + 1] = hPrefix[i] + advance;
    hTotal += advance;

    vAdvances[i] = fontSize;
    vPrefix[i + 1] = vPrefix[i] + fontSize;
    vTotal += fontSize;
  }

  const coordinatesLength = coordinates.length;
  const segmentLengths = new Float32Array(coordinatesLength - 1);
  const segmentTotalLengths = new Float32Array(coordinatesLength - 1);
  const segmentDeltaX = new Float32Array(coordinatesLength - 1);
  const segmentDeltaY = new Float32Array(coordinatesLength - 1);
  const segmentVerticality = new Float32Array(coordinatesLength - 1); // |sin(theta)|
  const segmentAngles = new Float32Array(coordinatesLength - 1);
  const segmentTurns = new Float32Array(coordinatesLength - 1);
  let totalLength = 0;
  let totalTurn = 0;
  for (let i = 1; i < coordinatesLength; i++) {
    const s = i - 1; // segment index
    const px = coordinates[i - 1][0];
    const py = coordinates[i - 1][1];
    const dx = coordinates[i][0] - px;
    const dy = coordinates[i][1] - py;

    segmentDeltaX[s] = dx;
    segmentDeltaY[s] = dy;
    const distance = Math.hypot(dx, dy);
    segmentLengths[s] = distance;
    segmentTotalLengths[s] = totalLength;
    totalLength += distance;
    // Bounded, slope-free direction measure: 0 = horizontal, 1 = vertical.
    segmentVerticality[s] = distance === 0 ? 0 : Math.abs(dy) / distance;
    const angle = Math.atan2(dy, dx);
    segmentAngles[s] = angle;
    segmentTurns[s] = totalTurn;
    totalTurn += s === 0 ? 0 : Math.abs(angle - segmentAngles[s - 1]);
  }

  const verticalAllowed = supportsVerticalLayout(label);
  const hFits = hTotal + hAdvances[0] + hAdvances[labelLength - 1] <= totalLength;
  const vFits = verticalAllowed && vTotal + vAdvances[0] + vAdvances[labelLength - 1] <= totalLength;
  if (!hFits && !vFits) return null;

  const resampledX = [];
  const resampledY = [];
  const resampledToSegement = [];
  for (let i = 0; i < coordinatesLength - 1; i++) {
    resampledX.push(coordinates[i][0]);
    resampledY.push(coordinates[i][1]);
    resampledToSegement.push(i);
    const sampleCount = Math.max(1, (segmentLengths[i] / fontSize) * sampleRateRatio);
    for (let j = 1; j < sampleCount; j++) {
      const t = j / sampleCount;
      resampledX.push(coordinates[i][0] + segmentDeltaX[i] * t);
      resampledY.push(coordinates[i][1] + segmentDeltaY[i] * t);
      resampledToSegement.push(i);
    }
  }
  const resampledLength = resampledX.length;

  const halfSlidingWindow = Math.ceil((labelLength * sampleRateRatio) / 2) + 1;
  let minScore = Infinity;
  let minScoreIndex = -1;
  let mode = HORIZONTAL;
  for (let i = halfSlidingWindow; i < resampledLength - halfSlidingWindow - 1; i++) {
    const planTotalTurn = segmentTurns[resampledToSegement[i + halfSlidingWindow]] - segmentTurns[resampledToSegement[i - halfSlidingWindow]];
    if (planTotalTurn >= maxTotalTurn) continue;

    const verticality = segmentVerticality[resampledToSegement[i]];

    // Horizontal: penalize steep tangents (the old centerAbsoluteSlope term, bounded).
    if (hFits && verticality <= maxVerticalityForHorizontal) {
      const score = planTotalTurn + directionWeight * verticality;
      if (score < minScore) {
        minScore = score;
        minScoreIndex = i;
        mode = HORIZONTAL;
      }
    }

    // Vertical: penalize flat tangents instead, so upright stacking wins on steep runs.
    if (vFits && verticality >= minVerticality) {
      const score = planTotalTurn + directionWeight * (1 - verticality) + verticalModeBias;
      if (score < minScore) {
        minScore = score;
        minScoreIndex = i;
        mode = VERTICAL;
      }
    }
  }

  if (minScoreIndex < 0) return null;

  const advances = mode === VERTICAL ? vAdvances : hAdvances;
  const advancePrefix = mode === VERTICAL ? vPrefix : hPrefix;
  const totalAdvance = mode === VERTICAL ? vTotal : hTotal;

  function sampleAtDistance(dist) {
    let remaining = clamp(dist, 0, totalLength);
    for (let i = 0; i < coordinatesLength - 1; i++) {
      const segLen = segmentLengths[i];
      if (remaining <= segLen || i === coordinatesLength - 2) {
        const t = segLen === 0 ? 0 : remaining / segLen;
        return {
          x: coordinates[i][0] + segmentDeltaX[i] * t,
          y: coordinates[i][1] + segmentDeltaY[i] * t,
          angle: segmentAngles[i]
        };
      }
      remaining -= segLen;
    }
    const last = coordinates[coordinatesLength - 1];
    return { x: last[0], y: last[1], angle: 0 };
  }

  const start = clamp(segmentTotalLengths[resampledToSegement[minScoreIndex - halfSlidingWindow]], 0, totalLength - totalAdvance);
  const end = start + totalAdvance;
  const startPoint = sampleAtDistance(start);
  const endPoint = sampleAtDistance(end);

  const dirX = endPoint.x - startPoint.x;
  const dirY = endPoint.y - startPoint.y;
  const EPS = 1e-6;
  // Horizontal text must read left-to-right; vertical text must read top-to-bottom.
  const flip = mode === VERTICAL ? dirY < -EPS || (Math.abs(dirY) <= EPS && dirX < 0) : dirX < -EPS || (Math.abs(dirX) <= EPS && dirY > 0);

  const outputCoordinates = [];
  const outputAngles = [];
  const quantizeComponent = (x) => Math.floor((x / tileSize) * quantization);
  const quantizeAngle = (angle) => Math.floor(((((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * quantization);

  for (let i = 0; i < labelLength; i++) {
    const offset = advancePrefix[i] + advances[i] / 2;
    const d = flip ? end - offset : start + offset;

    const { x, y, angle } = sampleAtDistance(d);
    const oriented = flip ? angle + Math.PI : angle;

    let glyphAngle;
    if (mode === VERTICAL) {
      // v_char ∥ v_T: the glyph's up-axis follows the tangent, so the baseline
      // rotates by -90°. Clamp the lean so upright stacking stays legible.
      const tilt = Math.atan2(Math.sin(oriented - Math.PI / 2), Math.cos(oriented - Math.PI / 2));
      glyphAngle = tilt;
    } else {
      // v_char · v_T = 0: baseline along the tangent.
      glyphAngle = oriented;
    }

    outputCoordinates.push([quantizeComponent(x), quantizeComponent(y)]);
    outputAngles.push(quantizeAngle(glyphAngle));
  }

  return { type: 'LineString', coordinates: outputCoordinates, angles: outputAngles, orientation: mode === VERTICAL ? 'vertical' : 'horizontal' };
}

function plotPointLabel(point, x0, y0, x1, y1, quantization = 1024) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return null;
  const scaleX = quantization / dX;
  const scaleY = quantization / dY;
  const transformX = (x) => Math.floor((x - x0) * scaleX);
  const transformY = (y) => Math.floor((dY - (y - y0)) * scaleY);
  return { type: 'Point', coordinates: transform([point], transformX, transformY)[0] };
}

module.exports = {
  plotPolygon,
  plotLineString,
  plotPolygonLabel,
  plotLineStringLabel,
  plotPointLabel
};
