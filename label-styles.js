'use strict';
// Style interning for the labels JSON.
//
// Almost every label property is RULE-level: it comes from the compiled paint
// and repeats identically across every feature that matched that rule. Only two
// things are feature-level: `label` (resolved against the feature's own tags)
// and `kind` (the discriminant). Hoisting the rule-level part into per-kind
// tables and leaving an index behind shrinks the payload and, more importantly,
// gives the client a stable glyph-cache key: `${style}:${label}` identifies a
// rasterized run of text exactly, with no per-feature hashing of style props.

const FEATURE_LEVEL = new Set(['kind', 'label']);

// kind -> which table holds its style. marker/point/shield deliberately share
// one table, which is exactly why `kind` must stay on the feature: the table
// cannot recover which of the three it was.
const TABLE_OF_KIND = {
  text: 'textStyles',
  marker: 'iconStyles',
  point: 'iconStyles',
  shield: 'iconStyles',
  circle: 'circleStyles'
};

// Key-order-independent serialization, so two styles that differ only in the
// order their properties were assigned intern to the same entry.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function createStyleTables() {
  return { textStyles: [], iconStyles: [], circleStyles: [], index: new Map() };
}

/**
 * Split one descriptor from paintToLabels() into its feature-level properties
 * plus an index into the matching style table.
 *
 * @param tables from createStyleTables()
 * @param desc   { kind, properties } as produced by paintToLabels()
 * @param layer  layer.id -- rule-level, so it lives in the style entry
 * @returns the feature `properties` object: { kind, style, label? }
 */
function internStyle(tables, desc, layer) {
  const { kind, properties } = desc;
  const table = TABLE_OF_KIND[kind];
  if (table === undefined) throw new Error(`label-styles: unknown kind "${kind}"`);

  const style = { layer };
  const feature = { kind };
  for (const k of Object.keys(properties)) {
    if (FEATURE_LEVEL.has(k)) {
      if (k !== 'kind') feature[k] = properties[k];
    } else {
      style[k] = properties[k];
    }
  }

  const key = `${table}\u0000${canonical(style)}`;
  let ref = tables.index.get(key);
  if (ref === undefined) {
    ref = tables[table].length;
    tables[table].push(style);
    tables.index.set(key, ref);
  }
  feature.style = ref;
  return feature;
}

/**
 * The sanctioned accessor. Switching on the discriminant means the table choice
 * can never drift from the kind; labels.d.ts declares this with a conditional
 * return type so call sites get the precise style type with no casts.
 */
function resolveStyle(collection, properties) {
  switch (properties.kind) {
    case 'text':
      return collection.textStyles[properties.style];
    case 'marker':
    case 'point':
    case 'shield':
      return collection.iconStyles[properties.style];
    case 'circle':
      return collection.circleStyles[properties.style];
    default:
      throw new Error(`label-styles: unknown kind "${properties && properties.kind}"`);
  }
}

/**
 * Inverse of internStyle: rebuild the old flat properties object. Used by the
 * round-trip test, and useful for consumers that have not migrated.
 * `zoom` is the collection-level zoom that replaced per-feature `minzoom`.
 */
function expandStyle(collection, properties, zoom) {
  const style = resolveStyle(collection, properties);
  if (style === undefined) throw new Error(`label-styles: dangling style index ${properties.style}`);
  const out = { layer: style.layer, minzoom: zoom, kind: properties.kind };
  if (properties.label !== undefined) out.label = properties.label;
  for (const k of Object.keys(style)) if (k !== 'layer') out[k] = style[k];
  return out;
}

/** Drop the interning index so the tables can be serialized. */
function finalize(tables) {
  return {
    textStyles: tables.textStyles,
    iconStyles: tables.iconStyles,
    circleStyles: tables.circleStyles
  };
}

module.exports = {
  createStyleTables,
  internStyle,
  resolveStyle,
  expandStyle,
  finalize,
  TABLE_OF_KIND,
  FEATURE_LEVEL
};
