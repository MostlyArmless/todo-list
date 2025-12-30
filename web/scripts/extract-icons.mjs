import sharp from 'sharp';

const sourceImage = '/home/mike/obsidian-notes/MEDIA/1767053935795.jpg';
const outputDir = '/home/mike/obsidian-notes/File Transfer';

// Image is 1408x768, 3x3 grid
// Need to find the actual icon boundaries by examining the image

async function extractIcons() {
  const image = sharp(sourceImage);
  const metadata = await image.metadata();

  console.log(`Image size: ${metadata.width}x${metadata.height}`);

  // The image appears to have padding. Let's analyze the grid.
  // From visual inspection:
  // - Image width: 1408, 3 columns
  // - Image height: 768, 3 rows
  // - There's a light gray background with icons centered

  // Let me estimate the grid cells more precisely
  // Looking at the image, each cell appears to be approximately:
  const totalWidth = metadata.width;
  const totalHeight = metadata.height;

  // Based on visual inspection, the actual icon grid seems to have margins
  // Let's try to find the content area
  // The icons appear to be in a centered area

  // Estimated content area (trimming the outer padding)
  const leftPadding = 320;   // rough estimate of left margin
  const rightPadding = 320;  // rough estimate of right margin
  const topPadding = 64;     // rough estimate of top margin
  const bottomPadding = 64;  // rough estimate of bottom margin

  const contentWidth = totalWidth - leftPadding - rightPadding;
  const contentHeight = totalHeight - topPadding - bottomPadding;

  const cellWidth = contentWidth / 3;
  const cellHeight = contentHeight / 3;

  console.log(`Estimated cell size: ${cellWidth}x${cellHeight}`);

  // Top-middle icon (row 0, col 1)
  const topMiddle = {
    left: Math.round(leftPadding + cellWidth),
    top: Math.round(topPadding),
    width: Math.round(cellWidth),
    height: Math.round(cellHeight)
  };

  // Middle-right icon (row 1, col 2)
  const middleRight = {
    left: Math.round(leftPadding + cellWidth * 2),
    top: Math.round(topPadding + cellHeight),
    width: Math.round(cellWidth),
    height: Math.round(cellHeight)
  };

  console.log('Top-middle extraction:', topMiddle);
  console.log('Middle-right extraction:', middleRight);

  // Extract and save
  await sharp(sourceImage)
    .extract(topMiddle)
    .toFile(`${outputDir}/main-icon-raw.png`);

  await sharp(sourceImage)
    .extract(middleRight)
    .toFile(`${outputDir}/voice-icon-raw.png`);

  console.log('Raw extractions saved. Now trimming whitespace...');

  // Now trim the whitespace from each extracted icon
  await sharp(`${outputDir}/main-icon-raw.png`)
    .trim()
    .toFile(`${outputDir}/main-icon.png`);

  await sharp(`${outputDir}/voice-icon-raw.png`)
    .trim()
    .toFile(`${outputDir}/voice-icon.png`);

  // Get final dimensions
  const mainMeta = await sharp(`${outputDir}/main-icon.png`).metadata();
  const voiceMeta = await sharp(`${outputDir}/voice-icon.png`).metadata();

  console.log(`Main icon final size: ${mainMeta.width}x${mainMeta.height}`);
  console.log(`Voice icon final size: ${voiceMeta.width}x${voiceMeta.height}`);

  console.log('\\nDone! Files saved to:', outputDir);
}

extractIcons().catch(console.error);
