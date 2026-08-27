// Canvas pointer routing: converts screen events to tool events with image
// coordinates, and handles pan/zoom gestures that override the active tool.
import { bus } from '../core/bus.js';

export function installPointer(app, canvas) {
  let route = null;          // { kind: 'tool' | 'pan', pointerId, epoch, tool }
  const suppressed = new Set(); // invalidated pointers awaiting up/cancel
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
    // Only one routed canvas gesture may own the tools at a time. Other input
    // devices remain ignored until their own completion, rather than stealing
    // or completing the captured gesture.
    if (route || suppressed.has(e.pointerId)) return;
    if (e.button === 1 || app.spaceDown) {
      route = { kind: 'pan', pointerId: e.pointerId, epoch: app.documentEpoch };
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
      route = {
        kind: 'tool', pointerId: e.pointerId, epoch: app.documentEpoch,
        tool: toolOverride,
      };
      toolOverride.onDown(ev);
      return;
    }

    const tool = app.tools.active;
    route = { kind: 'tool', pointerId: e.pointerId, epoch: app.documentEpoch, tool };
    tool?.onDown(ev);
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (suppressed.has(e.pointerId)) return;
    if (route) {
      if (e.pointerId !== route.pointerId || route.epoch !== app.documentEpoch) return;
      if (route.kind === 'pan') {
        app.view.pan(e.clientX - panLast.x, e.clientY - panLast.y);
        panLast = { x: e.clientX, y: e.clientY };
        return;
      }
      const ev = makeEvent(e);
      app.setPointerPos(ev.ix, ev.iy);
      route.tool?.onMove(ev);
      return;
    }
    // Buttonless moves are hover; button-held moves without a matching route
    // are stale or began elsewhere and must not reach document tools.
    if (e.buttons) return;
    const ev = makeEvent(e);
    app.setPointerPos(ev.ix, ev.iy);
    app.tools.active?.onMove(ev);
  });

  const end = (e, cancelled = false) => {
    if (suppressed.delete(e.pointerId)) return;
    if (!route || e.pointerId !== route.pointerId || route.epoch !== app.documentEpoch) return;
    const completed = route;
    route = null;
    if (completed.kind === 'pan') {
      panLast = null;
      app.syncCursor();
      return;
    }
    const ev = makeEvent(e);
    if (cancelled && completed.tool?.onCancel) completed.tool.onCancel(ev);
    else completed.tool?.onUp(ev);
    if (toolOverride === completed.tool) {
      app.color.remember(app.color.primary);
      toolOverride = null;
    }
  };

  canvas.addEventListener('pointerup', (e) => end(e));
  canvas.addEventListener('pointercancel', (e) => end(e, true));

  canvas.addEventListener('pointerleave', () => {
    app.setPointerPos(null, null);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.ctrlKey || e.metaKey || e.altKey) {
      // pinch-zoom on trackpads reports ctrlKey
      app.view.wheelZoom(e, anchor);
    } else if (e.shiftKey) {
      app.view.pan(-e.deltaY, 0);
    } else {
      app.view.pan(-e.deltaX, -e.deltaY);
    }
  }, { passive: false });

  // A winning replacement invalidates the currently routed gesture. Its later
  // pointerup/cancel belongs to the old document and must not reach any tool.
  bus.on('document-replaced', () => {
    if (route) suppressed.add(route.pointerId);
    route = null;
    panLast = null;
    toolOverride = null;
    app.syncCursor();
  });

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
