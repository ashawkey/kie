// Pure operations on selection masks (Uint8 coverage per pixel, 0..255).
//
// Everything here takes and returns plain typed arrays so the ops can be used
// by tools, commands and history without touching live Selection state.

/** Coverage above this counts as "inside" for the shape-based operations. */
const INSIDE = 128;

/**
 * Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher),
 * one 1D pass per axis. `f` holds the seeded costs: 0 on source pixels and
 * INF elsewhere; the result is the squared distance to the nearest source.
 */
function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// A finite stand-in for "unreachable". The transform adds and subtracts these
// costs, and Infinity - Infinity is NaN, which would silently break the
// parabola comparisons in edt1d.
const FAR = 1e20;

/**
 * Squared distance from every pixel to the nearest pixel satisfying `isSource`.
 * Source pixels get 0; a mask with no source pixels yields FAR everywhere.
 */
function squaredDistance(mask, w, h, isSource) {
  const n = w * h;
  const grid = new Float64Array(n);
  for (let i = 0; i < n; i++) grid[i] = isSource(mask[i]) ? 0 : FAR;

  const len = Math.max(w, h);
  const f = new Float64Array(len);
  const d = new Float64Array(len);
  const v = new Int32Array(len);
  const z = new Float64Array(len + 1);

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) grid[row + x] = d[x];
  }
  return grid;
}

const anyInside = (mask, n) => {
  for (let i = 0; i < n; i++) if (mask[i] >= INSIDE) return true;
  return false;
};

/** Grow the selection by `r` pixels in every direction (Select > Expand). */
export function expandMask(mask, w, h, r) {
  const n = w * h;
  const out = new Uint8Array(n);
  if (r <= 0 || !anyInside(mask, n)) { out.set(mask); return out; }
  const d = squaredDistance(mask, w, h, (v) => v >= INSIDE);
  const rr = r * r;
  for (let i = 0; i < n; i++) out[i] = d[i] <= rr ? 255 : 0;
  return out;
}

/** Shrink the selection by `r` pixels (Select > Contract). */
export function contractMask(mask, w, h, r) {
  const n = w * h;
  const out = new Uint8Array(n);
  if (r <= 0 || !anyInside(mask, n)) { out.set(mask); return out; }
  // Distance to the nearest pixel outside the selection. Pixels beyond r from
  // any outside pixel survive; the document edge counts as outside, matching
  // Photoshop's default "apply effect at canvas bounds" behaviour.
  const d = squaredDistanceToOutside(mask, w, h, r);
  const rr = r * r;
  for (let i = 0; i < n; i++) out[i] = d[i] > rr ? 255 : 0;
  return out;
}

/**
 * Like squaredDistance over the unselected pixels, but treating everything
 * beyond the canvas as unselected. The border is seeded by running the
 * transform on a mask padded by `pad` unselected pixels on each side.
 */
function squaredDistanceToOutside(mask, w, h, pad) {
  const p = Math.max(1, Math.ceil(pad));
  const pw = w + p * 2, ph = h + p * 2;
  const padded = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++) padded.set(mask.subarray(y * w, y * w + w), (y + p) * pw + p);
  const d = squaredDistance(padded, pw, ph, (v) => v < INSIDE);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = d[(y + p) * pw + x + p];
  }
  return out;
}

/**
 * Band of width `r` straddling the selection edge (Select > Border): the inner
 * half comes from the selected side, the outer half from the unselected side.
 */
export function borderMask(mask, w, h, r) {
  const n = w * h;
  const out = new Uint8Array(n);
  if (r <= 0 || !anyInside(mask, n)) return out;
  const inner = Math.ceil(r / 2), outer = Math.floor(r / 2);
  const dIn = squaredDistanceToOutside(mask, w, h, inner);
  const dOut = outer > 0 ? squaredDistance(mask, w, h, (v) => v >= INSIDE) : null;
  const ii = inner * inner, oo = outer * outer;
  for (let i = 0; i < n; i++) {
    const selected = mask[i] >= INSIDE;
    if (selected) out[i] = dIn[i] <= ii ? 255 : 0;
    else if (dOut) out[i] = dOut[i] <= oo ? 255 : 0;
  }
  return out;
}

/** One separable box-blur pass over a single-channel mask. */
function boxPass(src, dst, w, h, r, horizontal) {
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const step = horizontal ? 1 : w;
  const window = r * 2 + 1;
  for (let o = 0; o < outer; o++) {
    const base = horizontal ? o * w : o;
    let sum = 0;
    // Edges are clamped, so the running window starts saturated with src[0].
    for (let i = -r; i <= r; i++) sum += src[base + Math.min(inner - 1, Math.max(0, i)) * step];
    for (let i = 0; i < inner; i++) {
      dst[base + i * step] = sum / window;
      const drop = base + Math.min(inner - 1, Math.max(0, i - r)) * step;
      const add = base + Math.min(inner - 1, Math.max(0, i + r + 1)) * step;
      sum += src[add] - src[drop];
    }
  }
}

/** Soften the mask edge (Select > Feather); three box passes ≈ a Gaussian. */
export function featherMask(mask, w, h, radius) {
  const n = w * h;
  if (radius <= 0) { const out = new Uint8Array(n); out.set(mask); return out; }
  const r = Math.max(1, Math.round(radius));
  let a = Float32Array.from(mask);
  let b = new Float32Array(n);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, b, w, h, r, true);
    boxPass(b, a, w, h, r, false);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round(a[i])));
  return out;
}

/** Hard 0/255 coverage — what "Anti-alias: off" means for a selection. */
export function thresholdMask(mask) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] >= INSIDE ? 255 : 0;
  return out;
}

/**
 * Give a hard-edged mask a one-pixel soft rim, so wand selections can be
 * anti-aliased the way Photoshop's Anti-alias checkbox does. Interior and
 * exterior pixels are left exactly as they were.
 */
export function antialiasMask(mask, w, h) {
  const out = new Uint8Array(mask.length);
  out.set(mask);
  const KERNEL = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const centre = mask[i] >= INSIDE;
      let boundary = false;
      let sum = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++, k++) {
          const sx = Math.min(w - 1, Math.max(0, x + dx));
          const sy = Math.min(h - 1, Math.max(0, y + dy));
          const v = mask[sy * w + sx];
          if ((v >= INSIDE) !== centre) boundary = true;
          sum += v * KERNEL[k];
        }
      }
      if (boundary) out[i] = Math.round(sum / 16);
    }
  }
  return out;
}

/** Shift the whole mask; pixels moving in from outside are unselected. */
export function translateMask(mask, w, h, dx, dy) {
  const out = new Uint8Array(w * h);
  const x0 = Math.max(0, dx), x1 = Math.min(w, w + dx);
  const y0 = Math.max(0, dy), y1 = Math.min(h, h + dy);
  for (let y = y0; y < y1; y++) {
    const src = (y - dy) * w + (x0 - dx);
    out.set(mask.subarray(src, src + (x1 - x0)), y * w + x0);
  }
  return out;
}

/** Layer alpha as a selection mask (Ctrl-click a layer thumbnail). */
export function maskFromAlpha(data, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = data[i * 4 + 3];
  return out;
}
