// Top bar menus, wired to the command registry.
import { el } from '../core/util.js';
import { bus } from '../core/bus.js';
import { icon } from './icons.js';
import { t } from '../core/i18n.js';

export const MENUS = [
  {
    label: 'File',
    desc: 'Create, open, save and export documents.',
    items: [
      'file.new', 'file.open', 'file.import', '-',
      'file.save', 'file.export', 'file.export.png', '-',
      'file.project.save', 'file.project.open',
    ],
  },
  {
    label: 'Edit',
    desc: 'Undo, clipboard, fills and free transform.',
    items: [
      'edit.undo', 'edit.redo', '-',
      'edit.cut', 'edit.copy', 'edit.paste', 'edit.clear', '-',
      'edit.fillPrimary', 'edit.fillSecondary', '-',
      'edit.transform',
    ],
  },
  {
    label: 'Image',
    desc: 'Resize, crop, flip and rotate the whole document.',
    items: [
      'image.size', 'image.canvasSize', 'image.trim', '-',
      'image.flipH', 'image.flipV', '-',
      'image.rotate90', 'image.rotate270', 'image.rotate180', '-',
      'image.flatten',
    ],
  },
  {
    label: 'Layer',
    desc: 'Add, arrange, merge and transform layers.',
    items: [
      'layer.new', 'layer.duplicate', 'layer.delete', '-',
      'layer.raise', 'layer.lower', 'layer.mergeDown', '-',
      'layer.flipH', 'layer.flipV', 'layer.rotate90', 'layer.rotate270',
    ],
  },
  {
    label: 'Select',
    desc: 'Change which pixels editing affects.',
    items: [
      'select.all', 'select.none', 'select.invert', '-',
      'select.fromLayer',
    ],
  },
  {
    label: 'Filter',
    desc: 'Adjust colour and apply effects to the current layer.',
    items: [
      'filter.brightness', 'filter.hsl', '-',
      'filter.grayscale', 'filter.invert', 'filter.sepia', '-',
      'filter.posterize', 'filter.threshold', 'filter.dither', '-',
      'filter.blur', 'filter.sharpen', 'filter.edge', 'filter.noise', '-',
      'filter.pixelate', 'filter.outline',
    ],
  },
  {
    label: 'View',
    desc: 'Zoom, pixel grid and the help page.',
    items: [
      'view.zoomIn', 'view.zoomOut', 'view.zoom100', 'view.fit', '-',
      'view.grid', '-', 'view.help',
    ],
  },
];

export function buildMenuBar(app, root) {
  let openMenu = null;

  const closeAll = () => {
    openMenu?.pop.remove();
    openMenu?.btn.classList.remove('active');
    openMenu = null;
  };

  document.addEventListener('pointerdown', (e) => {
    if (openMenu && !openMenu.root.contains(e.target)) closeAll();
  });
  bus.on('menu-close', closeAll);

  const rebuild = () => {
    root.innerHTML = '';
    build();
  };
  bus.on('locale', rebuild);

  function build() {
  for (const menu of MENUS) {
    const btn = el('button', {
      class: 'gbtn',
      text: t(menu.label),
      'data-tip': t(menu.label),
      'data-tip-desc': t(menu.desc),
      'data-tip-side': 'below',
    });
    const holder = el('div', { class: 'menu-root' }, [btn]);

    const open = () => {
      const wasOpen = openMenu?.btn === btn;
      closeAll();
      if (wasOpen) return;
      const pop = el('div', { class: 'menu-pop glass glass-dark gscroll' });
      for (const id of menu.items) {
        if (id === '-') { pop.appendChild(el('div', { class: 'gdivider h' })); continue; }
        const cmd = app.commands.get(id);
        if (!cmd) continue;
        const disabled = !app.commandEnabled(id);
        const item = el('button', {
          class: 'menu-item',
          disabled,
          onclick: () => { closeAll(); app.run(id); },
        }, [
          cmd.icon ? icon(cmd.icon) : el('span', { class: 'icon' }),
          el('span', { text: t(typeof cmd.label === 'function' ? cmd.label(app) : cmd.label) }),
          cmd.key ? el('span', { class: 'key', text: cmd.key }) : null,
        ]);
        pop.appendChild(item);
      }
      holder.appendChild(pop);
      btn.classList.add('active');
      openMenu = { btn, pop, root: holder };
    };

    btn.addEventListener('click', open);
    btn.addEventListener('pointerenter', () => { if (openMenu && openMenu.btn !== btn) open(); });
    root.appendChild(holder);
  }
  }

  build();
}
