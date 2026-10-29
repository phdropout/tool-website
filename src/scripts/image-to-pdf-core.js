import { PDFDocument, degrees } from "pdf-lib";

// PDF dimensions are measured in points (72 points = one inch).
export function getPageLayout(width, height, rotation, { size = "a4", orientation = "auto", margin = 18 } = {}) {
  const turned = rotation % 180 !== 0;
  const imageWidth = turned ? height : width;
  const imageHeight = turned ? width : height;
  let pageWidth;
  let pageHeight;
  if (size === "image") {
    // Use 96 image pixels per inch; cap PDF dimensions for viewer compatibility.
    const scale = Math.min(0.75, (14400 - margin * 2) / Math.max(imageWidth, imageHeight));
    pageWidth = imageWidth * scale + margin * 2;
    pageHeight = imageHeight * scale + margin * 2;
  } else {
    [pageWidth, pageHeight] = size === "letter" ? [612, 792] : [595.28, 841.89];
    if (orientation === "landscape" || (orientation === "auto" && imageWidth > imageHeight)) {
      [pageWidth, pageHeight] = [pageHeight, pageWidth];
    }
  }
  const scale = Math.min((pageWidth - margin * 2) / imageWidth, (pageHeight - margin * 2) / imageHeight);
  const boundingWidth = imageWidth * scale;
  const boundingHeight = imageHeight * scale;
  return {
    pageWidth, pageHeight, width: width * scale, height: height * scale,
    x: (pageWidth - boundingWidth) / 2, y: (pageHeight - boundingHeight) / 2,
    boundingWidth, boundingHeight,
  };
}

export async function createImagePdf(images, settings, onProgress = () => {}) {
  if (!images.length) throw new Error("Choose at least one image first.");
  const pdf = await PDFDocument.create();
  pdf.setCreator("Tool Website — Image to PDF");
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    const embedded = image.type === "image/png" ? await pdf.embedPng(image.bytes) : await pdf.embedJpg(image.bytes);
    const rotation = ((image.rotation || 0) % 360 + 360) % 360;
    const layout = getPageLayout(embedded.width, embedded.height, rotation, settings);
    const page = pdf.addPage([layout.pageWidth, layout.pageHeight]);
    // Clockwise rotations need an offset to keep the image inside its bounds.
    const x = layout.x + (rotation === 180 || rotation === 270 ? layout.boundingWidth : 0);
    const y = layout.y + (rotation === 90 || rotation === 180 ? layout.boundingHeight : 0);
    page.drawImage(embedded, { x, y, width: layout.width, height: layout.height, rotate: degrees(-rotation) });
    onProgress(index + 1, images.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return pdf.save();
}
