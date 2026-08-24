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

/** Snapshot the exact pixels represented by a staged mutation. */
function snapshotPreparedDoc(app, prepared) {
  const snap = snapshotDoc(app.doc);
  const pending = prepared.pending;
  if (pending?.staged?.painter && pending.edit?.layer) {
    const target = snap.layers.find(({ layer }) => layer === pending.edit.layer);
    if (!target) throw new Error('Pending layer is no longer in the document');
    const image = pending.staged.painter.image;
    const ctx = ctx2d(target.canvas, { willReadFrequently: true });
    ctx.putImageData(image, 0, 0);
  }
  if (prepared.floating) {
    const target = snap.layers.find(({ layer }) => layer === prepared.floating.session.layer);
    if (!target) throw new Error('Floating layer is no longer in the document');
    target.canvas = cloneCanvas(prepared.floating.canvas);
  }
  return snap;
}

/** Prepare selection metadata without touching the live Selection object. */
function buildSelectionState(width, height, source = null) {
  let mask = source ? source.slice() : null;
  let bounds = null;
  if (mask) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!mask[y * width + x]) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x >= x1) x1 = x + 1;
        if (y >= y1) y1 = y + 1;
      }
    }
    if (x1 > x0) bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return { width, height, mask, bounds, outline: null };
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
    selection: buildSelectionState(snap.width, snap.height, selection),
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
  app.selection.width = state.selection.width;
  app.selection.height = state.selection.height;
  app.selection.mask = state.selection.mask;
  app.selection.bounds = state.selection.bounds;
  app.selection._outline = state.selection.outline;
  doc.touch();
  bus.emit('doc');
  bus.emit('layers');
  bus.emit('selection');
  return true;
}

/** Restore only after all target pixels and metadata are ready off-state. */
function restoreDoc(app, snap, selection = null) {
  return applyDocState(app, buildDocState(snap, selection));
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
    before = snapshotPreparedDoc(app, prepared);

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
    next = {
      width: w,
      height: h,
      layers,
      composite,
      compositeCtx,
      selection: buildSelectionState(w, h),
    };
  } catch {
    app.toast?.('Could not update document');
    return false;
  }

  // All fallible detached work has completed. Settle exactly the pending state
  // that was staged, then apply one document operation. Settlement itself may
  // publish already-committed history/events, so observer failures are isolated
  // by the event bus rather than escaping this commit boundary.
  try {
    if (!app.commitPreparedMutation(prepared)) {
      app.toast?.('Could not update document');
      return false;
    }
    // The detached source already includes staged pending/floating results, so
    // it is also the correct undo state after settlement.
    applyDocState(app, next);
    app.history.push({
      label,
      undo: () => restoreDoc(app, before, selBefore),
      redo: () => restoreDoc(app, after),
    });
    return true;
  } catch {
    app.toast?.('Could not update document');
    return false;
  }
}

export function resizeCanvasTo(app, w, h, dx, dy, label = 'Canvas Size') {
  return docOp(app, label, w, h, (g, src) => g.drawImage(src, dx, dy));
}

