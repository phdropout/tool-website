import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import UPNG from "@pdf-lib/upng";
import { readImageMetadata } from "../src/scripts/image-metadata.js";

function chunk(type, data) {
  const nameAndData = Buffer.concat([Buffer.from(type), Buffer.from(data)]);
  let crc = 0xffffffff;
  for (const value of nameAndData) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  nameAndData.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function png(extraChunks = []) {
  const bytes = Buffer.from((UPNG.default || UPNG).encode([new Uint8Array([20, 130, 110, 255]).buffer], 1, 1, 0));
  return Buffer.concat([bytes.subarray(0, 33), ...extraChunks, bytes.subarray(33)]);
}

function cameraExif() {
  const name = Buffer.from("Test Camera\0");
  const tiff = Buffer.alloc(26 + name.length);
  tiff.write("II");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x010f, 10); // Camera Make, ASCII string.
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(name.length, 14);
  tiff.writeUInt32LE(26, 18);
  name.copy(tiff, 26);
  return tiff;
}

test("reads known EXIF and text from a File without FileReader", async () => {
  const bytes = png([chunk("eXIf", cameraExif()), chunk("tEXt", Buffer.from("Author\0Synthetic Author"))]);
  const tags = await readImageMetadata(new File([bytes], "synthetic.png", { type: "image/png" }));
  assert.equal(tags.exif.Make.description, "Test Camera");
  assert.equal(tags.pngText.Author.description, "Synthetic Author");
});

test("asynchronous parsing includes compressed PNG text", async () => {
  const text = Buffer.concat([Buffer.from("Description\0"), Buffer.from([0]), deflateSync("Known compressed metadata")]);
  const tags = await readImageMetadata(new File([png([chunk("zTXt", text)])], "compressed.png"));
  assert.equal(tags.pngText.Description.description, "Known compressed metadata");
});

test("an image without EXIF remains readable and does not invent camera fields", async () => {
  const tags = await readImageMetadata(new File([png()], "plain.png"));
  assert.equal(tags.exif, undefined);
  assert.equal(tags.file.FileType.description, "PNG");
});

test("file-read failures propagate so the UI can distinguish errors from absent metadata", async () => {
  await assert.rejects(readImageMetadata({ async arrayBuffer() { throw new Error("Read failed"); } }), /Read failed/);
});
