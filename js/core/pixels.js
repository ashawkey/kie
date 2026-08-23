// Direct ImageData pixel engine: exact pixel control for pixel-art editing.
// All tools that paint go through Painter so selection masking, blending and
// dirty-rect tracking behave identically everywhere.
import { DirtyRect } from './history.js';

export class Painter {
  /**
   * @param {ImageData} image  full-layer pixel buffer (mutated in place)
   * @param {Selection} selection
   */
  constructor(image, selection = null) {
    this.image = image;
    this.data = image.data;
    this.w = image.width;
    this.h = image.height;
    this.sel = selection && selection.active ? selection : null;
    this.dirty = new DirtyRect();
    // stroke options
    this.color = { r: 0, g: 0, b: 0, a: 255 };
    this.size = 1;
    this.shape = 'square'; // square | circle
    this.hardness = 1; // 1 = aliased pixel edges
    this.opacity = 1;
    this.mode = 'paint'; // paint | erase
    this._strokeMask = null; // prevents double-blending within one stroke
  }

  beginStroke({ original = null } = {}) {
    if (this.opacity < 1 || this.hardness < 1 || this.sel ||
        (this.mode === 'paint' && this.color.a < 255)) {
      this._strokeMask = new Uint8Array(this.w * this.h);
    } else this._strokeMask = null;
    this.original = original;
  }

  endStroke() {
    this._strokeMask = null;
    this.original = null;
  }

  coverage(x, y) {
    if (!this.sel) return 1;
    return this.sel.at(x, y) / 255;
  }

  getPixel(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
  }

  /** Composite one pixel. `a` is 0..1 coverage of the brush at this pixel. */
  blend(x, y, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    a *= this.coverage(x, y) * this.opacity;
    if (a <= 0) return;
    const p = y * this.w + x;
    // Track the effective source alpha, including paint-color alpha. This
    // makes the strongest stamp win without repeatedly compositing a
    // translucent color where stamps overlap.
    let blendAlpha = this.mode === 'paint' ? (this.color.a / 255) * a : a;
    // Color can change after beginStroke (for example, a secondary-color
    // stroke), so enable overlap protection lazily as well.
    if (!this._strokeMask && blendAlpha < 1) {
      this._strokeMask = new Uint8Array(this.w * this.h);
    }
    if (this._strokeMask) {
      const prev = this._strokeMask[p] / 255;
      const wantByte = Math.max(this._strokeMask[p], Math.min(255, Math.round(blendAlpha * 255)));
      if (wantByte <= this._strokeMask[p]) return;
      const want = wantByte / 255;
      blendAlpha = (want - prev) / (1 - prev || 1);
      this._strokeMask[p] = wantByte;
    }
    const i = p * 4;
    const d = this.data;
    if (this.mode === 'erase') {
      d[i + 3] = Math.round(d[i + 3] * (1 - blendAlpha));
      if (d[i + 3] === 0) { d[i] = d[i + 1] = d[i + 2] = 0; }
    } else {
      const sa = blendAlpha;
      if (sa <= 0) return;
      const da = d[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; return; }
      d[i] = Math.round((this.color.r * sa + d[i] * da * (1 - sa)) / oa);
      d[i + 1] = Math.round((this.color.g * sa + d[i + 1] * da * (1 - sa)) / oa);
      d[i + 2] = Math.round((this.color.b * sa + d[i + 2] * da * (1 - sa)) / oa);
      d[i + 3] = Math.round(oa * 255);
    }
    this.dirty.add(x, y);
  }

