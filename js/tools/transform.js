// Move + free transform. Pixels are "lifted" into a floating canvas that is
// drawn by the renderer with a live affine transform, then baked on commit.
import { Tool } from './base.js';
import { bus } from '../core/bus.js';
import { makeCanvas, ctx2d } from '../core/util.js';

/** A floating piece of pixels being moved/transformed. */
export class TransformSession {
  constructor(app, {
    source, sourceMask, rect, layer, lifted, selectionBefore, layerBeforeData, docDirtyBefore,
  }) {
    this.app = app;
    this.source = source;      // canvas holding the lifted pixels
    this.sourceMask = sourceMask; // cached selection mask for live soft-selection previews
    this.layer = layer;
    this.lifted = lifted;      // true when pixels were cut out of the layer
    this.selectionBefore = selectionBefore;
    this.layerBeforeData = layerBeforeData;
    this.docDirtyBefore = docDirtyBefore;
    this.sourceX = rect.x;
    this.sourceY = rect.y;
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

function maskCanvasForRect(mask, docWidth, rect) {
  const canvas = makeCanvas(rect.w, rect.h);
  const g = ctx2d(canvas);
  const image = g.createImageData(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++) {
    let src = (rect.y + y) * docWidth + rect.x;
    let dst = y * rect.w * 4;
    for (let x = 0; x < rect.w; x++, src++, dst += 4) {
      image.data[dst] = image.data[dst + 1] = image.data[dst + 2] = 255;
      image.data[dst + 3] = mask[src];
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

/** Lift pixels from the active layer (whole layer, or selection contents). */
export function beginSession(app, { cut = true } = {}) {
  app.settlePendingEdit('commit');
  const layer = app.doc.active;
  if (!layer || layer.locked) { app.toast('Layer is locked'); return null; }
  const sel = app.selection;
  const rect = sel.active ? sel.bounds : { x: 0, y: 0, w: app.doc.width, h: app.doc.height };
  // An allocated zero-coverage mask is an active empty selection. Settle any
  // prior pending edit above, but do not allocate a full-layer snapshot,
  // selection canvas, floating canvas, or session for this no-op.
  if (!rect || rect.w <= 0 || rect.h <= 0) return null;

  const layerBeforeData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  const selectionBefore = sel.snapshot();
  const docDirtyBefore = app.doc.dirty;
  const selectionCanvas = selectionBefore
    ? maskCanvasForRect(selectionBefore, app.doc.width, rect)
    : null;
  const source = makeCanvas(rect.w, rect.h);
  const g = ctx2d(source);
  g.drawImage(layer.canvas, -rect.x, -rect.y);

  if (cut) {
    const lg = layer.ctx;
    lg.save();
    if (selectionCanvas) {
      // Partition the original into its unselected and selected fractions.
      // Commit adds those premultiplied fractions, which reconstructs identity
      // exactly even where the selection mask is soft.
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(selectionCanvas, 0, 0);
      g.globalCompositeOperation = 'source-over';
      lg.globalCompositeOperation = 'destination-out';
      lg.drawImage(selectionCanvas, rect.x, rect.y);
    } else {
      lg.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    }
    lg.restore();
    app.doc.touch();
    bus.emit('layers');
  }

  const session = new TransformSession(app, {
    source, sourceMask: selectionCanvas, rect, layer, lifted: cut,
    selectionBefore,
    layerBeforeData,
    docDirtyBefore,
  });
  app.floating = session;
  bus.emit('layers');
  return session;
}

function isIdentityTransform(s) {
  const fullTurns = s.angle / (Math.PI * 2);
  return !s.flipX && !s.flipY &&
    s.x === s.sourceX && s.y === s.sourceY &&
    s.w === s.source.width && s.h === s.source.height &&
    Math.abs(fullTurns - Math.round(fullTurns)) < 1e-12;
}

/** Draw the exact layer pixels represented by a live transform session. */
export function drawSessionLayer(s, g, identity = s.lifted && isIdentityTransform(s)) {
  if (identity) {
    g.putImageData(s.layerBeforeData, 0, 0);
    return;
  }

  g.drawImage(s.layer.canvas, 0, 0);
  if (s.lifted && s.selectionBefore) {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.putImageData(s.layerBeforeData, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(s.sourceMask, s.sourceX, s.sourceY);
    g.globalCompositeOperation = 'source-over';
    s.drawInto(g);
    g.restore();
  } else {
    s.drawInto(g);
  }
}

/** Build the exact committed transform result without changing live state. */
export function stageSession(app, s = app.floating) {
  if (!s || s !== app.floating) return null;
  const canvas = makeCanvas(app.doc.width, app.doc.height);
  const g = ctx2d(canvas, { willReadFrequently: true });
  const identity = s.lifted && isIdentityTransform(s);

  drawSessionLayer(s, g, identity);

  // Selection follows the same affine transform independently of artwork
  // alpha, so selected transparent pixels remain selected.
  const selBefore = s.selectionBefore;
  let selAfter = selBefore ? selBefore.slice() : null;
  if (!identity && selBefore) {
    const sourceMask = s.sourceMask;
    const corners = s.corners();
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))));
    const x1 = Math.min(app.doc.width, Math.ceil(Math.max(...corners.map((p) => p.x))));
    const y1 = Math.min(app.doc.height, Math.ceil(Math.max(...corners.map((p) => p.y))));
    const mask = new Uint8Array(app.doc.width * app.doc.height);

    if (x1 > x0 && y1 > y0) {
      const destinationMask = makeCanvas(x1 - x0, y1 - y0);
      const mg = ctx2d(destinationMask, { willReadFrequently: true });
      mg.save();
      mg.imageSmoothingEnabled = false;
      mg.translate(-x0, -y0);
      s.applyTo(mg);
      mg.drawImage(sourceMask, -s.w / 2, -s.h / 2, s.w, s.h);
      mg.restore();
      const data = mg.getImageData(0, 0, x1 - x0, y1 - y0).data;
      const rowWidth = x1 - x0;
      for (let y = 0; y < y1 - y0; y++) {
        let src = y * rowWidth * 4 + 3;
        let dst = (y0 + y) * app.doc.width + x0;
        for (let x = 0; x < rowWidth; x++, src += 4, dst++) mask[dst] = data[src];
      }
    }
    selAfter = mask;
  }
  const afterData = g.getImageData(0, 0, canvas.width, canvas.height);
  return { session: s, identity, canvas, afterData, selection: selAfter };
}

export function commitSession(app, label = 'Transform', staged = null) {
  const s = app.floating;
  if (!s) return false;
  let result;
  try {
    result = staged?.session === s ? staged : stageSession(app, s);
  } catch {
    return false;
  }
  if (!result) return false;

  app.floating = null;
  const layer = s.layer;
  layer.ctx.putImageData(result.afterData, 0, 0);
  if (result.identity) {
    // This is not an edit: preserve saved/dirty identity and history exactly.
    app.doc.dirty = s.docDirtyBefore;
    app.selection.restore(s.selectionBefore);
    bus.emit('layers');
    return true;
  }

  app.doc.touch();
  const selBefore = s.selectionBefore;
  const selAfter = result.selection;
  app.selection.restore(selAfter);
  const apply = (data, selection) => {
    layer.ctx.putImageData(data, 0, 0);
    app.selection.restore(selection);
    app.doc.touch();
    bus.emit('layers');
    return true;
  };
  app.history.push({
    label,
    undo: () => apply(s.layerBeforeData, selBefore),
    redo: () => apply(result.afterData, selAfter),
  });
  bus.emit('layers');
  return true;
}

export function cancelSession(app) {
  const s = app.floating;
  if (!s) return;
  app.floating = null;
  if (s.lifted) {
    s.layer.ctx.putImageData(s.layerBeforeData, 0, 0);
    app.doc.dirty = s.docDirtyBefore;
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

  clearInteraction() {
    this.mode = null;
    this.handle = null;
    this.startBox = null;
    this.startAngle = null;
    this.grab = null;
    this.autoCommit = false;
    this.commitLabel = 'Move';
  }

  deactivate() {
    if (this.session) commitSession(this.app, 'Move');
    this.clearInteraction();
  }

  resetInteraction() { this.clearInteraction(); }

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
      // Alt starts a duplicate: the pixels are copied instead of lifted, so
      // the original stays behind when the floating copy is committed.
      const duplicate = e.altKey;
      s = beginSession(app, { cut: !duplicate });
      if (!s) return;
      s.showHandles = false;
      this.autoCommit = true;
      this.commitLabel = duplicate ? 'Duplicate' : 'Move';
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
    const s = this.session;
    if (this.autoCommit && s && !s.showHandles) {
      // An Alt-click that never moved would otherwise stamp a copy exactly
      // over its original and push a history entry that changes nothing.
      if (!s.lifted && s.x === s.sourceX && s.y === s.sourceY) cancelSession(this.app);
      else commitSession(this.app, this.commitLabel || 'Move');
      this.autoCommit = false;
    }
    this.commitLabel = 'Move';
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
      : 'Drag to move layer or selection contents · Alt: drag a copy · Arrows nudge';
  }
}
