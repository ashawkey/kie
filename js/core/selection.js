// Pixel selection mask (Uint8 coverage per pixel, 0..255) + marching-ants outline.
import { bus } from './bus.js';
import { makeCanvas, ctx2d } from './util.js';
import { featherMask, thresholdMask, translateMask } from './mask.js';

export class Selection {
  constructor(w, h) {
    this.resize(w, h);
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.mask = null; // null == select all
    this.bounds = null;
    this.lastMask = null;
    this._outline = null;
  }

  get active() { return this.mask !== null; }

  /** Coverage 0..255 at pixel; 255 when no selection exists. */
  at(x, y) {
    if (!this.mask) return 255;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.mask[y * this.width + x];
  }

  clear() {
    // Reselect restores whatever was dropped here, so remember it before the
    // mask goes. Undo has its own snapshots and must not disturb this.
    if (this.mask && this.bounds) this.lastMask = this.mask;
    this.mask = null;
    this.bounds = null;
    this._outline = null;
    bus.emit('selection');
  }

  /**
   * True when a deselected mask is still available and still matches the
   * document size — a crop or resize leaves the remembered mask unusable.
   */
  get canReselect() {
    return !!this.lastMask && this.lastMask.length === this.width * this.height;
  }

  /** Re-activate the selection that was most recently deselected. */
  reselect() {
    if (!this.canReselect) return false;
    this.set(this.lastMask.slice());
    return true;
  }

  /** Shift the mask by whole pixels (arrow keys with a selection tool). */
  translate(dx, dy) {
    if (!this.mask || (!dx && !dy)) return false;
    this.set(translateMask(this.mask, this.width, this.height, dx, dy));
    return true;
  }

  set(mask) {
    this.mask = mask;
    this._recompute();
    bus.emit('selection');
  }

  snapshot() {
    return this.mask ? this.mask.slice() : null;
  }

  restore(mask) {
    this.mask = mask ? mask.slice() : null;
    this._recompute();
    bus.emit('selection');
  }

  _recompute() {
    this._outline = null;
    if (!this.mask) { this.bounds = null; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const { width: w, height: h, mask } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x >= x1) x1 = x + 1;
          if (y >= y1) y1 = y + 1;
        }
      }
    }
    // An allocated all-zero mask is an active empty selection. Do not collapse
    // it to null: null is the distinct unrestricted/select-all state used by
    // pixel operations.
    if (x1 <= x0) { this.bounds = null; return; }
    this.bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * Replace mask from a shape drawn into a temp canvas (rect/ellipse/lasso).
   * Canvas path fills are always anti-aliased, so a hard-edged selection has
   * to be thresholded back to 0/255 afterwards.
   */
  fromShape(drawFn, mode = 'replace', { antialias = true, feather = 0 } = {}) {
    const c = makeCanvas(this.width, this.height);
    const g = ctx2d(c, { willReadFrequently: true });
    g.fillStyle = '#fff';
    drawFn(g);
    const src = g.getImageData(0, 0, this.width, this.height).data;
    const n = this.width * this.height;
    let next = new Uint8Array(n);
    for (let i = 0; i < n; i++) next[i] = src[i * 4 + 3];
    if (!antialias) next = thresholdMask(next);
    // Feather softens the new shape before it is combined, exactly like the
    // options-bar Feather value in Photoshop.
    if (feather > 0) next = featherMask(next, this.width, this.height, feather);
    this.set(combine(this.mask, next, mode, n));
  }

  /** Marching-ants edge segments in image space, cached. */
  outline() {
    if (this._outline) return this._outline;
    const path = new Path2D();
    if (this.mask) {
      const { width: w, height: h, mask } = this;
      const on = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x] > 127);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!on(x, y)) continue;
          if (!on(x, y - 1)) { path.moveTo(x, y); path.lineTo(x + 1, y); }
          if (!on(x, y + 1)) { path.moveTo(x, y + 1); path.lineTo(x + 1, y + 1); }
          if (!on(x - 1, y)) { path.moveTo(x, y); path.lineTo(x, y + 1); }
          if (!on(x + 1, y)) { path.moveTo(x + 1, y); path.lineTo(x + 1, y + 1); }
        }
      }
    }
    this._outline = path;
    return path;
  }

  /** Canvas whose alpha equals the mask; used for clipping composites. */
  toCanvas() {
    const c = makeCanvas(this.width, this.height);
    if (!this.mask) {
      const g = ctx2d(c);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, this.width, this.height);
      return c;
    }
    const g = ctx2d(c);
    const img = g.createImageData(this.width, this.height);
    for (let i = 0; i < this.mask.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = this.mask[i];
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  selectAll() {
    const n = this.width * this.height;
    this.set(new Uint8Array(n).fill(255));
  }

  invert() {
    const n = this.width * this.height;
    const next = new Uint8Array(n);
    for (let i = 0; i < n; i++) next[i] = 255 - (this.mask ? this.mask[i] : 255);
    this.set(next);
  }
}

export function combine(prev, next, mode, n) {
  if (mode === 'replace') return next;
  // null is the unrestricted state: editing affects every pixel because
  // nothing has been selected yet. Boolean ops start from it as an empty set
  // the way every other editor does — add/intersect yield the new region, and
  // subtracting from nothing leaves nothing — so Shift/Alt on a fresh canvas
  // cannot surprise the user with a whole-document or inverted selection.
  if (!prev) return mode === 'subtract' ? null : next;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = prev[i], b = next[i];
    out[i] = mode === 'add' ? Math.max(a, b)
      : mode === 'subtract' ? Math.max(0, a - b)
      : Math.min(a, b); // intersect
  }
  return out;
}
