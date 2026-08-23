// Viewport: pan/zoom mapping between screen and image space.
import { bus } from './bus.js';
import { clamp } from './util.js';

const ZOOMS = [0.05, 0.1, 0.17, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export class View {
  constructor() {
    this.scale = 1;
    this.x = 0; // image-space point at viewport centre
    this.y = 0;
    this.vw = 1;
    this.vh = 1;
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
    const next = clamp(scale, 0.02, 128);
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

  zoomBy(factor, anchorScreen) {
    this.setScale(this.scale * factor, anchorScreen);
  }

  fit(w, h, padding = 48) {
    const s = Math.min((this.vw - padding) / w, (this.vh - padding) / h);
    this.scale = clamp(s, 0.02, 128);
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
