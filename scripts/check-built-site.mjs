import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Check actual generated pages, so broken subdirectory links fail before deploy.
const output = resolve("dist");
const base = `/${(process.env.ASTRO_BASE || "").replace(/^\/+|\/+$/g, "")}`.replace(/\/?$/, "/");
const origin = "https://build-check.invalid";
const pages = readdirSync(output, { recursive: true }).filter((path) => path.endsWith(".html"));
assert(pages.length > 0, "No built pages found");
let links = 0;
for (const page of pages) {
  const html = readFileSync(resolve(output, page), "utf8");
  const pageUrl = new URL(base + page.replace(/index\.html$/, ""), origin);
  for (const [, value] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = new URL(value, pageUrl);
    if (url.origin !== origin) continue;
    assert(url.pathname.startsWith(base), `${page}: path escapes deployment base: ${value}`);
    const path = decodeURIComponent(url.pathname.slice(base.length));
    const file = resolve(output, path.endsWith("/") || !path ? `${path}index.html` : path);
    assert(existsSync(file), `${page}: missing link or asset: ${value}`);
    links++;
  }
}
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  assert(readdirSync(resolve(output, "pdfjs", directory)).length > 0, `Missing PDF resources: ${directory}`);
}
const scripts = readdirSync(resolve(output, "_astro")).filter((file) => file.endsWith(".js"));
assert(scripts.some((file) => readFileSync(resolve(output, "_astro", file), "utf8").includes(`${base}pdfjs/`)), "PDF preview URLs must include the deployment base");
console.log(`Verified ${pages.length} pages, ${links} internal references, and PDF preview resources under ${base}`);
