/**
 * A tiny, dependency-FREE, deterministic PNG encoder for the `gfx render` JUDGE
 * surface. Encodes an RGB pixel buffer into a valid 8-bit truecolour PNG using
 * hand-rolled CRC32, Adler32, and STORED (uncompressed) zlib deflate blocks.
 *
 * Why hand-rolled + stored blocks (recorded as a `gfx render` encoder choice):
 * the eyes-loop is meant to stay dependency-light (shrinko-free, no npm PNG lib),
 * and `gfx render` output is tiny (~256x256), so compression buys nothing worth a
 * dependency. STORED deflate blocks keep the encoder ~a page of code AND make the
 * output BYTE-DETERMINISTIC (no compressor heuristics), which is exactly what the
 * pixel-byte tests assert against. A standard PNG decoder reads stored blocks
 * identically to compressed ones, so the file is a normal, viewable PNG.
 *
 * This module knows nothing about PICO-8: it takes raw RGB and dimensions. The
 * palette mapping + upscale live in `render.ts`.
 */

/** A raw RGB image: `width * height * 3` bytes, row-major, no padding. */
export interface RgbImage {
  readonly width: number
  readonly height: number
  /** `rgb[(y * width + x) * 3 + {0,1,2}]` = R, G, B (0..255) for pixel (x, y). */
  readonly rgb: Uint8Array
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Encodes an {@link RgbImage} into a complete PNG file (signature + IHDR + IDAT +
 * IEND) as a `Uint8Array`. 8-bit RGB truecolour (colour type 2), no interlace,
 * each scanline prefixed with filter byte 0 (None) so the pixel bytes appear
 * verbatim in the IDAT payload.
 */
export function encodePng(image: RgbImage): Uint8Array {
  const { width, height, rgb } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`PNG dimensions must be positive integers, got ${width}x${height}`)
  }
  if (rgb.length !== width * height * 3) {
    throw new RangeError(
      `RGB buffer length ${rgb.length} does not match ${width}x${height}x3 = ${width * height * 3}`,
    )
  }

  // Raw scanlines: each row is one filter byte (0 = None) then width*3 RGB bytes.
  const stride = width * 3
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1)
    raw[dst] = 0 // filter type None
    raw.set(rgb.subarray(y * stride, y * stride + stride), dst + 1)
  }

  const ihdr = buildIhdr(width, height)
  const idat = zlibStore(raw)

  const chunks = [chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]

  let total = PNG_SIGNATURE.length
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let off = 0
  out.set(PNG_SIGNATURE, off)
  off += PNG_SIGNATURE.length
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/** The 13-byte IHDR data: width, height, bit-depth 8, colour type 2 (RGB), etc. */
function buildIhdr(width: number, height: number): Uint8Array {
  const d = new Uint8Array(13)
  writeUint32(d, 0, width)
  writeUint32(d, 4, height)
  d[8] = 8 // bit depth
  d[9] = 2 // colour type: truecolour RGB
  d[10] = 0 // compression: deflate
  d[11] = 0 // filter: adaptive (only filter 0 used per scanline)
  d[12] = 0 // interlace: none
  return d
}

/** Wraps chunk `data` with its 4-byte length, 4-byte type, and 4-byte CRC32. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ])
  const out = new Uint8Array(4 + 4 + data.length + 4)
  writeUint32(out, 0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  // CRC covers the type + data (not the length).
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, 4)
  writeUint32(out, 8 + data.length, crc32(crcInput))
  return out
}

/**
 * Wraps `data` in a zlib stream (RFC 1950) using DEFLATE STORED blocks (RFC 1951,
 * BTYPE=00): a 2-byte zlib header, one or more stored blocks (each ≤ 65535
 * bytes), and a 4-byte big-endian Adler32 of the uncompressed data.
 */
function zlibStore(data: Uint8Array): Uint8Array {
  const MAX_BLOCK = 0xffff
  const blockCount = Math.max(1, Math.ceil(data.length / MAX_BLOCK))
  // 2 header bytes + per-block (1 BFINAL/BTYPE + 2 LEN + 2 NLEN) + data + 4 adler.
  const out = new Uint8Array(2 + blockCount * 5 + data.length + 4)
  let off = 0

  // zlib header: CMF=0x78 (deflate, 32K window), FLG=0x01 so (CMF*256+FLG)%31==0.
  out[off++] = 0x78
  out[off++] = 0x01

  let pos = 0
  for (let b = 0; b < blockCount; b++) {
    const len = Math.min(MAX_BLOCK, data.length - pos)
    const isFinal = b === blockCount - 1
    out[off++] = isFinal ? 1 : 0 // BFINAL bit, BTYPE=00 (stored)
    // LEN then NLEN, both little-endian.
    out[off++] = len & 0xff
    out[off++] = (len >> 8) & 0xff
    const nlen = ~len & 0xffff
    out[off++] = nlen & 0xff
    out[off++] = (nlen >> 8) & 0xff
    out.set(data.subarray(pos, pos + len), off)
    off += len
    pos += len
  }

  writeUint32(out, off, adler32(data))
  return out
}

function writeUint32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff
  buf[offset + 1] = (value >>> 16) & 0xff
  buf[offset + 2] = (value >>> 8) & 0xff
  buf[offset + 3] = value & 0xff
}

// --- CRC32 (PNG polynomial 0xedb88320) ---

const CRC_TABLE = buildCrcTable()

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ (data[i] ?? 0)) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// --- Adler32 (RFC 1950) ---

function adler32(data: Uint8Array): number {
  const MOD = 65521
  let a = 1
  let b = 0
  for (let i = 0; i < data.length; i++) {
    a = (a + (data[i] ?? 0)) % MOD
    b = (b + a) % MOD
  }
  return ((b << 16) | a) >>> 0
}
