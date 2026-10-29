import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

let version = 0;
async function setup(t, folderSupported = true) {
  class Element {
    constructor(tag = "div") {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {}; this.events = {};
      this.value = ""; this.textContent = ""; this.hidden = false; this.files = []; this.attributes = {};
      this.clientWidth = 800; this.clientHeight = 600; this.scrollWidth = 800; this.scrollHeight = 600; this.scrollTop = 0; this.scrollLeft = 0;
      const classes = new Set();
      this.classList = { add: (v) => classes.add(v), remove: (v) => classes.delete(v), toggle(v, enabled) { if (enabled) classes.add(v); else classes.delete(v); } };
    }
    addEventListener(type, fn) { (this.events[type] ??= []).push(fn); }
    emit(type, properties = {}) { for (const fn of this.events[type] || []) fn({ type, target: this, preventDefault() {}, ...properties }); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    querySelectorAll(tag) { return this.children.flatMap((child) => [...(child.tagName === tag.toUpperCase() ? [child] : []), ...child.querySelectorAll(tag)]); }
    querySelector(tag) { return this.querySelectorAll(tag)[0] || null; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    closest(selectors) { return selectors.split(",").some((s) => s.trim().toUpperCase() === this.tagName) ? this : null; }
    focus() {}
    scrollIntoView() {}
    hasPointerCapture() { return false; }
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; this.emit("close"); } }
    pause() { this.paused = true; }
    load() { this.loadCalls = (this.loadCalls || 0) + 1; }
  }
  const markup = readFileSync(new URL("../src/components/MediaViewer.astro", import.meta.url), "utf8");
  const fields = new Map([...markup.matchAll(/data-([\w-]+)/g)].map((match) => [match[1], new Element()]));
  fields.get("search").type = "search";
  if (folderSupported) fields.get("directory-input").webkitdirectory = true;
  const root = new Element();
  root.querySelector = (selector) => fields.get(selector.slice(6, -1));
  root.querySelectorAll = (selector) => [fields.get(selector.slice(6, -1))].filter(Boolean);
  const doc = new Element();
  doc.querySelector = () => root;
  doc.createElement = (tag) => new Element(tag);
  doc.fullscreenElement = null;
  const win = new Element();
  const created = [], revoked = [];
  const original = new Map();
  const mocks = {
    document: doc, window: win,
    Image: class extends Element {
      constructor() { super("img"); this.naturalWidth = 800; this.naturalHeight = 600; this.complete = true; }
      set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
    },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
    Option: class extends Element { constructor(text, value) { super("option"); this.textContent = text; this.value = value; } },
  };
  for (const [key, value] of Object.entries(mocks)) { original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = (file) => { const url = `blob:synthetic-${created.length}`; created.push({ file, url }); return url; };
  URL.revokeObjectURL = (url) => revoked.push(url);
  t.after(() => {
    win.emit("pagehide");
    URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  await import(`../src/scripts/media-viewer.js?test=${version++}`);
  const get = (key) => fields.get(key);
  return {
    get, created, revoked,
    select(files) { get("file-input").files = files; get("file-input").emit("change"); },
    click(key) { get(key).emit("click"); },
    cards: () => get("gallery").querySelectorAll("button"),
  };
}
const file = (name, type = "image/jpeg") => ({ name, type, size: 100, lastModified: 1 });

test("viewer opens photos and videos, handles playback errors, and releases media on navigation and close", async (t) => {
  const app = await setup(t);
  app.select([file("a.jpg"), file("b.mp4", "video/mp4"), file("c.jpg"), file("notes.txt", "text/plain")]);
  assert.equal(app.cards().length, 3);
  assert.match(app.get("summary").textContent, /2 photos · 1 video · 1/);
  app.cards()[0].emit("click");
  await Promise.resolve();
  assert.equal(app.get("viewer").open, true);
  assert.equal(app.get("stage").children[0].tagName, "IMG");
  app.click("slideshow");
  assert.equal(app.get("slideshow").attributes["aria-pressed"], "true");
  app.click("next");
  const video = app.get("stage").children[0];
  assert.equal(video.tagName, "VIDEO");
  assert.equal(video.controls, true);
  assert.equal(app.get("slideshow").attributes["aria-pressed"], "false");
  video.emit("error");
  assert.match(app.get("viewer-message").textContent, /format or codec/);
  app.click("previous");
  await Promise.resolve();
  assert.equal(video.paused, true);
  assert.equal(video.loadCalls, 1);
  app.click("close");
  assert.equal(app.get("viewer").open, false);
  assert.equal(app.get("stage").children.length, 0);
  assert.deepEqual(app.revoked, app.created.map((entry) => entry.url));
});

test("gallery pagination and live search only render the current matching page", async (t) => {
  const app = await setup(t);
  app.select(Array.from({ length: 63 }, (_, index) => file(`photo${index}.jpg`)));
  assert.equal(app.cards().length, 60);
  app.click("gallery-next");
  assert.equal(app.cards().length, 3);
  app.get("search").value = "photo62"; app.get("search").emit("input");
  assert.equal(app.cards().length, 1);
  assert.equal(app.get("gallery-page").textContent, "Page 1 of 1");
  app.get("search").value = "missing"; app.get("search").emit("input");
  assert.equal(app.cards().length, 0);
  assert.equal(app.get("no-results").hidden, false);
});

test("unsupported folder selection offers files instead, and unrelated files are skipped", async (t) => {
  const app = await setup(t, false);
  assert.equal(app.get("choose-folder").hidden, true);
  assert.match(app.get("status").textContent, /individual files/);
  app.select([file("notes.pdf", "application/pdf")]);
  assert.equal(app.cards().length, 0);
  assert.equal(app.get("library").hidden, true);
  assert.match(app.get("status").textContent, /No recognized/);
});
