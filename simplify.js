// simplify.js — zoom-dependent line/ring simplification without seams.
//
// Every vertex gets a significance `sig` (metres): the largest Douglas–Peucker
// tolerance at which it survives, computed once per chunk on the complete,
// unclipped way. A tile at zoom z then keeps the vertices with
// sig >= epsilon(z) — an O(n) filter, no per-tile simplification, so tiles on
// both sides of an edge (and chunks on both sides of a chunk border) always
// keep exactly the same vertices.
//
// Consistency rules:
//   * Ways are split into sections at junction nodes (from chunk.js, computed
//     over the whole dataset): way endpoints, nodes where ways diverge, the
//     start of every closed way, tagged nodes. Junctions are never dropped,
//     so roads stay connected and shared polygon borders stay identical.
//   * A section shared by several ways (e.g. a landuse border and a
//     multipolygon member) is simplified in one canonical direction, so every
//     way sharing it gets the same result.
//   * sig is stored on the shared node point arrays (nodeMap values) as
//     `point.sig`; a node interior to a section belongs to exactly that
//     section, so the value is unambiguous. Points without `sig` are kept.

const WORLD = 2 * Math.PI * 6378137; // Web Mercator world width, metres

/** Tolerance in Mercator metres for `tolerancePx` pixels of a 256-px tile at zoom z. */
function epsilon(z, tolerancePx) {
  return (tolerancePx * WORLD) / 256 / 2 ** z;
}

// Distance from p to segment a-b (to the point a when a == b: closed loops).
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t = 0;
  const len2 = dx * dx + dy * dy;
  if (len2 > 0) {
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}

// Hierarchical Douglas–Peucker over pts[0..n-1] (endpoints fixed). A vertex's
// sig is capped by its parent's, so a threshold never keeps a vertex whose
// ancestors were dropped. Ties resolve to the first index (deterministic).
function douglasPeucker(pts) {
  const stack = [0, pts.length - 1, Infinity];
  while (stack.length) {
    const parent = stack.pop();
    const e = stack.pop();
    const s = stack.pop();
    if (e - s < 2) continue;
    let max = -1;
    let m = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segmentDistance(pts[i], pts[s], pts[e]);
      if (d > max) {
        max = d;
        m = i;
      }
    }
    const sig = Math.min(max, parent);
    pts[m].sig = sig;
    stack.push(s, m, sig, m, e, sig);
  }
}

/**
 * Assign `sig` to every way vertex of a chunk.
 *   ways      [{ refs }]              OSM node ids
 *   nodeMap   Map<id, [x, y]>
 *   junctions Set<id>                 from readChunk (chunk format v3)
 */
function computeSignificance(ways, nodeMap, junctions) {
  const ids = [];
  const pts = [];
  for (const way of ways) {
    ids.length = 0;
    pts.length = 0;
    for (const id of way.refs) {
      const p = nodeMap.get(id);
      if (!p) continue;
      ids.push(id);
      pts.push(p);
    }
    const n = pts.length;
    if (n === 0) continue;
    pts[0].sig = Infinity;
    pts[n - 1].sig = Infinity;
    let s = 0;
    for (let i = 1; i < n; i++) {
      if (i < n - 1 && !junctions.has(ids[i])) continue;
      pts[i].sig = Infinity; // section end: never dropped
      if (i - s >= 2 && pts[s + 1].sig === undefined) {
        // canonical direction: lower end id first; for loops (same end), lower second id first
        const forward = ids[s] < ids[i] || (ids[s] === ids[i] && ids[s + 1] <= ids[i - 1]);
        const section = pts.slice(s, i + 1);
        if (!forward) section.reverse();
        douglasPeucker(section);
      }
      s = i;
    }
  }
}

/**
 * Vertices of `coords` visible at tolerance eps. Endpoints are always kept
 * (keeps rings closed even if assembly started mid-section). Returns the
 * input array itself when nothing is dropped.
 */
function filterCoords(coords, eps) {
  if (!(eps > 0) || coords.length <= 2) return coords;
  const last = coords.length - 1;
  let out = null;
  for (let i = 0; i <= last; i++) {
    const p = coords[i];
    const keep = i === 0 || i === last || !(p.sig < eps);
    if (keep) {
      if (out) out.push(p);
    } else if (!out) {
      out = coords.slice(0, i);
    }
  }
  return out || coords;
}

module.exports = { epsilon, computeSignificance, filterCoords, douglasPeucker };
