const { Resvg } = require('@resvg/resvg-js');
const { Jimp } = require('jimp');
const sharp = require('sharp');

async function rasterize(svgText, outputPath, width, height, scale) {
  const svg = Buffer.from(svgText, 'utf-8');
  const options = {
    fitTo: {
      mode: 'width',
      value: width * scale
    },
    font: {
      loadSystemFonts: false
    }
  };
  const resvg = new Resvg(svg, options);
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  const resizedImage = await Jimp.fromBuffer(pngBuffer);
  resizedImage.resize({ w: width, h: height });
  await sharp(pngBuffer).resize(width, height).webp({ lossless: true }).toFile(`${outputPath}.webp`);
}

module.exports = {
  rasterize
}