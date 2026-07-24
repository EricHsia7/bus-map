const fs = require('node:fs');
const path = require('node:path');
const config = require('./config.json');
const { areaToTiles, tileToBoundingbox } = require('./coordinate');

async function main() {
  const west = config.bbox.west;
  const south = config.bbox.south;
  const east = config.bbox.east;
  const north = config.bbox.north;
  const baseZ = config.chunks.baseZ;
  const outputDir = config.chunks.dir;
  const inputPath = config.data;
  const tiles = areaToTiles(west, south, east, north, baseZ);
  const commands = [];
  for (const [x, y] of tiles) {
    const boundingBox = tileToBoundingbox(x, y, baseZ).join(',');
    const chunkPath = path.join(outputDir, `${baseZ}_${x}_${y}.osm.pbf`);
    commands.push(`osmium extract -b ${boundingBox} -o ${chunkPath} ${inputPath}`);
  }
  await fs.promises.writeFile(config.chunks.output, commands.join('\n'));
}

main();
