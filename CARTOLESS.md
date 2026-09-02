# CARTOLESS

# CartoLESS

A re-spelling of CartoCSS that is **valid, standard LESS**. Every `.less` file in
`style/` parses with an unmodified `lessc`; all map-specific meaning is carried by
constructs LESS already understands: custom properties, attribute selectors,
pseudo-classes, pseudo-elements, and `&` nesting.

`compile-carto.js` reads these files and emits exactly the same rule JSON the old
CartoCSS compiler produced.

---

## Command line

```bash
cat ./style/*.less > style.less
node compile-carto.js style.less > style.json
```

| flag     | effect                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--dark` | every resolved colour is inverted (`invert.js`) for a dark basemap; only colours change, geometry and sizes are untouched |

**Note that `compile-carto.js` respects the order of selectors and rules in the input stylesheet, so a custom concatenation script or prefixed file names are necessary to ensure layer order and rule cascading.**

---

## Properties

```less
--line-width: 2;
--line-color: @river-color;
--text-face-name: @book-fonts;
```

### Instances

CartoCSS wrote instances as `name/prop`. A slash is not legal in a custom property name, so the separator is `__` (double underscore):

| CartoCSS                     | CartoLESS                       | compiled key            |
| ---------------------------- | ------------------------------- | ----------------------- |
| `line-width: 2;`             | `--line-width: 2;`              | `line-width`            |
| `background/line-width: 2;`  | `--background__line-width: 2;`  | `background/line-width` |
| `tunnelfill/line-color: @c;` | `--tunnelfill__line-color: @c;` | `tunnelfill/line-color` |

Only the **first** `__` is the instance separator, so `--casing__line-dasharray`
round-trips correctly.

> [!NOTE]
> LESS does not interpolate custom property values. `lessc` treats the right-hand side of a `--*` declaration as verbatim text, so `--line-color: @grass` is _not_ substituted by LESS. This is deliberate: `compile-carto.js` performs variable substitution itself, so `@`-variables keep working and stay readable in the source. Do not run these files through `lessc` and expect resolved colors.

### Scales

A size that grows with zoom can be written in two ways. Either put the ladder on
the size itself:

```less
#text:zoom(12) {
  --text-size: zoom-gradient(10 12z, 30 15z); // text size is updated when the zoom level jumps
}

#circle:zoom(13) {
  --marker-fill: blue;
  --marker-width: zoom-gradient(2 12z, 5 15z);
}
```

or state a reference size once and put the ladder on a `*-scale` multiplier:

```less
#text:zoom(12) {
  --text-size: 10;
  --text-scale: zoom-gradient(1 12z, 3 15z); // supports continuous interpolation at runtime
}

#circle:zoom(13) {
  --marker-fill: blue;
  --marker-width: 2;
  --marker-scale: zoom-gradient(1 12z, 2.5 15z);
}
```

The two spellings are **not** equivalent. `--text-scale` and `--marker-scale`
are never folded into their sibling size: they are shipped properties in their
own right, resolved on the client. See Interpolated properties.

---

## Selectors

A compound selector is written in this order:

```less
#layer [attributes] :pseudo-functions ::attachment
```

### Layers

A layer is an id selector — `#roads-fill` — and is emitted as the `layer` key of
each group, without the `#`. A selector that names no id emits `layer: null`.

Ids inside attribute values or pseudo-class arguments (a hex colour, say) are
never mistaken for a layer: those spans are blanked out before the scan.

A comma list may span layers (`#roads-casing, #bridges, #tunnels`); each
alternative becomes its own group with its own layer and zoom window. Because a
feature belongs to exactly one layer, two _different_ ids on one flattened
selector are unsatisfiable and emit no group at all — see change **c** below.

### Attachments

Unchanged, but always written last, as a pseudo-element: `::casing`, `::halo`.

