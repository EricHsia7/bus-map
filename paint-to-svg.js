/**
 * Group paint keys by instance prefix.
 * @returns Map<instanceName, {props:{prop:value}}> preserving first-seen order
 */
function splitInstances(paint) {
  const instances = new Map();
  for (const [key, value] of Object.entries(paint || {})) {
    const slash = key.indexOf('/');
    const instance = slash === -1 ? '' : key.slice(0, slash);
    const prop = slash === -1 ? key : key.slice(slash + 1);
    if (!instances.has(instance)) instances.set(instance, { props: {} });
    instances.get(instance).props[prop] = value;
  }
  return instances;
}

function num(v, k = 1) {
  return typeof v === 'number' ? v * k : parseFloat(v) * k;
}

/**
 * Resolve interpolatable properties defined on [z, z+1] at integer zoom (z)
 * (The raster tiles are rendered at integer zooms.)
 */
function resolveInterpolatable(v) {
  if (!Array.isArray(v) || v.length !== 2) return v;
  return typeof v[0] === 'number' ? Number(v[0]) : v[0];
}

function dash(v, k = 1) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((n) => parseFloat(n) * k).join(',');
  return String(v).trim().replace(/\s+/g, ',');
}

/**
 * Turn one instance's props into ordered element descriptors.
 * @returns Array<{ kind, attrs:{}, patternFile? }>
 */
function instanceElements(props, k) {
  const els = [];
  const has = (p) => props[p] !== undefined && props[p] !== null;

  // polygon fill (solid)
  if (has('polygon-fill')) {
    const attrs = {
      'fill': 'rgba(0,0,0,1)',
      'fill-rule': 'nonzero'
    };

    attrs['fill'] = Array.isArray(props['polygon-fill']) ? props['polygon-fill'][0] : props['polygon-fill']; // use style at integer zoom

    if (has('polygon-opacity')) {
      attrs['fill-opacity'] = num(props['polygon-opacity']);
    }

    els.push({ kind: 'polygon', attrs });
  }

  // line stroke (solid)
  if (has('line-color') || has('line-width')) {
    const attrs = { fill: 'none' };

    if (has('line-color')) {
      attrs['stroke'] = resolveInterpolatable(props['line-color']);
    }

    if (has('line-width')) {
      attrs['stroke-width'] = resolveInterpolatable(props['line-width']) * k;
    }

    if (has('line-opacity')) {
      attrs['stroke-opacity'] = num(props['line-opacity']);
    }

    if (has('line-join')) {
      attrs['stroke-linejoin'] = props['line-join'];
    }

    if (has('line-cap')) {
      attrs['stroke-linecap'] = props['line-cap'];
    }

    if (has('line-dasharray')) {
      attrs['stroke-dasharray'] = dash(props['line-dasharray'], k);
    }

    els.push({ kind: 'line', attrs });
  }

  return els;
}

/**
 * Compile a paint object into an ordered render plan of background elements.
 * This is the artifact that makes cascading cheap at render time (see notes
 * at the bottom of the file): store it in the precompiled JSON and the
 * renderer just maps geometry -> attrs.
 *
 * @returns Array<{ instance, kind, attrs, patternFile?, groupOpacity? }>
 */
function paintToPlan(paint, k) {
  const plan = [];
  const instances = splitInstances(paint);
  for (const [instance, { props }] of instances) {
    const groupOpacity = props['opacity'] !== undefined ? num(props['opacity']) : undefined;
    for (const el of instanceElements(props, k)) {
      plan.push({ instance, groupOpacity, ...el });
    }
  }
  return plan;
}

function esc(v) {
  return String(v).replace(/"/g, '&quot;').replace(/&/g, '&amp;');
}

function attrsToStr(attrs) {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ');
}

/**
 * Render a single plan element against a geometry.
 * @param el   plan element from paintToPlan
 * @param d    SVG path data (from plot.js plotPolygon / plotLineString), OR
 *             pass { ref: 'id' } via opts.pathRef to reuse a <use> href.
 * @param opts { pathRef, patternDefs } -- if patternDefs (a Map) is provided,
 *             pattern elements register their <pattern> defs into it and
 *             reference them by url(#id).
 */
function elementToSvg(el, d, opts = {}) {
  const attrs = { ...el.attrs };
  if (el.groupOpacity !== undefined) attrs.opacity = el.groupOpacity;
  const geom = opts.pathRef ? `href="#${opts.pathRef}"` : `d="${d}"`;
  const tag = opts.pathRef ? 'use' : 'path';
  const dataInst = el.instance ? ` data-instance="${esc(el.instance)}"` : '';
  return `<${tag} ${geom} ${attrsToStr(attrs)}${dataInst}/>`;
}

/**
 * Convert a rule's paint object to an array of background SVG element strings.
 * @param paint rule.paint
 * @param d shared geometry path data (from plot.js)
 * @param geomType 'polygon' | 'linestring' (informational; both share `d`)
 * @param k stroke scale factor
 * @param opts { pathRef, patternDefs }
 * @returns string[]  (one per background element, in draw order)
 */
function paintToSvgElements(paint, d, geomType, k, opts = {}) {
  return paintToPlan(paint, k)
    .filter((el) => keepForGeometry(el, geomType))
    .map((el) => elementToSvg(el, d, opts));
}

/** Only fills make sense for polygons-as-fill; strokes apply to both. */
function keepForGeometry(el, geomType) {
  if (!geomType) return true;
  const g = String(geomType).toLowerCase();
  const isLineGeom = g === 'linestring' || g === 'line';
  // A linestring has no interior, so polygon fills are meaningless on it.
  if (isLineGeom && el.kind === 'polygon') return false;
  return true;
}

/** Convenience: return a single SVG string (joined elements). */
function paintToSvg(paint, d, geomType, k, opts = {}) {
  return paintToSvgElements(paint, d, geomType, k, opts).join('');
}

module.exports = {
  paintToSvg,
  paintToSvgElements,
  paintToPlan,
  splitInstances,
  instanceElements
};
