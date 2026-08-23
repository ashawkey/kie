// Application shell: wires model, view, tools, UI and input together.
import { bus } from './core/bus.js';
import { Doc } from './core/doc.js';
import { History } from './core/history.js';
import { Selection } from './core/selection.js';
import { View } from './core/view.js';
import { Renderer } from './core/renderer.js';
import { $, el } from './core/util.js';
import { ToolManager, SIZED_TOOLS } from './tools/index.js';
import { cancelSession, commitSession, stageSession } from './tools/transform.js';
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
import { confirmDialog, toast } from './ui/modal.js';
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
    this.savedStateId = this.history.stateId;
    this.documentEpoch = 0;
    this.replacementInvocation = 0;
    this.clipboardInvocation = 0;
    this.pendingEdit = null;
    this.commands = registerCommands(this);
  }

  /** True when there are edits that have not been written to a file. */
  get isDirty() {
    return !!this.floating || !!this.pendingEdit || this.history.stateId !== this.savedStateId;
  }

  markSaved(stateId = this.history.stateId, doc = this.doc, documentEpoch = this.documentEpoch) {
    if (this.doc !== doc || this.documentEpoch !== documentEpoch) return false;
    this.savedStateId = stateId;
    bus.emit('doc');
    return true;
  }

  /** Associate the document with a file handle chosen by the user. */
  linkFile(handle, name, stateId = this.history.stateId, doc = this.doc,
    documentEpoch = this.documentEpoch) {
    if (this.doc !== doc || this.documentEpoch !== documentEpoch) return false;
    this.fileHandle = handle || null;
    if (name) this.docName = name;
    this.markSaved(stateId, doc, documentEpoch);
    return true;
  }

  /* ---------- pending edits ---------- */

  beginPendingEdit(edit) {
    if (!edit) return false;
    if (this.pendingEdit === edit) return true;
    this.prepareMutation();
    this.pendingEdit = edit;
    bus.emit('tool-edit');
    return true;
  }

  endPendingEdit(edit) {
    if (this.pendingEdit !== edit) return false;
    this.pendingEdit = null;
    bus.emit('tool-edit');
    return true;
  }

  settlePendingEdit(action = 'commit', edit = this.pendingEdit) {
    if (!edit || this.pendingEdit !== edit) return false;
    // Keep ownership during settlement so the edit can distinguish this path
    // from a genuinely stale pointer completion. Always detach afterwards.
    const fn = action === 'cancel' ? edit.cancelPendingEdit : edit.commitPendingEdit;
    fn?.call(edit);
    if (this.pendingEdit === edit) {
      this.pendingEdit = null;
      bus.emit('tool-edit');
    }
    return true;
  }

  /** Settle previews before any operation that mutates or snapshots the doc. */
  prepareMutation() {
    this.settlePendingEdit('commit');
    if (this.floating) commitSession(this, 'Transform');
  }

  /**
   * Preflight settlement without changing pending ownership or live pixels.
   * Call commitPreparedMutation only after the caller's own detached work has
   * also completed, so a failure cannot accidentally commit another edit.
   */
  stageMutation() {
    let pending = null;
    if (this.pendingEdit) {
      const edit = this.pendingEdit;
      if (typeof edit.stagePendingEdit !== 'function') return null;
      const staged = edit.stagePendingEdit();
      if (!staged) return null;
      pending = { edit, staged };
    }
    let floating = null;
    if (this.floating) {
      floating = stageSession(this, this.floating);
      if (!floating) return null;
    }
    return { pending, floating };
  }

  commitPreparedMutation(prepared) {
    if (!prepared) return false;
    if (prepared.pending) {
      const { edit, staged } = prepared.pending;
      if (this.pendingEdit !== edit || edit.commitStagedPendingEdit(staged) === false) return false;
    }
    if (prepared.floating) {
      if (this.floating !== prepared.floating.session ||
          !commitSession(this, 'Transform', prepared.floating)) return false;
    }
    return true;
  }

  mutationToken() {
    return {
      doc: this.doc,
      documentEpoch: this.documentEpoch,
      revision: this.history.revision,
      stateId: this.history.stateId,
    };
  }

  isDocumentTokenCurrent(token) {
    return !!token && this.doc === token.doc && this.documentEpoch === token.documentEpoch;
  }

  isMutationTokenCurrent(token) {
    return this.isDocumentTokenCurrent(token) && this.history.revision === token.revision;
  }

  prepareAsyncMutation() {
    this.prepareMutation();
    return this.mutationToken();
  }

  /** Start an explicit document-replacement workflow in invocation order. */
  beginReplacement() {
    const token = this.prepareAsyncMutation();
    token.replacementInvocation = ++this.replacementInvocation;
    return token;
  }

  isReplacementTokenCurrent(token) {
    return this.isMutationTokenCurrent(token) &&
      token.replacementInvocation === this.replacementInvocation;
  }

  /** Start a paste workflow; only the latest invocation may settle or mutate. */
  beginClipboardInvocation() {
    const token = this.prepareAsyncMutation();
    token.clipboardInvocation = ++this.clipboardInvocation;
    return token;
  }

  isClipboardTokenCurrent(token) {
    return this.isMutationTokenCurrent(token) &&
      token.clipboardInvocation === this.clipboardInvocation;
  }

  /* ---------- document ---------- */

  async setDoc(doc, name, handle = null, expected = this.beginReplacement()) {
    // Callers that decoded or picked asynchronously carry the token they made
    // before that work. Direct callers get a token at setDoc invocation.
    if (!this.isReplacementTokenCurrent(expected)) return false;
    if (this.isDirty) {
      const discard = await confirmDialog(
        t('Discard unsaved changes?'),
        t('This will replace the current image and cannot be undone.'),
        t('Discard'),
      );
      if (!discard || !this.isReplacementTokenCurrent(expected)) return false;
    }
    // Revalidate immediately before all replacement side effects. In
    // particular, an edit or newer replacement request made while confirmation
    // was open invalidates this workflow.
    if (!this.isReplacementTokenCurrent(expected)) return false;
    if (!this.isReplacementTokenCurrent(expected)) return false;
    this.doc = doc;
    this.documentEpoch++;
    this.docName = name || 'untitled';
    this.fileHandle = handle;
    this.selection = new Selection(doc.width, doc.height);
    this.history.clear();
    this.savedStateId = this.history.stateId;
    // The old interaction is intentionally abandoned after the replacement
    // wins; resetting it against the new document must not restore old pixels.
    this.pendingEdit = null;
    this.floating = null;
    // The replacement has now won. Clear gesture geometry without changing
    // the selected tool or its persistent options, and invalidate routed
    // pointer state before publishing the new document.
    this.tools.resetInteractions();
    bus.emit('document-replaced', this.documentEpoch);
    bus.emit('doc');
    bus.emit('layers');
    bus.emit('selection');
    this.view.fit(doc.width, doc.height);
    this.updateTitle();
    return true;
  }

  updateTitle() {
    const name = this.docName === 'untitled' ? t('untitled') : this.docName;
    $('#doc-title').textContent =
      `${this.isDirty ? '• ' : ''}${name} · ${this.doc.width}×${this.doc.height}`;
  }

  async openFile(file, handle = null, token = this.beginReplacement()) {
    if (!this.isReplacementTokenCurrent(token)) return false;
    if (file.name.toLowerCase().endsWith('.glassx')) {
      try {
        const { loadProject } = await import('./ops/io.js');
        if (this.isReplacementTokenCurrent(token)) return await loadProject(this, file, token);
      } catch (e) {
        if (this.isReplacementTokenCurrent(token)) this.toast('Could not open project');
      }
      return false;
    }
    try {
      return await openImageAsDocument(this, file, handle, token);
    } catch {
      // Decode, dimension, and canvas failures are contained at the shared
      // boundary used by pickers, drag/drop, and direct file opens.
      if (this.isReplacementTokenCurrent(token)) this.toast('Could not open image');
      return false;
    }
  }

  /* ---------- commands ---------- */

  commandEnabled(id) {
    const cmd = this.commands.get(id);
    if (!cmd) return false;
    if ((id === 'edit.undo' || id === 'edit.redo') &&
        (this.pendingEdit || this.floating)) return true;
    return !cmd.enabled || cmd.enabled(this);
  }

  settleHistoryNavigation() {
    const settled = this.settlePendingEdit('cancel');
    const hadFloating = !!this.floating;
    this.cancelFloating();
    return settled || hadFloating;
  }

  run(id) {
    const cmd = this.commands.get(id);
    // Never settle a transaction for an unavailable/unrelated command.
    if (!cmd || !this.commandEnabled(id)) return false;
    const undoRedo = id === 'edit.undo' || id === 'edit.redo';
    if (undoRedo) {
      // Cancelling a preview is itself the requested navigation; do not also
      // traverse an older history entry in the same user action.
      if (this.settleHistoryNavigation()) return true;
      if (cmd.enabled && !cmd.enabled(this)) return false;
    } else {
      this.settlePendingEdit('commit');
      if (cmd.enabled && !cmd.enabled(this)) return false;
      // A pending transform must be baked before most operations.
      if (this.floating && id !== 'edit.transform') commitSession(this, 'Transform');
    }
    cmd.run(this);
    return true;
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
    $('#btn-undo').disabled = !app.commandEnabled('edit.undo');
    $('#btn-redo').disabled = !app.commandEnabled('edit.redo');
    app.updateTitle();
  };
  bus.on('history', syncButtons);
  bus.on('tool-edit', syncButtons);
  bus.on('layers', syncButtons);
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
    // Every browser paste owns the sequence, even when it contains no image:
    // a newer empty/text paste deliberately makes an older system read inert.
    const token = app.beginClipboardInvocation();
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    try {
      const { importImageAsLayer } = await import('./ops/io.js');
      if (!app.isClipboardTokenCurrent(token)) return;
      const result = await importImageAsLayer(
        app, file, token, (expected) => app.isClipboardTokenCurrent(expected));
      if (result === 'success') toast(t('Pasted image as layer'));
      else if (result === 'failure' && app.isClipboardTokenCurrent(token)) {
        toast(t('Could not import image'));
      }
    } catch {
      if (app.isClipboardTokenCurrent(token)) toast(t('Could not import image'));
    }
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
