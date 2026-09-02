// Import / export / project persistence / clipboard.
import { Doc, Layer } from '../core/doc.js';
import { bus } from '../core/bus.js';
import { t } from '../core/i18n.js';
import {
  downloadBlob, loadImageFromFile, loadImage, makeCanvas, ctx2d, cloneCanvas,
  MAX_EDITOR_DIMENSION, MAX_EDITOR_PIXELS,
} from '../core/util.js';

export const MAX_IMAGE_DIMENSION = MAX_EDITOR_DIMENSION;
export const MAX_IMAGE_PIXELS = MAX_EDITOR_PIXELS;

/** Reject decoded images before constructing any document or layer canvases. */
export function validateImageDimensions(img) {
  const width = img?.naturalWidth, height = img?.naturalHeight;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 ||
      width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION ||
      width * height > MAX_IMAGE_PIXELS) {
    throw new RangeError('Invalid or oversized image dimensions');
  }
  return { width, height };
}

export async function openImageAsDocument(app, file, handle = null,
  expected = app.beginReplacement()) {
  if (!app.isReplacementTokenCurrent(expected)) return false;
  const img = await loadImageFromFile(file);
  if (!app.isReplacementTokenCurrent(expected)) return false;
  const { width, height } = validateImageDimensions(img);
  if (!app.isReplacementTokenCurrent(expected)) return false;
  const doc = new Doc(width, height);
  const layer = new Layer(doc.width, doc.height, file.name.replace(/\.[^.]+$/, '') || 'Image');
  layer.ctx.drawImage(img, 0, 0);
  doc.layers.push(layer);
  doc.activeId = layer.id;
  const ext = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  const fmt = Object.entries(FORMATS).find(([id, f]) =>
    ext ? (ext === f.ext || (id === 'jpeg' && ext === 'jpeg')) : f.mime === file.type);
  // Unsupported inputs are import-only: never link their writable handle to
  // Save, which can only encode one of FORMATS.
  if (!app.isReplacementTokenCurrent(expected)) return false;
  const replaced = await app.setDoc(doc, file.name, fmt ? handle : null, expected);
  if (replaced && fmt) app.exportSettings.format = fmt[0];
  return replaced;
}

export async function importImageAsLayer(app, file,
  token = app.prepareAsyncMutation(), isCurrent = (t) => app.isMutationTokenCurrent(t)) {
  try {
    const img = await loadImageFromFile(file);
    if (!isCurrent(token)) return 'stale';

    // A pointer edit can begin without advancing history while decode is
    // pending. Settle it, then revalidate immediately before any import side
    // effect so its commit cannot be silently followed by this older import.
    app.prepareMutation();
    if (!isCurrent(token)) return 'stale';
    const { width, height } = validateImageDimensions(img);
    if (!isCurrent(token)) return 'stale';

    const doc = token.doc;
    const layer = new Layer(doc.width, doc.height, file.name.replace(/\.[^.]+$/, '') || 'Imported');
    // fit inside the canvas if larger
    const scale = Math.min(1, doc.width / width, doc.height / height);
    const w = Math.round(width * scale), h = Math.round(height * scale);
    layer.ctx.imageSmoothingEnabled = scale < 1;
    layer.ctx.drawImage(img, ((doc.width - w) / 2) | 0, ((doc.height - h) / 2) | 0, w, h);
    if (!isCurrent(token)) return 'stale';
    const index = doc.activeIndex + 1;
    const prevActive = doc.activeId;
    const prevDirty = doc.dirty;
    doc.addLayer(layer, index);
    if (!isCurrent(token)) {
      // addLayer publishes synchronously. An observer may replace the document
      // or advance this document before control returns; remove only our old-
      // document insertion, without recording replacement state. Preserve any
      // newer active choice made by that observer.
      const inserted = doc.layers.indexOf(layer);
      if (inserted >= 0) doc.layers.splice(inserted, 1);
      if (doc.activeId === layer.id) doc.activeId = prevActive;
      // A synchronous observer may already have flattened the temporary stack.
      // Rebuild that cached composite when it was clean before the import;
      // otherwise retain its prior dirty state.
      doc.dirty = true;
      if (!prevDirty) doc.flatten();
      if (app.doc === doc) {
        // Publish the rollback only while this document is still current. This
        // corrects every structural/pixel observer without creating import
        // history. Recheck between events in case a doc observer replaces it.
        bus.emit('doc');
        if (app.doc === doc) bus.emit('layers');
      }
      return 'stale';
    }
    app.history.push({
      label: 'Import Layer',
      undo: () => { doc.removeLayer(layer.id); doc.activeId = prevActive; bus.emit('doc'); },
      redo: () => doc.addLayer(layer, index),
    });
    return 'success';
  } catch {
    // All import failures are explicit so async UI/event callers cannot leak
    // an unhandled rejection. Superseded failures remain completely inert.
    return isCurrent(token) ? 'failure' : 'stale';
  }
}

