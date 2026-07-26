const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');

const config = require('./config.json');
const tileSize = config.tiles.size;
const samplingWidth = tileSize * 2;
const options = {
  shapeRendering: 0,
  textRendering: 0,
  imageRendering: 1,
  dpi: 128,
  fitTo: {
    mode: 'width',
    value: samplingWidth
  },
  font: {
    loadSystemFonts: false
  }
};

async function rasterize(svgText, outputPath) {
  const svg = Buffer.from(svgText, 'utf-8');
  const resvg = new Resvg(svg, options);
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  await sharp(pngBuffer).webp({ lossless: true }).toFile(`${outputPath}.webp`);
  // .resize(tileSize, tileSize)
}

module.exports = {
  rasterize
};
