// area-filter.js — zoom-dependent minimum-area filter for polygons.
//
// The decision is made per *feature* on its complete, unclipped geometry, and
// turned into a single `minZoom` before any tile is touched. Every tile that
// the feature crosses therefore makes the same keep/drop decision: a polygon
// is either drawn in all of its tiles or in none of them, never in pieces.
//
// Area unit: Web Mercator m² (EPSG:3857). That is deliberately *not* the true
// ground area — the map is drawn in Mercator, so Mercator area is exactly
// proportional to the on-screen pixel area at every latitude. This is also
// how osm2pgsql's `way_area` (used by openstreetmap-carto) is defined.
//
// Ladder (config.tiles.areaLadder), thresholds in square pixels of a
// 256-px reference tile (carto's `way_pixels` convention, independent of
// config.tiles.size):
//
//   "areaLadder": {
//     "default":  [[0, 4], [12, 2], [16, 1], [18, 0]],
//     "building": [[0, 16], [16, 4], [17, 0]],
//     "landuse":  [[0, 8], [14, 2], [17, 0]]
//   }
//
// Each [z, px] step applies from zoom z upwards until the next step. A class
// is chosen by the first ladder key (other than "default") present in the
// feature's tags, in the order written in config.

const R = 6378137;
const WORLD = 2 * Math.PI * R;

/** Mercator m² covered by one 256-px reference pixel at zoom z. */
function pixelArea(z) {
  const size = WORLD / (256 * 2 ** z);
  return size * size;
}

/**
 * Absolute shoelace area of a ring of [x, y] metres. Coordinates are taken
 * relative to the first vertex so the products stay small (no precision loss
 * on ~1e7 m Mercator values). Closing vertex optional.
 */
function ringArea(ring) {
  const n = ring.length;
  if (n < 3) return 0;
  const ox = ring[0][0];
  const oy = ring[0][1];
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    s += (ring[j][0] - ox) * (ring[i][1] - oy) - (ring[i][0] - ox) * (ring[j][1] - oy);
  }
  return Math.abs(s) / 2;
}

function compileLadder(spec, minZ, maxZ) {
  const classes = [];
  const tables = new Map();
  const steps = (list) => {
    const sorted = list.slice().sort((a, b) => a[0] - b[0]);
    const table = new Float64Array(maxZ + 1);
    for (let z = 0; z <= maxZ; z++) {
      let px = 0;
      for (const [fromZ, value] of sorted) if (z >= fromZ) px = value;
      table[z] = px * pixelArea(z); // threshold in m² at this zoom
    }
    return table;
  };
  for (const key of Object.keys(spec || {})) {
    tables.set(key, steps(spec[key]));
    if (key !== 'default') classes.push(key);
  }
  if (!tables.has('default')) tables.set('default', new Float64Array(maxZ + 1)); // 0 = keep everything

  const classOf = (tags) => {
    for (const key of classes) if (tags[key] !== undefined) return key;
    return 'default';
  };

  /** Lowest zoom at which a polygon of `area` m² is kept; Infinity = never. */
  const minZoomOf = (area, tags) => {
    const table = tables.get(classOf(tags));
    for (let z = minZ; z <= maxZ; z++) if (area >= table[z]) return z;
    return Infinity;
  };

  return { minZoomOf, classOf };
}

module.exports = { ringArea, pixelArea, compileLadder };