export const FORMATS = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG', lossless: true, alpha: true, maxDimension: 32767 },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG', lossless: false, alpha: false, maxDimension: 32767 },
  // Lossy WebP stores dimensions in 14 bits even when the canvas is larger.
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP', lossless: false, alpha: true, maxDimension: 16383 },
};

// Match the editor's maximum 8192 × 8192 document footprint. Besides browser
// canvas limits, this prevents a scale from requesting an unbounded RGBA
// allocation (and JPEG's additional matte canvas).
export const MAX_EXPORT_PIXELS = MAX_EDITOR_PIXELS;

/** Validate and return the integer dimensions used by every export path. */
export function exportDimensions(doc, { format = 'png', scale = 1 } = {}) {
  const width = Number(doc?.width), height = Number(doc?.height);
  if (!Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0 ||
      !Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('Invalid export dimensions or scale');
  }
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const maxDimension = (FORMATS[format] || FORMATS.png).maxDimension;
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) ||
      w > maxDimension || h > maxDimension || w * h > MAX_EXPORT_PIXELS) {
    throw new RangeError(`Export dimensions exceed the ${maxDimension}px / ${MAX_EXPORT_PIXELS}px² limit`);
  }
  return { width: w, height: h };
}

/** Largest valid UI scale up to the dialog's 64× convenience limit. */
export function maxExportScale(doc, format = 'png', cap = 64) {
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  let lo = 0, hi = cap;
  try { exportDimensions(doc, { format, scale: hi }); return hi; } catch {}
  for (let i = 0; i < 53; i++) {
    const mid = (lo + hi) / 2;
    try { exportDimensions(doc, { format, scale: mid }); lo = mid; } catch { hi = mid; }
  }
  return lo;
}

export const extFor = (format) => FORMATS[format]?.ext || 'png';

/** Strip any known image/project extension from a document name. */
export const baseName = (name) =>
  (name || 'untitled').replace(/\.(png|jpe?g|webp|gif|bmp|glassx)$/i, '');

/**
 * Render the document to a canvas at the requested scale, matting onto a
 * background when the target format cannot store alpha.
 */
