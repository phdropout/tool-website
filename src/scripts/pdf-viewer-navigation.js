// Keep the numbered page buttons available immediately; render only nearby
// previews, with a bounded canvas cache for long PDFs.
export function createThumbnailSidebar(container, onSelect, { cacheLimit = 60 } = {}) {
  const document = container.ownerDocument;
  let pdf = null, version = 0, queue = Promise.resolve(), activeRender = null;
  let buttons = [], cached = new Map(), pending = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) schedule(Number(entry.target.dataset.page));
  }, { root: container, rootMargin: "180px 0px" });

  function schedule(index) {
    if (!pdf || pending.has(index)) return;
    if (cached.has(index)) { const canvas = cached.get(index); cached.delete(index); cached.set(index, canvas); return; }
    pending.add(index);
    const current = version, source = pdf, button = buttons[index];
    queue = queue.catch(() => {}).then(async () => {
      if (current !== version) return;
      const page = await source.getPage(index + 1);
      if (current !== version) return;
      const unit = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 220 / Math.max(unit.width, unit.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute("aria-hidden", "true");
      activeRender = page.render({ canvasContext: canvas.getContext("2d"), canvas, viewport, background: "rgb(255,255,255)" });
      try { await activeRender.promise; }
      finally { activeRender = null; }
      if (current !== version) { canvas.width = canvas.height = 0; return; }
      button.querySelector(".pv-thumbnail-preview").replaceChildren(canvas);
      cached.set(index, canvas);
      while (cached.size > cacheLimit) {
        const [oldIndex, oldCanvas] = cached.entries().next().value;
        cached.delete(oldIndex); oldCanvas.width = oldCanvas.height = 0; oldCanvas.remove();
      }
      // The main viewer owns page cleanup, avoiding concurrent thumbnail cleanup.
    }).catch((cause) => {
      if (current !== version) return;
      console.error("PDF thumbnail could not be rendered:", cause);
      button.querySelector(".pv-thumbnail-preview").textContent = "Preview unavailable";
    }).finally(() => { if (current === version) pending.delete(index); });
  }
  function clear() {
    version++; observer.disconnect(); activeRender?.cancel();
    for (const canvas of cached.values()) canvas.width = canvas.height = 0;
    cached.clear(); pending.clear(); buttons = []; pdf = null; container.replaceChildren();
    return queue;
  }
  function load(source) {
    clear(); pdf = source;
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < pdf.numPages; index++) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "pv-thumbnail"; button.dataset.page = String(index);
      button.setAttribute("aria-label", `Go to page ${index + 1}`);
      const preview = document.createElement("span"); preview.className = "pv-thumbnail-preview"; preview.setAttribute("aria-hidden", "true");
      const label = document.createElement("span"); label.textContent = String(index + 1);
      button.append(preview, label); button.addEventListener("click", () => onSelect(index));
      buttons.push(button); fragment.append(button);
    }
    container.append(fragment);
    for (const button of buttons) observer.observe(button);
    setActive(0);
  }
  function setActive(index) {
    for (const [i, button] of buttons.entries()) {
      if (i === index) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    const button = buttons[index];
    if (!button) return;
    const bounds = container.getBoundingClientRect(), target = button.getBoundingClientRect();
    if (target.top < bounds.top) container.scrollTop += target.top - bounds.top - 8;
    else if (target.bottom > bounds.bottom) container.scrollTop += target.bottom - bounds.bottom + 8;
    schedule(index);
  }
  return { load, setActive, clear };
}

export function attachViewerFullscreen(target, button, { onChange = () => {}, onError = () => {} } = {}) {
  const document = target.ownerDocument;
  button.hidden = !target.requestFullscreen || !document.fullscreenEnabled;
  function update() {
    const active = document.fullscreenElement === target;
    button.textContent = active ? "Exit fullscreen" : "Fullscreen";
    button.setAttribute("aria-pressed", String(active));
    onChange(active);
  }
  async function toggle() {
    try {
      if (document.fullscreenElement === target) await document.exitFullscreen();
      else await target.requestFullscreen();
    } catch (cause) { onError(cause); }
  }
  button.addEventListener("click", toggle);
  document.addEventListener("fullscreenchange", update);
  return () => { button.removeEventListener("click", toggle); document.removeEventListener("fullscreenchange", update); };
}
