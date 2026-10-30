export const palettes = {
  everyday: { label: "Everyday", colors: ["#24323d", "#ffffff", "#ef4444", "#f97316", "#facc15", "#84cc16", "#16a34a", "#14b8a6", "#38bdf8", "#2563eb", "#8b5cf6", "#ec4899"] },
  soft: { label: "Soft tones", colors: ["#64748b", "#fff7ed", "#fecaca", "#fed7aa", "#fef08a", "#d9f99d", "#bbf7d0", "#99f6e4", "#bae6fd", "#c7d2fe", "#ddd6fe", "#fbcfe8"] },
  earth: { label: "Earth & nature", colors: ["#292524", "#faf5e9", "#7f1d1d", "#b45309", "#d6a85e", "#a3a659", "#3f6212", "#4d7c62", "#487c87", "#36556f", "#715467", "#d6a394"] },
};

export function coloringImageMime(header) {
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => header[i] === value)) return "image/png";
  const text = String.fromCharCode(...header);
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

export function fitDrawingSize(width, height, maxSide = 2048) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("This image has no readable dimensions.");
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)), resized: ratio < 1 };
}

export function drawingPoint(event, bounds, width, height) {
  return {
    x: Math.max(0, Math.min(width, (event.clientX - bounds.left) / bounds.width * width)),
    y: Math.max(0, Math.min(height, (event.clientY - bounds.top) / bounds.height * height)),
    pressure: event.pointerType === "pen" ? Math.max(0.1, Math.min(1, event.pressure || 0.1)) : 1,
  };
}

function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

// A stroke is painted once onto a reusable scratch layer. Applying opacity once
// avoids dark seams where segments of the same translucent stroke overlap.
export function paintStroke(context, stroke, scratch) {
  if (stroke.type === "clear") { context.clearRect(0, 0, context.canvas.width, context.canvas.height); return; }
  if (!stroke.points.length) return;
  const ink = scratch.getContext("2d");
  ink.clearRect(0, 0, scratch.width, scratch.height);
  ink.fillStyle = stroke.color;
  const rand = random(stroke.seed);
  const dab = (point) => {
    const radius = Math.max(0.5, stroke.size * point.pressure / 2);
    if (stroke.brush === "soft" && !stroke.erase) {
      const gradient = ink.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
      gradient.addColorStop(0, stroke.color); gradient.addColorStop(1, stroke.color + "00");
      ink.fillStyle = gradient;
      ink.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    } else if (stroke.brush === "pencil" && !stroke.erase) {
      for (let i = 0; i < Math.max(10, radius * 3); i++) {
        const angle = rand() * Math.PI * 2, distance = Math.sqrt(rand()) * radius;
        ink.globalAlpha = 0.2 + rand() * 0.5;
        ink.beginPath(); ink.arc(point.x + Math.cos(angle) * distance, point.y + Math.sin(angle) * distance, 0.4 + rand() * 0.7, 0, Math.PI * 2); ink.fill();
      }
      ink.globalAlpha = 1;
    } else { ink.beginPath(); ink.arc(point.x, point.y, radius, 0, Math.PI * 2); ink.fill(); }
  };
  dab(stroke.points[0]);
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1], b = stroke.points[i];
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(distance / Math.max(0.5, stroke.size * Math.min(a.pressure, b.pressure) * 0.12));
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      dab({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, pressure: a.pressure + (b.pressure - a.pressure) * t });
    }
  }
  context.save();
  context.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
  context.globalAlpha = stroke.opacity;
  context.drawImage(scratch, 0, 0);
  context.restore();
}

export function createDrawingSession(width, height, makeCanvas, limit = 100) {
  const create = () => { const canvas = makeCanvas(); canvas.width = width; canvas.height = height; return canvas; };
  const baseline = create(), committed = create(), scratch = create();
  const baseContext = baseline.getContext("2d"), context = committed.getContext("2d");
  let history = [], cursor = 0, revision = 0;
  function replay() {
    context.clearRect(0, 0, width, height); context.drawImage(baseline, 0, 0);
    for (const stroke of history.slice(0, cursor)) paintStroke(context, stroke, scratch);
    revision++;
  }
  return {
    get canUndo() { return cursor > 0; }, get canRedo() { return cursor < history.length; },
    get revision() { return revision; },
    commit(stroke) {
      history = history.slice(0, cursor);
      // Own the data: later pointer events must not mutate undo history.
      const command = structuredClone(stroke);
      history.push(command); cursor++;
      paintStroke(context, command, scratch);
      if (history.length > limit) { paintStroke(baseContext, history.shift(), scratch); cursor--; }
      revision++;
    },
    undo() { if (cursor) { cursor--; replay(); } },
    redo() { if (cursor < history.length) { cursor++; replay(); } },
    render(target, draft = null) {
      target.clearRect(0, 0, width, height); target.drawImage(committed, 0, 0);
      if (draft) paintStroke(target, draft, scratch);
    },
    export(target, original, preserveLines = true) {
      target.save(); target.globalAlpha = 1; target.globalCompositeOperation = "source-over";
      target.fillStyle = "white"; target.fillRect(0, 0, width, height); target.drawImage(original, 0, 0, width, height);
      target.globalCompositeOperation = preserveLines ? "multiply" : "source-over";
      target.drawImage(committed, 0, 0); target.restore();
    },
    dispose() { for (const canvas of [baseline, committed, scratch]) canvas.width = canvas.height = 0; history = []; cursor = 0; },
  };
}
