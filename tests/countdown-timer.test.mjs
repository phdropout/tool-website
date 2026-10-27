import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/scripts/countdown-timer.js", import.meta.url), "utf8");

// Execute the actual event handlers with a controlled clock and minimal DOM.
function createTimer() {
  let now = 0;
  let tick = null;
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {
        value: "", textContent: "", checked: false, style: {}, events: {},
        classList: {
          add: (value) => classes.add(value),
          remove: (...values) => values.forEach((value) => classes.delete(value)),
          contains: (value) => classes.has(value),
        },
        setAttribute() {},
        addEventListener(type, handler) { this.events[type] = handler; },
      });
    }
    return elements.get(selector);
  }
  element("#hoursInput").value = "0";
  element("#minutesInput").value = "45";
  element("#secondsInput").value = "0";
  const adjustments = [-300, -60, 60, 300].map((seconds) => ({
    dataset: { adjust: String(seconds) },
    addEventListener(type, handler) { this[type] = handler; },
  }));
  const root = { querySelector: element, querySelectorAll: () => adjustments };
  class Clock extends Date { static now() { return now; } }
  runInNewContext(source, {
    Date: Clock, navigator: {}, console,
    document: { querySelector: () => root, addEventListener() {}, visibilityState: "visible" },
    window: { addEventListener() {}, setInterval(handler) { tick = handler; return 1; } },
    clearInterval() { tick = null; },
  });
  return {
    element,
    click: (id) => element(`#${id}`).events.click(),
    adjust: (seconds) => adjustments.find((button) => Number(button.dataset.adjust) === seconds).click(),
    advance(milliseconds) { now += milliseconds; tick?.(); },
    display: () => element("#timerDisplay").textContent,
    status: () => element("#timerStatus").textContent,
  };
}

test("setup adjustments configure the duration used by Reset", async () => {
  const timer = createTimer();
  timer.adjust(300);
  assert.equal(timer.display(), "50:00");
  await timer.click("startPauseButton");
  timer.advance(10000);
  await timer.click("resetButton");
  assert.equal(timer.display(), "50:00");
});

for (const paused of [false, true]) {
  test(`adjustments ${paused ? "while paused" : "while running"} preserve elapsed progress and reset duration`, async () => {
    const timer = createTimer();
    await timer.click("startPauseButton");
    timer.advance(10000);
    if (paused) await timer.click("startPauseButton");
    timer.adjust(60);
    assert.equal(timer.display(), "45:50");
    assert.equal(timer.status(), paused ? "Paused" : "Running");
    const progress = Number(timer.element("#progressBar").style.transform.match(/scaleX\((.*)\)/)[1]);
    assert.ok(progress < 1 && progress > 0.99);
    timer.adjust(-300);
    assert.equal(timer.display(), "40:50");
    await timer.click("resetButton");
    assert.equal(timer.display(), "45:00");
  });
}

test("adding time after completion clears the finished state and resumes the added time", async () => {
  const timer = createTimer();
  await timer.click("startPauseButton");
  timer.advance(2700000);
  assert.equal(timer.status(), "Time is up");
  timer.adjust(60);
  assert.equal(timer.display(), "01:00");
  assert.equal(timer.status(), "Paused");
  assert.equal(timer.element("#startPauseButton").textContent, "Resume");
  assert.equal(timer.element("#timerStage").classList.contains("timer-finished"), false);
  await timer.click("startPauseButton");
  timer.advance(1000);
  assert.equal(timer.display(), "00:59");
  await timer.click("resetButton");
  assert.equal(timer.display(), "45:00");
});

for (const paused of [false, true]) {
  test(`subtracting past zero ${paused ? "while paused" : "while running"} finishes without changing Reset`, async () => {
    const timer = createTimer();
    await timer.click("startPauseButton");
    timer.advance(2690000);
    if (paused) await timer.click("startPauseButton");
    timer.adjust(-60);
    assert.equal(timer.display(), "00:00");
    assert.equal(timer.status(), "Time is up");
    timer.adjust(-60);
    assert.equal(timer.status(), "Time is up");
    await timer.click("resetButton");
    assert.equal(timer.display(), "45:00");
  });
}
