# CartoLESS

A re-spelling of CartoCSS that is **valid, standard LESS**. Every `.less` file in
`style/` parses with an unmodified `lessc`; all map-specific meaning is carried by
constructs LESS already understands: custom properties, attribute selectors,
pseudo-classes, pseudo-elements, and `&` nesting.

`compile-carto.js` reads these files and emits exactly the same rule JSON the old
CartoCSS compiler produced.

---

## 1. Paint properties are custom properties

Mapnik symbolizer properties are prefixed with `--`, so LESS treats them as custom
properties instead of choking on unknown declarations.

```less
--line-width: 2;
--line-color: @river-color;
--text-face-name: @book-fonts;
```

### Instances

CartoCSS wrote instances as `name/prop`. A slash is not legal in a custom property
name, so the separator is `__` (double underscore):

| CartoCSS | CartoLESS | compiled key |
|---|---|---|
| `line-width: 2;` | `--line-width: 2;` | `line-width` |
| `background/line-width: 2;` | `--background__line-width: 2;` | `background/line-width` |
| `tunnelfill/line-color: @c;` | `--tunnelfill__line-color: @c;` | `tunnelfill/line-color` |

Only the **first** `__` is the instance separator, so `--casing__line-dasharray`
round-trips correctly.

### Caveat: LESS does not interpolate custom property values

`lessc` treats the right-hand side of a `--*` declaration as verbatim text, so
`--line-color: @grass` is *not* substituted by LESS. This is deliberate:
`compile-carto.js` performs variable substitution itself (same as the old
compiler did), so `@`-variables keep working and stay readable in the source.
Do not run these files through `lessc` and expect resolved colors.

---

## 2. Selectors

A compound selector is written in this order:

```
#layer [attributes] :pseudo-functions ::attachment
```

### Layers

Unchanged: `#roads-fill`, `#text-point`, ...

### Attachments

Unchanged, but always written last, as a pseudo-element: `::casing`, `::halo`.

### Equality filters

CartoCSS's single-quoted filters become standard CSS attribute selectors with
double quotes:

| CartoCSS | CartoLESS |
|---|---|
| `[feature='park']` | `[feature="park"]` |
| `[ref != 'x']` | `:not([ref="x"])` |
| `[ref != '']` | `:not([ref=""])` |

### Nesting

CartoCSS nesting meant **AND**, but a bare nested `[k='v'] { }` looks like a
descendant selector in LESS. Nested selectors are therefore explicitly prefixed
with `&`:

```less
#roads-fill:zoom(12) {
  &[feature="highway_primary"] {
    --line-width: 4;
  }
}
```

A comma-separated list still expands to the cartesian product of parent × child,
just like before.

---

## 3. Zoom and numeric functions

These are the "custom functions" — they collapse the repetitive
`[zoom >= a][zoom < b]` and `[k >= a][k <= b]` chains into one legible token.
Syntactically they are ordinary functional pseudo-classes, so LESS parses them
without complaint.

### `:zoom(min)` / `:zoom(min, max)`

Bounds are **inclusive**, and `*` means open:

| CartoCSS | CartoLESS |
|---|---|
| `[zoom >= 12]` | `:zoom(12)` |
| `[zoom >= 12][zoom < 15]` | `:zoom(12, 14)` |
| `[zoom <= 9]` / `[zoom < 10]` | `:zoom(*, 9)` |
| `[zoom = '9']` | `:zoom(9, 9)` |
| any zoom | omit entirely |

### Numeric comparisons

For non-zoom numeric attributes:

| CartoCSS | CartoLESS |
|---|---|
| `[height > 20]` | `:gt(height, 20)` |
| `[height >= 20]` | `:gte(height, 20)` |
| `[score < 400000]` | `:lt(score, 400000)` |
| `[population <= 600000]` | `:lte(population, 600000)` |

### `:range(key, lo, hi)`

A matched `>=` / `<=` pair on one key collapses into a single inclusive range:

```less
:range(score, 1, 9)      // was [score>=1][score<=9]
:range(zoom, 12, 14)     // equivalent to :zoom(12, 14)
```

---

## 4. Two intentional behaviour changes

The new compiler is otherwise byte-for-byte identical to the old one (verified
rule-by-rule over all 17 stylesheets: 2230 rules / 28720 selector groups). Two
differences are deliberate bug fixes:

**a. Empty-string inequality is no longer silently dropped.**
The old filter regex required at least one character in the value, so
`[ref != '']` in `f-golf.mss` was discarded entirely. `:not([ref=""])` now
compiles to `{ key: "ref", op: "!=", value: "" }`, which is what the stylesheet
always meant.

**b. Zoom constraints intersect instead of overwriting.**
In `5-roads`, `#roads-fill[zoom >= '10'] { [zoom='9'] { ... } }` used to compile
to `9..9` — the child's `=` overwrote the parent's floor, so a halo rendered at
z9 from a layer the parent explicitly restricted to z≥10. Nested zoom bounds now
intersect (`min = max(...)`, `max = min(...)`), yielding an empty `10..9` range,
so the contradictory rule correctly never matches. This affects 5 rules, all in
`5-roads`, all of them contradictions of exactly this kind.

