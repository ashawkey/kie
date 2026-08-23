// Document model: fixed-size stack of RGBA layer canvases.
import { makeCanvas, ctx2d, cloneCanvas } from './util.js';
import { bus } from './bus.js';

let uid = 1;

export class Layer {
  constructor(w, h, name = 'Layer') {
    this.id = uid++;
    this.name = name;
    this.canvas = makeCanvas(w, h);
    this.ctx = ctx2d(this.canvas, { willReadFrequently: true });
    this.visible = true;
    this.opacity = 1;
    this.blend = 'source-over';
    this.locked = false;
  }

  clone(name = this.name + ' copy') {
    const l = new Layer(this.canvas.width, this.canvas.height, name);
    l.ctx.drawImage(this.canvas, 0, 0);
    l.visible = this.visible;
    l.opacity = this.opacity;
    l.blend = this.blend;
    return l;
  }

  resize(w, h, dx = 0, dy = 0) {
    const old = this.canvas;
    this.canvas = makeCanvas(w, h);
    this.ctx = ctx2d(this.canvas, { willReadFrequently: true });
    this.ctx.drawImage(old, dx, dy);
  }
}

export class Doc {
  constructor(w = 64, h = 64) {
    this.width = w;
    this.height = h;
    this.layers = [];
    this.activeId = null;
    this.composite = makeCanvas(w, h);
    this.compositeCtx = ctx2d(this.composite);
    this.dirty = true;
  }

  static blank(w, h, fill = null) {
    const d = new Doc(w, h);
    const l = new Layer(w, h, 'Background');
    if (fill) {
      l.ctx.fillStyle = fill;
      l.ctx.fillRect(0, 0, w, h);
    }
    d.layers.push(l);
    d.activeId = l.id;
    return d;
  }

  get active() {
    return this.layers.find((l) => l.id === this.activeId) || null;
  }

  get activeIndex() {
    return this.layers.findIndex((l) => l.id === this.activeId);
  }

  setActive(id) {
    if (this.activeId === id) return;
    this.activeId = id;
    bus.emit('doc');
  }

  addLayer(layer, index = this.activeIndex + 1) {
    this.layers.splice(index < 0 ? this.layers.length : index, 0, layer);
    this.activeId = layer.id;
    this.touch();
    bus.emit('doc');
    return layer;
  }

  removeLayer(id) {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0 || this.layers.length <= 1) return null;
    const [l] = this.layers.splice(i, 1);
    if (this.activeId === id) this.activeId = this.layers[Math.min(i, this.layers.length - 1)].id;
    this.touch();
    bus.emit('doc');
    return { layer: l, index: i };
  }

  moveLayer(id, delta) {
    const i = this.layers.findIndex((l) => l.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.layers.length) return false;
    const [l] = this.layers.splice(i, 1);
    this.layers.splice(j, 0, l);
    this.touch();
    bus.emit('doc');
    return true;
  }

  resize(w, h, dx = 0, dy = 0) {
    this.width = w;
    this.height = h;
    for (const l of this.layers) l.resize(w, h, dx, dy);
    this.composite = makeCanvas(w, h);
    this.compositeCtx = ctx2d(this.composite);
    this.touch();
    bus.emit('doc');
  }

  touch() {
    this.dirty = true;
  }

  /** Rebuilds the cached composite if needed and returns it. */
  flatten() {
    if (!this.dirty) return this.composite;
    const c = this.compositeCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    for (const l of this.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      c.globalAlpha = l.opacity;
      c.globalCompositeOperation = l.blend;
      c.drawImage(l.canvas, 0, 0);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    this.dirty = false;
    return this.composite;
  }

  flattenCopy() {
    return cloneCanvas(this.flatten());
  }
}
