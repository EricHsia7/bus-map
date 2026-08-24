const { packPolygon, packLineString } = require('./pack');
const { splitInstances } = require('./paint-to-svg');

function num(v) {
  return typeof v === 'number' ? v : parseFloat(v);
}

function dash(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((n) => parseFloat(n)).join(',');
  return String(v).trim().replace(/\s+/g, ',');
}

/**
 * @returns { Array<{ kind, styleProperties: {} }> }
 */
function instanceToDescriptors(props) {
  const descriptors = [];
  const has = (p) => props[p] !== undefined && props[p] !== null;

  // polygon fill (solid)
  if (has('polygon-fill')) {
    const styleProperties = {};
    // 'fill-rule': 'nonzero'

    // polygon-fill -> fill
    styleProperties['fill'] = props['polygon-fill'] || 'none';

    // polygon-opacity -> fill-opacity
    if (has('polygon-opacity')) styleProperties['fill-opacity'] = num(props['polygon-opacity']);

    // opacity -> opacity
    if (has('opacity')) styleProperties['opacity'] = num(props['opacity']);

    descriptors.push({ kind: 'polygon', styleProperties });
  }

  // line stroke (solid)
  if (has('line-color') || has('line-width')) {
    const styleProperties = {};
    // line-color -> stroke
    styleProperties['stroke'] = props['line-color'] || 'none';

    // line-width -> stroke-width
    if (has('line-width')) styleProperties['stroke-width'] = num(props['line-width']);

    // line-opacity -> stroke-opacity
    if (has('line-opacity')) styleProperties['stroke-opacity'] = num(props['line-opacity']);

    // line-join -> stroke-linejoin
    if (has('line-join')) styleProperties['stroke-linejoin'] = props['line-join'];

    // line-cap -> stroke-linecap
    if (has('line-cap')) styleProperties['stroke-linecap'] = props['line-cap'];

    // line-dasharray -> stroke-dasharray
    if (has('line-dasharray')) styleProperties['stroke-dasharray'] = dash(props['line-dasharray']);

    // opacity -> opacity
    if (has('opacity')) styleProperties['opacity'] = num(props['opacity']);

    descriptors.push({ kind: 'line', styleProperties });
  }

  return descriptors;
}

/**
 * Compile a paint object into an ordered render plan.
 * @returns { Array<{ instance: string, kind: 'polygon' | 'line', styleProperties }> }
 */
function paintToPlan(paint) {
  const plan = [];
  const instances = splitInstances(paint);
  for (const [instance, { props }] of instances) {
    const descriptors = instanceToDescriptors(props);
    for (const descriptor of descriptors) {
      plan.push({ instance, ...descriptor });
    }
  }
  return plan;
}

/**
 * Convert to vector objects
 * @returns {{
 * polygonDescriptors: Array<{ instance: string, kind: 'polygon', styleProperties, geometry }>,
 * lineDescriptors: Array<{ instance: string, kind: 'line', styleProperties, geometry }>
 * }}
 */
function paintToVector(paint, shape, x0, y0, x1, y1, extent, buffer) {
  const isLine = shape.type === 'LineString';
  const plan = paintToPlan(paint); // geometries will be rendered 1:1 at runtime

  // prepare geometries
  const geometries = new Map();
  for (const item of plan) {
    // invalidate unexpected matches
    if (isLine && (item.kind === 'polygon' || item.kind === 'polygon-pattern')) continue;

    if (item.kind === 'polygon') {
      if (geometries.has('polygon')) continue;
      geometries.set('polygon', packPolygon(shape, x0, y0, x1, y1, extent, buffer));
    } else if (item.kind === 'line') {
      if (geometries.has('line')) continue;
      geometries.set('line', packLineString(shape, x0, y0, x1, y1, extent, buffer));
    }
  }

  // pair every descriptor with a geometry
  const polygonDescriptors = [];
  const lineDescriptors = [];
  for (const item of plan) {
    // invalidate unexpected matches
    if (isLine && (item.kind === 'polygon' || item.kind === 'polygon-pattern')) continue;

    if (item.kind === 'polygon') {
      if (!geometries.get('polygon')) continue;
      const geometry = geometries.get('polygon');
      polygonDescriptors.push({ ...item, geometry });
    } else if (item.kind === 'line') {
      if (!geometries.get('line')) continue;
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
