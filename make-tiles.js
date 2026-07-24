const fs = require('node:fs');
const path = require('node:path');
const config = require('./config.json');
const { Decompress } = require('fflate');

async function renderChunk(x, y, z) {
  const chunkPath = path.join(config.chunks.dir, `${z}_${x}_${y}.osm.pbf`);
  const input = fs.createReadStream(chunkPath);
  const inflater = new Decompress();
  inflater.ondata = (chunk, final) => {
    console.log(Buffer.from(chunk));
    if (final) {
      console.log('end');
    }
  };

  input.on('data', (chunk) => {
    inflater.push(chunk);
  });

  input.on('end', () => {
    inflater.push(new Uint8Array(0), true);
  });
}

renderChunk(6863, 3502, 13);
