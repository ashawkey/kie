// Canvas renderer: checkerboard, composite, pixel grid, selection ants, tool overlay.
import { bus } from './bus.js';
import { ctx2d } from './util.js';

export class Renderer {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = ctx2d(canvas, { alpha: false });
    this.needs = true;
    this.antsOffset = 0;
    this._loop = this._loop.bind(this);
    for (const ev of ['doc', 'layers', 'selection', 'view', 'tool', 'color', 'overlay']) {
      bus.on(ev, () => this.invalidate());
    }
    requestAnimationFrame(this._loop);
  }

  invalidate() { this.needs = true; }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.dpr = dpr;
    this.app.view.setViewport(r.width, r.height);
    this.invalidate();
  }

  _loop(t) {
    const sel = this.app.selection;
    if (sel.active) {
      const o = Math.floor(t / 90) % 8;
      if (o !== this.antsOffset) { this.antsOffset = o; this.needs = true; }
    }
    if (this.needs) { this.needs = false; this.draw(); }
    requestAnimationFrame(this._loop);
  }

  draw() {
    const { app } = this;
    const { doc, view } = app;
    const g = this.ctx;
    const dpr = this.dpr || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;

    // backdrop
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, view.vw, view.vh);

    const tl = view.toScreen(0, 0);
    const w = doc.width * view.scale;
    const h = doc.height * view.scale;

    // canvas shadow
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 28;
    g.shadowOffsetY = 8;
    g.fillStyle = '#000';
    g.fillRect(tl.x, tl.y, w, h);
    g.restore();

    // transparency checkerboard
    g.save();
    g.beginPath();
    g.rect(tl.x, tl.y, w, h);
    g.clip();
    const cell = 8;
    g.fillStyle = '#20242d';
    g.fillRect(tl.x, tl.y, w, h);
    g.fillStyle = '#2a2f3a';
    const cx0 = Math.floor(tl.x / cell), cy0 = Math.floor(tl.y / cell);
    const cx1 = Math.ceil((tl.x + w) / cell), cy1 = Math.ceil((tl.y + h) / cell);
    for (let y = cy0; y < cy1; y++) {
      for (let x = cx0; x < cx1; x++) {
        if ((x + y) & 1) g.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    g.restore();

    // image
    const composite = doc.flatten();
    g.save();
    if (view.scale < 1) g.imageSmoothingEnabled = true;
    g.drawImage(composite, tl.x, tl.y, w, h);
    g.restore();

    // floating (lifted) pixels from an active move/transform session
    if (app.floating) {
      g.save();
      g.beginPath();
      g.rect(tl.x, tl.y, w, h);
      g.clip();
      g.translate(tl.x, tl.y);
      g.scale(view.scale, view.scale);
      g.imageSmoothingEnabled = view.scale < 1;
      g.globalAlpha = app.doc.active?.opacity ?? 1;
      app.floating.drawInto(g);
      g.restore();
    }

    // pixel grid
    if (app.options.grid && view.scale >= 6) {
      g.save();
      g.beginPath();
      g.strokeStyle = 'rgba(255,255,255,0.09)';
      g.lineWidth = 1;
      const step = view.scale;
      for (let x = 0; x <= doc.width; x++) {
        const sx = Math.round(tl.x + x * step) + 0.5;
        g.moveTo(sx, tl.y); g.lineTo(sx, tl.y + h);
      }
      for (let y = 0; y <= doc.height; y++) {
        const sy = Math.round(tl.y + y * step) + 0.5;
        g.moveTo(tl.x, sy); g.lineTo(tl.x + w, sy);
      }
      g.stroke();
      g.restore();
    }

    // canvas border
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 1;
    g.strokeRect(tl.x - 0.5, tl.y - 0.5, w + 1, h + 1);

    // selection marching ants
    if (app.selection.active) {
      g.save();
      g.translate(tl.x, tl.y);
      g.scale(view.scale, view.scale);
      g.lineWidth = 1 / view.scale;
      const path = app.selection.outline();
      g.strokeStyle = '#000';
      g.setLineDash([4 / view.scale, 4 / view.scale]);
      g.lineDashOffset = -this.antsOffset / view.scale;
      g.stroke(path);
      g.strokeStyle = '#fff';
      g.lineDashOffset = (-this.antsOffset + 4) / view.scale;
      g.stroke(path);
      g.restore();
    }

    // active tool overlay (screen space)
    app.tools.active?.drawOverlay?.(g, view);
  }
}
