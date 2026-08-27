// Command registry: single source of truth for menus + keyboard shortcuts.
import { bus } from '../core/bus.js';
import { Doc } from '../core/doc.js';
import { el, pickFile, rgbaCss, makeCanvas, ctx2d } from '../core/util.js';
import { dialog, toast } from './modal.js';
import { showHelp } from './help.js';
import { t } from '../core/i18n.js';
import { filters, applyFilter } from '../ops/filters.js';
import {
  resizeImage, resizeCanvasTo, trimTransparentEdges, flipDoc, rotateDoc, transformLayer,
  addLayer, duplicateLayer, deleteLayer, moveLayer, mergeDown, flattenImage,
  clearSelection, fillSelection,
} from '../ops/image.js';
import {
  importImageAsLayer, exportImage, openWithPicker,
  saveProject, loadProject, copySelection, pasteFromSystem,
} from '../ops/io.js';
import { showExportDialog, saveDocument } from './export.js';
import { beginSession, commitSession } from '../tools/transform.js';

// Shortcut label pieces; separators differ between macOS and other platforms.
const IS_MAC = navigator.platform.toLowerCase().includes('mac');
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';
const ALT = IS_MAC ? '⌥' : 'Alt+';

export const COMMAND_TRANSACTION = Object.freeze({
  SETTLE: 'settle',
  MANAGED: 'managed',
  HISTORY: 'history',
  VIEW: 'view',
});