export function renderForExport(app, { format = 'png', scale = 1, matte = '#ffffff' } = {},
  doc = app.doc) {
  const { width: w, height: h } = exportDimensions(doc, { format, scale });
  // Validate before flattening or allocating any export canvas.
  const src = doc.flatten();
  // Never expose the document's mutable cached composite to an asynchronous
  // encoder. Canvas toBlob may read its input after this function returns.
  let out = makeCanvas(w, h);
  const outCtx = ctx2d(out);
  outCtx.imageSmoothingEnabled = scale < 1; // keep pixel art crisp when upscaling
  outCtx.drawImage(src, 0, 0, w, h);
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
export function encodeDataURL(app, opts = {}, doc = app.doc) {
  const { format = 'png', quality = 0.92 } = opts;
  const canvas = renderForExport(app, opts, doc);
  return canvas.toDataURL(FORMATS[format]?.mime || 'image/png', quality);
}

/** Byte length of a base64 data URL payload. */
export function dataURLSize(url) {
  if (typeof url !== 'string') return 0;
  const match = url.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match || !match[1] || match[1].length % 4) return 0;
  const b64 = match[1];
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

const SIGNATURE_BYTES = 12;

function hasImageSignature(bytes, mime) {
  if (mime === 'image/png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= sig.length && sig.every((v, i) => bytes[i] === v);
  }
  if (mime === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === 'image/webp') {
    return bytes.length >= SIGNATURE_BYTES &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

export function dataURLToBlob(url, expectedMime = null) {
  if (typeof url !== 'string') throw new Error('Image encoder returned an invalid data URL');
  const match = url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match || !match[2] || match[2].length % 4 || (expectedMime && match[1] !== expectedMime)) {
    throw new Error('Image encoder returned an invalid data URL');
  }
  let bin;
  try { bin = atob(match[2]); } catch { throw new Error('Image encoder returned malformed data'); }
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  if (!hasImageSignature(buf, match[1])) throw new Error('Image encoder returned malformed data');
  return new Blob([buf], { type: match[1] });
}

async function validateEncodedBlob(blob, mime) {
  if (!(blob instanceof Blob) || blob.size === 0 || blob.type !== mime) {
    throw new Error('Image encoder failed');
  }
  const prefix = new Uint8Array(await blob.slice(0, SIGNATURE_BYTES).arrayBuffer());
  if (!hasImageSignature(prefix, mime)) {
    throw new Error('Image encoder returned malformed data');
  }
  return blob;
}

/** Encode the document to a non-empty, correctly typed image Blob. */
export function encodeImage(app, opts = {}, doc = app.doc) {
  const { format = 'png', quality = 0.92 } = opts;
  const canvas = renderForExport(app, opts, doc);
  const mime = FORMATS[format]?.mime || 'image/png';
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        try {
          // Every encoder result, including the fallback, is validated before
          // it can reach a write or download.
          resolve(validateEncodedBlob(blob || dataURLToBlob(canvas.toDataURL(mime, quality), mime), mime));
        } catch (e) { reject(e); }
      }, mime, quality);
    } catch (e) { reject(e); }
  });
}

export async function exportImage(app, opts = {}) {
  const token = app.prepareAsyncMutation();
  const { format = 'png', filename } = opts;
  // Immediate export has snapshot semantics: later edits may continue while
  // the captured pixels encode, but replacement of the source document makes
  // the completion inert.
  const downloadName = `${baseName(filename || app.docName)}.${extFor(format)}`;
  const blob = await encodeImage(app, opts, token.doc);
  if (!app.isDocumentTokenCurrent(token)) return null;
  downloadBlob(blob, downloadName);
  return blob;
}

/* ---------- File System Access (save in place) ---------- */

export const canUseFileSystem = () => typeof window.showSaveFilePicker === 'function';

/**
 * Open an image through the File System Access picker so the resulting handle
 * can be written back to later. Returns false when the API is unavailable.
 */
export async function openWithPicker(app, expected = app.beginReplacement()) {
  if (typeof window.showOpenFilePicker !== 'function' || !app.isReplacementTokenCurrent(expected)) return false;
  const [handle] = await window.showOpenFilePicker({
    types: [{
      description: t('Images'),
      accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] },
    }],
  });
  if (!app.isReplacementTokenCurrent(expected)) return true;
  const file = await handle.getFile();
  if (app.isReplacementTokenCurrent(expected)) await app.openFile(file, handle, expected);
  // Selection is handled even when decoding fails or replacement is declined;
  // only picker unavailability may fall back to a second input picker.
  return true;
}

/** Ask the user where to write; returns a FileSystemFileHandle. */
export async function pickSaveHandle(suggestedName, format) {
  const f = FORMATS[format] || FORMATS.png;
  return window.showSaveFilePicker({
    suggestedName: `${baseName(suggestedName)}.${f.ext}`,
    types: [{ description: t(`${f.label} image`), accept: { [f.mime]: [`.${f.ext}`] } }],
  });
}

export async function writeHandle(handle, blob, canWrite = null) {
  if (canWrite && !canWrite()) return false;
  const w = await handle.createWritable();
  let closed = false;
  try {
    // createWritable itself is asynchronous, so document identity must be
    // checked again at the last possible point before the physical write.
    if (canWrite && !canWrite()) return false;
    await w.write(blob);
    // File System Access streams normally commit atomically on close. Abort a
    // dialog-bound export that became stale while its bytes were being staged.
    if (canWrite && !canWrite()) return false;
    await w.close();
    // Keep the stream in cleanup-eligible state until the final validity
    // check. close() may already have committed atomically, but a stale or
    // throwing completion must still attempt the API's best-effort abort.
    if (canWrite && !canWrite()) return false;
    closed = true;
    return true;
  } finally {
    // Failed and stale writes still need their stream released. Cleanup is
    // best-effort so an abort failure cannot replace the original result.
    if (!closed) {
      try { await w.abort?.(); } catch { /* best-effort cleanup */ }
    }
  }
}

