// Move + free transform. Pixels are "lifted" into a floating canvas that is
// drawn by the renderer with a live affine transform, then baked on commit.
import { Tool } from './base.js';
import { bus } from '../core/bus.js';
import { makeCanvas, ctx2d, cloneCanvas } from '../core/util.js';
import { layerEntry } from '../core/history.js';

/** A floating piece of pixels being moved/transformed. */
export class TransformSession {
  constructor(app, { source, rect, layer, lifted, selectionBefore, layerBefore }) {
    this.app = app;
    this.source = source;      // canvas holding the lifted pixels
    this.layer = layer;
    this.lifted = lifted;      // true when pixels were cut out of the layer
    this.selectionBefore = selectionBefore;
    this.layerBefore = layerBefore;
    this.x = rect.x;           // dest box in image space
    this.y = rect.y;
    this.w = rect.w;
    this.h = rect.h;
    this.angle = 0;
    this.flipX = false;
    this.flipY = false;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  /** Apply this session's transform to a 2D context in image space. */
  applyTo(g) {
    g.translate(this.cx, this.cy);
    g.rotate(this.angle);
    g.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
  }

  drawInto(g) {
    g.save();
    g.imageSmoothingEnabled = false;
    this.applyTo(g);
    g.drawImage(this.source, -this.w / 2, -this.h / 2, this.w, this.h);
    g.restore();
  }

  /** Corner points in image space, order: tl, tr, br, bl. */
  corners() {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const hw = this.w / 2, hh = this.h / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({
      x: this.cx + x * c - y * s,
      y: this.cy + x * s + y * c,
    }));
  }

  /** Convert a point from image space into the un-rotated box space. */
  toLocal(px, py) {
    const c = Math.cos(-this.angle), s = Math.sin(-this.angle);
    const dx = px - this.cx, dy = py - this.cy;
    return { x: dx * c - dy * s + this.w / 2, y: dx * s + dy * c + this.h / 2 };
  }
}

/** Lift pixels from the active layer (whole layer, or selection contents). */
export function beginSession(app, { cut = true } = {}) {
  const layer = app.doc.active;
  if (!layer || layer.locked) { app.toast('Layer is locked'); return null; }
  const sel = app.selection;
  const layerBefore = cloneCanvas(layer.canvas);
  let rect = sel.active ? sel.bounds : { x: 0, y: 0, w: app.doc.width, h: app.doc.height };
  if (!rect || rect.w <= 0) return null;

  const source = makeCanvas(rect.w, rect.h);
  const g = ctx2d(source);
  g.drawImage(layer.canvas, -rect.x, -rect.y);
  if (sel.active) {
    const maskCanvas = sel.toCanvas();
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(maskCanvas, -rect.x, -rect.y);
    g.globalCompositeOperation = 'source-over';
  }

  if (cut) {
    const lg = layer.ctx;
    lg.save();
    if (sel.active) {
      lg.globalCompositeOperation = 'destination-out';
      lg.drawImage(sel.toCanvas(), 0, 0);
    } else {
      lg.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    }
    lg.restore();
    app.doc.touch();
    bus.emit('layers');
  }

  const session = new TransformSession(app, {
    source, rect, layer, lifted: cut,
    selectionBefore: sel.snapshot(),
    layerBefore,
  });
  app.floating = session;
  bus.emit('layers');
  return session;
}

export function commitSession(app, label = 'Transform') {
  const s = app.floating;
  if (!s) return;
  app.floating = null;
  const layer = s.layer;
  s.drawInto(layer.ctx);
  app.doc.touch();

  // Selection follows the transformed pixels when a selection was lifted.
  const selBefore = s.selectionBefore;
  let selAfter = selBefore;
  if (selBefore) {
    const m = makeCanvas(app.doc.width, app.doc.height);
    const mg = ctx2d(m);
    mg.save();
    mg.imageSmoothingEnabled = false;
    s.applyTo(mg);
    mg.drawImage(s.source, -s.w / 2, -s.h / 2, s.w, s.h);
    mg.restore();
    const d = mg.getImageData(0, 0, app.doc.width, app.doc.height).data;
    const mask = new Uint8Array(app.doc.width * app.doc.height);
    for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3];
    selAfter = mask;
    app.selection.restore(mask);
  }

  const entry = layerEntry(app.doc, layer, s.layerBefore, label);
  app.history.push({
    label,
    undo: () => { entry.undo(); app.selection.restore(selBefore); },
    redo: () => { entry.redo(); app.selection.restore(selAfter); },
  });
  bus.emit('layers');
}

