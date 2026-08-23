// Application shell: wires model, view, tools, UI and input together.
import { bus } from './core/bus.js';
import { Doc } from './core/doc.js';
import { History } from './core/history.js';
import { Selection } from './core/selection.js';
import { View } from './core/view.js';
import { Renderer } from './core/renderer.js';
import { $, el } from './core/util.js';
import { ToolManager, SIZED_TOOLS } from './tools/index.js';
import { cancelSession, commitSession } from './tools/transform.js';
import { ColorState, buildColorPanel } from './ui/color.js';
import { buildLayersPanel } from './ui/layers.js';
import { buildToolRail, buildOptionsBar, buildHistoryPanel } from './ui/toolbar.js';
import { buildMenuBar } from './ui/menu.js';
import { registerCommands } from './ui/commands.js';
import { installShortcuts } from './ui/shortcuts.js';
import { installPointer } from './ui/pointer.js';
import { icon } from './ui/icons.js';
import { installNavigator } from './ui/navigator.js';
import { installTooltips } from './ui/tooltip.js';
import { toast } from './ui/modal.js';
import { openImageAsDocument } from './ops/io.js';
import { t, initLocale, setLocale, locale, LOCALES } from './core/i18n.js';

class App {
  constructor() {
    this.doc = Doc.blank(64, 64);
    this.docName = 'untitled';
    this.history = new History();
    this.selection = new Selection(this.doc.width, this.doc.height);
    this.view = new View();
    this.color = new ColorState();
    this.toolOptions = {};
    this.tools = new ToolManager(this);
    this.options = { grid: true };
    this.floating = null;
    this.clipboard = null;
    this.spaceDown = false;
    this.pointer = { x: null, y: null };
    // File the document is linked to, so Save can write back in place.
    this.fileHandle = null;
    this.exportSettings = { format: 'png', scale: 1, quality: 0.92 };
    this.savedAt = 0; // history depth at the last save
    this.commands = registerCommands(this);
  }

  /** True when there are edits that have not been written to a file. */
  get isDirty() {
    return this.history.past.length !== this.savedAt;
  }

  markSaved() {
    this.savedAt = this.history.past.length;
    bus.emit('doc');
  }

  /** Associate the document with a file handle chosen by the user. */
  linkFile(handle, name) {
    this.fileHandle = handle || null;
    if (name) this.docName = name;
    this.markSaved();
  }

  /* ---------- document ---------- */

  setDoc(doc, name, handle = null) {
    this.cancelFloating();
    this.doc = doc;
    this.docName = name || 'untitled';
    this.fileHandle = handle;
    this.selection = new Selection(doc.width, doc.height);
    this.history.clear();
    this.savedAt = 0;
    bus.emit('doc');
    bus.emit('layers');
    bus.emit('selection');
    this.view.fit(doc.width, doc.height);
    this.updateTitle();
  }

  updateTitle() {
    const name = this.docName === 'untitled' ? t('untitled') : this.docName;
    $('#doc-title').textContent =
      `${this.isDirty ? '• ' : ''}${name} · ${this.doc.width}×${this.doc.height}`;
  }

  async openFile(file, handle = null) {
    if (file.name.endsWith('.glassx')) {
      const { loadProject } = await import('./ops/io.js');
      await loadProject(this, file);
    } else {
      await openImageAsDocument(this, file, handle);
    }
  }

  /* ---------- commands ---------- */

  run(id) {
    const cmd = this.commands.get(id);
    if (!cmd) return;
    if (cmd.enabled && !cmd.enabled(this)) return;
    // A pending transform must be baked before most operations.
    if (this.floating && !['edit.undo', 'edit.redo', 'edit.transform'].includes(id)) {
      commitSession(this, 'Transform');
    }
    cmd.run(this);
  }

  cancelFloating() {
    if (this.floating) cancelSession(this);
  }

  /* ---------- ui helpers ---------- */

  /** Ops and tools pass English messages; translated here at the boundary. */
  toast(msg) { toast(t(msg)); }

  setCursor(c) { $('#viewcanvas').style.cursor = c; }

  syncCursor() {
    if (this.spaceDown) { this.setCursor('grab'); return; }
    const T = this.tools.registry.get(this.tools.activeId);
    this.setCursor(T?.cursor || 'crosshair');
  }

  setPointerPos(x, y) {
    this.pointer = { x, y };
    this.updateStatus();
  }

  nudgeBrushSize(delta) {
    const id = this.tools.activeId;
    if (!SIZED_TOOLS.has(id)) return;
    const store = this.toolOptions[id];
    const next = Math.max(1, Math.min(256, (store.size || 1) + delta));
    if (next === store.size) return;
    store.size = next;
    bus.emit('tool-option', 'size', next);
    toast(`${t('Size')} ${next}px`);
  }

  updateStatus() {
    const { x, y } = this.pointer;
    $('#status-pos').textContent = x == null ? '—' : `${x}, ${y}`;
    $('#status-size').textContent = `${this.doc.width} × ${this.doc.height}`;
    const sel = this.selection;
    $('#status-sel').textContent = sel.active && sel.bounds
      ? `${t('sel')} ${sel.bounds.w} × ${sel.bounds.h}`
      : t('no selection');
    // Tools return English hints; translated at the single display site.
    $('#status-hint').textContent = t(this.tools.active?.statusHint?.() || '');
    $('#zoom-value').textContent = `${formatZoom(this.view.scale)}`;
  }
}

