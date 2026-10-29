import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderPdfPage, disposePdfSource, getPreviewZoom } from "../src/scripts/merge-pdf-preview.js";

test("scroll zoom changes smoothly and stays within useful bounds", () => {
  assert.ok(getPreviewZoom(1, -50) > 1);
  assert.ok(getPreviewZoom(1, 50) < 1);
  assert.equal(getPreviewZoom(1, 0), 1);
  assert.equal(getPreviewZoom(4, -300), 4);
  assert.equal(getPreviewZoom(0.5, 300), 0.5);
  assert.ok(Math.abs(getPreviewZoom(getPreviewZoom(1, -50), 50) - 1) < 1e-10);
});

async function createSource() {
  const pdf = await PDFDocument.create();
  pdf.addPage([240, 320]).drawText("Readable page preview", { x: 20, y: 40, size: 12 });
  const task = getDocument({
    data: await pdf.save(),
    standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)),
    isEvalSupported: false,
  });
  return { preview: await task.promise, thumbnails: new Map(), urls: new Set(), renderTasks: new Set() };
}

test("removing a PDF uses its loading task and leaves other PDFs usable", async () => {
  const removed = await createSource();
  const remaining = await createSource();
  const removedTask = removed.preview.loadingTask;
  removed.thumbnails.set(0, Promise.resolve());
  try {
    await disposePdfSource(removed);
    assert.equal(removedTask.destroyed, true);
    assert.equal(removed.disposed, true);
    assert.equal(removed.thumbnails.size, 0);
    const target = remaining.preview.canvasFactory.create(1, 1);
    try {
      await renderPdfPage(remaining, 0, target.canvas);
      assert.equal(Math.max(target.canvas.width, target.canvas.height), 340);
      assert.equal(remaining.renderTasks.size, 0);
    } finally { remaining.preview.canvasFactory.destroy(target); }
    await assert.rejects(renderPdfPage(removed, 0, {}), /Document removed/);
  } finally { await disposePdfSource(remaining); }
});

test("expanded previews render at a sharper resolution than thumbnails", async () => {
  const source = await createSource();
  const target = source.preview.canvasFactory.create(1, 1);
  try {
    await renderPdfPage(source, 0, target.canvas, { maxDimension: 1800 });
    assert.equal(target.canvas.height, 1800);
    const pixels = target.context.getImageData(0, 0, target.canvas.width, target.canvas.height).data;
    let darkPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 3] > 200) darkPixels++;
    assert.ok(darkPixels > 100);
  } finally {
    source.preview.canvasFactory.destroy(target);
    await disposePdfSource(source);
  }
});

test("closing a viewer while its page loads prevents a stale render", async () => {
  const pending = Promise.withResolvers();
  const controller = new AbortController();
  let started = false;
  const source = { preview: { getPage: () => pending.promise } };
  const operation = renderPdfPage(source, 0, {}, { signal: controller.signal });
  controller.abort();
  pending.resolve({ render() { started = true; } });
  await assert.rejects(operation, { name: "AbortError" });
  assert.equal(started, false);
});

test("closing a viewer cancels its render and clears task tracking", async () => {
  const pending = Promise.withResolvers();
  const controller = new AbortController();
  let cancelled = false;
  const source = {
    preview: { getPage: async () => ({
      getViewport: ({ scale }) => ({ width: 240 * scale, height: 320 * scale }),
      render: () => ({ promise: pending.promise, cancel() { cancelled = true; pending.reject(new Error("cancelled")); } }),
      cleanup() {},
    }) },
  };
  const operation = renderPdfPage(source, 0, { getContext: () => ({}) }, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(operation, /cancelled/);
  assert.equal(cancelled, true);
  assert.equal(source.renderTasks.size, 0);
});

test("document removal cancels pending renders before destroying the worker", async () => {
  const sequence = [];
  const source = {
    urls: new Set(), thumbnails: new Map(),
    renderTasks: new Set([{ cancel() { sequence.push("cancel"); } }]),
    preview: { loadingTask: { async destroy() { sequence.push("destroy"); } } },
  };
  await disposePdfSource(source);
  assert.deepEqual(sequence, ["cancel", "destroy"]);
});
