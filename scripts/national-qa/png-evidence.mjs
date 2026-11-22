/**
 * E5 screenshot custody. Validate actual Chrome PNG bytes, not filenames,
 * magic headers or self-reported screenshot events.
 * No image pixels, private user data or raw CDP traffic are logged.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Returns null for corrupt, truncated, forged or unbounded screenshot bytes. */
export function validateScreenshotPng(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 1000 ||
    bytes.length > 32 * 1024 * 1024 ||
    !bytes.subarray(0, 8).equals(SIGNATURE)
  )
    return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = 0;
  let sawIhdr = false;
  let sawIend = false;
  let sawIdat = false;
  let closedIdat = false;
  const compressed = [];
  let compressedLength = 0;
  let chunks = 0;
  while (offset + 12 <= bytes.length && chunks++ < 8192) {
    const length = bytes.readUInt32BE(offset);
    if (length > 32 * 1024 * 1024 || offset + 12 + length > bytes.length)
      return null;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + 8 + length;
    const actualCrc = bytes.readUInt32BE(end);
    if (crc32(bytes.subarray(offset + 4, end)) !== actualCrc) return null;
    if (!sawIhdr && type !== "IHDR") return null;
    if (type === "IHDR") {
      if (sawIhdr || length !== 13) return null;
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      bitDepth = bytes[offset + 16];
      colorType = bytes[offset + 17];
      const compression = bytes[offset + 18];
      const filter = bytes[offset + 19];
      const interlace = bytes[offset + 20];
      if (
        width < 320 ||
        height < 240 ||
        width > 8192 ||
        height > 8192 ||
        width * height > 12_000_000 ||
        bitDepth !== 8 ||
        ![2, 6].includes(colorType) ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      )
        return null;
      sawIhdr = true;
    } else if (type === "IDAT") {
      if (closedIdat || length === 0) return null;
      sawIdat = true;
      compressedLength += length;
      if (compressedLength > 32 * 1024 * 1024) return null;
      compressed.push(bytes.subarray(offset + 8, end));
    } else if (type === "IEND") {
      if (!sawIdat || length !== 0 || end + 4 !== bytes.length) return null;
      sawIend = true;
      break;
    } else if (type === "PLTE") {
      if (sawIdat) return null;
    } else if (!/^[a-z]/.test(type) || !/^[A-Za-z]{4}$/.test(type)) {
      // Unknown critical PNG chunks are not usable image evidence.
      return null;
    }
    if (sawIdat && type !== "IDAT") closedIdat = true;
    offset = end + 4;
  }
  if (!sawIhdr || !sawIdat || !sawIend) return null;
  const stride = width * (colorType === 6 ? 4 : 3);
  const expected = (stride + 1) * height;
  try {
    const pixels = inflateSync(Buffer.concat(compressed), {
      maxOutputLength: expected + 1,
    });
    if (pixels.length !== expected) return null;
    for (let row = 0; row < height; row++)
      if (pixels[row * (stride + 1)] > 4) return null;
  } catch {
    return null;
  }
  return {
    width,
    height,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function inspectScreenshotFile(path) {
  try {
    return validateScreenshotPng(readFileSync(path));
  } catch {
    return null;
  }
}