const formatZoom = (s) => (s >= 1 ? `${Math.round(s * 100)}%` : `${(s * 100).toFixed(s < 0.1 ? 1 : 0)}%`);

/* ---------- boot ---------- */

function boot() {
  initLocale();
  const app = new App();
  window.app = app;

  buildMenuBar(app, $('#menubar'));
  buildToolRail(app, $('#toolrail'));
  buildOptionsBar(app, $('#optionsbar'));

  // dock panels
  const dock = $('#dock');
  dock.classList.add('gscroll');
  dock.appendChild(panel('Color', 'palette', buildColorPanel(app)));
  dock.appendChild(panel('Layers', 'layers', buildLayersPanel(app), true));
  dock.appendChild(panel('History', 'history', buildHistoryPanel(app)));

  const canvas = $('#viewcanvas');
  const renderer = new Renderer(app, canvas);
  app.renderer = renderer;

  installPointer(app, canvas);
  installShortcuts(app);
  installTooltips();

  app.navigator = installNavigator(app);

  // toolbar actions in the top bar
  $('#btn-undo').addEventListener('click', () => app.run('edit.undo'));
  $('#btn-redo').addEventListener('click', () => app.run('edit.redo'));
  $('#btn-fit').addEventListener('click', () => app.run('view.fit'));
  $('#btn-help').addEventListener('click', () => app.run('view.help'));
  $('#btn-lang').addEventListener('click', () => {
    setLocale(locale() === 'en' ? 'zh' : 'en');
  });
  $('#btn-export').addEventListener('click', () => app.run('file.export'));
  $('#zoom-in').addEventListener('click', () => app.view.zoomStep(1));
  $('#zoom-out').addEventListener('click', () => app.view.zoomStep(-1));
  $('#zoom-value').addEventListener('click', () => app.view.setScale(1));

  const syncButtons = () => {
    $('#btn-undo').disabled = !app.history.canUndo();
    $('#btn-redo').disabled = !app.history.canRedo();
    app.updateTitle();
  };
  bus.on('history', syncButtons);
  syncButtons();

  for (const ev of ['view', 'selection', 'doc', 'tool']) bus.on(ev, () => app.updateStatus());

  const resize = () => renderer.resize();
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe($('#stage'));
  resize();

  localiseChrome(app);

  app.tools.select('pencil');
  app.view.fit(app.doc.width, app.doc.height);
  app.syncCursor();
  app.updateStatus();
  app.updateTitle();

  // system clipboard paste of images
  window.addEventListener('paste', async (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const { importImageAsLayer } = await import('./ops/io.js');
    await importImageAsLayer(app, file);
    toast(t('Pasted image as layer'));
  });

  window.addEventListener('beforeunload', (e) => {
    if (app.isDirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

function panel(title, iconName, body, flex = false) {
  const chev = icon('down', 'chev');
  const label = el('span', { text: t(title) });
  const p = el('div', { class: `panel glass${flex ? ' flex' : ''}` }, [
    el('div', { class: 'panel-head' }, [icon(iconName), label, chev]),
    el('div', { class: 'panel-body gscroll' }, [body]),
  ]);
  p.querySelector('.panel-head').addEventListener('click', () => p.classList.toggle('collapsed'));
  bus.on('locale', () => { label.textContent = t(title); });
  return p;
}

/** Shell buttons that mirror a command; the tooltip borrows its shortcut. */
const CHROME_COMMANDS = {
  'btn-undo': 'edit.undo',
  'btn-redo': 'edit.redo',
  'btn-fit': 'view.fit',
  'btn-help': 'view.help',
  'btn-export': 'file.export',
  'zoom-in': 'view.zoomIn',
  'zoom-out': 'view.zoomOut',
  'zoom-value': 'view.zoom100',
};

/**
 * Localise the parts of the shell that live in index.html. Their English text
 * is kept in a data attribute so re-translation never reads an already
 * translated string.
 */
function localiseChrome(app) {
  // Shortcut chips come from the registry so they follow the platform modifier.
  for (const [id, cmd] of Object.entries(CHROME_COMMANDS)) {
    const key = app.commands.get(cmd)?.key;
    if (key) $(`#${id}`).dataset.tipKey = key;
  }

  // Only the static shell: dynamic panels re-render themselves on `locale`.
  const scope = '#topbar, #navigator, #statusbar';
  const apply = () => {
    for (const node of document.querySelectorAll(`:is(${scope}) [data-tip]`)) {
      const title = node.dataset.tipSrc || (node.dataset.tipSrc = node.dataset.tip);
      node.dataset.tip = t(title);
      if (node.dataset.tipDesc !== undefined) {
        const desc = node.dataset.tipDescSrc || (node.dataset.tipDescSrc = node.dataset.tipDesc);
        node.dataset.tipDesc = t(desc);
      }
    }
    for (const node of document.querySelectorAll(`:is(${scope}) [aria-label]`)) {
      const key = node.dataset.labelKey || (node.dataset.labelKey = node.getAttribute('aria-label'));
      node.setAttribute('aria-label', t(key));
    }
    $('#nav-title').textContent = t('Navigator');
    $('#lang-label').textContent = LOCALES[locale() === 'en' ? 'zh' : 'en'].label;
    $('#btn-lang').dataset.tipDesc = locale() === 'en' ? t('Switch to Chinese') : t('Switch to English');
    $('#btn-export').textContent = t('Export');
    app.updateStatus();
    app.updateTitle();
  };
  bus.on('locale', apply);
  apply();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
