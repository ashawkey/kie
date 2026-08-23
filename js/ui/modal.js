// Glass modal dialogs + toasts.
import { el, $ } from '../core/util.js';
import { t } from '../core/i18n.js';

let layer;
let activeModal = null;

function ensureLayer() {
  if (!layer) layer = $('#modal-layer');
  return layer;
}

/**
 * Show a dialog. `fields` is a list of descriptors; resolves with the values
 * object on confirm, or null on cancel. Opening one cancels the active dialog.
 */
export function dialog({ title, subtitle, fields = [], confirm, cancel, body, onChange, size }) {
  confirm = confirm ?? t('OK');
  cancel = cancel === null ? null : (cancel ?? t('Cancel'));
  activeModal?.close(null);

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

    let closed = false;
    let focusTimer = null;
    const record = { close };
    const api = { values, inputs, modal, close };

    function close(result) {
      if (closed) return;
      closed = true;
      if (focusTimer !== null) clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey, true);
      root.removeEventListener('mousedown', onBackdrop);
      if (activeModal === record) {
        activeModal = null;
        root.classList.remove('open');
        root.innerHTML = '';
      }
      resolve(result);
    }

    function onKey(e) {
      if (activeModal !== record) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.stopPropagation();
        e.preventDefault();
        close({ ...values });
      }
    }

    function onBackdrop(e) {
      if (activeModal === record && e.target === root) close(null);
    }

    activeModal = record;
    root.innerHTML = '';
    root.appendChild(modal);
    root.classList.add('open');

    okBtn.addEventListener('click', () => close({ ...values }));
    cancelBtn?.addEventListener('click', () => close(null));
    root.addEventListener('mousedown', onBackdrop);
    document.addEventListener('keydown', onKey, true);

    focusTimer = setTimeout(() => {
      if (activeModal !== record) return;
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