A third, smaller improvement: top-level comma splitting is now paren-aware, so
selector lists are no longer split inside `rgba(255, 255, 255, 0.6)` or
`saturate(darken(@c, 10%), 20%)`.

---

## 5. Files

```
style/*.less        17 converted stylesheets
compile-carto.js    the new compiler (same CLI and JSON output as before)
tools/mss-to-less.js  the one-shot codemod used to convert .mss -> .less
```

Usage is unchanged:

```sh
node compile-carto.js style.less > style.json
node compile-carto.js --dark style.less > style-dark.json
```

`compile-carto.js` still requires the sibling modules `./color`, `./calc`, and
`./invert` from your existing tree; they are untouched and are not included here.
`paint-to-svg.js` also needs no changes — the compiler still emits classic
`instance/property` paint keys, which is what `splitInstances` expects.

To re-run the codemod against a fresh checkout of the original CartoCSS:

```sh
node tools/mss-to-less.js path/to/mss-dir path/to/out-dir
```

It reports a warning for anything it cannot confidently convert; the current
stylesheets convert with zero warnings.

## Zoom ladders: `step()` and `interpolate()`

A CartoCSS stylesheet expresses a zoom-varying property as a stack of sibling
blocks. In `5-roads` alone there are 417 such ladders for `--line-width` and
228 for `--line-pattern-width`. `step()` and `interpolate()` collapse each one
into a single declaration.

```less
#roads[feature="highway_motorway"] {
  --line-width: step(0.5 12, 1 14, 2 16);
  --line-color: interpolate(#cda 10, #e892a2 16);
}
```

### `step(v1 z1, v2 z2, …)` — piecewise constant

`v1` applies from `z1` up to `z2 - 1`, `v2` from `z2` to `z3 - 1`, and the last
value holds to the maximum zoom. Stop zooms must be integers and must strictly
increase. `step(0.5 12, 1 14, 2 16)` means z12–13 → `0.5`, z14–15 → `1`,
z16+ → `2`.

### `interpolate(v1 z1, v2 z2, …)` — piecewise linear

The value varies continuously between stops, so stop zooms may be **any real
number** (`interpolate(0 12.5, 10 16.5)` is valid). The curve is still only
*sampled* at the integer zooms Mapnik renders, so that ladder yields z13 →
`1.25`, z14 → `3.75`, z16 → `8.75`. Numbers and colors can be interpolated;
colors blend per RGBA channel. Anything else is a compile error.

### Shared rules

- **Below the first stop the property is not emitted.** The rule can still
  render there if it carries other, constant properties — those are copied into
  every band. This matches how the hand-written ladders behave today.
- **Above the last stop the value is clamped**, so `step(2 12)` is just "`2`
  from z12 on".
- Values may contain spaces and commas: `step(darken(@c, 10%) 14, rgba(1, 2, 3, 0.5) 16)`
  parses correctly, because the zoom is the last whitespace-separated token and
  stops are split only on top-level commas.

### How it compiles

Mapnik has no runtime zoom expression — a symbolizer property is a constant at
a given zoom. Ladders are therefore *source* sugar. The compiler evaluates
every property at each integer zoom, collapses zooms 0–24 into maximal bands
that share an identical paint object, and emits one rule per band with the
band's zoom range intersected into each selector group. Consequences:

- Two ladders on one rule union their breakpoints.
- Bands with equal values coalesce, so `interpolate(3 10, 3 20)` emits one rule.
- A band that cannot overlap a group's zoom range drops that group.
- Rules with no ladder take a fast path and compile exactly as before, so
  output for the existing stylesheets is byte-for-byte unchanged.

The emitted JSON shape is unchanged: consumers such as `paint-to-svg.js` never
see `step()` or `interpolate()`.

## `zoom-gradient()` — the underlying component

`step()` and `interpolate()` are two presets of one idea: a value that varies
along an axis, with stops. CSS already has that model, so the general form is a
gradient whose axis is the zoom level. It lives in **`color.js`**, next to the
other CSS models, and is registered in `CSSGradients` so it parses with the
same `parseModel` / `splitByTopLevelDelimiter` machinery as `linear-gradient()`.

```less
--line-width: zoom-gradient(1, 2.5 16z, 4 17z, 6 18z, 8 19z, 12 20z);
--line-color: zoom-gradient(#eeeeee 10z, #333333 16z);
--line-width: zoom-gradient(2 12z 15z, 8 16z);
```

### The `z` unit

Stop positions carry a `z` unit, exactly as CSS gradient stops carry `%`. This
is not decoration: a stop *value* can itself be a bare number, so `2.5 16`
would be ambiguous. `2.5 16z` never is. Omitting the unit is a compile error
rather than a silent misparse.

### Semantics

| Form | Meaning |
| --- | --- |
| `v p1z` | a stop at zoom `p1` |
| `v p1z p2z` | a **hard stop**: `v` is constant across `p1…p2` |
| `v` (first stop only) | a **base value**, held until the first positioned stop |

