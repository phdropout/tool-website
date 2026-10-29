import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../src/scripts/theme.js", import.meta.url), "utf8");
function setup({ saved = null, systemDark = false, storageBlocked = false } = {}) {
  const documentEvents = {};
  const windowEvents = {};
  const buttonEvents = {};
  const attributes = {};
  const writes = [];
  let ready = false;
  let systemChange;
  const system = { matches: systemDark, addEventListener(type, handler) { systemChange = handler; } };
  const document = {
    documentElement: { dataset: {} },
    querySelector: () => ready ? { setAttribute(name, value) { attributes[name] = value; }, addEventListener(type, handler) { buttonEvents[type] = handler; } } : null,
    addEventListener(type, handler) { documentEvents[type] = handler; },
  };
  runInNewContext(source, {
    document,
    window: { matchMedia: () => system, addEventListener(type, handler) { windowEvents[type] = handler; } },
    localStorage: {
      getItem() { if (storageBlocked) throw new Error("blocked"); return saved; },
      setItem(key, value) { if (storageBlocked) throw new Error("blocked"); writes.push([key, value]); },
    },
  });
  return {
    theme: () => document.documentElement.dataset.theme,
    ready() { ready = true; documentEvents.DOMContentLoaded(); },
    click: () => buttonEvents.click(),
    changeSystem(value) { system.matches = value; systemChange(); },
    storage(value) { windowEvents.storage({ key: "tool-website-theme", newValue: value }); },
    attributes, writes,
  };
}

test("system theme applies before the page header exists and follows system changes", () => {
  const theme = setup({ systemDark: true });
  assert.equal(theme.theme(), "dark");
  theme.ready();
  assert.equal(theme.attributes["aria-label"], "Switch to light mode");
  theme.changeSystem(false);
  assert.equal(theme.theme(), "light");
});

test("a saved choice overrides the system and toggling persists the new choice", () => {
  const theme = setup({ saved: "light", systemDark: true });
  assert.equal(theme.theme(), "light");
  theme.ready();
  theme.click();
  assert.equal(theme.theme(), "dark");
  assert.deepEqual(theme.writes, [["tool-website-theme", "dark"]]);
  assert.equal(theme.attributes["aria-pressed"], "true");
  theme.changeSystem(false);
  assert.equal(theme.theme(), "dark");
});

test("storage restrictions do not break the theme toggle", () => {
  const theme = setup({ storageBlocked: true });
  theme.ready();
  theme.click();
  assert.equal(theme.theme(), "dark");
  theme.click();
  assert.equal(theme.theme(), "light");
});

test("invalid saved preferences use the system and other tabs can update the choice", () => {
  const theme = setup({ saved: "unknown", systemDark: true });
  theme.ready();
  assert.equal(theme.theme(), "dark");
  theme.storage("light");
  assert.equal(theme.theme(), "light");
  theme.storage(null);
  assert.equal(theme.theme(), "dark");
});

test("both palettes keep normal text and filled buttons readable", () => {
  const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
  const luminance = (hex) => {
    const expanded = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return expanded.match(/../g).map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  for (const selector of [":root", ':root[data-theme="dark"]']) {
    const block = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    const tokens = Object.fromEntries([...block.matchAll(/--site-([\w-]+): #([\da-f]+);/g)].map((match) => [match[1], luminance(match[2])]));
    for (const surface of ["surface", "surface-soft", "background", "tint"]) {
      assert.ok(contrast(tokens.muted, tokens[surface]) >= 4.5, `${selector}: muted text on ${surface}`);
      assert.ok(contrast(tokens.ink, tokens[surface]) >= 4.5, `${selector}: primary text on ${surface}`);
    }
    assert.ok(contrast(tokens["button-text"], tokens.button) >= 4.5, `${selector}: button`);
    assert.ok(contrast(tokens["button-text"], tokens["button-hover"]) >= 4.5, `${selector}: button hover`);
  }
});
