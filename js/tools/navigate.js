// Hand (pan), Zoom, Crop.
import { Tool } from './base.js';
import { bus } from '../core/bus.js';
import { resizeCanvasTo } from '../ops/image.js';
import { validateEditorDimensions } from '../core/util.js';

export class HandTool extends Tool {
  static id = 'hand';
  static label = 'Hand';
  static icon = 'hand';
  static cursor = 'grab';
  static options = [];

  onDown(e) { this.last = { x: e.sx, y: e.sy }; }
  onMove(e) {
    if (!this.last) return;
    this.app.view.pan(e.sx - this.last.x, e.sy - this.last.y);
    this.last = { x: e.sx, y: e.sy };
  }
  onUp() { this.last = null; }
  deactivate() { this.last = null; }
  resetInteraction() { this.last = null; }
  statusHint() { return 'Drag to pan · Space+drag works with any tool'; }
}

export class ZoomTool extends Tool {
  static id = 'zoom';
  static label = 'Zoom';
  static icon = 'zoom';
  static cursor = 'zoom-in';
  static options = [];

  onDown(e) {
    this.app.view.zoomStep(e.altKey || e.button === 2 ? -1 : 1, { x: e.sx, y: e.sy });
  }
  statusHint() { return 'Click to zoom in · Alt-click to zoom out'; }
}

export class CropTool extends Tool {
  static id = 'crop';
  static label = 'Crop';
  static icon = 'crop';
  static cursor = 'crosshair';
  static options = [];

  activate() {
    const sel = this.app.selection;
    this.box = sel.active && sel.bounds ? { ...sel.bounds } : null;
    bus.emit('overlay');
  }

  clearInteraction() {
    this.box = null;
    this.mode = null;
    this.start = null;
    this.startBox = null;
    this.grab = null;
    bus.emit('overlay');
  }

  deactivate() { this.clearInteraction(); }
  resetInteraction() { this.clearInteraction(); }

  handleAt(e) {
    if (!this.box) return null;
    const v = this.app.view;
    const b = this.box;
    const a = v.toScreen(b.x, b.y), c = v.toScreen(b.x + b.w, b.y + b.h);
    const near = (p, q) => Math.abs(p - q) <= 8;
    let h = '';
    if (near(e.sy, a.y)) h += 'n'; else if (near(e.sy, c.y)) h += 's';
    if (near(e.sx, a.x)) h += 'w'; else if (near(e.sx, c.x)) h += 'e';
    if (h) return h;
    if (e.sx > a.x && e.sx < c.x && e.sy > a.y && e.sy < c.y) return 'move';
    return null;
  }

  onDown(e) {
    const h = this.handleAt(e);
    if (h) {
      this.mode = h;
      this.startBox = { ...this.box };
      this.grab = { x: e.fx, y: e.fy };
      return;
    }
    this.mode = 'new';
    this.start = { x: Math.round(e.fx), y: Math.round(e.fy) };
    this.box = { x: this.start.x, y: this.start.y, w: 0, h: 0 };
    bus.emit('overlay');
  }

  onMove(e) {
    if (!this.mode) {
      const h = this.handleAt(e);
      this.app.setCursor(h === 'move' ? 'move' : h ? `${h}-resize` : 'crosshair');
      return;
    }
    const b = this.box;
    if (this.mode === 'new') {
      const x = Math.round(e.fx), y = Math.round(e.fy);
      b.x = Math.min(this.start.x, x);
      b.y = Math.min(this.start.y, y);
      b.w = Math.abs(x - this.start.x);
      b.h = Math.abs(y - this.start.y);
    } else if (this.mode === 'move') {
      const dx = Math.round(e.fx - this.grab.x), dy = Math.round(e.fy - this.grab.y);
      b.x = this.startBox.x + dx;
      b.y = this.startBox.y + dy;
    } else {
      const s = this.startBox;
      let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
      if (this.mode.includes('w')) x0 = Math.round(e.fx);
      if (this.mode.includes('e')) x1 = Math.round(e.fx);
      if (this.mode.includes('n')) y0 = Math.round(e.fy);
      if (this.mode.includes('s')) y1 = Math.round(e.fy);
      b.x = Math.min(x0, x1); b.y = Math.min(y0, y1);
      b.w = Math.abs(x1 - x0); b.h = Math.abs(y1 - y0);
    }
    bus.emit('overlay');
  }

  onUp() {
    this.mode = null;
    if (this.box && (this.box.w < 1 || this.box.h < 1)) this.box = null;
    bus.emit('overlay');
  }

  onKey(e) {
    if (e.key === 'Enter' && this.box) { this.apply(); return true; }
    if (e.key === 'Escape') { this.box = null; bus.emit('overlay'); return true; }
    return false;
  }

  apply() {
    const b = this.box;
    if (!b) return;
    const { width, height } = this.app.doc;
    try { validateEditorDimensions(width, height); }
    catch { this.app.toast?.('Invalid document dimensions'); return; }
    // Crop only removes document edges. Round the requested edges, then
    // intersect them with the current integer document before docOp snapshots.
    const x0 = Math.max(0, Math.min(width, Math.round(Math.min(b.x, b.x + b.w))));
    const y0 = Math.max(0, Math.min(height, Math.round(Math.min(b.y, b.y + b.h))));
    const x1 = Math.max(0, Math.min(width, Math.round(Math.max(b.x, b.x + b.w))));
    const y1 = Math.max(0, Math.min(height, Math.round(Math.max(b.y, b.y + b.h))));
    const w = x1 - x0, h = y1 - y0;
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) return;
    if (!resizeCanvasTo(this.app, w, h, -x0, -y0, 'Crop')) return;
    this.box = null;
    this.app.view.fit(this.app.doc.width, this.app.doc.height);
  }

  drawOverlay(g, view) {
    const b = this.box;
    if (!b) return;
    const a = view.toScreen(b.x, b.y);
    const w = b.w * view.scale, h = b.h * view.scale;
    g.save();
    g.fillStyle = 'rgba(6,10,20,0.55)';
    g.beginPath();
    g.rect(0, 0, view.vw, view.vh);
    g.rect(a.x, a.y, w, h);
    g.fill('evenodd');
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 1;
    g.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    for (let i = 1; i < 3; i++) {
      g.moveTo(a.x + (w * i) / 3, a.y); g.lineTo(a.x + (w * i) / 3, a.y + h);
      g.moveTo(a.x, a.y + (h * i) / 3); g.lineTo(a.x + w, a.y + (h * i) / 3);
    }
    g.stroke();
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(20,30,50,0.9)';
    for (const [u, v] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
      const px = a.x + w * u, py = a.y + h * v;
      g.beginPath();
      g.rect(px - 4, py - 4, 8, 8);
      g.fill();
      g.stroke();
    }
    g.font = '11px ui-monospace, monospace';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillText(`${Math.round(b.w)} × ${Math.round(b.h)}`, a.x + 4, a.y - 6);
    g.restore();
  }

  statusHint() { return 'Drag a crop box · Enter to apply · Esc to cancel'; }
}
