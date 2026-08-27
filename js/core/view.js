// Viewport: pan/zoom mapping between screen and image space.
import { bus } from './bus.js';
import { clamp } from './util.js';

const ZOOMS = [0.05, 0.1, 0.17, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const MIN_SCALE = 0.02;
const MAX_SCALE = 128;
// Smooth-zoom approach speed (1/s): the live scale eases toward the target
// with a ~50 ms time constant, so coarse wheel notches glide instead of jump.
const ZOOM_SPEED = 20;
// Wheel-to-target sensitivity per pixel of travel: one mouse notch
// (~100 px delta) moves the target ~1.2×.
const WHEEL_SENSITIVITY = 0.002;
// Trackpad pinch events (ctrl + wheel) carry small deltas and expect a
// stronger response per pixel than a mouse notch.
const PINCH_SENSITIVITY = 0.0125;
const PINCH_MAX_DELTA = 10;

export class View {
  constructor() {
    this.scale = 1;
    this.x = 0; // image-space point at viewport centre
    this.y = 0;
    this.vw = 1;
    this.vh = 1;
    this._zoomTarget = null; // target scale while a smooth zoom is in flight
    this._zoomAnchor = null; // screen point kept fixed during the ease
    this._zoomRaf = 0;
  }

  setViewport(w, h) {
    this.vw = w;
    this.vh = h;
  }

  toImage(sx, sy) {
    return {
      x: (sx - this.vw / 2) / this.scale + this.x,
      y: (sy - this.vh / 2) / this.scale + this.y,
    };
  }

  toScreen(ix, iy) {
    return {
      x: (ix - this.x) * this.scale + this.vw / 2,
      y: (iy - this.y) * this.scale + this.vh / 2,
    };
  }

  pan(dxScreen, dyScreen) {
    this.x -= dxScreen / this.scale;
    this.y -= dyScreen / this.scale;
    bus.emit('view');
  }

  setScale(scale, anchorScreen = null) {
    this.cancelZoom();
    const next = clamp(scale, MIN_SCALE, MAX_SCALE);
    if (Math.abs(next - this.scale) < 1e-9) return;
    if (anchorScreen) {
      const before = this.toImage(anchorScreen.x, anchorScreen.y);
      this.scale = next;
      const after = this.toImage(anchorScreen.x, anchorScreen.y);
      this.x += before.x - after.x;
      this.y += before.y - after.y;
    } else {
      this.scale = next;
    }
    bus.emit('view');
  }

  zoomStep(dir, anchorScreen) {
    const s = this.scale;
    let target;
    if (dir > 0) target = ZOOMS.find((z) => z > s * 1.001) ?? s * 2;
    else target = [...ZOOMS].reverse().find((z) => z < s * 0.999) ?? s / 2;
    this.setScale(target, anchorScreen);
  }

  /**
   * Smooth zoom: `factor` accumulates into a target scale, and a rAF loop
   * eases the live scale toward it, keeping the anchor screen point fixed
   * (the viewport centre when anchorScreen is null). Events fired before
   * the easing settles accumulate into the same target.
   */
  zoomBy(factor, anchorScreen = null) {
    const base = this._zoomTarget ?? this.scale;
    const target = clamp(base * factor, MIN_SCALE, MAX_SCALE);
    if (target === base) return;
    this._zoomTarget = target;
    this._zoomAnchor = anchorScreen ?? { x: this.vw / 2, y: this.vh / 2 };
    if (this._zoomRaf) return;
    let lastT = 0;
    const step = (t) => {
      this._zoomRaf = 0;
      if (this._zoomTarget == null) return; // cancelled mid-flight
      const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 1 / 60;
      lastT = t;
      const cur = Math.log(this.scale);
      const tgt = Math.log(this._zoomTarget);
      const done = Math.abs(tgt - cur) < 1e-5;
      const next = done ? this._zoomTarget
        : Math.exp(cur + (tgt - cur) * (1 - Math.exp(-ZOOM_SPEED * dt)));
      this._zoomTo(next);
      if (done) {
        this._zoomTarget = null;
        this._zoomAnchor = null;
      } else {
        this._zoomRaf = requestAnimationFrame(step);
      }
    };
    this._zoomRaf = requestAnimationFrame(step);
  }

  /** Turn a wheel/pinch event into a smooth zoom gesture. */
  wheelZoom(e, anchorScreen = null) {
    // Normalise line/page deltas to pixels of wheel travel.
    const dy = e.deltaMode === 1 ? e.deltaY * 33
      : e.deltaMode === 2 ? e.deltaY * 200
      : e.deltaY;
    const pinch = e.ctrlKey && Math.abs(dy) < PINCH_MAX_DELTA;
    this.zoomBy(Math.exp(-dy * (pinch ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY)), anchorScreen);
  }

  /** Set the scale, keeping the image point under the zoom anchor fixed. */
  _zoomTo(next) {
    const a = this._zoomAnchor;
    const before = this.toImage(a.x, a.y);
    this.scale = next;
    const after = this.toImage(a.x, a.y);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    bus.emit('view');
  }

  /** Stop an in-flight smooth zoom, leaving the scale where it currently is. */
  cancelZoom() {
    if (this._zoomRaf) cancelAnimationFrame(this._zoomRaf);
    this._zoomRaf = 0;
    this._zoomTarget = null;
    this._zoomAnchor = null;
  }

  fit(w, h, padding = 48) {
    this.cancelZoom();
    const s = Math.min((this.vw - padding) / w, (this.vh - padding) / h);
    this.scale = clamp(s, MIN_SCALE, MAX_SCALE);
    this.x = w / 2;
    this.y = h / 2;
    bus.emit('view');
  }

  center(w, h) {
    this.x = w / 2;
    this.y = h / 2;
    bus.emit('view');
  }
}
