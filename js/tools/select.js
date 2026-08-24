// Selection tools: rectangle, ellipse, lasso, magic wand.
import { Tool } from './base.js';
import { combine } from '../core/selection.js';
import { bus } from '../core/bus.js';

const MODE_OPT = {
  key: 'mode', type: 'select', label: 'Mode', default: 'replace',
  choices: [['replace', 'New'], ['add', 'Add'], ['subtract', 'Subtract'], ['intersect', 'Intersect']],
};

function pushSelectionEdit(app, before, label) {
  const after = app.selection.snapshot();
  app.history.push({
    label,
    undo: () => app.selection.restore(before),
    redo: () => app.selection.restore(after),
  });
}

class ShapeSelectTool extends Tool {
  static cursor = 'crosshair';
  static options = [MODE_OPT, { key: 'antialias', type: 'toggle', label: 'Anti-alias', default: false }];

  onDown(e) {
    this.cancelInteraction();
    this.app.prepareMutation();
    this.interaction = this.app.mutationToken();
    this.interaction.selection = this.app.selection;
    this.before = this.app.selection.snapshot();
    this.start = { x: e.ix, y: e.iy };
    this.end = { x: e.ix, y: e.iy };
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
    if (e.shiftKey) {
      const dx = x - this.start.x, dy = y - this.start.y;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      x = this.start.x + Math.sign(dx || 1) * m;
      y = this.start.y + Math.sign(dy || 1) * m;
    }
    this.end = { x, y };
    bus.emit('overlay');
  }

  rect() {
    const x0 = Math.min(this.start.x, this.end.x), y0 = Math.min(this.start.y, this.end.y);
    const x1 = Math.max(this.start.x, this.end.x), y1 = Math.max(this.start.y, this.end.y);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  onUp() {
    if (!this.interactionCurrent()) { this.cancelInteraction(); return; }
    this.dragging = false;
    this.interaction = null;
    const r = this.rect();
    const mode = this.opts.mode || 'replace';
    if (r.w <= 1 && r.h <= 1 && mode === 'replace') {
      this.app.selection.clear();
    } else {
      this.app.selection.fromShape((g) => this.drawShape(g, r), mode);
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
  drawShape(g, r) { g.fillRect(r.x, r.y, r.w, r.h); }
  statusHint() { return 'Drag a rectangular selection · Shift: square · Click to deselect'; }
}

export class EllipseSelectTool extends ShapeSelectTool {
  static id = 'select-ellipse';
  static label = 'Elliptical Select';
  static icon = 'select-ellipse';
  drawShape(g, r) {
    g.imageSmoothingEnabled = false;
    g.beginPath();
    g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    g.fill();
  }
  statusHint() { return 'Drag an elliptical selection · Shift: circle'; }
}

export class LassoTool extends Tool {
  static id = 'select-lasso';
  static label = 'Lasso';
  static icon = 'lasso';
  static cursor = 'crosshair';
  static options = [MODE_OPT];

  onDown(e) {
    this.cancelInteraction();
    this.app.prepareMutation();
    this.interaction = this.app.mutationToken();
    this.interaction.selection = this.app.selection;
    this.before = this.app.selection.snapshot();
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
    }, this.opts.mode || 'replace');
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
  statusHint() { return 'Drag a freehand selection'; }
}

export function magicWandMask(data, w, h, startX, startY, tolerance = 16,
  contiguous = true, stats = null) {
  const n = w * h;
  const next = new Uint8Array(n);
  const tol = tolerance ** 2 * 4;
  const i0 = (startY * w + startX) * 4;
  const tr = data[i0], tg = data[i0 + 1], tb = data[i0 + 2], ta = data[i0 + 3];
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
    const seed = y * w + x;
    if (seen[seed]) return null;
    seen[seed] = 1;
    if (stats) stats.examined++;
    if (!match(seed)) return null;

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

export class MagicWandTool extends Tool {
  static id = 'wand';
  static label = 'Magic Wand';
  static icon = 'wand';
  static cursor = 'crosshair';
  static options = [
    MODE_OPT,
    { key: 'tolerance', type: 'range', label: 'Tolerance', min: 0, max: 255, step: 1, default: 16 },
    { key: 'contiguous', type: 'toggle', label: 'Contiguous', default: true },
    { key: 'sampleAll', type: 'toggle', label: 'Sample all layers', default: true },
  ];

  onDown(e) {
    const { doc, selection } = this.app;
    if (e.ix < 0 || e.iy < 0 || e.ix >= doc.width || e.iy >= doc.height) return;
    const before = selection.snapshot();
    const src = this.opts.sampleAll !== false ? doc.flatten() : doc.active?.canvas;
    if (!src) return;
    const g = src.getContext('2d', { willReadFrequently: true });
    const data = g.getImageData(0, 0, doc.width, doc.height).data;
    const w = doc.width, h = doc.height;
    const next = magicWandMask(data, w, h, e.ix, e.iy,
      this.opts.tolerance ?? 16, this.opts.contiguous !== false);
    selection.set(combine(selection.mask, next, this.opts.mode || 'replace', w * h));
    pushSelectionEdit(this.app, before, 'Magic Wand');
  }
  statusHint() { return 'Click to select similar pixels'; }
}
