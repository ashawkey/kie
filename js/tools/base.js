// Tool base class + shared stroke plumbing.
import { Painter } from '../core/pixels.js';
import { pixelEntry } from '../core/history.js';
import { bus } from '../core/bus.js';

export class Tool {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
  }

  static id = 'tool';
  static label = 'Tool';
  static icon = '';
  static cursor = 'crosshair';
  /** Option descriptors rendered into the options bar. */
  static options = [];

  get opts() { return this.app.toolOptions[this.constructor.id] || {}; }

  activate() {}
  deactivate() {}
  onDown(_e) {}
  onMove(_e) {}
  onUp(_e) {}
  onKey(_e) { return false; }
  drawOverlay(_g, _view) {}
  statusHint() { return ''; }
}

/**
 * Base for tools that write pixels into the active layer.
 * Handles: layer checks, ImageData checkout, selection masking,
 * live preview flush, and dirty-rect undo entries.
 */
export class PixelTool extends Tool {
  beginEdit({ keepOriginal = false } = {}) {
    const layer = this.app.doc.active;
    if (!layer || layer.locked || !layer.visible) {
      this.app.toast(layer?.locked ? 'Layer is locked' : 'Layer is hidden');
      return null;
    }
    const { width: w, height: h } = layer.canvas;
    const image = layer.ctx.getImageData(0, 0, w, h);
    this.before = new ImageData(new Uint8ClampedArray(image.data), w, h);
    this.layer = layer;
    this.painter = new Painter(image, this.app.selection);
    this.painter.beginStroke({ keepOriginal });
    return this.painter;
  }

  /** Push current pixels to the layer canvas so the user sees the stroke. */
  flush() {
    if (!this.painter) return;
    const d = this.painter.dirty;
    if (d.empty) return;
    this.layer.ctx.putImageData(this.painter.image, 0, 0);
    this.app.doc.touch();
    bus.emit('layers');
  }

  /** Restore layer pixels to pre-stroke state (for shape previews). */
  resetPreview() {
    if (!this.painter || !this.before) return;
    this.painter.image.data.set(this.before.data);
    this.painter.dirty.addRect(0, 0, this.painter.w, this.painter.h);
    if (this.painter._strokeMask) this.painter._strokeMask.fill(0);
  }

  endEdit(label) {
    if (!this.painter) return;
    const p = this.painter;
    p.endStroke();
    const d = p.dirty;
    if (!d.empty) {
      d.clampTo(p.w, p.h);
      const rect = d.rect;
      this.layer.ctx.putImageData(p.image, 0, 0);
      this.app.doc.touch();
      const before = new ImageData(
        cropData(this.before, rect),
        rect.w,
        rect.h,
      );
      const entry = pixelEntry(this.app.doc, this.layer, rect, before, label);
      if (entry) this.app.history.push(entry);
      bus.emit('layers');
    }
    this.painter = null;
    this.before = null;
    this.layer = null;
  }

  cancelEdit() {
    if (!this.painter) return;
    this.resetPreview();
    this.layer.ctx.putImageData(this.painter.image, 0, 0);
    this.app.doc.touch();
    this.painter.endStroke();
    this.painter = null;
    this.before = null;
    this.layer = null;
    bus.emit('layers');
  }
}

function cropData(image, rect) {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    const srcStart = ((rect.y + y) * image.width + rect.x) * 4;
    out.set(image.data.subarray(srcStart, srcStart + rect.w * 4), y * rect.w * 4);
  }
  return out;
}
