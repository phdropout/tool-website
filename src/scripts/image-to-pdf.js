import { createImagePdf, getPageLayout } from "./image-to-pdf-core.js";

const root = document.querySelector("[data-image-to-pdf]");
if (root) initialize(root);

function initialize(root) {
  const find = (name) => root.querySelector(`[data-${name}]`);
  const input = find("file-input");
  const list = find("image-list");
  const status = find("status");
  const error = find("error");
  const result = find("result");
  const size = find("size");
  const orientation = find("orientation");
  const margin = find("margin");
  const filename = find("filename");
  const images = [];
  let busy = false;
  let downloadUrl = null;
  let draggedId = null;
  let dragDepth = 0;
  const MAX_BYTES = 100 * 1024 * 1024;

  const settings = () => ({ size: size.value, orientation: orientation.value, margin: Number(margin.value) });
  const showError = (message) => { error.textContent = message; error.hidden = !message; };
  function invalidate() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    find("download").removeAttribute("href");
    result.hidden = true;
  }
  function setBusy(value) {
    busy = value;
    root.setAttribute("aria-busy", String(value));
    root.querySelectorAll("button, select, input").forEach((control) => { control.disabled = value; });
    if (!value) render();
  }

  root.querySelectorAll("[data-choose]").forEach((button) => button.addEventListener("click", () => input.click()));
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    addFiles(files);
  });
  root.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth++;
    root.classList.add("itp-dragging");
  });
  root.addEventListener("dragover", (event) => {
    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
  });
  root.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) root.classList.remove("itp-dragging");
  });
  root.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    root.classList.remove("itp-dragging");
    if (event.dataTransfer.files.length) addFiles([...event.dataTransfer.files]);
  });

  async function addFiles(files) {
    if (busy || !files.length) return;
    invalidate();
    showError("");
    setBusy(true);
    const failures = [];
    let added = 0;
    try {
      for (const [index, file] of files.entries()) {
        status.textContent = `Reading image ${index + 1} of ${files.length}…`;
        if (images.length >= 50) { failures.push("You can add up to 50 images."); break; }
        try {
          if (!/\.(jpe?g|png|webp)$/i.test(file.name) && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            throw new Error("Use JPG, PNG, or WebP images. Convert HEIC photos in Image Tools first.");
          }
          if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("Choose a nonempty image smaller than 20 MB.");
          if (images.reduce((sum, item) => sum + item.originalSize, 0) + file.size > MAX_BYTES) throw new Error("The selected files exceed the 100 MB total limit.");
          const image = await prepareImage(file);
          if (images.reduce((sum, item) => sum + item.bytes.length, 0) + image.bytes.length > MAX_BYTES
            || images.reduce((sum, item) => sum + item.width * item.height, 0) + image.width * image.height > 80_000_000) {
            URL.revokeObjectURL(image.url);
            throw new Error("These decoded images need too much memory. Try smaller images or fewer pages.");
          }
          images.push(image);
          added++;
        } catch (reason) {
          failures.push(`${file.name}: ${reason.message || "This image could not be read."}`);
        }
      }
    } finally {
      setBusy(false);
      status.textContent = `${added} ${added === 1 ? "image" : "images"} added. ${images.length} ${images.length === 1 ? "page" : "pages"} in your PDF.`;
      showError(failures.slice(0, 3).join(" ") + (failures.length > 3 ? ` ${failures.length - 3} more images could not be added.` : ""));
    }
  }

  function render() {
    find("drop-zone").hidden = images.length > 0;
    find("workspace").hidden = !images.length;
    find("page-count").textContent = images.length;
    orientation.disabled = busy || size.value === "image";
    find("orientation-note").hidden = size.value !== "image";
    list.replaceChildren();
    images.forEach((image, index) => {
      const card = document.createElement("li");
      card.className = "itp-card";
      card.draggable = !busy;
      card.dataset.id = image.id;
      const layout = getPageLayout(image.width, image.height, image.rotation, settings());
      const paper = document.createElement("div");
      paper.className = "itp-paper";
      paper.style.aspectRatio = `${layout.pageWidth} / ${layout.pageHeight}`;
      paper.style.setProperty("--itp-ratio", layout.pageWidth / layout.pageHeight);
      const preview = document.createElement("img");
      preview.src = image.url;
      preview.alt = `Page ${index + 1}: ${image.name}`;
      preview.draggable = false;
      preview.style.width = `${layout.width / layout.pageWidth * 100}%`;
      preview.style.height = `${layout.height / layout.pageHeight * 100}%`;
      preview.style.transform = `translate(-50%, -50%) rotate(${image.rotation}deg)`;
      paper.append(preview);
      const number = document.createElement("span");
      number.className = "itp-page-number";
      number.textContent = `Page ${index + 1}`;
      const name = document.createElement("p");
      name.className = "itp-image-name";
      name.textContent = image.name;
      name.title = image.name;
      const actions = document.createElement("div");
      actions.className = "itp-card-actions";
      function action(text, label, handler, disabled = false) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.setAttribute("aria-label", `${label}: ${image.name}`);
        button.title = label;
        button.disabled = busy || disabled;
        button.addEventListener("click", () => {
          if (busy) return;
          invalidate();
          handler();
          render();
          status.textContent = `${label}. ${images.length} ${images.length === 1 ? "page" : "pages"} in your PDF.`;
          // Keep keyboard focus on the same action after rebuilding the list.
          const updated = [...list.children].find((item) => item.dataset.id === image.id);
          const target = updated?.querySelector(`button[title="${label}"]:not(:disabled)`)
            || updated?.querySelector("button:not(:disabled)")
            || list.querySelector("button:not(:disabled)") || root.querySelector("[data-choose]");
          target.focus();
        });
        actions.append(button);
      }
      action("←", "Move earlier", () => move(index, index - 1), index === 0);
      action("→", "Move later", () => move(index, index + 1), index === images.length - 1);
      action("↻", "Rotate clockwise", () => { image.rotation = (image.rotation + 90) % 360; });
      action("×", "Remove image", () => { URL.revokeObjectURL(image.url); images.splice(index, 1); });
      const frame = document.createElement("div");
      frame.className = "itp-paper-frame";
      frame.append(paper);
      card.append(number, frame, name, actions);
      card.addEventListener("dragstart", (event) => {
        if (busy || event.target.closest("button")) { event.preventDefault(); return; }
        draggedId = image.id;
        event.dataTransfer.setData("text/plain", image.id);
        event.dataTransfer.effectAllowed = "move";
        card.classList.add("itp-card-dragging");
      });
      card.addEventListener("dragend", () => { draggedId = null; card.classList.remove("itp-card-dragging"); });
      card.addEventListener("dragover", (event) => { if (draggedId && !busy) event.preventDefault(); });
      card.addEventListener("drop", (event) => {
        if (!draggedId || busy || event.dataTransfer.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        const from = images.findIndex((item) => item.id === draggedId);
        if (from < 0) return;
        invalidate();
        move(from, index);
        draggedId = null;
        render();
        status.textContent = "Page order updated.";
      });
      list.append(card);
    });
  }
  function move(from, to) {
    const [image] = images.splice(from, 1);
    images.splice(to, 0, image);
  }
  [size, orientation, margin].forEach((control) => control.addEventListener("change", () => { invalidate(); render(); }));
  filename.addEventListener("input", invalidate);
  find("clear").addEventListener("click", () => {
    if (busy) return;
    invalidate();
    images.forEach((image) => URL.revokeObjectURL(image.url));
    images.length = 0;
    showError("");
    status.textContent = "Images cleared. Choose images to start again.";
    render();
    root.querySelector("[data-choose]").focus();
  });
  find("convert").addEventListener("click", async () => {
    if (busy || !images.length) return;
    invalidate();
    showError("");
    setBusy(true);
    try {
      const bytes = await createImagePdf(images, settings(), (page, total) => { status.textContent = `Creating page ${page} of ${total}…`; });
      downloadUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const name = filename.value.trim().replace(/\.pdf$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "my-images";
      find("download").href = downloadUrl;
      find("download").download = `${name}.pdf`;
      find("result-details").textContent = `${images.length} ${images.length === 1 ? "page" : "pages"} · ${(bytes.length / 1024 / 1024).toFixed(2)} MB · Ready to save`;
      result.hidden = false;
      status.textContent = "Your PDF is ready to download.";
      find("download").focus();
    } catch (reason) {
      showError(`The PDF could not be created. Try fewer or smaller images. ${reason.message || ""}`);
      status.textContent = "Conversion failed. Your images are still available.";
    } finally { setBusy(false); }
  });
  render();
}

async function prepareImage(file) {
  const sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  let canvas;
  try {
    image.src = sourceUrl;
    await image.decode();
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height || width * height > 24_000_000 || Math.max(width, height) > 16000) {
      throw new Error("Use an image up to 24 megapixels and 16,000 pixels per side.");
    }
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable in this browser.");
    const type = file.type === "image/png" || /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
    if (type === "image/jpeg") { context.fillStyle = "#fff"; context.fillRect(0, 0, width, height); }
    context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
    if (!blob) throw new Error("The browser could not process this image.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { id: crypto.randomUUID(), name: file.name, originalSize: file.size, width, height, rotation: 0, bytes, type, url: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(sourceUrl);
    image.src = "";
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
