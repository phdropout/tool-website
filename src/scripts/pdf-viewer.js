import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { exportHighlightedPdf, highlightColors, highlightPath, pointerPdfPoint, selectionQuads, zoomFromPercent } from "./pdf-viewer-core.js";
import { sitePath } from "./site-path.js";
import { createThumbnailSidebar, attachViewerFullscreen } from "./pdf-viewer-navigation.js";

GlobalWorkerOptions.workerSrc = workerUrl;
const root = document.querySelector("[data-pdf-viewer]");
if (root) initialize(root);

function initialize(root) {
  const find = (key) => root.querySelector(`[data-${key}]`);
  const sheet = find("sheet"), stage = find("stage"), text = find("text"), brush = find("brush"), svg = find("marks");
  let pdf = null, task = null, bytes = null, name = "document.pdf";
  let pageIndex = 0, zoom = 1, fit = true, viewport = null, mode = "text";
  let marks = [], undo = [], redo = [], stroke = null;
  let generation = 0, renderVersion = 0, renderTask = null, textLayer = null, renderQueue = Promise.resolve();
  let loading = false, rendering = false, exporting = false, downloadUrl = null, dirty = false;
  const status = (message) => { find("status").textContent = message; };
  const error = (message = "") => { find("error").textContent = message; find("error").hidden = !message; };
  const thumbnails = createThumbnailSidebar(find("thumbnails"), (index) => navigate(index));
  const detachFullscreen = attachViewerFullscreen(root, find("fullscreen"), {
    onChange: () => { stopStroke(true); },
    onError: (cause) => { console.error("PDF fullscreen could not be opened:", cause); error("Fullscreen is unavailable. You can continue reading here."); },
  });
  const scale = () => Math.hypot(viewport.transform[0], viewport.transform[1]);
  const selectedRange = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    return text.contains(range.startContainer) && text.contains(range.endContainer) ? range : null;
  };
  function controls() {
    root.setAttribute("aria-busy", String(loading || rendering || exporting));
    find("choose").disabled = loading;
    root.querySelectorAll("[data-workspace] button, [data-workspace] input, [data-workspace] select").forEach((node) => { node.disabled = loading || rendering || exporting || !pdf; });
    // Keep an exit available even while pages or downloads are being prepared.
    find("fullscreen").disabled = !pdf;
    if (loading || rendering || exporting || !pdf) return;
    find("prev").disabled = pageIndex === 0;
    find("next").disabled = pageIndex === pdf.numPages - 1;
    find("undo").disabled = !undo.length;
    find("redo").disabled = !redo.length;
    find("clear").disabled = !marks.some((mark) => mark.page === pageIndex);
    find("apply").disabled = mode !== "text" || !selectedRange();
    find("size").disabled = mode !== "brush";
    find("color").disabled = mode === "read";
    find("zoom-in").disabled = zoom >= 3;
    find("zoom-out").disabled = zoom <= 0.1;
  }
  function draw() {
    svg.replaceChildren();
    if (!viewport) return;
    svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
    for (const mark of [...marks.filter((item) => item.page === pageIndex), ...(stroke ? [stroke.mark] : [])]) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("opacity", "0.35");
      const paths = mark.type === "text" ? mark.quads : [mark.points];
      for (const points of paths) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const screen = points.map(([x, y]) => viewport.convertToViewportPoint(x, y));
        if (screen.length === 1) screen.push([screen[0][0] + 0.01, screen[0][1]]);
        path.setAttribute("d", highlightPath(screen, mark.type === "text"));
        path.setAttribute("fill", mark.type === "text" ? highlightColors[mark.color] : "none");
        if (mark.type === "brush") {
          path.setAttribute("stroke", highlightColors[mark.color]);
          path.setAttribute("stroke-width", String(mark.width * scale()));
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
        }
        group.append(path);
      }
      svg.append(group);
    }
    find("summary").textContent = `${marks.length} highlight${marks.length === 1 ? "" : "s"} in this document · ${marks.filter((mark) => mark.page === pageIndex).length} on this page`;
  }
  function change(next) {
    undo.push(marks); redo = []; marks = next; dirty = true;
    if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
    draw(); controls();
  }
  function stopStroke(commit = false) {
    if (!stroke) return;
    const pending = stroke; stroke = null;
    if (brush.hasPointerCapture(pending.pointer)) brush.releasePointerCapture(pending.pointer);
    if (commit) { change([...marks, pending.mark]); status("Brush highlight added."); }
    else draw();
  }
  function cancelRender() {
    renderVersion++; renderTask?.cancel(); textLayer?.cancel(); stopStroke();
    window.getSelection()?.removeAllRanges();
  }
  function requestRender(anchor = null) {
    cancelRender();
    thumbnails.setActive(pageIndex);
    const version = renderVersion;
    rendering = true; sheet.hidden = true; controls(); status("Rendering page…");
    renderQueue = renderQueue.catch(() => {}).then(async () => {
      if (version !== renderVersion || !pdf) return;
      const page = await pdf.getPage(pageIndex + 1);
      try {
        if (version !== renderVersion) return;
        const unit = page.getViewport({ scale: 1 });
        const padding = parseFloat(getComputedStyle(stage).paddingLeft) * 2;
        if (fit) zoom = Math.min(3, Math.max(0.1, (stage.clientWidth - padding) / unit.width));
        viewport = page.getViewport({ scale: zoom });
        sheet.style.width = `${viewport.width}px`; sheet.style.height = `${viewport.height}px`;
        sheet.style.setProperty("--total-scale-factor", scale());
        sheet.style.setProperty("--scale-round-x", "1px"); sheet.style.setProperty("--scale-round-y", "1px");
        const canvas = find("canvas");
        const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / viewport.width, 4096 / viewport.height, Math.sqrt(12_000_000 / (viewport.width * viewport.height)));
        canvas.width = Math.max(1, Math.ceil(viewport.width * ratio)); canvas.height = Math.max(1, Math.ceil(viewport.height * ratio));
        renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: [ratio, 0, 0, ratio, 0, 0], background: "rgb(255,255,255)" });
        await renderTask.promise;
        if (version !== renderVersion) return;
        text.replaceChildren();
        let hasText = false;
        try {
          const content = await page.getTextContent();
          if (version !== renderVersion) return;
          hasText = content.items.some((item) => item.str?.trim());
          textLayer = new TextLayer({ textContentSource: content, container: text, viewport });
          await textLayer.render();
        } catch (cause) {
          if (version !== renderVersion) return;
          console.error("PDF text layer could not be read:", cause);
          hasText = false;
          text.replaceChildren();
          status("Page displayed, but text selection is unavailable. Use Highlight brush.");
        }
        if (version !== renderVersion) return;
        sheet.hidden = false; draw();
        if (anchor) {
          const [x, y] = viewport.convertToViewportPoint(...anchor);
          const pageBounds = sheet.getBoundingClientRect(), stageBounds = stage.getBoundingClientRect();
          stage.scrollLeft += pageBounds.left + x - stageBounds.left - stage.clientWidth / 2;
          stage.scrollTop += pageBounds.top + y - stageBounds.top - stage.clientHeight / 2;
        }
        find("page").value = pageIndex + 1; find("page").max = pdf.numPages;
        find("total").textContent = `of ${pdf.numPages}`; find("zoom").value = Math.round(zoom * 100);
        find("hint").textContent = mode === "brush" ? "Drag over the page to paint a highlight. Scroll the surrounding area to move around." : hasText ? "Drag across text to highlight it, or choose Read to select and copy without marking." : "No selectable text was found on this page. Use Highlight brush to mark scanned content.";
        if (hasText) status(`Page ${pageIndex + 1} ready.`);
        else status("Use Highlight brush for this page.");
      } finally { page.cleanup(); }
    }).catch((cause) => {
      if (version !== renderVersion) return;
      console.error("PDF page could not be rendered:", cause);
      error("This page could not be displayed. Try another page or open the PDF again.");
    }).finally(() => { if (version === renderVersion) { rendering = false; controls(); } });
  }
  async function open(file) {
    if (!file || loading || exporting) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { error("Choose a PDF file."); return; }
    if (file.size > 150 * 1024 * 1024) { error("Choose a PDF smaller than 150 MB."); return; }
    if (dirty && !window.confirm("Open another PDF? Download your current highlights first if you want to keep them.")) return;
    loading = true; cancelRender(); const current = ++generation;
    error(); status("Opening PDF…"); controls();
    try {
      await renderQueue;
      await thumbnails.clear();
      if (task) await task.destroy();
      task = null; pdf = null; bytes = null; viewport = null;
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = null; marks = []; undo = []; redo = []; dirty = false;
      find("workspace").hidden = true; find("upload").hidden = false;
      bytes = new Uint8Array(await file.arrayBuffer());
      const resources = sitePath("pdfjs/");
      task = getDocument({ data: bytes.slice(), cMapUrl: `${resources}cmaps/`, cMapPacked: true, standardFontDataUrl: `${resources}standard_fonts/`, wasmUrl: `${resources}wasm/`, iccUrl: `${resources}iccs/`, isEvalSupported: false });
      // Resolve unsupported protected files immediately rather than leaving a pending password request.
      task.onPassword = () => { task.destroy().catch(() => {}); };
      pdf = await task.promise;
      if (current !== generation) return;
      name = file.name; pageIndex = 0; fit = true;
      find("name").textContent = name; find("upload").hidden = true; find("workspace").hidden = false;
      thumbnails.load(pdf);
      stage.scrollTo(0, 0); requestRender();
    } catch (cause) {
      console.error("PDF could not be opened:", cause);
      error("This PDF could not be opened. It may be damaged or password-protected. Try an unlocked copy."); status("");
      await thumbnails.clear();
      await task?.destroy().catch(() => {}); task = null; pdf = null; bytes = null;
      find("workspace").hidden = true; find("upload").hidden = false;
      if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
    } finally { loading = false; find("file").value = ""; controls(); }
  }
  function applySelection() {
    if (!pdf || rendering || loading || exporting || mode !== "text") return;
    const range = selectedRange(); if (!range) return;
    const quads = selectionQuads([...range.getClientRects()], sheet.getBoundingClientRect(), viewport);
    if (quads.length) { change([...marks, { type: "text", page: pageIndex, color: find("color").value, quads }]); status("Text highlighted."); }
    window.getSelection()?.removeAllRanges(); controls();
  }
  find("choose").onclick = find("replace").onclick = () => find("file").click();
  find("file").onchange = () => open(find("file").files[0]);
  let depth = 0;
  root.addEventListener("dragenter", (event) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); depth++; find("upload").classList.add("is-dragging"); } });
  root.addEventListener("dragover", (event) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); });
  root.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; find("upload").classList.remove("is-dragging"); } });
  root.addEventListener("drop", (event) => { if (!event.dataTransfer?.types.includes("Files")) return; event.preventDefault(); depth = 0; find("upload").classList.remove("is-dragging"); if (event.dataTransfer.files.length !== 1) error("Drop one PDF at a time."); else open(event.dataTransfer.files[0]); });
  root.querySelectorAll("[data-mode]").forEach((button) => button.onclick = () => {
    stopStroke(); mode = button.dataset.mode; sheet.dataset.tool = mode;
    root.querySelectorAll("[data-mode]").forEach((node) => node.setAttribute("aria-pressed", String(node === button)));
    window.getSelection()?.removeAllRanges();
    find("hint").textContent = mode === "brush" ? "Drag over the page to paint a highlight. Use the size control for finer marks." : mode === "read" ? "Select and copy text without adding highlights." : "Drag across selectable text to highlight it. For scans or images, use Highlight brush.";
    controls();
  });
  find("apply").onpointerdown = (event) => event.preventDefault();
  find("apply").onclick = applySelection;
  text.addEventListener("pointerup", () => { if (mode === "text") setTimeout(applySelection, 0); });
  document.addEventListener("selectionchange", () => { if (!loading && !rendering && !exporting) find("apply").disabled = mode !== "text" || !selectedRange(); });
  brush.addEventListener("pointerdown", (event) => {
    if (!pdf || rendering || loading || exporting || mode !== "brush" || stroke || event.button !== 0) return;
    event.preventDefault(); brush.setPointerCapture(event.pointerId);
    stroke = { pointer: event.pointerId, mark: { type: "brush", page: pageIndex, color: find("color").value, width: Number(find("size").value), points: [pointerPdfPoint(event.clientX, event.clientY, sheet.getBoundingClientRect(), viewport)] } }; draw();
  });
  brush.addEventListener("pointermove", (event) => {
    if (!stroke || stroke.pointer !== event.pointerId) return;
    const point = pointerPdfPoint(event.clientX, event.clientY, sheet.getBoundingClientRect(), viewport);
    const previous = stroke.mark.points.at(-1);
    if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) * scale() < 1) return;
    if (stroke.mark.points.length < 5000) stroke.mark.points.push(point);
    draw();
  });
  brush.addEventListener("pointerup", (event) => {
    if (stroke?.pointer !== event.pointerId) return;
    if (stroke.mark.points.length < 5000) stroke.mark.points.push(pointerPdfPoint(event.clientX, event.clientY, sheet.getBoundingClientRect(), viewport));
    stopStroke(true);
  });
  brush.addEventListener("pointercancel", () => stopStroke());
  brush.addEventListener("lostpointercapture", () => stopStroke());
  find("undo").onclick = () => { if (!undo.length) return; stopStroke(); redo.push(marks); marks = undo.pop(); dirty = true; draw(); controls(); status("Highlight undone."); };
  find("redo").onclick = () => { if (!redo.length) return; stopStroke(); undo.push(marks); marks = redo.pop(); dirty = true; draw(); controls(); status("Highlight restored."); };
  find("clear").onclick = () => change(marks.filter((mark) => mark.page !== pageIndex));
  function navigate(next) { if (!pdf || rendering || loading || exporting) return; pageIndex = Math.max(0, Math.min(pdf.numPages - 1, next)); error(); stage.scrollTo(0, 0); requestRender(); }
  find("prev").onclick = () => navigate(pageIndex - 1);
  find("next").onclick = () => navigate(pageIndex + 1);
  find("page").onchange = () => { const next = Number(find("page").value); if (Number.isInteger(next) && next >= 1 && next <= pdf.numPages) navigate(next - 1); else find("page").value = pageIndex + 1; };
  function setZoom(value) {
    if (!pdf || rendering || loading || exporting) return;
    const next = zoomFromPercent(value, zoom);
    find("zoom").value = Math.round(next * 100);
    if (next === zoom) return;
    const bounds = stage.getBoundingClientRect();
    const anchor = pointerPdfPoint(bounds.left + stage.clientWidth / 2, bounds.top + stage.clientHeight / 2, sheet.getBoundingClientRect(), viewport);
    zoom = next; fit = false; requestRender(anchor);
  }
  find("zoom-in").onclick = () => setZoom(Math.round(zoom * 100) + 5);
  find("zoom-out").onclick = () => setZoom(Math.round(zoom * 100) - 5);
  find("zoom").onchange = () => setZoom(find("zoom").value);
  find("zoom").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); setZoom(find("zoom").value); }
    if (event.key === "Escape") { find("zoom").value = Math.round(zoom * 100); find("zoom").blur(); }
  });
  find("fit").onclick = () => { fit = true; requestRender(); };
  find("download").onclick = async () => {
    if (!bytes || exporting || rendering || loading) return;
    stopStroke(true); exporting = true; controls(); error(); status("Preparing highlighted PDF…");
    try {
      const output = marks.length ? await exportHighlightedPdf(bytes, marks) : bytes;
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(new Blob([output], { type: "application/pdf" }));
      const link = document.createElement("a"); link.href = downloadUrl; link.download = name.replace(/\.pdf$/i, "") + "-highlighted.pdf";
      document.body.append(link); link.click(); link.remove(); dirty = false; status("Download ready. Your original file is unchanged.");
    } catch (cause) { console.error("PDF export failed:", cause); error("The PDF could not be saved. Your highlights are still here; try again."); status(""); }
    finally { exporting = false; controls(); }
  };
  let resizeTimer;
  const resizeObserver = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (pdf && fit && !loading && !exporting) requestRender(); }, 200); });
  resizeObserver.observe(stage);
  window.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  window.addEventListener("pagehide", () => { generation++; cancelRender(); clearTimeout(resizeTimer); resizeObserver.disconnect(); thumbnails.clear(); detachFullscreen(); task?.destroy().catch(() => {}); if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
}
