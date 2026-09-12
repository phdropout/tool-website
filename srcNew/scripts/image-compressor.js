import UPNG from "@pdf-lib/upng";
import libheif from "libheif-js";

const imageInput = document.querySelector("#imageInput");
const chooseImageButton = document.querySelector("#chooseImageButton");
const uploadArea = document.querySelector("#uploadArea");
const editor = document.querySelector("#editor");
const imagePreview = document.querySelector("#imagePreview");
const fileName = document.querySelector("#fileName");
const originalSize = document.querySelector("#originalSize");
const originalFileSize = document.querySelector("#originalFileSize");

const presetButtons = document.querySelectorAll(".preset-button");
const formatSelect = document.querySelector("#formatSelect");
const qualityInput = document.querySelector("#qualityInput");
const qualityValue = document.querySelector("#qualityValue");
const qualityLabel = document.querySelector("#qualityLabel");
const qualityNote = document.querySelector("#qualityNote");
const pngNotice = document.querySelector("#pngNotice");
const heicNotice = document.querySelector("#heicNotice");

const compressButton = document.querySelector("#compressButton");
const resetButton = document.querySelector("#resetButton");

const resultPanel = document.querySelector("#resultPanel");
const resultDimensions = document.querySelector("#resultDimensions");
const resultOriginalSize = document.querySelector("#resultOriginalSize");
const resultCompressedSize = document.querySelector("#resultCompressedSize");
const resultSavings = document.querySelector("#resultSavings");
const resultNote = document.querySelector("#resultNote");
const downloadButton = document.querySelector("#downloadButton");

const errorMessage = document.querySelector("#errorMessage");

let originalImage = null;
let currentFile = null;
let currentSourceType = null;
let currentObjectUrl = null;
let downloadObjectUrl = null;

const MAX_PIXEL_COUNT = 100_000_000;
const DEFAULT_QUALITY = 75;

const browserReadableTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const heicTypes = [
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
];

chooseImageButton?.addEventListener("click", () => {
  imageInput?.click();
});

imageInput?.addEventListener("change", () => {
  const file = imageInput.files?.[0];

  if (file) {
    loadImage(file);
  }
});

uploadArea?.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadArea.classList.add("dragging");
});

uploadArea?.addEventListener("dragleave", () => {
  uploadArea.classList.remove("dragging");
});

uploadArea?.addEventListener("drop", (event) => {
  event.preventDefault();
  uploadArea.classList.remove("dragging");

  const file = event.dataTransfer?.files?.[0];

  if (file) {
    loadImage(file);
  }
});

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!originalImage) {
      showError("Please choose an image before using a compression preset.");
      return;
    }

    const quality = Number(button.dataset.quality);

    qualityInput.value = String(quality);
    qualityValue.textContent = `${quality}%`;

    highlightPreset(button);
    updateQualityCopy();
    resultPanel.hidden = true;
    hideError();
  });
});

qualityInput?.addEventListener("input", () => {
  const quality = Number(qualityInput.value);

  qualityValue.textContent = `${quality}%`;
  clearPresetHighlight();
  updateQualityCopy();
  resultPanel.hidden = true;
});

formatSelect?.addEventListener("change", () => {
  updateQualityCopy();
  resultPanel.hidden = true;
});

compressButton?.addEventListener("click", compressImage);
resetButton?.addEventListener("click", resetTool);

