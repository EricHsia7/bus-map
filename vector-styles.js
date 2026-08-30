const { parseCSSModel, extractRGBA } = require('./color');

// Key-order-independent serialization, so two styles that differ only in the order their properties were assigned intern to the same entry.
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

function createVectorStyleTables() {
  return { styles: [], index: new Map(), palette: [], paletteIndex: new Map() };
}

function pushColor(value, palette) {
  const component = parseCSSModel(value);
  if (!component) palette.push(0, 0, 0, 0);
  const [r, g, b, a] = extractRGBA(component);
  palette.push(r, g, b, Math.round(a * 255));
}

/**
 * @returns {number}
 */
function registerVectorStyle(tables, desc) {
  const { styleProperties } = desc;
  const key = canonical(styleProperties);
  const existingReference = tables.index.get(key);
  if (existingReference === undefined) {
    const styleReference = tables.styles.length;
    for (const property in styleProperties) {
      if (property === 'stroke' || property === 'fill') {
        const existingPaletteReference = tables.paletteIndex.get(styleProperties[property]);
        if (existingPaletteReference === undefined) {
          const paletteReference = tables.paletteIndex.size;
          tables.paletteIndex.set(styleProperties[property], paletteReference);
          pushColor(styleProperties[property], tables.palette);
          styleProperties[property] = paletteReference;
        } else {
          styleProperties[property] = existingPaletteReference;
        }
      }
    }
    tables.styles.push(styleProperties);
    tables.index.set(key, styleReference);
    return styleReference;
  }
  return existingReference;
}

module.exports = {
  createVectorStyleTables,
  registerVectorStyle
};