// Keep linked saves to one handle in invocation order. The settled tail lets a
// failed or cancelled save release the next one without an unhandled rejection.
const handleWriteTails = new WeakMap();
function queueHandleWrite(handle, write) {
  const previous = handleWriteTails.get(handle) || Promise.resolve();
  const result = previous.then(write);
  const tail = result.then(() => {}, () => {});
  handleWriteTails.set(handle, tail);
  return result.finally(() => {
    if (handleWriteTails.get(handle) === tail) handleWriteTails.delete(handle);
  });
}

/** Save the document state captured when Save was invoked to its linked handle. */
export function saveToFile(app, opts = {}) {
  app.prepareMutation();
  const doc = app.doc;
  const handle = app.fileHandle;
  if (!handle) return Promise.resolve(null);
  const stateId = app.history.stateId;
  const documentEpoch = app.documentEpoch;
  // renderForExport snapshots the pixels synchronously, before toBlob finishes.
  const blobPromise = encodeImage(app, opts, doc);
  blobPromise.catch(() => {});

  return queueHandleWrite(handle, async () => {
    // Linked Save intentionally permits later revisions: it writes its
    // invocation-time snapshot and marks only that state saved. Replacement
    // identity/epoch and handle association must remain stable throughout.
    const isCurrent = () => app.doc === doc && app.documentEpoch === documentEpoch &&
      app.fileHandle === handle;
    const perm = await handle.queryPermission?.({ mode: 'readwrite' });
    if (!isCurrent()) return { written: false };
    if (perm !== 'granted') {
      const req = await handle.requestPermission?.({ mode: 'readwrite' });
      if (!isCurrent()) return { written: false };
      // Only denial for the document that initiated this Save may fall back
      // to Save As; a replacement document must remain untouched.
      if (req !== 'granted') return null;
    }
    // A queued save must never write or clean a replacement document, even if
    // that replacement happens to be linked to the same handle object.
    const blob = await blobPromise;
    if (!isCurrent()) return { written: false };
    const written = await writeHandle(handle, blob, isCurrent);
    if (!written) return { written: false };
    return { written: true, blob, doc, documentEpoch, stateId, handle };
  });
}

/* ---------- project (.glassx = JSON) ---------- */

