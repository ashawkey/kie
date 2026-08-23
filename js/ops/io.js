// Import / export / project persistence / clipboard.
import { Doc, Layer } from '../core/doc.js';
import { bus } from '../core/bus.js';
import { downloadBlob, loadImageFromFile, loadImage, makeCanvas, ctx2d, cloneCanvas } from '../core/util.js';

export async function openImageAsDocument(app, file, handle = null) {
  const img = await loadImageFromFile(file);
  const doc = new Doc(img.naturalWidth, img.naturalHeight);
  const layer = new Layer(doc.width, doc.height, file.name.replace(/\.[^.]+$/, '') || 'Image');
  layer.ctx.drawImage(img, 0, 0);
  doc.layers.push(layer);
  doc.activeId = layer.id;
  app.setDoc(doc, file.name, handle);
  // Reopening the same format keeps Save writing the same kind of file.
  const fmt = Object.entries(FORMATS).find(([, f]) => f.mime === file.type);
  if (fmt) app.exportSettings.format = fmt[0];
}

export async function importImageAsLayer(app, file) {
  const img = await loadImageFromFile(file);
  const doc = app.doc;
  const layer = new Layer(doc.width, doc.height, file.name.replace(/\.[^.]+$/, '') || 'Imported');
  // fit inside the canvas if larger
  const scale = Math.min(1, doc.width / img.naturalWidth, doc.height / img.naturalHeight);
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  layer.ctx.imageSmoothingEnabled = scale < 1;
  layer.ctx.drawImage(img, ((doc.width - w) / 2) | 0, ((doc.height - h) / 2) | 0, w, h);
  const index = doc.activeIndex + 1;
  const prevActive = doc.activeId;
  doc.addLayer(layer, index);
  app.history.push({
    label: 'Import Layer',
    undo: () => { doc.removeLayer(layer.id); doc.activeId = prevActive; bus.emit('doc'); },
    redo: () => doc.addLayer(layer, index),
  });
}

export const FORMATS = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG', lossless: true, alpha: true },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG', lossless: false, alpha: false },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP', lossless: false, alpha: true },
};

export const extFor = (format) => FORMATS[format]?.ext || 'png';

/** Strip any known image/project extension from a document name. */
export const baseName = (name) =>
  (name || 'untitled').replace(/\.(png|jpe?g|webp|gif|bmp|glassx)$/i, '');

/**
 * Render the document to a canvas at the requested scale, matting onto a
 * background when the target format cannot store alpha.
 */
export function renderForExport(app, { format = 'png', scale = 1, matte = '#ffffff' } = {}) {
  const doc = app.doc;
  const src = doc.flatten();
  let out = src;
  const w = Math.max(1, Math.round(doc.width * scale));
  const h = Math.max(1, Math.round(doc.height * scale));
  if (w !== doc.width || h !== doc.height) {
    out = makeCanvas(w, h);
    const g = ctx2d(out);
    g.imageSmoothingEnabled = scale < 1; // keep pixel art crisp when upscaling
    g.drawImage(src, 0, 0, w, h);
  }
  if (!FORMATS[format]?.alpha) {
    const flat = makeCanvas(out.width, out.height);
    const g = ctx2d(flat);
    g.fillStyle = matte;
    g.fillRect(0, 0, flat.width, flat.height);
    g.drawImage(out, 0, 0);
    out = flat;
  }
  return out;
}

/**
 * Encode synchronously to a data URL. Used for the export preview because it
 * yields the encoded bytes immediately, so the size estimate is exact.
 */
export function encodeDataURL(app, opts = {}) {
  const { format = 'png', quality = 0.92 } = opts;
  const canvas = renderForExport(app, opts);
  return canvas.toDataURL(FORMATS[format]?.mime || 'image/png', quality);
}

/** Byte length of a base64 data URL payload. */
export function dataURLSize(url) {
  const i = url.indexOf(',');
  if (i < 0) return 0;
  const b64 = url.slice(i + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function dataURLToBlob(url) {
  const [head, b64] = url.split(',');
  const mime = head.match(/:(.*?);/)?.[1] || 'image/png';
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

/** Encode the document to a Blob using the given export settings. */
export function encodeImage(app, opts = {}) {
  const { format = 'png', quality = 0.92 } = opts;
  const canvas = renderForExport(app, opts);
  const mime = FORMATS[format]?.mime || 'image/png';
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b || dataURLToBlob(encodeDataURL(app, opts))), mime, quality);
  });
}

export async function exportImage(app, opts = {}) {
  const { format = 'png', filename } = opts;
  const blob = await encodeImage(app, opts);
  const base = baseName(filename || app.docName);
  downloadBlob(blob, `${base}.${extFor(format)}`);
  return blob;
}

