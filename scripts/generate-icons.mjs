// Regenerates the PNG + Windows ICO icon set from `public/favicon.svg`.
// Run: `npm run icons`

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_SVG = path.join(ROOT, 'public', 'favicon.svg');
const OUT_DIR = path.join(ROOT, 'public', 'icons');
const DESKTOP_RUST_ICO = path.join(ROOT, 'desktop-rust', 'icon.ico');

if (!fs.existsSync(SRC_SVG)) {
  console.error(`FATAL: source SVG missing at ${SRC_SVG}`);
  process.exit(1);
}
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const svgBuffer = fs.readFileSync(SRC_SVG);

async function renderPng(size, purpose) {
  if (purpose === 'maskable') {
    const inner = Math.round(size * 0.7);
    const innerPng = await sharp(svgBuffer).resize(inner, inner).png().toBuffer();
    const gap = Math.round((size - inner) / 2);
    return sharp({
      create: { width: size, height: size, channels: 4, background: '#ffffff' },
    })
      .composite([{ input: innerPng, top: gap, left: gap }])
      .png()
      .toBuffer();
  }
  return sharp(svgBuffer).resize(size, size).png().toBuffer();
}

function packIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon type
  header.writeUInt16LE(frames.length, 4);

  const dirEntries = [];
  let offset = 6 + frames.length * 16;
  for (const { size, buffer } of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...frames.map(f => f.buffer)]);
}

const targets = [
  { name: 'icon-192.png',      size: 192, purpose: 'any' },
  { name: 'icon-512.png',      size: 512, purpose: 'any' },
  { name: 'maskable-192.png',  size: 192, purpose: 'maskable' },
  { name: 'maskable-512.png',  size: 512, purpose: 'maskable' },
  { name: 'apple-touch-180.png', size: 180, purpose: 'any' },
];

let total = 0;
for (const t of targets) {
  const buf = await renderPng(t.size, t.purpose);
  const outPath = path.join(OUT_DIR, t.name);
  fs.writeFileSync(outPath, buf);
  total += buf.length;
  console.log(`  ${t.name.padEnd(24)} ${String(t.size + '×' + t.size).padEnd(9)} ${(buf.length / 1024).toFixed(1)} KB  ${t.purpose}`);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoFrames = [];
for (const size of icoSizes) {
  icoFrames.push({ size, buffer: await renderPng(size, 'any') });
}
const icoBuf = packIco(icoFrames);
const mainIcoPath = path.join(OUT_DIR, 'icon.ico');
fs.writeFileSync(mainIcoPath, icoBuf);
if (fs.existsSync(path.dirname(DESKTOP_RUST_ICO))) {
  fs.writeFileSync(DESKTOP_RUST_ICO, icoBuf);
  const raw64 = await sharp(svgBuffer).resize(64, 64).ensureAlpha().raw().toBuffer();
  fs.writeFileSync(path.join(ROOT, 'desktop-rust', 'src', 'window-icon.rgba'), raw64);
}
total += icoBuf.length;
console.log(`  ${'icon.ico'.padEnd(24)} ${'multi'.padEnd(9)} ${(icoBuf.length / 1024).toFixed(1)} KB  windows (${icoSizes.join(',')})`);
console.log(`\nWrote ${targets.length} PNGs + icon.ico to ${path.relative(ROOT, OUT_DIR)}/ (${(total / 1024).toFixed(1)} KB total)`);
