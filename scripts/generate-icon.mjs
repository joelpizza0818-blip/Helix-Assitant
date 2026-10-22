/**
 * generate-icon.mjs
 * Generates icon.ico and tray-icon.png for the Electron desktop app
 * using the HELIX SVG logo (pixelated H, orange/gold palette).
 */
import { createRequire } from 'module';
import { writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const pngToIcoMod = require('./node_modules/png-to-ico/index.js');
const pngToIco = pngToIcoMod.default || pngToIcoMod.imagesToIco || pngToIcoMod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── SVG source (matches HelixLogo.tsx, 256×288 px canvas) ───────────────────
const svg = `<svg width="256" height="256" viewBox="0 0 32 36" fill="none" xmlns="http://www.w3.org/2000/svg">
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

const svgBuf = Buffer.from(svg);

async function main() {
  const assetsDir = path.join(ROOT, 'apps', 'desktop', 'assets');

  // Generate sizes needed for .ico: 16, 32, 48, 64, 128, 256
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = await Promise.all(
    sizes.map(s =>
      sharp(svgBuf, { density: 300 })
        .resize(s, s, { fit: 'contain', background: { r: 16, g: 16, b: 16, alpha: 1 } })
        .png()
        .toBuffer()
    )
  );

  // Save 256px PNG for tray icon
  writeFileSync(path.join(assetsDir, 'tray-icon.png'), pngBuffers[5]);
  console.log('[OK] tray-icon.png written (256x256)');

  // Save 32px PNG for tray icon (better for system tray)
  const tray32 = await sharp(svgBuf, { density: 300 })
    .resize(32, 32, { fit: 'contain', background: { r: 16, g: 16, b: 16, alpha: 1 } })
    .png()
    .toBuffer();
  writeFileSync(path.join(assetsDir, 'tray-icon.png'), tray32);
  console.log('[OK] tray-icon.png written (32x32)');

  // Build .ico from multiple sizes
  const icoBuffer = await pngToIco(pngBuffers);
  writeFileSync(path.join(assetsDir, 'icon.ico'), icoBuffer);
  console.log('[OK] icon.ico written (multi-size: 16/32/48/64/128/256)');
}

main().catch(err => {
  console.error('[ERROR] Error generating icons:', err);
  process.exit(1);
});