export function registerCommands(app) {
  const c = new Map();
  const add = (id, def) => c.set(id, {
    id,
    transaction: COMMAND_TRANSACTION.SETTLE,
    ...def,
  });

  /* ---------------- File ---------------- */

  add('file.new', {
    label: 'New…', key: `${MOD}N`, icon: 'plus',
    run: async () => {
      const token = app.beginReplacement();
      const presets = [
        ['16 × 16', 16, 16], ['32 × 32', 32, 32], ['64 × 64', 64, 64],
        ['128 × 128', 128, 128], ['256 × 256', 256, 256], ['512 × 512', 512, 512],
      ];
      const grid = el('div', { class: 'preset-grid' });
      let api = null;
      // Build presets before opening the modal; dialog consumes this node
      // synchronously and supplies its input API through onChange.
      for (const [label, w, h] of presets) {
        grid.appendChild(el('button', {
          class: 'gbtn',
          onclick: () => {
            api.inputs.width.value = w; api.values.width = w;
            api.inputs.height.value = h; api.values.height = h;
          },
        }, [el('span', { text: label }), el('small', { text: `${w}×${h} px` })]));
      }
      const r = await dialog({
        title: t('New Image'),
        subtitle: t('Pick a preset or enter a custom size.'),
        body: grid,
        fields: [
          { key: 'width', type: 'number', label: t('Width'), default: 64, min: 1, max: 8192 },
          { key: 'height', type: 'number', label: t('Height'), default: 64, min: 1, max: 8192 },
          {
            key: 'background', type: 'select', label: t('Background'), default: 'transparent',
            choices: [['transparent', t('Transparent')], ['white', t('White')], ['black', t('Black')], ['primary', t('Primary color')]],
          },
        ],
        confirm: t('Create'),
        onChange: (_v, a) => { api = a; },
      });
      if (!r || !app.isReplacementTokenCurrent(token)) return;
      const fill = r.background === 'white' ? '#ffffff'
        : r.background === 'black' ? '#000000'
        : r.background === 'primary' ? rgbaCss(app.color.primary) : null;
      await app.setDoc(Doc.blank(Math.round(r.width), Math.round(r.height), fill), 'untitled', null, token);
    },
  });

  add('file.open', {
    label: 'Open Image…', key: `${MOD}O`,
    run: async () => {
      const token = app.beginReplacement();
      // Prefer the picker that yields a writable handle, so Save works later.
      // Cancellation is inert; only API unavailability falls back. Once a file
      // was selected, app.openFile owns decode failure feedback and no second
      // picker may be shown.
      try {
        if (await openWithPicker(app, token)) return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
        if (app.isReplacementTokenCurrent(token)) app.toast('Could not open image');
        return;
      }
      if (!app.isReplacementTokenCurrent(token)) return;
      const f = await pickFile('image/*');
      if (f && app.isReplacementTokenCurrent(token)) await app.openFile(f, null, token);
    },
  });

  add('file.import', {
    label: 'Import as Layer…',
    run: async () => {
      const token = app.prepareAsyncMutation();
      const f = await pickFile('image/*');
      if (!f || !app.isMutationTokenCurrent(token)) return;
      const result = await importImageAsLayer(app, f, token);
      if (result === 'failure' && app.isMutationTokenCurrent(token)) {
        toast(t('Could not import image'));
      }
    },
  });

  add('file.save', {
    label: (a) => (a.fileHandle ? `${t('Save')} ${a.docName}` : 'Save…'), title: 'Save',
    key: `${MOD}S`, icon: 'save',
    run: () => saveDocument(app),
  });

  add('file.export', {
    label: 'Export / Save As…', key: `${MOD}${SHIFT}S`, icon: 'export',
    run: () => showExportDialog(app),
  });

  add('file.export.png', {
    label: 'Quick Export PNG',
    run: async () => {
      try {
        const blob = await exportImage(app, { format: 'png' });
        if (blob) toast(t('Exported PNG'));
      } catch { toast(t('Could not export image')); }
    },
  });

  add('file.project.save', {
    label: 'Save Project (.glassx)',
    run: () => {
      try {
        if (saveProject(app)) toast(t('Project saved'));
      } catch (e) {
        // projectSaveError carries a translatable detail; anything else falls back.
        app.toast(e?.detail
          ? `${t('Project cannot be saved')}: ${t(e.detail).replace('{n}', e.detailArgs)}`
          : t(e?.message || 'Project cannot be saved'));
      }
    },
  });
  add('file.project.open', {
    label: 'Open Project…',
    run: async () => {
      const token = app.beginReplacement();
      const f = await pickFile('.glassx,application/json');
      if (!f || !app.isReplacementTokenCurrent(token)) return;
      try { await loadProject(app, f, token); }
      catch (e) { if (app.isReplacementTokenCurrent(token)) toast(t('Could not open project')); }
    },
  });

  /* ---------------- Edit ---------------- */

  add('edit.undo', {
    label: (a) => (a.history.canUndo() ? `${t('Undo')} ${t(a.history.past.at(-1).label)}` : 'Undo'), title: 'Undo',
    key: `${MOD}Z`, icon: 'undo', transaction: COMMAND_TRANSACTION.HISTORY,
    enabled: (a) => a.history.canUndo(),
    run: () => { app.cancelFloating(); app.history.undo(); },
  });

  add('edit.redo', {
    label: (a) => (a.history.canRedo() ? `${t('Redo')} ${t(a.history.future.at(-1).label)}` : 'Redo'), title: 'Redo',
    key: `${MOD}${SHIFT}Z`, icon: 'redo', transaction: COMMAND_TRANSACTION.HISTORY,
    enabled: (a) => a.history.canRedo(),
    run: () => { app.cancelFloating(); app.history.redo(); },
  });

  add('edit.copy', { label: 'Copy', key: `${MOD}C`, icon: 'copy', run: () => { copySelection(app); toast(t('Copied')); } });
  add('edit.cut', {
    label: 'Cut', key: `${MOD}X`,
    run: () => { copySelection(app); clearSelection(app); toast(t('Cut')); },
  });
  add('edit.paste', { label: 'Paste', key: `${MOD}V`, run: () => pasteFromSystem(app) });
  add('edit.clear', {
    label: 'Clear', key: 'Del', icon: 'trash', transaction: COMMAND_TRANSACTION.MANAGED,
    run: () => clearSelection(app),
  });
  add('edit.fillPrimary', {
    label: 'Fill with Primary', key: `${ALT}Del`, transaction: COMMAND_TRANSACTION.MANAGED,
    run: () => fillSelection(app, rgbaCss(app.color.primary)),
  });
  add('edit.fillSecondary', {
    label: 'Fill with Secondary', transaction: COMMAND_TRANSACTION.MANAGED,
    run: () => fillSelection(app, rgbaCss(app.color.secondary)),
  });

  add('edit.transform', {
    label: 'Free Transform', key: `${MOD}T`, icon: 'move',
    transaction: COMMAND_TRANSACTION.MANAGED,
    run: () => {
      if (app.floating) { commitSession(app, 'Transform'); return; }
      const s = beginSession(app, { cut: true });
      if (s) {
        s.showHandles = true;
        app.tools.select('move');
        toast(t('Drag handles · Enter to apply · Esc to cancel'));
      }
    },
  });

  /* ---------------- Image ---------------- */

  add('image.size', {
    label: 'Image Size…', key: `${MOD}${ALT}I`, transaction: COMMAND_TRANSACTION.MANAGED,
    run: async () => {
      const token = app.mutationToken();
      const doc = token.doc;
      const r = await dialog({
        title: t('Image Size'),
        subtitle: t('Currently {size} px.').replace('{size}', `${doc.width} × ${doc.height}`),
        fields: [
          { key: 'width', type: 'number', label: t('Width'), default: doc.width, min: 1, max: 8192 },
          { key: 'height', type: 'number', label: t('Height'), default: doc.height, min: 1, max: 8192 },
          { key: 'smooth', type: 'toggle', label: t('Smooth (off = pixel art)'), default: false },
        ],
        confirm: t('Resize'),
      });
      if (!r || !app.isMutationTokenCurrent(token)) return;
      resizeImage(app, Math.round(r.width), Math.round(r.height), r.smooth);
      app.view.fit(app.doc.width, app.doc.height);
    },
  });

  add('image.canvasSize', {
    label: 'Canvas Size…', key: `${MOD}${ALT}C`, transaction: COMMAND_TRANSACTION.MANAGED,
    run: async () => {
      const token = app.mutationToken();
      const doc = token.doc;
      const r = await dialog({
        title: t('Canvas Size'),
        subtitle: t('Grows or crops the canvas without scaling pixels.'),
        fields: [
          { key: 'width', type: 'number', label: t('Width'), default: doc.width, min: 1, max: 8192 },
          { key: 'height', type: 'number', label: t('Height'), default: doc.height, min: 1, max: 8192 },
          {
            key: 'anchor', type: 'select', label: t('Anchor'), default: 'center',
            choices: [['top-left', t('Top left')], ['top', t('Top')], ['top-right', t('Top right')],
              ['left', t('Left')], ['center', t('Center')], ['right', t('Right')],
              ['bottom-left', t('Bottom left')], ['bottom', t('Bottom')], ['bottom-right', t('Bottom right')]],
          },
        ],
        confirm: t('Apply'),
      });
      if (!r || !app.isMutationTokenCurrent(token)) return;
      const w = Math.round(r.width), h = Math.round(r.height);
      const ax = r.anchor.includes('left') ? 0 : r.anchor.includes('right') ? 1 : 0.5;
      const ay = r.anchor.includes('top') ? 0 : r.anchor.includes('bottom') ? 1 : 0.5;
      resizeCanvasTo(app, w, h, Math.round((w - doc.width) * ax), Math.round((h - doc.height) * ay));
      app.view.fit(app.doc.width, app.doc.height);
    },
  });

  add('image.trim', {
    label: 'Trim Transparent Edges', transaction: COMMAND_TRANSACTION.MANAGED,
    run: () => {
      const result = trimTransparentEdges(app);
      if (result === 'empty') toast(t('Nothing to trim'));
      else if (result === 'unchanged') toast(t('Already trimmed'));
      else if (result === 'success') app.view.fit(app.doc.width, app.doc.height);
    },
  });

  add('image.flipH', { label: 'Flip Horizontal', transaction: COMMAND_TRANSACTION.MANAGED, run: () => flipDoc(app, 'x') });
  add('image.flipV', { label: 'Flip Vertical', transaction: COMMAND_TRANSACTION.MANAGED, run: () => flipDoc(app, 'y') });
  add('image.rotate90', { label: 'Rotate 90° CW', transaction: COMMAND_TRANSACTION.MANAGED, run: () => { if (rotateDoc(app, 90)) app.view.fit(app.doc.width, app.doc.height); } });
  add('image.rotate270', { label: 'Rotate 90° CCW', transaction: COMMAND_TRANSACTION.MANAGED, run: () => { if (rotateDoc(app, 270)) app.view.fit(app.doc.width, app.doc.height); } });
  add('image.rotate180', { label: 'Rotate 180°', transaction: COMMAND_TRANSACTION.MANAGED, run: () => rotateDoc(app, 180) });
  add('image.flatten', { label: 'Flatten Image', icon: 'merge', run: () => flattenImage(app) });

  /* ---------------- Layer ---------------- */

  add('layer.new', { label: 'New Layer', key: `${MOD}${SHIFT}N`, icon: 'plus', run: () => addLayer(app) });
  add('layer.duplicate', { label: 'Duplicate Layer', key: `${MOD}J`, icon: 'copy', run: () => duplicateLayer(app) });
  add('layer.delete', { label: 'Delete Layer', icon: 'trash', run: () => deleteLayer(app) });
  add('layer.raise', { label: 'Raise Layer', key: `${MOD}]`, icon: 'up', run: () => moveLayer(app, 1) });
  add('layer.lower', { label: 'Lower Layer', key: `${MOD}[`, icon: 'down', run: () => moveLayer(app, -1) });
  add('layer.mergeDown', { label: 'Merge Down', key: `${MOD}E`, icon: 'merge', run: () => mergeDown(app) });
  add('layer.flipH', { label: 'Flip Layer Horizontal', transaction: COMMAND_TRANSACTION.MANAGED, run: () => transformLayer(app, 'flipX') });
  add('layer.flipV', { label: 'Flip Layer Vertical', transaction: COMMAND_TRANSACTION.MANAGED, run: () => transformLayer(app, 'flipY') });
  add('layer.rotate90', { label: 'Rotate Layer 90° CW', transaction: COMMAND_TRANSACTION.MANAGED, run: () => transformLayer(app, 'rot90') });
  add('layer.rotate270', { label: 'Rotate Layer 90° CCW', transaction: COMMAND_TRANSACTION.MANAGED, run: () => transformLayer(app, 'rot270') });

  /* ---------------- Select ---------------- */

  const selectionEdit = (label, fn) => {
    app.prepareMutation();
    const before = app.selection.snapshot();
    fn();
    const after = app.selection.snapshot();
    app.history.push({
      label,
      undo: () => app.selection.restore(before),
      redo: () => app.selection.restore(after),
    });
  };

  add('select.all', { label: 'Select All', key: `${MOD}A`, run: () => selectionEdit('Select All', () => app.selection.selectAll()) });
  add('select.none', { label: 'Deselect', key: `${MOD}D`, run: () => selectionEdit('Deselect', () => app.selection.clear()) });
  add('select.invert', { label: 'Invert Selection', key: `${MOD}${SHIFT}I`, run: () => selectionEdit('Invert Selection', () => app.selection.invert()) });
  add('select.fromLayer', {
    label: 'Selection from Layer Alpha',
    run: () => {
      const layer = app.doc.active;
      if (!layer) return;
      const d = layer.ctx.getImageData(0, 0, app.doc.width, app.doc.height).data;
      const mask = new Uint8Array(app.doc.width * app.doc.height);
      for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3];
      selectionEdit('Selection from Layer', () => app.selection.set(mask));
    },
  });

  /* ---------------- Filters ---------------- */

  for (const [key, f] of Object.entries(filters)) {
    add(`filter.${key}`, {
      // History keeps the English label as its key; only display is localised.
      label: () => (f.params ? `${t(f.label)}…` : t(f.label)),
      title: f.label,
      icon: 'sliders',
      run: async () => {
        if (!f.params) { applyFilter(app, f.label, f.run); return; }
        const token = app.prepareAsyncMutation();
        const preview = el('img', { id: 'filter-preview', class: 'checker' });
        const src = previewSource(app);
        const values = await dialog({
          title: t(f.label),
          fields: f.params.map((p) => ({ ...p, label: t(p.label), type: 'range' })),
          body: preview,
          confirm: t('Apply'),
          onChange: (v) => { preview.src = renderPreview(src, f, v); },
        });
        if (!values || !app.isMutationTokenCurrent(token)) return;
        app.prepareMutation();
        applyFilter(app, f.label, f.run, values);
      },
    });
  }

  /* ---------------- View ---------------- */

  add('view.zoomIn', { label: 'Zoom In', key: `${MOD}+`, transaction: COMMAND_TRANSACTION.VIEW, run: () => app.view.zoomStep(1) });
  add('view.zoomOut', { label: 'Zoom Out', key: `${MOD}-`, transaction: COMMAND_TRANSACTION.VIEW, run: () => app.view.zoomStep(-1) });
  add('view.zoom100', { label: 'Actual Size', key: `${MOD}1`, transaction: COMMAND_TRANSACTION.VIEW, run: () => app.view.setScale(1) });
  add('view.fit', { label: 'Fit on Screen', key: `${MOD}0`, icon: 'fit', transaction: COMMAND_TRANSACTION.VIEW, run: () => app.view.fit(app.doc.width, app.doc.height) });
  add('view.grid', {
    label: (a) => (a.options.grid ? 'Hide Pixel Grid' : 'Show Pixel Grid'), title: 'Toggle Pixel Grid',
    key: `${MOD}'`, icon: 'grid', transaction: COMMAND_TRANSACTION.VIEW,
    run: () => { app.options.grid = !app.options.grid; bus.emit('tool'); bus.emit('view'); },
  });
  add('view.help', { label: 'Help & Keyboard Shortcuts', key: '?', icon: 'help', transaction: COMMAND_TRANSACTION.VIEW, run: () => showHelp(app) });

  return c;
}

/** Downscaled source used for fast live filter previews. */
function previewSource(app) {
  const doc = app.doc;
  const max = 320;
  const s = Math.min(1, max / Math.max(doc.width, doc.height));
  const w = Math.max(1, Math.round(doc.width * s)), h = Math.max(1, Math.round(doc.height * s));
  const c = makeCanvas(w, h);
  const g = ctx2d(c, { willReadFrequently: true });
  g.imageSmoothingEnabled = s < 1;
  g.drawImage(app.doc.active?.canvas || doc.flatten(), 0, 0, w, h);
  return { canvas: c, ctx: g, data: g.getImageData(0, 0, w, h), w, h };
}

function renderPreview(src, f, params) {
  const img = new ImageData(new Uint8ClampedArray(src.data.data), src.w, src.h);
  f.run(img, src.w, src.h, params, new Uint8ClampedArray(src.data.data));
  src.ctx.putImageData(img, 0, 0);
  return src.canvas.toDataURL();
}
