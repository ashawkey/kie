// Layers panel: list, thumbnails, visibility, opacity, blend, reorder by drag.
import { bus } from '../core/bus.js';
import { el, makeCanvas, ctx2d } from '../core/util.js';
import { icon } from './icons.js';
import { addLayer, duplicateLayer, deleteLayer, moveLayer, mergeDown, setLayerProp } from '../ops/image.js';
import { t } from '../core/i18n.js';

const BLENDS = [
  ['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Dodge'], ['color-burn', 'Burn'],
  ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'], ['difference', 'Difference'],
  ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'],
  ['luminosity', 'Luminosity'],
];

export function buildLayersPanel(app) {
  const list = el('div', { class: 'layer-list gscroll' });

  const blendSelect = el('select', { class: 'gselect', title: t('Blend mode') });
  const opacityRange = el('input', { class: 'grange', type: 'range', min: 0, max: 100, step: 1, value: 100, title: t('Layer opacity') });
  const opacityVal = el('span', { class: 'gchip', text: '100%' });

  const btn = (name, tip, desc, cmd, fn) => {
    const b = el('button', {
      class: 'gbtn',
      'data-tip': t(tip),
      'data-tip-desc': t(desc),
      'data-tip-key': app.commands.get(cmd)?.key || '',
      'data-tip-side': 'below',
      onclick: fn,
    }, [icon(name)]);
    // English originals, so re-translation never reads a translated string
    b.dataset.tipSrc = tip;
    b.dataset.tipDescSrc = desc;
    return b;
  };

  const tools = el('div', { class: 'layer-tools' }, [
    btn('plus', 'New layer', 'Add an empty layer above the current one.', 'layer.new',
      () => addLayer(app)),
    btn('copy', 'Duplicate', 'Copy the current layer, pixels and all.', 'layer.duplicate',
      () => duplicateLayer(app)),
    btn('merge', 'Merge down', 'Combine this layer into the one below it.', 'layer.mergeDown',
      () => mergeDown(app)),
    btn('up', 'Raise', 'Move this layer one step up the stack.', 'layer.raise',
      () => moveLayer(app, 1)),
    btn('down', 'Lower', 'Move this layer one step down the stack.', 'layer.lower',
      () => moveLayer(app, -1)),
    btn('trash', 'Delete', 'Remove this layer from the document.', 'layer.delete',
      () => deleteLayer(app)),
  ]);

  const opacityLabel = el('span', { class: 'glabel', text: t('Opacity') });
  const root = el('div', {}, [
    tools,
    el('div', { class: 'layer-props' }, [blendSelect]),
    el('div', { class: 'layer-props' }, [opacityLabel, opacityRange, opacityVal]),
    list,
  ]);

  blendSelect.addEventListener('change', () => {
    const l = app.doc.active;
    if (l) setLayerProp(app, l, 'blend', blendSelect.value, 'Blend Mode');
  });

  let opacityBefore = null;
  opacityRange.addEventListener('pointerdown', () => { opacityBefore = app.doc.active?.opacity ?? 1; });
  opacityRange.addEventListener('input', () => {
    const l = app.doc.active;
    if (!l) return;
    l.opacity = parseInt(opacityRange.value, 10) / 100;
    opacityVal.textContent = `${opacityRange.value}%`;
    opacityRange.style.setProperty('--fill', `${opacityRange.value}%`);
    app.doc.touch();
    bus.emit('layers');
  });
  opacityRange.addEventListener('change', () => {
    const l = app.doc.active;
    if (!l || opacityBefore === null) return;
    const after = l.opacity;
    if (after === opacityBefore) return;
    l.opacity = opacityBefore;
    setLayerProp(app, l, 'opacity', after, 'Layer Opacity');
    opacityBefore = null;
  });

  let dragId = null;

  function thumbFor(layer) {
    const w = 34, h = 30;
    const c = makeCanvas(w * 2, h * 2);
    const g = ctx2d(c);
    const s = Math.min((w * 2) / layer.canvas.width, (h * 2) / layer.canvas.height);
    const dw = layer.canvas.width * s, dh = layer.canvas.height * s;
    g.imageSmoothingEnabled = s < 1;
    g.drawImage(layer.canvas, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    return c.toDataURL();
  }

  function render() {
    const doc = app.doc;

    // rebuilt each pass so blend names follow the active language
    const blend = blendSelect.value;
    blendSelect.innerHTML = '';
    for (const [v, label] of BLENDS) {
      blendSelect.appendChild(el('option', { value: v, text: t(label) }));
    }
    blendSelect.value = blend;
    blendSelect.title = t('Blend mode');
    opacityRange.title = t('Layer opacity');
    opacityLabel.textContent = t('Opacity');
    for (const b of tools.children) {
      b.dataset.tip = t(b.dataset.tipSrc);
      b.dataset.tipDesc = t(b.dataset.tipDescSrc);
    }

    list.innerHTML = '';
    for (const layer of doc.layers) {
      const active = layer.id === doc.activeId;
      const vis = el('button', {
        class: 'vis',
        'data-tip': layer.visible ? t('Hide layer') : t('Show layer'),
        'data-tip-side': 'left',
        onclick: (e) => { e.stopPropagation(); setLayerProp(app, layer, 'visible', !layer.visible, 'Toggle Visibility'); },
      }, [icon(layer.visible ? 'eye' : 'eyeOff')]);

      const nameEl = el('div', { class: 'lname', text: layer.name });
      const row = el('div', {
        class: 'layer-row' + (active ? ' active' : ''),
        draggable: 'true',
        onclick: () => doc.setActive(layer.id),
        ondblclick: (e) => {
          if (e.target === vis || vis.contains(e.target)) return;
          startRename(layer, nameEl);
        },
      }, [
        vis,
        el('img', { class: 'thumb checker', src: thumbFor(layer), alt: '' }),
        el('div', { class: 'meta' }, [
          nameEl,
          el('div', {
            class: 'lsub',
            text: `${Math.round(layer.opacity * 100)}% · ${t(BLENDS.find((b) => b[0] === layer.blend)?.[1] || 'Normal')}`,
          }),
        ]),
      ]);

      row.addEventListener('dragstart', (e) => {
        dragId = layer.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(layer.id));
      });
      row.addEventListener('dragover', (e) => {
        if (dragId == null || dragId === layer.id) return;
        e.preventDefault();
        row.classList.add('dragover');
      });
      row.addEventListener('dragleave', () => row.classList.remove('dragover'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('dragover');
        if (dragId == null || dragId === layer.id) return;
        const from = doc.layers.findIndex((l) => l.id === dragId);
        const to = doc.layers.findIndex((l) => l.id === layer.id);
        if (from < 0 || to < 0) return;
        const id = dragId;
        dragId = null;
        moveLayer(app, to - from, id);
      });
      row.addEventListener('dragend', () => { dragId = null; });

      list.appendChild(row);
    }

    const active = doc.active;
    if (active) {
      blendSelect.value = active.blend;
      opacityRange.value = String(Math.round(active.opacity * 100));
      opacityRange.style.setProperty('--fill', `${Math.round(active.opacity * 100)}%`);
      opacityVal.textContent = `${Math.round(active.opacity * 100)}%`;
    }
  }

  function startRename(layer, nameEl) {
    const input = el('input', { class: 'ginput lname-input', value: layer.name });
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = input.value.trim() || layer.name;
      input.replaceWith(nameEl);
      if (v !== layer.name) setLayerProp(app, layer, 'name', v, 'Rename Layer');
      else render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = layer.name; input.blur(); }
    });
  }

  // Structural changes are rare and must show immediately; pixel updates fire
  // continuously during a stroke, so their thumbnail refresh is coalesced.
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; render(); });
  };
  bus.on('doc', () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    render();
  });
  bus.on('layers', schedule);
  bus.on('locale', render);
  render();
  return root;
}
