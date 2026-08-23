// Export dialog: format, scale, quality, live preview and size estimate.
import { el, debounce, downloadBlob } from '../core/util.js';
import { dialog, toast } from './modal.js';
import { t } from '../core/i18n.js';
import {
  FORMATS, extFor, baseName, encodeImage, encodeDataURL, dataURLSize,
  maxExportScale, exportDimensions, canUseFileSystem, pickSaveHandle, writeHandle, saveToFile,
} from '../ops/io.js';

const fmtBytes = (n) => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

export async function showExportDialog(app) {
  // Export / Save As is dialog-bound rather than an immediate snapshot action:
  // any replacement or edit while it is open invalidates the whole operation.
  const token = app.prepareAsyncMutation();
  const doc = token.doc;
  const state = {
    format: FORMATS[app.exportSettings.format] ? app.exportSettings.format : 'png',
    scale: Number.isFinite(app.exportSettings.scale) && app.exportSettings.scale > 0
      ? app.exportSettings.scale : 1,
    quality: app.exportSettings.quality,
    name: baseName(app.docName),
  };
  state.scale = Math.min(state.scale, maxExportScale(doc, state.format));

  /* ---- controls ---- */
  const nameInput = el('input', { class: 'ginput', value: state.name, spellcheck: 'false' });
  const extLabel = el('span', { class: 'gchip', text: `.${extFor(state.format)}` });

  const formatRow = el('div', {
    class: 'seg',
    'data-tip': t('Format'),
    'data-tip-desc': t('Output file format. PNG keeps transparency; JPEG does not.'),
    'data-tip-side': 'above',
  });
  const formatBtns = new Map();
  for (const [id, f] of Object.entries(FORMATS)) {
    const b = el('button', { class: 'gbtn seg-btn', text: f.label });
    b.addEventListener('click', () => {
      state.format = id;
      state.scale = Math.min(state.scale, maxExportScale(doc, id));
      scaleInput.value = state.scale;
      refresh(true);
    });
    formatBtns.set(id, b);
    formatRow.appendChild(b);
  }

  const scaleRow = el('div', {
    class: 'seg',
    'data-tip': t('Scale'),
    'data-tip-desc': t('Multiply the exported size — ideal for sharing pixel art.'),
    'data-tip-side': 'above',
  });
  const scaleBtns = new Map();
  for (const s of [1, 2, 4, 8, 16]) {
    const b = el('button', { class: 'gbtn seg-btn', text: `${s}×` });
    b.addEventListener('click', () => { state.scale = s; scaleInput.value = s; refresh(true); });
    scaleBtns.set(s, b);
    scaleRow.appendChild(b);
  }
  const scaleInput = el('input', {
    class: 'ginput num', type: 'number', min: 0.1, max: 64, step: 1, value: state.scale,
  });
  scaleInput.addEventListener('input', () => {
    const v = Number(scaleInput.value);
    const max = maxExportScale(doc, state.format);
    if (Number.isFinite(v) && v > 0) {
      state.scale = Math.min(max, v);
      if (v > max) scaleInput.value = max;
      refresh();
    }
  });
  scaleInput.addEventListener('keydown', (e) => e.stopPropagation());

  const qualityInput = el('input', {
    class: 'grange', type: 'range', min: 1, max: 100, step: 1, value: Math.round(state.quality * 100),
  });
  const qualityVal = el('span', { class: 'val', text: `${Math.round(state.quality * 100)}%` });
  qualityInput.addEventListener('input', () => {
    state.quality = parseInt(qualityInput.value, 10) / 100;
    qualityVal.textContent = `${qualityInput.value}%`;
    refresh();
  });
  const qualityRow = el('div', { class: 'field' }, [
    el('span', { class: 'glabel', text: t('Quality') }), qualityInput, qualityVal,
  ]);

  const preview = el('img', { class: 'export-preview checker', alt: t('Export preview') });
  const dimOut = el('strong', { text: '—' });
  const sizeOut = el('strong', { text: '…' });
  const noteOut = el('span', { class: 'export-note' });

  const body = el('div', { class: 'export' }, [
    el('div', { class: 'export-preview-wrap' }, [preview]),
    el('div', { class: 'export-stats' }, [
      el('div', {}, [el('span', { class: 'glabel', text: t('Dimensions') }), dimOut]),
      el('div', {}, [el('span', { class: 'glabel', text: t('Estimated size') }), sizeOut]),
    ]),
    noteOut,
    el('div', { class: 'field' }, [el('span', { class: 'glabel', text: t('File name') }), nameInput, extLabel]),
    el('div', { class: 'field' }, [el('span', { class: 'glabel', text: t('Format') }), formatRow]),
    el('div', { class: 'field' }, [el('span', { class: 'glabel', text: t('Scale') }), scaleRow, scaleInput]),
    qualityRow,
  ]);

  nameInput.addEventListener('input', () => { state.name = nameInput.value; });
  nameInput.addEventListener('keydown', (e) => e.stopPropagation());

  /* ---- live preview + exact size estimate ---- */
  // Encoding is synchronous so the preview and the byte count always agree;
  // debouncing keeps dragging the quality slider responsive on large images.
  const recompute = () => {
    if (!app.isMutationTokenCurrent(token)) return;
    try {
      const url = encodeDataURL(app, state, doc);
      const size = dataURLSize(url);
      if (!size) throw new Error('Image encoder failed');
      preview.src = url;
      sizeOut.textContent = fmtBytes(size);
    } catch {
      preview.removeAttribute('src');
      sizeOut.textContent = t('Could not export image');
    }
  };
  const recomputeSoon = debounce(recompute, 90);

  function refresh(immediate = false) {
    const f = FORMATS[state.format];
    const maxScale = maxExportScale(doc, state.format);
    scaleInput.max = maxScale;
    for (const [id, b] of formatBtns) b.classList.toggle('active', id === state.format);
    for (const [s, b] of scaleBtns) {
      b.classList.toggle('active', s === state.scale);
      b.disabled = s > maxScale;
    }
    extLabel.textContent = `.${f.ext}`;
    qualityRow.style.display = f.lossless ? 'none' : '';
    const { width: w, height: h } = exportDimensions(doc, state);
    dimOut.textContent = `${w} × ${h} px`;

    // Fit the preview to the box. Small images are magnified by a whole number
    // so pixel art stays evenly sized rather than blurring between pixels.
    const BOX = 186;
    const raw = BOX / Math.max(w, h);
    const k = raw >= 1 ? Math.max(1, Math.floor(raw)) : raw;
    preview.style.width = `${Math.round(w * k)}px`;
    preview.style.height = `${Math.round(h * k)}px`;
    noteOut.textContent = f.lossless
      ? t('PNG is lossless and keeps transparency.')
      : f.alpha
        ? t('WebP is lossy at this quality but keeps transparency.')
        : t('JPEG has no transparency — transparent areas become white.');
    // Show the new preview immediately; only re-encode lazily while dragging.
    if (immediate) recompute();
    else { sizeOut.textContent = '…'; recomputeSoon(); }
  }

  refresh(true);

  const result = await dialog({
    title: t('Export Image'),
    subtitle: t('Source document is {size} px.').replace('{size}', `${doc.width} × ${doc.height}`),
    body,
    confirm: canUseFileSystem() ? t('Save As…') : t('Export'),
    size: 'export',
  });

  if (!result || !app.isMutationTokenCurrent(token)) return;

  // Remember the settings for the next Save.
  Object.assign(app.exportSettings, {
    format: state.format, scale: state.scale, quality: state.quality,
  });

  const stateId = token.stateId;
  let blob;
  try { blob = await encodeImage(app, state, doc); }
  catch {
    if (app.isMutationTokenCurrent(token)) toast(t('Could not export image'));
    return;
  }
  if (!app.isMutationTokenCurrent(token)) return;
  const filename = `${baseName(state.name) || 'untitled'}.${extFor(state.format)}`;

  if (canUseFileSystem()) {
    try {
      const handle = await pickSaveHandle(state.name, state.format);
      if (!app.isMutationTokenCurrent(token)) return;
      const written = await writeHandle(handle, blob, () => app.isMutationTokenCurrent(token));
      if (!written || !app.isMutationTokenCurrent(token)) return;
      app.linkFile(handle, handle.name, stateId, doc, token.documentEpoch);
      if (app.isMutationTokenCurrent(token)) toast(`${t('Saved')} ${handle.name}`);
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // user cancelled the picker
      // fall through to a plain download only for the same untouched source.
    }
  }
  if (!app.isMutationTokenCurrent(token)) return;
  downloadBlob(blob, filename);
  if (!app.isMutationTokenCurrent(token)) return;
  app.docName = filename;
  app.markSaved(stateId, doc, token.documentEpoch);
  if (app.isMutationTokenCurrent(token)) toast(`${t('Exported')} ${filename}`);
}

/** Save to the linked file, or fall back to the dialog when there is none. */
export async function saveDocument(app) {
  app.prepareMutation();
  if (!app.fileHandle) return showExportDialog(app);
  try {
    const saved = await saveToFile(app, app.exportSettings);
    if (!saved) return showExportDialog(app);
    if (!saved.written) return;
    if (app.doc === saved.doc && app.documentEpoch === saved.documentEpoch &&
        app.fileHandle === saved.handle) {
      app.markSaved(saved.stateId, saved.doc, saved.documentEpoch);
    }
    if (app.doc === saved.doc && app.documentEpoch === saved.documentEpoch &&
        app.fileHandle === saved.handle) toast(`${t('Saved')} ${saved.handle.name}`);
  } catch (e) {
    if (e?.name === 'AbortError') return;
    toast(t('Could not save — use Export instead'));
  }
}
