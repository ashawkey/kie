// Color state + color panel UI (SV area, hue/alpha strips, hex, palettes).
import { bus } from '../core/bus.js';
import { el, clamp, rgbToHsv, hsvToRgb, rgbaToHex, rgbaCss, hexToRgba, rgbToHex } from '../core/util.js';
import { icon } from './icons.js';
import { t } from '../core/i18n.js';

export const PALETTES = {
  'PICO-8': ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
    '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'],
  'Sweetie 16': ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
    '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'],
  'Endesga 32': ['#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
    '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
    '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
    '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569'],
  'Grayscale': Array.from({ length: 16 }, (_, i) => {
    const v = Math.round((i / 15) * 255).toString(16).padStart(2, '0');
    return `#${v}${v}${v}`;
  }),
  'Game Boy': ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
};

export class ColorState {
  constructor() {
    this.primary = { r: 0, g: 0, b: 0, a: 255 };
    this.secondary = { r: 255, g: 255, b: 255, a: 255 };
    this.recent = [];
    this.hsv = { h: 0, s: 0, v: 0 };
  }

  setPrimary(c, { syncHsv = true } = {}) {
    this.primary = { a: 255, ...c };
    if (syncHsv) {
      const hsv = rgbToHsv(this.primary);
      // preserve hue when the color is achromatic
      this.hsv = { h: hsv.s > 0 ? hsv.h : this.hsv.h, s: hsv.s, v: hsv.v };
    }
    bus.emit('color');
  }

  setSecondary(c) {
    this.secondary = { a: 255, ...c };
    bus.emit('color');
  }

  swap() {
    const p = this.primary;
    this.primary = this.secondary;
    this.secondary = p;
    const hsv = rgbToHsv(this.primary);
    this.hsv = { h: hsv.s > 0 ? hsv.h : this.hsv.h, s: hsv.s, v: hsv.v };
    bus.emit('color');
  }

  reset() {
    this.primary = { r: 0, g: 0, b: 0, a: 255 };
    this.secondary = { r: 255, g: 255, b: 255, a: 255 };
    bus.emit('color');
  }

  remember(c) {
    const hex = rgbaToHex(c);
    this.recent = [c, ...this.recent.filter((x) => rgbaToHex(x) !== hex)].slice(0, 16);
  }
}

