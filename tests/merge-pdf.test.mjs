import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { makePageEntries, movePageEntries, mergePdfPages } from "../src/scripts/merge-pdf-core.js";

// Synthetic documents stay in memory. No fixture files or browser uploads.
async function source(id, labels) {
  const pdf = await PDFDocument.create();
  labels.forEach((label, index) => {
    const page = pdf.addPage([240 + index * 20, 320 + index * 10]);
    page.drawText(label, { x: 20, y: 40, size: 12 });
    if (index === 1) page.setRotation(degrees(90));
  });
  return { id, bytes: await pdf.save() };
}

async function readLabels(bytes) {
  const task = getDocument({
    data: bytes.slice(),
    standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)),
    isEvalSupported: false,
  });
  try {
    const pdf = await task.promise;
    const labels = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      labels.push((await page.getTextContent()).items.map((item) => item.str).join(""));
      // Exercise the preview interpreter on each exported page as well.
      assert.ok((await page.getOperatorList()).fnArray.length > 0);
      page.cleanup();
    }
    return labels;
  } finally { await task.destroy(); }
}

test("adding pages creates independent copies and preserves source order", () => {
  let next = 0;
  const first = makePageEntries("a", [0, 1, 2], () => String(next++));
  const duplicate = makePageEntries("a", [0], () => String(next++));
  assert.deepEqual(first.map((page) => page.pageIndex), [0, 1, 2]);
  assert.equal(new Set([...first, ...duplicate].map((page) => page.id)).size, 4);
});

test("moving one or several output pages preserves their order and supports append", () => {
  const pages = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  assert.deepEqual(movePageEntries(pages, ["d"], "b").map((page) => page.id), ["a", "d", "b", "c", "e"]);
  assert.deepEqual(movePageEntries(pages, ["b", "d"], "a").map((page) => page.id), ["b", "d", "a", "c", "e"]);
  assert.deepEqual(movePageEntries(pages, ["a"], null).map((page) => page.id), ["b", "c", "d", "e", "a"]);
  assert.deepEqual(pages.map((page) => page.id), ["a", "b", "c", "d", "e"]);
  assert.equal(movePageEntries(pages, ["b"], "b"), pages);
});

test("export interleaves documents, repeats pages, and preserves size and rotation", async () => {
  const a = await source("a", ["A1", "A2"]);
  const b = await source("b", ["B1", "B2"]);
  const original = a.bytes.slice();
  const pages = [
    ...makePageEntries("b", [1]), ...makePageEntries("a", [0, 1]),
    ...makePageEntries("b", [0]), ...makePageEntries("a", [0]),
  ];
  const progress = [];
  const bytes = await mergePdfPages([a, b], pages, (page, total) => progress.push([page, total]));
  assert.deepEqual(await readLabels(bytes), ["B2", "A1", "A2", "B1", "A1"]);
  const output = await PDFDocument.load(bytes);
  assert.equal(output.getPageCount(), 5);
  assert.deepEqual(output.getPages().map((page) => page.getRotation().angle), [90, 0, 90, 0, 0]);
  assert.deepEqual(output.getPage(0).getSize(), { width: 260, height: 330 });
  assert.deepEqual(progress, [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
  assert.deepEqual(a.bytes, original, "Source bytes must remain usable after export");
});

test("removing an output copy does not remove its source or other copies", async () => {
  const a = await source("a", ["A1", "A2"]);
  const copies = [...makePageEntries("a", [0, 1]), ...makePageEntries("a", [0])];
  const remaining = copies.filter((page) => page.id !== copies[0].id);
  assert.deepEqual(await readLabels(await mergePdfPages([a], remaining)), ["A2", "A1"]);
  assert.equal((await PDFDocument.load(a.bytes)).getPageCount(), 2);
});

test("one selected page can be exported without a second PDF", async () => {
  const a = await source("a", ["Only page"]);
  assert.deepEqual(await readLabels(await mergePdfPages([a], makePageEntries("a", [0]))), ["Only page"]);
});

test("PDF.js renders a numbered source page to an in-memory thumbnail", async () => {
  const a = await source("a", ["Preview page"]);
  const task = getDocument({
    data: a.bytes.slice(),
    standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)),
    isEvalSupported: false,
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const factory = pdf.canvasFactory;
    const target = factory.create(viewport.width, viewport.height);
    try {
      await page.render({ canvasContext: target.context, canvas: target.canvas, viewport }).promise;
      const pixels = target.context.getImageData(0, 0, target.canvas.width, target.canvas.height).data;
      let darkPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 100 && pixels[index + 3] > 200) darkPixels++;
      }
      assert.ok(darkPixels > 20, "The preview must contain the source page text");
    } finally { factory.destroy(target); }
  } finally { await task.destroy(); }
});

test("empty output, missing sources, invalid indices, and corrupt PDFs fail clearly", async () => {
  const a = await source("a", ["A1"]);
  await assert.rejects(mergePdfPages([a], []), /Add at least one page/);
  await assert.rejects(mergePdfPages([], makePageEntries("a", [0])), /source document is missing/);
  for (const index of [-1, 1, 0.5]) {
    await assert.rejects(mergePdfPages([a], makePageEntries("a", [index])), /outside its source/);
  }
  await assert.rejects(mergePdfPages([{ id: "bad", bytes: new Uint8Array([1, 2, 3]) }], makePageEntries("bad", [0])));
});
