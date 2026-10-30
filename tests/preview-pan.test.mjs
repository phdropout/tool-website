import assert from "node:assert/strict";
import test from "node:test";
import { attachPreviewPan } from "../src/scripts/preview-pan.js";

function setup(overflow = true, options = {}) {
  const handlers = new Map();
  const classes = new Set();
  const captured = new Set();
  const stage = {
    scrollWidth: overflow ? 1500 : 500, clientWidth: 500,
    scrollHeight: overflow ? 1800 : 600, clientHeight: 600,
    scrollLeft: 300, scrollTop: 400,
    classList: {
      add: (value) => classes.add(value), remove: (value) => classes.delete(value),
      toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); },
    },
    addEventListener(type, handler) { handlers.set(type, handler); },
    setPointerCapture: (id) => captured.add(id),
    hasPointerCapture: (id) => captured.has(id),
    releasePointerCapture: (id) => captured.delete(id),
  };
  const controller = attachPreviewPan(stage, options);
  function fire(type, values = {}) {
    const event = {
      type, pointerId: 1, button: 0, isPrimary: true, clientX: 200, clientY: 250,
      target: { tagName: "CANVAS" }, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
      ...values,
    };
    handlers.get(type)(event);
    return event;
  }
  return { stage, controller, classes, captured, fire };
}

test("dragging an overflowing page pans in both directions and retains pointer capture", () => {
  const view = setup();
  assert.ok(view.classes.has("mp-can-pan"));
  view.fire("pointerdown");
  assert.ok(view.captured.has(1));
  assert.ok(view.classes.has("mp-panning"));
  view.fire("pointermove", { clientX: 150, clientY: 170 });
  assert.equal(view.stage.scrollLeft, 350);
  assert.equal(view.stage.scrollTop, 480);
  view.fire("pointermove", { clientX: 240, clientY: 280, target: { tagName: "DIV" } });
  assert.equal(view.stage.scrollLeft, 260);
  assert.equal(view.stage.scrollTop, 370);
  view.fire("pointerup");
  assert.equal(view.captured.size, 0);
  assert.equal(view.classes.has("mp-panning"), false);
  assert.equal(view.fire("click").stopped, true, "A pan must not dismiss the viewer");
});

test("clicking a page without dragging cannot dismiss it; the next backdrop click can", () => {
  const view = setup();
  view.fire("pointerdown");
  view.fire("pointerup");
  assert.equal(view.fire("click", { target: { tagName: "DIV" } }).stopped, true);
  view.fire("pointerdown", { target: { tagName: "DIV" } });
  assert.equal(view.fire("click", { target: { tagName: "DIV" } }).stopped, false);
});

test("pages that fit, backdrop gestures, and secondary pointers do not initiate panning", () => {
  const view = setup(false);
  view.fire("pointerdown");
  assert.equal(view.captured.size, 0);
  view.stage.scrollWidth = 1500;
  view.controller.refresh();
  view.fire("pointerdown", { target: { tagName: "DIV" } });
  view.fire("pointerdown", { button: 2 });
  view.fire("pointerdown", { isPrimary: false });
  assert.equal(view.captured.size, 0);
});

test("touch cancellation, lost capture, and closing clear drag state", () => {
  for (const finish of ["pointercancel", "lostpointercapture", "reset"]) {
    const view = setup();
    view.fire("pointerdown", { pointerType: "touch" });
    view.fire("pointermove", { pointerId: 2, clientX: 0 });
    assert.equal(view.stage.scrollLeft, 300, "Unrelated pointers must not move the page");
    if (finish === "reset") view.controller.reset(); else view.fire(finish);
    assert.equal(view.captured.size, 0);
    assert.equal(view.classes.has("mp-panning"), false);
    view.fire("pointermove", { clientX: 0 });
    assert.equal(view.stage.scrollLeft, 300);
  }
});

test("media viewer images can pan without changing PDF canvas behavior", () => {
  const view = setup(true, { contentTag: "IMG", classPrefix: "mv" });
  view.fire("pointerdown");
  assert.equal(view.captured.size, 0);
  view.fire("pointerdown", { target: { tagName: "IMG" } });
  assert.ok(view.classes.has("mv-panning"));
  view.fire("pointermove", { clientX: 150 });
  assert.equal(view.stage.scrollLeft, 350);
  view.fire("pointerup");
  assert.equal(view.classes.has("mv-panning"), false);
});

test('an explicit mode guard keeps the Hand tool from taking capture while painting', () => {
  let enabled = false;
  const view = setup(true, { enabled: () => enabled });
  view.fire('pointerdown');
  assert.equal(view.captured.size, 0);
  enabled = true;
  view.fire('pointerdown');
  assert.equal(view.captured.size, 1);
  view.fire('pointerup');
});