export function buildColorPanel(app) {
  const color = app.color;

  const svArea = el('div', { id: 'sv-area' }, [el('div', { class: 'thumb' })]);
  const hueStrip = el('div', { id: 'hue-strip', class: 'strip' }, [el('div', { class: 'thumb' })]);
  // gradients/solids live in a .fill layer so the checkerboard tiling below
  // does not resize them
  const alphaFill = el('div', { class: 'fill' });
  const alphaStrip = el('div', { id: 'alpha-strip', class: 'strip checker' }, [alphaFill, el('div', { class: 'thumb' })]);

  const primaryFill = el('div', { class: 'fill' });
  const secondaryFill = el('div', { class: 'fill' });
  const swPrimary = el('div', {
    class: 'sw primary checker',
    'data-tip': t('Primary color'),
    'data-tip-desc': t('Used by left-click. Press X to swap with the secondary color.'),
    'data-tip-side': 'left',
  }, [primaryFill]);
  const swSecondary = el('div', {
    class: 'sw secondary checker',
    'data-tip': t('Secondary color'),
    'data-tip-desc': t('Used by right-click. Click to swap it with the primary color.'),
    'data-tip-side': 'left',
  }, [secondaryFill]);
  const swapBtn = el('button', {
    class: 'gbtn swap',
    'data-tip': t('Swap colors'),
    'data-tip-key': 'X',
    'data-tip-side': 'left',
  }, [icon('swap')]);
  const swatches = el('div', { class: 'swatch-pair' }, [swSecondary, swPrimary, swapBtn]);

  const hexInput = el('input', { class: 'ginput', spellcheck: 'false', 'aria-label': t('Hex color') });
  const alphaLabel = el('span', { class: 'gchip', text: '100%' });

  const paletteSelect = el('select', { class: 'gselect' },
    Object.keys(PALETTES).map((k) => el('option', { value: k, text: t(k) })));
  const syncPaletteNames = () => {
    for (const opt of paletteSelect.options) opt.textContent = t(opt.value);
  };
  const paletteGrid = el('div', { class: 'palette' });
  const recentGrid = el('div', { class: 'palette' });

  const paletteLabel = el('span', { class: 'glabel', text: t('Palette') });
  const recentLabel = el('span', { class: 'glabel', text: t('Recent') });
  const root = el('div', {}, [
    el('div', { class: 'color-top' }, [swatches, el('div', { style: { flex: '1', minWidth: '0' } }, [svArea])]),
    hueStrip,
    alphaStrip,
    el('div', { class: 'color-fields' }, [hexInput, alphaLabel]),
    el('div', { class: 'palette-head' }, [paletteLabel, paletteSelect]),
    paletteGrid,
    el('div', { class: 'palette-head' }, [recentLabel]),
    recentGrid,
  ]);

  /* --- rendering --- */
  function render() {
    const { h, s, v } = color.hsv;
    const p = color.primary;
    svArea.style.background =
      `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))`;
    svArea.querySelector('.thumb').style.left = `${s * 100}%`;
    svArea.querySelector('.thumb').style.top = `${(1 - v) * 100}%`;
    svArea.querySelector('.thumb').style.background = rgbToHex(p);
    hueStrip.querySelector('.thumb').style.left = `${(h / 360) * 100}%`;
    hueStrip.querySelector('.thumb').style.background = `hsl(${h} 100% 50%)`;
    alphaFill.style.background =
      `linear-gradient(to right, rgba(${p.r},${p.g},${p.b},0), rgb(${p.r},${p.g},${p.b}))`;
    alphaStrip.querySelector('.thumb').style.left = `${(p.a / 255) * 100}%`;
    alphaStrip.querySelector('.thumb').style.background = rgbaCss(p);
    primaryFill.style.background = rgbaCss(p);
    secondaryFill.style.background = rgbaCss(color.secondary);
    if (document.activeElement !== hexInput) hexInput.value = rgbToHex(p).slice(1);
    alphaLabel.textContent = `${Math.round((p.a / 255) * 100)}%`;
    renderRecent();
  }

  function renderPalette() {
    const list = PALETTES[paletteSelect.value] || [];
    paletteGrid.innerHTML = '';
    for (const hex of list) {
      const b = el('button', { class: 'pc', style: { background: hex }, title: hex });
      b.addEventListener('click', (e) => {
        const c = hexToRgba(hex);
        if (e.shiftKey) color.setSecondary(c); else color.setPrimary(c);
      });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); color.setSecondary(hexToRgba(hex)); });
      paletteGrid.appendChild(b);
    }
  }

  function renderRecent() {
    recentGrid.innerHTML = '';
    for (const c of color.recent) {
      const b = el('button', { class: 'pc checker', title: rgbaToHex(c) },
        [el('div', { class: 'fill', style: { background: rgbaCss(c) } })]);
      b.addEventListener('click', () => color.setPrimary(c));
      recentGrid.appendChild(b);
    }
  }

  /* --- interaction --- */
  const drag = (node, onPos) => {
    const handle = (e) => {
      const r = node.getBoundingClientRect();
      onPos(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
    };
    node.addEventListener('pointerdown', (e) => {
      node.setPointerCapture(e.pointerId);
      handle(e);
      const move = (ev) => handle(ev);
      const up = () => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        color.remember(color.primary);
        bus.emit('color');
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
  };

  drag(svArea, (x, y) => {
    color.hsv.s = x;
    color.hsv.v = 1 - y;
    color.setPrimary({ ...hsvToRgb(color.hsv), a: color.primary.a }, { syncHsv: false });
  });
  drag(hueStrip, (x) => {
    color.hsv.h = x * 360;
    color.setPrimary({ ...hsvToRgb(color.hsv), a: color.primary.a }, { syncHsv: false });
  });
  drag(alphaStrip, (x) => {
    color.setPrimary({ ...color.primary, a: Math.round(x * 255) }, { syncHsv: false });
  });

  swapBtn.addEventListener('click', () => color.swap());
  swSecondary.addEventListener('click', () => color.swap());
  hexInput.addEventListener('change', () => {
    const c = hexToRgba(hexInput.value);
    if (c) color.setPrimary({ ...c, a: color.primary.a });
    else render();
  });
  hexInput.addEventListener('keydown', (e) => e.stopPropagation());
  paletteSelect.addEventListener('change', renderPalette);

  bus.on('color', render);
  bus.on('locale', () => {
    syncPaletteNames();
    paletteLabel.textContent = t('Palette');
    recentLabel.textContent = t('Recent');
    swPrimary.dataset.tip = t('Primary color');
    swPrimary.dataset.tipDesc = t('Used by left-click. Press X to swap with the secondary color.');
    swSecondary.dataset.tip = t('Secondary color');
    swSecondary.dataset.tipDesc = t('Used by right-click. Click to swap it with the primary color.');
    swapBtn.dataset.tip = t('Swap colors');
  });
  renderPalette();
  render();
  return root;
}
