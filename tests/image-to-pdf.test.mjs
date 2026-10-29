import assert from "node:assert/strict";
import test from "node:test";
import UPNG from "@pdf-lib/upng";
import { PDFDocument, PDFName, decodePDFRawStream } from "pdf-lib";
import { createImagePdf, getPageLayout } from "../src/scripts/image-to-pdf-core.js";

function fixture(width, height, rotation = 0) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 230;
    pixels[i + 1] = 90;
    pixels[i + 3] = 255;
  }
  return { bytes: new Uint8Array((UPNG.default || UPNG).encode([pixels.buffer], width, height, 0)), type: "image/png", rotation };
}

test("A4 and Letter layouts fit images inside margins without distortion", () => {
  for (const size of ["a4", "letter"]) {
    for (const orientation of ["auto", "portrait", "landscape"]) {
      for (const rotation of [0, 90, 180, 270]) {
        const layout = getPageLayout(1200, 800, rotation, { size, orientation, margin: 36 });
        assert.ok(layout.x >= 36 - 1e-8);
        assert.ok(layout.y >= 36 - 1e-8);
        assert.ok(layout.x + layout.boundingWidth <= layout.pageWidth - 36 + 1e-8);
        assert.ok(layout.y + layout.boundingHeight <= layout.pageHeight - 36 + 1e-8);
        assert.ok(Math.abs(layout.width / layout.height - 1.5) < 1e-8);
      }
    }
  }
});

test("auto orientation follows the image after rotation", () => {
  const landscape = getPageLayout(1200, 800, 0);
  const portrait = getPageLayout(1200, 800, 90);
  assert.ok(landscape.pageWidth > landscape.pageHeight);
  assert.ok(portrait.pageHeight > portrait.pageWidth);
});

test("image-sized pages follow dimensions at 96 dpi, with optional margins", () => {
  assert.equal(getPageLayout(1200, 800, 0, { size: "image", margin: 0 }).pageWidth, 900);
  const rotated = getPageLayout(1200, 800, 90, { size: "image", margin: 18 });
  assert.equal(rotated.pageWidth, 636);
  assert.equal(rotated.pageHeight, 936);
});

test("export produces a readable PDF with one page per image in supplied order", async () => {
  const progress = [];
  const bytes = await createImagePdf([fixture(4, 2), fixture(2, 6)], { size: "image", margin: 0 }, (...args) => progress.push(args));
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.deepEqual(pdf.getPages().map((page) => [page.getWidth(), page.getHeight()]), [[3, 1.5], [1.5, 4.5]]);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
});

test("all clockwise rotations keep the exported image inside the page", async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const pdf = await PDFDocument.load(await createImagePdf([fixture(4, 2, rotation)], { size: "image", margin: 18 }));
    const page = pdf.getPage(0);
    const contents = page.node.lookup(PDFName.of("Contents"));
    const operators = Buffer.from(decodePDFRawStream(pdf.context.lookup(contents.get(0))).decode()).toString();
    const matrices = [...operators.matchAll(/([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) cm/g)].map((match) => match.slice(1).map(Number));
    let matrix = [1, 0, 0, 1, 0, 0];
    for (const [a, b, c, d, e, f] of matrices) {
      const [A, B, C, D, E, F] = matrix;
      matrix = [A*a+C*b, B*a+D*b, A*c+C*d, B*c+D*d, A*e+C*f+E, B*e+D*f+F];
    }
    const [a, b, c, d, e, f] = matrix;
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const px = a*x+c*y+e;
      const py = b*x+d*y+f;
      assert.ok(px >= 18 - 1e-8 && px <= page.getWidth() - 18 + 1e-8, `rotation ${rotation}: x=${px}`);
      assert.ok(py >= 18 - 1e-8 && py <= page.getHeight() - 18 + 1e-8, `rotation ${rotation}: y=${py}`);
    }
  }
});

test("empty and unreadable images fail rather than producing an empty PDF", async () => {
  await assert.rejects(createImagePdf([], {}), /Choose at least one/);
  await assert.rejects(createImagePdf([{ bytes: new Uint8Array([0, 1, 2]), type: "image/png" }], {}));
});
