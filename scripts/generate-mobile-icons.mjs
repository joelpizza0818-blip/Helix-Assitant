import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const svg = `<svg width="512" height="512" viewBox="0 0 32 36" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="36" fill="#101010"/>
  <defs>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="1.2" flood-color="#ee6018" flood-opacity="0.6"/>
    </filter>
  </defs>
  <g filter="url(#glow)">
    <!-- Pillar 1: Left outer -->
    <rect x="2" y="10" width="4" height="4" fill="#ffd166"/>
    <rect x="2" y="14" width="4" height="4" fill="#ffb703"/>
    <rect x="2" y="18" width="4" height="4" fill="#ff9f1c"/>
    <rect x="2" y="22" width="4" height="4" fill="#ff6b2b"/>
    <rect x="2" y="26" width="4" height="4" fill="#ee6018"/>
    <!-- Pillar 2: Center-left (tall) -->
    <rect x="9" y="2" width="4" height="4" fill="#fff3b0"/>
    <rect x="9" y="6" width="4" height="4" fill="#ffd166"/>
    <rect x="9" y="10" width="4" height="4" fill="#ffb703"/>
    <rect x="9" y="14" width="4" height="4" fill="#ff9f1c"/>
    <!-- Bridge -->
    <rect x="13" y="14" width="6" height="4" fill="#ffd166"/>
    <rect x="13" y="18" width="6" height="4" fill="#ffb703"/>
    <!-- Lower portion -->
    <rect x="9" y="18" width="4" height="4" fill="#ff7a29"/>
    <rect x="9" y="22" width="4" height="4" fill="#ff5500"/>
    <rect x="9" y="26" width="4" height="4" fill="#ee6018"/>
    <rect x="9" y="30" width="4" height="4" fill="#cc4400"/>
    <!-- Pillar 3: Center-right (tall) -->
    <rect x="19" y="2" width="4" height="4" fill="#fff3b0"/>
    <rect x="19" y="6" width="4" height="4" fill="#ffd166"/>
    <rect x="19" y="10" width="4" height="4" fill="#ffb703"/>
    <rect x="19" y="14" width="4" height="4" fill="#ff9f1c"/>
    <rect x="19" y="18" width="4" height="4" fill="#ff7a29"/>
    <rect x="19" y="22" width="4" height="4" fill="#ff5500"/>
    <rect x="19" y="26" width="4" height="4" fill="#ee6018"/>
    <rect x="19" y="30" width="4" height="4" fill="#cc4400"/>
    <!-- Pillar 4: Right outer -->
    <rect x="26" y="10" width="4" height="4" fill="#ffd166"/>
    <rect x="26" y="14" width="4" height="4" fill="#ffb703"/>
    <rect x="26" y="18" width="4" height="4" fill="#ff9f1c"/>
    <rect x="26" y="22" width="4" height="4" fill="#ff6b2b"/>
    <rect x="26" y="26" width="4" height="4" fill="#ee6018"/>
    <!-- Specular glints -->
    <rect x="9" y="2" width="2" height="2" fill="#ffffff"/>
    <rect x="19" y="2" width="2" height="2" fill="#ffffff"/>
    <rect x="15" y="14" width="2" height="2" fill="#ffffff" opacity="0.9"/>
  </g>
</svg>`;

const svgBuffer = Buffer.from(svg);

async function generate() {
  // Android launcher icon sizes
  const androidMap = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
  };

  const resDir = path.join(ROOT, 'movil', 'android', 'app', 'src', 'main', 'res');
  for (const [folder, size] of Object.entries(androidMap)) {
    const dest = path.join(resDir, folder, 'ic_launcher.png');
    if (fs.existsSync(path.dirname(dest))) {
      await sharp(svgBuffer, { density: 300 })
        .resize(size, size, { fit: 'contain', background: { r: 16, g: 16, b: 16, alpha: 1 } })
        .png()
        .toFile(dest);
      console.log(`Generated: ${dest} (${size}x${size})`);
    }
  }

  // iOS App Icons
  const iosSizes = [
    { name: 'Icon-App-20x20@1x.png', size: 20 },
    { name: 'Icon-App-20x20@2x.png', size: 40 },
    { name: 'Icon-App-20x20@3x.png', size: 60 },
    { name: 'Icon-App-29x29@1x.png', size: 29 },
    { name: 'Icon-App-29x29@2x.png', size: 58 },
    { name: 'Icon-App-29x29@3x.png', size: 87 },
    { name: 'Icon-App-40x40@1x.png', size: 40 },
    { name: 'Icon-App-40x40@2x.png', size: 80 },
    { name: 'Icon-App-40x40@3x.png', size: 120 },
    { name: 'Icon-App-60x60@2x.png', size: 120 },
    { name: 'Icon-App-60x60@3x.png', size: 180 },
    { name: 'Icon-App-76x76@1x.png', size: 76 },
    { name: 'Icon-App-76x76@2x.png', size: 152 },
    { name: 'Icon-App-83.5x83.5@2x.png', size: 167 },
    { name: 'Icon-App-1024x1024@1x.png', size: 1024 },
  ];

  const iosDir = path.join(ROOT, 'movil', 'ios', 'Runner', 'Assets.xcassets', 'AppIcon.appiconset');
  if (fs.existsSync(iosDir)) {
    for (const item of iosSizes) {
      const dest = path.join(iosDir, item.name);
      await sharp(svgBuffer, { density: 300 })
        .resize(item.size, item.size, { fit: 'contain', background: { r: 16, g: 16, b: 16, alpha: 1 } })
        .png()
        .toFile(dest);
      console.log(`Generated iOS: ${dest} (${item.size}x${item.size})`);
    }
  }
}

generate().catch(console.error);
