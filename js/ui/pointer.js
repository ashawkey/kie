// Canvas pointer routing: converts screen events to tool events with image
// coordinates, and handles pan/zoom gestures that override the active tool.
import { bus } from '../core/bus.js';

export function installPointer(app, canvas) {
  let active = null;         // 'tool' | 'pan'
  let panLast = null;
  let toolOverride = null;   // temporary tool (space-pan, alt-eyedropper)

  const makeEvent = (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const p = app.view.toImage(sx, sy);
    return {
      sx, sy,
      fx: p.x, fy: p.y,                       // fractional image coords
      ix: Math.floor(p.x), iy: Math.floor(p.y), // pixel coords
      button: e.button,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      raw: e,
    };
  };

  // Capture is a convenience: never let a failure abort the stroke itself.
  const capture = (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || app.spaceDown) {
      active = 'pan';
      panLast = { x: e.clientX, y: e.clientY };
      capture(e);
      app.setCursor('grabbing');
      e.preventDefault();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;

    capture(e);
    const ev = makeEvent(e);

    // Alt = temporary eyedropper for paint tools
    if (ev.altKey && app.tools.usesColor(app.tools.activeId)) {
      toolOverride = app.tools.get('eyedropper');
      active = 'tool';
      toolOverride.onDown(ev);
      return;
    }

    active = 'tool';
    app.tools.active?.onDown(ev);
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (active === 'pan') {
      app.view.pan(e.clientX - panLast.x, e.clientY - panLast.y);
      panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    const ev = makeEvent(e);
    app.setPointerPos(ev.ix, ev.iy);
    (toolOverride || app.tools.active)?.onMove(ev);
  });

  const end = (e) => {
    if (active === 'pan') {
      active = null;
      app.syncCursor();
      return;
    }
    if (active === 'tool') {
      const ev = makeEvent(e);
      (toolOverride || app.tools.active)?.onUp(ev);
      if (toolOverride) {
        app.color.remember(app.color.primary);
        toolOverride = null;
      }
      active = null;
    }
  };

  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('pointerleave', () => {
    app.setPointerPos(null, null);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.ctrlKey || e.metaKey || e.altKey) {
      // pinch-zoom on trackpads reports ctrlKey
      const factor = Math.exp(-e.deltaY * 0.0125);
      app.view.zoomBy(factor, anchor);
    } else if (e.shiftKey) {
      app.view.pan(-e.deltaY, 0);
    } else {
      app.view.pan(-e.deltaX, -e.deltaY);
    }
  }, { passive: false });

  // drag & drop images onto the canvas
  const stage = canvas.parentElement;
  stage.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  stage.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) await app.openFile(file);
  });

  bus.on('tool', () => app.syncCursor());
}
