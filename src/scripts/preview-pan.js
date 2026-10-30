export function attachPreviewPan(stage, { contentTag = "CANVAS", classPrefix = "mp", enabled = () => true } = {}) {
  let pan = null;
  let suppressClick = false;
  const canPan = () => stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1;

  function refresh() {
    stage.classList.toggle(`${classPrefix}-can-pan`, canPan());
  }
  function reset() {
    const pointerId = pan?.pointerId;
    pan = null;
    suppressClick = false;
    stage.classList.remove(`${classPrefix}-panning`);
    if (pointerId !== undefined && stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
  }
  stage.addEventListener("pointerdown", (event) => {
    suppressClick = false;
    if (!enabled() || event.button !== 0 || !event.isPrimary || event.target.tagName !== contentTag || !canPan()) return;
    pan = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      left: stage.scrollLeft, top: stage.scrollTop,
    };
    // Capture on the stable container: sharpening can replace the canvas while
    // the user is dragging, and the pointer may move outside the page.
    stage.setPointerCapture(event.pointerId);
    stage.classList.add(`${classPrefix}-panning`);
    event.preventDefault();
  });
  stage.addEventListener("pointermove", (event) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    stage.scrollLeft = pan.left - dx;
    stage.scrollTop = pan.top - dy;
    event.preventDefault();
  });
  function finish(event) {
    if (!pan || pan.pointerId !== event.pointerId) return;
    reset();
    suppressClick = event.type !== "pointercancel";
  }
  stage.addEventListener("pointerup", finish);
  stage.addEventListener("pointercancel", finish);
  stage.addEventListener("lostpointercapture", finish);
  stage.addEventListener("click", (event) => {
    // Captured page clicks can target the backdrop, even without movement.
    // Consume that click so interacting with the page never dismisses it.
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  refresh();
  return { refresh, reset };
}
