const { packPolygon, packLineString } = require('./pack');
const { paintToPlan } = require('./paint-to-svg');

function paintToVector(paint, shape, x0, y0, x1, y1, extent, buffer) {
  const isLine = shape.type === 'LineString';
  const plan = paintToPlan(paint, 1); // geometries will be rendered 1:1 at runtime

  const geometries = new Map();
  for (const item of plan) {
    // invalidate unexpected matches
    if (isLine && (item.kind === 'polygon' || item.kind === 'polygon-pattern')) continue;

    // TODO: polygon-pattern/line-pattern
    if (item.kind === 'polygon') {
      if (geometries.has('polygon')) continue;
      const pack = packPolygon(shape, x0, y0, x1, y1, extent, buffer);
      if (pack) geometries.set('polygon', pack);
    } else if (item.kind === 'line') {
      if (geometries.has('line')) continue;
      const pack = packLineString(shape, x0, y0, x1, y1, extent, buffer);
      if (pack) geometries.set('line', pack);
    }
  }

  const polygonDescriptors = [];
  const lineDescriptors = [];
  for (const item of plan) {
    // invalidate unexpected matches
    if (isLine && (item.kind === 'polygon' || item.kind === 'polygon-pattern')) continue;

    // TODO: polygon-pattern/line-pattern
    if (item.kind === 'polygon') {
      if (!geometries.has('polygon')) continue;
      const geometry = geometries.get('polygon');
      polygonDescriptors.push({ ...item, geometry });
    } else if (item.kind === 'line') {
      if (!geometries.has('line')) continue;
      const geometry = geometries.get('line');
      lineDescriptors.push({ ...item, geometry });
    }
  }

  return {
    polygonDescriptors,
    lineDescriptors
  };
}

module.exports = {
  paintToVector
};
