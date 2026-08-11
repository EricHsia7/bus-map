const kindToTable = {
  text: 'textStyles',
  marker: 'iconStyles',
  point: 'iconStyles',
  shield: 'iconStyles',
  circle: 'circleStyles'
};

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

function createStyleTables() {
  return { textStyles: [], iconStyles: [], circleStyles: [], charsets: [], index: new Map(), charIndex: new Map() };
}

function registerStyle(tables, desc) {
  const { kind, properties, styleProperties } = desc;
  const table = kindToTable[kind];
  if (table === undefined) throw new Error(`lunknown kind "${kind}"`);
  const key = `${table}\u0000${canonical(styleProperties)}`;
  const existingReference = tables.index.get(key);
  if (!existingReference) {
    const length = tables[table].length;
    tables[table].push(styleProperties);
    tables.index.set(key, length);
    return length;
  }
  return existingReference;
}

module.exports = {
  createStyleTables,
  registerStyle,
  kindToTable
};
