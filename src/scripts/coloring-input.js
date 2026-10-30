// Capture loss can happen without a normal canvas pointerup (for example when
// the browser interrupts a gesture). Preserve the visible stroke in that case.
export function attachColoringInput(canvas, { canStart, onStart, onMove, onEnd }, eventWindow = window) {
  let pointer = null;
  function end(commit = true, event = null) {
    if (pointer === null) return;
    const previous = pointer;
    pointer = null; // A release can synchronously dispatch lostpointercapture.
    if (canvas.hasPointerCapture(previous)) canvas.releasePointerCapture(previous);
    onEnd(commit, event);
  }
  function down(event) {
    if (pointer !== null || !canStart() || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.stopPropagation();
    pointer = event.pointerId;
    // A window pointerup below is a fallback if capture isn't available.
    try { canvas.setPointerCapture(pointer); } catch { /* Keep drawing. */ }
    onStart(event);
  }
  function move(event) {
    if (event.pointerId !== pointer) return;
    const samples = event.getCoalescedEvents?.();
    onMove(samples?.length ? samples : [event]);
  }
  function up(event) { if (event.pointerId === pointer) end(true, event); }
  function interrupted(event) {
    if (event.pointerId !== pointer) return;
    if (event.type === "lostpointercapture" && canvas.hasPointerCapture(pointer)) return;
    end(true);
  }
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", interrupted);
  canvas.addEventListener("lostpointercapture", interrupted);
  eventWindow.addEventListener("pointerup", up, true);
  eventWindow.addEventListener("pointercancel", interrupted, true);
  return {
    end,
    dispose() {
      end(false);
      for (const [type, handler] of [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", interrupted], ["lostpointercapture", interrupted]]) canvas.removeEventListener(type, handler);
      eventWindow.removeEventListener("pointerup", up, true);
      eventWindow.removeEventListener("pointercancel", interrupted, true);
    },
  };
}

export function scrollZoom(current, deltaY, deltaMode = 0, pageHeight = 800) {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1);
  return Math.max(0.1, Math.min(4, current * Math.exp(-Math.max(-160, Math.min(160, pixels)) * 0.0015)));
}

export function attachColoringWheelZoom(viewport, paper, { getZoom, setZoom, beforeZoom }) {
  function wheel(event) {
    const current = getZoom();
    if (!current || !event.deltaY) return;
    event.preventDefault();
    const next = scrollZoom(current, event.deltaY, event.deltaMode, viewport.clientHeight);
    if (next === current) return;
    beforeZoom();
    const old = paper.getBoundingClientRect();
    const x = (event.clientX - old.left) / old.width, y = (event.clientY - old.top) / old.height;
    setZoom(next);
    const bounds = paper.getBoundingClientRect();
    viewport.scrollLeft += bounds.left + x * bounds.width - event.clientX;
    viewport.scrollTop += bounds.top + y * bounds.height - event.clientY;
  }
  viewport.addEventListener("wheel", wheel, { passive: false });
  return () => viewport.removeEventListener("wheel", wheel);
}
