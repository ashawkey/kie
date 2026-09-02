// Selection tools: rectangle, ellipse, lasso, magic wand.
import { Tool } from './base.js';
import { combine } from '../core/selection.js';
import { antialiasMask } from '../core/mask.js';
import { bus } from '../core/bus.js';

const MODE_OPT = {
  key: 'mode', type: 'select', label: 'Mode', default: 'replace',
  choices: [['replace', 'New'], ['add', 'Add'], ['subtract', 'Subtract'], ['intersect', 'Intersect']],
};
const ANTIALIAS_OPT = { key: 'antialias', type: 'toggle', label: 'Anti-alias', default: false };
const FEATHER_OPT = {
  key: 'feather', type: 'number', label: 'Feather', min: 0, max: 250, step: 1, default: 0, suffix: 'px',
};
const SAMPLE_SIZE_OPT = {
  key: 'sampleSize', type: 'select', label: 'Sample size', default: '1',
  choices: [['1', 'Point'], ['3', '3 × 3'], ['5', '5 × 5']],
};

const NUDGE = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

/**
 * Photoshop-style modifier override for the mode dropdown: the keys held when
 * the gesture starts win over the tool option, and the option is what you get
 * with no modifiers. Shift and Alt keep their in-drag meanings afterwards —
 * see `takenByMode` below.
 */
export function modeFromEvent(e, base) {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return base || 'replace';
}

/** Average RGBA over an n×n box, for the Sample Size option. */
export function sampleColor(data, w, h, x, y, size = 1) {
  const r = Math.floor((Math.max(1, size) - 1) / 2);
  if (r === 0) {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }
  let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
  for (let sy = Math.max(0, y - r); sy <= Math.min(h - 1, y + r); sy++) {
    for (let sx = Math.max(0, x - r); sx <= Math.min(w - 1, x + r); sx++) {
      const i = (sy * w + sx) * 4;
      sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; sa += data[i + 3];
      n++;
    }
  }
  return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n), Math.round(sa / n)];
}

function pushSelectionEdit(app, before, label) {
  const after = app.selection.snapshot();
  app.history.push({
    label,
    undo: () => app.selection.restore(before),
    redo: () => app.selection.restore(after),
  });
}

/** Shared behaviour for all four selection tools. */
class SelectTool extends Tool {
  static cursor = 'crosshair';

  /** Arrow keys move the marquee itself, not the pixels under it. */
  onKey(e) {
    const nudge = NUDGE[e.key];
    if (!nudge) return false;
    const sel = this.app.selection;
    if (!sel.active || !sel.bounds) return false;
    const step = e.shiftKey ? 10 : 1;
    this.app.prepareMutation();
    const before = sel.snapshot();
    if (!sel.translate(nudge[0] * step, nudge[1] * step)) return false;
    pushSelectionEdit(this.app, before, 'Move Selection');
    return true;
  }

  /** Post-processing shared by the shape tools' `fromShape` calls. */
  shapeOptions() {
    return {
      antialias: !!this.opts.antialias,
      feather: Math.max(0, this.opts.feather ?? 0),
    };
  }
}

class ShapeSelectTool extends SelectTool {
  static options = [MODE_OPT, FEATHER_OPT];

  onDown(e) {
    this.cancelInteraction();
    this.app.prepareMutation();
    this.interaction = this.app.mutationToken();
    this.interaction.selection = this.app.selection;
    this.before = this.app.selection.snapshot();
    this.mode = modeFromEvent(e, this.opts.mode);
    // Shift and Alt are doing double duty: they chose the boolean mode above,
    // so for this gesture they must not also constrain proportions or draw
    // from the centre until the user has let them go once. That is
    // Photoshop's press-then-release convention for the same two keys.
    this.shiftTakenByMode = e.shiftKey;
    this.altTakenByMode = e.altKey;
    this.fromCentre = false;
    this.start = { x: e.ix, y: e.iy };
    this.end = { x: e.ix, y: e.iy };
    this.prev = { x: e.ix, y: e.iy };
    this.dragging = true;
  }

  interactionCurrent() {
    return this.dragging && this.app.isMutationTokenCurrent(this.interaction) &&
      this.app.selection === this.interaction.selection;
  }

  cancelInteraction() {
    if (!this.dragging) return;
    this.dragging = false;
    this.interaction = null;
    bus.emit('overlay');
  }

