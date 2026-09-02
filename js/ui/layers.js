// Layers panel: list, thumbnails, visibility, opacity, blend, reorder by drag.
import { bus } from '../core/bus.js';
import { el, makeCanvas, ctx2d } from '../core/util.js';
import { icon } from './icons.js';
import { moveLayer, setLayerProp, selectionFromLayer } from '../ops/image.js';
import { modeFromEvent } from '../tools/select.js';
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
      () => app.run('layer.new')),
    btn('copy', 'Duplicate', 'Copy the current layer, pixels and all.', 'layer.duplicate',
      () => app.run('layer.duplicate')),
    btn('merge', 'Merge down', 'Combine this layer into the one below it.', 'layer.mergeDown',
      () => app.run('layer.mergeDown')),
    btn('up', 'Raise', 'Move this layer one step up the stack.', 'layer.raise',
      () => app.run('layer.raise')),
    btn('down', 'Lower', 'Move this layer one step down the stack.', 'layer.lower',
      () => app.run('layer.lower')),
    btn('trash', 'Delete', 'Remove this layer from the document.', 'layer.delete',
      () => app.run('layer.delete')),
  ]);

  const opacityLabel = el('span', { class: 'glabel', text: t('Opacity') });
  const root = el('div', {}, [
    tools,
    el('div', { class: 'layer-props' }, [blendSelect]),
    el('div', { class: 'layer-props' }, [opacityLabel, opacityRange, opacityVal]),
    list,
  ]);

  blendSelect.addEventListener('change', () => {
    app.prepareMutation();
    const l = app.doc.active;
    if (l) setLayerProp(app, l, 'blend', blendSelect.value, 'Blend Mode');
  });

  let opacityEdit = null;
  let opacityGesture = null;
  const gestureCurrent = () => opacityGesture && app.isMutationTokenCurrent(opacityGesture.token) &&
    app.doc.layers.includes(opacityGesture.layer);
  const startOpacityGesture = () => {
    const layer = app.doc.active;
    opacityGesture = layer ? { token: app.mutationToken(), layer } : null;
  };
  const clearOpacityEdit = () => { opacityEdit = null; };
  const opacityEditCurrent = (edit) => !!edit && app.pendingEdit === edit &&
    app.isMutationTokenCurrent(edit.token) && app.doc === edit.doc &&
    edit.doc.layers.includes(edit.layer);
  const discardStaleOpacityEdit = (edit) => {
    // A stale preview may still belong to the current layer (for example after
    // direct history movement). Restore it before dropping ownership so no
    // untracked opacity remains visible.
    if (app.doc === edit.doc && edit.doc.layers.includes(edit.layer)) {
      edit.layer.opacity = edit.before;
      edit.doc.touch();
      bus.emit('doc');
      bus.emit('layers');
    }
    if (opacityEdit === edit) clearOpacityEdit();
    app.endPendingEdit(edit);
  };
  const finishOpacityEdit = (commit, external = false) => {
    // Commands/history/replacement settle through the edit callbacks rather
    // than through this control's own change/pointer completion. Retire that
    // gesture immediately so already-queued input/change events cannot revive
    // the preview after its owner has moved on.
    if (external) opacityGesture = null;
    const edit = opacityEdit;
    if (!edit || app.pendingEdit !== edit) return false;
    if (!opacityEditCurrent(edit)) {
      discardStaleOpacityEdit(edit);
      return false;
    }
    const { doc, layer, before } = edit;
    const after = layer.opacity;
    if (!commit || after === before) {
      layer.opacity = before;
      doc.touch();
      bus.emit('doc');
      bus.emit('layers');
      clearOpacityEdit();
      app.endPendingEdit(edit);
      return true;
    }
    // End app-level ownership before using the ordinary property helper, or
    // its transaction guard would recursively settle this same slider edit.
    clearOpacityEdit();
    app.endPendingEdit(edit);
    layer.opacity = before;
    setLayerProp(app, layer, 'opacity', after, 'Layer Opacity');
    return true;
  };
  const beginOpacityEdit = () => {
    if (opacityEdit) {
      if (opacityEditCurrent(opacityEdit)) return opacityEdit.layer;
      discardStaleOpacityEdit(opacityEdit);
    }
    if (!gestureCurrent()) return null;
    app.prepareMutation();
    if (!gestureCurrent()) return null;
    const layer = opacityGesture.layer;
    const edit = {
      doc: app.doc,
      layer,
      token: app.mutationToken(),
      before: layer.opacity,
      stagePendingEdit: () => opacityEditCurrent(edit) ? { after: layer.opacity } : null,
      commitStagedPendingEdit: (staged) => {
        if (!staged || !opacityEditCurrent(edit)) return false;
        layer.opacity = staged.after;
        return finishOpacityEdit(true, true);
      },
      commitPendingEdit: () => finishOpacityEdit(true, true),
      cancelPendingEdit: () => finishOpacityEdit(false, true),
    };
    opacityEdit = edit;
    app.beginPendingEdit(edit);
    return layer;
  };
  opacityRange.addEventListener('pointerdown', () => {
    startOpacityGesture();
    beginOpacityEdit();
  });
  // Keyboard and assistive-technology gestures establish a fresh origin just
  // like pointerdown. A cancelled/replaced gesture cannot be resurrected by a
  // queued input/change event from this persistent range element.
  opacityRange.addEventListener('focus', startOpacityGesture);
  opacityRange.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') startOpacityGesture();
  });
  opacityRange.addEventListener('click', (e) => {
    // A synthetic click is the activation primitive exposed by many assistive
    // technologies. Trusted pointer clicks already established their origin
    // on pointerdown and must not turn a stale trailing click into a gesture.
    if (e.detail === 0) startOpacityGesture();
  });
  opacityRange.addEventListener('input', () => {
    const l = beginOpacityEdit();
    if (!l) return;
    l.opacity = parseInt(opacityRange.value, 10) / 100;
    opacityVal.textContent = `${opacityRange.value}%`;
    opacityRange.style.setProperty('--fill', `${opacityRange.value}%`);
    app.doc.touch();
    bus.emit('layers');
  });
  opacityRange.addEventListener('change', () => finishOpacityEdit(true));
  // A click on the current thumb commonly emits no input/change event. End
  // the pending transaction on pointerup so this no-op does not stay dirty.
  opacityRange.addEventListener('pointerup', () => {
    finishOpacityEdit(true);
    opacityGesture = null;
  });
  opacityRange.addEventListener('pointercancel', () => {
    finishOpacityEdit(false);
    opacityGesture = null;
  });
  opacityRange.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && opacityEdit) {
      e.preventDefault();
      finishOpacityEdit(false);
      opacityGesture = null;
    }
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
        onclick: (e) => {
          e.stopPropagation();
          app.prepareMutation();
          setLayerProp(app, layer, 'visible', !layer.visible, 'Toggle Visibility');
        },
      }, [icon(layer.visible ? 'eye' : 'eyeOff')]);

      // Ctrl/Cmd-click the thumbnail loads the layer's transparency as a
      // selection without changing which layer is active; Shift/Alt combine it
      // with the current selection, exactly as in Photoshop.
      const thumb = el('img', {
        class: 'thumb checker',
        src: thumbFor(layer),
        alt: '',
        'data-tip': t('Ctrl-click to load as selection'),
        'data-tip-side': 'left',
        onclick: (e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.stopPropagation();
          e.preventDefault();
          selectionFromLayer(app, layer, modeFromEvent(e, 'replace'));
        },
      });

      const nameEl = el('div', { class: 'lname', text: layer.name });
      const row = el('div', {
        class: 'layer-row' + (active ? ' active' : ''),
        draggable: 'true',
        onclick: () => { app.prepareMutation(); doc.setActive(layer.id); },
        ondblclick: (e) => {
          if (e.target === vis || vis.contains(e.target)) return;
          startRename(layer, nameEl);
        },
      }, [
        vis,
        thumb,
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
        app.prepareMutation();
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
      if (v !== layer.name) {
        app.prepareMutation();
        setLayerProp(app, layer, 'name', v, 'Rename Layer');
      }
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
