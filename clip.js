/**
 * @typedef {[x: number, y: number]} Point
 * @typedef {Array<Point>} Ring
 * @typedef {Array<Ring>} Rings   // [0] = outer (CW), [1..] = holes (CCW)
 */

/**
 * Clip a polygon-with-holes to B = [-buffer, extent+buffer]^2.
 *
 * @param {Rings} rings
 * @param {number} extent
 * @param {number} [buffer=0]
 * @returns {Rings} empty array if nothing survives
 */
function clipRings(rings, extent, buffer = 0) {
  if (!rings || rings.length === 0) return [];

  const lowerLimit = -buffer;
  const upperLimit = extent + buffer;
  const boxArea = (upperLimit - lowerLimit) * (upperLimit - lowerLimit);
  const EPS = 1e-12;

  // whole-polygon reject/accept on the outer ring
  const outerBbox = bbox(rings[0]);
  if (outerBbox === null) return [];
  if (outerBbox.maxX < lowerLimit || outerBbox.minX > upperLimit || outerBbox.maxY < lowerLimit || outerBbox.minY > upperLimit) return [];
  if (outerBbox.minX >= lowerLimit && outerBbox.maxX <= upperLimit && outerBbox.minY >= lowerLimit && outerBbox.maxY <= upperLimit) {
    return rings.map((r) => r.slice());
  }

  const out = [];

  for (let i = 0; i < rings.length; i++) {
    const closed = isClosed(rings[i]);
    let ring = closed ? rings[i].slice(0, -1) : rings[i];
    if (ring.length < 3) {
      if (i === 0) return [];
      continue;
    }

    // clip
    ring = clipHalfPlane(ring, 0, lowerLimit, true); // x >= lowerLimit
    if (ring.length) ring = clipHalfPlane(ring, 0, upperLimit, false); // x <= upperLimit
    if (ring.length) ring = clipHalfPlane(ring, 1, lowerLimit, true); // y >= lowerLimit
    if (ring.length) ring = clipHalfPlane(ring, 1, upperLimit, false); // y <= upperLimit

    ring = dedupe(ring);

    const area = signedArea(ring);
    if (ring.length < 3 || Math.abs(area) <= EPS) {
      // outer ring vanished or collapsed to a line -> nothing to draw
      if (i === 0) return [];
      continue; // degenerate hole -> just drop it
    }

    // a hole that swallows the whole box kills the result
    if (i > 0 && Math.abs(area) >= boxArea - EPS) return [];

    if (closed) ring.push([ring[0][0], ring[0][1]]);
    out.push(ring);
  }

  // outer survived but produced nothing usable
  return out.length && out[0].length >= 3 ? out : [];
}

/**
 * Clip a ring against one half-plane.
 * keepGreater: true  -> keep p[axis] >= limit
 *              false -> keep p[axis] <= limit
 * @param {Ring} ring @returns {Ring}
 * @param {0 | 1} axis 0->x, 1->y
 */
function clipHalfPlane(ring, axis, limit, keepGreater) {
  const out = [];
  const n = ring.length;
  if (n === 0) return out;

  const inside = keepGreater ? (p) => p[axis] >= limit : (p) => p[axis] <= limit;

  // closed ring with N points -> N segments
  let previous = ring[n - 1]; // wrap to the last point so P[n-1]->P[0] is processed
  let previousInside = inside(previous);

  for (let i = 0; i < n; i++) {
    const current = ring[i];
    const currentInside = inside(current);

    if (currentInside) {
      if (!previousInside) out.push(cross(previous, current, axis, limit)); // entering
      out.push([current[0], current[1]]);
    } else if (previousInside) {
      out.push(cross(previous, current, axis, limit)); // leaving
    }
    previous = current;
    previousInside = currentInside;
  }
  return out;
}

/**
 * Intersection of segment a->c with the line p[axis] === limit.
 * Never called when a[axis] === c[axis] (then aIn === cIn), so no /0.
 * @returns {Point}
 */
function cross(a, c, axis, limit) {
  const axis1 = 1 - axis; // the other axis
  const t = (limit - a[axis]) / (c[axis] - a[axis]);
  const p = [0, 0];
  p[axis] = limit; // snap exactly onto the boundary
  p[axis1] = a[axis1] + t * (c[axis1] - a[axis1]); // scales linearly
  return p;
}

/** @param {Ring} r */
function isClosed(r) {
  return r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
}

/** Remove consecutive duplicates, including the wrap-around pair. @param {Ring} ring @returns {Ring} */
function dedupe(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const point = ring[i];
    const lastPoint = out[out.length - 1];
    if (!lastPoint || lastPoint[0] !== point[0] || lastPoint[1] !== point[1]) out.push(point);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
    out.pop();
  }
  return out;
}

/**
 *
 * @param {Ring} ring
 */
function signedArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return s / 2;
}

/** @param {Ring} ring */
function bbox(ring) {
  if (!ring || ring.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

const P = [
  [-10, 10],
  [10, 10],
  [10, -10],
  [-10, -10]
];

console.log(clipRings([P], 5, 1));
