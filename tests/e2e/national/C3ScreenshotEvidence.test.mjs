import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { deflateSync } from "node:zlib";
import { validateScreenshotPng } from "../../../scripts/national-qa/png-evidence.mjs";

const signature = Buffer.from("89504e470d0a1a0a", "hex");
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([len, name, data, crc]);
}
function realPng({ width = 320, height = 240, filter = 0 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let n = 0x12345678;
  for (let row = 0; row < height; row++) {
    const offset = row * (width * 4 + 1);
    raw[offset] = filter;
    for (let x = 1; x <= width * 4; x++) {
      n ^= n << 13;
      n ^= n >>> 17;
      n ^= n << 5;
      raw[offset + x] = n & 255;
    }
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("E5 actual PNG validation rejects forged acceptance evidence", () => {
  const valid = realPng();
  it("accepts complete decoded Chrome-compatible scanlines and a real hash", () => {
    const evidence = validateScreenshotPng(valid);
    assert.equal(evidence?.width, 320);
    assert.equal(evidence?.height, 240);
    assert.equal(
      evidence?.sha256,
      createHash("sha256").update(valid).digest("hex"),
    );
    assert.ok(evidence.bytes > 1000);
  });
  it("rejects PNG header/footer only, even when dimensions are plausible", () => {
    const fake = Buffer.alloc(1600);
    signature.copy(fake);
    fake.writeUInt32BE(320, 16);
    fake.writeUInt32BE(240, 20);
    Buffer.from("0000000049454e44ae426082", "hex").copy(fake, fake.length - 12);
    assert.equal(validateScreenshotPng(fake), null);
  });
  it("rejects corrupted IDAT bytes and CRC", () => {
    const fake = Buffer.from(valid);
    fake[70] ^= 0x04;
    assert.equal(validateScreenshotPng(fake), null);
  });
  it("rejects truncated PNGs and trailing junk", () => {
    assert.equal(
      validateScreenshotPng(valid.subarray(0, valid.length - 6)),
      null,
    );
    assert.equal(
      validateScreenshotPng(Buffer.concat([valid, Buffer.alloc(12)])),
      null,
    );
  });
  it("rejects actual decoded invalid scanline filter despite valid CRC", () => {
    assert.equal(validateScreenshotPng(realPng({ filter: 7 })), null);
  });
  it("rejects sub-minimum dimensions", () => {
    assert.equal(validateScreenshotPng(realPng({ width: 300 })), null);
  });
});