export function cancelSession(app) {
  const s = app.floating;
  if (!s) return;
  app.floating = null;
  if (s.lifted) {
    const lg = s.layer.ctx;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.clearRect(0, 0, s.layer.canvas.width, s.layer.canvas.height);
    lg.drawImage(s.layerBefore, 0, 0);
    app.doc.touch();
  }
  app.selection.restore(s.selectionBefore);
  bus.emit('layers');
}

const HANDLES = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1],
  ['sw', 0, 1], ['w', 0, 0.5],
];

export class MoveTool extends Tool {
  static id = 'move';
  static label = 'Move';
  static icon = 'move';
  static cursor = 'move';
  static options = [
    { key: 'snap', type: 'toggle', label: 'Snap to pixel', default: true },
  ];

  get session() { return this.app.floating; }

  deactivate() {
    if (this.session) commitSession(this.app, 'Move');
  }

  handleAt(sx, sy) {
    const s = this.session;
    if (!s || !s.showHandles) return null;
    const view = this.app.view;
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    for (const [name, u, v] of HANDLES) {
      const lx = (u - 0.5) * s.w, ly = (v - 0.5) * s.h;
      const p = view.toScreen(s.cx + lx * c - ly * sn, s.cy + lx * sn + ly * c);
      if (Math.abs(p.x - sx) <= 7 && Math.abs(p.y - sy) <= 7) return name;
    }
    // rotate zone: just outside a corner
    const corner = s.corners()[1];
    const p = view.toScreen(corner.x, corner.y);
    if (Math.hypot(p.x - sx, p.y - sy) <= 22) return 'rotate';
    return null;
  }

  onDown(e) {
    const app = this.app;
    let s = this.session;
    if (s) {
      const handle = this.handleAt(e.sx, e.sy);
      if (handle) {
        this.mode = handle === 'rotate' ? 'rotate' : 'scale';
        this.handle = handle;
        this.startBox = { x: s.x, y: s.y, w: s.w, h: s.h, angle: s.angle };
        this.startAngle = Math.atan2(e.fy - s.cy, e.fx - s.cx) - s.angle;
        this.grab = { x: e.fx, y: e.fy };
        return;
      }
      this.mode = 'translate';
    } else {
      s = beginSession(app, { cut: true });
      if (!s) return;
      s.showHandles = false;
      this.autoCommit = true;
      this.mode = 'translate';
    }
    this.grab = { x: e.fx, y: e.fy };
    this.startBox = { x: s.x, y: s.y, w: s.w, h: s.h, angle: s.angle };
  }

  onMove(e) {
    const s = this.session;
    if (!s || !this.mode) return;
    const snap = this.opts.snap !== false;
    if (this.mode === 'translate') {
      let dx = e.fx - this.grab.x, dy = e.fy - this.grab.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      s.x = this.startBox.x + dx;
      s.y = this.startBox.y + dy;
      if (snap) { s.x = Math.round(s.x); s.y = Math.round(s.y); }
    } else if (this.mode === 'rotate') {
      let a = Math.atan2(e.fy - s.cy, e.fx - s.cx) - this.startAngle;
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      s.angle = a;
    } else {
      this.scaleDrag(e, snap);
    }
    bus.emit('layers');
  }

