const fs = require('node:fs');
const path = require('node:path');
const { decompressSync } = require('fflate');
const { deltaDecode } = require('./delta');
const decoder = new TextDecoder();

const EARTH_RADIUS_KM = 6371.0088;

/**
 * Latitude (radians) of the north edge of tile row `y` at `zoom`.
 */
function tileLatRad(y, zoom) {
  const n = Math.PI * (1 - (2 * y) / 2 ** zoom);
  return Math.atan(Math.sinh(n));
}

/**
 * Exact spherical area of a single Web Mercator tile, in km².
 * Tiles are equal-area in the projected plane but not on the sphere:
 * a z12 tile at the equator is ~95 km², the same tile at 60°N is ~48 km².
 */
function tileAreaKm2(zoom, y) {
  const lonSpan = (2 * Math.PI) / 2 ** zoom;
  const north = Math.sin(tileLatRad(y, zoom));
  const south = Math.sin(tileLatRad(y + 1, zoom));
  return EARTH_RADIUS_KM ** 2 * lonSpan * (north - south);
}

function readTile(filePath) {
  const tile = fs.readFileSync(filePath);
  const decompressed = decompressSync(tile);
  const decoded = decoder.decode(decompressed);
  const parsed = JSON.parse(decoded);
  if (!parsed || parsed.type !== 'Vector') return parsed;
  return {
    type: 'Vector',
    extent: parsed.extent,
    buffer: parsed.buffer,
    zoom: parsed.zoom,
    coordinates: deltaDecode(parsed.coordinates, 2),
    partStartIndices: deltaDecode(parsed.partStartIndices, 1),
    descriptorStartIndices: deltaDecode(parsed.descriptorStartIndices, 1),
    descriptorTypes: parsed.descriptorTypes,
    styleReferences: deltaDecode(parsed.styleReferences, 1),
    styleStartIndices: deltaDecode(parsed.styleStartIndices, 1),
    styles: parsed.styles,
    palette: parsed.palette
  };
}

function descriptorAreas(vectorTile, areas) {
  const { coordinates, partStartIndices, descriptorStartIndices, descriptorTypes, styleStartIndices, styleReferences } = vectorTile;

  if (!coordinates || !partStartIndices || !descriptorStartIndices || !descriptorTypes || !styleStartIndices || !styleReferences) return;

  for (let styleRun = 0; styleRun < styleReferences.length; styleRun++) {
    const descriptorStart = styleStartIndices[styleRun];
    const descriptorEnd = styleStartIndices[styleRun + 1];
    for (let descriptor = descriptorStart; descriptor < descriptorEnd; descriptor++) {
      const partStart = descriptorStartIndices[descriptor];
      const partEnd = descriptorStartIndices[descriptor + 1];
      if (descriptorTypes[descriptor] === 0) {
        let area = 0;
        for (let part = partStart; part < partEnd; part++) {
          const start = partStartIndices[part];
          const end = partStartIndices[part + 1];
          for (let i = start; i < end; i++) {
            const current = i;
            const next = i === end - 1 ? start : i + 1;
            area += coordinates[current * 2] * coordinates[next * 2 + 1] - coordinates[next * 2] * coordinates[current * 2 + 1];
          }
        }
        if (Math.abs(area) > 0) areas.push(Math.abs(area) / 2);
      }
    }
  }
}

/**
 * Survey generated tile sizes and the ground area they cover.
 * - Expected structure: dir/z/x/y.ext
 * @param {string} rootDir Root tiles directory
 * @param {string} extension File extension to include, e.g. 'gz'
 * @param {{emptyBytes?: number}} [options] emptyBytes: tiles at or below this
 *   size are treated as empty (header only) and excluded from data-area stats.
 */
async function surveyTileSizes(rootDir, extension, options = {}) {
  const { emptyBytes = 256 } = options;
  const statsByZoom = new Map();

  async function walk(dir, zoom = null, x = null) {
    const entries = await fs.promises.readdir(dir, {
      withFileTypes: true
    });

    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      const numeric = /^\d+$/.test(entry.name);

      if (entry.isDirectory()) {
        if (zoom === null) {
          await walk(filePath, numeric ? Number(entry.name) : null, null);
        } else if (x === null) {
          await walk(filePath, zoom, numeric ? Number(entry.name) : null);
        } else {
          await walk(filePath, zoom, x);
        }
      } else if (entry.isFile() && entry.name.endsWith(extension) && zoom !== null) {
        const y = Number.parseInt(entry.name, 10);
        if (!Number.isFinite(y)) continue;

        const size = (await fs.promises.stat(filePath)).size;

        let stats = statsByZoom.get(zoom);
        if (!stats) {
          stats = { sizes: [], coveredKm2: 0, dataKm2: 0, areas: [], empty: 0 };
          statsByZoom.set(zoom, stats);
        }

        const areaKm2 = tileAreaKm2(zoom, y);
        stats.sizes.push(size);
        stats.coveredKm2 += areaKm2;

        const vectorTile = readTile(filePath);
        if (vectorTile && vectorTile.type === 'Vector') {
          descriptorAreas(vectorTile, stats.areas);
        }
        if (size > emptyBytes) stats.dataKm2 += areaKm2;
        else stats.empty += 1;
      }
    }
  }

  await walk(rootDir);

  function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];

    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) return sorted[lower];

    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  const round = (value, digits = 2) => {
    const f = 10 ** digits;
    return Math.round(value * f) / f;
  };

  return [...statsByZoom.entries()]
    .sort(([a], [b]) => a - b)
    .map(([zoom, { sizes, coveredKm2, dataKm2, areas, empty }]) => {
      sizes.sort((a, b) => a - b);
      areas.sort((a, b) => a - b);

      const total = sizes.reduce((sum, size) => sum + size, 0);
      const count = sizes.length;
      return {
        zoom,
        p95_bytes: Math.round(percentile(sizes, 0.95)),
        p50_bytes: Math.round(percentile(sizes, 0.5)),
        count,
        empty,
        empty_pct: round((100 * empty) / count, 1),
        total_bytes: total,
        mean_bytes: round(total / count),
        tile_km2: round(coveredKm2 / count, 4),
        covered_km2: round(coveredKm2, 1),
        data_km2: round(dataKm2, 1),
        bytes_per_km2: Math.round(total / coveredKm2),
        bytes_per_data_km2: dataKm2 > 0 ? Math.round(total / dataKm2) : 0,
        p95_area: Math.round(percentile(areas, 0.95) * 100) / 100,
        p75_area: Math.round(percentile(areas, 0.75) * 100) / 100,
        p50_area: Math.round(percentile(areas, 0.5) * 100) / 100,
        p25_area: Math.round(percentile(areas, 0.25) * 100) / 100,
        p5_area: Math.round(percentile(areas, 0.05) * 100) / 100,
        p0_area: Math.round(percentile(areas, 0) * 100) / 100
      };
    });
}

async function main() {
  const tilesTable = await surveyTileSizes('./tiles', 'gz');
  console.table(tilesTable);
  const labelsTable = await surveyTileSizes('./labels', 'gz');
  console.table(labelsTable);
}

main();
