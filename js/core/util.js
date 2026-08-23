// Small DOM + math + color helpers.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export const MAX_EDITOR_DIMENSION = 8192;
export const MAX_EDITOR_PIXELS = MAX_EDITOR_DIMENSION * MAX_EDITOR_DIMENSION;
const MAX_CANVAS_DIMENSION = 32767;

/** Validate dimensions before assigning them to an HTML canvas. */
export function validateCanvasDimensions(w, h, maxDimension = MAX_CANVAS_DIMENSION) {
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) ||
      w < 1 || h < 1 || w > maxDimension || h > maxDimension ||
      w * h > MAX_EDITOR_PIXELS) {
    throw new RangeError('Invalid or oversized canvas dimensions');
  }
  return { width: w, height: h };
}

export function validateEditorDimensions(w, h) {
  return validateCanvasDimensions(w, h, MAX_EDITOR_DIMENSION);
}

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function makeCanvas(w, h) {
  const { width, height } = validateCanvasDimensions(w, h);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function ctx2d(canvas, opts) {
  const c = canvas.getContext('2d', opts);
  c.imageSmoothingEnabled = false;
  return c;
}

export function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

/* ---------- color ---------- */

export function hexToRgba(hex) {
  hex = hex.trim().replace(/^#/, '');
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  if (hex.length === 6) hex += 'ff';
  if (!/^[0-9a-fA-F]{8}$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  return { r: (n >>> 24) & 255, g: (n >>> 16) & 255, b: (n >>> 8) & 255, a: n & 255 };
}

const h2 = (v) => v.toString(16).padStart(2, '0');
export const rgbToHex = (c) => '#' + h2(c.r) + h2(c.g) + h2(c.b);
export const rgbaToHex = (c) => '#' + h2(c.r) + h2(c.g) + h2(c.b) + h2(c.a ?? 255);
export const rgbaCss = (c) => `rgba(${c.r},${c.g},${c.b},${(c.a ?? 255) / 255})`;

export function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return { r: Math.round((t[0] + m) * 255), g: Math.round((t[1] + m) * 255), b: Math.round((t[2] + m) * 255) };
}

/* ---------- misc ---------- */

/** Trailing-edge debounce. */
export function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function loadImageFromFile(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

export function pickFile(accept) {
  return new Promise((res) => {
    const input = el('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { res(input.files[0] || null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}
