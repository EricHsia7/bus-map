// Unit + equivalence tests for zoom-gradient(), run against the real color.js.
// Run: node tools/gradient-test.js   (from the package root)
const c = require('../compile-carto.js');
const { parseZoomGradient, sampleZoomGradient, looksLikeColorValue, looksLikeZoomGradientValue } = require('../color.js');
const { looksLikeNumericalExpression } = require('../calc.js');

let pass = 0;
let fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  }
}
function throws(fn, label) {
  try {
    fn();
    fail++;
    console.log(`FAIL ${label} (expected a throw)`);
  } catch {
    pass++;
  }
}

/* --- the value must survive the existing resolvers untouched ----------- */
const g = 'zoom-gradient(1, 2.5 16z, 4 17z)';
eq(looksLikeColorValue(g), false, 'zoom-gradient is not mistaken for a color');
eq(looksLikeNumericalExpression(g), false, 'zoom-gradient is not mistaken for arithmetic');
eq(looksLikeZoomGradientValue(g), true, 'zoom-gradient is detected');
// linear-gradient would have been swallowed by looksLikeColorValue -> rgba(0,0,0,0),
// which is exactly why the component has its own name:
eq(looksLikeColorValue('linear-gradient(red, blue)'), true, 'linear-gradient IS a color value');

/* --- parsing ----------------------------------------------------------- */
eq(
  parseZoomGradient('zoom-gradient(1, 2.5 16z, 4 17z)').stops,
  [
    { value: '1', from: undefined, to: undefined },
    { value: '2.5', from: 16, to: undefined },
    { value: '4', from: 17, to: undefined }
  ],
  'leading stop may omit its position'
);

eq(
  parseZoomGradient('zoom-gradient(mix(@a, @b, 50%) 12z, darken(#abc, 20%) 16z)').stops,
  [
    { value: 'mix(@a, @b, 50%)', from: 12, to: undefined },
    { value: 'darken(#abc, 20%)', from: 16, to: undefined }
  ],
  'values keep their own commas and spaces'
);

eq(
  parseZoomGradient('zoom-gradient(2 12z 15z, 8 16z)').stops,
  [
    { value: '2', from: 12, to: 15 },
    { value: '8', from: 16, to: undefined }
  ],
  'hard stop carries two positions'
);

eq(parseZoomGradient('zoom-gradient(1, 2 16, 4 17z)'), undefined, 'positions must carry the z unit');
eq(parseZoomGradient('zoom-gradient(1 16z, 2)'), undefined, 'only the leading stop may omit a position');
eq(parseZoomGradient('zoom-gradient(1 16z, 2 12z)'), undefined, 'positions may not go backwards');
eq(parseZoomGradient('zoom-gradient(1 10z 12z 14z)'), undefined, 'at most two positions per stop');
eq(parseZoomGradient('zoom-gradient()'), undefined, 'needs at least one stop');

/* --- sampling ---------------------------------------------------------- */
const ladder = 'zoom-gradient(1, 2.5 16z, 4 17z, 6 18z, 8 19z, 12 20z)';
eq(
  [0, 15, 16, 17, 18, 19, 20, 24].map((z) => sampleZoomGradient(ladder, z)),
  ['1', '1', '2.5', '4', '6', '8', '12', '12'],
  'base value holds, then each stop, clamped after the last'
);

eq(
  [9, 10, 24].map((z) => sampleZoomGradient('zoom-gradient(3 10z)', z)),
  [undefined, '3', '3'],
  'no base -> undefined below the first stop'
);

eq(
  [10, 11, 12].map((z) => sampleZoomGradient('zoom-gradient(0 10z, 10 12z)', z)),
  ['0', '5', '10'],
  'numbers blend across a gap'
);
eq(sampleZoomGradient('zoom-gradient(#000000 10z, #ffffff 12z)', 11), 'rgba(128,128,128,1)', 'colours blend through the real colour model');
eq(sampleZoomGradient('zoom-gradient(2px 10z, 4px 12z)', 11), '3px', 'units are preserved when they agree');
eq(sampleZoomGradient('zoom-gradient(2 10z 14z, 9 16z)', 12), '2', 'hard stop stays constant across its band');
eq(sampleZoomGradient('zoom-gradient(2 10z 14z, 9 16z)', 15), '2', 'hard stop holds until the next stop begins');

