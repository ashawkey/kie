// Undo/redo. Entries are {label, undo(), redo()} closures.
// Pixel edits use dirty-rect ImageData snapshots to keep memory bounded.
import { bus } from './bus.js';
import { cloneCanvas } from './util.js';

const LIMIT = 120;

export class History {
  constructor() {
    this.past = [];
    this.future = [];
  }

  push(entry) {
    this.past.push(entry);
    if (this.past.length > LIMIT) this.past.shift();
    this.future.length = 0;
    bus.emit('history');
  }

  /** Run an action now and record it. redo() defaults to re-running `fn`. */
  run(label, fn, undo) {
    fn();
    this.push({ label, redo: fn, undo });
  }

  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }

  undo() {
    const e = this.past.pop();
    if (!e) return;
    e.undo();
    this.future.push(e);
    bus.emit('history');
  }

  redo() {
    const e = this.future.pop();
    if (!e) return;
    e.redo();
    this.past.push(e);
    bus.emit('history');
  }

  clear() {
    this.past.length = 0;
    this.future.length = 0;
    bus.emit('history');
  }
}

/** Tracks a bounding box of modified pixels. */
export class DirtyRect {
  constructor() { this.reset(); }
  reset() { this.x0 = Infinity; this.y0 = Infinity; this.x1 = -Infinity; this.y1 = -Infinity; }
  get empty() { return this.x1 < this.x0; }
  add(x, y) { this.addRect(x, y, 1, 1); }
  addRect(x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    if (x < this.x0) this.x0 = x;
    if (y < this.y0) this.y0 = y;
    if (x + w > this.x1) this.x1 = x + w;
    if (y + h > this.y1) this.y1 = y + h;
  }
  clampTo(w, h) {
    this.x0 = Math.max(0, Math.floor(this.x0));
    this.y0 = Math.max(0, Math.floor(this.y0));
    this.x1 = Math.min(w, Math.ceil(this.x1));
    this.y1 = Math.min(h, Math.ceil(this.y1));
  }
  get rect() { return { x: this.x0, y: this.y0, w: this.x1 - this.x0, h: this.y1 - this.y0 }; }
}

/**
 * Snapshot helper for a rectangular region of a layer.
 * begin() before editing, commit() after; returns a history entry or null.
 */
export function snapshotRegion(layer, rect) {
  const { x, y, w, h } = rect;
  if (w <= 0 || h <= 0) return null;
  return layer.ctx.getImageData(x, y, w, h);
}

export function pixelEntry(doc, layer, rect, before, label = 'Paint') {
  const after = snapshotRegion(layer, rect);
  if (!before || !after) return null;
  const apply = (data) => {
    layer.ctx.putImageData(data, rect.x, rect.y);
    doc.touch();
    bus.emit('layers');
  };
  return { label, undo: () => apply(before), redo: () => apply(after) };
}

/** Full-canvas snapshot entry (for transforms / whole-layer ops). */
export function layerEntry(doc, layer, beforeCanvas, label) {
  const after = cloneCanvas(layer.canvas);
  const apply = (src) => {
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layer.ctx.drawImage(src, 0, 0);
    doc.touch();
    bus.emit('layers');
  };
  return { label, undo: () => apply(beforeCanvas), redo: () => apply(after) };
}
