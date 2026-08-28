const { packPolygon, packLineString, packPolygonOutline } = require('./pack');
const { splitInstances } = require('./paint-to-svg');

function num(v) {
  return typeof v === 'number' ? v : parseFloat(v);
}

/**
 * A shipped scale interval [s0, s1] covering [minzoom, minzoom + 1]: the value
 * at this tile's zoom and at the next one. Same convention as the label
 * pipeline's text-scale / marker-scale (see SCALE_TARGETS): the descriptor
 * carries one reference size and the client interpolates the multiplier per
 * frame, so a tile stays valid across its whole zoom octave.
 */
function pair(v) {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const a = num(v[0]);
  const b = num(v[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return [a, b];
}

function dash(v) {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map(Number);
  const s = String(v).trim();
  if (s === '' || s === 'none') return [];
  const out = s.split(/[\s,]+/g).map((n) => Number(n.trim()));
  return out.every((n) => Number.isFinite(n) && n >= 0) ? out : [];
}

/**
 * @returns { Array<{ kind: 'polygon' | 'line', styleProperties: Record<string, any> }> }
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
    styleProperties['stroke'] = props['line-color'] || 'rgba(0,0,0,1)';

    // line-width -> stroke-width
    styleProperties['stroke-width'] = has('line-width') ? num(props['line-width']) : 1;

    // line-opacity -> stroke-opacity
    if (has('line-opacity')) styleProperties['stroke-opacity'] = num(props['line-opacity']);

    // line-join -> stroke-linejoin
    if (has('line-join')) styleProperties['stroke-linejoin'] = props['line-join'];

    // line-cap -> stroke-linecap
    if (has('line-cap')) styleProperties['stroke-linecap'] = props['line-cap'];

    // line-dasharray -> stroke-dasharray
    if (has('line-dasharray') && props['line-dasharray'] !== 'none') styleProperties['stroke-dasharray'] = dash(props['line-dasharray']);

    // line-scale -> stroke-width-scale (SCALE_TARGETS: line-scale -> line-width)
    // Only the width is scaled. The dash pattern keeps its authored rhythm, so a dashed casing does not visibly re-phase while zooming inside one octave.
    if (has('line-scale')) {
      const scale = pair(props['line-scale']);
      if (scale) styleProperties['stroke-width-scale'] = scale;
    }

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
      geometries.set('line', isLine ? packLineString(shape, x0, y0, x1, y1, extent, buffer) : packPolygonOutline(shape, x0, y0, x1, y1, extent, buffer));
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
