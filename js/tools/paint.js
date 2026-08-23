// Pencil, brush, eraser, line/rect/ellipse shapes, bucket, gradient, eyedropper.
import { PixelTool, Tool } from './base.js';
import { PixelPerfect, Painter } from '../core/pixels.js';
import { bus } from '../core/bus.js';
import { hexToRgba, rgbaToHex } from '../core/util.js';

const SIZE_OPT = { key: 'size', type: 'number', label: 'Size', min: 1, max: 256, step: 1, default: 1, suffix: 'px' };
const OPACITY_OPT = { key: 'opacity', type: 'range', label: 'Opacity', min: 0, max: 100, step: 1, default: 100, suffix: '%' };
const SHAPE_OPT = {
  key: 'shape', type: 'select', label: 'Tip', default: 'square',
  choices: [['square', 'Square'], ['circle', 'Circle']],
};

/** Shared drag-stroke behaviour. */
class StrokeTool extends PixelTool {
  configure(p) {
    const o = this.opts;
    p.size = o.size ?? 1;
    p.shape = o.shape ?? 'square';
    p.opacity = (o.opacity ?? 100) / 100;
    p.hardness = o.hardness == null ? 1 : o.hardness / 100;
    p.color = this.app.color.primary;
    p.mode = 'paint';
  }

  onDown(e) {
    const pixelPerfect = !!this.opts.pixelPerfect && (this.opts.size ?? 1) === 1;
    const p = this.beginEdit({
      needsOriginal: pixelPerfect,
      configure: (painter) => this.configure(painter),
    });
    if (!p) return;
    if (e.button === 2 && p.mode === 'paint') p.color = this.app.color.secondary;
    this.pp = pixelPerfect ? new PixelPerfect() : null;
    this.last = { x: e.ix, y: e.iy };
    this.shiftAnchor = { x: e.ix, y: e.iy };
    this.paintPoint(e.ix, e.iy);
    this.flush();
  }

  onMove(e) {
    if (!this.painter) return;
    let x = e.ix, y = e.iy;
    if (e.shiftKey) {
      const dx = x - this.shiftAnchor.x, dy = y - this.shiftAnchor.y;
      if (Math.abs(dx) > Math.abs(dy)) y = this.shiftAnchor.y; else x = this.shiftAnchor.x;
    }
    if (x === this.last.x && y === this.last.y) return;
    if (this.pp) {
      this.painter.line(this.last.x, this.last.y, x, y, (px, py) => this.paintPoint(px, py));
    } else {
      this.painter.line(this.last.x, this.last.y, x, y);
    }
    this.last = { x, y };
    this.flush();
  }

  paintPoint(x, y) {
    if (this.pp) {
      for (const step of this.pp.push(x, y)) {
        if (step.erase) this.painter.restorePixel(step.erase.x, step.erase.y);
        else this.painter.stamp(step.x, step.y);
      }
    } else {
      this.painter.stamp(x, y);
    }
  }

  onUp() {
    this.pp = null;
    this.endEdit(this.constructor.label);
  }
}

export class PencilTool extends StrokeTool {
  static id = 'pencil';
  static label = 'Pencil';
  static icon = 'pencil';
  static options = [
    SIZE_OPT, SHAPE_OPT, OPACITY_OPT,
    { key: 'pixelPerfect', type: 'toggle', label: 'Pixel perfect', default: true },
  ];
  statusHint() { return 'Drag to draw · Shift: straight · Alt: pick color · Right-drag: secondary color'; }
}

export class BrushTool extends StrokeTool {
  static id = 'brush';
  static label = 'Brush';
  static icon = 'brush';
  static options = [
    { ...SIZE_OPT, default: 8 }, { ...SHAPE_OPT, default: 'circle' },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 1, max: 100, step: 1, default: 100, suffix: '%' },
    OPACITY_OPT,
  ];
  statusHint() { return 'Soft-edged brush · Shift: straight'; }
}

