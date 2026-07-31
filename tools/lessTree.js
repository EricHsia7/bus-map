// Minimal LESS block scanner shared by collapse-ladders.js and verify-collapse.js.
// It records byte offsets so rewrites can be surgical and preserve formatting.

function stripCommentsForScan(src) {
  // Replace comment and string bodies with spaces so offsets stay identical.
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src[i] === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i + 2);
      if (j === -1) j = n - 2;
      for (let k = i; k < j + 2 && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
      i = j + 2;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = n;
      for (let k = i; k < j; k++) out[k] = ' ';
      i = j;
      continue;
    }
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i];
      let j = i + 1;
      while (j < n && src[j] !== quote) j += src[j] === '\\' ? 2 : 1;
      for (let k = i + 1; k < j && k < n; k++) out[k] = ' ';
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

// Parse into a tree of blocks with offsets for surgical rewriting.
function parseLess(src) {
  const scan = stripCommentsForScan(src);
  const root = {
    selector: '',
    selectorStart: 0,
    bodyStart: 0,
    bodyEnd: src.length,
    blockStart: 0,
    blockEnd: src.length,
    decls: [],
    children: []
  };
  const stack = [root];
  let segStart = 0;

  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];

    if (ch === '{') {
      const raw = src.slice(segStart, i);
      const selector = raw.trim();
      const selectorStart = segStart + (raw.length - raw.trimStart().length);
      const block = {
        selector,
        selectorStart,
        bodyStart: i + 1,
        bodyEnd: -1,
        blockStart: selectorStart,
        blockEnd: -1,
        decls: [],
        children: []
      };
      stack[stack.length - 1].children.push(block);
      stack.push(block);
      segStart = i + 1;
      continue;
    }

    if (ch === '}') {
      const block = stack.pop();
      if (block === undefined || block === root) return root;
      block.bodyEnd = i;
      block.blockEnd = i + 1;
      segStart = i + 1;
      continue;
    }

    if (ch === ';') {
      const text = src.slice(segStart, i);
      const colon = scan.slice(segStart, i).indexOf(':');
      if (colon > -1) {
        const rawValue = text.slice(colon + 1);
        const leading = rawValue.length - rawValue.trimStart().length;
        const declStart = segStart + (text.length - text.trimStart().length);
        stack[stack.length - 1].decls.push({
          prop: text.slice(0, colon).trim(),
          value: rawValue.trim(),
          start: declStart,
          end: i + 1,
          valueStart: segStart + colon + 1 + leading,
          valueEnd: segStart + colon + 1 + leading + rawValue.trim().length
        });
      }
      segStart = i + 1;
    }
  }
  return root;
}

const ZOOM_ONLY_RE = /^&:zoom\(\s*(\d+)\s*\)$/;
const ZOOM_RANGE_RE = /^&:zoom\(\s*(\d+)\s*,\s*(\d+)\s*\)$/;

// A ladder rung is a child whose selector is nothing but a zoom constraint.
function rungZoom(selector) {
  const one = ZOOM_ONLY_RE.exec(selector);
  if (one) return { from: Number(one[1]), to: undefined };
  const range = ZOOM_RANGE_RE.exec(selector);
  if (range) return { from: Number(range[1]), to: Number(range[2]) };
  return undefined;
}

function applyEdits(src, edits) {
  const sorted = edits.slice().sort((a, b) => b.start - a.start);
  let out = src;
  let lastStart = Infinity;
  for (const edit of sorted) {
    if (edit.end > lastStart) throw new Error('overlapping edits');
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    lastStart = edit.start;
  }
  return out;
}

module.exports = { parseLess, rungZoom, applyEdits, stripCommentsForScan };
