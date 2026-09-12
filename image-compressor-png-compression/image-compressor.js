import UPNG from "@pdf-lib/upng";

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
let currentObjectUrl = null;
let downloadObjectUrl = null;

const MAX_PIXEL_COUNT = 100_000_000;
const DEFAULT_QUALITY = 75;

const supportedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
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

function loadImage(file) {
  hideError();

  if (!supportedTypes.includes(file.type)) {
    showError("Please choose a JPG, PNG, or WebP image.");
    return;
  }

  currentFile = file;

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  if (downloadObjectUrl) {
    URL.revokeObjectURL(downloadObjectUrl);
    downloadObjectUrl = null;
  }

  currentObjectUrl = URL.createObjectURL(file);

  const image = new Image();

  image.onload = () => {
    const pixelCount = image.naturalWidth * image.naturalHeight;

    if (pixelCount > MAX_PIXEL_COUNT) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
      currentFile = null;

      showError(
        "This image is too large to process safely in the browser. Try an image with fewer than 100 million pixels."
      );
      return;
    }

    originalImage = image;

    imagePreview.src = currentObjectUrl;
    fileName.textContent = file.name;

    originalSize.textContent =
      `Original size: ${image.naturalWidth} × ${image.naturalHeight} px`;

    originalFileSize.textContent =
      `File size: ${formatFileSize(file.size)}`;

    formatSelect.value = "original";
    qualityInput.value = String(DEFAULT_QUALITY);
    qualityValue.textContent = `${DEFAULT_QUALITY}%`;

    setPresetByQuality(DEFAULT_QUALITY);
    updateQualityCopy();

    uploadArea.hidden = true;
    editor.hidden = false;
    resultPanel.hidden = true;
  };

  image.onerror = () => {
    showError("This image could not be opened.");
  };

  image.src = currentObjectUrl;
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

  // UPNG uses 0 colors for lossless output. Lower palette sizes create
  // increasingly aggressive lossy PNG compression through quantization.
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

  // A curved mapping gives useful separation across the slider:
  // ~55% ≈ 73 colors, 75% ≈ 128 colors, 90% ≈ 194 colors.
  const minimumColors = 16;
  const maximumColors = 256;
  const normalized = Math.max(0, Math.min(1, qualityPercent / 100));
  const colors = Math.round(
    minimumColors * Math.pow(maximumColors / minimumColors, normalized)
  );

  return Math.max(minimumColors, Math.min(maximumColors, colors));
}

function compressWithCanvas(width, height, outputType, quality) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      reject(new Error("Canvas is not available."));
      return;
    }

    if (outputType === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }

    context.drawImage(originalImage, 0, 0, width, height);

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
  if (downloadObjectUrl) {
    URL.revokeObjectURL(downloadObjectUrl);
  }

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
  return formatSelect.value === "original"
    ? currentFile.type
    : formatSelect.value;
}

function updateQualityCopy() {
  const selectedType = currentFile
    ? getSelectedOutputType()
    : formatSelect.value;

  const quality = Number(qualityInput.value);
  const isPng = selectedType === "image/png";

  qualityLabel.textContent = isPng ? "PNG quality" : "Quality";
  pngNotice.hidden = !isPng;

  if (isPng) {
    if (quality >= 100) {
      qualityNote.textContent =
        "Lossless PNG optimization with no color reduction.";
      pngNotice.textContent =
        "At 100%, PNG stays lossless. Lower settings reduce the color palette to make the file smaller while keeping PNG format and transparency.";
    } else if (quality >= 86) {
      qualityNote.textContent =
        "Light PNG color reduction with high visual fidelity.";
      pngNotice.textContent =
        `PNG compression will use about ${pngColorCountFromQuality(quality)} colors. Transparency is preserved.`;
    } else if (quality >= 66) {
      qualityNote.textContent =
        "Balanced PNG palette reduction for a smaller file.";
      pngNotice.textContent =
        `PNG compression will use about ${pngColorCountFromQuality(quality)} colors. Transparency is preserved.`;
    } else if (quality >= 41) {
      qualityNote.textContent =
        "Stronger PNG palette reduction; some color banding may appear.";
      pngNotice.textContent =
        `PNG compression will use about ${pngColorCountFromQuality(quality)} colors. Transparency is preserved.`;
    } else {
      qualityNote.textContent =
        "Aggressive PNG palette reduction for maximum size savings.";
      pngNotice.textContent =
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
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  if (downloadObjectUrl) {
    URL.revokeObjectURL(downloadObjectUrl);
    downloadObjectUrl = null;
  }

  originalImage = null;
  currentFile = null;

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

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function hideError() {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}