export class EraserTool extends StrokeTool {
  static id = 'eraser';
  static label = 'Eraser';
  static icon = 'eraser';
  static options = [
    SIZE_OPT, SHAPE_OPT,
    { key: 'hardness', type: 'range', label: 'Hardness', min: 1, max: 100, step: 1, default: 100, suffix: '%' },
    OPACITY_OPT,
    { key: 'pixelPerfect', type: 'toggle', label: 'Pixel perfect', default: false },
  ];
  configure(p) {
    super.configure(p);
    p.mode = 'erase';
  }
  statusHint() { return 'Drag to erase to transparency'; }
}

/** Line / rectangle / ellipse with live preview. */
class ShapeTool extends PixelTool {
  onDown(e) {
    const o = this.opts;
    const p = this.beginEdit({
      configure: (painter) => {
        painter.size = o.size ?? 1;
        painter.shape = 'square';
        painter.opacity = (o.opacity ?? 100) / 100;
        painter.color = e.button === 2 ? this.app.color.secondary : this.app.color.primary;
      },
    });
    if (!p) return;
    this.start = { x: e.ix, y: e.iy };
    this.end = { x: e.ix, y: e.iy };
    this.render();
  }

  onMove(e) {
    if (!this.painter) return;
    let x = e.ix, y = e.iy;
    if (e.shiftKey) ({ x, y } = this.constrain(this.start, x, y));
    if (x === this.end.x && y === this.end.y) return;
    this.end = { x, y };
    this.render();
  }

  constrain(a, x, y) {
    const dx = x - a.x, dy = y - a.y;
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + Math.sign(dx) * m, y: a.y + Math.sign(dy) * m };
  }

  render() {
    this.resetPreview();
    if (!this.painter) return;
    this.paintShape(this.painter, this.start, this.end);
    this.layer.ctx.putImageData(this.painter.image, 0, 0);
    this.app.doc.touch();
    bus.emit('layers');
  }

  onUp() {
    this.endEdit(this.constructor.label);
  }
}

export class LineTool extends ShapeTool {
  static id = 'line';
  static label = 'Line';
  static icon = 'line';
  static options = [SIZE_OPT, OPACITY_OPT];
  constrain(a, x, y) {
    const dx = x - a.x, dy = y - a.y;
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: Math.round(a.x + Math.cos(ang) * len), y: Math.round(a.y + Math.sin(ang) * len) };
  }
  paintShape(p, a, b) { p.line(a.x, a.y, b.x, b.y); }
  statusHint() { return 'Drag for a line · Shift: 45° steps'; }
}

export class RectTool extends ShapeTool {
  static id = 'rect';
  static label = 'Rectangle';
  static icon = 'rect';
  static options = [SIZE_OPT, { key: 'fill', type: 'toggle', label: 'Fill', default: false }, OPACITY_OPT];
  paintShape(p, a, b) { p.rect(a.x, a.y, b.x, b.y, !!this.opts.fill); }
  statusHint() { return 'Drag a rectangle · Shift: square'; }
}

export class EllipseTool extends ShapeTool {
  static id = 'ellipse';
  static label = 'Ellipse';
  static icon = 'ellipse';
  static options = [SIZE_OPT, { key: 'fill', type: 'toggle', label: 'Fill', default: false }, OPACITY_OPT];
  paintShape(p, a, b) { p.ellipse(a.x, a.y, b.x, b.y, !!this.opts.fill); }
  statusHint() { return 'Drag an ellipse · Shift: circle'; }
}

export class BucketTool extends PixelTool {
  static id = 'bucket';
  static label = 'Paint Bucket';
  static icon = 'bucket';
  static options = [
    { key: 'tolerance', type: 'range', label: 'Tolerance', min: 0, max: 255, step: 1, default: 0 },
    { key: 'contiguous', type: 'toggle', label: 'Contiguous', default: true },
    { key: 'sampleAll', type: 'toggle', label: 'Sample all layers', default: false },
    OPACITY_OPT,
  ];

