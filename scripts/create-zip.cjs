const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIST = path.resolve(__dirname, '..', 'extension', 'dist');
const OUT  = path.resolve(__dirname, '..', 'ProctorAI-0.2.0-chrome-web-store.zip');

// Collect all files recursively
function walk(dir, base = dir) {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel  = path.relative(base, full).replace(/\\/g, '/');
    const stat = fs.statSync(full);
    if (stat.isDirectory()) entries.push(...walk(full, base));
    else entries.push({ full, rel, size: stat.size });
  }
  return entries;
}

const files = walk(DIST);

// --- Minimal ZIP builder (deflate) ---
const chunks = [];
const centralDir = [];
let offset = 0;

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; }

for (const file of files) {
  const raw = fs.readFileSync(file.full);
  const deflated = zlib.deflateRawSync(raw);
  const nameBytes = Buffer.from(file.rel, 'utf8');
  const crc = crc32(raw);

  // Local file header
  const local = Buffer.concat([
    u32(0x04034b50),        // signature
    u16(20),                // version needed
    u16(0),                 // flags
    u16(8),                 // compression: deflate
    u16(0), u16(0),        // mod time, date
    u32(crc),
    u32(deflated.length),   // compressed
    u32(raw.length),        // uncompressed
    u16(nameBytes.length),
    u16(0),                 // extra field length
    nameBytes,
    deflated,
  ]);
  chunks.push(local);

  // Central directory entry
  const cd = Buffer.concat([
    u32(0x02014b50),
    u16(20), u16(20),      // version made by, version needed
    u16(0),                 // flags
    u16(8),                 // compression
    u16(0), u16(0),        // mod time, date
    u32(crc),
    u32(deflated.length),
    u32(raw.length),
    u16(nameBytes.length),
    u16(0),                 // extra
    u16(0),                 // comment
    u16(0),                 // disk number
    u16(0),                 // internal attrs
    u32(0),                 // external attrs
    u32(offset),            // offset
    nameBytes,
  ]);
  centralDir.push(cd);
  offset += local.length;
}

const cdOffset = offset;
let cdSize = 0;
for (const cd of centralDir) { chunks.push(cd); cdSize += cd.length; }

// End of central directory
const eocd = Buffer.concat([
  u32(0x06054b50),
  u16(0), u16(0),
  u16(files.length), u16(files.length),
  u32(cdSize),
  u32(cdOffset),
  u16(0),
]);
chunks.push(eocd);

fs.writeFileSync(OUT, Buffer.concat(chunks));
const mb = (fs.statSync(OUT).size / 1048576).toFixed(2);
console.log(`ZIP created: ${OUT}`);
console.log(`Size: ${mb} MB (${fs.statSync(OUT).size} bytes)`);
console.log(`Files: ${files.length}`);
for (const f of files) console.log(`  ${f.rel}`);
