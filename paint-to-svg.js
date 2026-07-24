/**
 * paint-to-svg.js
 * -------------------------------------------------------------------------
 * Convert a compiled CartoCSS rule's `paint` object (as produced by
 * compile-carto.js and stored in style.json) into SVG elements, for the
 * BACKGROUND layer only -- i.e. geometry fills and strokes. Text, shields,
 * markers and point symbols are intentionally ignored.
 *
 *   const { paintToSvg } = require('./paint-to-svg.js');
 *   const d = plotPolygon(geom, x0,y0,x1,y1);      // from plot.js
 *   const svg = paintToSvg(rule.paint, d, 'polygon');
 *   // -> '<path d="..." fill="#eee" fill-rule="nonzero"/>'
 *
 * ------------------------------------------------------------------------
 * Instances (the slash prefix)
 * ------------------------------------------------------------------------
 * CartoCSS lets one rule carry several symbolizers of the same type via a
 * `name/` prefix ("instances"), e.g. `background/line-width` and
 * `line/line-width` are two independent LineSymbolizers. Each instance -->
 * its own SVG element. Properties with no prefix belong to the default
 * instance (""). Instances render in first-seen order (their cascade order).
 *
 * Within one instance you may have both a fill symbolizer and a stroke
 * symbolizer (e.g. polygon-fill + line-color); we emit fill first, stroke
 * second, matching Mapnik's paint order.
 *
 * ------------------------------------------------------------------------
 * fill-rule = nonzero (leverages path orientation)
 * ------------------------------------------------------------------------
 * plot.js winds outer rings clockwise and holes counter-clockwise. With
 * opposite winding, the winding number inside a hole is 0, so `nonzero`
 * fills the outer ring and subtracts the holes automatically -- no evenodd
 * needed, and it is robust to nested / touching rings.
 */

/* Background symbolizer families we render. Everything else is dropped. */
const BACKGROUND_TYPES = ['polygon-pattern', 'polygon', 'line-pattern', 'line'];

/* CartoCSS property -> SVG attribute maps, per symbolizer type. */
const LINE_ATTR = {
  'line-color': 'stroke',
  'line-width': 'stroke-width',
  'line-opacity': 'stroke-opacity',
  'line-join': 'stroke-linejoin',
  'line-cap': 'stroke-linecap',
  'line-dasharray': 'stroke-dasharray'
};
const POLYGON_ATTR = {
  'polygon-fill': 'fill',
  'polygon-opacity': 'fill-opacity'
};

/* ----------------------------------------------------------------------- */
/* Step 1: split a flat paint object into instances                        */
/* ----------------------------------------------------------------------- */

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

/** Which background symbolizer types are present in a prop bag. */
function typesIn(props) {
  const present = new Set();
  for (const p of Object.keys(props)) {
    for (const t of BACKGROUND_TYPES) {
      if (p === t + '-file' || p.startsWith(t + '-') || p === t) {
        // longest match wins (polygon-pattern before polygon)
        present.add(t);
        break;
      }
    }
  }
  // de-dupe overlaps: if polygon-pattern present, drop bare 'polygon' unless it
  // has its own fill; if line-pattern present, keep line only if it has stroke.
  return present;
}

/* ----------------------------------------------------------------------- */
/* Step 2: build element descriptors (a small, precomputable "plan")        */
/* ----------------------------------------------------------------------- */

function num(v, k = 1) {
  return typeof v === 'number' ? v : parseFloat(v) * k;
}

function dash(v, k = 1) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(n => parseFloat(n) * k).join(',');
  return String(v).trim().replace(/\s+/g, ',');
}

/**
 * Turn one instance's props into ordered element descriptors.
 * @returns Array<{ kind, attrs:{}, patternFile? }>
 */
function instanceElements(props, k) {
  const els = [];
  const has = (p) => props[p] !== undefined && props[p] !== null;

  // ---- polygon fill (solid) ----
  if (has('polygon-fill')) {
    const attrs = { 'fill': props['polygon-fill'], 'fill-rule': 'nonzero' };
    if (has('polygon-opacity')) attrs['fill-opacity'] = num(props['polygon-opacity']);
    els.push({ kind: 'polygon', attrs });
  }

  // ---- polygon pattern fill ----
  if (has('polygon-pattern-file')) {
    els.push({
      kind: 'polygon-pattern',
      patternFile: props['polygon-pattern-file'],
      attrs: {
        'fill-rule': 'nonzero',
        'fill-opacity': has('polygon-pattern-opacity') ? num(props['polygon-pattern-opacity']) : undefined
      }
    });
  }

  // ---- line stroke (solid) ----
  if (has('line-color') || has('line-width')) {
    const attrs = { fill: 'none' };
    for (const [prop, attr] of Object.entries(LINE_ATTR)) {
      if (!has(prop)) continue;
      attrs[attr] = prop === 'line-width' ? num(props[prop], k) : prop === 'line-dasharray' ? dash(props[prop], k) : props[prop];
    }
    // Mapnik defaults: round is common for map lines; only set if provided.
    els.push({ kind: 'line', attrs });
  }

  // ---- line pattern stroke ----
  if (has('line-pattern-file')) {
    els.push({
      kind: 'line-pattern',
      patternFile: props['line-pattern-file'],
      attrs: { fill: 'none' }
    });
  }

  return els;
}

/**
 * Compile a paint object into an ordered render plan of background elements.
 * This is the artifact that makes cascading cheap at render time (see notes
 * at the bottom of the file): store it in the precompiled JSON and the
 * renderer just maps geometry -> attrs.
 *
 * @returns Array<{ instance, kind, attrs, patternFile?, opacity? }>
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

/* ----------------------------------------------------------------------- */
/* Step 3: render a plan (or paint) to SVG using a shared geometry trace    */
/* ----------------------------------------------------------------------- */

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

  // pattern fills -> url(#..) referencing a <pattern> registered in defs
  if (el.kind === 'polygon-pattern' || el.kind === 'line-pattern') {
    const id = patternId(el.patternFile);
    if (opts.patternDefs) {
      opts.patternDefs.set(id, patternDef(id, el.patternFile));
    }
    if (el.kind === 'polygon-pattern') attrs.fill = `url(#${id})`;
    else {
      attrs.stroke = `url(#${id})`;
      attrs.fill = 'none';
    }
  }

  if (el.groupOpacity !== undefined) attrs.opacity = el.groupOpacity;

  const geom = opts.pathRef ? `href="#${opts.pathRef}"` : `d="${d}"`;
  const tag = opts.pathRef ? 'use' : 'path';
  const dataInst = el.instance ? ` data-instance="${esc(el.instance)}"` : '';
  return `<${tag} ${geom} ${attrsToStr(attrs)}${dataInst}/>`;
}

function patternId(file) {
  return (
    'pat-' +
    String(file)
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}
function patternDef(id, file) {
  // Best-effort: reference the pattern image; real width/height come from the
  // symbolizer's -width/-height if you have them. Tiles at 1:1 by default.
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="16" height="16">` + `<image href="${esc(file)}" width="16" height="16"/></pattern>`;
}

/**
 * Convert a rule's paint object to an array of background SVG element strings.
 * @param paint    rule.paint
 * @param d        shared geometry path data (from plot.js)
 * @param geomType 'polygon' | 'linestring' (informational; both share `d`)
 * @param k stroke scale factor
 * @param opts     { pathRef, patternDefs }
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
  if (isLineGeom && (el.kind === 'polygon' || el.kind === 'polygon-pattern')) return false;
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
  instanceElements,
  BACKGROUND_TYPES
};
