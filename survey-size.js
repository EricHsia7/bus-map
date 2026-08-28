const fs = require('node:fs');
const path = require('node:path');

/**
 * Survey generated tile sizes.
 * - Expected structure: dir/z/x/y.ext
 * @param {string} rootDir Root tiles directory
 */
async function surveyTileSizes(rootDir, extension) {
  const sizesByZoom = new Map();

  async function walk(dir, zoom = null) {
    const entries = await fs.promises.readdir(dir, {
      withFileTypes: true
    });

    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const nextZoom = zoom === null && /^\d+$/.test(entry.name) ? Number(entry.name) : zoom;

        await walk(filePath, nextZoom);
      } else if (entry.isFile() && entry.name.endsWith(extension) && zoom !== null) {
        const size = (await fs.promises.stat(filePath)).size;

        let sizes = sizesByZoom.get(zoom);
        if (!sizes) {
          sizes = [];
          sizesByZoom.set(zoom, sizes);
        }

        sizes.push(size);
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

  return [...sizesByZoom.entries()]
    .sort(([a], [b]) => a - b)
    .map(([zoom, sizes]) => {
      sizes.sort((a, b) => a - b);

      const total = sizes.reduce((sum, size) => sum + size, 0);
      const count = sizes.length;
      return {
        zoom,
        p95_bytes: Math.round(percentile(sizes, 0.95)),
        p75_bytes: Math.round(percentile(sizes, 0.75)),
        p50_bytes: Math.round(percentile(sizes, 0.5)),
        p25_bytes: Math.round(percentile(sizes, 0.25)),
        count,
        total_bytes: total,
        mean_bytes: Math.round((total / count) * 100) / 100
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
