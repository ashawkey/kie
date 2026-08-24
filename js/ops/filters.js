// Filters operate on the active layer's ImageData, masked by the selection.
import { bus } from '../core/bus.js';
import { pixelEntry } from '../core/history.js';
import { clamp, rgbToHsv, hsvToRgb } from '../core/util.js';

/**
 * Runs `fn(imageData, w, h, params)` on the active layer, honouring the
 * selection mask and pushing a single undo entry.
 */
export function applyFilter(app, label, fn, params = {}) {
  app.prepareMutation();
  const layer = app.doc.active;
  if (!layer || layer.locked) { app.toast('Layer is locked'); return; }
  const sel = app.selection;
  // An active empty selection affects no pixels and records no no-op history.
  if (sel.active && !sel.bounds) return false;
  const { width: w, height: h } = layer.canvas;
  const image = layer.ctx.getImageData(0, 0, w, h);
  const before = new ImageData(new Uint8ClampedArray(image.data), w, h);
  const original = new Uint8ClampedArray(image.data);

  fn(image, w, h, params, original);

  // blend result by selection coverage
  let rect = { x: 0, y: 0, w, h };
  if (sel.active) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cov = sel.at(x, y) / 255;
        if (cov >= 1) continue;
        const i = (y * w + x) * 4;
        for (let k = 0; k < 4; k++) {
          image.data[i + k] = Math.round(original[i + k] + (image.data[i + k] - original[i + k]) * cov);
        }
      }
    }
    rect = { ...sel.bounds };
  }

  layer.ctx.putImageData(image, 0, 0);
  app.doc.touch();
  bus.emit('layers');

  const beforeCrop = cropImageData(before, rect);
  const entry = pixelEntry(app.doc, layer, rect, beforeCrop, label);
  if (entry) app.history.push(entry);
  return !!entry;
}

function cropImageData(image, rect) {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    const s = ((rect.y + y) * image.width + rect.x) * 4;
    out.set(image.data.subarray(s, s + rect.w * 4), y * rect.w * 4);
  }
  return new ImageData(out, rect.w, rect.h);
}

/* ---------- per-pixel adjustments ---------- */

const perPixel = (f) => (image) => {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    f(d, i);
  }
};

