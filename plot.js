const { getOrientation, projectCoordinate, tileToBoundingbox, getTileViewbox, getCentroid } = require('./coordinate');

// Project + transform a ring/line into pixel space, dropping non-finite points.
function projectTransform(path, transformX, transformY) {
  const out = [];
  for (const coordinate of path) {
    const p = projectCoordinate(coordinate[0], coordinate[1]);
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const x = transformX(p[0]);
    const y = transformY(p[1]);
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

// Build a subpath from already-transformed points. Returns '' for < 2 points
// so callers never emit a move-only path.
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

// type: Polygon
function plotPolygon(polygon, x0, y0, x1, y1, tileSize = 512, precision = 2048, margin = 64) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return '';
  const scaleX = tileSize / dX;
  const scaleY = tileSize / dY;
  const transformX = (x) => Math.floor((x - x0) * scaleX * precision) / precision;
  const transformY = (y) => Math.floor((dY - (y - y0)) * scaleY * precision) / precision;

  const rings = polygon.coordinates;
  if (!rings || rings.length === 0 || !rings[0] || rings[0].length < 3) return '';

  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const outer = projectTransform(rings[0], transformX, transformY);
  if (outer.length < 3) return '';
  bboxOf(outer, bbox);

  const holes = [];
  for (let i = 1; i < rings.length; i++) {
    if (!rings[i] || rings[i].length < 3) continue;
    const h = projectTransform(rings[i], transformX, transformY);
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
  const scaleX = tileSize / dX;
  const scaleY = tileSize / dY;
  const transformX = (x) => Math.floor((x - x0) * scaleX * precision) / precision;
  const transformY = (y) => Math.floor((dY - (y - y0)) * scaleY * precision) / precision;

  const coords = lineString.coordinates;
  if (!coords || coords.length < 2) return '';
  const points = projectTransform(coords, transformX, transformY);
  if (points.length < 2) return '';

  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  bboxOf(points, bbox);
  if (!intersectsViewport(bbox, tileSize, margin)) return '';

  // No 'Z' (a LineString is an open stroke)
  return windPoints(points, 'clockwise');
}

function plotPolygonLabel(polygon, x0, y0, x1, y1, quantization = 1024) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return '';
  const scaleX = quantization / dX;
  const scaleY = quantization / dY;
  const transformX = (x) => Math.floor((x - x0) * scaleX);
  const transformY = (y) => Math.floor((dY - (y - y0)) * scaleY);

  const coords = polygon.coordinates;
  const centroid = getCentroid(coords);
  // if (centroid && centroid[0] >= 0 && centroid[0] <= quantization && centroid[1] >= 0 && centroid[1] <= quantization) {
  return { type: 'Point', coordinates: projectTransform([centroid], transformX, transformY)[0] };
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
function plotLineStringLabel(lineString, x0, y0, x1, y1, label, textSize, tileSize = 512, quantization = 1024, center = true, keepUpright = true) {
  if (!Array.isArray(lineString.coordinates) || lineString.coordinates.length < 2) return '';
  if (!label || label.length === 0) return '';
  if (!(textSize > 0)) return '';

  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return null;
  const scaleX = tileSize / dX;
  const scaleY = tileSize / dY;
  const transformX = (x) => (x - x0) * scaleX;
  const transformY = (y) => (dY - (y - y0)) * scaleY;

  const points = projectTransform(lineString.coordinates, transformX, transformY);

  // text-size is authored against a 256x256 tile; scale it into whatever
  // pixel space `coordinates` live in.
  const size = textSize * (tileSize / 256);
  const textWidth = size * label.length;

  // Decide traversal direction so text doesn't render upside-down: compare
  // net horizontal displacement from the first point to the last point.
  let pts = points;
  if (keepUpright) {
    const netDx = points[points.length - 1][0] - points[0][0];
    if (netDx < 0) pts = points.slice().reverse();
  }

  // Arc length per segment + total.
  const segLengths = [];
  let totalLength = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    segLengths.push(len);
    totalLength += len;
  }

  if (totalLength < textWidth) return ''; // line too short to fit the label

  function sampleAtDistance(dist) {
    let remaining = Math.max(0, Math.min(dist, totalLength));
    for (let i = 0; i < segLengths.length; i++) {
      const segLen = segLengths[i];
      if (remaining <= segLen || i === segLengths.length - 1) {
        const t = segLen === 0 ? 0 : remaining / segLen;
        const p0 = pts[i];
        const p1 = pts[i + 1];
        return {
          x: p0[0] + (p1[0] - p0[0]) * t,
          y: p0[1] + (p1[1] - p0[1]) * t,
          angle: Math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        };
      }
      remaining -= segLen;
    }
    const last = pts[pts.length - 1];
    return { x: last[0], y: last[1], angle: 0 };
  }

  const startOffset = center ? (totalLength - textWidth) / 2 : 0;

  const outCoordinates = [];
  const angles = [];
  for (let i = 0; i < label.length; i++) {
    const charCenterDist = startOffset + size * i + size / 2;
    const { x, y, angle } = sampleAtDistance(charCenterDist);
    outCoordinates.push([Math.floor(x * quantization), Math.floor(y * quantization)]);
    angles.push(angle);
  }

  return { type: 'LineString', coordinates: outCoordinates, angles };
}

function plotPointLabel(point, x0, y0, x1, y1, quantization = 1024) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return '';
  const scaleX = quantization / dX;
  const scaleY = quantization / dY;
  const transformX = (x) => Math.floor((x - x0) * scaleX);
  const transformY = (y) => Math.floor((dY - (y - y0)) * scaleY);
  return { type: 'Point', coordinates: projectTransform([point], transformX, transformY)[0] };
}

module.exports = {
  plotPolygon,
  plotLineString,
  plotPolygonLabel,
  plotLineStringLabel,
  plotPointLabel
};
