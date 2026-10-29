import { PDFDocument } from "pdf-lib";

export function makePageEntries(documentId, pageIndices, makeId = () => crypto.randomUUID()) {
  return pageIndices.map((pageIndex) => ({ id: makeId(), documentId, pageIndex }));
}

// A destination names the page to insert before; null appends at the end.
export function movePageEntries(pages, ids, beforeId = null) {
  const selected = new Set(ids);
  if (selected.has(beforeId)) return pages;
  const moved = pages.filter((page) => selected.has(page.id));
  const remaining = pages.filter((page) => !selected.has(page.id));
  const index = beforeId === null ? remaining.length : remaining.findIndex((page) => page.id === beforeId);
  if (index < 0) return pages;
  return [...remaining.slice(0, index), ...moved, ...remaining.slice(index)];
}

export async function mergePdfPages(documents, pages, onProgress = () => {}) {
  if (!pages.length) throw new Error("Add at least one page to your merged PDF.");
  const sources = new Map(documents.map((document) => [document.id, document]));
  const loaded = new Map();
  const output = await PDFDocument.create();
  output.setCreator("Tool Website — Merge PDF");
  for (let index = 0; index < pages.length; index++) {
    const entry = pages[index];
    const source = sources.get(entry.documentId);
    if (!source) throw new Error("A source document is missing. Add it again before merging.");
    if (!loaded.has(source.id)) loaded.set(source.id, await PDFDocument.load(source.bytes));
    const pdf = loaded.get(source.id);
    if (!Number.isInteger(entry.pageIndex) || entry.pageIndex < 0 || entry.pageIndex >= pdf.getPageCount()) {
      throw new Error("A selected page is outside its source document.");
    }
    const [copied] = await output.copyPages(pdf, [entry.pageIndex]);
    output.addPage(copied);
    onProgress(index + 1, pages.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return output.save();
}
