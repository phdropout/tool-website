const imageInput = document.querySelector("#imageInput");
const chooseImageButton = document.querySelector("#chooseImageButton");
const uploadArea = document.querySelector("#uploadArea");
const editor = document.querySelector("#editor");
const imagePreview = document.querySelector("#imagePreview");
const fileName = document.querySelector("#fileName");
const originalSize = document.querySelector("#originalSize");
const originalFileSize = document.querySelector("#originalFileSize");

const widthInput = document.querySelector("#widthInput");
const heightInput = document.querySelector("#heightInput");
const lockAspectRatio = document.querySelector("#lockAspectRatio");
const presetButtons = document.querySelectorAll(".preset-button");

const formatSelect = document.querySelector("#formatSelect");
const qualityInput = document.querySelector("#qualityInput");
const qualityValue = document.querySelector("#qualityValue");
const qualityControl = document.querySelector("#qualityControl");

const resizeButton = document.querySelector("#resizeButton");
const resetButton = document.querySelector("#resetButton");

const resultPanel = document.querySelector("#resultPanel");
const resultDimensions = document.querySelector("#resultDimensions");
const resultFileSize = document.querySelector("#resultFileSize");
const downloadButton = document.querySelector("#downloadButton");

const errorMessage = document.querySelector("#errorMessage");

let originalImage = null;
let currentFile = null;
let aspectRatio = 1;
let currentObjectUrl = null;
let downloadObjectUrl = null;

const MAX_DIMENSION = 12000;
const MAX_PIXEL_COUNT = 100_000_000;

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

widthInput?.addEventListener("input", () => {
  if (!lockAspectRatio?.checked) {
    return;
  }

  const width = Number(widthInput.value);

  if (width > 0) {
    heightInput.value = String(
      Math.round(width / aspectRatio)
    );
  }
});

heightInput?.addEventListener("input", () => {
  if (!lockAspectRatio?.checked) {
    return;
  }

  const height = Number(heightInput.value);

  if (height > 0) {
    widthInput.value = String(
      Math.round(height * aspectRatio)
    );
  }
});

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!originalImage) {
      showError("Please choose an image before using a resize preset.");
      return;
    }

    const scale = Number(button.dataset.scale);

    const newWidth = Math.max(
      1,
      Math.round(originalImage.naturalWidth * scale)
    );

    const newHeight = Math.max(
      1,
      Math.round(originalImage.naturalHeight * scale)
    );

    widthInput.value = String(newWidth);
    heightInput.value = String(newHeight);

    highlightPreset(button);
    hideError();
  });
});

qualityInput?.addEventListener("input", () => {
  qualityValue.textContent = `${qualityInput.value}%`;
});

formatSelect?.addEventListener(
  "change",
  updateQualityVisibility
);

resizeButton?.addEventListener("click", resizeImage);
resetButton?.addEventListener("click", resetTool);

function loadImage(file) {
  hideError();
  clearPresetHighlight();

  if (!supportedTypes.includes(file.type)) {
    showError("Please choose a JPG, PNG, or WebP image.");
    return;
  }

  currentFile = file;

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  currentObjectUrl = URL.createObjectURL(file);

  const image = new Image();

  image.onload = () => {
    originalImage = image;

    aspectRatio =
      image.naturalWidth / image.naturalHeight;

    widthInput.value = String(image.naturalWidth);
    heightInput.value = String(image.naturalHeight);

    imagePreview.src = currentObjectUrl;
    fileName.textContent = file.name;

    originalSize.textContent =
      `Original size: ${image.naturalWidth} × ${image.naturalHeight} px`;

    originalFileSize.textContent =
      `File size: ${formatFileSize(file.size)}`;

    formatSelect.value = "original";
    qualityInput.value = "90";
    qualityValue.textContent = "90%";

    updateQualityVisibility();

    uploadArea.hidden = true;
    editor.hidden = false;
    resultPanel.hidden = true;
  };

  image.onerror = () => {
    showError("This image could not be opened.");
  };

  image.src = currentObjectUrl;
}

function resizeImage() {
  hideError();

  if (!originalImage || !currentFile) {
    showError("Please choose an image first.");
    return;
  }

  const width = Number(widthInput.value);
  const height = Number(heightInput.value);

  const validationMessage = validateDimensions(width, height);

  if (validationMessage) {
    showError(validationMessage);
    return;
  }

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    showError("Your browser could not resize this image.");
    return;
  }

  context.drawImage(
    originalImage,
    0,
    0,
    width,
    height
  );

  const outputType =
    formatSelect.value === "original"
      ? currentFile.type
      : formatSelect.value;

  const quality =
    Number(qualityInput.value) / 100;

  canvas.toBlob(
    (blob) => {
      if (!blob) {
        showError(
          "The resized image could not be created."
        );
        return;
      }

      if (downloadObjectUrl) {
        URL.revokeObjectURL(downloadObjectUrl);
      }

      downloadObjectUrl =
        URL.createObjectURL(blob);

      downloadButton.href =
        downloadObjectUrl;

      downloadButton.download =
        createDownloadName(
          currentFile.name,
          width,
          height,
          outputType
        );

      resultDimensions.textContent =
        `${width} × ${height} px`;

      resultFileSize.textContent =
        `File size: ${formatFileSize(blob.size)}`;

      resultPanel.hidden = false;

      resultPanel.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    },
    outputType,
    quality
  );
}

function validateDimensions(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return "Width and height must be positive whole numbers.";
  }

  if (
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    return `Width and height cannot exceed ${MAX_DIMENSION.toLocaleString()} pixels.`;
  }

  if (width * height > MAX_PIXEL_COUNT) {
    return "The requested image is too large to process safely in the browser. Try smaller dimensions.";
  }

  return "";
}

function createDownloadName(
  originalName,
  width,
  height,
  outputType
) {
  const lastDotIndex =
    originalName.lastIndexOf(".");

  const name =
    lastDotIndex === -1
      ? originalName
      : originalName.slice(0, lastDotIndex);

  const extensionMap = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };

  const extension =
    extensionMap[outputType] ?? "";

  return `${name}-${width}x${height}${extension}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }

  const megabytes =
    kilobytes / 1024;

  return `${megabytes.toFixed(2)} MB`;
}

function updateQualityVisibility() {
  const selectedType =
    formatSelect.value === "original"
      ? currentFile?.type
      : formatSelect.value;

  const supportsQuality =
    selectedType === "image/jpeg" ||
    selectedType === "image/webp";

  qualityControl.hidden =
    !supportsQuality;
}

function highlightPreset(activeButton) {
  presetButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      button === activeButton
    );
  });
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
  aspectRatio = 1;

  imageInput.value = "";
  imagePreview.removeAttribute("src");

  widthInput.value = "";
  heightInput.value = "";

  formatSelect.value = "original";
  qualityInput.value = "90";
  qualityValue.textContent = "90%";

  fileName.textContent = "";
  originalSize.textContent = "";
  originalFileSize.textContent = "";
  resultDimensions.textContent = "";
  resultFileSize.textContent = "";

  editor.hidden = true;
  resultPanel.hidden = true;
  uploadArea.hidden = false;

  clearPresetHighlight();
  updateQualityVisibility();
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
