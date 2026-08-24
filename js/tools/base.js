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
  resetInteraction() {}
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
  beginEdit({ needsOriginal = false, configure = null } = {}) {
    if (this.painter) this.cancelEdit();
    this.app.prepareMutation();
    const doc = this.app.doc;
    const layer = doc.active;
    if (!layer || layer.locked || !layer.visible) {
      this.app.toast(layer?.locked ? 'Layer is locked' : 'Layer is hidden');
      return null;
    }
    // An allocated zero-coverage mask is an active empty selection. Bail out
    // before checking out or copying the full layer, constructing Painter, or
    // taking pending-edit ownership; this gesture cannot change any pixel.
    const selection = this.app.selection;
    if (selection?.active && !selection.bounds) return null;
    const { width: w, height: h } = layer.canvas;
    const image = layer.ctx.getImageData(0, 0, w, h);
    this.before = new ImageData(new Uint8ClampedArray(image.data), w, h);
    this.editDoc = doc;
    this.editHistoryStateId = this.app.history.stateId;
    this.layer = layer;
    this.painter = new Painter(image, this.app.selection);
    configure?.(this.painter);
    // Pixel-perfect restoration reads the immutable history/cancel snapshot;
    // do not retain a third full-layer RGBA copy inside Painter.
    this.painter.beginStroke({ original: needsOriginal ? this.before.data : null });
    this.app.beginPendingEdit(this);
    return this.painter;
  }

  deactivate() { this.cancelEdit(); }
  resetInteraction() { this.cancelEdit(); }

  clearEdit() {
    this.painter = null;
    this.before = null;
    this.editDoc = null;
    this.editHistoryStateId = null;
    this.layer = null;
    this.app.endPendingEdit(this);
  }

  abandonEdit() {
    if (!this.painter) return false;
    this.painter.endStroke();
    this.clearEdit();
    return true;
  }

  isEditCurrent() {
    return !!this.painter && this.app.pendingEdit === this && this.app.doc === this.editDoc &&
      this.app.history.stateId === this.editHistoryStateId &&
      this.editDoc.layers.includes(this.layer) && this.editDoc.active === this.layer &&
      this.layer.canvas.width === this.painter.w && this.layer.canvas.height === this.painter.h;
  }

  /** Push current pixels to the layer canvas so the user sees the stroke. */
  flush() {
    if (!this.painter) return;
    if (!this.isEditCurrent()) {
      this.abandonEdit();
      return;
    }
    const d = this.painter.dirty;
    if (d.empty) return;
    this.layer.ctx.putImageData(this.painter.image, 0, 0);
    this.editDoc.touch();
    bus.emit('layers');
  }

  /** Restore layer pixels to pre-stroke state (for shape previews). */
  resetPreview() {
    if (!this.painter || !this.before) return;
    if (!this.isEditCurrent()) {
      this.abandonEdit();
      return;
    }
    this.painter.image.data.set(this.before.data);
    this.painter.dirty.addRect(0, 0, this.painter.w, this.painter.h);
    if (this.painter._strokeMask) this.painter._strokeMask.fill(0);
  }

  endEdit(label) {
    if (!this.painter) return false;
    const p = this.painter;
    const doc = this.editDoc;
    const layer = this.layer;
    if (!this.isEditCurrent()) {
      this.abandonEdit();
      return false;
    }
    p.endStroke();
    let entry = null;
    const d = p.dirty;
    if (!d.empty) {
      d.clampTo(p.w, p.h);
      const rect = d.rect;
      if (rect.w > 0 && rect.h > 0) {
        layer.ctx.putImageData(p.image, 0, 0);
        doc.touch();
        const before = new ImageData(
          cropData(this.before, rect),
          rect.w,
          rect.h,
        );
        entry = pixelEntry(doc, layer, rect, before, label);
        bus.emit('layers');
      }
    }
    this.clearEdit();
    if (entry) this.app.history.push(entry);
    return true;
  }

  stagePendingEdit() {
    if (!this.isEditCurrent()) return null;
    const p = this.painter;
    const doc = this.editDoc;
    const layer = this.layer;
    let entry = null;
    if (!p.dirty.empty) {
      p.dirty.clampTo(p.w, p.h);
      const rect = p.dirty.rect;
      if (rect.w > 0 && rect.h > 0) {
        const before = new ImageData(cropData(this.before, rect), rect.w, rect.h);
        const after = new ImageData(cropData(p.image, rect), rect.w, rect.h);
        const apply = (data) => {
          layer.ctx.putImageData(data, rect.x, rect.y);
          doc.touch();
          bus.emit('layers');
          return true;
        };
        entry = {
          label: this.constructor.label,
          undo: () => apply(before),
          redo: () => apply(after),
        };
      }
    }
    return { painter: p, entry };
  }

  commitStagedPendingEdit(staged) {
    if (!staged || staged.painter !== this.painter || !this.isEditCurrent()) return false;
    this.painter.endStroke();
    const entry = staged.entry;
    this.clearEdit();
    if (entry) this.app.history.push(entry);
    return true;
  }

  commitPendingEdit() { return this.endEdit(this.constructor.label); }
  cancelPendingEdit() { return this.cancelEdit(); }

  cancelEdit() {
    if (!this.painter) return false;
    if (!this.isEditCurrent()) return this.abandonEdit();
    const p = this.painter;
    const doc = this.editDoc;
    const layer = this.layer;
    if (this.app.doc === doc && doc.layers.includes(layer) &&
        layer.canvas.width === this.before.width && layer.canvas.height === this.before.height) {
      layer.ctx.putImageData(this.before, 0, 0);
      doc.touch();
      bus.emit('layers');
    }
    p.endStroke();
    this.clearEdit();
    return true;
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
