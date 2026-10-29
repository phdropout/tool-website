const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "svg", "heic", "heif"]);
const videoExtensions = new Set(["mp4", "m4v", "webm", "mov", "ogv", "ogg", "mkv", "avi", "3gp"]);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function indexMediaFiles(files, limit = 10000) {
  const items = [];
  let ignored = 0;
  let overflow = 0;
  const folders = new Map();
  for (const file of files) {
    const path = (file.webkitRelativePath || file.name).replaceAll("\\", "/");
    const segments = path.split("/");
    const extension = file.name.split(".").pop().toLowerCase();
    const kind = imageExtensions.has(extension) ? "image" : videoExtensions.has(extension) ? "video" : null;
    if (!kind || !file.size || file.type?.startsWith("audio/") || segments.some((part) => part.startsWith(".") || part === "__MACOSX")) { ignored++; continue; }
    if (items.length >= limit) { overflow++; continue; }
    const folder = segments.slice(0, -1).join("/");
    items.push({ id: `media-${items.length}`, file, path, folder, kind, extension, name: file.name, modified: Number(file.lastModified) || 0 });
    for (let count = 1; count < segments.length; count++) {
      const parent = segments.slice(0, count).join("/");
      folders.set(parent, (folders.get(parent) || 0) + 1);
    }
  }
  return { items, ignored, overflow, folders: [...folders].sort(([a], [b]) => collator.compare(a, b)) };
}

export function filterMedia(items, { folder = "", kind = "all", search = "", sort = "name" } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return items.filter((item) => (!folder || item.folder === folder || item.folder.startsWith(`${folder}/`))
    && (kind === "all" || item.kind === kind)
    && (!query || item.path.toLocaleLowerCase().includes(query)))
    .sort((a, b) => {
      if (sort === "newest" && a.modified !== b.modified) return b.modified - a.modified;
      if (sort === "oldest" && a.modified !== b.modified) return a.modified - b.modified;
      return collator.compare(a.name, b.name) || collator.compare(a.path, b.path);
    });
}

export function nextMediaIndex(items, current, direction, imagesOnly = false) {
  if (!items.length) return -1;
  for (let step = 1; step <= items.length; step++) {
    const index = ((current + direction * step) % items.length + items.length) % items.length;
    if (!imagesOnly || items[index].kind === "image") return index;
  }
  return -1;
}

export function createMediaUrlCache(limit = 96, revoke = (url) => URL.revokeObjectURL(url)) {
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) return null;
      const value = entries.get(key);
      entries.delete(key); entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) revoke(entries.get(key));
      entries.delete(key); entries.set(key, value);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        revoke(entries.get(oldest)); entries.delete(oldest);
      }
    },
    clear() { entries.forEach(revoke); entries.clear(); },
    get size() { return entries.size; },
  };
}
