/**
 * Phase 13E — Hackathon Sideload Distribution packager.
 *
 * 1. Copies the CONTENTS of extension/dist into
 *    release/ProctorAI-Hackathon-0.2.0/extension/ (manifest.json directly inside).
 * 2. Validates Chrome "Load unpacked" readiness:
 *    - manifest.json parses and is Manifest V3
 *    - every file referenced by the manifest exists
 *    - no forbidden files (source, node_modules, .env, git, tests, tsbuildinfo)
 * 3. Creates ProctorAI-Hackathon-0.2.0.zip at the project root.
 *    Unlike the Chrome Web Store ZIP, this archive KEEPS the
 *    ProctorAI-Hackathon-0.2.0/ parent folder at the ZIP root.
 *
 * Usage: node scripts/create-hackathon-package.cjs
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'extension', 'dist')
const RELEASE_NAME = 'ProctorAI-Hackathon-0.2.0'
const RELEASE_DIR = path.join(ROOT, 'release', RELEASE_NAME)
const RELEASE_EXT = path.join(RELEASE_DIR, 'extension')
const OUT = path.join(ROOT, `${RELEASE_NAME}.zip`)

// --- helpers ---------------------------------------------------------------

function walk(dir, base = dir) {
  const entries = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = path.relative(base, full).replace(/\\/g, '/')
    const stat = fs.statSync(full)
    if (stat.isDirectory()) entries.push(...walk(full, base))
    else entries.push({ full, rel, size: stat.size })
  }
  return entries
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    if (fs.statSync(s).isDirectory()) copyTree(s, d)
    else fs.copyFileSync(s, d)
  }
}

function rmTree(target) {
  if (!fs.existsSync(target)) return
  for (const name of fs.readdirSync(target)) {
    const full = path.join(target, name)
    if (fs.statSync(full).isDirectory()) rmTree(full)
    else fs.unlinkSync(full)
  }
  fs.rmdirSync(target)
}

// --- CRC32 ------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]
  return (c ^ 0xffffffff) >>> 0
}

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b }
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b }

/** Build a ZIP archive from {name, full} entries (deflate, no dirs). */
function buildZip(entries, outFile) {
  const chunks = []
  const centralDir = []
  let offset = 0

  for (const entry of entries) {
    const raw = fs.readFileSync(entry.full)
    const deflated = zlib.deflateRawSync(raw)
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const crc = crc32(raw)

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(crc), u32(deflated.length), u32(raw.length),
      u16(nameBytes.length), u16(0), nameBytes, deflated,
    ])
    chunks.push(local)

    centralDir.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(crc), u32(deflated.length), u32(raw.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), nameBytes,
    ]))
    offset += local.length
  }

  const cdOffset = offset
  let cdSize = 0
  for (const cd of centralDir) { chunks.push(cd); cdSize += cd.length }

  chunks.push(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(cdSize), u32(cdOffset), u16(0),
  ]))

  fs.writeFileSync(outFile, Buffer.concat(chunks))
}

// --- 1. Copy dist -> release extension/ --------------------------------------

if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('ERROR: extension/dist/manifest.json not found. Run the production build first.')
  process.exit(1)
}

rmTree(RELEASE_EXT)
copyTree(DIST, RELEASE_EXT)
console.log(`Copied extension/dist -> ${path.relative(ROOT, RELEASE_EXT)}`)

// --- 2. Validate load-unpacked readiness -------------------------------------

const manifestPath = path.join(RELEASE_EXT, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

const problems = []
if (manifest.manifest_version !== 3) problems.push('manifest_version is not 3')

const referenced = new Set()
for (const size of Object.values(manifest.icons || {})) referenced.add(size)
if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup)
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker)
for (const cs of manifest.content_scripts || []) {
  for (const js of cs.js || []) referenced.add(js)
}
for (const file of referenced) {
  if (!fs.existsSync(path.join(RELEASE_EXT, file))) {
    problems.push(`manifest references missing file: ${file}`)
  }
}

// HTML pages referenced by the extension also need their JS/CSS assets present.
for (const html of ['popup.html', 'offscreen.html', 'camera-permission.html']) {
  const htmlPath = path.join(RELEASE_EXT, html)
  if (!fs.existsSync(htmlPath)) continue
  const htmlText = fs.readFileSync(htmlPath, 'utf8')
  for (const m of htmlText.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1]
    if (/^https?:/.test(ref)) continue
    if (!fs.existsSync(path.join(RELEASE_EXT, ref))) {
      problems.push(`${html} references missing asset: ${ref}`)
    }
  }
}

// Forbidden file patterns — release must contain build output only.
const forbidden = [
  /(^|\/)node_modules\//,
  /(^|\/)\.env/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)src\//,
  /\.ts$/,
  /\.tsx$/,
  /(^|\/)tests?\//,
  /\.test\.js$/,
  /tsconfig\.tsbuildinfo$/,
  /(^|\/)vite\.config\./,
]
const files = walk(RELEASE_DIR)
for (const f of files) {
  for (const pattern of forbidden) {
    if (pattern.test(f.rel)) { problems.push(`forbidden file in release: ${f.rel}`); break }
  }
}

if (problems.length > 0) {
  console.error('VALIDATION FAILED:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

console.log(`Validated load-unpacked readiness: ${referenced.size} manifest references OK, no forbidden files`)

// --- 3. Build hackathon ZIP (with parent folder at root) ----------------------

const zipEntries = files.map((f) => ({ name: `${RELEASE_NAME}/${f.rel}`, full: f.full }))
buildZip(zipEntries, OUT)

const size = fs.statSync(OUT).size
console.log(`ZIP created: ${OUT}`)
console.log(`Size: ${(size / 1048576).toFixed(2)} MB (${size} bytes)`)
console.log(`Files: ${zipEntries.length}`)
for (const e of zipEntries) console.log(`  ${e.name}`)
