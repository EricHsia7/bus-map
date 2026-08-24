const { clipPolygon, clipLine } = require('./clip');
const { getOrientation } = require('./coordinate');

function packPolygon(polygon, x0, y0, x1, y1, extent = 2048, buffer = 64) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return null;
  const scaleX = extent / dX;
  const scaleY = extent / dY;
  const transformX = (x) => Math.floor((x - x0) * scaleX);
  const transformY = (y) => Math.floor((dY - (y - y0)) * scaleY);

  const rings = polygon.coordinates;
  if (!rings || rings.length === 0 || !rings[0] || rings[0].length < 3) return null;
  const ringsLength = rings.length;

  const transformedRings = [];
  for (let i = 0; i < ringsLength; i++) {
    const ringLength = rings[i].length;
    const transformedRing = [];
    for (let j = 0; j < ringLength; j++) {
      transformedRing.push([transformX(rings[i][j][0]), transformY(rings[i][j][1])]);
    }
    const orientation = getOrientation(transformedRing);
    if ((i === 0 && orientation !== 'clockwise') || (i > 0 && orientation !== 'counterclockwise')) {
      transformedRing.reverse();
    }
    transformedRings.push(transformedRing);
  }

  const clipped = clipPolygon(transformedRings, extent, buffer);
  if (clipped.length === 0) return null;

  // TODO: post-quantization
  return clipped;
}

function packLineString(lineString, x0, y0, x1, y1, extent = 2048, buffer = 64) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return null;
  const scaleX = extent / dX;
  const scaleY = extent / dY;
  const transformX = (x) => Math.floor((x - x0) * scaleX);
  const transformY = (y) => Math.floor((dY - (y - y0)) * scaleY);

  const coords = lineString.coordinates;
  if (!coords || coords.length === 0 || !coords[0] || coords[0].length < 3) return null;
  const coordsLength = coords.length;

  const transformedCoords = [];
  for (let i = 0; i < coordsLength; i++) {
    transformedCoords.push([transformX(coords[i][0]), transformY(coords[i][1])]);
  }

  const clipped = clipLine(transformedCoords, extent, buffer);
  if (clipped.length === 0) return null;

  return clipped;
}

module.exports = {
  packPolygon,
  packLineString
};
