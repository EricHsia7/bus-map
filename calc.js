function splitByTopLevelDelimiter(value, legalDelimiters = ['+', '-', '*', '/']) {
  value = value.trim();
  let leftBracket = 0;
  let rightBracket = 0;
  let start = 0;
  const result = [];
  const delimiters = [];
  const len = value.length;
  const prevNonSpace = (i) => {
    let j = i - 1;
    while (j >= 0 && value[j] === ' ') j--;
    return j >= 0 ? value[j] : '';
  };
  for (let i = 0, l = len, l1 = len - 1; i < l; i++) {
    const char = value[i];
    if (char === '(') {
      leftBracket++;
    }
    if (char === ')') {
      rightBracket++;
    }
    if (leftBracket === rightBracket) {
      let isDelimiter = legalDelimiters.indexOf(char) > -1;
      // A leading '+'/'-' (at the start, or right after another operator or an
      // opening bracket) is a unary sign that belongs to the number, not a
      // top-level delimiter. Fixes calc('5 * -1') -> -5.
      if (isDelimiter && (char === '+' || char === '-')) {
        const prev = prevNonSpace(i);
        if (prev === '' || '+-*/('.indexOf(prev) > -1) isDelimiter = false;
      }
      if (isDelimiter) {
        result.push(value.slice(start, i).trim());
        delimiters.push(char);
        start = i + 1;
      } else if (i === l1) {
        result.push(value.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  return { result, delimiters };
}

function stripTopLevelModel(value) {
  const trimmed = value.trim();
  const trimmedLen = trimmed.length;
  let start = 0;
  let end = 0;
  for (let i = 0, l = trimmedLen; i < l; i++) {
    const char = trimmed[i];
    if (char === '(') {
      start = i;
      break;
    }
  }
  for (let i = trimmedLen - 1; i >= start; i--) {
    const char = trimmed[i];
    if (char === ')') {
      end = i;
      break;
    }
  }
  return {
    result: trimmed.slice(start + 1, end).trim(),
    model: trimmed.slice(0, start).trim()
  };
}

function calc(value) {
  const { result, delimiters } = splitByTopLevelDelimiter(value);
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i][0] === '(') {
      result.splice(i, 1, calc(result[i].slice(1, -1)));
    } else if (result[i] !== '') {
      result.splice(i, 1, parseFloat(result[i]));
    }
  }

  // multiply/division
  for (let i = 0, offset = 0, l = delimiters.length; i < l; i++) {
    if (delimiters[i - offset] === '*') {
      result.splice(i - offset, 2, result[i - offset] * result[i - offset + 1]);
      delimiters.splice(i - offset, 1);
      offset++;
    }
    if (delimiters[i - offset] === '/') {
      result.splice(i - offset, 2, result[i - offset] / result[i - offset + 1]);
      delimiters.splice(i - offset, 1);
      offset++;
    }
  }

  // add/substract
  for (let i = 0, offset = 0, l = delimiters.length; i < l; i++) {
    if (delimiters[i - offset] === '+') {
      result.splice(i - offset, 2, result[i - offset] + result[i - offset + 1]);
      delimiters.splice(i - offset, 1);
      offset++;
    }
    if (delimiters[i - offset] === '-') {
      result.splice(i - offset, 2, result[i - offset] - result[i - offset + 1]);
      delimiters.splice(i - offset, 1);
      offset++;
    }
  }

  return result[0];
}

function looksLikeNumericalExpression(value) {
  return /(?:[0-9]+(?:\.[0-9]+)?|\()[0-9+\-*/().\s]*[+\-*/][0-9+\-*/().\s]*(?:[0-9]+(?:\.[0-9]+)?|\))/g.test(value);
}

module.exports = {
  looksLikeNumericalExpression,
  calc
};
