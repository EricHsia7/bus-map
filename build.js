// const { Worker } = require('node:worker_threads');
const config = require('./config.json');
const { areaToTiles } = require('./coordinate');
const { AsyncPool, WorkerPool } = require('./pool');

async function main() {
  const west = config.bbox.west;
  const south = config.bbox.south;
  const east = config.bbox.east;
  const north = config.bbox.north;
  const baseZ = config.chunks.baseZ;
  const chunkTiles = areaToTiles(west, south, east, north, baseZ);
  const threads = new WorkerPool('./render.js', 4);

  const pool = new AsyncPool(4, async function (tile, index) {
    threads.exec({ tile, baseZ });
  });
  await pool.runSettled(chunkTiles);
}

main();
