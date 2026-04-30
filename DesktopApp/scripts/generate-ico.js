/**
 * generate-ico.js
 * Generates a proper multi-size .ico file from icon.png using only Node.js built-ins.
 * Sizes included: 16, 32, 48, 256
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SIZES = [16, 32, 48, 256];
const SRC_PNG = path.join(__dirname, '../assets/icons/icon.png');
const OUT_ICO = path.join(__dirname, '../assets/icons/icon.ico');
const TMP_DIR = path.join(__dirname, '../assets/icons/_tmp_ico');

// ── 1. Create temp dir ────────────────────────────────────────────────────────
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── 2. Resize PNGs using sips (built-in on macOS) ────────────────────────────
const pngPaths = [];
for (const size of SIZES) {
  const out = path.join(TMP_DIR, `icon_${size}.png`);
  execSync(`sips -z ${size} ${size} "${SRC_PNG}" --out "${out}"`, { stdio: 'pipe' });
  pngPaths.push(out);
  console.log(`  resized ${size}x${size}`);
}

// ── 3. Read PNG buffers ───────────────────────────────────────────────────────
const pngBuffers = pngPaths.map(p => fs.readFileSync(p));

// ── 4. Build ICO binary ───────────────────────────────────────────────────────
// ICO format:
//   Header  : 6 bytes  (reserved=0, type=1, count=N)
//   Entries : N * 16 bytes each
//   Image data: concatenated PNG blobs (Vista+ ICO supports embedded PNGs)

const count = SIZES.length;
const headerSize = 6;
const dirEntrySize = 16;
const dirSize = count * dirEntrySize;

// Calculate offsets for each image
const offsets = [];
let offset = headerSize + dirSize;
for (const buf of pngBuffers) {
  offsets.push(offset);
  offset += buf.length;
}

const totalSize = offset;
const ico = Buffer.alloc(totalSize);
let pos = 0;

// Header
ico.writeUInt16LE(0, pos);      // reserved
pos += 2;
ico.writeUInt16LE(1, pos);      // type: 1 = ICO
pos += 2;
ico.writeUInt16LE(count, pos);  // number of images
pos += 2;

// Directory entries
for (let i = 0; i < count; i++) {
  const size = SIZES[i];
  const buf = pngBuffers[i];

  // Width/height: 0 means 256 in ICO spec
  ico.writeUInt8(size === 256 ? 0 : size, pos);     // width
  pos += 1;
  ico.writeUInt8(size === 256 ? 0 : size, pos);     // height
  pos += 1;
  ico.writeUInt8(0, pos);   // color count (0 = no palette)
  pos += 1;
  ico.writeUInt8(0, pos);   // reserved
  pos += 1;
  ico.writeUInt16LE(1, pos); // color planes
  pos += 2;
  ico.writeUInt16LE(32, pos); // bits per pixel
  pos += 2;
  ico.writeUInt32LE(buf.length, pos); // size of image data
  pos += 4;
  ico.writeUInt32LE(offsets[i], pos); // offset of image data
  pos += 4;
}

// Image data
for (const buf of pngBuffers) {
  buf.copy(ico, pos);
  pos += buf.length;
}

// ── 5. Write ICO ──────────────────────────────────────────────────────────────
fs.writeFileSync(OUT_ICO, ico);
console.log(`\n✓ Written: ${OUT_ICO} (${(ico.length / 1024).toFixed(1)} KB)`);

// ── 6. Cleanup ────────────────────────────────────────────────────────────────
for (const p of pngPaths) fs.unlinkSync(p);
fs.rmdirSync(TMP_DIR);
console.log('✓ Temp files cleaned up');
