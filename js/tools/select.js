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
    const tol = (this.opts.tolerance ?? 16) ** 2 * 4;
    const i0 = (e.iy * w + e.ix) * 4;
    const t = [data[i0], data[i0 + 1], data[i0 + 2], data[i0 + 3]];
    const match = (i) => {
      if (data[i + 3] === 0 && t[3] === 0) return true;
      const dr = data[i] - t[0], dg = data[i + 1] - t[1], db = data[i + 2] - t[2], da = data[i + 3] - t[3];
      return dr * dr + dg * dg + db * db + da * da <= tol;
    };
    const next = new Uint8Array(w * h);
    if (this.opts.contiguous === false) {
      for (let i = 0; i < w * h; i++) if (match(i * 4)) next[i] = 255;
    } else {
      const stack = [e.iy * w + e.ix];
      const seen = new Uint8Array(w * h);
      while (stack.length) {
        const p = stack.pop();
        if (seen[p]) continue;
        seen[p] = 1;
        if (!match(p * 4)) continue;
        next[p] = 255;
        const x = p % w, y = (p / w) | 0;
        if (x > 0) stack.push(p - 1);
        if (x < w - 1) stack.push(p + 1);
        if (y > 0) stack.push(p - w);
        if (y < h - 1) stack.push(p + w);
      }
    }
    selection.set(combine(selection.mask, next, this.opts.mode || 'replace', w * h));
    pushSelectionEdit(this.app, before, 'Magic Wand');
  }
  statusHint() { return 'Click to select similar pixels'; }
}
