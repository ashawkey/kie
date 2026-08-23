// Inline SVG icon set (24x24, stroke-based to suit the glass aesthetic).
const P = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;

export const icons = {
  // four-way move arrow: cross with an arrowhead on each end
  move: P('<path d="M12 3.2v17.6M3.2 12h17.6"/><path d="M9.2 6.2L12 3.2l2.8 3M9.2 17.8L12 20.8l2.8-3M6.2 9.2L3.2 12l3 2.8M17.8 9.2l3 2.8-3 2.8"/>'),
  'select-rect': P('<rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke-dasharray="3 2.5"/>'),
  'select-ellipse': P('<ellipse cx="12" cy="12" rx="8.5" ry="8.5" stroke-dasharray="3 2.5"/>'),
  lasso: P('<path d="M12 4c4.4 0 8 2.5 8 5.6 0 3-3.6 5.5-8 5.5-2 0-3.9-.5-5.3-1.4"/><path d="M6.7 13.7C5 14.9 5.2 17 6.6 17.9c1 .7 2.3.3 2.4-.8.1-.9-.8-1.4-1.5-1"/>'),
  wand: P('<path d="M5 19L15 9"/><path d="M17 3.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/><path d="M7.5 4l.6 1.4 1.4.6-1.4.6L7.5 8l-.6-1.4L5.5 6l1.4-.6z"/>'),
  crop: P('<path d="M6 2v16h16"/><path d="M2 6h16v16"/>'),
  eyedropper: P('<path d="M15.5 3.5a2.1 2.1 0 013 3l-2 2 1 1-1.6 1.6-1-1L7 18.5 4 20l1.5-3 8.4-8.4-1-1L14.5 6l1 1z"/>'),
  pencil: P('<path d="M4 20l1-4.5L15.6 4.9a1.9 1.9 0 012.7 0l.8.8a1.9 1.9 0 010 2.7L8.5 19 4 20z"/><path d="M14.5 6.5l3 3"/>'),
  brush: P('<path d="M14 4.5l5.5 5.5-7 7-5.5-5.5z"/><path d="M7 11.5C5 13.5 5.5 16 4 18c2.5.5 4.5-.5 6-2 1-1 1-2.5 0-3.5"/>'),
  eraser: P('<path d="M8.5 19H20"/><path d="M15.5 4.5l4 4a1.6 1.6 0 010 2.3L11.5 19H7l-2.5-2.5a1.6 1.6 0 010-2.3l8.7-9.7a1.6 1.6 0 012.3 0z"/><path d="M9 9l6.5 6.5"/>'),
  bucket: P('<path d="M11 3l8.2 8.2a1.4 1.4 0 010 2L13 19.4a1.4 1.4 0 01-2 0L4.8 13.2a1.4 1.4 0 010-2L11 5"/><path d="M7 7l6 6"/><path d="M19.5 15.5c1 1.3 1.5 2.2 1.5 3a1.5 1.5 0 11-3 0c0-.8.5-1.7 1.5-3z" fill="currentColor" stroke="none"/>'),
  gradient: P('<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M4 17h16M4 14h16M5 11h14M7 8h10" opacity=".7"/>'),
  line: P('<path d="M4 20L20 4"/><circle cx="4.5" cy="19.5" r="1.6"/><circle cx="19.5" cy="4.5" r="1.6"/>'),
  rect: P('<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>'),
  ellipse: P('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'),
  hand: P('<path d="M9 11V5.2a1.4 1.4 0 112.8 0V11m0-.8V4.4a1.4 1.4 0 112.8 0V11m0-.4V6.4a1.4 1.4 0 112.8 0V14c0 3.6-2.2 6.5-5.6 6.5S8 18.6 7 16.4L5.4 13a1.4 1.4 0 112.4-1.4L9 13.5"/>'),
  zoom: P('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M8 10.5h5M10.5 8v5"/>'),
  undo: P('<path d="M4 9h11a5 5 0 010 10h-5"/><path d="M8 5L4 9l4 4"/>'),
  redo: P('<path d="M20 9H9a5 5 0 000 10h5"/><path d="M16 5l4 4-4 4"/>'),
  eye: P('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  eyeOff: P('<path d="M4 4l16 16"/><path d="M9.5 6c.8-.3 1.6-.5 2.5-.5 6 0 9.5 6.5 9.5 6.5a17 17 0 01-3.3 4"/><path d="M6.4 7.9A16.6 16.6 0 002.5 12S6 18.5 12 18.5c1.4 0 2.6-.3 3.7-.8"/><path d="M9.7 10a2.8 2.8 0 003.9 3.9"/>'),
  lock: P('<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  copy: P('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5h-9a2 2 0 00-2 2v9"/>'),
  trash: P('<path d="M4.5 6.5h15"/><path d="M9 6.5V4.8A1.3 1.3 0 0110.3 3.5h3.4A1.3 1.3 0 0115 4.8v1.7"/><path d="M6.5 6.5l1 12.2A1.8 1.8 0 009.3 20.5h5.4a1.8 1.8 0 001.8-1.8l1-12.2"/>'),
  up: P('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: P('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  merge: P('<path d="M12 3v10M8 9l4 4 4-4"/><path d="M4 17h16"/><path d="M4 20.5h16" opacity=".5"/>'),
  grid: P('<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" opacity=".7"/>'),
  swap: P('<path d="M5 8h9l-3-3M19 16h-9l3 3"/>'),
  menu: P('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  fit: P('<path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4"/>'),
  layers: P('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 16.5L12 21l8.5-4.5" opacity=".55"/>'),
  sliders: P('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>'),
  history: P('<path d="M3.5 12a8.5 8.5 0 108.5-8.5A8.5 8.5 0 005.6 6.4"/><path d="M3.5 3.5v4h4"/><path d="M12 7.5V12l3 2"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: P('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  help: P('<circle cx="12" cy="12" r="8.7"/><path d="M9.6 9.4a2.5 2.5 0 114.2 2.2c-.9.7-1.8 1.1-1.8 2.3"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>'),
  save: P('<path d="M5 4.5h11L20 8.5v11a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 19.5v-13A2 2 0 016 4.5"/><path d="M8 4.5v5h7v-5"/><rect x="7.5" y="13" width="9" height="8"/>'),
  export: P('<path d="M12 15V3.5"/><path d="M8 7l4-4 4 4"/><path d="M4.5 14v5a1.5 1.5 0 001.5 1.5h12a1.5 1.5 0 001.5-1.5v-5"/>'),
  preview: P('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 15l4.5-4 3.5 3 4-5 5 6"/><circle cx="9" cy="9" r="1.4"/>'),
  palette: P('<path d="M12 3.5a8.5 8.5 0 000 17c1.3 0 1.8-.9 1.4-1.8-.5-1 .2-2.2 1.4-2.2H17a4 4 0 004-4c0-4.9-4-9-9-9z"/><circle cx="7.8" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.3" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="8.2" r="1.1" fill="currentColor" stroke="none"/>'),
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = 'icon ' + cls;
  span.innerHTML = icons[name] || icons.close;
  return span;
}
