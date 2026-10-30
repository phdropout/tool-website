import { PDFDocument, rgb, BlendMode, LineCapStyle } from "pdf-lib";

export const highlightColors = { yellow: "#facc15", green: "#4ade80", pink: "#f472b6", blue: "#60a5fa" };

export function zoomFromPercent(value, current) {
  if (String(value).trim() === "" || !Number.isFinite(Number(value))) return current;
  return Math.max(10, Math.min(300, Math.round(Number(value)))) / 100;
}

// Store PDF coordinates, independent of screen size, zoom, crop, and rotation.
export function selectionQuads(rects, bounds, viewport) {
  const quads = [];
  for (const rect of rects) {
    const left = Math.max(0, rect.left - bounds.left);
    const top = Math.max(0, rect.top - bounds.top);
    const right = Math.min(viewport.width, rect.right - bounds.left);
    const bottom = Math.min(viewport.height, rect.bottom - bounds.top);
    if (right - left < 1 || bottom - top < 1) continue;
    const quad = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => viewport.convertToPdfPoint(x, y));
    // DOM ranges can report the same rectangle for nested text spans.
    if (!quads.some((existing) => existing.every((point, i) => point.every((value, j) => Math.abs(value - quad[i][j]) < 0.1)))) quads.push(quad);
  }
  return quads;
}

export function pointerPdfPoint(clientX, clientY, bounds, viewport) {
  return viewport.convertToPdfPoint(Math.max(0, Math.min(viewport.width, clientX - bounds.left)), Math.max(0, Math.min(viewport.height, clientY - bounds.top)));
}

export function highlightPath(points, close = false, invertY = false) {
  const path = points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${invertY ? -y : y}`).join(" ");
  return path + (close ? " Z" : "");
}

export async function exportHighlightedPdf(bytes, marks) {
  const pdf = await PDFDocument.load(bytes);
  for (const mark of marks) {
    if (!Number.isInteger(mark.page) || mark.page < 0 || mark.page >= pdf.getPageCount()) throw new Error("A highlight refers to a missing page.");
    const hex = highlightColors[mark.color];
    if (!hex) throw new Error("Unknown highlight color.");
    const color = rgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
    const page = pdf.getPage(mark.page);
    if (mark.type === "text") {
      for (const quad of mark.quads) page.drawSvgPath(highlightPath(quad, true, true), { color, opacity: 0.35, blendMode: BlendMode.Multiply });
    } else if (mark.type === "brush") {
      const points = mark.points.length === 1 ? [mark.points[0], [mark.points[0][0] + 0.01, mark.points[0][1]]] : mark.points;
      page.drawSvgPath(highlightPath(points, false, true), { borderColor: color, borderWidth: mark.width, borderOpacity: 0.35, borderLineCap: LineCapStyle.Round, blendMode: BlendMode.Multiply });
    } else throw new Error("Unknown highlight type.");
  }
  pdf.setCreator("Tools — PDF Viewer");
  return pdf.save();
}
