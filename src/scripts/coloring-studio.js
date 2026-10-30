import { createDrawingSession, drawingPoint, fitDrawingSize, palettes, coloringImageMime } from "./coloring-core.js";
import { attachPreviewPan } from "./preview-pan.js";
import { attachViewerFullscreen } from "./pdf-viewer-navigation.js";
import { attachColoringInput, attachColoringWheelZoom } from "./coloring-input.js";

const root = document.querySelector("[data-coloring-studio]");
if (root) initialize(root);

function initialize(root) {
  const find = (key) => root.querySelector(`[data-${key}]`);
  const canvas = find("paint"), original = find("original"), paper = find("paper"), viewport = find("viewport");
  const context = canvas.getContext("2d");
  let session = null, active = null, brush = "round", tool = "brush", busy = false;
  const pan = attachPreviewPan(viewport, { classPrefix: "cs", enabled: () => tool === "hand" && !busy });
  let dirty = false, filename = "my-artwork", frame = null, downloadUrl = null, version = 0;
  let fitPending = false;
  const templates = [...root.querySelectorAll("[data-template]")];
  let galleryPage = 0, filteredTemplates = templates;
  const gallerySize = 12;
  const status = (value) => { find("status").textContent = value; };
  const error = (value = "") => { find("error").textContent = value; find("error").hidden = !value; };
  function controls() {
    root.setAttribute("aria-busy", String(busy));
    root.querySelectorAll("button, input, select").forEach((node) => { node.disabled = busy; });
    find("fullscreen").disabled = !session;
    find("undo").disabled = busy || !session?.canUndo;
    find("redo").disabled = busy || !session?.canRedo;
    find("gallery-prev").disabled = busy || galleryPage === 0;
    find("gallery-next").disabled = busy || (galleryPage + 1) * gallerySize >= filteredTemplates.length;
    root.querySelectorAll("[data-brush]").forEach((node) => node.setAttribute("aria-pressed", String(tool === "brush" && node.dataset.brush === brush)));
    root.querySelectorAll("[data-tool]").forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.tool === tool)));
    canvas.dataset.hand = String(tool === "hand");
  }
  function render() { if (session) session.render(context, active?.stroke); }
  function schedule() { if (frame !== null) return; frame = requestAnimationFrame(() => { frame = null; render(); }); }
  function finish(commit = true) {
    drawingInput.end(commit);
  }
  function finishStroke(commit, event) {
    if (!active) return;
    if (event?.type === "pointerup") addPoint(event);
    const previous = active; active = null;
    if (commit) { session.commit(previous.stroke); dirty = true; }
    if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    render(); controls();
    if (fitPending) { fitPending = false; requestAnimationFrame(fitCanvas); }
  }
  function fitCanvas() {
    if (!session) return;
    finish(); pan.reset();
    const value = find("zoom").value;
    const padding = parseFloat(getComputedStyle(viewport).paddingLeft) * 2;
    const zoom = value === "fit" ? Math.min((viewport.clientWidth - padding) / canvas.width, (viewport.clientHeight - padding) / canvas.height) : Number(value);
    paper.style.width = `${Math.max(1, canvas.width * zoom)}px`;
    paper.style.height = `${Math.max(1, canvas.height * zoom)}px`;
    pan.refresh();
  }
  const detachFullscreen = attachViewerFullscreen(root, find("fullscreen"), {
    onChange: () => { finish(); requestAnimationFrame(fitCanvas); },
    onError: (cause) => { console.error("Coloring fullscreen failed:", cause); error("Fullscreen is unavailable. You can continue coloring here."); },
  });
  function setTool(next, nextBrush = brush) { finish(); pan.reset(); tool = next; brush = nextBrush; controls(); }
  function swatches() {
    const palette = palettes[find("palette").value];
    find("swatches").replaceChildren();
    for (const color of palette.colors) {
      const button = document.createElement("button"); button.type = "button"; button.className = "cs-swatch";
      button.style.setProperty("--swatch", color); button.dataset.swatch = color;
      button.setAttribute("aria-label", `Choose color ${color}`); button.title = color;
      button.setAttribute("aria-pressed", String(find("color").value === color));
      button.onclick = () => { finish(); find("color").value = color; updateSwatches(); if (tool !== "brush") setTool("brush"); };
      find("swatches").append(button);
    }
  }
  function updateSwatches() { root.querySelectorAll("[data-swatch]").forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.swatch === find("color").value))); }
  function renderGallery() {
    for (const button of templates) button.hidden = true;
    const first = galleryPage * gallerySize;
    for (const button of filteredTemplates.slice(first, first + gallerySize)) button.hidden = false;
    find("page-count").textContent = filteredTemplates.length ? `${first + 1}–${Math.min(first + gallerySize, filteredTemplates.length)} of ${filteredTemplates.length} pages` : "0 pages";
    find("empty").hidden = filteredTemplates.length > 0;
    controls();
  }
  function decode(url) {
    return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("The image could not be decoded.")); image.src = url; });
  }
  async function load({ file, url, title, blank = false }) {
    if (busy) return;
    if (file && file.size > 25 * 1024 * 1024) { error("Choose an image smaller than 25 MB."); return; }
    if (file && !/^image\/(jpeg|png|webp)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) { error("Choose a JPG, PNG, or WebP image."); return; }
    finish();
    if (dirty && !window.confirm("Start a new page? Download your current artwork first if you want to keep it.")) { find("file").value = ""; return; }
    busy = true; controls(); error(); status("Preparing your canvas…");
    const current = ++version;
    let objectUrl;
    try {
      if (file) {
        const mime = coloringImageMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
        if (!mime) throw new Error("Unsupported image format");
        objectUrl = URL.createObjectURL(new Blob([file], { type: mime })); url = objectUrl;
      }
      const image = blank ? null : await decode(url);
      if (current !== version) return;
      if (image && image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("This image is too large. Resize it to 40 megapixels or less first.");
      const size = fitDrawingSize(image?.naturalWidth || 800, image?.naturalHeight || 1000);
      // Prepare before replacing the old document, so a decode failure keeps current work intact.
      const next = createDrawingSession(size.width, size.height, () => document.createElement("canvas"));
      session?.dispose(); session = next;
      original.width = canvas.width = size.width; original.height = canvas.height = size.height;
      const base = original.getContext("2d"); base.fillStyle = "white"; base.fillRect(0, 0, size.width, size.height);
      if (image) base.drawImage(image, 0, 0, size.width, size.height);
      dirty = false; filename = (file?.name || title || "my-artwork").replace(/\.[^.]+$/, "");
      find("name").textContent = file ? file.name : blank ? "Blank canvas" : "Coloring page";
      find("dimensions").textContent = `${size.width} × ${size.height} px${size.resized ? " · Resized for drawing" : ""}`;
      find("workspace").hidden = false; find("start").hidden = true;
      find("zoom").value = "fit"; find("outlines").checked = true; canvas.style.mixBlendMode = "multiply";
      tool = "brush"; pan.reset(); render(); fitCanvas(); viewport.scrollTo(0, 0);
      status("Canvas ready. Choose a brush and start coloring.");
      if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = null;
    } catch (cause) {
      console.error("Coloring image could not be opened:", cause);
      error(cause.message === "This image is too large. Resize it to 40 megapixels or less first." ? cause.message : "This image could not be opened. Try a different JPG, PNG, or WebP file."); status("");
    } finally { if (objectUrl) URL.revokeObjectURL(objectUrl); busy = false; find("file").value = ""; controls(); }
  }
  find("upload").onclick = () => find("file").click();
  find("file").onchange = () => { const file = find("file").files[0]; if (file) void load({ file }); };
  root.querySelectorAll("[data-template]").forEach((button) => button.onclick = () => load({ url: button.dataset.template, title: button.dataset.title }));
  find("blank").onclick = () => load({ blank: true, title: "Blank canvas" });
  find("new").onclick = () => { finish(); find("start").hidden = !find("start").hidden; };
  find("search").oninput = () => {
    const query = find("search").value.trim().toLocaleLowerCase();
    filteredTemplates = templates.filter((button) => button.dataset.title.toLocaleLowerCase().includes(query)); galleryPage = 0; renderGallery();
  };
  find("gallery-prev").onclick = () => { if (galleryPage > 0) { galleryPage--; renderGallery(); } };
  find("gallery-next").onclick = () => { if ((galleryPage + 1) * gallerySize < filteredTemplates.length) { galleryPage++; renderGallery(); } };
  root.querySelectorAll("[data-brush]").forEach((button) => button.onclick = () => setTool("brush", button.dataset.brush));
  root.querySelectorAll("[data-tool]").forEach((button) => button.onclick = () => setTool(button.dataset.tool));
  find("size").oninput = () => { find("size-label").textContent = `${find("size").value} px`; };
  find("opacity").oninput = () => { find("opacity-label").textContent = `${find("opacity").value}%`; };
  find("palette").onchange = swatches;
  find("color").oninput = () => { finish(); updateSwatches(); if (tool !== "brush") setTool("brush"); };
  find("outlines").onchange = () => { finish(); canvas.style.mixBlendMode = find("outlines").checked ? "multiply" : "normal"; dirty = true; };
  find("zoom").onchange = fitCanvas;
  find("undo").onclick = () => { finish(); session.undo(); dirty = true; render(); controls(); status("Last action undone."); };
  find("redo").onclick = () => { finish(); session.redo(); dirty = true; render(); controls(); status("Action restored."); };
  find("clear").onclick = () => { finish(); session.commit({ type: "clear" }); dirty = true; render(); controls(); status("Coloring cleared. Use Undo to restore it."); };
  const drawingInput = attachColoringInput(canvas, {
    canStart: () => Boolean(session) && !busy && tool !== "hand",
    onStart(event) {
      viewport.focus({ preventScroll: true });
      active = { pointer: event.pointerId, stroke: {
        type: "stroke", brush, erase: tool === "eraser", color: find("color").value, size: Number(find("size").value),
        opacity: Number(find("opacity").value) / 100,
        seed: Math.floor(Math.random() * 0xffffffff), points: [drawingPoint(event, canvas.getBoundingClientRect(), canvas.width, canvas.height)],
      } };
      schedule();
    },
    onMove(samples) { for (const sample of samples) addPoint(sample); schedule(); },
    onEnd: finishStroke,
  });
  function addPoint(event) {
    if (!active || active.stroke.points.length >= 8000) return;
    const point = drawingPoint(event, canvas.getBoundingClientRect(), canvas.width, canvas.height);
    const last = active.stroke.points.at(-1);
    if (Math.hypot(point.x - last.x, point.y - last.y) < 0.5) return;
    active.stroke.points.push(point);
  }
  const detachWheelZoom = attachColoringWheelZoom(viewport, paper, {
    getZoom: () => session && !busy ? paper.getBoundingClientRect().width / canvas.width : null,
    beforeZoom: () => { finish(); pan.reset(); fitPending = false; },
    setZoom(value) {
      const custom = find("custom-zoom");
      custom.value = String(value); custom.textContent = `${Math.round(value * 100)}%`; custom.hidden = false;
      find("zoom").value = custom.value;
      fitCanvas();
    },
  });
  let depth = 0;
  root.addEventListener("dragenter", (event) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); depth++; root.classList.add("is-dragging"); } });
  root.addEventListener("dragover", (event) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); });
  root.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; root.classList.remove("is-dragging"); } });
  root.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault(); depth = 0; root.classList.remove("is-dragging");
    if (event.dataTransfer.files.length !== 1) error("Drop one image at a time.");
    else void load({ file: event.dataTransfer.files[0] });
  });
  find("download").onclick = async () => {
    if (!session || busy) return;
    finish(); busy = true; controls(); error(); status("Preparing your artwork…");
    const output = document.createElement("canvas"); output.width = canvas.width; output.height = canvas.height;
    try {
      session.export(output.getContext("2d"), original, find("outlines").checked);
      const blob = await new Promise((resolve) => output.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG export failed");
      if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = downloadUrl; link.download = `${filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "my-artwork"}-colored.png`;
      document.body.append(link); link.click(); link.remove(); dirty = false; status("Your PNG is ready. Keep a copy before leaving the page.");
    } catch (cause) { console.error("Coloring export failed:", cause); error("Your artwork could not be saved. Your coloring is still here; try again."); status(""); }
    finally { output.width = output.height = 0; busy = false; controls(); }
  };
  root.addEventListener("keydown", (event) => {
    if (!session || busy || event.target.closest("input, select, textarea, [contenteditable]")) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(key)) {
      event.preventDefault(); const button = find(key === "y" || event.shiftKey ? "redo" : "undo"); if (!button.disabled) button.click();
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey && ["b", "e", "h"].includes(key)) {
      event.preventDefault(); setTool(key === "b" ? "brush" : key === "e" ? "eraser" : "hand");
    }
  });
  let resizeTimer;
  const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {
    if (!session || find("zoom").value !== "fit") return;
    if (active) fitPending = true;
    else fitCanvas();
  }, 100); });
  observer.observe(viewport);
  window.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    version++; fitPending = false; finish(false); drawingInput.dispose(); detachWheelZoom(); observer.disconnect(); clearTimeout(resizeTimer); detachFullscreen(); session?.dispose(); session = null;
    original.width = original.height = canvas.width = canvas.height = 0;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  });
  swatches(); renderGallery();
}