  /** Restore a pixel from the pre-stroke buffer (pixel-perfect corner removal). */
  restorePixel(x, y) {
    if (!this.original || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const p = y * this.w + x;
    const i = p * 4;
    const d = this.data, o = this.original;
    d[i] = o[i]; d[i + 1] = o[i + 1]; d[i + 2] = o[i + 2]; d[i + 3] = o[i + 3];
    if (this._strokeMask) this._strokeMask[p] = 0;
    this.dirty.add(x, y);
  }

  /** Hard-set a pixel (used by fills where blending is not wanted). */
  setPixel(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const cov = this.coverage(x, y);
    if (cov <= 0) return;
    if (cov < 1) return this.blend(x, y, 1);
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = c.a ?? 255;
    this.dirty.add(x, y);
  }

  /** Brush footprint centred on integer pixel (cx, cy). */
  stamp(cx, cy) {
    const s = Math.max(1, this.size | 0);
    const r = s / 2;
    const off = Math.floor((s - 1) / 2);
    const x0 = cx - off, y0 = cy - off;
    if (s === 1) { this.blend(cx, cy, 1); return; }
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        let a = 1;
        if (this.shape === 'circle') {
          const dx = x - (s - 1) / 2, dy = y - (s - 1) / 2;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (this.hardness >= 1) {
            if (dist > r - 0.35) continue;
          } else {
            const inner = r * this.hardness;
            if (dist >= r) continue;
            a = dist <= inner ? 1 : 1 - (dist - inner) / (r - inner);
          }
        } else if (this.hardness < 1) {
          const dx = Math.abs(x - (s - 1) / 2) / r, dy = Math.abs(y - (s - 1) / 2) / r;
          const t = Math.max(dx, dy);
          const inner = this.hardness;
          a = t <= inner ? 1 : Math.max(0, 1 - (t - inner) / (1 - inner));
        }
        this.blend(x0 + x, y0 + y, a);
      }
    }
  }

  /** Bresenham line of brush stamps. */
  line(x0, y0, x1, y1, stampFn = null) {
    const stamp = stampFn || ((x, y) => this.stamp(x, y));
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      stamp(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  rect(x0, y0, x1, y1, fill) {
    const ax = Math.min(x0, x1), ay = Math.min(y0, y1);
    const bx = Math.max(x0, x1), by = Math.max(y0, y1);
    if (fill) {
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) this.blend(x, y, 1);
    } else {
      this.line(ax, ay, bx, ay);
      this.line(bx, ay, bx, by);
      this.line(bx, by, ax, by);
      this.line(ax, by, ax, ay);
    }
  }

  /** Midpoint ellipse inscribed in the given box (pixel-art friendly). */
  ellipse(x0, y0, x1, y1, fill) {
    const ax = Math.min(x0, x1), ay = Math.min(y0, y1);
    const bx = Math.max(x0, x1), by = Math.max(y0, y1);
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    const rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5;
    if (rx <= 0 || ry <= 0) return;
    for (let y = ay; y <= by; y++) {
      const dy = (y + 0.5 - cy - 0.5) / ry;
      const inner = 1 - dy * dy;
      if (inner < 0) continue;
      const half = Math.sqrt(inner) * rx;
      const sx = Math.round(cx - half + 0.5), ex = Math.round(cx + half - 0.5);
      if (fill) {
        for (let x = sx; x <= ex; x++) this.blend(x, y, 1);
      } else {
        // outline: mark span ends, and fill gaps against previous row
        this.blend(sx, y, 1);
        this.blend(ex, y, 1);
        if (y === ay || y === by) for (let x = sx; x <= ex; x++) this.blend(x, y, 1);
      }
    }
    if (!fill) {
      // close vertical gaps on steep sides
      const spans = [];
      for (let y = ay; y <= by; y++) {
        const dy = (y + 0.5 - cy - 0.5) / ry;
        const inner = 1 - dy * dy;
        if (inner < 0) { spans.push(null); continue; }
        const half = Math.sqrt(inner) * rx;
        spans.push([Math.round(cx - half + 0.5), Math.round(cx + half - 0.5)]);
      }
      for (let i = 1; i < spans.length; i++) {
        const a = spans[i - 1], b = spans[i];
        if (!a || !b) continue;
        for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) this.blend(x, ay + i, 1);
        for (let x = Math.min(a[1], b[1]); x <= Math.max(a[1], b[1]); x++) this.blend(x, ay + i, 1);
      }
    }
  }

  /** Scanline flood fill. tolerance 0..255, contiguous or global. */
  fill(sx, sy, { tolerance = 0, contiguous = true, sampleData = null } = {}) {
    if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) return;
    const src = sampleData || this.data;
    const w = this.w, h = this.h;
    const i0 = (sy * w + sx) * 4;
    const t = [src[i0], src[i0 + 1], src[i0 + 2], src[i0 + 3]];
    const tol = tolerance * tolerance * 4;
    const match = (i) => {
      const dr = src[i] - t[0], dg = src[i + 1] - t[1], db = src[i + 2] - t[2], da = src[i + 3] - t[3];
      if (src[i + 3] === 0 && t[3] === 0) return true;
      return dr * dr + dg * dg + db * db + da * da <= tol;
    };
    if (!contiguous) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (match((y * w + x) * 4)) this.blend(x, y, 1);
      return;
    }
    const seen = new Uint8Array(w * h);
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      let left = x;
      while (left >= 0 && !seen[y * w + left] && match((y * w + left) * 4)) left--;
      left++;
      let right = x;
      while (right < w && !seen[y * w + right] && match((y * w + right) * 4)) right++;
      right--;
      for (let i = left; i <= right; i++) {
        seen[y * w + i] = 1;
        this.blend(i, y, 1);
        if (y > 0 && !seen[(y - 1) * w + i] && match(((y - 1) * w + i) * 4)) stack.push(i, y - 1);
        if (y < h - 1 && !seen[(y + 1) * w + i] && match(((y + 1) * w + i) * 4)) stack.push(i, y + 1);
      }
    }
  }
}

/**
 * Pixel-perfect stroke filter: drops the middle pixel of L-shaped corners so
 * 1px freehand lines stay clean, as in Aseprite.
 */
export class PixelPerfect {
  constructor() { this.pts = []; }
  reset() { this.pts = []; }
  /** Returns points to draw for the newly added point. */
  push(x, y) {
    const pts = this.pts;
    const last = pts[pts.length - 1];
    if (last && last.x === x && last.y === y) return [];
    pts.push({ x, y });
    const out = [];
    if (pts.length >= 3) {
      const a = pts[pts.length - 3], b = pts[pts.length - 2], c = pts[pts.length - 1];
      const isCorner = Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1 &&
        (b.x === a.x || b.y === a.y) && (b.x === c.x || b.y === c.y);
      if (isCorner) {
        pts.splice(pts.length - 2, 1);
        return [{ erase: b }, { x, y }];
      }
    }
    out.push({ x, y });
    return out;
  }
}
