import UPNG from "@pdf-lib/upng";
import libheif from "libheif-js";
import ExifReader from "exifreader";

const root = document.querySelector("[data-image-tools]");

if (root) {
  initializeImageTools(root);
}

function initializeImageTools(root) {
  const tabButtons = [...root.querySelectorAll("[data-tab]")];
  const tabPanels = [...root.querySelectorAll("[data-panel]")];

  const imageInput = root.querySelector("#imageInput");
  const chooseImageButton = root.querySelector("#chooseImageButton");
  const uploadArea = root.querySelector("#uploadArea");
  const workspace = root.querySelector("#workspace");
  const imagePreview = root.querySelector("#imagePreview");
  const fileName = root.querySelector("#fileName");
  const originalSize = root.querySelector("#originalSize");
  const originalFileSize = root.querySelector("#originalFileSize");
  const resetButton = root.querySelector("#resetButton");
  const errorMessage = root.querySelector("#errorMessage");

  const widthInput = root.querySelector("#widthInput");
  const heightInput = root.querySelector("#heightInput");
  const lockAspectRatio = root.querySelector("#lockAspectRatio");
  const resizeFormatSelect = root.querySelector("#resizeFormatSelect");
  const resizeQualityInput = root.querySelector("#resizeQualityInput");
  const resizeQualityValue = root.querySelector("#resizeQualityValue");
  const resizePngNotice = root.querySelector("#resizePngNotice");
  const resizeButton = root.querySelector("#resizeButton");
  const resizePresetButtons = [...root.querySelectorAll("[data-resize-scale]")];

  const compressFormatSelect = root.querySelector("#compressFormatSelect");
  const compressQualityInput = root.querySelector("#compressQualityInput");
  const compressQualityValue = root.querySelector("#compressQualityValue");
  const compressQualityLabel = root.querySelector("#compressQualityLabel");
  const compressQualityNote = root.querySelector("#compressQualityNote");
  const compressPngNotice = root.querySelector("#compressPngNotice");
  const compressHeicNotice = root.querySelector("#compressHeicNotice");
  const compressButton = root.querySelector("#compressButton");
  const compressPresetButtons = [...root.querySelectorAll("[data-compress-quality]")];

  const convertFormatSelect = root.querySelector("#convertFormatSelect");
  const convertQualityInput = root.querySelector("#convertQualityInput");
  const convertQualityValue = root.querySelector("#convertQualityValue");
  const convertQualityControl = root.querySelector("#convertQualityControl");
  const convertFormatNote = root.querySelector("#convertFormatNote");
  const convertButton = root.querySelector("#convertButton");

  const metadataFileName = root.querySelector("#metadataFileName");
  const metadataFormat = root.querySelector("#metadataFormat");
  const metadataFileSize = root.querySelector("#metadataFileSize");
  const metadataDimensions = root.querySelector("#metadataDimensions");
  const metadataAspectRatio = root.querySelector("#metadataAspectRatio");
  const metadataLastModified = root.querySelector("#metadataLastModified");
  const metadataStatus = root.querySelector("#metadataStatus");
  const metadataTable = root.querySelector("#metadataTable");
  const metadataEmpty = root.querySelector("#metadataEmpty");

  const resultPanel = root.querySelector("#resultPanel");
  const resultTitle = root.querySelector("#resultTitle");
  const resultDimensions = root.querySelector("#resultDimensions");
  const resultOriginalSize = root.querySelector("#resultOriginalSize");
  const resultOutputSize = root.querySelector("#resultOutputSize");
  const resultChange = root.querySelector("#resultChange");
  const resultNote = root.querySelector("#resultNote");
  const downloadButton = root.querySelector("#downloadButton");

  let originalImage = null;
  let currentFile = null;
  let currentSourceType = null;
  let currentPreviewUrl = null;
  let currentDownloadUrl = null;
  let activeTab = root.dataset.activeTab || "resize";
  let aspectRatio = 1;
  let editingDimension = false;
  let metadataLoadedForFile = null;

  const MAX_DIMENSION = 12000;
  const MAX_PIXEL_COUNT = 100_000_000;

  const browserReadableTypes = ["image/jpeg", "image/png", "image/webp"];
  const heicTypes = [
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
  ];

  activateTab(activeTab);

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.tab);
      hideResult();
      hideError();
    });
  });

  chooseImageButton.addEventListener("click", () => imageInput.click());

  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (file) loadImage(file);
  });

  uploadArea.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadArea.classList.add("dragging");
  });

  uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("dragging");
  });

  uploadArea.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadArea.classList.remove("dragging");

    const file = event.dataTransfer?.files?.[0];
    if (file) loadImage(file);
  });

  resetButton.addEventListener("click", resetTool);

  resizePresetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!originalImage) return;

      const scale = Number(button.dataset.resizeScale);
      widthInput.value = String(Math.max(1, Math.round(originalImage.naturalWidth * scale)));
      heightInput.value = String(Math.max(1, Math.round(originalImage.naturalHeight * scale)));
      setActiveResizePreset(button);
      hideResult();
    });
  });

  widthInput.addEventListener("input", () => {
    if (editingDimension || !originalImage) return;
    clearResizePresets();

    if (lockAspectRatio.checked && Number(widthInput.value) > 0) {
      editingDimension = true;
      heightInput.value = String(Math.max(1, Math.round(Number(widthInput.value) / aspectRatio)));
      editingDimension = false;
    }

    hideResult();
  });

  heightInput.addEventListener("input", () => {
    if (editingDimension || !originalImage) return;
    clearResizePresets();

    if (lockAspectRatio.checked && Number(heightInput.value) > 0) {
      editingDimension = true;
      widthInput.value = String(Math.max(1, Math.round(Number(heightInput.value) * aspectRatio)));
      editingDimension = false;
    }

    hideResult();
  });

  resizeFormatSelect.addEventListener("change", () => {
    updateResizeControls();
    hideResult();
  });

  resizeQualityInput.addEventListener("input", () => {
    resizeQualityValue.textContent = `${resizeQualityInput.value}%`;
    hideResult();
  });

  compressPresetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const quality = Number(button.dataset.compressQuality);
      compressQualityInput.value = String(quality);
      compressQualityValue.textContent = `${quality}%`;
      setActiveCompressPreset(button);
      updateCompressControls();
      hideResult();
    });
  });

  compressQualityInput.addEventListener("input", () => {
    compressQualityValue.textContent = `${compressQualityInput.value}%`;
    clearCompressPresets();
    updateCompressControls();
    hideResult();
  });

  compressFormatSelect.addEventListener("change", () => {
    updateCompressControls();
    hideResult();
  });

  convertFormatSelect.addEventListener("change", () => {
    updateConvertControls();
    hideResult();
  });

  convertQualityInput.addEventListener("input", () => {
    convertQualityValue.textContent = `${convertQualityInput.value}%`;
    hideResult();
  });

  resizeButton.addEventListener("click", resizeImage);
  compressButton.addEventListener("click", compressImage);
  convertButton.addEventListener("click", convertImage);

  function activateTab(tabName) {
    activeTab = ["resize", "compress", "convert", "metadata"].includes(tabName)
      ? tabName
      : "resize";

    tabButtons.forEach((button) => {
      const isActive = button.dataset.tab === activeTab;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });

    tabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== activeTab;
    });

    if (activeTab === "compress" && currentFile && isHeicType(currentSourceType)) {
      showError(
        "HEIC and HEIF files are handled in the Convert tab because converting them can increase file size."
      );
    }

    if (activeTab === "metadata" && currentFile) {
      populateMetadata();
    }
  }

  async function loadImage(file) {
    hideError();
    hideResult();

    const sourceType = getSourceType(file);

    if (!sourceType) {
      showError("Please choose a JPG, PNG, WebP, HEIC, or HEIF image.");
      return;
    }

    currentFile = file;
    currentSourceType = sourceType;
    metadataLoadedForFile = null;

    revokePreviewUrl();
    revokeDownloadUrl();

    try {
      let previewBlob = file;

      if (isHeicType(sourceType)) {
        chooseImageButton.disabled = true;
        chooseImageButton.textContent = "Opening HEIC…";
        previewBlob = await decodeHeicToPng(file);
      }

      currentPreviewUrl = URL.createObjectURL(previewBlob);
      await setPreviewImage(currentPreviewUrl, file);

      uploadArea.hidden = true;
      workspace.hidden = false;

      initializeControlsForImage();

      if (activeTab === "metadata") {
        populateMetadata();
      }
    } catch (error) {
      console.error(error);
      currentFile = null;
      currentSourceType = null;
      originalImage = null;
      revokePreviewUrl();

      showError(
        isHeicType(sourceType)
          ? "This HEIC or HEIF image could not be opened. Try another file."
          : "This image could not be opened. Try another file."
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

    if (image.naturalWidth * image.naturalHeight > MAX_PIXEL_COUNT) {
      throw new Error("Image exceeds the safe pixel limit.");
    }

    originalImage = image;
    aspectRatio = image.naturalWidth / image.naturalHeight;

    imagePreview.src = objectUrl;
    fileName.textContent = file.name;
    originalSize.textContent = `Original size: ${image.naturalWidth} × ${image.naturalHeight} px`;
    originalFileSize.textContent = `File size: ${formatFileSize(file.size)}`;
  }

  function initializeControlsForImage() {
    widthInput.value = String(originalImage.naturalWidth);
    heightInput.value = String(originalImage.naturalHeight);
    lockAspectRatio.checked = true;
    setResizePresetByScale(1);

    resizeFormatSelect.value = isHeicType(currentSourceType)
      ? "image/jpeg"
      : "original";
    resizeQualityInput.value = "90";
    resizeQualityValue.textContent = "90%";

    compressFormatSelect.value = "original";
    compressQualityInput.value = "75";
    compressQualityValue.textContent = "75%";
    setCompressPresetByQuality(75);

    setDefaultConvertFormat();
    convertQualityInput.value = "90";
    convertQualityValue.textContent = "90%";

    updateResizeControls();
    updateCompressControls();
    updateConvertControls();
  }

  function setDefaultConvertFormat() {
    if (currentSourceType === "image/jpeg") {
      convertFormatSelect.value = "image/webp";
    } else if (currentSourceType === "image/png") {
      convertFormatSelect.value = "image/webp";
    } else {
      convertFormatSelect.value = "image/jpeg";
    }
  }

  async function resizeImage() {
    if (!ensureImageLoaded()) return;

    const width = Number(widthInput.value);
    const height = Number(heightInput.value);

    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      showError("Enter valid width and height values.");
      return;
    }

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      showError(`Maximum output dimension is ${MAX_DIMENSION.toLocaleString()} px per side.`);
      return;
    }

    const outputType = resolveOutputType(resizeFormatSelect.value);
    const quality = Number(resizeQualityInput.value);

    await runOperation(
      resizeButton,
      "Resizing…",
      "Resize image",
      async () => encodeImage(width, height, outputType, quality),
      {
        title: "Your resized image is ready",
        width,
        height,
        outputType,
        suffix: "resized",
      }
    );
  }

  async function compressImage() {
    if (!ensureImageLoaded()) return;

    if (isHeicType(currentSourceType)) {
      showError(
        "HEIC and HEIF files are handled in the Convert tab because converting them can increase file size."
      );
      return;
    }

    const width = originalImage.naturalWidth;
    const height = originalImage.naturalHeight;
    const outputType = resolveOutputType(compressFormatSelect.value);
    const quality = Number(compressQualityInput.value);

    await runOperation(
      compressButton,
      "Compressing…",
      "Compress image",
      async () => encodeImage(width, height, outputType, quality),
      {
        title: "Your compressed image is ready",
        width,
        height,
        outputType,
        suffix: "compressed",
      }
    );
  }

  async function convertImage() {
    if (!ensureImageLoaded()) return;

    const width = originalImage.naturalWidth;
    const height = originalImage.naturalHeight;
    const outputType = convertFormatSelect.value;
    const quality = Number(convertQualityInput.value);

    await runOperation(
      convertButton,
      "Converting…",
      "Convert image",
      async () => encodeImage(width, height, outputType, quality),
      {
        title: "Your converted image is ready",
        width,
        height,
        outputType,
        suffix: "converted",
      }
    );
  }

  async function runOperation(button, busyText, idleText, operation, resultMeta) {
    hideError();
    button.disabled = true;
    button.textContent = busyText;

    try {
      const blob = await operation();

      if (!blob) throw new Error("No output image was created.");

      showResult(blob, resultMeta);
    } catch (error) {
      console.error(error);
      showError("The image could not be processed. Try another setting or image.");
    } finally {
      button.disabled = false;
      button.textContent = idleText;
    }
  }

  async function encodeImage(width, height, outputType, qualityPercent) {
    if (outputType === "image/png") {
      return encodePng(width, height, qualityPercent);
    }

    return encodeCanvasImage(width, height, outputType, qualityPercent / 100);
  }

  function encodePng(width, height, qualityPercent) {
    const canvas = drawImageToCanvas(width, height, "image/png");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const imageData = context.getImageData(0, 0, width, height);
    const rgba = new Uint8Array(imageData.data);
    const colorCount = pngColorCountFromQuality(qualityPercent);

    const encoded = UPNG.encode([rgba.buffer], width, height, colorCount);

    return new Blob([encoded], { type: "image/png" });
  }

  function pngColorCountFromQuality(qualityPercent) {
    if (qualityPercent >= 100) return 0;

    const minimumColors = 16;
    const maximumColors = 256;
    const normalized = Math.max(0, Math.min(1, qualityPercent / 100));

    const colors = Math.round(
      minimumColors * Math.pow(maximumColors / minimumColors, normalized)
    );

    return Math.max(minimumColors, Math.min(maximumColors, colors));
  }

  function encodeCanvasImage(width, height, outputType, quality) {
    const canvas = drawImageToCanvas(width, height, outputType);

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

  function drawImageToCanvas(width, height, outputType) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", {
      willReadFrequently: outputType === "image/png",
    });

    if (!context) throw new Error("Canvas is not available.");

    if (outputType === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }

    context.drawImage(originalImage, 0, 0, width, height);
    return canvas;
  }

  async function decodeHeicToPng(file) {
    const arrayBuffer = await file.arrayBuffer();
    const decoder = new libheif.HeifDecoder();
    const decodedImages = decoder.decode(new Uint8Array(arrayBuffer));

    if (!decodedImages?.length) {
      throw new Error("No image found in HEIC/HEIF file.");
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

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is not available.");

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

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("HEIC preview encoding failed."));
          return;
        }
        resolve(blob);
      }, "image/png");
    });
  }

  function updateResizeControls() {
    if (!currentFile) return;

    const outputType = resolveOutputType(resizeFormatSelect.value);
    const isPng = outputType === "image/png";

    resizePngNotice.hidden = !isPng;
  }

  function updateCompressControls() {
    if (!currentFile) return;

    const outputType = resolveOutputType(compressFormatSelect.value);
    const quality = Number(compressQualityInput.value);
    const isPng = outputType === "image/png";
    const isHeic = isHeicType(currentSourceType);

    compressQualityLabel.textContent = isPng ? "PNG quality" : "Quality";
    compressPngNotice.hidden = !isPng;
    compressHeicNotice.hidden = !isHeic;
    compressButton.disabled = isHeic;

    if (isPng) {
      if (quality >= 100) {
        compressQualityNote.textContent = "Lossless PNG optimization with no color reduction.";
        compressPngNotice.textContent =
          "At 100%, PNG stays lossless. Lower settings reduce the color palette for a smaller file.";
      } else {
        compressQualityNote.textContent =
          quality >= 75
            ? "Balanced PNG palette reduction."
            : "Stronger PNG palette reduction; visible color loss is more likely.";

        compressPngNotice.textContent =
          `PNG output will use about ${pngColorCountFromQuality(quality)} colors. Transparency is preserved.`;
      }
      return;
    }

    if (quality >= 86) {
      compressQualityNote.textContent = "Higher visual quality with lighter compression.";
    } else if (quality >= 66) {
      compressQualityNote.textContent = "Balanced file size and visual quality.";
    } else if (quality >= 41) {
      compressQualityNote.textContent = "Smaller file with more visible quality loss possible.";
    } else {
      compressQualityNote.textContent = "Maximum size reduction with noticeable quality loss possible.";
    }
  }

  function updateConvertControls() {
    const outputType = convertFormatSelect.value;
    const isPng = outputType === "image/png";

    convertQualityControl.hidden = isPng;

    if (!currentFile) return;

    const sourceLabel = getFormatLabel(currentSourceType);
    const outputLabel = getFormatLabel(outputType);

    if (currentSourceType === outputType) {
      convertFormatNote.textContent =
        `${sourceLabel} is already the selected format. Choose another format to perform a conversion.`;
    } else if (isHeicType(currentSourceType)) {
      convertFormatNote.textContent =
        `Convert ${sourceLabel} to ${outputLabel}. The HEIC/HEIF file is decoded locally in your browser.`;
    } else {
      convertFormatNote.textContent = `Convert ${sourceLabel} to ${outputLabel}.`;
    }
  }


  async function populateMetadata() {
    if (!currentFile || !originalImage) return;

    populateBasicMetadata();

    if (metadataLoadedForFile === currentFile) {
      return;
    }

    metadataStatus.textContent = "Reading metadata…";
    metadataTable.replaceChildren();
    metadataEmpty.hidden = true;

    try {
      const tags = await ExifReader.load(currentFile, {
        expanded: true,
      });

      const rows = collectMetadataRows(tags);

      metadataTable.replaceChildren();

      if (rows.length === 0) {
        metadataEmpty.hidden = false;
        metadataStatus.textContent = "No embedded metadata found";
      } else {
        metadataEmpty.hidden = true;
        metadataStatus.textContent = `${rows.length} field${rows.length === 1 ? "" : "s"} found`;

        const fragment = document.createDocumentFragment();

        rows.forEach(({ key, value }) => {
          const row = document.createElement("div");
          row.className = "metadata-row";

          const keyElement = document.createElement("div");
          keyElement.className = "metadata-key";
          keyElement.textContent = key;

          const valueElement = document.createElement("div");
          valueElement.className = "metadata-value";
          valueElement.textContent = value;

          row.append(keyElement, valueElement);
          fragment.appendChild(row);
        });

        metadataTable.appendChild(fragment);
      }

      metadataLoadedForFile = currentFile;
    } catch (error) {
      console.warn("Metadata could not be read:", error);
      metadataTable.replaceChildren();
      metadataEmpty.hidden = false;
      metadataEmpty.textContent =
        "No readable embedded metadata was found in this image.";
      metadataStatus.textContent = "Metadata unavailable";
      metadataLoadedForFile = currentFile;
    }
  }

  function populateBasicMetadata() {
    metadataFileName.textContent = currentFile.name;
    metadataFormat.textContent = getFormatLabel(currentSourceType);
    metadataFileSize.textContent = formatFileSize(currentFile.size);
    metadataDimensions.textContent =
      `${originalImage.naturalWidth} × ${originalImage.naturalHeight} px`;
    metadataAspectRatio.textContent =
      formatAspectRatio(originalImage.naturalWidth, originalImage.naturalHeight);

    metadataLastModified.textContent = currentFile.lastModified
      ? new Date(currentFile.lastModified).toLocaleString()
      : "Unknown";
  }

  function collectMetadataRows(tags) {
    const preferredLabels = {
      Make: "Camera maker",
      Model: "Camera model",
      LensModel: "Lens",
      DateTimeOriginal: "Date taken",
      CreateDate: "Created",
      ModifyDate: "Modified",
      ExposureTime: "Exposure time",
      FNumber: "Aperture",
      ISOSpeedRatings: "ISO",
      PhotographicSensitivity: "ISO",
      FocalLength: "Focal length",
      Orientation: "Orientation",
      Software: "Software",
      Artist: "Artist",
      Copyright: "Copyright",
      Latitude: "GPS latitude",
      Longitude: "GPS longitude",
      Altitude: "GPS altitude",
    };

    const ignoredKeys = new Set([
      "Thumbnail",
      "MakerNote",
      "UserComment",
      "_raw",
      "metadataRange",
    ]);

    const rows = [];
    const seen = new Set();

    function walk(value, path = []) {
      if (!value || typeof value !== "object") return;

      for (const [key, child] of Object.entries(value)) {
        if (ignoredKeys.has(key)) continue;

        const nextPath = [...path, key];

        if (child && typeof child === "object" && "description" in child) {
          const description = normalizeMetadataValue(child.description);

          if (!description) continue;

          const simpleKey = key;
          const label =
            preferredLabels[simpleKey] ||
            humanizeMetadataKey(nextPath.join(" · "));

          const dedupeKey = `${label}:${description}`;
          if (seen.has(dedupeKey)) continue;

          seen.add(dedupeKey);
          rows.push({ key: label, value: description });
        } else if (
          child &&
          typeof child === "object" &&
          !Array.isArray(child)
        ) {
          walk(child, nextPath);
        }
      }
    }

    walk(tags);

    const priority = [
      "Camera maker",
      "Camera model",
      "Lens",
      "Date taken",
      "Exposure time",
      "Aperture",
      "ISO",
      "Focal length",
      "Orientation",
      "GPS latitude",
      "GPS longitude",
      "GPS altitude",
      "Software",
    ];

    rows.sort((a, b) => {
      const ai = priority.indexOf(a.key);
      const bi = priority.indexOf(b.key);

      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }

      return a.key.localeCompare(b.key);
    });

    return rows.slice(0, 80);
  }

  function normalizeMetadataValue(value) {
    if (value === null || value === undefined) return "";

    if (Array.isArray(value)) {
      return value.map(normalizeMetadataValue).filter(Boolean).join(", ");
    }

    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }

    const text = String(value).trim();

    if (!text || text === "[object Object]") return "";
    if (text.length > 1000) return `${text.slice(0, 1000)}…`;

    return text;
  }

  function humanizeMetadataKey(key) {
    return key
      .replace(/[._]/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatAspectRatio(width, height) {
    const divisor = greatestCommonDivisor(width, height);

    const ratioWidth = Math.round(width / divisor);
    const ratioHeight = Math.round(height / divisor);

    if (ratioWidth <= 100 && ratioHeight <= 100) {
      return `${ratioWidth}:${ratioHeight}`;
    }

    return `${(width / height).toFixed(2)}:1`;
  }

  function greatestCommonDivisor(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);

    while (y) {
      const temp = y;
      y = x % y;
      x = temp;
    }

    return x || 1;
  }

  function showResult(blob, meta) {
    revokeDownloadUrl();
    currentDownloadUrl = URL.createObjectURL(blob);

    downloadButton.href = currentDownloadUrl;
    downloadButton.download = createDownloadName(currentFile.name, meta.outputType, meta.suffix);

    const change = calculateSizeChange(currentFile.size, blob.size);

    resultTitle.textContent = meta.title;
    resultDimensions.textContent = `${meta.width} × ${meta.height} px`;
    resultOriginalSize.textContent = formatFileSize(currentFile.size);
    resultOutputSize.textContent = formatFileSize(blob.size);
    resultChange.textContent = change.label;
    resultNote.textContent = change.note;

    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function calculateSizeChange(originalBytes, outputBytes) {
    if (!originalBytes) {
      return { label: "N/A", note: "The file-size change could not be calculated." };
    }

    const difference = originalBytes - outputBytes;
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
        note: "The output is larger than the original. This can happen when changing formats or using higher-quality settings.",
      };
    }

    return { label: "No change", note: "The output file is the same size as the original." };
  }

  function resolveOutputType(selectValue) {
    if (selectValue !== "original") return selectValue;
    return isHeicType(currentSourceType) ? "image/jpeg" : currentSourceType;
  }

  function ensureImageLoaded() {
    if (originalImage && currentFile) return true;
    showError("Please choose an image first.");
    return false;
  }

  function getSourceType(file) {
    const mimeType = (file.type || "").toLowerCase();

    if (browserReadableTypes.includes(mimeType) || heicTypes.includes(mimeType)) {
      return mimeType;
    }

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
    if (lowerName.endsWith(".png")) return "image/png";
    if (lowerName.endsWith(".webp")) return "image/webp";
    if (lowerName.endsWith(".heic")) return "image/heic";
    if (lowerName.endsWith(".heif")) return "image/heif";

    return null;
  }

  function isHeicType(type) {
    return Boolean(type && heicTypes.includes(type));
  }

  function getFormatLabel(type) {
    const labels = {
      "image/jpeg": "JPG",
      "image/png": "PNG",
      "image/webp": "WebP",
      "image/heic": "HEIC",
      "image/heif": "HEIF",
      "image/heic-sequence": "HEIC",
      "image/heif-sequence": "HEIF",
    };

    return labels[type] || "image";
  }

  function createDownloadName(originalName, outputType, suffix) {
    const lastDotIndex = originalName.lastIndexOf(".");
    const name = lastDotIndex === -1 ? originalName : originalName.slice(0, lastDotIndex);

    const extensions = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
    };

    return `${name}-${suffix}${extensions[outputType] || ""}`;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;

    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;

    return `${(kb / 1024).toFixed(2)} MB`;
  }

  function setActiveResizePreset(activeButton) {
    resizePresetButtons.forEach((button) => {
      button.classList.toggle("active", button === activeButton);
    });
  }

  function clearResizePresets() {
    resizePresetButtons.forEach((button) => button.classList.remove("active"));
  }

  function setResizePresetByScale(scale) {
    const match = resizePresetButtons.find(
      (button) => Number(button.dataset.resizeScale) === scale
    );

    if (match) setActiveResizePreset(match);
    else clearResizePresets();
  }

  function setActiveCompressPreset(activeButton) {
    compressPresetButtons.forEach((button) => {
      button.classList.toggle("active", button === activeButton);
    });
  }

  function clearCompressPresets() {
    compressPresetButtons.forEach((button) => button.classList.remove("active"));
  }

  function setCompressPresetByQuality(quality) {
    const match = compressPresetButtons.find(
      (button) => Number(button.dataset.compressQuality) === quality
    );

    if (match) setActiveCompressPreset(match);
    else clearCompressPresets();
  }

  function hideResult() {
    resultPanel.hidden = true;
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  }

  function hideError() {
    errorMessage.textContent = "";
    errorMessage.hidden = true;
  }

  function revokePreviewUrl() {
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
    }
  }

  function revokeDownloadUrl() {
    if (currentDownloadUrl) {
      URL.revokeObjectURL(currentDownloadUrl);
      currentDownloadUrl = null;
    }
  }

  function resetTool() {
    revokePreviewUrl();
    revokeDownloadUrl();

    originalImage = null;
    currentFile = null;
    currentSourceType = null;
    metadataLoadedForFile = null;

    imageInput.value = "";
    imagePreview.removeAttribute("src");
    fileName.textContent = "";
    originalSize.textContent = "";
    originalFileSize.textContent = "";

    metadataFileName.textContent = "—";
    metadataFormat.textContent = "—";
    metadataFileSize.textContent = "—";
    metadataDimensions.textContent = "—";
    metadataAspectRatio.textContent = "—";
    metadataLastModified.textContent = "—";
    metadataStatus.textContent = "Choose an image";
    metadataTable.replaceChildren();
    metadataEmpty.hidden = true;

    workspace.hidden = true;
    uploadArea.hidden = false;
    hideResult();
    hideError();
  }
}
