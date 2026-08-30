function getArea(rings) {
  let area = 0;
  for (const ring of rings) {
    const ringLength = ring.length;
    for (let i = 0; i < ringLength; i++) {
      const current = i;
      const next = i === ringLength - 1 ? 0 : i + 1;
      area += ring[current][0] * ring[next][1] - ring[next][0] * ring[current][1];
    }
  }
  return Math.abs(area) / 2;
}

function filterPolygon(rings, areaFilter, zoom) {
  if (!areaFilter[zoom] || areaFilter[zoom] <= 0) return true;
  const area = getArea(rings);
  if (!Number.isFinite(area)) return true;
  return area >= areaFilter[zoom];
}

module.exports = {
  filterPolygon
};
