// Help / keyboard shortcut reference, generated from the live tool and
// command registries so it can never drift from the real bindings.
import { el } from '../core/util.js';
import { dialog } from './modal.js';
import { TOOL_GROUPS, shortcutFor } from '../tools/index.js';
import { t } from '../core/i18n.js';
import { MENUS } from './menu.js';

/** Shortcuts that live in the input layer rather than the command registry. */
const MANUAL = {
  Canvas: [
    ['Space + drag', 'Pan the canvas'],
    ['Middle-drag', 'Pan the canvas'],
    ['Wheel / trackpad', 'Scroll the canvas'],
    ['⇧ + wheel', 'Scroll horizontally'],
    ['Ctrl/⌥ + wheel', 'Zoom at the cursor'],
  ],
  Painting: [
    ['Drag', 'Paint with the primary color'],
    ['Right-drag', 'Paint with the secondary color'],
    ['⇧ + drag', 'Constrain to straight lines'],
    ['Alt + click', 'Temporary eyedropper'],
    ['[  /  ]', 'Decrease / increase brush size'],
    ['X', 'Swap primary and secondary color'],
    ['D', 'Reset to black and white'],
  ],
  Selections: [
    ['⇧ + click', 'Add to the selection'],
    ['Alt + click', 'Subtract from the selection'],
    ['⇧ + Alt + click', 'Intersect with the selection'],
    ['⇧ while dragging', 'Constrain to a square / circle'],
    ['Alt while dragging', 'Draw out from the centre'],
    ['Space while dragging', 'Reposition the marquee'],
    ['Drag with the wand', 'Keep adding matching regions'],
    ['Arrow keys', 'Nudge the selection (⇧ for 10px)'],
    ['Ctrl + click a thumbnail', 'Load that layer as a selection'],
  ],
  'Transform & crop': [
    ['Alt + drag', 'Move a copy of the pixels'],
    ['Drag handles', 'Scale the selection'],
    ['Drag outside a corner', 'Rotate'],
    ['⇧ while scaling', 'Keep aspect ratio'],
    ['Arrow keys', 'Nudge by 1px (⇧ for 10px)'],
    ['Enter', 'Apply'],
    ['Esc', 'Cancel'],
  ],
};

const chip = (text) => el('kbd', { class: 'kbd', text });

function keyCell(combo) {
  // split on ' + ' and ' / ' so each physical key gets its own chip
  const parts = combo.split(/(\s\+\s|\s\/\s)/);
  const out = [];
  for (const p of parts) {
    if (p === ' + ') out.push(el('span', { class: 'kbd-sep', text: '+' }));
    else if (p === ' / ') out.push(el('span', { class: 'kbd-sep', text: t('or') }));
    else if (p.trim()) out.push(chip(p.trim()));
  }
  return el('div', { class: 'kbd-cell' }, out);
}

function section(title, rows) {
  return el('section', { class: 'help-section' }, [
    el('h3', { text: title }),
    el('div', { class: 'help-rows' }, rows.map(([k, v]) =>
      el('div', { class: 'help-row' }, [keyCell(k), el('span', { class: 'help-desc', text: v })]))),
  ]);
}

export function showHelp(app) {
  const body = el('div', { class: 'help' });

  // Tools, straight from the slot table.
  const toolRows = [];
  for (const group of TOOL_GROUPS) {
    for (const id of group.tools) {
      const T = app.tools.registry.get(id);
      if (!T) continue;
      toolRows.push([shortcutFor(id), t(T.label)]);
    }
  }
  const multi = TOOL_GROUPS.some((g) => g.tools.length > 1);

  body.appendChild(el('p', { class: 'help-lead' }, [
    t('Press a letter to pick a tool. '),
    ...(multi ? [
      t('When several tools share a letter, press it again — or use '),
      chip('⇧'), t(' + the letter — to cycle through them.'),
    ] : []),
  ]));

  body.appendChild(section(t('Tools'), toolRows));

  // Commands, grouped by their menu.
  for (const menu of MENUS) {
    const rows = [];
    for (const id of menu.items) {
      if (id === '-') continue;
      const cmd = app.commands.get(id);
      if (!cmd?.key) continue;
      // Prefer the stable title: menu labels change with document state
      // ("Undo Gradient"), which would be misleading in a reference table.
      const label = cmd.title || (typeof cmd.label === 'function' ? cmd.label(app) : cmd.label);
      rows.push([cmd.key, t(label).replace(/…$/, '')]);
    }
    if (rows.length) body.appendChild(section(t(menu.label), rows));
  }

  for (const [title, rows] of Object.entries(MANUAL)) {
    body.appendChild(section(t(title), rows.map(([k, v]) => [k, t(v)])));
  }

  return dialog({
    title: t('Help & Keyboard Shortcuts'),
    subtitle: t('kie — a pixel-art image editor that runs entirely in your browser.'),
    body,
    confirm: t('Done'),
    cancel: null,
    size: 'help',
  });
}
