// Document/layer level operations: resize, canvas size, flip, rotate, layer ops.
import { bus } from '../core/bus.js';
import { makeCanvas, ctx2d, cloneCanvas } from '../core/util.js';
import { Layer } from '../core/doc.js';

/** Snapshot every layer canvas + doc size, for coarse-grained undo. */
function snapshotDoc(doc) {
  return {
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map((l) => ({ layer: l, canvas: cloneCanvas(l.canvas) })),
  };
}

function restoreDoc(app, snap) {
  const doc = app.doc;
  doc.width = snap.width;
  doc.height = snap.height;
  doc.composite = makeCanvas(snap.width, snap.height);
  doc.compositeCtx = ctx2d(doc.composite);
  for (const { layer, canvas } of snap.layers) {
    layer.canvas = makeCanvas(snap.width, snap.height);
    layer.ctx = ctx2d(layer.canvas, { willReadFrequently: true });
    layer.ctx.drawImage(canvas, 0, 0);
  }
  app.selection.resize(snap.width, snap.height);
  doc.touch();
  bus.emit('doc');
  bus.emit('layers');
  bus.emit('selection');
}

/** Generic "rebuild all layers" op with undo. */
export function docOp(app, label, w, h, drawLayer) {
  const before = snapshotDoc(app.doc);
  const selBefore = app.selection.snapshot();
  const run = () => {
    const doc = app.doc;
    for (const l of doc.layers) {
      const src = l.canvas;
      const next = makeCanvas(w, h);
      const g = ctx2d(next);
      drawLayer(g, src, w, h);
      l.canvas = next;
      l.ctx = ctx2d(next, { willReadFrequently: true });
    }
    doc.width = w;
    doc.height = h;
    doc.composite = makeCanvas(w, h);
    doc.compositeCtx = ctx2d(doc.composite);
    app.selection.resize(w, h);
    doc.touch();
    bus.emit('doc');
    bus.emit('layers');
    bus.emit('selection');
  };
  run();
  const after = snapshotDoc(app.doc);
  app.history.push({
    label,
    undo: () => { restoreDoc(app, before); app.selection.restore(selBefore); },
    redo: () => restoreDoc(app, after),
  });
}

export function resizeCanvasTo(app, w, h, dx, dy, label = 'Canvas Size') {
  docOp(app, label, w, h, (g, src) => g.drawImage(src, dx, dy));
}

export function resizeImage(app, w, h, smooth = false) {
  docOp(app, 'Image Size', w, h, (g, src) => {
    g.imageSmoothingEnabled = smooth;
    if (smooth) g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
  });
}

export function flipDoc(app, axis) {
  const { width: w, height: h } = app.doc;
  docOp(app, axis === 'x' ? 'Flip Horizontal' : 'Flip Vertical', w, h, (g, src) => {
    g.translate(axis === 'x' ? w : 0, axis === 'y' ? h : 0);
    g.scale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1);
    g.drawImage(src, 0, 0);
  });
}

export function rotateDoc(app, deg) {
  const { width: w, height: h } = app.doc;
  const swap = deg === 90 || deg === 270;
  const nw = swap ? h : w, nh = swap ? w : h;
  docOp(app, `Rotate ${deg}°`, nw, nh, (g, src) => {
    g.translate(nw / 2, nh / 2);
    g.rotate((deg * Math.PI) / 180);
    g.drawImage(src, -w / 2, -h / 2);
  });
}

