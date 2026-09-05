/**
 * Generate extension icons for Chrome Web Store.
 * Creates simple blue "P" icons at 16, 32, 48, and 128 px.
 *
 * Pure Node.js — no external dependencies.
 * Usage: node generate-icons.js
 */

const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const SIZES = [16, 32, 48, 128]
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'icons')

// ── PNG encoder (minimal, spec-compliant) ────────────────────────────

function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([len, typeAndData, crc])
}

function encodePNG(width, height, rgba) {
  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // IDAT — raw pixel data with filter byte 0 per row
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0 // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const deflated = zlib.deflateSync(raw)

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', deflated),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Pixel drawing ────────────────────────────────────────────────────

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)

  // Background: rounded-rect blue (#3b82f6 → #2563eb gradient)
  const radius = Math.max(2, Math.round(size * 0.18))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // Rounded rect check
      let inside = true
      const corners = [
        [radius, radius],
        [size - radius - 1, radius],
        [radius, size - radius - 1],
        [size - radius - 1, size - radius - 1],
      ]
      if (x < radius && y < radius) {
        inside = Math.hypot(x - radius, y - radius) <= radius
      } else if (x > size - radius - 1 && y < radius) {
        inside = Math.hypot(x - (size - radius - 1), y - radius) <= radius
      } else if (x < radius && y > size - radius - 1) {
        inside = Math.hypot(x - radius, y - (size - radius - 1)) <= radius
      } else if (x > size - radius - 1 && y > size - radius - 1) {
        inside = Math.hypot(x - (size - radius - 1), y - (size - radius - 1)) <= radius
      }
      if (inside) {
        const t = y / (size - 1)
        px[i + 0] = Math.round(59 + (37 - 59) * t)   // R
        px[i + 1] = Math.round(130 + (99 - 130) * t)  // G
        px[i + 2] = Math.round(246 + (235 - 246) * t)  // B
        px[i + 3] = 255                                 // A
      } else {
        px[i + 3] = 0 // transparent outside
      }
    }
  }

  // Draw "P" letter — white
  const s = size
  const padX = Math.round(s * 0.25)
  const padTop = Math.round(s * 0.18)
  const padBot = Math.round(s * 0.18)
  const strokeW = Math.max(1, Math.round(s * 0.12))
  const bowlRight = Math.round(s * 0.68)
  const bowlBottom = Math.round(s * 0.52)

  for (let y = padTop; y < s - padBot; y++) {
    for (let x = padX; x < s - padX; x++) {
      const i = (y * s + x) * 4
      let paint = false

      // Vertical stem
      if (x >= padX && x < padX + strokeW) {
        paint = true
      }
      // Top horizontal bar
      if (y >= padTop && y < padTop + strokeW && x >= padX && x <= bowlRight) {
        paint = true
      }
      // Right side of bowl
      if (x >= bowlRight - strokeW && x <= bowlRight && y >= padTop && y <= bowlBottom) {
        paint = true
      }
      // Bottom of bowl
      if (y >= bowlBottom - strokeW && y < bowlBottom && x >= padX && x <= bowlRight) {
        paint = true
      }

      if (paint) {
        px[i + 0] = 255
        px[i + 1] = 255
        px[i + 2] = 255
        px[i + 3] = 255
      }
    }
  }

  return px
}

// ── Main ─────────────────────────────────────────────────────────────

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

for (const size of SIZES) {
  const pixels = drawIcon(size)
  const png = encodePNG(size, size, pixels)
  const filePath = path.join(OUT_DIR, `icon${size}.png`)
  fs.writeFileSync(filePath, png)
  console.log(`  ${filePath} (${png.length} bytes)`)
}

console.log('Done.')
