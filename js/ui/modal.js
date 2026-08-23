// Glass modal dialogs + toasts.
import { el, $ } from '../core/util.js';
import { t } from '../core/i18n.js';

let layer;

function ensureLayer() {
  if (!layer) layer = $('#modal-layer');
  return layer;
}

/**
 * Show a dialog. `fields` is a list of descriptors; resolves with the values
 * object on confirm, or null on cancel.
 */
export function dialog({ title, subtitle, fields = [], confirm, cancel, body, onChange, size }) {
  confirm = confirm ?? t('OK');
  cancel = cancel === null ? null : (cancel ?? t('Cancel'));
  return new Promise((resolve) => {
    const root = ensureLayer();
    const values = {};
    const inputs = {};
    const fieldNodes = [];

    for (const f of fields) {
      values[f.key] = f.default;
      const node = buildField(f, values, () => onChange?.(values, api));
      inputs[f.key] = node.input;
      fieldNodes.push(node.row);
    }

    const bodyEl = el('div', { class: 'modal-body' }, [
      ...(body ? [body] : []),
      ...fieldNodes,
    ]);

    const okBtn = el('button', { class: 'gbtn primary', text: confirm });
    const cancelBtn = cancel ? el('button', { class: 'gbtn', text: cancel }) : null;

    const modal = el('div', { class: `modal glass glass-dark${size ? ` modal-${size}` : ''}` }, [
      el('h2', { text: title }),
      subtitle ? el('div', { class: 'sub', text: subtitle }) : null,
      bodyEl,
      el('div', { class: 'modal-actions' }, [cancelBtn, okBtn].filter(Boolean)),
    ]);

    const api = { values, inputs, modal, close: (v) => close(v) };

    root.innerHTML = '';
    root.appendChild(modal);
    root.classList.add('open');

    function close(result) {
      root.classList.remove('open');
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); close({ ...values }); }
    }

    okBtn.addEventListener('click', () => close({ ...values }));
    cancelBtn?.addEventListener('click', () => close(null));
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(null); });
    document.addEventListener('keydown', onKey, true);

    setTimeout(() => {
      const first = modal.querySelector('input:not([type=range]), select');
      (first || okBtn).focus();
      if (first?.select) first.select();
    }, 30);

    onChange?.(values, api);
  });
}

function buildField(f, values, notify) {
  let input;
  const setVal = (v) => { values[f.key] = v; notify(); };

  if (f.type === 'number') {
    input = el('input', {
      class: 'ginput', type: 'number', value: f.default,
      min: f.min ?? null, max: f.max ?? null, step: f.step ?? 1,
      oninput: () => setVal(clampNum(parseFloat(input.value), f)),
    });
  } else if (f.type === 'text') {
    input = el('input', { class: 'ginput', type: 'text', value: f.default ?? '', oninput: () => setVal(input.value) });
  } else if (f.type === 'select') {
    input = el('select', { class: 'gselect', onchange: () => setVal(input.value) },
      f.choices.map(([v, label]) => el('option', { value: v, text: label, selected: v === f.default })));
  } else if (f.type === 'toggle') {
    const cb = el('input', { type: 'checkbox', checked: !!f.default, onchange: () => setVal(cb.checked) });
    input = cb;
    return {
      input: cb,
      row: el('div', { class: 'field' }, [
        el('span', { class: 'glabel', text: f.label }),
        el('label', { class: 'gtoggle' }, [cb, el('span', { class: 'track' })]),
      ]),
    };
  } else if (f.type === 'range') {
    const out = el('span', { class: 'val', text: fmt(f.default, f) });
    input = el('input', {
      class: 'grange', type: 'range', value: f.default,
      min: f.min ?? 0, max: f.max ?? 100, step: f.step ?? 1,
      oninput: () => {
        const v = parseFloat(input.value);
        out.textContent = fmt(v, f);
        input.style.setProperty('--fill', `${((v - (f.min ?? 0)) / ((f.max ?? 100) - (f.min ?? 0))) * 100}%`);
        setVal(v);
      },
    });
    input.style.setProperty('--fill', `${((f.default - (f.min ?? 0)) / ((f.max ?? 100) - (f.min ?? 0))) * 100}%`);
    return {
      input,
      row: el('div', { class: 'field' }, [el('span', { class: 'glabel', text: f.label }), input, out]),
    };
  } else {
    input = el('input', { class: 'ginput', value: f.default ?? '', oninput: () => setVal(input.value) });
  }

  return {
    input,
    row: el('div', { class: 'field' }, [el('span', { class: 'glabel', text: f.label }), input]),
  };
}

const fmt = (v, f) => `${Math.round(v * 10) / 10}${f.suffix || ''}`;
const clampNum = (v, f) => {
  if (Number.isNaN(v)) return f.default;
  if (f.min != null) v = Math.max(f.min, v);
  if (f.max != null) v = Math.min(f.max, v);
  return v;
};

export function confirmDialog(title, subtitle, confirm) {
  return dialog({ title, subtitle, fields: [], confirm: confirm ?? t('Confirm') })
    .then((r) => r !== null);
}

/* ---------- toasts ---------- */

let toastRoot;

export function toast(message, ms = 2200) {
  if (!toastRoot) toastRoot = $('#toasts');
  const t = el('div', { class: 'toast glass', text: message });
  toastRoot.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 320);
  }, ms);
}