/** Flip / rotate only the active layer (or selection contents). */
export function transformLayer(app, kind) {
  const layer = app.doc.active;
  if (!layer || layer.locked) return;
  const before = cloneCanvas(layer.canvas);
  const { width: w, height: h } = layer.canvas;
  const sel = app.selection;
  const region = sel.active ? sel.bounds : { x: 0, y: 0, w, h };
  const src = makeCanvas(region.w, region.h);
  const sg = ctx2d(src);
  sg.drawImage(layer.canvas, -region.x, -region.y);
  if (sel.active) {
    sg.globalCompositeOperation = 'destination-in';
    sg.drawImage(sel.toCanvas(), -region.x, -region.y);
  }

  const g = layer.ctx;
  g.save();
  if (sel.active) {
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(sel.toCanvas(), 0, 0);
    g.globalCompositeOperation = 'source-over';
  } else {
    g.clearRect(0, 0, w, h);
  }
  g.translate(region.x + region.w / 2, region.y + region.h / 2);
  if (kind === 'flipX') g.scale(-1, 1);
  else if (kind === 'flipY') g.scale(1, -1);
  else if (kind === 'rot90') g.rotate(Math.PI / 2);
  else if (kind === 'rot270') g.rotate(-Math.PI / 2);
  else if (kind === 'rot180') g.rotate(Math.PI);
  g.imageSmoothingEnabled = false;
  g.drawImage(src, -region.w / 2, -region.h / 2);
  g.restore();

  app.doc.touch();
  bus.emit('layers');
  const after = cloneCanvas(layer.canvas);
  const apply = (c) => {
    layer.ctx.clearRect(0, 0, w, h);
    layer.ctx.drawImage(c, 0, 0);
    app.doc.touch();
    bus.emit('layers');
  };
  app.history.push({ label: 'Transform Layer', undo: () => apply(before), redo: () => apply(after) });
}

/* ---------- layer operations ---------- */

export function addLayer(app, name) {
  const doc = app.doc;
  const layer = new Layer(doc.width, doc.height, name || `Layer ${doc.layers.length + 1}`);
  const index = doc.activeIndex + 1;
  const prevActive = doc.activeId;
  doc.addLayer(layer, index);
  app.history.push({
    label: 'New Layer',
    undo: () => { doc.removeLayer(layer.id); doc.activeId = prevActive; bus.emit('doc'); },
    redo: () => doc.addLayer(layer, index),
  });
  return layer;
}

export function duplicateLayer(app) {
  const doc = app.doc;
  const src = doc.active;
  if (!src) return;
  const copy = src.clone();
  const index = doc.layers.indexOf(src) + 1;
  const prevActive = doc.activeId;
  doc.addLayer(copy, index);
  app.history.push({
    label: 'Duplicate Layer',
    undo: () => { doc.removeLayer(copy.id); doc.activeId = prevActive; bus.emit('doc'); },
    redo: () => doc.addLayer(copy, index),
  });
}

export function deleteLayer(app) {
  const doc = app.doc;
  if (doc.layers.length <= 1) { app.toast('Cannot delete the last layer'); return; }
  const id = doc.activeId;
  const removed = doc.removeLayer(id);
  if (!removed) return;
  app.history.push({
    label: 'Delete Layer',
    undo: () => doc.addLayer(removed.layer, removed.index),
    redo: () => doc.removeLayer(removed.layer.id),
  });
}

export function moveLayer(app, delta, id = app.doc.activeId) {
  const doc = app.doc;
  if (!doc.moveLayer(id, delta)) return;
  app.history.push({
    label: 'Reorder Layer',
    undo: () => doc.moveLayer(id, -delta),
    redo: () => doc.moveLayer(id, delta),
  });
}

export function mergeDown(app) {
  const doc = app.doc;
  const i = doc.activeIndex;
  if (i <= 0) { app.toast('No layer below'); return; }
  const top = doc.layers[i], below = doc.layers[i - 1];
  const belowBefore = cloneCanvas(below.canvas);
  const g = below.ctx;
  g.save();
  g.globalAlpha = top.opacity;
  g.globalCompositeOperation = top.blend;
  if (top.visible) g.drawImage(top.canvas, 0, 0);
  g.restore();
  doc.layers.splice(i, 1);
  doc.activeId = below.id;
  doc.touch();
  bus.emit('doc');
  bus.emit('layers');
  app.history.push({
    label: 'Merge Down',
    undo: () => {
      below.ctx.clearRect(0, 0, doc.width, doc.height);
      below.ctx.drawImage(belowBefore, 0, 0);
      doc.layers.splice(i, 0, top);
      doc.activeId = top.id;
      doc.touch();
      bus.emit('doc'); bus.emit('layers');
    },
    redo: () => { mergeDownRaw(doc, i, top, below); },
  });
}