  /**
   * Resize by keeping the handle's opposite edge/corner (the anchor) fixed in
   * world space. All math happens in the start box's un-rotated frame.
   */
  scaleDrag(e, snap) {
    const s = this.session;
    const b = this.startBox;
    const h = this.handle;
    const c = Math.cos(b.angle), sn = Math.sin(b.angle);
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    // pointer in start-box local coords (origin at box top-left, y down)
    const dx = e.fx - bcx, dy = e.fy - bcy;
    const lx = dx * c + dy * sn + b.w / 2;
    const ly = -dx * sn + dy * c + b.h / 2;

    // anchor in local coords: the opposite side of the dragged handle
    const ax = h.includes('w') ? b.w : h.includes('e') ? 0 : b.w / 2;
    const ay = h.includes('n') ? b.h : h.includes('s') ? 0 : b.h / 2;

    let nw = b.w, nh = b.h;
    if (h.includes('e')) nw = Math.max(1, lx - ax);
    else if (h.includes('w')) nw = Math.max(1, ax - lx);
    if (h.includes('s')) nh = Math.max(1, ly - ay);
    else if (h.includes('n')) nh = Math.max(1, ay - ly);

    if (e.shiftKey && h.length === 2) {
      const ratio = b.w / b.h;
      if (nw / ratio > nh) nh = nw / ratio; else nw = nh * ratio;
    }
    if (snap) { nw = Math.max(1, Math.round(nw)); nh = Math.max(1, Math.round(nh)); }

    // world position of the anchor must not move
    const awx = bcx + (ax - b.w / 2) * c - (ay - b.h / 2) * sn;
    const awy = bcy + (ax - b.w / 2) * sn + (ay - b.h / 2) * c;
    const nax = h.includes('w') ? nw : h.includes('e') ? 0 : nw / 2;
    const nay = h.includes('n') ? nh : h.includes('s') ? 0 : nh / 2;
    const ncx = awx - ((nax - nw / 2) * c - (nay - nh / 2) * sn);
    const ncy = awy - ((nax - nw / 2) * sn + (nay - nh / 2) * c);

    s.w = nw; s.h = nh;
    s.x = ncx - nw / 2;
    s.y = ncy - nh / 2;
    if (snap && b.angle === 0) { s.x = Math.round(s.x); s.y = Math.round(s.y); }
  }

  onUp() {
    this.mode = null;
    if (this.autoCommit && this.session && !this.session.showHandles) {
      commitSession(this.app, 'Move');
      this.autoCommit = false;
    }
  }

  onKey(e) {
    const s = this.session;
    if (e.key === 'Enter' && s) { commitSession(this.app, 'Transform'); return true; }
    if (e.key === 'Escape' && s) { cancelSession(this.app); return true; }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (nudge) {
      const step = e.shiftKey ? 10 : 1;
      if (s) {
        s.x += nudge[0] * step; s.y += nudge[1] * step;
        bus.emit('layers');
      } else {
        const ns = beginSession(this.app, { cut: true });
        if (ns) {
          ns.showHandles = false;
          ns.x += nudge[0] * step; ns.y += nudge[1] * step;
          commitSession(this.app, 'Move');
        }
      }
      return true;
    }
    return false;
  }

  drawOverlay(g, view) {
    const s = this.session;
    if (!s || !s.showHandles) return;
    const pts = s.corners().map((p) => view.toScreen(p.x, p.y));
    g.save();
    g.strokeStyle = 'rgba(120,200,255,0.95)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.closePath();
    g.stroke();
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(20,30,50,0.9)';
    for (const [, u, v] of HANDLES) {
      const lx = (u - 0.5) * s.w, ly = (v - 0.5) * s.h;
      const p = view.toScreen(s.cx + lx * c - ly * sn, s.cy + lx * sn + ly * c);
      g.beginPath();
      g.rect(p.x - 4, p.y - 4, 8, 8);
      g.fill();
      g.stroke();
    }
    g.restore();
  }

  statusHint() {
    return this.session?.showHandles
      ? 'Drag handles to scale · drag outside a corner to rotate · Enter to apply · Esc to cancel'
      : 'Drag to move layer or selection contents · Arrows nudge';
  }
}
