const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');

const config = require('./config.json');
const tileSize = config.tiles.size;
const options = {
  shapeRendering: 0,
  textRendering: 0,
  imageRendering: 1,
  dpi: 288,
  fitTo: {
    mode: 'width',
    value: tileSize
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
}

module.exports = {
  rasterize
};