  onDown(e) {
    if (e.ix < 0 || e.iy < 0 || e.ix >= this.app.doc.width || e.iy >= this.app.doc.height) return;
    const p = this.beginEdit();
    if (!p) return;
    const o = this.opts;
    p.opacity = (o.opacity ?? 100) / 100;
    p.color = e.button === 2 ? this.app.color.secondary : this.app.color.primary;
    let sampleData = null;
    if (o.sampleAll) {
      const flat = this.app.doc.flatten();
      sampleData = flat.getContext('2d').getImageData(0, 0, flat.width, flat.height).data;
    }
    p.fill(e.ix, e.iy, {
      tolerance: o.tolerance ?? 0,
      contiguous: o.contiguous !== false,
      sampleData,
    });
    this.endEdit('Fill');
  }
  statusHint() { return 'Click to flood fill · Right-click: secondary color'; }
}

export class GradientTool extends PixelTool {
  static id = 'gradient';
  static label = 'Gradient';
  static icon = 'gradient';
  static options = [
    { key: 'type', type: 'select', label: 'Type', default: 'linear', choices: [['linear', 'Linear'], ['radial', 'Radial']] },
    { key: 'dither', type: 'toggle', label: 'Dither', default: false },
    OPACITY_OPT,
  ];

  onDown(e) {
    const p = this.beginEdit();
    if (!p) return;
    p.opacity = (this.opts.opacity ?? 100) / 100;
    this.start = { x: e.ix, y: e.iy };
    this.end = { x: e.ix, y: e.iy };
  }

  onMove(e) {
    if (!this.painter) return;
    let x = e.ix, y = e.iy;
    if (e.shiftKey) {
      const dx = x - this.start.x, dy = y - this.start.y;
      if (Math.abs(dx) > Math.abs(dy)) y = this.start.y; else x = this.start.x;
    }
    this.end = { x, y };
    this.resetPreview();
    if (!this.painter) return;
    this.paint();
    this.layer.ctx.putImageData(this.painter.image, 0, 0);
    this.app.doc.touch();
    bus.emit('layers');
  }

  paint() {
    const p = this.painter;
    const a = this.app.color.primary, b = this.app.color.secondary;
    const { x: x0, y: y0 } = this.start, { x: x1, y: y1 } = this.end;
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const radial = this.opts.type === 'radial';
    const rad = Math.sqrt(len2) || 1;
    const dither = this.opts.dither;
    const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        if (p.coverage(x, y) <= 0) continue;
        let t;
        if (radial) t = Math.hypot(x - x0, y - y0) / rad;
        else t = len2 ? ((x - x0) * dx + (y - y0) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        if (dither) t = Math.round(t * 8 + (bayer[y & 3][x & 3] / 16 - 0.5)) / 8;
        t = Math.max(0, Math.min(1, t));
        p.color = {
          r: Math.round(a.r + (b.r - a.r) * t),
          g: Math.round(a.g + (b.g - a.g) * t),
          b: Math.round(a.b + (b.b - a.b) * t),
          a: Math.round(a.a + (b.a - a.a) * t),
        };
        p.blend(x, y, 1);
      }
    }
  }

  onUp() { this.endEdit('Gradient'); }
  statusHint() { return 'Drag from start to end color'; }
}

export class EyedropperTool extends Tool {
  static id = 'eyedropper';
  static label = 'Eyedropper';
  static icon = 'eyedropper';
  static cursor = 'crosshair';
  static options = [
    { key: 'sampleAll', type: 'toggle', label: 'Sample all layers', default: true },
  ];

  pick(e) {
    const { doc } = this.app;
    if (e.ix < 0 || e.iy < 0 || e.ix >= doc.width || e.iy >= doc.height) return;
    let src;
    if (this.opts.sampleAll !== false) src = doc.flatten();
    else src = doc.active?.canvas;
    if (!src) return;
    const g = src.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(e.ix, e.iy, 1, 1).data;
    const c = { r: d[0], g: d[1], b: d[2], a: d[3] };
    if (e.button === 2) this.app.color.setSecondary(c);
    else this.app.color.setPrimary(c);
  }

  onDown(e) { this.pick(e); }
  onMove(e) { if (e.buttons) this.pick(e); }
  statusHint() { return 'Click to sample color · Right-click sets secondary'; }
}

export { hexToRgba, rgbaToHex };
