// Undo/redo. Entries are {label, undo(), redo()} closures.
// Pixel edits use dirty-rect ImageData snapshots to keep memory bounded.
import { bus } from './bus.js';

const LIMIT = 120;

export class History {
  constructor() {
    this.past = [];
    this.future = [];
    this._nextStateId = 1;
    this.stateId = 0;
    // Monotonic even when undo/redo returns to an earlier logical state.
    // Long-lived gestures and dialogs use this to reject stale completions.
    this.revision = 0;
  }

  push(entry) {
    entry.beforeStateId = this.stateId;
    entry.afterStateId = this._nextStateId++;
    this.stateId = entry.afterStateId;
    this.revision++;
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
    const e = this.past[this.past.length - 1];
    if (!e) return false;
    try {
      if (e.undo() === false) return false;
    } catch {
      return false;
    }
    this.past.pop();
    this.future.push(e);
    this.stateId = e.beforeStateId;
    this.revision++;
    bus.emit('history');
    return true;
  }

  redo() {
    const e = this.future[this.future.length - 1];
    if (!e) return false;
    try {
      if (e.redo() === false) return false;
    } catch {
      return false;
    }
    this.future.pop();
    this.past.push(e);
    this.stateId = e.afterStateId;
    this.revision++;
    bus.emit('history');
    return true;
  }

  clear() {
    this.past.length = 0;
    this.future.length = 0;
    this.stateId = this._nextStateId++;
    this.revision++;
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
export function layerEntry(doc, layer, before, label) {
  const after = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  const apply = (src) => {
    if (src instanceof ImageData) {
      layer.ctx.putImageData(src, 0, 0);
    } else {
      layer.ctx.save();
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      layer.ctx.drawImage(src, 0, 0);
      layer.ctx.restore();
    }
    doc.touch();
    bus.emit('layers');
  };
  return { label, undo: () => apply(before), redo: () => apply(after) };
}