async function loadImage(file) {
  hideError();

  const sourceType = getSourceType(file);

  if (!sourceType) {
    showError("Please choose a JPG, PNG, WebP, HEIC, or HEIF image.");
    return;
  }

  currentFile = file;
  currentSourceType = sourceType;

  revokeCurrentObjectUrl();
  revokeDownloadObjectUrl();

  try {
    let previewBlob = file;

    if (isHeicType(sourceType)) {
      chooseImageButton.disabled = true;
      chooseImageButton.textContent = "Opening HEIC…";
      previewBlob = await decodeHeicToPng(file);
    }

    currentObjectUrl = URL.createObjectURL(previewBlob);
    await setPreviewImage(currentObjectUrl, file);

    formatSelect.value = isHeicType(sourceType)
      ? "image/jpeg"
      : "original";

    qualityInput.value = String(DEFAULT_QUALITY);
    qualityValue.textContent = `${DEFAULT_QUALITY}%`;

    setPresetByQuality(DEFAULT_QUALITY);
    updateQualityCopy();

    uploadArea.hidden = true;
    editor.hidden = false;
    resultPanel.hidden = true;
  } catch (error) {
    console.error(error);

    currentFile = null;
    currentSourceType = null;
    originalImage = null;
    revokeCurrentObjectUrl();

    showError(
      isHeicType(sourceType)
        ? "This HEIC or HEIF image could not be opened. Try another file."
        : "This image could not be opened."
    );
  } finally {
    chooseImageButton.disabled = false;
    chooseImageButton.textContent = "Choose image";
  }
}

async function setPreviewImage(objectUrl, file) {
  const image = new Image();

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = objectUrl;
  });

  const pixelCount = image.naturalWidth * image.naturalHeight;

  if (pixelCount > MAX_PIXEL_COUNT) {
    throw new Error("Image exceeds the safe pixel limit.");
  }

  originalImage = image;
  imagePreview.src = objectUrl;
  fileName.textContent = file.name;

  originalSize.textContent =
    `Original size: ${image.naturalWidth} × ${image.naturalHeight} px`;

  originalFileSize.textContent =
    `File size: ${formatFileSize(file.size)}`;
}

async function decodeHeicToPng(file) {
  const arrayBuffer = await file.arrayBuffer();
  const decoder = new libheif.HeifDecoder();
  const decodedImages = decoder.decode(new Uint8Array(arrayBuffer));

  if (!decodedImages || decodedImages.length === 0) {
    throw new Error("No image was found inside the HEIC/HEIF file.");
  }

  const heifImage = decodedImages[0];
  const width = heifImage.get_width();
  const height = heifImage.get_height();

  if (width * height > MAX_PIXEL_COUNT) {
    throw new Error("Image exceeds the safe pixel limit.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });

  if (!context) {
    throw new Error("Canvas is not available.");
  }

  const imageData = context.createImageData(width, height);

  const displayData = await new Promise((resolve, reject) => {
    heifImage.display(imageData, (decodedData) => {
      if (!decodedData) {
        reject(new Error("HEIC/HEIF decoding failed."));
        return;
      }

      resolve(decodedData);
    });
  });

  context.putImageData(displayData, 0, 0);

  return canvasToBlob(canvas, "image/png", 1);
}

async function compressImage() {
  hideError();

  if (!originalImage || !currentFile) {
    showError("Please choose an image first.");
    return;
  }

  const width = originalImage.naturalWidth;
  const height = originalImage.naturalHeight;
  const outputType = getSelectedOutputType();
  const qualityPercent = Number(qualityInput.value);

  compressButton.disabled = true;
  compressButton.textContent = "Compressing…";

  try {
    let blob;

    if (outputType === "image/png") {
      blob = compressAsPng(width, height, qualityPercent);
    } else {
      blob = await compressWithCanvas(
        width,
        height,
        outputType,
        qualityPercent / 100
      );
    }

    if (!blob) {
      throw new Error("No compressed image was created.");
    }

    showResult(blob, width, height, outputType);
  } catch (error) {
    console.error(error);
    showError(
      "The compressed image could not be created. Try another image or compression level."
    );
  } finally {
    compressButton.disabled = false;
    compressButton.textContent = "Compress image";
  }
}

function compressAsPng(width, height, qualityPercent) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });

  if (!context) {
    throw new Error("Canvas is not available.");
  }

  context.drawImage(originalImage, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const rgba = new Uint8Array(imageData.data);

  const colorCount = pngColorCountFromQuality(qualityPercent);

  const encoded = UPNG.encode(
    [rgba.buffer],
    width,
    height,
    colorCount
  );

  return new Blob([encoded], {
    type: "image/png",
  });
}

