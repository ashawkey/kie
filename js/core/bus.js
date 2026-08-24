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
    // Notifications publish already-committed model state. A broken observer
    // must not make the operation appear to fail, nor prevent later observers
    // from rendering that state.
    map.get(type)?.forEach((fn) => {
      try {
        fn(...args);
      } catch (error) {
        try { console.error(`Error in ${type} event subscriber`, error); } catch {}
      }
    });
  },
};
