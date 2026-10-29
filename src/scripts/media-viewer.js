import { indexMediaFiles, filterMedia, nextMediaIndex, createMediaUrlCache } from "./media-library.js";
import { attachPreviewPan } from "./preview-pan.js";

const root = document.querySelector("[data-media-viewer]");
if (root) initialize(root);

function initialize(root) {
  const find = (name) => root.querySelector(`[data-${name}]`);
  const gallery = find("gallery");
  const dialog = find("viewer");
  const stage = find("stage");
  const shell = find("viewer-shell");
  const cache = createMediaUrlCache();
  const pan = attachPreviewPan(stage, { contentTag: "IMG", classPrefix: "mv" });
  let library = [];
  let filtered = [];
  let page = 0;
  let libraryVersion = 0;
  let thumbnailQueue = Promise.resolve();
  let viewItems = [];
  let viewIndex = -1;
  let viewerVersion = 0;
  let viewerUrl = null;
  let currentMedia = null;
  let triggerId = null;
  let zoom = 1;
  let slideshow = false;
  let slideshowTimer = null;
  const PAGE_SIZE = 60;
  const message = (text) => { find("viewer-message").textContent = text; };
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const target = entry.target;
      const item = library[Number(target.dataset.index)];
      if (!item || item.kind !== "image") continue;
      const epoch = libraryVersion;
      thumbnailQueue = thumbnailQueue.catch(() => {}).then(async () => {
        if (!target.isConnected || epoch !== libraryVersion) return;
        let url = cache.get(item.id);
        if (!url) {
          const blob = await makeThumbnail(item.file);
          if (!target.isConnected || epoch !== libraryVersion) return;
          url = URL.createObjectURL(blob);
          cache.set(item.id, url);
        }
        if (!target.isConnected || epoch !== libraryVersion) return;
        const image = node("img");
        image.src = url; image.alt = ""; image.draggable = false;
        target.replaceChildren(image);
      }).catch(() => {
        if (target.isConnected && epoch === libraryVersion) target.textContent = "Preview unavailable · Open to try";
      });
    }
  }, { rootMargin: "200px" });

  const folderSupported = "webkitdirectory" in find("directory-input");
  root.querySelectorAll("[data-choose-folder]").forEach((button) => {
    button.hidden = !folderSupported;
    button.addEventListener("click", () => find("directory-input").click());
  });
  root.querySelectorAll("[data-choose-files]").forEach((button) => button.addEventListener("click", () => find("file-input").click()));
  if (!folderSupported) find("status").textContent = "Folder selection is unavailable in this browser. You can choose individual files instead.";
  for (const input of [find("directory-input"), find("file-input")]) {
    input.addEventListener("change", () => {
      if (!input.files.length) return;
      const files = [...input.files];
      input.value = "";
      importFiles(files);
    });
  }
  function importFiles(files) {
    clearCollection();
    const result = indexMediaFiles(files);
    library = result.items;
    const firstPath = files[0]?.webkitRelativePath;
    find("library-name").textContent = firstPath ? firstPath.split("/")[0] : "Your collection";
    const images = library.filter((item) => item.kind === "image").length;
    const videos = library.length - images;
    find("summary").textContent = `${images} ${images === 1 ? "photo" : "photos"} · ${videos} ${videos === 1 ? "video" : "videos"} · ${result.ignored} other or empty files skipped`;
    const select = find("folder");
    select.replaceChildren(new Option("All folders", ""));
    for (const [path, count] of result.folders) select.append(new Option(`${path} (${count})`, path));
    find("welcome").hidden = library.length > 0;
    find("library").hidden = !library.length;
    find("status").textContent = result.overflow ? `${result.overflow} additional media files were skipped. Choose a smaller folder to browse them; this viewer indexes up to 10,000 at a time.`
      : library.length ? "Collection ready. Open a file to take a closer look. Videos load only when opened."
        : `No recognized photos or videos were found. ${result.ignored} files were skipped. Try another folder or choose individual files.`;
    renderGallery();
  }
  function clearCollection() {
    libraryVersion++;
    observer.disconnect();
    if (dialog.open) dialog.close();
    releaseViewerMedia(); stopSlideshow();
    cache.clear(); gallery.replaceChildren();
    library = []; filtered = []; viewItems = []; page = 0; viewIndex = -1;
    find("folder").replaceChildren(new Option("All folders", ""));
    find("kind").value = "all"; find("sort").value = "name"; find("search").value = "";
    find("welcome").hidden = false; find("library").hidden = true;
  }
  find("clear").addEventListener("click", () => {
    clearCollection(); find("status").textContent = "Collection cleared. Your original files have not been changed.";
    (folderSupported ? root.querySelector("[data-choose-folder]") : root.querySelector("[data-choose-files]")).focus();
  });
  for (const control of [find("folder"), find("kind"), find("sort"), find("search")]) {
    control.addEventListener(control.type === "search" ? "input" : "change", () => { page = 0; renderGallery(); });
  }
  function renderGallery() {
    observer.disconnect(); gallery.replaceChildren();
    filtered = filterMedia(library, { folder: find("folder").value, kind: find("kind").value, search: find("search").value, sort: find("sort").value });
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.max(0, Math.min(page, totalPages - 1));
    find("filter-count").textContent = `${filtered.length} ${filtered.length === 1 ? "file" : "files"} shown`;
    find("no-results").hidden = filtered.length > 0;
    find("gallery-previous").disabled = page === 0;
    find("gallery-next").disabled = page >= totalPages - 1;
    find("gallery-page").textContent = `Page ${page + 1} of ${totalPages}`;
    filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((item, position) => {
      const card = node("li", "mv-card");
      const button = node("button", "mv-open");
      button.type = "button"; button.dataset.id = item.id;
      button.setAttribute("aria-label", `Open ${item.kind === "video" ? "video" : "photo"}: ${item.path}`);
      button.title = item.path;
      const preview = node("span", `mv-thumbnail ${item.kind === "video" ? "mv-video-tile" : ""}`, item.kind === "video" ? "▶" : "Photo");
      preview.dataset.index = item.id.slice(6);
      preview.setAttribute("aria-hidden", "true");
      button.append(preview, node("strong", "mv-file-name", item.name), node("span", "mv-file-caption", item.kind === "video" ? "Video · Open player" : item.folder || "Photo"));
      button.addEventListener("click", () => {
        viewItems = [...filtered]; viewIndex = page * PAGE_SIZE + position; triggerId = item.id;
        dialog.showModal(); showCurrent();
      });
      card.append(button); gallery.append(card);
      if (item.kind === "image") observer.observe(preview);
    });
  }
  function changeGalleryPage(direction) {
    page += direction; renderGallery();
    find("filter-count").scrollIntoView({ block: "nearest" });
    gallery.querySelector("button")?.focus();
  }
  find("gallery-previous").addEventListener("click", () => changeGalleryPage(-1));
  find("gallery-next").addEventListener("click", () => changeGalleryPage(1));

  function releaseViewerMedia() {
    viewerVersion++;
    pan.reset();
    if (currentMedia) {
      currentMedia.onload = null; currentMedia.onerror = null;
      if (currentMedia.tagName === "VIDEO") currentMedia.pause();
      currentMedia.removeAttribute("src");
      if (currentMedia.tagName === "VIDEO") currentMedia.load();
    }
    currentMedia = null;
    stage.replaceChildren();
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = null;
  }
  function showCurrent() {
    releaseViewerMedia();
    const item = viewItems[viewIndex];
    if (!item || !dialog.open) return;
    const version = viewerVersion;
    zoom = 1;
    find("viewer-name").textContent = item.name;
    find("viewer-position").textContent = `${viewIndex + 1} of ${viewItems.length} · ${item.folder || "Selected files"}`;
    find("viewer-details").textContent = `${formatSize(item.file.size)}${item.modified ? ` · Modified ${new Date(item.modified).toLocaleDateString()}` : ""}`;
    find("previous").disabled = viewItems.length < 2;
    find("next").disabled = viewItems.length < 2;
    find("fit").hidden = item.kind !== "image";
    find("slideshow").hidden = item.kind !== "image";
    find("slideshow").disabled = viewItems.filter((entry) => entry.kind === "image").length < 2;
    find("viewer-hint").textContent = item.kind === "image" ? "← → Browse · Scroll to zoom · Drag to pan" : "Use the video controls to play and adjust sound";
    message(item.kind === "image" ? "Opening photo…" : "Loading video…");
    viewerUrl = URL.createObjectURL(item.file);
    if (item.kind === "image") {
      const image = new Image();
      image.decoding = "async"; image.alt = item.path; image.draggable = false;
      currentMedia = image;
      image.onload = () => {
        if (version !== viewerVersion || !dialog.open) return;
        stage.append(image); fitImage(); message("");
        find("viewer-details").textContent += ` · ${image.naturalWidth} × ${image.naturalHeight} px`;
        scheduleSlide();
      };
      image.onerror = () => {
        if (version !== viewerVersion) return;
        stopSlideshow();
        message(`This browser could not display this image. It may be damaged or unsupported.${["heic", "heif"].includes(item.extension) ? " Convert it to JPG or PNG with Image Tools first." : ""} Use the arrows to try another file.`);
      };
      image.src = viewerUrl;
    } else {
      stopSlideshow();
      const video = node("video");
      currentMedia = video;
      video.controls = true; video.playsInline = true; video.preload = "metadata";
      video.addEventListener("loadedmetadata", () => {
        if (version !== viewerVersion) return;
        message("");
        find("viewer-details").textContent += ` · ${Number.isFinite(video.duration) ? Math.round(video.duration) + " seconds" : "Video"}`;
      });
      video.addEventListener("error", () => {
        if (version === viewerVersion) message("This browser cannot play this video's format or codec, or the file is damaged. Try another file with the arrows.");
      });
      video.src = viewerUrl;
      stage.append(video);
    }
  }
  function fitImage() {
    if (!currentMedia || currentMedia.tagName !== "IMG" || !currentMedia.naturalWidth) return;
    const ratio = currentMedia.naturalWidth / currentMedia.naturalHeight;
    const width = Math.min(Math.max(1, stage.clientWidth - 64), Math.max(1, stage.clientHeight - 64) * ratio);
    currentMedia.style.width = `${width * zoom}px`; currentMedia.style.height = `${width * zoom / ratio}px`;
    pan.refresh();
  }
  function navigate(direction, automatic = false) {
    if (!automatic) stopSlideshow();
    viewIndex = nextMediaIndex(viewItems, viewIndex, direction, automatic);
    if (viewIndex >= 0) showCurrent();
  }
  find("previous").addEventListener("click", () => navigate(-1));
  find("next").addEventListener("click", () => navigate(1));
  find("fit").addEventListener("click", () => { zoom = 1; fitImage(); });
  stage.addEventListener("wheel", (event) => {
    if (viewItems[viewIndex]?.kind !== "image") return;
    event.preventDefault(); stopSlideshow();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
    zoom = Math.min(5, Math.max(0.25, zoom * Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.002)));
    fitImage();
  }, { passive: false });
  window.addEventListener("resize", () => { if (dialog.open) fitImage(); });
  dialog.addEventListener("keydown", (event) => {
    if (event.target.closest("video, input, select")) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); navigate(event.key === "ArrowLeft" ? -1 : 1); }
    else if (viewItems[viewIndex]?.kind === "image" && ["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault(); stopSlideshow();
      zoom = event.key === "0" ? 1 : Math.min(5, Math.max(0.25, zoom * (event.key === "-" ? 0.8 : 1.25))); fitImage();
    }
  });
  function stopSlideshow() {
    slideshow = false; clearTimeout(slideshowTimer); slideshowTimer = null;
    find("slideshow").textContent = "Slideshow"; find("slideshow").setAttribute("aria-pressed", "false");
  }
  function scheduleSlide() {
    clearTimeout(slideshowTimer);
    if (slideshow && dialog.open) slideshowTimer = setTimeout(() => navigate(1, true), 5000);
  }
  find("slideshow").addEventListener("click", () => {
    if (slideshow) { stopSlideshow(); return; }
    slideshow = true; zoom = 1; fitImage();
    find("slideshow").textContent = "Pause slideshow"; find("slideshow").setAttribute("aria-pressed", "true");
    if (currentMedia?.complete && currentMedia?.naturalWidth) scheduleSlide();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopSlideshow(); });
  find("fullscreen").hidden = !shell.requestFullscreen;
  find("fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement === shell) await document.exitFullscreen(); else await shell.requestFullscreen();
    } catch { message("Fullscreen could not be opened. The viewer is still available in this window."); }
  });
  document.addEventListener("fullscreenchange", () => { find("fullscreen").textContent = document.fullscreenElement === shell ? "Exit fullscreen" : "Fullscreen"; if (dialog.open) fitImage(); });
  find("close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    stopSlideshow(); releaseViewerMedia();
    if (document.fullscreenElement === shell) void document.exitFullscreen().catch(() => {});
    [...gallery.querySelectorAll("button")].find((button) => button.dataset.id === triggerId)?.focus();
  });
  dialog.addEventListener("click", (event) => { if (event.target === stage) dialog.close(); });
  window.addEventListener("pagehide", () => { libraryVersion++; observer.disconnect(); cache.clear(); stopSlideshow(); releaseViewerMedia(); });
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function makeThumbnail(file) {
  let source;
  let url;
  const canvas = document.createElement("canvas");
  try {
    if (typeof createImageBitmap === "function") {
      try { source = await createImageBitmap(file, { resizeWidth: 320, resizeQuality: "low" }); } catch { /* Try the browser's image decoder below. */ }
    }
    if (!source) {
      source = new Image(); url = URL.createObjectURL(file); source.src = url; await source.decode();
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error("Image dimensions are unavailable");
    const scale = Math.min(1, 320 / width, 240 / height);
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image previews are unavailable");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
    if (!blob) throw new Error("Image preview could not be created");
    return blob;
  } finally {
    source?.close?.();
    if (url) { source.removeAttribute("src"); URL.revokeObjectURL(url); }
    canvas.width = 0; canvas.height = 0;
  }
}
