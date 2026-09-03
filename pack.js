const { clipPolygon, clipLine } = require('./clip');
const { getOrientation } = require('./coordinate');

function packPolygon(polygon, x0, y0, x1, y1, extent = 2048, buffer = 64) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return null;
  const scaleX = extent / dX;
  const scaleY = extent / dY;
  const transformX = (x) => (x - x0) * scaleX;
  const transformY = (y) => (dY - (y - y0)) * scaleY;

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

  const clippedRings = clipPolygon(transformedRings, extent, buffer);
  if (clippedRings.length === 0) return null;

  const quantizedRings = [];
  for (let i = 0, l = clippedRings.length; i < l; i++) {
    const quantizedLine = [];
    for (let j = 0, m = clippedRings[i].length; j < m; j++) {
      quantizedLine.push([Math.round(clippedRings[i][j][0]), Math.round(clippedRings[i][j][1])]);
    }
    quantizedRings.push(quantizedLine);
  }

  return quantizedRings;
}

function packPolygonOutline(polygon, x0, y0, x1, y1, extent = 2048, buffer = 64) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return null;
  const scaleX = extent / dX;
  const scaleY = extent / dY;
  const transformX = (x) => (x - x0) * scaleX;
  const transformY = (y) => (dY - (y - y0)) * scaleY;

  const rings = polygon.coordinates;
  if (!rings || rings.length === 0 || !rings[0] || rings[0].length < 3) return null;
  const ringsLength = rings.length;

  const clippedLines = [];
  for (let i = 0; i < ringsLength; i++) {
    const ringLength = rings[i].length;
    const transformedRing = [];
    for (let j = 0; j < ringLength; j++) {
      transformedRing.push([transformX(rings[i][j][0]), transformY(rings[i][j][1])]);
    }
    Array.prototype.push.apply(clippedLines, clipLine(transformedRing, extent, buffer));
  }

  const quantizedLines = [];
  for (let i = 0, l = clippedLines.length; i < l; i++) {
    const quantizedLine = [];
    for (let j = 0, m = clippedLines[i].length; j < m; j++) {
      quantizedLine.push([Math.round(clippedLines[i][j][0]), Math.round(clippedLines[i][j][1])]);
    }
    quantizedLines.push(quantizedLine);
  }

  return quantizedLines;
}

function packLineString(lineString, x0, y0, x1, y1, extent = 2048, buffer = 64) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return null;
  const scaleX = extent / dX;
  const scaleY = extent / dY;
  const transformX = (x) => (x - x0) * scaleX;
  const transformY = (y) => (dY - (y - y0)) * scaleY;

  const coords = lineString.coordinates;
  if (!coords || coords.length === 0 || !coords[0]) return null;
  const coordsLength = coords.length;

  const transformedCoords = [];
  for (let i = 0; i < coordsLength; i++) {
    transformedCoords.push([transformX(coords[i][0]), transformY(coords[i][1])]);
  }

  const clippedLines = clipLine(transformedCoords, extent, buffer);
  if (clippedLines.length === 0) return null;

  const quantizedLines = [];
  for (let i = 0, l = clippedLines.length; i < l; i++) {
    const quantizedLine = [];
    for (let j = 0, m = clippedLines[i].length; j < m; j++) {
      quantizedLine.push([Math.round(clippedLines[i][j][0]), Math.round(clippedLines[i][j][1])]);
    }
    quantizedLines.push(quantizedLine);
  }

  return quantizedLines;
}

function packCircle(circle, x0, y0, x1, y1, extent = 2048, buffer = 64) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  if (!dX || !dY || !Number.isFinite(dX) || !Number.isFinite(dY)) return null;
  const scaleX = extent / dX;
  const scaleY = extent / dY;
  const transformX = (x) => (x - x0) * scaleX;
  const transformY = (y) => (dY - (y - y0)) * scaleY;
  const x = transformX(circle.coordinates[0]);
  const y = transformY(circle.coordinates[1]);
  if (x < -buffer || x > extent + buffer || y < -buffer || y > extent + buffer) return null;
  return [[[x, y]]];
}

module.exports = {
  packPolygon,
  packPolygonOutline,
  packLineString,
  packCircle
};
