const { labelKindToTable } = require('./label-styles');

function registerChars(charsets, label, kind, styleReference) {
  const key = `${kind}\u0000${styleReference}`;
  if (!charsets.has(key)) {
    charsets.set(key, new Map());
  }

  const charset = charsets.get(key);
  const length = label.length;
  for (let i = length - 1; i >= 0; i--) {
    if (!charset.has(label[i])) {
      const size = charset.size;
      charset.set(label[i], size);
      continue;
    }
  }
}

function dumpCharsets(charsets) {
  const output = [];
  for (const [key, charset] of charsets) {
    const [kind, styleReference] = key.split('\u0000');
    output.push({
      table: labelKindToTable[kind],
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
