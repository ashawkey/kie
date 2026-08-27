// Navigator: always-visible downsampled view of the whole document with a
// draggable rectangle showing (and controlling) the current viewport.
import { bus } from '../core/bus.js';
import { $, ctx2d, clamp } from '../core/util.js';

const MAX = 148; // longest edge of the preview, in CSS pixels

export function installNavigator(app) {
  const root = $('#navigator');
  const toggle = $('#nav-toggle');
  const viewEl = $('#nav-view');
  const canvas = $('#nav-canvas');
  const rectEl = $('#nav-rect');
  const g = ctx2d(canvas);

  let box = { w: MAX, h: MAX }; // preview size in CSS px

  const collapsed = localStorage.getItem('kie.nav.collapsed') === '1';
  root.classList.toggle('collapsed', collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));

  toggle.addEventListener('click', () => {
    const next = !root.classList.contains('collapsed');
    root.classList.toggle('collapsed', next);
    toggle.setAttribute('aria-expanded', String(!next));
    localStorage.setItem('kie.nav.collapsed', next ? '1' : '0');
    if (!next) draw();
  });

  /** Fit the preview box to the document's aspect ratio. */
  function layout() {
    const { width: dw, height: dh } = app.doc;
    const s = Math.min(MAX / dw, MAX / dh);
    box = { w: Math.max(24, Math.round(dw * s)), h: Math.max(24, Math.round(dh * s)) };
    viewEl.style.width = `${box.w}px`;
    viewEl.style.height = `${box.h}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    canvas.style.width = `${box.w}px`;
    canvas.style.height = `${box.h}px`;
  }

  function draw() {
    if (root.classList.contains('collapsed')) return;
    const { width: dw, height: dh } = app.doc;
    if (canvas.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, box.w, box.h);
    g.imageSmoothingEnabled = box.w < dw; // smooth only when downscaling
    g.drawImage(app.renderer.documentComposite(), 0, 0, box.w, box.h);
    drawRect();
  }

  /** Position the viewport indicator over the preview. */
  function drawRect() {
    const { view, doc } = app;
    const sx = box.w / doc.width;
    const sy = box.h / doc.height;
    const vw = view.vw / view.scale;
    const vh = view.vh / view.scale;
    const x = (view.x - vw / 2) * sx;
    const y = (view.y - vh / 2) * sy;
    const w = vw * sx;
    const h = vh * sy;
    // Clamp to the preview so the outline stays readable when zoomed out.
    const left = clamp(x, 0, box.w);
    const top = clamp(y, 0, box.h);
    const right = clamp(x + w, 0, box.w);
    const bottom = clamp(y + h, 0, box.h);
    const covers = w >= box.w && h >= box.h;
    rectEl.style.display = covers ? 'none' : 'block';
    rectEl.style.left = `${left}px`;
    rectEl.style.top = `${top}px`;
    rectEl.style.width = `${Math.max(2, right - left)}px`;
    rectEl.style.height = `${Math.max(2, bottom - top)}px`;
  }

  /* ---- click / drag to navigate ---- */
  const centerOn = (e) => {
    const r = viewEl.getBoundingClientRect();
    const px = clamp((e.clientX - r.left) / r.width, 0, 1);
    const py = clamp((e.clientY - r.top) / r.height, 0, 1);
    app.view.x = px * app.doc.width;
    app.view.y = py * app.doc.height;
    bus.emit('view');
  };

  viewEl.addEventListener('pointerdown', (e) => {
    centerOn(e);
    viewEl.classList.add('dragging');
    try { viewEl.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
    const move = (ev) => centerOn(ev);
    const up = () => {
      viewEl.classList.remove('dragging');
      viewEl.removeEventListener('pointermove', move);
      viewEl.removeEventListener('pointerup', up);
    };
    viewEl.addEventListener('pointermove', move);
    viewEl.addEventListener('pointerup', up);
  });

  viewEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    app.view.wheelZoom(e);
  }, { passive: false });

  /* ---- keep in sync ---- */
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); });
  };

  bus.on('doc', () => { layout(); draw(); });
  bus.on('layers', schedule);
  bus.on('view', drawRect);

  layout();
  draw();
  return { draw, layout };
}
