function registerChars(charsets, text, styleReference) {
  if (!charsets.has(styleReference)) {
    charsets.set(styleReference, new Map());
  }

  const charset = charsets.get(styleReference);
  const length = text.length;
  for (let i = 0; i < length; i++) {
    if (!charset.has(text[i])) {
      const size = charset.size;
      charset.set(text[i], size);
    }
  }
}

function dumpCharsets(charsets) {
  const output = [];
  for (const [styleReference, charset] of charsets) {
    output.push({
      style: styleReference,
      charset: Array.from(charset.keys()).join('')
    });
  }
  return output;
}

module.exports = {
  registerChars,
  dumpCharsets
};