function mergeDownRaw(doc, i, top, below) {
  const g = below.ctx;
  g.save();
  g.globalAlpha = top.opacity;
  g.globalCompositeOperation = top.blend;
  if (top.visible) g.drawImage(top.canvas, 0, 0);
  g.restore();
  doc.layers.splice(i, 1);
  doc.activeId = below.id;
  doc.touch();
  bus.emit('doc'); bus.emit('layers');
}

export function flattenImage(app) {
  const doc = app.doc;
  const before = snapshotDoc(doc);
  const beforeLayers = doc.layers.slice();
  const beforeActive = doc.activeId;
  const flat = new Layer(doc.width, doc.height, 'Flattened');
  flat.ctx.drawImage(doc.flatten(), 0, 0);
  doc.layers = [flat];
  doc.activeId = flat.id;
  doc.touch();
  bus.emit('doc'); bus.emit('layers');
  app.history.push({
    label: 'Flatten Image',
    undo: () => {
      doc.layers = beforeLayers;
      doc.activeId = beforeActive;
      for (const { layer, canvas } of before.layers) {
        layer.ctx.clearRect(0, 0, doc.width, doc.height);
        layer.ctx.drawImage(canvas, 0, 0);
      }
      doc.touch(); bus.emit('doc'); bus.emit('layers');
    },
    redo: () => {
      doc.layers = [flat];
      doc.activeId = flat.id;
      doc.touch(); bus.emit('doc'); bus.emit('layers');
    },
  });
}

/** Set a layer property with undo (opacity, blend, visible, name). */
export function setLayerProp(app, layer, key, value, label = 'Layer Property') {
  const before = layer[key];
  if (before === value) return;
  const apply = (v) => {
    layer[key] = v;
    app.doc.touch();
    bus.emit('doc');
    bus.emit('layers');
  };
  apply(value);
  app.history.push({ label, undo: () => apply(before), redo: () => apply(value) });
}

/* ---------- selection-content ops ---------- */

export function clearSelection(app) {
  const layer = app.doc.active;
  if (!layer || layer.locked) return;
  const before = cloneCanvas(layer.canvas);
  const g = layer.ctx;
  g.save();
  if (app.selection.active) {
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(app.selection.toCanvas(), 0, 0);
  } else {
    g.clearRect(0, 0, app.doc.width, app.doc.height);
  }
  g.restore();
  app.doc.touch();
  bus.emit('layers');
  const after = cloneCanvas(layer.canvas);
  const apply = (c) => {
    layer.ctx.clearRect(0, 0, app.doc.width, app.doc.height);
    layer.ctx.drawImage(c, 0, 0);
    app.doc.touch();
    bus.emit('layers');
  };
  app.history.push({ label: 'Clear', undo: () => apply(before), redo: () => apply(after) });
}

export function fillSelection(app, color) {
  const layer = app.doc.active;
  if (!layer || layer.locked) return;
  const before = cloneCanvas(layer.canvas);
  const g = layer.ctx;
  g.save();
  if (app.selection.active) {
    const tmp = makeCanvas(app.doc.width, app.doc.height);
    const tg = ctx2d(tmp);
    tg.fillStyle = color;
    tg.fillRect(0, 0, tmp.width, tmp.height);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(app.selection.toCanvas(), 0, 0);
    g.drawImage(tmp, 0, 0);
  } else {
    g.fillStyle = color;
    g.fillRect(0, 0, app.doc.width, app.doc.height);
  }
  g.restore();
  app.doc.touch();
  bus.emit('layers');
  const after = cloneCanvas(layer.canvas);
  const apply = (c) => {
    layer.ctx.clearRect(0, 0, app.doc.width, app.doc.height);
    layer.ctx.drawImage(c, 0, 0);
    app.doc.touch();
    bus.emit('layers');
  };
  app.history.push({ label: 'Fill', undo: () => apply(before), redo: () => apply(after) });
}
