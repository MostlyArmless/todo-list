import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

// Source icons from extracted images
const mainIconSource = '/home/mike/obsidian-notes/File Transfer/main-icon.png';
const voiceIconSource = '/home/mike/obsidian-notes/File Transfer/voice-icon.png';

async function generateIcons() {
  console.log('Generating main app icons from:', mainIconSource);

  // Main app icons - resize with white background for PWA
  await sharp(mainIconSource)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(join(publicDir, 'icon-512.png'));

  await sharp(mainIconSource)
    .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(join(publicDir, 'icon-192.png'));

  await sharp(mainIconSource)
    .resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(join(publicDir, 'apple-touch-icon.png'));

  await sharp(mainIconSource)
    .resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(join(publicDir, 'favicon-32.png'));

  await sharp(mainIconSource)
    .resize(16, 16, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(join(publicDir, 'favicon-16.png'));

  console.log('Generating voice page icons from:', voiceIconSource);

  const voiceDir = join(publicDir, 'voice');

  await sharp(voiceIconSource)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(join(voiceDir, 'icon-512.png'));

  await sharp(voiceIconSource)
    .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(join(voiceDir, 'icon-192.png'));

  await sharp(voiceIconSource)
    .resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(join(voiceDir, 'apple-touch-icon.png'));

  // Favicon for voice page
  await sharp(voiceIconSource)
    .resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(join(voiceDir, 'favicon.png'));

  console.log('Done! Generated icons:');
  console.log('  Main app: icon-192.png, icon-512.png, apple-touch-icon.png, favicon-32.png, favicon-16.png');
  console.log('  Voice page: voice/icon-192.png, voice/icon-512.png, voice/apple-touch-icon.png, voice/favicon.png');
}

generateIcons().catch(console.error);