// One shared policy drives loader resource protection and saver preflight.
// Layer-producing editor operations intentionally remain unrestricted: users
// can still work with states that are unsuitable for a single huge project
// file, while Save Project rejects those states visibly before encoding.
export const PROJECT_LIMITS = Object.freeze({
  maxDimension: 8192,
  maxLayers: 128,
  maxLayerPixels: 8192 * 8192,
  maxJsonBytes: 384 * 1024 * 1024,
  maxLayerNameLength: 1024,
});
const PROJECT_BLENDS = new Set([
  'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);
const PNG_DATA_PREFIX = 'data:image/png;base64,';

const projectError = () => new Error('Invalid project file');

function pngDimensionsFromDataURL(url, expectedPixels) {
  if (typeof url !== 'string' || !url.startsWith(PNG_DATA_PREFIX)) throw projectError();
  const payload = url.slice(PNG_DATA_PREFIX.length);
  if (!payload || payload.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw projectError();
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const encodedBytes = payload.length / 4 * 3 - padding;
  // Canvas PNG output needs roughly four bytes per noisy RGBA pixel. Leave
  // modest format overhead without allowing tiny layers to carry huge blobs.
  if (encodedBytes > expectedPixels * 5 + 65536) throw projectError();

  let prefix;
  try { prefix = atob(payload.slice(0, 32)); } catch { throw projectError(); }
  const byte = (i) => prefix.charCodeAt(i);
  const u32 = (i) => ((byte(i) * 0x1000000) + (byte(i + 1) << 16) +
    (byte(i + 2) << 8) + byte(i + 3));
  if (prefix.length < 24 ||
      byte(0) !== 0x89 || prefix.slice(1, 4) !== 'PNG' ||
      byte(4) !== 0x0d || byte(5) !== 0x0a || byte(6) !== 0x1a || byte(7) !== 0x0a ||
      u32(8) !== 13 || prefix.slice(12, 16) !== 'IHDR') {
    throw projectError();
  }
  return { width: u32(16), height: u32(20), encodedBytes };
}

function validateProject(data, textLength) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      data.format !== 'glass-editor') {
    throw projectError();
  }
  const { width, height, layers } = data;
  if (!Number.isSafeInteger(width) || width < 1 || width > PROJECT_LIMITS.maxDimension ||
      !Number.isSafeInteger(height) || height < 1 || height > PROJECT_LIMITS.maxDimension ||
      !Array.isArray(layers) || layers.length < 1 || layers.length > PROJECT_LIMITS.maxLayers) {
    throw projectError();
  }
  const activeIndex = data.activeIndex ?? 0;
  if (!Number.isSafeInteger(activeIndex) || activeIndex < 0 || activeIndex >= layers.length) {
    throw projectError();
  }
  const pixels = width * height;
  if (pixels * layers.length > PROJECT_LIMITS.maxLayerPixels ||
      textLength > PROJECT_LIMITS.maxJsonBytes) {
    throw projectError();
  }

  let totalEncodedBytes = 0;
  const validatedLayers = layers.map((layer) => {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) throw projectError();
    if (layer.name !== undefined &&
        (typeof layer.name !== 'string' || layer.name.length > PROJECT_LIMITS.maxLayerNameLength)) {
      throw projectError();
    }
    if (layer.visible !== undefined && typeof layer.visible !== 'boolean') throw projectError();
    if (layer.locked !== undefined && typeof layer.locked !== 'boolean') throw projectError();
    if (layer.opacity !== undefined &&
        (typeof layer.opacity !== 'number' || !Number.isFinite(layer.opacity) ||
         layer.opacity < 0 || layer.opacity > 1)) {
      throw projectError();
    }
    if (layer.blend !== undefined &&
        (typeof layer.blend !== 'string' || !PROJECT_BLENDS.has(layer.blend))) {
      throw projectError();
    }
    const image = pngDimensionsFromDataURL(layer.data, pixels);
    if (image.width !== width || image.height !== height) throw projectError();
    totalEncodedBytes += image.encodedBytes;
    if (totalEncodedBytes > PROJECT_LIMITS.maxJsonBytes) throw projectError();
    return {
      name: layer.name ?? 'Layer',
      visible: layer.visible ?? true,
      opacity: layer.opacity ?? 1,
      blend: layer.blend ?? 'source-over',
      locked: layer.locked ?? false,
      data: layer.data,
    };
  });
  return { width, height, activeIndex, layers: validatedLayers };
}

const projectSaveError = (detail, n) => {
  const e = new Error(`Project cannot be saved: ${String(detail).replace('{n}', n ?? '')}`);
  // The UI translates detail + number separately at the toast boundary.
  e.detail = detail;
  e.detailArgs = n;
  return e;
};

/**
 * Reject an editor state before expensive per-layer PNG encoding. Project
 * limits protect load-time canvas allocation; exceeding them does not prevent
 * ordinary editing or image export.
 */
function preflightProjectSave(doc) {
  const { maxDimension, maxLayers, maxLayerPixels, maxLayerNameLength } = PROJECT_LIMITS;
  const width = doc?.width, height = doc?.height, layers = doc?.layers;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width > maxDimension || height > maxDimension) {
    throw projectSaveError('dimensions must be between 1 and {n}px', maxDimension);
  }
  if (!Array.isArray(layers) || layers.length < 1) {
    throw projectSaveError('the document must contain at least one layer');
  }
  if (layers.length > maxLayers) {
    throw projectSaveError('the {n}-layer limit is exceeded; merge or delete layers', maxLayers);
  }
  const pixels = width * height;
  if (pixels * layers.length > maxLayerPixels) {
    const allowed = Math.floor(maxLayerPixels / pixels);
    throw projectSaveError(allowed === 1
      ? 'this canvas size supports at most 1 project layer; merge or delete layers'
      : 'this canvas size supports at most {n} project layers; merge or delete layers',
      allowed);
  }
  if (!Number.isSafeInteger(doc.activeIndex) || doc.activeIndex < 0 ||
      doc.activeIndex >= layers.length) {
    throw projectSaveError('select an active layer and try again');
  }
  for (const layer of layers) {
    if (!layer || typeof layer.name !== 'string' || layer.name.length > maxLayerNameLength) {
      throw projectSaveError('layer names must be at most {n} characters', maxLayerNameLength);
    }
    if (typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' ||
        typeof layer.opacity !== 'number' || !Number.isFinite(layer.opacity) ||
        layer.opacity < 0 || layer.opacity > 1 ||
        typeof layer.blend !== 'string' || !PROJECT_BLENDS.has(layer.blend)) {
      throw projectSaveError('a layer has invalid properties');
    }
    if (layer.canvas?.width !== width || layer.canvas?.height !== height ||
        typeof layer.canvas?.toDataURL !== 'function') {
      throw projectSaveError('a layer has invalid dimensions');
    }
  }
}