/* --- step()/interpolate() are sugar over the same component ------------ */
eq(
  c.toZoomGradient('step(0.5 12, 1 14, 2 16)', '--w').stops,
  [
    { value: '0.5', from: 12, to: 13 },
    { value: '1', from: 14, to: 15 },
    { value: '2', from: 16, to: undefined }
  ],
  'step() desugars to hard stops'
);
eq(
  c.toZoomGradient('interpolate(0.5 12, 4 18)', '--w').stops,
  [
    { value: '0.5', from: 12, to: undefined },
    { value: '4', from: 18, to: undefined }
  ],
  'interpolate() desugars to point stops'
);

eq(
  c.zoomBands({ 'line-width': 'step(0.5 12, 1 14, 2 16)' }).map((b) => [b.min, b.max, b.paint['line-width']]),
  c.zoomBands({ 'line-width': 'zoom-gradient(0.5 12z 13z, 1 14z 15z, 2 16z)' }).map((b) => [b.min, b.max, b.paint['line-width']]),
  'step() and the equivalent zoom-gradient() agree'
);

throws(() => c.zoomBands({ '--line-cap': 'zoom-gradient(butt 10z, round 14z)' }), 'un-blendable stops are a compile error, not silent garbage');
throws(() => c.zoomBands({ '--line-width': 'zoom-gradient(1, 2 16)' }), 'a missing z unit is a compile error');

/* --- equivalence with the hand-written ::casing ladder ----------------- */
// Flatten a rule list into { "layer|filters|attachment|zoom" -> paint },
// applying the cascade in source order, as the renderer sees it.
function flatten(rules) {
  const map = {};
  for (const rule of rules) {
    for (const group of rule.groups) {
      for (let z = group.zoom.min; z <= group.zoom.max; z++) {
        const key = `${group.layer}|${JSON.stringify(group.and)}|${rule.attachment || ''}|${z}`;
        map[key] = Object.assign({}, map[key], rule.paint);
      }
    }
  }
  return map;
}

// Literal colours, so both sides resolve through the real colour model to the
// same rgba strings. (@variables would resolve to rgba(0,0,0,0) here because
// this test does not populate the compiler's variable table.)
const CASING = '#8b5a2b';
const FILL = '#d2b48c';
const BASE = `mix(${CASING}, ${FILL}, 50%)`;
const SEL = '#attractions[feature="roller_coaster"]::casing';

function rule(selector, paint) {
  const rules = [];
  const groups = c.buildGroups([selector]);
  // Constant declarations go through resolveValue in the compiler's main loop,
  // so the expanded side has to do the same to be comparable.
  if (!Object.values(paint).some(c.isLadder)) {
    const resolved = {};
    for (const [k, v] of Object.entries(paint)) resolved[k] = c.resolveValue(v);
    return [{ groups, paint: resolved, attachment: 'casing' }];
  }
  for (const band of c.zoomBands(paint)) {
    const banded = c.clipGroupsToBand(groups, band);
    if (banded.length) rules.push({ groups: banded, paint: band.paint, attachment: 'casing' });
  }
  return rules;
}

// The stylesheet as written by hand.
const expanded = [...rule(SEL, { 'line-width': '1', 'line-color': BASE, 'line-join': 'round' }), ...rule(`${SEL}[tunnel="yes"]:zoom(16)`, { 'line-color': `darken(${CASING}, 20%)` }), ...rule(`${SEL}:zoom(16)`, { 'line-color': CASING, 'line-width': '2.5' }), ...rule(`${SEL}:zoom(17)`, { 'line-width': '4' }), ...rule(`${SEL}:zoom(18)`, { 'line-width': '6' }), ...rule(`${SEL}:zoom(19)`, { 'line-width': '8' }), ...rule(`${SEL}:zoom(20)`, { 'line-width': '12' })];

// The same thing with the ladders collapsed into gradients.
const collapsed = [
  ...rule(SEL, {
    'line-width': 'zoom-gradient(1, 2.5 16z, 4 17z, 6 18z, 8 19z, 12 20z)',
    'line-color': `zoom-gradient(${BASE}, ${CASING} 16z)`,
    'line-join': 'round'
  }),
  ...rule(`${SEL}[tunnel="yes"]:zoom(16)`, { 'line-color': `darken(${CASING}, 20%)` })
];

eq(flatten(collapsed), flatten(expanded), 'collapsed ::casing block renders identically at every zoom');
eq([expanded.length, collapsed.length], [7, 7], 'same emitted rule count, from 2 source blocks instead of 7');

// and the colours really did resolve (not silently rgba(0,0,0,0))
eq(flatten(collapsed)['attractions|[{"key":"feature","op":"=","value":"roller_coaster"}]|casing|0']['line-color'], 'rgba(175,135,92,1)', 'the base mix() resolves through the real colour model');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