export const filters = {
  grayscale: {
    label: 'Grayscale',
    run: perPixel((d, i) => {
      const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }),
  },

  invert: {
    label: 'Invert',
    run: perPixel((d, i) => { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }),
  },

  sepia: {
    label: 'Sepia',
    run: perPixel((d, i) => {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = clamp(r * 0.393 + g * 0.769 + b * 0.189, 0, 255);
      d[i + 1] = clamp(r * 0.349 + g * 0.686 + b * 0.168, 0, 255);
      d[i + 2] = clamp(r * 0.272 + g * 0.534 + b * 0.131, 0, 255);
    }),
  },

  brightness: {
    label: 'Brightness / Contrast',
    params: [
      { key: 'brightness', label: 'Brightness', min: -100, max: 100, default: 0 },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0 },
    ],
    run: (image, w, h, p) => {
      const b = (p.brightness ?? 0) * 2.55;
      const c = p.contrast ?? 0;
      const f = (259 * (c + 255)) / (255 * (259 - c));
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        for (let k = 0; k < 3; k++) d[i + k] = clamp(f * (d[i + k] + b - 128) + 128, 0, 255);
      }
    },
  },

  hsl: {
    label: 'Hue / Saturation',
    params: [
      { key: 'hue', label: 'Hue', min: -180, max: 180, default: 0 },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100, default: 0 },
      { key: 'value', label: 'Value', min: -100, max: 100, default: 0 },
    ],
    run: (image, w, h, p) => {
      const dh = p.hue ?? 0, ds = (p.saturation ?? 0) / 100, dv = (p.value ?? 0) / 100;
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const hsv = rgbToHsv({ r: d[i], g: d[i + 1], b: d[i + 2] });
        hsv.h += dh;
        hsv.s = clamp(hsv.s * (1 + ds) + (ds > 0 ? 0 : 0), 0, 1);
        hsv.v = clamp(hsv.v * (1 + dv), 0, 1);
        const rgb = hsvToRgb(hsv);
        d[i] = rgb.r; d[i + 1] = rgb.g; d[i + 2] = rgb.b;
      }
    },
  },

  posterize: {
    label: 'Posterize',
    params: [{ key: 'levels', label: 'Levels', min: 2, max: 32, default: 5 }],
    run: (image, w, h, p) => {
      const n = Math.max(2, p.levels ?? 5);
      const step = 255 / (n - 1);
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        for (let k = 0; k < 3; k++) d[i + k] = clamp(Math.round(d[i + k] / step) * step, 0, 255);
      }
    },
  },

  threshold: {
    label: 'Threshold',
    params: [{ key: 'level', label: 'Level', min: 0, max: 255, default: 128 }],
    run: (image, w, h, p) => {
      const t = p.level ?? 128;
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 >= t ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    },
  },

  dither: {
    label: 'Ordered Dither',
    params: [{ key: 'levels', label: 'Levels', min: 2, max: 8, default: 2 }],
    run: (image, w, h, p) => {
      const n = Math.max(2, p.levels ?? 2);
      const step = 255 / (n - 1);
      const bayer = [
        [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
        [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
        [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
        [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
      ];
      const d = image.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (d[i + 3] === 0) continue;
          const bias = (bayer[y & 7][x & 7] / 64 - 0.5) * step;
          for (let k = 0; k < 3; k++) d[i + k] = clamp(Math.round((d[i + k] + bias) / step) * step, 0, 255);
        }
      }
    },
  },

  blur: {
    label: 'Gaussian Blur',
    params: [{ key: 'radius', label: 'Radius', min: 1, max: 40, default: 2 }],
    run: (image, w, h, p) => boxBlur(image, w, h, Math.max(1, p.radius ?? 2)),
  },

  sharpen: {
    label: 'Sharpen',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 200, default: 100 }],
    run: (image, w, h, p) => {
      const a = (p.amount ?? 100) / 100;
      convolve(image, w, h, [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0], 3);
    },
  },

  edge: {
    label: 'Find Edges',
    run: (image, w, h) => {
      const src = new Uint8ClampedArray(image.data);
      const d = image.data;
      const lum = (x, y) => {
        x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
        const i = (y * w + x) * 4;
        return src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
      };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const gx = lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1)
            - lum(x - 1, y - 1) - 2 * lum(x - 1, y) - lum(x - 1, y + 1);
          const gy = lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1)
            - lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1);
          const v = clamp(Math.hypot(gx, gy), 0, 255);
          const i = (y * w + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = v;
        }
      }
    },
  },

  outline: {
    label: 'Pixel Outline',
    params: [{ key: 'thickness', label: 'Thickness', min: 1, max: 8, default: 1 }],
    run: (image, w, h, p, original, color = { r: 0, g: 0, b: 0, a: 255 }) => {
      const t = Math.max(1, p.thickness ?? 1);
      const src = new Uint8ClampedArray(image.data);
      const alpha = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src[(y * w + x) * 4 + 3]);
      const c = p.color || color;
      const d = image.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (alpha(x, y) > 0) continue;
          let near = false;
          for (let dy = -t; dy <= t && !near; dy++) {
            for (let dx = -t; dx <= t; dx++) {
              if (dx * dx + dy * dy > t * t) continue;
              if (alpha(x + dx, y + dy) > 0) { near = true; break; }
            }
          }
          if (!near) continue;
          const i = (y * w + x) * 4;
          d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = c.a ?? 255;
        }
      }
    },
  },

  noise: {
    label: 'Noise',
    params: [{ key: 'amount', label: 'Amount', min: 1, max: 100, default: 20 }],
    run: (image, w, h, p) => {
      const a = (p.amount ?? 20) * 2.55;
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const n = (Math.random() - 0.5) * a;
        for (let k = 0; k < 3; k++) d[i + k] = clamp(d[i + k] + n, 0, 255);
      }
    },
  },

  pixelate: {
    label: 'Pixelate',
    params: [{ key: 'size', label: 'Block size', min: 2, max: 64, default: 4 }],
    run: (image, w, h, p) => {
      const s = Math.max(2, p.size ?? 4);
      const d = image.data;
      for (let by = 0; by < h; by += s) {
        for (let bx = 0; bx < w; bx += s) {
          let r = 0, g = 0, b = 0, a = 0, n = 0;
          for (let y = by; y < Math.min(by + s, h); y++) {
            for (let x = bx; x < Math.min(bx + s, w); x++) {
              const i = (y * w + x) * 4;
              r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n++;
            }
          }
          r = r / n | 0; g = g / n | 0; b = b / n | 0; a = a / n | 0;
          for (let y = by; y < Math.min(by + s, h); y++) {
            for (let x = bx; x < Math.min(bx + s, w); x++) {
              const i = (y * w + x) * 4;
              d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
            }
          }
        }
      }
    },
  },
};

