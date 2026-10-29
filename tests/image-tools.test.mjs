import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext, constants } from "node:vm";
import { fileURLToPath } from "node:url";
import UPNG from "@pdf-lib/upng";
import test from "node:test";

const source = readFileSync(new URL("../src/scripts/image-tools.js", import.meta.url), "utf8");
const markup = readFileSync(new URL("../src/components/ImageTools.astro", import.meta.url), "utf8");
const tabNames = ["resize", "compress", "convert", "metadata"];

function setup({ activeTab = "resize", failImage = false } = {}) {
  function node(dataset = {}) {
    const classes = new Set();
    return {
      dataset, classes, events: {}, attributes: {}, value: "", textContent: "", hidden: false, children: [],
      classList: {
        add: (value) => classes.add(value), remove: (value) => classes.delete(value),
        toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); },
      },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      addEventListener(type, handler) { this.events[type] = handler; },
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
    };
  }
  const nodes = new Map([...markup.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], node()]));
  tabNames.forEach((name) => {
    nodes.get(`${name}Tab`).dataset.tab = name;
    nodes.get(`${name}Panel`).dataset.panel = name;
  });
  nodes.get("workspace").hidden = true;
  const root = Object.assign(node({ activeTab }), {
    querySelector: (selector) => nodes.get(selector.slice(1)),
    querySelectorAll: (selector) => selector === "[data-tab]" ? tabNames.map((name) => nodes.get(`${name}Tab`))
      : selector === "[data-panel]" ? tabNames.map((name) => nodes.get(`${name}Panel`)) : [],
  });
  let urls = 0;
  class PreviewImage {
    naturalWidth = 640;
    naturalHeight = 480;
    set src(value) { queueMicrotask(() => failImage ? this.onerror(new Error("Unreadable image")) : this.onload()); }
  }
  runInNewContext(source, {
    document: { querySelector: () => root, createElement: () => node(), createDocumentFragment: () => node() }, Image: PreviewImage, queueMicrotask,
    URL: { createObjectURL: () => `blob:in-memory-${++urls}`, revokeObjectURL() {} },
    console: { error() {}, warn() {} },
  }, { filename: fileURLToPath(new URL("../src/scripts/image-tools.js", import.meta.url)), importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  function dragEvent(files = [], types = ["Files"]) {
    return { dataTransfer: { files, types }, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
  }
  return { root, nodes, dragEvent, file: { name: "example.jpg", type: "image/jpeg", size: 1024 } };
}

test("initialization selects exactly one tab before any codec is imported", () => {
  const { nodes } = setup({ activeTab: "compress" });
  for (const name of tabNames) {
    assert.equal(nodes.get(`${name}Tab`).classes.has("active"), name === "compress");
    assert.equal(nodes.get(`${name}Tab`).attributes["aria-selected"], String(name === "compress"));
  }
  nodes.get("convertTab").events.click();
  assert.equal(nodes.get("compressTab").attributes["aria-selected"], "false");
  assert.equal(nodes.get("convertTab").attributes["aria-selected"], "true");
});

test("file drops open an image and allow replacing it anywhere in the workspace", async () => {
  const view = setup();
  const over = view.dragEvent();
  view.root.events.dragover(over);
  assert.equal(over.prevented, true);
  assert.equal(over.dataTransfer.dropEffect, "copy");
  await view.root.events.drop(view.dragEvent([view.file]));
  assert.equal(view.nodes.get("workspace").hidden, false);
  assert.equal(view.nodes.get("uploadArea").hidden, true);
  assert.equal(view.nodes.get("fileName").textContent, "example.jpg");
  await view.root.events.drop(view.dragEvent([{ ...view.file, name: "replacement.jpg" }]));
  assert.equal(view.nodes.get("fileName").textContent, "replacement.jpg");
});

test("crossing children keeps the file-drop highlight until the whole workspace is left", () => {
  const view = setup();
  view.root.events.dragenter(view.dragEvent());
  view.root.events.dragenter(view.dragEvent());
  view.root.events.dragleave();
  assert.equal(view.root.classes.has("image-file-dragging"), true);
  view.root.events.dragleave();
  assert.equal(view.root.classes.has("image-file-dragging"), false);
  const internalDrag = view.dragEvent([], ["text/uri-list"]);
  view.root.events.dragover(internalDrag);
  assert.equal(internalDrag.prevented, false);
});

test("file selection still works and invalid files show an error", async () => {
  const view = setup();
  view.nodes.get("imageInput").files = [view.file];
  await view.nodes.get("imageInput").events.change();
  assert.equal(view.nodes.get("fileName").textContent, "example.jpg");
  await view.root.events.drop(view.dragEvent([{ name: "notes.txt", type: "text/plain", size: 10 }]));
  assert.equal(view.nodes.get("errorMessage").hidden, false);
  assert.match(view.nodes.get("errorMessage").textContent, /Please choose/);
});

test("unreadable images restore the upload area without leaving controls locked", async () => {
  const view = setup({ failImage: true });
  await view.root.events.drop(view.dragEvent([view.file]));
  assert.equal(view.nodes.get("workspace").hidden, true);
  assert.equal(view.nodes.get("uploadArea").hidden, false);
  assert.equal(view.nodes.get("chooseImageButton").disabled, false);
  assert.equal(view.nodes.get("errorMessage").hidden, false);
});

function metadataPng(width = 1) {
  const pixels = new Uint8Array(width * 4).fill(255);
  return (UPNG.default || UPNG).encode([pixels.buffer], width, 1, 0);
}

async function settleMetadata(view) {
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setImmediate(resolve));
    if (view.nodes.get("metadataStatus").textContent !== "Reading metadata…") return;
  }
  assert.fail("Metadata reading did not settle");
}