/* ---------- File System Access (save in place) ---------- */

export const canUseFileSystem = () => typeof window.showSaveFilePicker === 'function';

/**
 * Open an image through the File System Access picker so the resulting handle
 * can be written back to later. Returns false when the API is unavailable.
 */
export async function openWithPicker(app) {
  if (typeof window.showOpenFilePicker !== 'function') return false;
  const [handle] = await window.showOpenFilePicker({
    types: [{
      description: 'Images',
      accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] },
    }],
  });
  const file = await handle.getFile();
  await openImageAsDocument(app, file, handle);
  return true;
}

/** Ask the user where to write; returns a FileSystemFileHandle. */
export async function pickSaveHandle(suggestedName, format) {
  const f = FORMATS[format] || FORMATS.png;
  return window.showSaveFilePicker({
    suggestedName: `${baseName(suggestedName)}.${f.ext}`,
    types: [{ description: `${f.label} image`, accept: { [f.mime]: [`.${f.ext}`] } }],
  });
}

export async function writeHandle(handle, blob) {
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}

/**
 * Save to the file the document is linked to. Falls back to a download when
 * the File System Access API is unavailable or permission is refused.
 */
export async function saveToFile(app, opts = {}) {
  const handle = app.fileHandle;
  if (!handle) return exportImage(app, opts);
  const perm = await handle.queryPermission?.({ mode: 'readwrite' });
  if (perm !== 'granted') {
    const req = await handle.requestPermission?.({ mode: 'readwrite' });
    if (req !== 'granted') return exportImage(app, opts);
  }
  const blob = await encodeImage(app, opts);
  await writeHandle(handle, blob);
  return blob;
}

/* ---------- project (.glassx = JSON) ---------- */

export function saveProject(app) {
  const doc = app.doc;
  const data = {
    format: 'glass-editor',
    version: 1,
    width: doc.width,
    height: doc.height,
    activeIndex: doc.activeIndex,
    layers: doc.layers.map((l) => ({
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      blend: l.blend,
      locked: l.locked,
      data: l.canvas.toDataURL('image/png'),
    })),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  downloadBlob(blob, `${(app.docName || 'untitled').replace(/\.[^.]+$/, '')}.glassx`);
}

export async function loadProject(app, file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data.format !== 'glass-editor') throw new Error('Not a project file');
  const doc = new Doc(data.width, data.height);
  for (const l of data.layers) {
    const layer = new Layer(data.width, data.height, l.name);
    const img = await loadImage(l.data);
    layer.ctx.drawImage(img, 0, 0);
    layer.visible = l.visible !== false;
    layer.opacity = l.opacity ?? 1;
    layer.blend = l.blend || 'source-over';
    layer.locked = !!l.locked;
    doc.layers.push(layer);
  }
  doc.activeId = doc.layers[Math.max(0, Math.min(data.activeIndex ?? 0, doc.layers.length - 1))]?.id ?? null;
  app.setDoc(doc, file.name);
}

/* ---------- clipboard ---------- */

export function copySelection(app) {
  const layer = app.doc.active;
  if (!layer) return null;
  const sel = app.selection;
  const rect = sel.active && sel.bounds ? sel.bounds : { x: 0, y: 0, w: app.doc.width, h: app.doc.height };
  const c = makeCanvas(rect.w, rect.h);
  const g = ctx2d(c);
  g.drawImage(layer.canvas, -rect.x, -rect.y);
  if (sel.active) {
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(sel.toCanvas(), -rect.x, -rect.y);
  }
  app.clipboard = { canvas: c, x: rect.x, y: rect.y };
  return app.clipboard;
}

export function pasteClipboard(app) {
  const clip = app.clipboard;
  if (!clip) { app.toast('Clipboard is empty'); return; }
  const doc = app.doc;
  const layer = new Layer(doc.width, doc.height, 'Pasted');
  layer.ctx.drawImage(clip.canvas, clip.x, clip.y);
  const index = doc.activeIndex + 1;
  const prevActive = doc.activeId;
  doc.addLayer(layer, index);
  app.history.push({
    label: 'Paste',
    undo: () => { doc.removeLayer(layer.id); doc.activeId = prevActive; bus.emit('doc'); },
    redo: () => doc.addLayer(layer, index),
  });
  app.toast('Pasted as new layer');
}

export async function pasteFromSystem(app) {
  if (!navigator.clipboard?.read) return false;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const img = await loadImageFromFile(blob);
      const c = makeCanvas(img.naturalWidth, img.naturalHeight);
      ctx2d(c).drawImage(img, 0, 0);
      app.clipboard = { canvas: c, x: 0, y: 0 };
      pasteClipboard(app);
      return true;
    }
  } catch { /* permission denied or unsupported */ }
  return false;
}

export { cloneCanvas };