An attachment may sit on any segment of a nesting chain; the innermost one wins.
It is emitted as a top-level `attachment` key next to `groups` and `paint`, never as a paint property, and because each attachment is rendered as its own symbolizer, paint from one attachment never cascades onto another.

### Equality filters

CartoCSS’s single-quoted filters become standard CSS attribute selectors with
double quotes:

| CartoCSS           | CartoLESS          |
| ------------------ | ------------------ |
| `[feature='park']` | `[feature="park"]` |
| `[ref != 'x']`     | `:not([ref="x"])`  |
| `[ref != '']`      | `:not([ref=""])`   |

Double quotes are the canonical spelling, but the tokenizer also accepts
single-quoted and unquoted values, so a stylesheet can be migrated file by file.

### Nesting

CartoCSS nesting meant **AND**, but a bare nested `[k='v'] { }` looks like a
descendant selector in LESS. Nested selectors are therefore explicitly prefixed
with `&`:

```less
#roads-fill:zoom(12) {
  &[feature='highway_primary'] {
    --line-width: 4;
  }
}
```

A comma-separated list still expands to the cartesian product of parent × child,
just like before. A nested selector that forgets the `&` is still treated as AND rather than as a descendant selector, since descent has no meaning for a layer.

---

## Zoom and numeric functions

These are the “custom functions” — they collapse the repetitive
`[zoom >= a][zoom < b]` and `[k >= a][k <= b]` chains into one legible token.
Syntactically they are ordinary functional pseudo-classes, so LESS parses them
without complaint.

### `:zoom(min)` / `:zoom(min, max)`

Bounds are **inclusive**, and `*` means open:

| CartoCSS                      | CartoLESS       |
| ----------------------------- | --------------- |
| `[zoom >= 12]`                | `:zoom(12)`     |
| `[zoom >= 12][zoom < 15]`     | `:zoom(12, 14)` |
| `[zoom <= 9]` / `[zoom < 10]` | `:zoom(*, 9)`   |
| `[zoom = '9']`                | `:zoom(9, 9)`   |
| any zoom                      | omit entirely   |

### Numeric comparisons

For non-zoom numeric attributes:

| CartoCSS                 | CartoLESS                  |
| ------------------------ | -------------------------- |
| `[height > 20]`          | `:gt(height, 20)`          |
| `[height >= 20]`         | `:gte(height, 20)`         |
| `[score < 400000]`       | `:lt(score, 400000)`       |
| `[population <= 600000]` | `:lte(population, 600000)` |

With `zoom` as the key these narrow the zoom window instead of becoming a
filter, and strict bounds are converted to inclusive ones: `:gt(zoom, 12)` is a floor of 13, `:lt(zoom, 12)` a ceiling of 11.

### `:range(key, lo, hi)`

A matched `>=` / `<=` pair on one key collapses into a single inclusive range:

```less
:range(score, 1, 9)      // was [score>=1][score<=9]
:range(zoom, 12, 14)     // equivalent to :zoom(12, 14)
:range(score, 1000, *)   // open upper bound
```

Either bound may be `*` to leave that end open, as in `:zoom`. With `zoom`
as the key the range narrows the zoom window and emits no filters.

---

## Three intentional changes

The new compiler is otherwise faithful to the old one (verified rule-by-rule over
all 17 stylesheets: 2230 rules / 28720 selector groups). Three differences are
deliberate bug fixes:

**a. Empty-string inequality is no longer silently dropped.**
The old filter regex required at least one character in the value, so
`[ref != '']` in `f-golf.mss` was discarded entirely. `:not([ref=""])` now
compiles to `{ key: "ref", op: "!=", value: "" }`, which is what the stylesheet
always meant.

**b. Zoom constraints intersect instead of overwriting.**
In `5-roads`, `#roads-fill[zoom >= '10'] { [zoom='9'] { ... } }` used to compile
to `9..9` — the child’s `=` overwrote the parent’s floor, so a halo rendered at
z9 from a layer the parent explicitly restricted to z≥10. Nested zoom bounds now
intersect (`min = max(...)`, `max = min(...)`), yielding an empty `10..9` range,
so the contradictory rule correctly never matches. This affects 5 rules, all in
`5-roads`, all of them contradictions of exactly this kind.

