import { PDFDocument } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { makePageEntries, movePageEntries, mergePdfPages } from "./merge-pdf-core.js";
import { renderPdfPage, disposePdfSource, getPreviewZoom } from "./merge-pdf-preview.js";
import { attachPreviewPan } from "./preview-pan.js";

GlobalWorkerOptions.workerSrc = workerUrl;
const root = document.querySelector("[data-merge-pdf]");
if (root) initialize(root);

function initialize(root) {
  const find = (name) => root.querySelector(`[data-${name}]`);
  const documents = [];
  let pages = [];
  let activeId = null;
  let selected = new Set();
  let busy = false;
  let drag = null;
  let dragDepth = 0;
  let downloadUrl = null;
  let thumbnailQueue = Promise.resolve();
  const dialog = find("page-dialog");
  const pagePan = attachPreviewPan(find("page-stage"));
  let expanded = null;
  let expandedVersion = 0;
  let expandedController = null;
  let previewTrigger = null;
  let expandedZoom = 1;
  let zoomTimer = null;
  const sourceList = find("source-pages");
  const outputList = find("output-pages");
  const status = find("status");
  const sourcePanel = sourceList.closest("section");
  const resources = `${import.meta.env.BASE_URL}pdfjs/`;
  const activeDocument = () => documents.find((document) => document.id === activeId);
  const byId = (id) => documents.find((document) => document.id === id);
  const announce = (message) => { status.textContent = message; };
  const showError = (message = "") => { find("error").textContent = message; find("error").hidden = !message; };

  function invalidate() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    find("download").removeAttribute("href");
    find("result").hidden = true;
  }
  function setBusy(value) {
    busy = value;
    root.setAttribute("aria-busy", String(value));
    root.querySelectorAll("button, input").forEach((element) => { element.disabled = value; });
    if (!busy) render();
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, label, handler, className = "mp-icon-button", disabled = false) {
    const node = element("button", className, text);
    node.type = "button";
    node.title = label;
    node.setAttribute("aria-label", label);
    node.disabled = busy || disabled;
    node.addEventListener("click", () => { if (!busy) handler(); });
    return node;
  }

  // Render only thumbnails near the visible viewport, one at a time.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const target = entry.target;
      const document = byId(target.dataset.document);
      if (!document) continue;
      const pageIndex = Number(target.dataset.page);
      if (!document.thumbnails.has(pageIndex)) {
        const promise = thumbnailQueue.then(() => renderThumbnail(document, pageIndex));
        document.thumbnails.set(pageIndex, promise);
        thumbnailQueue = promise.catch(() => {});
      }
      document.thumbnails.get(pageIndex).then((thumbnail) => {
        if (!target.isConnected || !byId(document.id)) return;
        const image = element("img");
        image.src = thumbnail.url;
        image.alt = `${document.name}, page ${pageIndex + 1}`;
        image.draggable = false;
        target.replaceChildren(image);
      }).catch(() => {
        if (target.isConnected) target.textContent = "Preview unavailable";
      });
    }
  }, { rootMargin: "200px" });

  async function renderThumbnail(source, pageIndex) {
    if (!byId(source.id)) throw new Error("Document removed");
    const canvas = document.createElement("canvas");
    try {
      await renderPdfPage(source, pageIndex, canvas);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob || !byId(source.id)) throw new Error("Preview unavailable");
      const url = URL.createObjectURL(blob);
      source.urls.add(url);
      return { url };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  function thumbnail(documentId, pageIndex) {
    const node = element("div", "mp-thumbnail", "Loading preview…");
    node.dataset.document = documentId;
    node.dataset.page = pageIndex;
    observer.observe(node);
    return node;
  }

  function openExpanded(context, id, trigger) {
    expanded = { context, id, documentId: context === "output" ? pages.find((entry) => entry.id === id)?.documentId : activeId };
    previewTrigger = trigger;
    expandedZoom = 1;
    dialog.showModal();
    updateExpanded();
  }
  function expandedEntry() {
    if (!expanded) return null;
    if (expanded.context === "output") {
      const index = pages.findIndex((entry) => entry.id === expanded.id);
      return index < 0 ? null : { ...pages[index], index, total: pages.length };
    }
    const source = byId(expanded.documentId);
    return source ? { documentId: source.id, pageIndex: expanded.id, index: expanded.id, total: source.count } : null;
  }
  function cancelExpandedTasks() {
    expandedController?.abort();
    expandedController = null;
  }
  function clearExpandedStage() {
    find("page-stage").querySelectorAll("canvas").forEach((canvas) => { canvas.width = 0; canvas.height = 0; });
    find("page-stage").replaceChildren();
  }
  function sizeExpandedCanvas(canvas = find("page-stage").querySelector("canvas")) {
    if (!canvas) return;
    const stage = find("page-stage");
    const centerX = (stage.scrollLeft + stage.clientWidth / 2) / Math.max(1, stage.scrollWidth);
    const centerY = (stage.scrollTop + stage.clientHeight / 2) / Math.max(1, stage.scrollHeight);
    const ratio = canvas.width / canvas.height;
    const fitWidth = Math.min(Math.max(1, stage.clientWidth - 64), Math.max(1, stage.clientHeight - 64) * ratio);
    canvas.style.width = `${fitWidth * expandedZoom}px`;
    canvas.style.height = `${fitWidth * expandedZoom / ratio}px`;
    stage.scrollLeft = centerX * stage.scrollWidth - stage.clientWidth / 2;
    stage.scrollTop = centerY * stage.scrollHeight - stage.clientHeight / 2;
    pagePan.refresh();
  }
  async function updateExpanded() {
    const version = ++expandedVersion;
    cancelExpandedTasks();
    const entry = expandedEntry();
    const source = entry && byId(entry.documentId);
    if (!source || source.disposed || !dialog.open) { dialog.close(); return; }
    const label = `${source.name}, source page ${entry.pageIndex + 1}${expanded.context === "output" ? `, output page ${entry.index + 1}` : ""}`;
    dialog.setAttribute("aria-label", label);
    const stage = find("page-stage");
    if (!stage.querySelector("canvas")) find("page-loading").textContent = "Rendering page…";
    stage.setAttribute("aria-busy", "true");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", label);
    const controller = new AbortController();
    expandedController = controller;
    try {
      await renderPdfPage(source, entry.pageIndex, canvas, { maxDimension: 1800 * expandedZoom, signal: controller.signal });
      if (version !== expandedVersion || !dialog.open) return;
      const scroll = { left: stage.scrollLeft, top: stage.scrollTop };
      clearExpandedStage();
      stage.append(canvas);
      sizeExpandedCanvas(canvas);
      stage.scrollLeft = scroll.left;
      stage.scrollTop = scroll.top;
      find("page-loading").textContent = "";
    } catch (reason) {
      if (version === expandedVersion && dialog.open && !controller.signal.aborted && reason.name !== "RenderingCancelledException") {
        find("page-loading").textContent = "This page could not be previewed. Click outside the page or press Escape to close.";
      }
    } finally {
      if (!canvas.isConnected) { canvas.width = 0; canvas.height = 0; }
      if (version === expandedVersion) stage.setAttribute("aria-busy", "false");
    }
  }
  function zoomExpanded(next) {
    expandedZoom = next;
    sizeExpandedCanvas();
    // Resize immediately; sharpen the preview once scrolling settles.
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => { if (dialog.open && expanded) updateExpanded(); }, 150);
  }
  dialog.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
    zoomExpanded(getPreviewZoom(expandedZoom, delta));
  }, { passive: false });
  dialog.addEventListener("keydown", (event) => {
    if (["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault();
      zoomExpanded(event.key === "0" ? 1 : getPreviewZoom(expandedZoom, event.key === "-" ? 100 : -100));
    }
  });
  window.addEventListener("resize", () => { if (dialog.open) sizeExpandedCanvas(); });
  find("page-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    pagePan.reset();
    clearTimeout(zoomTimer);
    expandedVersion++;
    cancelExpandedTasks();
    expanded = null;
    clearExpandedStage();
    if (previewTrigger?.isConnected) previewTrigger.focus();
    previewTrigger = null;
  });
  dialog.addEventListener("click", (event) => {
    if (event.target.tagName !== "CANVAS") dialog.close();
  });
  function expandButton(context, id, label) {
    const control = button("⤢", label, () => openExpanded(context, id, control), "mp-expand-page");
    control.setAttribute("aria-haspopup", "dialog");
    return control;
  }

  root.querySelectorAll("[data-choose]").forEach((node) => node.addEventListener("click", () => find("files").click()));
  find("files").addEventListener("change", () => {
    const files = [...find("files").files];
    find("files").value = "";
    addDocuments(files);
  });
  root.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth++;
    root.classList.add("mp-file-drag");
  });
  root.addEventListener("dragover", (event) => {
    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
  });
  root.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) root.classList.remove("mp-file-drag");
  });
  root.addEventListener("drop", (event) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    dragDepth = 0;
    root.classList.remove("mp-file-drag");
    addDocuments([...event.dataTransfer.files]);
  });

  async function addDocuments(files) {
    if (busy || !files.length) return;
    setBusy(true);
    showError();
    const failures = [];
    let added = 0;
    let firstAddedId = null;
    try {
      for (const [index, file] of files.entries()) {
        announce(`Reading PDF ${index + 1} of ${files.length}…`);
        if (documents.length >= 20) { failures.push("You can add up to 20 PDFs."); break; }
        let loadingTask;
        try {
          if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") throw new Error("Choose a PDF file.");
          if (!file.size || file.size > 25 * 1024 * 1024) throw new Error("Choose a nonempty PDF up to 25 MB.");
          if (documents.reduce((sum, doc) => sum + doc.bytes.length, 0) + file.size > 100 * 1024 * 1024) throw new Error("The PDFs exceed the 100 MB total limit.");
          const bytes = new Uint8Array(await file.arrayBuffer());
          let pdf;
          try { pdf = await PDFDocument.load(bytes); }
          catch (reason) {
            if (/encrypt/i.test(String(reason))) throw new Error("This PDF is password-protected. Add an unlocked copy.");
            throw new Error("This PDF could not be read. It may be damaged or unsupported.");
          }
          const count = pdf.getPageCount();
          if (!count) throw new Error("This PDF has no pages.");
          if (documents.reduce((sum, doc) => sum + doc.count, 0) + count > 300) throw new Error("Choose PDFs with at most 300 source pages in total.");
          loadingTask = getDocument({
            data: bytes.slice(), cMapUrl: `${resources}cmaps/`, cMapPacked: true,
            standardFontDataUrl: `${resources}standard_fonts/`, wasmUrl: `${resources}wasm/`,
            iccUrl: `${resources}iccs/`, isEvalSupported: false,
          });
          loadingTask.onPassword = () => { void loadingTask.destroy(); };
          const preview = await loadingTask.promise;
          if (preview.numPages !== count) throw new Error("The PDF page structure is inconsistent. Try saving a fresh copy.");
          const id = crypto.randomUUID();
          documents.push({ id, name: file.name, bytes, count, preview, thumbnails: new Map(), urls: new Set() });
          firstAddedId ||= id;
          added++;
        } catch (reason) {
          if (loadingTask) await loadingTask.destroy().catch(() => {});
          failures.push(`${file.name}: ${reason.message || "This PDF could not be opened."}`);
        }
      }
      if (firstAddedId) { activeId = firstAddedId; selected.clear(); }
    } finally {
      setBusy(false);
      announce(`${added} ${added === 1 ? "PDF" : "PDFs"} added. Choose pages to build your merged PDF.`);
      showError(failures.slice(0, 3).join(" ") + (failures.length > 3 ? ` ${failures.length - 3} more files could not be added.` : ""));
    }
  }

  function appendSourcePages(indices, beforeId = null) {
    if (busy || !activeDocument() || !indices.length) return;
    if (pages.length + indices.length > 500) { showError("Your merged PDF can contain up to 500 pages."); return; }
    const valid = indices.filter((index) => Number.isInteger(index) && index >= 0 && index < activeDocument().count);
    const entries = makePageEntries(activeId, valid);
    const position = beforeId === null ? pages.length : pages.findIndex((page) => page.id === beforeId);
    if (position < 0) return;
    invalidate();
    showError();
    pages.splice(position, 0, ...entries);
    selected.clear();
    render();
    announce(`${entries.length} ${entries.length === 1 ? "page" : "pages"} added. ${pages.length} pages in your merged PDF.`);
  }
  find("add-all").addEventListener("click", () => { if (activeDocument()) appendSourcePages(Array.from({ length: activeDocument().count }, (_, index) => index)); });
  find("add-selected").addEventListener("click", () => appendSourcePages([...selected].sort((a, b) => a - b)));
  function updateSelection() {
    find("selected-count").textContent = selected.size ? `(${selected.size})` : "";
    find("add-selected").disabled = busy || !selected.size;
  }
  function focusOutput(id, action) {
    const card = [...outputList.children].find((node) => node.dataset.id === id);
    (card?.querySelector(`[data-action="${action}"]:not(:disabled)`)
      || card?.querySelector("button:not(:disabled)") || find("add-all")).focus();
  }
  function reorder(id, direction) {
    const index = pages.findIndex((page) => page.id === id);
    if (index < 0) return;
    const target = direction < 0 ? pages[index - 1]?.id : pages[index + 2]?.id ?? null;
    pages = movePageEntries(pages, [id], target);
    invalidate(); render(); focusOutput(id, direction < 0 ? "earlier" : "later");
    announce("Page order updated.");
  }

  function render() {
    observer.disconnect();
    find("upload").hidden = documents.length > 0;
    find("workspace").hidden = !documents.length;
    renderTabs();
    renderSource();
    renderOutput();
    updateSelection();
    find("merge").disabled = busy || !pages.length;
    find("clear-output").disabled = busy || !pages.length;
    find("output-count").textContent = `${pages.length} ${pages.length === 1 ? "page" : "pages"}`;
    find("export-summary").textContent = pages.length ? `${pages.length} ${pages.length === 1 ? "page" : "pages"} · Exported in the order shown` : "Add pages to create your PDF.";
  }
  function renderTabs() {
    const tabs = find("documents");
    tabs.replaceChildren();
    documents.forEach((source) => {
      const row = element("div", "mp-document-row");
      const tab = button("", source.name, () => {
        activeId = source.id; selected.clear(); render();
        document.getElementById(`mp-tab-${source.id}`)?.focus();
      }, "mp-document-tab");
      tab.id = `mp-tab-${source.id}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(source.id === activeId));
      tab.setAttribute("aria-controls", "mp-source-panel");
      tab.tabIndex = source.id === activeId ? 0 : -1;
      tab.append(element("strong", "", source.name), element("span", "", `${source.count} ${source.count === 1 ? "page" : "pages"}`));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || busy) return;
        event.preventDefault();
        const index = documents.indexOf(source);
        const next = event.key === "Home" ? 0 : event.key === "End" ? documents.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + documents.length) % documents.length;
        activeId = documents[next].id; selected.clear(); render();
        document.getElementById(`mp-tab-${activeId}`)?.focus();
      });
      const remove = button("×", `Remove ${source.name}`, () => removeDocument(source.id), "mp-remove-document");
      // A tablist contains tabs; place the removal control outside its tab role.
      row.setAttribute("role", "presentation");
      row.append(tab, remove);
      tabs.append(row);
    });
  }
  function renderSource() {
    sourceList.replaceChildren();
    sourcePanel.id = "mp-source-panel";
    sourcePanel.setAttribute("role", "tabpanel");
    const source = activeDocument();
    if (!source) return;
    sourcePanel.setAttribute("aria-labelledby", `mp-tab-${source.id}`);
    find("source-name").textContent = source.name;
    find("source-count").textContent = `${source.count} ${source.count === 1 ? "page" : "pages"}`;
    for (let pageIndex = 0; pageIndex < source.count; pageIndex++) {
      const card = element("li", "mp-source-card");
      card.draggable = !busy;
      const label = element("label", "mp-source-label");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(pageIndex);
      checkbox.disabled = busy;
      checkbox.setAttribute("aria-label", `Select page ${pageIndex + 1} of ${source.name}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(pageIndex); else selected.delete(pageIndex);
        card.classList.toggle("mp-selected", checkbox.checked); updateSelection();
      });
      card.classList.toggle("mp-selected", checkbox.checked);
      label.append(checkbox, element("span", "", `Page ${pageIndex + 1}`));
      const preview = element("div", "mp-preview-frame");
      preview.append(thumbnail(source.id, pageIndex), expandButton("source", pageIndex, `Expand source page ${pageIndex + 1}`));
      card.append(label, preview, button("+ Add page", `Add page ${pageIndex + 1}`, () => appendSourcePages([pageIndex]), "mp-add-page"));
      setupDrag(card, () => ({ type: "source", documentId: source.id, indices: selected.has(pageIndex) ? [...selected].sort((a, b) => a - b) : [pageIndex] }));
      sourceList.append(card);
    }
  }
  function renderOutput() {
    outputList.replaceChildren();
    find("empty").hidden = pages.length > 0;
    find("append").hidden = !pages.length;
    pages.forEach((entry, index) => {
      const source = byId(entry.documentId);
      const card = element("li", "mp-output-card");
      card.dataset.id = entry.id;
      card.draggable = !busy;
      const remove = button("×", `Remove output page ${index + 1}`, () => {
        pages = pages.filter((page) => page.id !== entry.id);
        invalidate(); render(); focusOutput(pages[Math.min(index, pages.length - 1)]?.id, "earlier");
        announce(`Page removed. ${pages.length} pages in your merged PDF.`);
      }, "mp-remove-page");
      const caption = element("p", "mp-page-caption", `${source.name} · Page ${entry.pageIndex + 1}`);
      caption.title = caption.textContent;
      const controls = element("div", "mp-page-controls");
      const earlier = button("←", `Move output page ${index + 1} earlier`, () => reorder(entry.id, -1), "mp-icon-button", index === 0);
      earlier.dataset.action = "earlier";
      const later = button("→", `Move output page ${index + 1} later`, () => reorder(entry.id, 1), "mp-icon-button", index === pages.length - 1);
      later.dataset.action = "later";
      controls.append(earlier, later);
      const preview = element("div", "mp-preview-frame");
      preview.append(thumbnail(entry.documentId, entry.pageIndex), expandButton("output", entry.id, `Expand output page ${index + 1}`));
      card.append(element("strong", "mp-page-number", `Page ${index + 1}`), remove, preview, caption, controls);
      setupDrag(card, () => ({ type: "output", ids: [entry.id] }));
      card.addEventListener("dragover", (event) => {
        if (!drag || busy) return;
        event.preventDefault(); event.stopPropagation(); card.classList.add("mp-insert-before");
      });
      card.addEventListener("dragleave", () => card.classList.remove("mp-insert-before"));
      card.addEventListener("drop", (event) => {
        card.classList.remove("mp-insert-before");
        if (!drag || busy || event.dataTransfer.files.length) return;
        event.preventDefault(); event.stopPropagation(); applyDrop(entry.id);
      });
      outputList.append(card);
    });
  }
  function setupDrag(card, payload) {
    card.addEventListener("dragstart", (event) => {
      if (busy || event.target.closest("button, input, label")) { event.preventDefault(); return; }
      drag = payload();
      event.dataTransfer.setData("text/plain", "PDF pages");
      event.dataTransfer.effectAllowed = drag.type === "source" ? "copy" : "move";
      card.classList.add("mp-dragging");
      find("output-area").classList.add("mp-drop-ready");
    });
    card.addEventListener("dragend", clearDrag);
  }
  function clearDrag() {
    drag = null;
    root.querySelectorAll(".mp-dragging, .mp-insert-before, .mp-drop-ready").forEach((node) => node.classList.remove("mp-dragging", "mp-insert-before", "mp-drop-ready"));
  }
  function applyDrop(beforeId) {
    const payload = drag;
    clearDrag();
    if (payload.type === "source" && payload.documentId === activeId) appendSourcePages(payload.indices, beforeId);
    else if (payload.type === "output") {
      pages = movePageEntries(pages, payload.ids, beforeId);
      invalidate(); render(); announce("Page order updated.");
    }
  }
  find("output-area").addEventListener("dragover", (event) => {
    if (drag && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = drag.type === "source" ? "copy" : "move"; }
  });
  find("output-area").addEventListener("drop", (event) => {
    if (!drag || busy || event.dataTransfer.files.length) return;
    event.preventDefault(); event.stopPropagation(); applyDrop(null);
  });

  function dispose(source) {
    if (expanded?.documentId === source.id) dialog.close();
    void disposePdfSource(source).catch((reason) => console.debug("PDF cleanup could not finish.", reason));
  }
  function removeDocument(id) {
    const index = documents.findIndex((source) => source.id === id);
    if (index < 0 || busy) return;
    const [removed] = documents.splice(index, 1);
    dispose(removed);
    pages = pages.filter((page) => page.documentId !== id);
    if (activeId === id) { activeId = documents[Math.min(index, documents.length - 1)]?.id ?? null; selected.clear(); }
    invalidate(); render();
    (document.getElementById(`mp-tab-${activeId}`) || root.querySelector("[data-choose]")).focus();
    announce(`PDF removed. ${pages.length} pages in your merged PDF.`);
  }
  find("clear-output").addEventListener("click", () => {
    if (busy) return;
    pages = []; invalidate(); render(); find("add-all").focus(); announce("Output pages cleared. Your source PDFs are still available.");
  });
  find("reset").addEventListener("click", () => {
    if (busy) return;
    observer.disconnect(); documents.splice(0).forEach(dispose);
    pages = []; activeId = null; selected.clear(); invalidate(); showError(); render();
    root.querySelector("[data-choose]").focus(); announce("Workspace cleared.");
  });
  find("filename").addEventListener("input", invalidate);
  find("merge").addEventListener("click", async () => {
    if (busy || !pages.length) return;
    invalidate(); showError(); setBusy(true);
    try {
      const bytes = await mergePdfPages(documents, pages, (page, total) => announce(`Creating page ${page} of ${total}…`));
      downloadUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const name = find("filename").value.trim().replace(/\.pdf$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "merged-document";
      find("download").href = downloadUrl;
      find("download").download = `${name}.pdf`;
      find("result-details").textContent = `${pages.length} ${pages.length === 1 ? "page" : "pages"} · ${(bytes.length / 1024 / 1024).toFixed(2)} MB`;
      find("result").hidden = false;
      announce("Your merged PDF is ready to download."); find("download").focus();
    } catch (reason) {
      showError(`The merged PDF could not be created. ${reason.message || "Try fewer pages or smaller documents."}`);
      announce("Your pages are still available. Adjust the selection and try again.");
    } finally { setBusy(false); }
  });
  render();
}
