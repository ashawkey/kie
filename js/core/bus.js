// Minimal event bus. Events used across the app:
//   doc      - document structure/size changed (layers added/removed/reordered/resized)
//   layers   - layer pixels or properties changed
//   selection- selection mask changed
//   history  - undo/redo stacks changed
//   tool     - active tool or tool options changed
//   color    - primary/secondary color changed
//   view     - pan/zoom changed
//   status   - status bar text hint

const map = new Map();

export const bus = {
  on(type, fn) {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
    return () => map.get(type).delete(fn);
  },
  emit(type, ...args) {
    map.get(type)?.forEach((fn) => fn(...args));
  },
};