- Two positioned stops **interpolate** between their positions, like CSS.
- After the last stop the value is **clamped**.
- Before the first positioned stop, with no base, the property is **not
  emitted** at all.
- Numbers blend when their units agree (`2px`→`4px` gives `3px`); everything the
  colour model can read blends per RGBA channel. Anything else is an error.

The base value is the one deliberate deviation from CSS. CSS would interpolate
a position-less leading stop from position 0, but a leading value with nothing
before it has nothing to interpolate *from*; holding it constant is what map
styles actually mean by a default.

### Relationship to `step()` and `interpolate()`

Both desugar to this component and share its sampler, so there is exactly one
implementation of the semantics:

```
step(a 12, b 14)         ==  zoom-gradient(a 12z 13z, b 14z)
interpolate(a 12, b 18)  ==  zoom-gradient(a 12z, b 18z)
```

Use `step()`/`interpolate()` when a ladder is uniformly one kind. Reach for
`zoom-gradient()` when a single property mixes kinds — a base value plus stops,
or a constant band followed by a ramp — which the two presets cannot express.

### Worked example

A seven-block `::casing` ladder:

```less
&::casing {
  --line-width: 1;
  --line-color: mix(@roller-coaster-casing, @roller-coaster-fill, 50%);
  --line-join: round;
  &[tunnel="yes"]:zoom(16) { --line-color: darken(@roller-coaster-casing, 20%); }
  &:zoom(16) { --line-color: @roller-coaster-casing; --line-width: 2.5; }
  &:zoom(17) { --line-width: 4; }
  &:zoom(18) { --line-width: 6; }
  &:zoom(19) { --line-width: 8; }
  &:zoom(20) { --line-width: 12; }
}
```

collapses to two:

```less
&::casing {
  --line-width: zoom-gradient(1, 2.5 16z, 4 17z, 6 18z, 8 19z, 12 20z);
  --line-color: zoom-gradient(mix(@roller-coaster-casing, @roller-coaster-fill, 50%), @roller-coaster-casing 16z);
  --line-join: round;
  &[tunnel="yes"]:zoom(16) { --line-color: darken(@roller-coaster-casing, 20%); }
}
```

Both compile to the same seven rules with the same paint at every zoom 0–24;
`tools/gradient-test.js` asserts it. Note that the width stops sit at
*consecutive integer* zooms, so interpolation and stepping coincide exactly
here — there is no zoom in between at which they could differ.

### API added to `color.js`

```js
looksLikeZoomGradientValue(value)      // -> boolean
parseZoomGradient(value)               // -> { type, stops: [{ value, from, to }] } | undefined
sampleZoomGradient(gradient, position) // -> string | undefined  (accepts source or parsed)
interpolateStopValues(from, to, t)     // -> string | undefined
```

`parseZoomGradient` returns `undefined` rather than throwing, so it composes
with the existing `looksLike…` / `parse…` pairs; the compiler turns that into a
diagnostic. `zoom-gradient(` is matched by neither `looksLikeColorValue` nor
`looksLikeNumericalExpression`, so the value reaches the sampler intact — which
is precisely why it is not called `linear-gradient()`: that name *is* matched by
`looksLikeColorValue`, and the value would collapse to `rgba(0,0,0,0)`.

## Collapsing the existing stylesheets

The 17 stylesheets in `style/` ship already collapsed: 407 properties were
rewritten as `zoom-gradient()` and 926 rung blocks disappeared. The remaining
`:zoom()` blocks are not ladders — they gate whole rule bodies rather than a
single value, so they stay as selectors.

`tools/collapse-ladders.js` performs the rewrite, and `tools/verify-collapse.js`
proves it changed nothing visible:

```
node tools/collapse-ladders.js style            # dry run, prints counts
node tools/collapse-ladders.js style --write    # rewrite in place
node tools/verify-collapse.js <expanded> style  # 0 mismatches expected
```

The verifier walks both trees, computes the effective paint for every selector
chain at every zoom 0..24, and compares value by value: 72,107 comparisons,
0 mismatches. It also fails when no file changed, so a no-op run cannot pass.

Three rules keep the rewrite faithful, and each one was added because the
verifier caught the mistake:

1. **Gaps become hard stops.** An expanded rung holds its value until the next
   rung takes over. A ladder at zooms 13, 16 must emit `v 13z 15z`, not two
   interpolating stops, or zooms 14 and 15 get invented in-between values.
   Stops at consecutive zooms need no range: nothing lies between them.
2. **Values with their own top-level commas are left alone.** A stop list is
   comma-separated, so `line-dasharray: 0.1, 9` cannot be placed in one
   unambiguously.
3. **A rung with nested children still contributes its stop.** Leaving the
   declaration behind in the child would override the parent's gradient,
   because children cascade after the parent's own declarations.

Where a ladder is genuinely smooth, `zoom-gradient()` stops can be edited by
hand to drop the hard-stop ranges and interpolate instead. The collapser never
makes that choice for you, because it cannot know whether a jump was intended.
