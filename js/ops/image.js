// Document/layer level operations: resize, canvas size, flip, rotate, layer ops.
import { bus } from '../core/bus.js';
import { makeCanvas, ctx2d, cloneCanvas, validateEditorDimensions } from '../core/util.js';
import { Layer } from '../core/doc.js';

/** Snapshot every layer canvas + doc size, for coarse-grained undo. */
function snapshotDoc(doc) {
  return {
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map((l) => ({ layer: l, canvas: cloneCanvas(l.canvas) })),
  };
}

/** Allocate and draw a complete replacement without touching live state. */
function buildDocState(snap, selection = null) {
  const layers = snap.layers.map(({ layer, canvas: src }) => {
    const canvas = makeCanvas(snap.width, snap.height);
    const ctx = ctx2d(canvas, { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    return { layer, canvas, ctx };
  });
  const composite = makeCanvas(snap.width, snap.height);
  const compositeCtx = ctx2d(composite);
  return {
    width: snap.width,
    height: snap.height,
    layers,
    composite,
    compositeCtx,
    selection: selection ? selection.slice() : null,
  };
}

/** Replace live state only after every fallible restoration step succeeded. */
function applyDocState(app, state) {
  const doc = app.doc;
  for (const { layer, canvas, ctx } of state.layers) {
    layer.canvas = canvas;
    layer.ctx = ctx;
  }
  doc.width = state.width;
  doc.height = state.height;
  doc.composite = state.composite;
  doc.compositeCtx = state.compositeCtx;
  app.selection.resize(state.width, state.height);
  app.selection.mask = state.selection;
  app.selection._recompute();
  doc.touch();
  bus.emit('doc');
  bus.emit('layers');
  bus.emit('selection');
  return true;
}

/** Restore bytes into the existing layer canvases so older history closures
 * keep targeting the live contexts after a document operation is undone. */
function restoreDoc(app, snap, selection = null) {
  const prepared = buildDocState(snap, selection);
  const doc = app.doc;
  const replacements = prepared.layers.map(({ layer, canvas }) => {
    if (layer.canvas.width === snap.width && layer.canvas.height === snap.height) return null;
    const replacement = makeCanvas(snap.width, snap.height);
    return { layer, replacement, ctx: ctx2d(replacement, { willReadFrequently: true }), canvas };
  });
  for (const item of replacements) {
    if (!item) continue;
    item.ctx.drawImage(item.canvas, 0, 0);
  }
  for (const item of replacements) {
    if (!item) continue;
    item.layer.canvas = item.replacement;
    item.layer.ctx = item.ctx;
  }
  for (const { layer, canvas } of prepared.layers) {
    const replacement = replacements.find((item) => item?.layer === layer);
    if (!replacement) {
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.clearRect(0, 0, snap.width, snap.height);
      layer.ctx.drawImage(canvas, 0, 0);
    }
  }
  doc.width = snap.width;
  doc.height = snap.height;
  doc.composite = prepared.composite;
  doc.compositeCtx = prepared.compositeCtx;
  app.selection.resize(snap.width, snap.height);
  app.selection.mask = prepared.selection;
  app.selection._recompute();
  doc.touch();
  bus.emit('doc');
  bus.emit('layers');
  bus.emit('selection');
  return true;
}

/** Generic "rebuild all layers" op with undo. */
export function docOp(app, label, w, h, drawLayer) {
  // This exported boundary is also used outside the dialogs. Reject hostile or
  // stale metadata before settling edits, snapshotting layers, or allocating.
  try { validateEditorDimensions(w, h); }
  catch { app.toast?.('Invalid or oversized document dimensions'); return false; }
  let doc, before, selBefore, after, next, prepared;
  try {
    doc = app.doc;
    prepared = app.stageMutation();
    if (!prepared) throw new Error('Could not stage pending edit');
    selBefore = prepared.floating?.selection ?? app.selection.snapshot();
    before = snapshotDoc(doc);
    if (prepared.floating) {
      const floatingLayer = before.layers.find(({ layer }) =>
        layer === prepared.floating.session.layer);
      if (!floatingLayer) throw new Error('Floating layer is no longer in the document');
      floatingLayer.canvas = cloneCanvas(prepared.floating.canvas);
    }

    // Preflight the complete operation before settling a pending stroke,
    // opacity gesture, or floating transform. Failure therefore preserves the
    // exact pending owner and preview as well as document/history state.
    const layers = before.layers.map(({ layer, canvas: src }) => {
      const canvas = makeCanvas(w, h);
      const ctx = ctx2d(canvas, { willReadFrequently: true });
      drawLayer(ctx, src, w, h);
      return { layer, canvas, ctx };
    });
    const composite = makeCanvas(w, h);
    const compositeCtx = ctx2d(composite);

    // Keep immutable history pixels, and prebuild the committed state. Undo
    // and redo likewise allocate before replacing any live object.
    after = {
      width: w,
      height: h,
      layers: layers.map(({ layer, canvas }) => ({ layer, canvas: cloneCanvas(canvas) })),
    };
    next = { width: w, height: h, layers, composite, compositeCtx, selection: null };
  } catch {
    app.toast?.('Could not update document');
    return false;
  }

  // All fallible detached work has completed. Settle exactly the pending state
  // that was staged, then apply one document operation.
  if (!app.commitPreparedMutation(prepared)) {
    app.toast?.('Could not update document');
    return false;
  }
  // Settlement is now complete and cannot invalidate detached construction.
  // The detached source already includes staged pending/floating results, so
  // it is also the correct undo state after settlement.
  applyDocState(app, next);
  app.history.push({
    label,
    undo: () => restoreDoc(app, before, selBefore),
    redo: () => restoreDoc(app, after),
  });
  return true;
}

export function resizeCanvasTo(app, w, h, dx, dy, label = 'Canvas Size') {
  return docOp(app, label, w, h, (g, src) => g.drawImage(src, dx, dy));
}

export function resizeImage(app, w, h, smooth = false) {
  return docOp(app, 'Image Size', w, h, (g, src) => {
    g.imageSmoothingEnabled = smooth;
    if (smooth) g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
  });
}

export function flipDoc(app, axis) {
  const { width: w, height: h } = app.doc;
  return docOp(app, axis === 'x' ? 'Flip Horizontal' : 'Flip Vertical', w, h, (g, src) => {
    g.translate(axis === 'x' ? w : 0, axis === 'y' ? h : 0);
    g.scale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1);
    g.drawImage(src, 0, 0);
  });
}

export function rotateDoc(app, deg) {
  const { width: w, height: h } = app.doc;
  const swap = deg === 90 || deg === 270;
  const nw = swap ? h : w, nh = swap ? w : h;
  return docOp(app, `Rotate ${deg}°`, nw, nh, (g, src) => {
    g.translate(nw / 2, nh / 2);
    g.rotate((deg * Math.PI) / 180);
    g.drawImage(src, -w / 2, -h / 2);
  });
}

/** Flip / rotate only the active layer (or selection contents). */
export function transformLayer(app, kind) {
  app.prepareMutation();
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

  // Recompose from the immutable original. With a soft mask the selected and
  // unselected premultiplied fractions are additive; source-over would apply
  // coverage twice and attenuate an identity transform (50% became 75% alpha).
  const result = sel.active ? cloneCanvas(before) : makeCanvas(w, h);
  const g = ctx2d(result);
  g.save();
  if (sel.active) {
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(sel.toCanvas(), 0, 0);
    g.globalCompositeOperation = 'lighter';
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
  layer.ctx.clearRect(0, 0, w, h);
  layer.ctx.drawImage(result, 0, 0);

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
  app.prepareMutation();
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
  app.prepareMutation();
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
  app.prepareMutation();
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
  app.prepareMutation();
  const doc = app.doc;
  if (!doc.moveLayer(id, delta)) return;
  app.history.push({
    label: 'Reorder Layer',
    undo: () => doc.moveLayer(id, -delta),
    redo: () => doc.moveLayer(id, delta),
  });
}

export function mergeDown(app) {
  app.prepareMutation();
  const doc = app.doc;
  const i = doc.activeIndex;
  if (i <= 0) { app.toast('No layer below'); return; }
  const top = doc.layers[i], below = doc.layers[i - 1];
  const topContributes = top.visible && top.opacity > 0;
  const belowContributes = below.visible && below.opacity > 0;
  const pairHasBlend = (topContributes && top.blend !== 'source-over') ||
    (belowContributes && below.blend !== 'source-over');
  // A non-normal pair can be baked exactly when it has no contributing
  // backdrop. With a backdrop, its result is generally backdrop-dependent and
  // cannot be represented by one normal layer without flattening that layer.
  const hasBackdrop = doc.layers.slice(0, i - 1)
    .some((layer) => layer.visible && layer.opacity > 0);
  if (pairHasBlend && hasBackdrop) {
    app.toast('Cannot merge backdrop-dependent blend modes');
    return;
  }
  const belowCanvas = cloneCanvas(below.canvas);
  const belowProps = {
    visible: below.visible, opacity: below.opacity, blend: below.blend, locked: below.locked,
  };

  // Bake exactly the pair's displayed contribution into a normal, fully
  // opaque layer. Retaining the lower visibility or opacity would apply it
  // twice and can hide or attenuate the upper layer.
  const mergedCanvas = makeCanvas(doc.width, doc.height);
  const g = ctx2d(mergedCanvas);
  if (below.visible && below.opacity > 0) {
    g.globalAlpha = below.opacity;
    g.globalCompositeOperation = below.blend;
    g.drawImage(below.canvas, 0, 0);
  }
  if (top.visible && top.opacity > 0) {
    g.globalAlpha = top.opacity;
    g.globalCompositeOperation = top.blend;
    g.drawImage(top.canvas, 0, 0);
  }

  const applyMerged = () => {
    below.ctx.clearRect(0, 0, doc.width, doc.height);
    below.ctx.drawImage(mergedCanvas, 0, 0);
    below.visible = true;
    below.opacity = 1;
    below.blend = 'source-over';
    below.locked = belowProps.locked;
    doc.layers.splice(i, 1);
    doc.activeId = below.id;
    doc.touch();
    bus.emit('doc'); bus.emit('layers');
  };
  applyMerged();
  app.history.push({
    label: 'Merge Down',
    undo: () => {
      below.ctx.clearRect(0, 0, doc.width, doc.height);
      below.ctx.drawImage(belowCanvas, 0, 0);
      Object.assign(below, belowProps);
      doc.layers.splice(i, 0, top);
      doc.activeId = top.id;
      doc.touch();
      bus.emit('doc'); bus.emit('layers');
    },
    redo: applyMerged,
  });
}

export function flattenImage(app) {
  app.prepareMutation();
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
  app.prepareMutation();
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
  app.prepareMutation();
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
  app.prepareMutation();
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