function pngColorCountFromQuality(qualityPercent) {
  if (qualityPercent >= 100) {
    return 0;
  }

  const minimumColors = 16;
  const maximumColors = 256;
  const normalized = Math.max(0, Math.min(1, qualityPercent / 100));

  const colors = Math.round(
    minimumColors * Math.pow(maximumColors / minimumColors, normalized)
  );

  return Math.max(minimumColors, Math.min(maximumColors, colors));
}

function compressWithCanvas(width, height, outputType, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    return Promise.reject(new Error("Canvas is not available."));
  }

  if (outputType === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(originalImage, 0, 0, width, height);

  return canvasToBlob(canvas, outputType, quality);
}

function canvasToBlob(canvas, outputType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas encoding failed."));
          return;
        }

        resolve(blob);
      },
      outputType,
      quality
    );
  });
}

function showResult(blob, width, height, outputType) {
  revokeDownloadObjectUrl();

  downloadObjectUrl = URL.createObjectURL(blob);

  downloadButton.href = downloadObjectUrl;
  downloadButton.download = createDownloadName(
    currentFile.name,
    outputType
  );

  const change = calculateSizeChange(currentFile.size, blob.size);

  resultDimensions.textContent =
    `${width} × ${height} px • dimensions preserved`;

  resultOriginalSize.textContent = formatFileSize(currentFile.size);
  resultCompressedSize.textContent = formatFileSize(blob.size);
  resultSavings.textContent = change.label;
  resultNote.textContent = change.note;

  resultPanel.hidden = false;

  resultPanel.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });
}

function getSelectedOutputType() {
  if (formatSelect.value !== "original") {
    return formatSelect.value;
  }

  if (isHeicType(currentSourceType)) {
    return "image/jpeg";
  }

  return currentSourceType;
}

function updateQualityCopy() {
  const selectedType = currentFile
    ? getSelectedOutputType()
    : formatSelect.value;

  const quality = Number(qualityInput.value);
  const isPng = selectedType === "image/png";
  const isHeicSource = isHeicType(currentSourceType);

  if (qualityLabel) qualityLabel.textContent = isPng ? "PNG quality" : "Quality";
  if (pngNotice) pngNotice.hidden = !isPng;
  if (heicNotice) heicNotice.hidden = !isHeicSource;

  if (isHeicSource && heicNotice) {
    heicNotice.textContent =
      "HEIC/HEIF input detected. The image is decoded locally in your browser and will be exported as JPG, PNG, or WebP.";
  }

  if (isPng) {
    if (quality >= 100) {
      qualityNote.textContent =
        "Lossless PNG optimization with no color reduction.";
      if (pngNotice) pngNotice.textContent =
        "At 100%, PNG stays lossless. Lower settings reduce the color palette to make the file smaller while keeping PNG format and transparency.";
    } else if (quality >= 86) {
      qualityNote.textContent =
        "Light PNG color reduction with high visual fidelity.";
      if (pngNotice) pngNotice.textContent =
        `PNG compression will use about ${pngColorCountFromQuality(quality)} colors. Transparency is preserved.`;
    } else if (quality >= 66) {
      qualityNote.textContent =
        "Balanced PNG palette reduction for a smaller file.";
      if (pngNotice) pngNotice.textContent =
        `PNG compression will use about ${pngColorCountFromQuality(quality)} colors. Transparency is preserved.`;
    } else if (quality >= 41) {
      qualityNote.textContent =
        "Stronger PNG palette reduction; some color banding may appear.";
      if (pngNotice) pngNotice.textContent =
        `PNG compression will use about ${pngColorCountFromQuality(quality)} colors. Transparency is preserved.`;
    } else {
      qualityNote.textContent =
        "Aggressive PNG palette reduction for maximum size savings.";
      if (pngNotice) pngNotice.textContent =
        `PNG compression will use about ${pngColorCountFromQuality(quality)} colors. Visible color loss is more likely.`;
    }

    return;
  }

  if (quality >= 86) {
    qualityNote.textContent =
      "Higher visual quality with lighter compression.";
  } else if (quality >= 66) {
    qualityNote.textContent =
      "Balanced file size and visual quality.";
  } else if (quality >= 41) {
    qualityNote.textContent =
      "Smaller file with more visible quality loss possible.";
  } else {
    qualityNote.textContent =
      "Maximum size reduction with noticeable quality loss possible.";
  }
}

