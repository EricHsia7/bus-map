function simplify(points, tolerance = 0.1) {
  if (points.length < 3) return points;

  const out = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];

    const abx = b[0] - a[0];
    const aby = b[1] - a[1];

    const acx = c[0] - a[0];
    const acy = c[1] - a[1];

    const cross = Math.abs(abx * acy - aby * acx);

    if (cross > tolerance) out.push(b);
  }

  out.push(points.at(-1));

  return out;
}

function laplacianSmooth(points, alpha = 0.25, iterations = 3) {
  points = points.map((p) => [...p]);

  for (let k = 0; k < iterations; k++) {
    const next = [...points];

    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const nextPt = points[i + 1];

      const mx = (prev[0] + nextPt[0]) * 0.5;
      const my = (prev[1] + nextPt[1]) * 0.5;

      next[i] = [curr[0] + alpha * (mx - curr[0]), curr[1] + alpha * (my - curr[1])];
    }

    points = next;
  }

  return points;
}

function smoothCorners(points, maxAngle = (30 * Math.PI) / 180) {
  const out = points.map((p) => [...p]);

  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];

    const ax = b[0] - a[0];
    const ay = b[1] - a[1];

    const bx = c[0] - b[0];
    const by = c[1] - b[1];

    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);

    if (la === 0 || lb === 0) continue;

    const dot = (ax * bx + ay * by) / (la * lb);

    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    if (angle < maxAngle) {
      out[i][0] = (a[0] + c[0]) * 0.5;
      out[i][1] = (a[1] + c[1]) * 0.5;
    }
  }

  return out;
}

function smoothPath(coords) {
  return smoothCorners(laplacianSmooth(simplify(coords, 0.1), 0.6), (60 * Math.PI) / 180);
}

module.exports = {
  smoothPath
};