test("the metadata panel displays parsed rows and retries failed reads", async () => {
  const view = setup();
  let attempts = 0;
  const file = { ...view.file, name: "metadata.png", type: "image/png", async arrayBuffer() {
    if (++attempts === 1) throw new Error("Temporary failure");
    return metadataPng();
  } };
  await view.root.events.drop(view.dragEvent([file]));
  view.nodes.get("metadataTab").events.click();
  await settleMetadata(view);
  assert.equal(view.nodes.get("metadataStatus").textContent, "Metadata could not be read");
  assert.match(view.nodes.get("metadataEmpty").textContent, /retry/);
  view.nodes.get("resizeTab").events.click();
  view.nodes.get("metadataTab").events.click();
  await settleMetadata(view);
  assert.equal(attempts, 2);
  assert.match(view.nodes.get("metadataStatus").textContent, /fields? found/);
  assert.equal(view.nodes.get("metadataEmpty").hidden, true);
  assert.ok(view.nodes.get("metadataTable").children[0].children.length > 0);
});

test("a slow metadata read cannot overwrite a replacement image's metadata", async () => {
  const view = setup();
  const pending = Promise.withResolvers();
  await view.root.events.drop(view.dragEvent([{ ...view.file, arrayBuffer: () => pending.promise }]));
  view.nodes.get("metadataTab").events.click();
  await new Promise((resolve) => setImmediate(resolve));
  await view.root.events.drop(view.dragEvent([{ ...view.file, name: "new.png", type: "image/png", arrayBuffer: async () => metadataPng(2) }]));
  await settleMetadata(view);
  pending.resolve(metadataPng(1));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const values = view.nodes.get("metadataTable").children[0].children.map((row) => row.children[1].textContent);
  assert.equal(view.nodes.get("metadataFileName").textContent, "new.png");
  assert.ok(values.includes("2px"));
  assert.equal(values.filter((value) => value === "1px").length, 2, "Only the new image height should be 1px in the two PNG tag groups");
});