**c. Contradictory layer intersections are dropped instead of widened.**
Flattening a nested rule can leave two different ids on one selector, e.g.
`#roads-casing, #bridges, #tunnels { &::bridges_and_tunnels_background { &[feature='highway_bridleway'] { &#bridges { … } } } }` flattens to
`#roads-casing … #bridges` as well as `#bridges … #bridges`. A feature belongs to
exactly one layer, so `#a#b` with `a != b` is unsatisfiable. The old behavior kept the first id, which silently widened every re-narrowed block back to all of its ancestor layers — that is how bridge and tunnel casings ended up painted on plain roads. Such selector combinations now emit no group at all.

---

## zoom-gradient()

```less
--line-width: zoom-gradient(1, 2.5 16z, 4 17z, 6 18z, 8 19z, 12 20z);
--line-color: zoom-gradient(#eeeeee 10z, #333333 16z);
--line-width: zoom-gradient(2 12z 15z, 8 16z);
```

A ladder need not be the whole value. It may sit inside arithmetic, and it may
be reached through a variable, so `@path-width * @path-scale + 2` is legal when
either variable holds a ladder: every ladder mentioned in a value is sampled at
the current zoom before the colour and arithmetic evaluators run. An embedded
sample is parenthesised, since a stop may itself be an expression such as
`(0.86 / 0.94)`; a ladder spanning the whole value is substituted verbatim,
because it may be a colour rather than a number. If any ladder in the value has
not started at that zoom, the property is not emitted. Resolution is memoised
per `(zoom, text)` pair, and rounding to 4 decimals happens once at the end, so
a chain such as `0.94 * (0.86 / 0.94) + 0.28` does not accumulate error.

### The `z` unit

Stop positions carry a `z` unit, exactly as CSS gradient stops carry `%`. This
is not decoration: a stop _value_ can itself be a bare number, so `2.5 16`
would be ambiguous. `2.5 16z` never is. Omitting the unit is a compile error
rather than a silent misparse.

### Semantics

| Form                  | Meaning                                                |
| --------------------- | ------------------------------------------------------ |
| `v p1z`               | a stop at zoom `p1`                                    |
| `v p1z p2z`           | a **hard stop**: `v` is constant across `p1…p2`        |
| `v` (first stop only) | a **base value**, held until the first positioned stop |

- Two positioned stops **interpolate** between their positions, like CSS.
- After the last stop the value is **clamped**.
- Before the first positioned stop, with no base, the property is **not
  emitted** at all.
- Numbers blend when their units agree (`2px`→`4px` gives `3px`); everything the
  colour model can read blends per RGBA channel. Anything else is an error.

The base value is the one deliberate deviation from CSS. CSS would interpolate
a position-less leading stop from position 0, but a leading value with nothing
before it has nothing to interpolate _from_; holding it constant is what map
styles actually mean by a default.

### Worked example

A seven-block `::casing` ladder:

```less
&::casing {
  --line-width: 1;
  --line-color: mix(@roller-coaster-casing, @roller-coaster-fill, 50%);
  --line-join: round;
  &[tunnel='yes']:zoom(16) {
    --line-color: darken(@roller-coaster-casing, 20%);
  }
  &:zoom(16) {
    --line-color: @roller-coaster-casing;
    --line-width: 2.5;
  }
  &:zoom(17) {
    --line-width: 4;
  }
  &:zoom(18) {
    --line-width: 6;
  }
  &:zoom(19) {
    --line-width: 8;
  }
  &:zoom(20) {
    --line-width: 12;
  }
}
```

collapses to two:

