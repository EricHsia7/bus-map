const { kindToTable } = require('./label-styles');

function registerChars(charsets, label, kind, styleReference) {
  const key = `${kind}\u0000${styleReference}`;
  if (!charsets.has(key)) {
    charsets.set(key, new Map());
  }

  const charset = charsets.get(key);
  const length = label.length;
  const indices = new Array(length);
  for (let i = length - 1; i >= 0; i--) {
    if (!charset.has(label[i])) {
      const size = charset.size;
      indices[i] = size;
      charset.set(label[i], size);
      continue;
    }
    indices[i] = charset.get(label[i]);
  }
  return indices;
}

function dumpCharsets(charsets) {
  const output = [];
  for (const [key, charset] of charsets) {
    const [kind, styleReference] = key.split('\u0000');
    output.push({
      table: kindToTable[kind],
      style: parseInt(styleReference),
      charset: Array.from(charset.keys()).join('')
    });
  }
  return output;
}

module.exports = {
  registerChars,
  dumpCharsets
};
