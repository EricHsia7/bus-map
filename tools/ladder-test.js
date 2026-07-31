// Unit + equivalence tests for step() / interpolate().
// Run: node tools/ladder-test.js   (from the package root)
const c = require('../compile-carto.js');

let pass = 0;
let fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
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

/* --- parseStops ------------------------------------------------------- */
eq(
  c.parseStops('step', '0.5 12, 1 14, 2 16', '--line-width'),
  [
    { value: '0.5', zoom: 12 },
    { value: '1', zoom: 14 },
    { value: '2', zoom: 16 }
  ],
  'parseStops basic'
);

// value containing spaces and a top-level-comma-bearing function call
eq(
  c.parseStops('step', 'darken(@c, 10%) 14, rgba(1, 2, 3, 0.5) 16', '--line-color'),
  [
    { value: 'darken(@c, 10%)', zoom: 14 },
    { value: 'rgba(1, 2, 3, 0.5)', zoom: 16 }
  ],
  'parseStops paren-aware'
);

throws(() => c.parseStops('step', '1 12.5', '--w'), 'step rejects fractional stop');
throws(() => c.parseStops('step', '1 14, 2 12', '--w'), 'stops must increase');
throws(() => c.parseStops('step', '1 12, 2 12', '--w'), 'stops must strictly increase');
throws(() => c.parseStops('step', '', '--w'), 'needs a stop');
throws(() => c.parseStops('step', '5', '--w'), 'stop needs a zoom');
eq(
  c.parseStops('interpolate', '1 12.5, 4 18', '--w'),
  [
    { value: '1', zoom: 12.5 },
    { value: '4', zoom: 18 }
  ],
  'interpolate allows fractional stop'
);

/* --- evalLadder: step -------------------------------------------------- */

const stepAt = (z) => c.evalLadder('step(0.5 12, 1 14, 2 16)', z, '--line-width');
eq([11, 12, 13, 14, 15, 16, 24].map(stepAt), [undefined, '0.5', '0.5', '1', '1', '2', '2'], 'step is piecewise-constant, undefined below first stop, clamped above last');

/* --- evalLadder: interpolate ------------------------------------------ */

const iAt = (z) => c.evalLadder('interpolate(0.5 12, 4 18)', z, '--line-width');
eq([11, 12, 13, 15, 18, 20].map(iAt), [undefined, '0.5', '1.0833', '2.25', '4', '4'], 'interpolate is linear between stops and clamped after the last');

// fractional stops: only integer zooms are sampled

eq(
  [12, 13, 14, 16, 17].map((z) => c.evalLadder('interpolate(0 12.5, 10 16.5)', z, '--w')),
  [undefined, '1.25', '3.75', '8.75', '10'],
  'interpolate samples integer zooms across fractional stops'
);

// colors

eq(
  [10, 11, 12].map((z) => c.evalLadder('interpolate(#000000 10, #ffffff 12)', z, '--line-color')),
  ['rgba(0,0,0,1)', 'rgba(128,128,128,1)', 'rgba(255,255,255,1)'],
  'interpolate blends colors'
);

throws(() => c.evalLadder('interpolate(butt 10, round 12)', 11, '--line-cap'), 'interpolate rejects non-numeric, non-color values');

/* --- zoomBands --------------------------------------------------------- */
eq(
  c.zoomBands({ 'line-width': 'step(0.5 12, 1 14, 2 16)' }).map((b) => [b.min, b.max, b.paint['line-width']]),
  [
    [12, 13, '0.5'],
    [14, 15, '1'],
    [16, 24, '2']
  ],
  'zoomBands collapses a step ladder into 3 bands'
);

// a constant property is carried into every band, and still renders below the
// ladder's first stop
eq(
  c.zoomBands({ 'line-color': '#abc', 'line-width': 'step(1 12, 2 14)' }).map((b) => [b.min, b.max, JSON.stringify(b.paint)]),
  [
    [0, 11, '{"line-color":"#abc"}'],
    [12, 13, '{"line-color":"#abc","line-width":"1"}'],
    [14, 24, '{"line-color":"#abc","line-width":"2"}']
  ],
  'constant properties survive banding'
);

// two ladders on one rule -> union of their breakpoints
eq(
  c.zoomBands({ a: 'step(1 10, 2 14)', b: 'step(9 12)' }).map((b) => [b.min, b.max]),
  [
    [10, 11],
    [12, 13],
    [14, 24]
  ],
  'two ladders union their breakpoints'
);

// repeated values coalesce instead of emitting duplicate rules
eq(
  c.zoomBands({ a: 'interpolate(3 10, 3 20)' }).map((b) => [b.min, b.max]),
  [[10, 24]],
  'equal-valued bands coalesce'
);

// no ladder at all -> one band spanning every zoom
eq(
  c.zoomBands({ a: '1' }).map((b) => [b.min, b.max]),
  [[0, 24]],
  'constant paint is one band'
);

/* --- clipGroupsToBand -------------------------------------------------- */
const groups = [
  { layer: 'roads', zoom: { min: 0, max: 24 }, and: [] },
  { layer: 'bridges', zoom: { min: 15, max: 24 }, and: [] }
];
eq(c.clipGroupsToBand(groups, { min: 12, max: 13 }), [{ layer: 'roads', zoom: { min: 12, max: 13 }, and: [] }], 'band clips group zooms and drops non-overlapping groups');
eq(c.clipGroupsToBand(groups, { min: 0, max: 24 }), groups, 'full band is a no-op');

/* --- equivalence: ladder vs hand-written :zoom() ladder ---------------- */
// The collapsed form must produce exactly the rules the expanded form does.
const expanded = [
  { sel: '#roads:zoom(12, 13)', width: '0.5' },
  { sel: '#roads:zoom(14, 15)', width: '1' },
  { sel: '#roads:zoom(16)', width: '2' }
].map(({ sel, width }) => ({
  groups: c.buildGroups([sel]),
  paint: { 'line-width': width }
}));

const collapsed = c.zoomBands({ 'line-width': 'step(0.5 12, 1 14, 2 16)' }).map((band) => ({
  groups: c.clipGroupsToBand(c.buildGroups(['#roads']), band),
  paint: band.paint
}));

eq(collapsed, expanded, 'step() compiles to the same rules as the expanded :zoom() ladder');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