function getSourceType(file) {
  const mimeType = (file.type || "").toLowerCase();

  if (browserReadableTypes.includes(mimeType)) {
    return mimeType;
  }

  if (heicTypes.includes(mimeType)) {
    return mimeType;
  }

  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".heic")) {
    return "image/heic";
  }

  if (lowerName.endsWith(".heif")) {
    return "image/heif";
  }

  return null;
}

function isHeicType(type) {
  return Boolean(type && heicTypes.includes(type));
}

function calculateSizeChange(originalBytes, compressedBytes) {
  if (originalBytes === 0) {
    return {
      label: "N/A",
      note: "The size change could not be calculated.",
    };
  }

  const difference = originalBytes - compressedBytes;
  const percentage = Math.abs(difference / originalBytes) * 100;

  if (difference > 0) {
    return {
      label: `${percentage.toFixed(1)}% smaller`,
      note: `Saved ${formatFileSize(difference)} compared with the original file.`,
    };
  }

  if (difference < 0) {
    return {
      label: `${percentage.toFixed(1)}% larger`,
      note:
        "This output is larger than the original. Try a stronger compression setting or a different output format.",
    };
  }

  return {
    label: "No change",
    note: "The output file is the same size as the original.",
  };
}

function createDownloadName(originalName, outputType) {
  const lastDotIndex = originalName.lastIndexOf(".");

  const name =
    lastDotIndex === -1
      ? originalName
      : originalName.slice(0, lastDotIndex);

  const extensionMap = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };

  const extension = extensionMap[outputType] ?? "";

  return `${name}-compressed${extension}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }

  const megabytes = kilobytes / 1024;

  return `${megabytes.toFixed(2)} MB`;
}

function highlightPreset(activeButton) {
  presetButtons.forEach((button) => {
    button.classList.toggle("active", button === activeButton);
  });
}

function setPresetByQuality(quality) {
  let matchedButton = null;

  presetButtons.forEach((button) => {
    if (Number(button.dataset.quality) === quality) {
      matchedButton = button;
    }
  });

  if (matchedButton) {
    highlightPreset(matchedButton);
  } else {
    clearPresetHighlight();
  }
}

function clearPresetHighlight() {
  presetButtons.forEach((button) => {
    button.classList.remove("active");
  });
}

function resetTool() {
  revokeCurrentObjectUrl();
  revokeDownloadObjectUrl();

  originalImage = null;
  currentFile = null;
  currentSourceType = null;

  imageInput.value = "";
  imagePreview.removeAttribute("src");

  formatSelect.value = "original";
  qualityInput.value = String(DEFAULT_QUALITY);
  qualityValue.textContent = `${DEFAULT_QUALITY}%`;

  fileName.textContent = "";
  originalSize.textContent = "";
  originalFileSize.textContent = "";

  resultDimensions.textContent = "";
  resultOriginalSize.textContent = "";
  resultCompressedSize.textContent = "";
  resultSavings.textContent = "";
  resultNote.textContent = "";

  editor.hidden = true;
  resultPanel.hidden = true;
  uploadArea.hidden = false;

  setPresetByQuality(DEFAULT_QUALITY);
  updateQualityCopy();
  hideError();
}

function revokeCurrentObjectUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function revokeDownloadObjectUrl() {
  if (downloadObjectUrl) {
    URL.revokeObjectURL(downloadObjectUrl);
    downloadObjectUrl = null;
  }
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function hideError() {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}
