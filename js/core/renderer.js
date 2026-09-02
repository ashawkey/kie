// Canvas renderer: checkerboard, composite, pixel grid, selection ants, tool overlay.
import { bus } from './bus.js';
import { ctx2d, makeCanvas } from './util.js';
import { drawSessionLayer } from '../tools/transform.js';

// 16x16 tile of the 8px transparency checkerboard, anchored at the screen
// origin. A pattern fill replaces a per-cell fillRect loop whose cost scaled
// with the document's on-screen size (millions of offscreen cells at high
// zoom on tall documents).
function makeCheckerTile() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#20242d';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#2a2f3a';
  g.fillRect(8, 0, 8, 8);
  g.fillRect(0, 8, 8, 8);
  return c;
}

export class Renderer {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = ctx2d(canvas, { alpha: false });
    this.checker = this.ctx.createPattern(makeCheckerTile(), 'repeat');
    this.needs = true;
    this.previewDirty = true;
    this.previewCanvas = null;
    this.previewLayerCanvas = null;
    this.previewLayerCtx = null;
    this.previewCtx = null;
    this.antsOffset = 0;
    this._loop = this._loop.bind(this);
    for (const ev of ['doc', 'layers', 'selection', 'view', 'tool', 'color', 'overlay']) {
      bus.on(ev, () => this.invalidate());
    }
    requestAnimationFrame(this._loop);
  }

  invalidate() {
    this.needs = true;
    this.previewDirty = true;
  }

  /**
   * Return the document composite including an active floating transform.
   * The target's cut canvas and floating pixels are first rebuilt as one layer,
   * so that layer opacity/blend is applied once at its real stack position.
   * Reusable canvases avoid full-document allocation during pointer moves.
   */
  documentComposite() {
    const { doc, floating } = this.app;
    if (!floating) return doc.flatten();
    if (!doc.layers.includes(floating.layer)) return doc.flatten();

    if (!this.previewCanvas || this.previewCanvas.width !== doc.width ||
        this.previewCanvas.height !== doc.height) {
      this.previewCanvas = makeCanvas(doc.width, doc.height);
      this.previewCtx = ctx2d(this.previewCanvas);
    }
    if (!this.previewLayerCanvas || this.previewLayerCanvas.width !== doc.width ||
        this.previewLayerCanvas.height !== doc.height) {
      this.previewLayerCanvas = makeCanvas(doc.width, doc.height);
      this.previewLayerCtx = ctx2d(this.previewLayerCanvas);
    }
    if (!this.previewDirty) return this.previewCanvas;

    const layerCtx = this.previewLayerCtx;
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.globalAlpha = 1;
    layerCtx.globalCompositeOperation = 'source-over';
    layerCtx.clearRect(0, 0, doc.width, doc.height);
    drawSessionLayer(floating, layerCtx);

    const compositeCtx = this.previewCtx;
    compositeCtx.setTransform(1, 0, 0, 1, 0, 0);
    compositeCtx.globalAlpha = 1;
    compositeCtx.globalCompositeOperation = 'source-over';
    compositeCtx.clearRect(0, 0, doc.width, doc.height);
    for (const layer of doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      compositeCtx.globalAlpha = layer.opacity;
      compositeCtx.globalCompositeOperation = layer.blend;
      compositeCtx.drawImage(
        layer === floating.layer ? this.previewLayerCanvas : layer.canvas, 0, 0,
      );
    }
    compositeCtx.globalAlpha = 1;
    compositeCtx.globalCompositeOperation = 'source-over';
    this.previewDirty = false;
    return this.previewCanvas;
  }

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
    if (sel.active && sel.bounds && !this.app.options.hideSelection) {
      const o = Math.floor(t / 90) % 8;
      if (o !== this.antsOffset) { this.antsOffset = o; this.needs = true; }
    } else {
      // Keep the phase sentinel in sync without repainting. Otherwise an ants
      // phase change queued just before an empty/deselect event can cause one
      // delayed redraw after that transition has already been painted.
      this.antsOffset = Math.floor(t / 90) % 8;
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
    // Visible part of the document in screen space. Everything below is
    // clipped to this so per-frame cost depends on the viewport, not on the
    // document size: a 10k-px-tall document at 12x zoom would otherwise loop
    // over millions of offscreen checkerboard cells and ~11k grid lines.
    const ix0 = Math.max(0, tl.x), iy0 = Math.max(0, tl.y);
    const ix1 = Math.min(view.vw, tl.x + w), iy1 = Math.min(view.vh, tl.y + h);
    const visible = ix1 > ix0 && iy1 > iy0;

    if (visible) {
      // canvas shadow (clipping the rect to the viewport is identical: the
      // blur only shows in a band around the rect's edges, which is unchanged)
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.55)';
      g.shadowBlur = 28;
      g.shadowOffsetY = 8;
      g.fillStyle = '#000';
      g.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
      g.restore();

      // transparency checkerboard: one pattern fill for any document size
      g.fillStyle = this.checker;
      g.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
    }

    // image (the live transform composite is already clipped to document size)
    const composite = this.documentComposite();
    g.save();
    if (view.scale < 1) g.imageSmoothingEnabled = true;
    g.drawImage(composite, tl.x, tl.y, w, h);
    g.restore();

    // pixel grid: only lines whose position falls inside the viewport, each
    // trimmed to the visible band
    if (app.options.grid && view.scale >= 6 && visible) {
      g.save();
      g.beginPath();
      g.strokeStyle = 'rgba(255,255,255,0.09)';
      g.lineWidth = 1;
      // A 1px line at screen position u + 0.5 is visible exactly for
      // u >= -0.5 && u < viewport - 0.5, so use that range for the indices.
      const step = view.scale;
      const gx0 = Math.max(0, Math.ceil((-0.5 - tl.x) / step));
      const gx1 = Math.min(doc.width, Math.floor((view.vw - 0.5 - tl.x) / step));
      const gy0 = Math.max(0, Math.ceil((-0.5 - tl.y) / step));
      const gy1 = Math.min(doc.height, Math.floor((view.vh - 0.5 - tl.y) / step));
      for (let x = gx0; x <= gx1; x++) {
        const sx = Math.round(tl.x + x * step) + 0.5;
        g.moveTo(sx, iy0); g.lineTo(sx, iy1);
      }
      for (let y = gy0; y <= gy1; y++) {
        const sy = Math.round(tl.y + y * step) + 0.5;
        g.moveTo(ix0, sy); g.lineTo(ix1, sy);
      }
      g.stroke();
      g.restore();
    }

    // canvas border
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 1;
    g.strokeRect(tl.x - 0.5, tl.y - 0.5, w + 1, h + 1);

    // selection marching ants (View > Hide Selection Edges keeps the selection
    // active but stops drawing it, the way Ctrl+H does in Photoshop)
    if (app.selection.active && app.selection.bounds && !app.options.hideSelection) {
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
