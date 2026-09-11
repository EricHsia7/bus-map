const { splitInstances } = require('./paint-to-svg.js');

const MARKER_PREFIXES = ['marker', 'point', 'shield'];

/** parse a numeric-ish value, else undefined (so it can be pruned). */
function num(v) {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A shipped scale interval [s0, s1] covering [minzoom, minzoom + 1]: the value
 * at this tile's zoom and at the next one. The client interpolates between them
 * per frame and multiplies the single reference size, so cached glyphs are
 * measured once and only transformed. Anything else is dropped.
 */
function numberPair(v) {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const a = num(v[0]);
  const b = num(v[1]);
  if (a === undefined || b === undefined) return undefined;
  return [a, b];
}

/** strip directory + extension from an icon path -> a MapLibre sprite id. */
function iconId(file) {
  if (file == null) return undefined;
  return (
    String(file)
      .replace(/^.*[\\/]/, '')
      .replace(/\.(svg|png|jpg|jpeg)$/i, '') || undefined
  );
}

/** drop undefined/null props so the output stays compact. */
function prune(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k];
  return o;
}

/**
 * Resolve a CartoCSS field expression against feature tags.
 *  "[name]"            -> tags.name
 *  '"[ref]"'           -> tags.ref
 *  "[ref] [name]"      -> interpolated, missing keys removed
 *  "literal"           -> returned as-is
 * Returns a non-empty string, or null when nothing resolves.
 */
function resolveField(expr, tags = {}) {
  if (expr == null) return null;
  const s = String(expr)
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!s) return null;
  // pure single field reference
  const single = s.match(/^\[([^\]]+)\]$/);
  if (single) {
    const v = tags[single[1]];
    return v == null || v === '' ? null : String(v);
  }
  // interpolated / mixed literal + fields
  if (s.includes('[')) {
    const out = s
      .replace(/\[([^\]]+)\]/g, (_, k) => {
        const v = tags[k];
        return v == null ? '' : String(v);
      })
      .trim();
    return out || null;
  }
  return s;
}

/**
 * Extract text/marker label descriptors from a compiled paint object.
 * @param paint  merged rule.paint (from style.json)
 * @param tags   feature tags (used to resolve text-name / shield-name)
 * @returns {{
 * textDescriptors: Array<{ kind: "text", id: string, text, styleProperties }>,
 * circleDescriptors: Array<{ kind: "circle", id: string, styleProperties }>
 * }}
 */
function paintToLabels(paint, id, tags = {}) {
  const textDescriptors = [];
  const circleDescriptors = [];
  const instances = splitInstances(paint);
  const has = (p) => props[p] !== undefined && props[p] !== null;

  for (const [instance, { props }] of instances) {
    // text
    if (has('text-name') && has('text-size')) {
      const text = resolveField(props['text-name'], tags);
      if (text) {
        const styleProperties = {};

        // text-size -> text-size
        styleProperties['text-size'] = num(props['text-size']);

        // text-scale -> text-scale
        styleProperties['text-scale'] = numberPair(props['text-scale']);

        // text-fill -> text-fill
        styleProperties['text-fill'] = props['text-fill'] || 'rgba(0,0,0,1)';

        // text-halo-fill -> text-halo-fill
        if (has('text-halo-fill')) styleProperties['text-halo-fill'] = props['text-halo-fill'];

        // text-halo-radius -> text-halo-radius
        if (has('text-halo-radius')) styleProperties['text-halo-radius'] = num(props['text-halo-radius']);

        // text-face-name -> text-face-name
        if (has('text-face-name')) styleProperties['text-face-name'] = props['text-face-name'];

        // text-placement -> text-placement
        if (has('text-placement')) styleProperties['text-placement'] = props['text-placement'];

        // text-dy -> text-dy
        if (has('text-dy')) styleProperties['text-dy'] = num(props['text-dy']);

        // text-wrap-width -> text-wrap-width
        if (has('text-wrap-width')) styleProperties = num(props['text-wrap-width']);

        textDescriptors.push({ kind: 'text', id, text, styleProperties });
      }
    }

    // circle marker
    if (has('marker-fill') && has('marker-width')) {
      const styleProperties = {};

      // marker-fill -> marker-fill
      styleProperties['marker-fill'] = props['marker-fill'];

      // marker-width -> marker-width
      styleProperties['marker-width'] = num(props['marker-width']);

      // marker-line-color -> marker-line-color
      if (has('marker-line-color')) styleProperties['marker-line-color'] = props['marker-line-color'];

      // marker-scale -> marker-scale
      if (has('marker-scale')) styleProperties['marker-scale'] = numberPair(props['marker-scale']);

      circleDescriptors.push({ kind: 'circle', id, styleProperties });
    }

    // marker / point / shield symbolizers (icons)
    // for (const mp of MARKER_PREFIXES) {
    //   const file = props[mp + '-file'];
    //   if (file === undefined) continue;
    //   descriptors.push({
    //     kind: mp,
    //     instance,
    //     properties: prune({
    //       kind: mp,
    //       // shields carry their own text
    //       label: mp === 'shield' && props['shield-name'] !== undefined ? resolveField(props['shield-name'], tags) : undefined
    //     }),
    //     styleProperties: prune({
    //       'icon': iconId(file),
    //       'icon-width': num(props[mp + '-width']),
    //       'icon-height': num(props[mp + '-height']),
    //       'shield-size': mp === 'shield' ? num(props['shield-size']) : undefined
    //     })
    //   });
    // }
  }
  return {
    textDescriptors,
    circleDescriptors
  };
}

module.exports = { paintToLabels, resolveField, pair: numberPair };
