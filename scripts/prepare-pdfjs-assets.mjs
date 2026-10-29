import { cp, mkdir } from "node:fs/promises";

// Keep PDF.js fonts and decoders local; no CDN requests are needed for previews.
const source = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const destination = new URL("../public/pdfjs/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(new URL(`${directory}/`, source), new URL(`${directory}/`, destination), { recursive: true });
}
await cp(new URL("LICENSE", source), new URL("LICENSE", destination));