export function saveProject(app) {
  app.prepareMutation();
  const doc = app.doc;
  preflightProjectSave(doc);
  let data;
  try {
    data = {
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
    // Validate the exact serialized representation with the loader's own
    // checks. This catches failed encoders and oversized PNG payloads.
    const text = JSON.stringify(data);
    validateProject(data, text.length);
    const blob = new Blob([text], { type: 'application/json' });
    // The loader checks byte size before reading; non-ASCII names can make it
    // larger than JavaScript's string length.
    if (blob.size > PROJECT_LIMITS.maxJsonBytes) {
      throw projectSaveError('the encoded project is too large; merge layers or reduce the canvas size');
    }
    downloadBlob(blob, `${(app.docName || 'untitled').replace(/\.[^.]+$/, '')}.glassx`);
    return blob;
  } catch (e) {
    if (e?.message?.startsWith('Project cannot be saved:')) throw e;
    throw projectSaveError('a layer could not be encoded; merge layers or reduce the canvas size');
  }
}

export async function loadProject(app, file, expected = app.beginReplacement()) {
  if (!app.isReplacementTokenCurrent(expected)) return false;
  if (Number.isFinite(file?.size) && file.size > PROJECT_LIMITS.maxJsonBytes) throw projectError();
  const text = await file.text();
  if (!app.isReplacementTokenCurrent(expected)) return false;
  if (typeof text !== 'string' || text.length > PROJECT_LIMITS.maxJsonBytes) throw projectError();
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw projectError(); }
  const data = validateProject(parsed, text.length);

  // Structural and encoded-header validation is complete before the first
  // canvas is constructed. The current document remains untouched until all
  // images decode and the replacement token wins at setDoc.
  const doc = new Doc(data.width, data.height);
  for (const l of data.layers) {
    if (!app.isReplacementTokenCurrent(expected)) return false;
    let img;
    try { img = await loadImage(l.data); } catch { throw projectError(); }
    if (!app.isReplacementTokenCurrent(expected)) return false;
    if (img.naturalWidth !== data.width || img.naturalHeight !== data.height) throw projectError();
    const layer = new Layer(data.width, data.height, l.name);
    layer.ctx.drawImage(img, 0, 0);
    layer.visible = l.visible;
    layer.opacity = l.opacity;
    layer.blend = l.blend;
    layer.locked = l.locked;
    doc.layers.push(layer);
  }
  doc.activeId = doc.layers[data.activeIndex].id;
  if (!app.isReplacementTokenCurrent(expected)) return false;
  return app.setDoc(doc, file.name, null, expected);
}

/* ---------- clipboard ---------- */

/**
 * Copy the selected pixels to the internal clipboard. `merged` copies the
 * flattened composite instead of the active layer (Edit > Copy Merged).
 */
export function copySelection(app, { merged = false } = {}) {
  const source = merged ? app.doc.flatten() : app.doc.active?.canvas;
  if (!source) return null;
  const sel = app.selection;
  // Empty is an active selection with no bounds. It must not fall through to
  // the null-selection behavior and copy the entire layer.
  if (sel.active && !sel.bounds) return null;
  const rect = sel.active ? sel.bounds : { x: 0, y: 0, w: app.doc.width, h: app.doc.height };
  const c = makeCanvas(rect.w, rect.h);
  const g = ctx2d(c);
  g.drawImage(source, -rect.x, -rect.y);
  if (sel.active) {
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(sel.toCanvas(), -rect.x, -rect.y);
  }
  app.clipboard = { canvas: c, x: rect.x, y: rect.y };
  return app.clipboard;
}