/** Trim using one detached staged state for both bounds and committed pixels. */
export function trimTransparentEdges(app) {
  let prepared, before, selBefore, bounds, next, after;
  try {
    prepared = app.stageMutation();
    if (!prepared) throw new Error('Could not stage pending edit');
    before = snapshotPreparedDoc(app, prepared);
    selBefore = prepared.floating?.selection ?? app.selection.snapshot();

    const flat = makeCanvas(before.width, before.height);
    const g = ctx2d(flat, { willReadFrequently: true });
    for (const { layer, canvas } of before.layers) {
      if (!layer.visible) continue;
      const opacity = prepared.pending?.edit?.layer === layer &&
        Number.isFinite(prepared.pending?.staged?.after)
        ? prepared.pending.staged.after : layer.opacity;
      if (opacity <= 0) continue;
      g.globalAlpha = opacity;
      g.globalCompositeOperation = layer.blend;
      g.drawImage(canvas, 0, 0);
    }
    const data = g.getImageData(0, 0, before.width, before.height).data;
    let x0 = before.width, y0 = before.height, x1 = -1, y1 = -1;
    for (let y = 0; y < before.height; y++) {
      for (let x = 0; x < before.width; x++) {
        if (!data[(y * before.width + x) * 4 + 3]) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return 'empty';
    if (x0 === 0 && y0 === 0 && x1 === before.width - 1 && y1 === before.height - 1) {
      return 'unchanged';
    }
    bounds = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };

    const layers = before.layers.map(({ layer, canvas: src }) => {
      const canvas = makeCanvas(bounds.w, bounds.h);
      const ctx = ctx2d(canvas, { willReadFrequently: true });
      ctx.drawImage(src, -bounds.x, -bounds.y);
      return { layer, canvas, ctx };
    });
    after = {
      width: bounds.w,
      height: bounds.h,
      layers: layers.map(({ layer, canvas }) => ({ layer, canvas: cloneCanvas(canvas) })),
    };
    next = {
      width: bounds.w,
      height: bounds.h,
      layers,
      composite: makeCanvas(bounds.w, bounds.h),
      compositeCtx: null,
      selection: buildSelectionState(bounds.w, bounds.h),
    };
    next.compositeCtx = ctx2d(next.composite);
  } catch {
    app.toast?.('Could not update document');
    return 'failure';
  }

  try {
    if (!app.commitPreparedMutation(prepared)) return 'failure';
    applyDocState(app, next);
    app.history.push({
      label: 'Trim',
      undo: () => restoreDoc(app, before, selBefore),
      redo: () => restoreDoc(app, after),
    });
    return 'success';
  } catch {
    app.toast?.('Could not update document');
    return 'failure';
  }
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
  // A live active empty selection cannot affect pixels. Bail out before staging
  // or allocating snapshots; floating sessions use their staged selection.
  if (!app.floating && app.selection.active && !app.selection.bounds) return false;
  let prepared, layer, before, after, afterCtx, redo;
  try {
    prepared = app.stageMutation();
    if (!prepared) throw new Error('Could not stage pending edit');
    layer = app.doc.active;
    if (!layer || layer.locked) return;
    const { width: w, height: h } = layer.canvas;
    before = cloneCanvas(layer.canvas);
    if (prepared.floating?.session.layer === layer) {
      before = cloneCanvas(prepared.floating.canvas);
    }
    const selMask = prepared.floating?.selection ?? app.selection.snapshot();
    const selState = buildSelectionState(w, h, selMask);
    // An active empty selection transforms no pixels and creates no history.
    if (selState.mask && !selState.bounds) return false;
    const region = selState.mask ? selState.bounds : { x: 0, y: 0, w, h };
    const selectionCanvas = selState.mask ? selectionCanvasFromMask(w, h, selState.mask) : null;
    const src = makeCanvas(region.w, region.h);
    const sg = ctx2d(src);
    sg.drawImage(before, -region.x, -region.y);
    if (selectionCanvas) {
      sg.globalCompositeOperation = 'destination-in';
      sg.drawImage(selectionCanvas, -region.x, -region.y);
    }

    // Recompose from the immutable original. With a soft mask the selected and
    // unselected premultiplied fractions are additive; source-over would apply
    // coverage twice and attenuate an identity transform (50% became 75% alpha).
    after = selectionCanvas ? cloneCanvas(before) : makeCanvas(w, h);
    const g = ctx2d(after, { willReadFrequently: true });
    afterCtx = g;
    g.save();
    if (selectionCanvas) {
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(selectionCanvas, 0, 0);
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
    redo = cloneCanvas(after);
  } catch {
    app.toast?.('Could not transform layer');
    return false;
  }
  if (!app.commitPreparedMutation(prepared)) return false;
  return commitDetachedLayerState(
    app, layer, { canvas: after, ctx: afterCtx }, before, redo, 'Transform Layer',
  );
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

function selectionCanvasFromMask(w, h, mask) {
  const canvas = makeCanvas(w, h);
  const g = ctx2d(canvas);
  const image = g.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 255;
    image.data[i * 4 + 3] = mask[i];
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

function stageLayerCanvasMutation(app, draw) {
  // Avoid even staging/allocating when the live selection is explicitly empty.
  // A floating staged selection is handled below because it may differ.
  if (!app.floating && app.selection.active && !app.selection.bounds) return null;
  const prepared = app.stageMutation();
  if (!prepared) throw new Error('Could not stage pending edit');
  const layer = app.doc.active;
  if (!layer || layer.locked) return null;
  let before = cloneCanvas(layer.canvas);
  if (prepared.floating?.session.layer === layer) {
    before = cloneCanvas(prepared.floating.canvas);
  }
  const after = cloneCanvas(before);
  const afterCtx = ctx2d(after, { willReadFrequently: true });
  const selection = prepared.floating?.selection ?? app.selection.snapshot();
  // Avoid replacing canvases and publishing a no-op history entry for an
  // active empty selection.
  if (selection && !selection.some((coverage) => coverage !== 0)) return null;
  const selectionCanvas = selection
    ? selectionCanvasFromMask(app.doc.width, app.doc.height, selection)
    : null;
  draw(afterCtx, selectionCanvas);
  // Keep both history snapshots independent from the canvases used to stage
  // or commit. All allocations and draws therefore finish before live pixels.
  const undo = cloneCanvas(before);
  const redo = cloneCanvas(after);
  return { prepared, layer, state: { canvas: after, ctx: afterCtx }, undo, redo };
}

function restoreLayerCanvas(app, layer, snapshot) {
  const canvas = cloneCanvas(snapshot);
  const ctx = ctx2d(canvas, { willReadFrequently: true });
  layer.canvas = canvas;
  layer.ctx = ctx;
  app.doc.touch();
  bus.emit('layers');
  return true;
}

function commitDetachedLayerState(app, layer, state, undo, redo, label) {
  layer.canvas = state.canvas;
  layer.ctx = state.ctx;
  app.doc.touch();
  bus.emit('layers');
  app.history.push({
    label,
    undo: () => restoreLayerCanvas(app, layer, undo),
    redo: () => restoreLayerCanvas(app, layer, redo),
  });
  return true;
}

function runLayerCanvasMutation(app, label, draw) {
  let staged;
  try {
    staged = stageLayerCanvasMutation(app, draw);
  } catch {
    app.toast?.(`Could not ${label.toLowerCase()} selection`);
    return false;
  }
  if (!staged) return false;
  if (!app.commitPreparedMutation(staged.prepared)) return false;
  return commitDetachedLayerState(
    app, staged.layer, staged.state, staged.undo, staged.redo, label,
  );
}

export function clearSelection(app) {
  return runLayerCanvasMutation(app, 'Clear', (g, selectionCanvas) => {
    if (selectionCanvas) {
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(selectionCanvas, 0, 0);
    } else {
      g.clearRect(0, 0, app.doc.width, app.doc.height);
    }
  });
}

export function fillSelection(app, color) {
  return runLayerCanvasMutation(app, 'Fill', (g, selectionCanvas) => {
    if (selectionCanvas) {
      const tmp = makeCanvas(app.doc.width, app.doc.height);
      const tg = ctx2d(tmp);
      tg.fillStyle = color;
      tg.fillRect(0, 0, tmp.width, tmp.height);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(selectionCanvas, 0, 0);
      g.drawImage(tmp, 0, 0);
    } else {
      g.fillStyle = color;
      g.fillRect(0, 0, app.doc.width, app.doc.height);
    }
  });
}
