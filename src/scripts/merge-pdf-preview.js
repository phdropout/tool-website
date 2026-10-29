// Keep rendering and document cleanup together so removed PDFs cannot leave
// unfinished renders behind or update a preview that is no longer visible.
export function getPreviewZoom(current, delta) {
  return Math.min(4, Math.max(0.5, current * Math.exp(-Math.min(300, Math.max(-300, delta)) * 0.002)));
}

export async function renderPdfPage(source, pageIndex, canvas, { maxDimension = 340, scale, signal } = {}) {
  signal?.throwIfAborted();
  if (source.disposed) throw new Error("Document removed");
  const page = await source.preview.getPage(pageIndex + 1);
  signal?.throwIfAborted();
  if (source.disposed) throw new Error("Document removed");
  const unscaled = page.getViewport({ scale: 1 });
  // Bound the canvas even when the source PDF has unusually large dimensions.
  const requested = scale ?? maxDimension / Math.max(unscaled.width, unscaled.height);
  const safeScale = Math.min(requested, 4096 / Math.max(unscaled.width, unscaled.height), Math.sqrt(8_000_000 / (unscaled.width * unscaled.height)));
  const viewport = page.getViewport({ scale: safeScale });
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const task = page.render({ canvasContext: canvas.getContext("2d"), canvas, viewport, background: "rgb(255,255,255)" });
  source.renderTasks ??= new Set();
  source.renderTasks.add(task);
  const cancel = () => task.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await task.promise;
    if (source.disposed) throw new Error("Document removed");
    return viewport;
  } finally {
    signal?.removeEventListener("abort", cancel);
    source.renderTasks.delete(task);
    page.cleanup();
  }
}

export async function disposePdfSource(source) {
  // Mark synchronously, before any queued thumbnail can start using the source.
  source.disposed = true;
  for (const task of source.renderTasks ?? []) task.cancel();
  source.urls.forEach((url) => URL.revokeObjectURL(url));
  source.urls.clear();
  source.thumbnails.clear();
  // PDF.js 6 exposes destroy() on PDFDocumentLoadingTask, not PDFDocumentProxy.
  try { await source.preview.loadingTask.destroy(); }
  finally { source.renderTasks?.clear(); }
}
