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
function pair(v) {
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
 * @returns null when there is no text/marker symbolizer, else
 *   Array<{ kind, instance, properties, styleProperties }> in cascade (first-seen) order.
 */
function paintToLabels(paint, tags = {}) {
  const out = [];
  const instances = splitInstances(paint);
  for (const [instance, { props }] of instances) {
    // text symbolizer
    if (props['text-name'] !== undefined) {
      const label = resolveField(props['text-name'], tags);
      if (label) {
        out.push({
          kind: 'text',
          instance,
          properties: prune({
            kind: 'text',
            label
          }),
          styleProperties: prune({
            'text-size': num(props['text-size']),
            'text-scale': pair(props['text-scale']),
            'text-fill': props['text-fill'],
            'text-halo-fill': props['text-halo-fill'],
            'text-halo-radius': num(props['text-halo-radius']),
            'text-face-name': props['text-face-name'],
            'text-placement': props['text-placement'],
            'text-dy': num(props['text-dy']),
            'text-wrap-width': num(props['text-wrap-width'])
          })
        });
      }
    }

    // marker / point / shield symbolizers (icons)
    for (const mp of MARKER_PREFIXES) {
      const file = props[mp + '-file'];
      if (file === undefined) continue;
      out.push({
        kind: mp,
        instance,
        properties: prune({
          kind: mp,
          // shields carry their own text
          label: mp === 'shield' && props['shield-name'] !== undefined ? resolveField(props['shield-name'], tags) : undefined
        }),
        styleProperties: prune({
          'icon': iconId(file),
          'icon-width': num(props[mp + '-width']),
          'icon-height': num(props[mp + '-height']),
          'shield-size': mp === 'shield' ? num(props['shield-size']) : undefined
        })
      });
    }

    // ellipse/circle marker with marker-fill
    if (props['marker-fill'] !== undefined) {
      out.push({
        kind: 'circle',
        instance,
        properties: prune({
          kind: 'circle'
        }),
        styleProperties: prune({
          'marker-fill': props['marker-fill'],
          'marker-line-color': props['marker-line-color'],
          'marker-width': num(props['marker-width']),
          'marker-scale': pair(props['marker-scale'])
        })
      });
    }
  }
  return out.length ? out : null;
}

module.exports = { paintToLabels, resolveField, pair };
