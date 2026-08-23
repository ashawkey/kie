// Tool rail + contextual options bar + history panel.
import { bus } from '../core/bus.js';
import { el } from '../core/util.js';
import { icon } from './icons.js';
import { shortcutFor } from '../tools/index.js';
import { t } from '../core/i18n.js';

/** Visual grouping in the vertical rail; each array is separated by a divider. */
export const TOOL_LAYOUT = [
  ['move', 'select-rect', 'select-ellipse', 'select-lasso', 'wand', 'crop'],
  ['pencil', 'brush', 'eraser', 'bucket', 'gradient'],
  ['rect', 'ellipse', 'line'],
  ['eyedropper', 'hand', 'zoom'],
];

export function buildToolRail(app, root) {
  let buttons = new Map();

  function render() {
    buttons = new Map();
    root.innerHTML = '';
    TOOL_LAYOUT.forEach((group, gi) => {
      if (gi > 0) root.appendChild(el('div', { class: 'gdivider h', style: { width: '80%' } }));
      for (const id of group) {
        const T = app.tools.registry.get(id);
        if (!T) continue;
        const sc = shortcutFor(id);
        // Reuse the tool's own status hint as its hover help, so the two
        // descriptions can never disagree.
        const hint = app.tools.get(id).statusHint?.() || '';
        const b = el('button', {
          class: 'gbtn',
          'data-tip': t(T.label),
          'data-tip-desc': t(hint),
          'data-tip-key': sc,
          'aria-label': t(T.label),
          onclick: () => app.tools.select(id),
        }, [icon(T.icon || 'pencil')]);
        buttons.set(id, b);
        root.appendChild(b);
      }
    });
    sync();
  }

  function sync() {
    for (const [id, b] of buttons) b.classList.toggle('active', app.tools.activeId === id);
  }

  bus.on('tool', sync);
  bus.on('locale', render);
  render();
}

export function buildOptionsBar(app, root) {
  function render() {
    const T = app.tools.registry.get(app.tools.activeId);
    root.innerHTML = '';
    if (!T) return;
    const sc = shortcutFor(T.id);
    root.appendChild(el('div', { class: 'tool-name' }, [
      icon(T.icon || 'pencil'),
      el('span', { text: t(T.label) }),
      sc ? el('span', { class: 'gchip', text: sc }) : null,
    ]));
    const opts = T.options || [];
    if (opts.length) root.appendChild(el('div', { class: 'gdivider' }));

    const store = app.toolOptions[T.id];
    for (const o of opts) root.appendChild(buildOption(app, store, o));

    // trailing global toggles
    root.appendChild(el('div', { class: 'spacer' }));
    root.appendChild(toggle(t('Pixel grid'), app.options.grid, (v) => {
      app.options.grid = v;
      bus.emit('view');
    }));
  }

  bus.on('tool', render);
  bus.on('locale', render);
  render();
}

function toggle(label, value, onChange) {
  const cb = el('input', { type: 'checkbox', checked: value, onchange: () => onChange(cb.checked) });
  return el('label', { class: 'opt gtoggle' }, [cb, el('span', { class: 'track' }), el('span', { class: 'glabel', text: label })]);
}

function buildOption(app, store, o) {
  const commit = (v) => {
    store[o.key] = v;
    bus.emit('tool-option', o.key, v);
  };

  if (o.type === 'toggle') {
    const cb = el('input', { type: 'checkbox', checked: !!store[o.key], onchange: () => commit(cb.checked) });
    return el('label', { class: 'opt gtoggle' }, [cb, el('span', { class: 'track' }), el('span', { class: 'glabel', text: t(o.label) })]);
  }

  if (o.type === 'select') {
    const s = el('select', { class: 'gselect', onchange: () => commit(s.value) },
      o.choices.map(([v, label]) => el('option', { value: v, text: t(label), selected: store[o.key] === v })));
    return el('div', { class: 'opt' }, [el('span', { class: 'glabel', text: t(o.label) }), s]);
  }

  if (o.type === 'number') {
    const input = el('input', {
      class: 'ginput num', type: 'number', value: store[o.key],
      min: o.min, max: o.max, step: o.step ?? 1,
      oninput: () => {
        let v = parseFloat(input.value);
        if (Number.isNaN(v)) return;
        v = Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
        commit(v);
      },
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    // keep brush size in sync with [ / ] shortcuts
    bus.on('tool-option', (k, v) => { if (k === o.key && document.activeElement !== input) input.value = v; });
    return el('div', { class: 'opt' }, [el('span', { class: 'glabel', text: t(o.label) }), input]);
  }

  // range
  const out = el('span', { class: 'val', text: `${store[o.key]}${o.suffix || ''}` });
  const input = el('input', {
    class: 'grange', type: 'range', value: store[o.key],
    min: o.min ?? 0, max: o.max ?? 100, step: o.step ?? 1,
    oninput: () => {
      const v = parseFloat(input.value);
      out.textContent = `${v}${o.suffix || ''}`;
      input.style.setProperty('--fill', `${((v - (o.min ?? 0)) / ((o.max ?? 100) - (o.min ?? 0))) * 100}%`);
      commit(v);
    },
  });
  input.style.setProperty('--fill', `${((store[o.key] - (o.min ?? 0)) / ((o.max ?? 100) - (o.min ?? 0))) * 100}%`);
  return el('div', { class: 'opt' }, [el('span', { class: 'glabel', text: t(o.label) }), input, out]);
}

export function buildHistoryPanel(app) {
  const list = el('div', { class: 'history-list gscroll' });

  function render() {
    const h = app.history;
    list.innerHTML = '';
    const mk = (label, cls, onclick) =>
      el('button', { class: `history-item ${cls}`, onclick }, [el('span', { class: 'dot' }), el('span', { text: label })]);

    const prepareNavigation = () => app.settleHistoryNavigation();

    list.appendChild(mk(t('Document opened'), h.past.length ? '' : 'current', () => {
      if (prepareNavigation()) return;
      while (h.canUndo()) h.undo();
    }));

    h.past.forEach((e, i) => {
      const isLast = i === h.past.length - 1;
      list.appendChild(mk(t(e.label), isLast ? 'current' : '', () => {
        if (prepareNavigation()) return;
        while (h.past.length > i + 1) h.undo();
        while (h.past.length < i + 1 && h.canRedo()) h.redo();
      }));
    });

    [...h.future].reverse().forEach((e, i) => {
      list.appendChild(mk(t(e.label), 'future', () => {
        if (prepareNavigation()) return;
        const steps = i + 1;
        for (let k = 0; k < steps && h.canRedo(); k++) h.redo();
      }));
    });

    list.scrollTop = list.scrollHeight;
  }

  bus.on('history', render);
  bus.on('locale', render);
  render();
  return list;
}
