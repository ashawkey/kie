// Global keyboard handling: commands, tools, and painting modifiers.
import { bus } from '../core/bus.js';
import { toolForKey } from '../tools/index.js';

const isTyping = (t) =>
  t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/** id -> matcher for command shortcuts, evaluated in order. */
const BINDINGS = [
  ['file.new', (e, m) => m && e.key.toLowerCase() === 'n' && !e.shiftKey],
  ['layer.new', (e, m) => m && e.key.toLowerCase() === 'n' && e.shiftKey],
  ['file.open', (e, m) => m && e.key.toLowerCase() === 'o'],
  ['file.save', (e, m) => m && e.key.toLowerCase() === 's' && !e.shiftKey],
  ['file.export', (e, m) => m && e.key.toLowerCase() === 's' && e.shiftKey],
  ['edit.redo', (e, m) => m && e.key.toLowerCase() === 'z' && e.shiftKey],
  ['edit.redo', (e, m) => m && e.key.toLowerCase() === 'y'],
  ['edit.undo', (e, m) => m && e.key.toLowerCase() === 'z'],
  ['edit.copyMerged', (e, m) => m && e.key.toLowerCase() === 'c' && e.shiftKey],
  // Must not swallow Ctrl+Alt+C, which belongs to Canvas Size further down.
  ['edit.copy', (e, m) => m && !e.altKey && e.key.toLowerCase() === 'c'],
  ['edit.cut', (e, m) => m && e.key.toLowerCase() === 'x'],
  ['edit.paste', (e, m) => m && e.key.toLowerCase() === 'v'],
  ['edit.transform', (e, m) => m && e.key.toLowerCase() === 't'],
  ['layer.duplicate', (e, m) => m && e.key.toLowerCase() === 'j'],
  ['layer.mergeDown', (e, m) => m && e.key.toLowerCase() === 'e'],
  ['layer.raise', (e, m) => m && e.key === ']'],
  ['layer.lower', (e, m) => m && e.key === '['],
  ['select.all', (e, m) => m && e.key.toLowerCase() === 'a'],
  ['select.invert', (e, m) => m && e.key.toLowerCase() === 'i' && e.shiftKey],
  ['select.reselect', (e, m) => m && e.key.toLowerCase() === 'd' && e.shiftKey],
  ['select.none', (e, m) => m && e.key.toLowerCase() === 'd'],
  ['image.size', (e, m) => m && e.altKey && e.key.toLowerCase() === 'i'],
  ['image.canvasSize', (e, m) => m && e.altKey && e.key.toLowerCase() === 'c'],
  ['view.zoomIn', (e, m) => m && (e.key === '=' || e.key === '+')],
  ['view.zoomOut', (e, m) => m && (e.key === '-' || e.key === '_')],
  ['view.zoom100', (e, m) => m && e.key === '1'],
  ['view.fit', (e, m) => m && e.key === '0'],
  ['view.grid', (e, m) => m && e.key === "'"],
  ['view.selectionEdges', (e, m) => m && e.key.toLowerCase() === 'h'],
  ['edit.fillPrimary', (e) => e.altKey && (e.key === 'Backspace' || e.key === 'Delete')],
  ['edit.clear', (e) => !e.ctrlKey && !e.metaKey && (e.key === 'Backspace' || e.key === 'Delete')],
  ['view.help', (e) => e.key === '?'],
];

export function installShortcuts(app) {
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;

    // let the active tool consume keys first (transform/crop Enter, arrows…)
    if (!mod && app.tools.active?.onKey?.(e)) {
      e.preventDefault();
      return;
    }

    if (e.key === ' ' && !e.repeat) {
      app.spaceDown = true;
      app.setCursor('grab');
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape') {
      app.cancelFloating();
      bus.emit('menu-close');
      return;
    }

    for (const [id, match] of BINDINGS) {
      if (match(e, mod)) {
        if (app.commandEnabled(id)) {
          e.preventDefault();
          app.run(id);
        }
        return;
      }
    }

    if (mod) return;

    // brush size
    if (e.key === '[' || e.key === ']') {
      app.nudgeBrushSize(e.key === '[' ? -1 : 1);
      e.preventDefault();
      return;
    }
    if (e.key.toLowerCase() === 'x') { app.color.swap(); return; }
    if (e.key.toLowerCase() === 'd') { app.color.reset(); return; }

    // tool slots: letter selects, repeat or Shift+letter cycles within the slot
    const next = toolForKey(e.key.toUpperCase(), app.tools.activeId);
    if (next) {
      app.tools.select(next);
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      app.spaceDown = false;
      app.syncCursor();
    }
  });

  window.addEventListener('blur', () => { app.spaceDown = false; app.syncCursor(); });
}
