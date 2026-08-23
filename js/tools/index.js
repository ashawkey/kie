// Tool registry + active tool management.
import { bus } from '../core/bus.js';
import {
  PencilTool, BrushTool, EraserTool, LineTool, RectTool, EllipseTool,
  BucketTool, GradientTool, EyedropperTool,
} from './paint.js';
import { RectSelectTool, EllipseSelectTool, LassoTool, MagicWandTool } from './select.js';
import { MoveTool } from './transform.js';
import { HandTool, ZoomTool, CropTool } from './navigate.js';

const TOOL_CLASSES = [
  MoveTool, RectSelectTool, EllipseSelectTool, LassoTool, MagicWandTool, CropTool,
  PencilTool, BrushTool, EraserTool, BucketTool, GradientTool,
  LineTool, RectTool, EllipseTool,
  EyedropperTool, HandTool, ZoomTool,
];

/** Tools whose behaviour depends on the current color (Alt = eyedropper). */
const COLOR_TOOLS = new Set(['pencil', 'brush', 'bucket', 'gradient', 'line', 'rect', 'ellipse']);

/** Tools with a resizable brush ( [ / ] shortcuts ). */
export const SIZED_TOOLS = new Set(['pencil', 'brush', 'eraser', 'line', 'rect', 'ellipse']);

/**
 * Photoshop-style tool slots: one letter per slot, Shift+letter cycles through
 * the tools sharing it. Source of truth for shortcuts, tooltips and the help
 * page, so the three can never drift apart.
 */
export const TOOL_GROUPS = [
  { key: 'V', tools: ['move'] },
  { key: 'M', tools: ['select-rect', 'select-ellipse'] },
  { key: 'L', tools: ['select-lasso'] },
  { key: 'W', tools: ['wand'] },
  { key: 'C', tools: ['crop'] },
  { key: 'B', tools: ['pencil', 'brush'] },
  { key: 'E', tools: ['eraser'] },
  { key: 'G', tools: ['bucket', 'gradient'] },
  { key: 'U', tools: ['rect', 'ellipse', 'line'] },
  { key: 'I', tools: ['eyedropper'] },
  { key: 'H', tools: ['hand'] },
  { key: 'Z', tools: ['zoom'] },
];

const SLOT_OF = new Map();
for (const g of TOOL_GROUPS) g.tools.forEach((id, i) => SLOT_OF.set(id, { key: g.key, index: i, group: g }));

/** Human-readable shortcut for a tool, e.g. 'B' or '⇧B'. */
export function shortcutFor(id) {
  const slot = SLOT_OF.get(id);
  if (!slot) return '';
  return slot.index === 0 ? slot.key : `⇧${slot.key}`;
}

/**
 * Tool to activate for a slot letter. Entering the slot picks its first tool;
 * pressing the letter again (or Shift+letter) advances within the slot.
 */
export function toolForKey(key, activeId) {
  const group = TOOL_GROUPS.find((g) => g.key === key);
  if (!group) return null;
  const i = group.tools.indexOf(activeId);
  return i < 0 ? group.tools[0] : group.tools[(i + 1) % group.tools.length];
}

export class ToolManager {
  constructor(app) {
    this.app = app;
    this.registry = new Map();
    this.instances = new Map();
    for (const T of TOOL_CLASSES) {
      this.registry.set(T.id, T);
      // seed default options
      app.toolOptions[T.id] = Object.fromEntries((T.options || []).map((o) => [o.key, o.default]));
    }
    this.activeId = null;
    this.active = null;
  }

  get(id) {
    if (!this.instances.has(id)) {
      const T = this.registry.get(id);
      if (!T) return null;
      this.instances.set(id, new T(this.app));
    }
    return this.instances.get(id);
  }

  select(id) {
    if (this.activeId === id || !this.registry.has(id)) return;
    this.app.settlePendingEdit('commit');
    this.active?.deactivate?.();
    this.activeId = id;
    this.active = this.get(id);
    this.active.activate?.();
    bus.emit('tool');
  }

  /** Clear document-bound gesture state while preserving tool/options choice. */
  resetInteractions() {
    for (const tool of this.instances.values()) tool.resetInteraction?.();
  }

  usesColor(id) { return COLOR_TOOLS.has(id); }
}
