// Build-time gallery metadata only; image contents are never read here.
export function starterColoringPages(filenames) {
  return filenames.filter((name) => /\.png$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((filename) => ({
      path: `/coloring-pages/${encodeURIComponent(filename)}`,
      title: filename.replace(/\.png$/i, "").replace(/[_-]+/g, " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
    }));
}
