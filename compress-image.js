const files = require('./files.js');

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const minimist = require('minimist');

async function main() {
  const args = minimist(process.argv.slice(2));

  if (!args.d && !args.dir) {
    console.log('You must provide a directory with images. Use --d or --dir.');
    return;
  }

  const rootDir = args?.o || args?.output || './output';

  const images = await files.getFiles(args?.d || args?.dir, args?.ext);

  const total = images.length;
  let count = 0;
  for (const image of images) {
    // Convert and compress to JPEG
    const convertedJPG = await sharp(image.path.full).withMetadata().jpeg({ quality: args?.q || args?.quality || 85, mozjpeg: true });

    const outputDir = path.join(rootDir, image.ascendant.path.full);

    const ext = path.extname(image.path.full).toLowerCase();
    const baseName = path.basename(image.path.full, ext);
    const outputPath = path.join(outputDir, `${baseName}.jpeg`);

    await files.makeDirectory(outputDir);

    await new Promise((resolve, reject) => {
      convertedJPG.toFile(outputPath, (err, info) => {
        if (err) {
          if (args?.log) {
            console.log('Error saving image:', err);
          }
          resolve(false);
        } else {
          if (args?.log) {
            console.log('Image saved successfully:', JSON.stringify(info));
          }
          count++;

          resolve(true);
        }
      });
    });
    if (args?.log) {
      console.log(`Image converted and compressed to JPEG: ${rootDir}`);
    }
    if (args?.prog) {
      console.log(`Progress: ${count}/${total}`);
    }
  }
}

main();