  deactivate() { this.cancelInteraction(); }
  resetInteraction() { this.cancelInteraction(); }
  onCancel() { this.cancelInteraction(); }

  onMove(e) {
    if (!this.interactionCurrent()) { this.cancelInteraction(); return; }
    let x = e.ix, y = e.iy;
    if (!e.shiftKey) this.shiftTakenByMode = false;
    if (!e.altKey) this.altTakenByMode = false;

    // Space repositions the marquee being drawn instead of resizing it.
    if (this.app.spaceDown) {
      const dx = x - this.prev.x, dy = y - this.prev.y;
      this.start.x += dx; this.start.y += dy;
      this.end.x += dx; this.end.y += dy;
      this.prev = { x, y };
      bus.emit('overlay');
      return;
    }
    this.prev = { x, y };

    if (e.shiftKey && !this.shiftTakenByMode) {
      const dx = x - this.start.x, dy = y - this.start.y;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      x = this.start.x + Math.sign(dx || 1) * m;
      y = this.start.y + Math.sign(dy || 1) * m;
    }
    this.fromCentre = e.altKey && !this.altTakenByMode;
    this.end = { x, y };
    bus.emit('overlay');
  }

  rect() {
    let ax = this.start.x, ay = this.start.y;
    let bx = this.end.x, by = this.end.y;
    if (this.fromCentre) {
      // Alt anchors the centre: the drag defines one half-diagonal.
      ax = this.start.x - (bx - this.start.x);
      ay = this.start.y - (by - this.start.y);
    }
    const x0 = Math.min(ax, bx), y0 = Math.min(ay, by);
    const x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  onUp() {
    if (!this.interactionCurrent()) { this.cancelInteraction(); return; }
    this.dragging = false;
    this.interaction = null;
    const r = this.rect();
    const mode = this.mode || 'replace';
    if (r.w <= 1 && r.h <= 1 && mode === 'replace') {
      this.app.selection.clear();
    } else {
      this.app.selection.fromShape((g) => this.drawShape(g, r), mode, this.shapeOptions());
    }
    pushSelectionEdit(this.app, this.before, 'Select');
    bus.emit('overlay');
  }

  drawOverlay(g, view) {
    if (!this.dragging) return;
    const r = this.rect();
    const a = view.toScreen(r.x, r.y);
    const s = view.scale;
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.setLineDash([5, 4]);
    g.lineWidth = 1;
    if (this.constructor.id === 'select-ellipse') {
      g.beginPath();
      g.ellipse(a.x + r.w * s / 2, a.y + r.h * s / 2, r.w * s / 2, r.h * s / 2, 0, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.strokeRect(a.x + 0.5, a.y + 0.5, r.w * s, r.h * s);
    }
    g.restore();
  }
}

export class RectSelectTool extends ShapeSelectTool {
  static id = 'select-rect';
  static label = 'Rectangular Select';
  static icon = 'select-rect';
  // An axis-aligned rectangle on integer pixel bounds has no partial coverage
  // to smooth, which is why Photoshop greys Anti-alias out for this tool.
  drawShape(g, r) { g.fillRect(r.x, r.y, r.w, r.h); }
  statusHint() { return 'Drag a rectangular selection · Shift: add · Alt: subtract · Click to deselect'; }
}

export class EllipseSelectTool extends ShapeSelectTool {
  static id = 'select-ellipse';
  static label = 'Elliptical Select';
  static icon = 'select-ellipse';
  static options = [MODE_OPT, ANTIALIAS_OPT, FEATHER_OPT];
  drawShape(g, r) {
    g.beginPath();
    g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    g.fill();
  }
  statusHint() { return 'Drag an elliptical selection · Shift: add · Alt: subtract'; }
}

export class LassoTool extends SelectTool {
  static id = 'select-lasso';
  static label = 'Lasso';
  static icon = 'lasso';
  static options = [MODE_OPT, ANTIALIAS_OPT, FEATHER_OPT];

  onDown(e) {
    this.cancelInteraction();
    this.app.prepareMutation();
    this.interaction = this.app.mutationToken();
    this.interaction.selection = this.app.selection;
    this.before = this.app.selection.snapshot();
    this.mode = modeFromEvent(e, this.opts.mode);
    this.pts = [{ x: e.ix + 0.5, y: e.iy + 0.5 }];
    this.dragging = true;
  }

  interactionCurrent() {
    return this.dragging && this.app.isMutationTokenCurrent(this.interaction) &&
      this.app.selection === this.interaction.selection;
  }

  cancelInteraction() {
    if (!this.dragging) return;
    this.dragging = false;
    this.interaction = null;
    this.pts = null;
    bus.emit('overlay');
  }

  deactivate() { this.cancelInteraction(); }
  resetInteraction() { this.cancelInteraction(); }
  onCancel() { this.cancelInteraction(); }

  onMove(e) {
    if (!this.interactionCurrent()) { this.cancelInteraction(); return; }
    const p = { x: e.ix + 0.5, y: e.iy + 0.5 };
    const last = this.pts[this.pts.length - 1];
    if (last.x === p.x && last.y === p.y) return;
    this.pts.push(p);
    bus.emit('overlay');
  }

  onUp() {
    if (!this.interactionCurrent()) { this.cancelInteraction(); return; }
    this.dragging = false;
    this.interaction = null;
    if (this.pts.length < 3) { this.pts = null; bus.emit('overlay'); return; }
    const pts = this.pts;
    this.app.selection.fromShape((g) => {
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.closePath();
      g.fill();
    }, this.mode || 'replace', this.shapeOptions());
    pushSelectionEdit(this.app, this.before, 'Lasso Select');
    this.pts = null;
    bus.emit('overlay');
  }

  drawOverlay(g, view) {
    if (!this.dragging || !this.pts?.length) return;
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.setLineDash([5, 4]);
    g.lineWidth = 1;
    g.beginPath();
    const p0 = view.toScreen(this.pts[0].x, this.pts[0].y);
    g.moveTo(p0.x, p0.y);
    for (const p of this.pts.slice(1)) {
      const s = view.toScreen(p.x, p.y);
      g.lineTo(s.x, s.y);
    }
    g.closePath();
    g.stroke();
    g.restore();
  }
  statusHint() { return 'Drag a freehand selection · Shift: add · Alt: subtract'; }
}

/**
 * Flood-select pixels matching the start point. `seedColor` overrides the
 * colour that is matched against, so Sample Size can match an averaged
 * neighbourhood instead of the single clicked pixel.
 */
export function magicWandMask(data, w, h, startX, startY, tolerance = 16,
  contiguous = true, stats = null, seedColor = null) {
  const n = w * h;
  const next = new Uint8Array(n);
  const tol = tolerance ** 2 * 4;
  const i0 = (startY * w + startX) * 4;
  const tr = seedColor ? seedColor[0] : data[i0];
  const tg = seedColor ? seedColor[1] : data[i0 + 1];
  const tb = seedColor ? seedColor[2] : data[i0 + 2];
  const ta = seedColor ? seedColor[3] : data[i0 + 3];
  const match = (p) => {
    const i = p * 4;
    if (data[i + 3] === 0 && ta === 0) return true;
    const dr = data[i] - tr, dg = data[i + 1] - tg;
    const db = data[i + 2] - tb, da = data[i + 3] - ta;
    return dr * dr + dg * dg + db * db + da * da <= tol;
  };

  if (stats) { stats.enqueues = 0; stats.peak = 0; stats.examined = 0; }
  if (!contiguous) {
    for (let p = 0; p < n; p++) {
      if (stats) stats.examined++;
      if (match(p)) next[p] = 255;
    }
    return next;
  }

  // Store horizontal runs rather than individual pixels. Pixels are marked
  // before testing/enqueueing, so no pixel can be examined or enqueued twice;
  // uniform areas need only a tiny stack instead of millions of duplicate
  // entries (or a half-document pixel stack).
  const seen = new Uint8Array(n);
  const stack = [];
  const discoverRun = (x, y) => {
    const start = y * w + x;
    if (seen[start]) return null;
    seen[start] = 1;
    if (stats) stats.examined++;
    if (!match(start)) return null;

    let left = x, right = x;
    while (left > 0) {
      const p = y * w + left - 1;
      if (seen[p]) break;
      seen[p] = 1;
      if (stats) stats.examined++;
      if (!match(p)) break;
      left--;
    }
    while (right + 1 < w) {
      const p = y * w + right + 1;
      if (seen[p]) break;
      seen[p] = 1;
      if (stats) stats.examined++;
      if (!match(p)) break;
      right++;
    }
    next.fill(255, y * w + left, y * w + right + 1);
    stack.push(y, left, right);
    if (stats) {
      stats.enqueues++;
      stats.peak = Math.max(stats.peak, stack.length / 3);
    }
    return right;
  };

  discoverRun(startX, startY);
  while (stack.length) {
    const right = stack.pop(), left = stack.pop(), runY = stack.pop();
    for (const y of [runY - 1, runY + 1]) {
      if (y < 0 || y >= h) continue;
      let x = left;
      while (x <= right) {
        const childRight = discoverRun(x, y);
        x = childRight === null ? x + 1 : Math.max(x + 1, childRight + 1);
      }
    }
  }
  return next;
}

export class MagicWandTool extends SelectTool {
  static id = 'wand';
  static label = 'Magic Wand';
  static icon = 'wand';
  static options = [
    MODE_OPT,
    SAMPLE_SIZE_OPT,
    { key: 'tolerance', type: 'range', label: 'Tolerance', min: 0, max: 255, step: 1, default: 16 },
    ANTIALIAS_OPT,
    { key: 'contiguous', type: 'toggle', label: 'Contiguous', default: true },
    { key: 'sampleAll', type: 'toggle', label: 'Sample all layers', default: true },
  ];

  cancelInteraction() {
    if (!this.dragging) return;
    this.dragging = false;
    this.interaction = null;
    this.sample = null;
  }

  /**
   * Unlike the shape tools, the wand mutates the selection as the gesture
   * runs, and only records history on pointer-up. An abandoned gesture must
   * therefore put the selection back rather than leave an unrecorded change.
   */
  abortInteraction() {
    if (this.dragging && this.interactionCurrent()) this.app.selection.restore(this.before);
    this.cancelInteraction();
  }

  deactivate() { this.abortInteraction(); }
  resetInteraction() { this.abortInteraction(); }
  onCancel() { this.abortInteraction(); }

  interactionCurrent() {
    return this.dragging && this.app.isMutationTokenCurrent(this.interaction) &&
      this.app.selection === this.interaction.selection;
  }

  inside(e) {
    const { doc } = this.app;
    return e.ix >= 0 && e.iy >= 0 && e.ix < doc.width && e.iy < doc.height;
  }

  onDown(e) {
    this.cancelInteraction();
    if (!this.inside(e)) return;
    const { doc } = this.app;
    this.app.prepareMutation();
    const src = this.opts.sampleAll !== false ? doc.flatten() : doc.active?.canvas;
    if (!src) return;
    const g = src.getContext('2d', { willReadFrequently: true });
    // Sampled once for the whole gesture: the document cannot change while a
    // wand drag is in flight, and re-reading it per pointer move is expensive.
    this.sample = g.getImageData(0, 0, doc.width, doc.height).data;
    this.interaction = this.app.mutationToken();
    this.interaction.selection = this.app.selection;
    this.before = this.app.selection.snapshot();
    this.mode = modeFromEvent(e, this.opts.mode);
    this.dragging = true;
    this.lastPoint = null;
    this.applyAt(e.ix, e.iy, this.mode);
  }

  onMove(e) {
    // Dragging keeps sampling, so a whole region can be picked up in one
    // gesture. Subtract stays subtractive; every other mode accumulates.
    if (!e.buttons || !this.dragging) return;
    if (!this.interactionCurrent()) { this.cancelInteraction(); return; }
    if (!this.inside(e)) return;
    this.applyAt(e.ix, e.iy, this.mode === 'subtract' ? 'subtract' : 'add');
  }

  onUp() {
    if (!this.dragging) return;
    const current = this.interactionCurrent();
    const before = this.before;
    this.cancelInteraction();
    if (current) pushSelectionEdit(this.app, before, 'Magic Wand');
  }

  applyAt(x, y, mode) {
    if (this.lastPoint && this.lastPoint.x === x && this.lastPoint.y === y) return;
    this.lastPoint = { x, y };
    const { doc, selection } = this.app;
    const w = doc.width, h = doc.height;
    const seedColor = sampleColor(this.sample, w, h, x, y, Number(this.opts.sampleSize) || 1);
    let next = magicWandMask(this.sample, w, h, x, y,
      this.opts.tolerance ?? 16, this.opts.contiguous !== false, null, seedColor);
    if (this.opts.antialias) next = antialiasMask(next, w, h);
    selection.set(combine(selection.mask, next, mode, w * h));
  }

  statusHint() { return 'Click or drag to select similar pixels · Shift: add · Alt: subtract'; }
}
