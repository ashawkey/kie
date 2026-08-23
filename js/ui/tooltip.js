// Hover help.
//
// A single floating element positioned in viewport coordinates, so tooltips are
// never clipped by scrolling ancestors (the tool rail and dock both scroll) and
// can be richer than a CSS pseudo-element: title, one-line help text, and a
// shortcut chip.
//
// Markup contract, read from the closest ancestor carrying `data-tip`:
//   data-tip       title (required)
//   data-tip-desc  short help sentence
//   data-tip-key   shortcut to render as a chip
//   data-tip-side  preferred side: right (default) | below | left | above
import { el } from '../core/util.js';
import { bus } from '../core/bus.js';

const DELAY = 380;      // matches the previous CSS delay
const REPEAT_DELAY = 90; // moving between neighbours feels instant
const GAP = 10;
const MARGIN = 8;

let root, titleEl, descEl, keyEl;
let timer = 0;
let current = null;
let lastHidden = 0;

function build() {
  titleEl = el('div', { class: 'tip-title' });
  descEl = el('div', { class: 'tip-desc' });
  keyEl = el('kbd', { class: 'tip-key' });
  root = el('div', { class: 'tooltip', role: 'tooltip', 'aria-hidden': 'true' }, [
    el('div', { class: 'tip-head' }, [titleEl, keyEl]),
    descEl,
  ]);
  document.body.appendChild(root);
}

function place(target, side) {
  const r = target.getBoundingClientRect();
  const w = root.offsetWidth;
  const h = root.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const fits = {
    right: r.right + GAP + w <= vw - MARGIN,
    left: r.left - GAP - w >= MARGIN,
    below: r.bottom + GAP + h <= vh - MARGIN,
    above: r.top - GAP - h >= MARGIN,
  };
  // Fall back through the other sides when the preferred one overflows.
  const order = { right: ['right', 'left', 'below', 'above'],
    left: ['left', 'right', 'below', 'above'],
    below: ['below', 'above', 'right', 'left'],
    above: ['above', 'below', 'right', 'left'] }[side] || ['right', 'left', 'below', 'above'];
  const chosen = order.find((s) => fits[s]) || side;

  let x, y;
  if (chosen === 'right' || chosen === 'left') {
    x = chosen === 'right' ? r.right + GAP : r.left - GAP - w;
    y = r.top + r.height / 2 - h / 2;
  } else {
    x = r.left + r.width / 2 - w / 2;
    y = chosen === 'below' ? r.bottom + GAP : r.top - GAP - h;
  }
  root.dataset.side = chosen;
  root.style.left = `${Math.round(Math.min(Math.max(MARGIN, x), vw - w - MARGIN))}px`;
  root.style.top = `${Math.round(Math.min(Math.max(MARGIN, y), vh - h - MARGIN))}px`;
}

function show(target) {
  const title = target.dataset.tip;
  if (!title) return;
  current = target;
  titleEl.textContent = title;
  const desc = target.dataset.tipDesc || '';
  descEl.textContent = desc;
  descEl.style.display = desc ? '' : 'none';
  const key = target.dataset.tipKey || '';
  keyEl.textContent = key;
  keyEl.style.display = key ? '' : 'none';

  root.classList.add('visible');
  root.setAttribute('aria-hidden', 'false');
  place(target, target.dataset.tipSide || 'right');
}

function hide() {
  clearTimeout(timer);
  timer = 0;
  if (!current) return;
  current = null;
  lastHidden = performance.now();
  root.classList.remove('visible');
  root.setAttribute('aria-hidden', 'true');
}

function schedule(target) {
  clearTimeout(timer);
  // Keep tooltips snappy while sweeping across a toolbar.
  const wait = performance.now() - lastHidden < 500 ? REPEAT_DELAY : DELAY;
  timer = setTimeout(() => show(target), wait);
}

export function installTooltips() {
  if (!root) build();

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const target = e.target.closest?.('[data-tip]');
    if (!target || target === current) return;
    if (target.hasAttribute('disabled')) { hide(); return; }
    hide();
    schedule(target);
  });

  document.addEventListener('pointerout', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (!target) return;
    if (e.relatedTarget?.closest?.('[data-tip]') === target) return;
    hide();
  });

  // Any interaction or layout change dismisses it.
  document.addEventListener('pointerdown', hide, true);
  window.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  bus.on('locale', hide);
}