/** Three-pass box blur approximating a Gaussian. */
function boxBlur(image, w, h, radius) {
  const d = image.data;
  // premultiply so transparent pixels don't bleed dark colors
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] *= a; d[i + 1] *= a; d[i + 2] *= a;
  }
  let src = new Float32Array(d);
  let dst = new Float32Array(d.length);
  const r = Math.round(radius);
  for (let pass = 0; pass < 3; pass++) {
    blurPass(src, dst, w, h, r, true);
    blurPass(dst, src, w, h, r, false);
  }
  for (let i = 0; i < d.length; i += 4) {
    const a = src[i + 3];
    const inv = a > 0.001 ? 255 / a : 0;
    d[i + 3] = clamp(a, 0, 255);
    d[i] = clamp(src[i] * inv, 0, 255);
    d[i + 1] = clamp(src[i + 1] * inv, 0, 255);
    d[i + 2] = clamp(src[i + 2] * inv, 0, 255);
  }
}

function blurPass(src, dst, w, h, r, horizontal) {
  const n = 2 * r + 1;
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  for (let o = 0; o < outer; o++) {
    const idx = (i) => (horizontal ? (o * w + i) : (i * w + o)) * 4;
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    for (let i = -r; i <= r; i++) {
      const j = idx(clamp(i, 0, inner - 1));
      s0 += src[j]; s1 += src[j + 1]; s2 += src[j + 2]; s3 += src[j + 3];
    }
    for (let i = 0; i < inner; i++) {
      const t = idx(i);
      dst[t] = s0 / n; dst[t + 1] = s1 / n; dst[t + 2] = s2 / n; dst[t + 3] = s3 / n;
      const add = idx(clamp(i + r + 1, 0, inner - 1));
      const sub = idx(clamp(i - r, 0, inner - 1));
      s0 += src[add] - src[sub];
      s1 += src[add + 1] - src[sub + 1];
      s2 += src[add + 2] - src[sub + 2];
      s3 += src[add + 3] - src[sub + 3];
    }
  }
}

function convolve(image, w, h, kernel, size) {
  const src = new Uint8ClampedArray(image.data);
  const d = image.data;
  const half = (size / 2) | 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < size; ky++) {
        for (let kx = 0; kx < size; kx++) {
          const sx = clamp(x + kx - half, 0, w - 1);
          const sy = clamp(y + ky - half, 0, h - 1);
          const i = (sy * w + sx) * 4;
          const k = kernel[ky * size + kx];
          r += src[i] * k; g += src[i + 1] * k; b += src[i + 2] * k;
        }
      }
      const i = (y * w + x) * 4;
      d[i] = clamp(r, 0, 255); d[i + 1] = clamp(g, 0, 255); d[i + 2] = clamp(b, 0, 255);
    }
  }
}