export function pasteClipboard(app, expected = app.prepareAsyncMutation(), clip = app.clipboard) {
  // A direct/exported caller carrying a clipboard invocation must obey the
  // same latest-invocation ownership as pasteFromSystem. Plain mutation tokens
  // retain the internal clipboard API's existing behavior.
  const clipboardOwned = expected && Object.hasOwn(expected, 'clipboardInvocation');
  const current = clipboardOwned
    ? () => app.isClipboardTokenCurrent(expected)
    : () => app.isMutationTokenCurrent(expected);
  // history.push advances the mutation revision itself; after that side effect,
  // ownership is the stable document plus (when present) clipboard invocation.
  const ownsAfterPush = () => app.doc === expected.doc &&
    app.documentEpoch === expected.documentEpoch &&
    (!clipboardOwned || expected.clipboardInvocation === app.clipboardInvocation);

  // Settlement can commit an edit and invalidate the token. Nothing below,
  // including empty-state feedback, may happen until ownership is rechecked.
  app.prepareMutation();
  if (!current()) return false;
  if (!clip) {
    if (!current()) return false;
    app.toast('Clipboard is empty');
    return false;
  }
  const doc = expected.doc;
  const layer = new Layer(doc.width, doc.height, 'Pasted');
  layer.ctx.drawImage(clip.canvas, clip.x, clip.y);
  const index = doc.activeIndex + 1;
  const prevActive = doc.activeId;
  if (!current()) return false;
  app.clipboard = clip;
  if (!current()) return false;
  doc.addLayer(layer, index);
  if (!current()) {
    // A synchronous bus listener can start a newer paste during addLayer.
    // Roll back this now-stale insertion without publishing history or toast.
    doc.removeLayer(layer.id);
    doc.activeId = prevActive;
    return false;
  }
  app.history.push({
    label: 'Paste',
    undo: () => { doc.removeLayer(layer.id); doc.activeId = prevActive; bus.emit('doc'); },
    redo: () => doc.addLayer(layer, index),
  });
  // Recheck after history listeners settle. A newer invocation suppresses all
  // remaining stale side effects, including success feedback.
  if (!ownsAfterPush()) return false;
  app.toast('Pasted as new layer');
  return true;
}

const PASTE_STALE = 'stale';
const PASTE_INTERNAL = 'internal';
const PASTE_SYSTEM = 'system';
const PASTE_EMPTY = 'empty';

export async function pasteFromSystem(app) {
  // Browser paste events and command-driven system reads share one monotonic
  // owner. Equivalent document/history tokens cannot let an older completion
  // win after a newer paste starts (including a newer empty/cancelled paste).
  const token = app.beginClipboardInvocation();
  const current = () => app.isClipboardTokenCurrent(token);
  const fallback = () => {
    if (!current()) return PASTE_STALE;
    if (!app.clipboard) {
      // Let the normal internal path provide its existing empty-state feedback.
      pasteClipboard(app, token);
      return current() ? PASTE_EMPTY : PASTE_STALE;
    }
    return pasteClipboard(app, token) ? PASTE_INTERNAL : PASTE_STALE;
  };

  if (!navigator.clipboard?.read) return fallback();
  try {
    const items = await navigator.clipboard.read();
    if (!current()) return PASTE_STALE;
    for (const item of items) {
      const type = Array.from(item.types || []).find((t) => t.startsWith('image/'));
      if (!type) continue;
      if (!current()) return PASTE_STALE;
      const blob = await item.getType(type);
      if (!current()) return PASTE_STALE;
      const img = await loadImageFromFile(blob);
      if (!current()) return PASTE_STALE;
      const { width, height } = validateImageDimensions(img);
      if (!current()) return PASTE_STALE;
      const c = makeCanvas(width, height);
      ctx2d(c).drawImage(img, 0, 0);
      if (!current()) return PASTE_STALE;
      const clip = { canvas: c, x: 0, y: 0 };
      return pasteClipboard(app, token, clip) ? PASTE_SYSTEM : PASTE_STALE;
    }
  } catch {
    // Unsupported formats, permissions, and read/decode errors retain the
    // internal fallback only while this original transaction remains current.
    if (!current()) return PASTE_STALE;
  }
  return fallback();
}

export { cloneCanvas };