```less
&::casing {
  --line-width: zoom-gradient(1, 2.5 16z, 4 17z, 6 18z, 8 19z, 12 20z);
  --line-color: zoom-gradient(mix(@roller-coaster-casing, @roller-coaster-fill, 50%), @roller-coaster-casing 16z);
  --line-join: round;
  &[tunnel='yes']:zoom(16) {
    --line-color: darken(@roller-coaster-casing, 20%);
  }
}
```

Both compile to the same seven rules with the same paint at every zoom 0–24.

### API added to `color.js`

```jsx
looksLikeZoomGradientValue(value); // -> boolean
parseZoomGradient(value); // -> { type, stops: [{ value, from, to }] } | undefined
sampleZoomGradient(gradient, position); // -> string | undefined  (accepts source or parsed)
interpolateStopValues(from, to, t); // -> string | undefined
```

`parseZoomGradient` returns `undefined` rather than throwing, so it composes
with the existing `looksLike…` / `parse…` pairs; the compiler turns that into a
diagnostic. `zoom-gradient(` is matched by neither `looksLikeColorValue` nor
`looksLikeNumericalExpression`, so the value reaches the sampler intact — which
is precisely why it is not called `linear-gradient()`: that name _is_ matched by
`looksLikeColorValue`, and the value would collapse to `rgba(0,0,0,0)`.

## Interpolated properties

Rules are banded per integer zoom, but a few properties are not shipped as a
single value: they are emitted as the **interval** `[v(z), v(z + 1)]`, exactly the
range over which tile zoom `z` is displayed. The client interpolates inside that
interval, so the value moves continuously between zooms.

The set (`INTERPOLATABLE_TARGETS`) is fixed:

| property       | shipped as |
| -------------- | ---------- |
| `line-width`   | `[w0, w1]` |
| `line-color`   | `[c0, c1]` |
| `polygon-fill` | `[c0, c1]` |
| `text-scale`   | `[s0, s1]` |
| `marker-scale` | `[s0, s1]` |

```json
{ "text-size": 10, "text-scale": [1, 1.2] }
```

Rules:

- Scales are **shipped, never folded**. `--text-scale` and `--marker-scale` reach
  the JSON next to their reference size (`text-size`, `marker-width`): the
  label/GPU consumer rasterizes glyphs once at the reference size and scales
  them on the GPU. `--line-scale` has no special meaning and ships as a plain
  resolved value.
- The interval is per **instance**: `casing/line-width` gets its own lookahead,
  independent of the bare `line-width`.
- The lookahead happens in the compiler, not in `render.js`, so the label pass
  keeps its single `matchRules`/`inferLayers` call at tile zoom.
- If the property stops being emitted at `z + 1`, or `z` is the maximum zoom, the
  interval is flat (`v1 = v0`) rather than interpolating toward nothing.
- Because the interval changes at every zoom, a rule carrying an interpolated
  property is banded at essentially every zoom rather than collapsing into one
  rule.

Add further properties to `INTERPOLATABLE_TARGETS` if others should be smoothed
the same way.

### `--flat`

Smoothing is wrong wherever a value is meant to _step_. `--flat` opts individual
properties out of the lookahead: the listed properties still ship as intervals,
but as the flat interval `[v0, v0]`.

```less
#water-lines-low-zoom:zoom(8, 11) {
  --line-color: @water-color;
  --line-width: zoom-gradient(@river-width-z8, @river-width-z9 9z, @river-width-z10 10z);
  --flat: line-width; // widths jump at each zoom; the colour still interpolates
}
```

- The value is a comma-separated list of **bare** property names, so
  `--flat: line-width, polygon-fill;` flattens both.
- The declaration is per instance, like any other: `--casing__flat: line-width`
  flattens `casing/line-width` and leaves the bare one interpolating.
- `--flat` only affects properties declared in the same block; it is not
  inherited by nested rules, which each carry their own declarations.
- The list itself is an ordinary paint key, so it appears in the compiled JSON
  as `flat` alongside the properties it governs.
