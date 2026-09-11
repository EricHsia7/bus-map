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

function createLabelsStyleTables() {
  return { styles: [], index: new Map() };
}

function registerLabelsStyle(tables, styleProperties) {
  const key = canonical(styleProperties);
  const existingReference = tables.index.get(key);
  if (existingReference === undefined) {
    const length = tables.styles.length;
    tables.styles.push(styleProperties);
    tables.index.set(key, length);
    return length;
  }
  return existingReference;
}

module.exports = {
  createLabelsStyleTables,
  registerLabelsStyle
};
