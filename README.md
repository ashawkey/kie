# kie

A pure-static, pixel-art-focused image editor that runs entirely in the browser.
No build step, no dependencies, no server logic — open `index.html` and draw.

## Running

Because it uses ES modules, serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://127.0.0.1:8000/
```

## Features

**Document & IO** — new/open/import images, drag & drop onto the canvas, and a
dedicated export dialog with format, scale and quality controls, a live preview
and an exact file-size readout. In Chromium-based browsers, `Ctrl/⌘ S` writes
straight back to the file you opened; elsewhere it falls back to a download.
Layered projects save and reload as `.glassx`.

**Navigation** — zoom controls live in the top bar, and a collapsible navigator
in the corner of the canvas shows the whole document with the current viewport
outlined; click or drag inside it to jump anywhere.

**Languages** — English and 简体中文, switched with the globe button beside the
help button. The choice is remembered, and a first visit follows the browser
language. Keyboard shortcuts stay on their Latin keys in both languages.

**Hover help** — every button explains itself: hovering shows its name, a short
description of what it does, and its keyboard shortcut.

**Layers** — add, duplicate, delete, reorder (buttons or drag), merge down,
flatten, rename (double-click), per-layer opacity, visibility and 16 blend modes.

**Tools** — move/free-transform, rectangular & elliptical marquee, lasso, magic
wand, crop, pencil, brush, eraser, paint bucket, gradient, line, rectangle,
ellipse, eyedropper, hand, zoom.

**Pixel-art support** — everything paints through a direct `ImageData` engine, so
edits are exact at the pixel level:

- 1px pencil with **pixel-perfect** stroke correction (drops L-corners, like Aseprite)
- square and circular brush tips with integer, symmetric footprints
- nearest-neighbour rendering and a pixel grid that appears past 6× zoom
- non-smoothing image resize, ordered dithering, posterize, and pixel outline
- built-in palettes: PICO-8, Sweetie 16, Endesga 32, Game Boy, grayscale

**Selection** — replace/add/subtract/intersect modes, marching-ants outline,
select all/none/invert, selection from layer alpha. Every paint, filter and
transform is masked by the active selection with antialiased coverage.

**Filters** — brightness/contrast, hue/saturation/value, grayscale, invert,
sepia, posterize, threshold, ordered dither, gaussian blur, sharpen, find edges,
noise, pixelate, and pixel outline. Parametric filters show a live preview.

**History** — undo/redo with a clickable history panel. Pixel edits store only
their dirty rectangle, so long sessions stay memory-bounded.

## Keyboard

Tools follow Photoshop's convention: one letter per slot, and pressing that
letter again — or `⇧` + the letter — cycles through the tools sharing it.

| Key | Tool slot |
| --- | --- |
| `V` | Move |
| `M` | Rectangular marquee → elliptical marquee |
| `L` `W` `C` | Lasso · Magic wand · Crop |
| `B` | Pencil → brush |
| `E` | Eraser |
| `G` | Paint bucket → gradient |
| `U` | Rectangle → ellipse → line |
| `I` `H` `Z` | Eyedropper · Hand · Zoom |

| Key | Action |
| --- | --- |
| `Space` + drag | Pan (works with any tool) |
| `Ctrl/⌥` + wheel | Zoom at cursor |
| `[` `]` | Brush size |
| `X` `D` | Swap colors · reset to black/white |
| `Alt` while painting | Temporary eyedropper |
| `Ctrl/⌘ S` | Save to the opened file |
| `Ctrl/⌘ ⇧ S` | Export / Save As… |
| `Ctrl/⌘ Z` / `Ctrl/⌘ ⇧ Z` | Undo · Redo |
| `Ctrl/⌘ T` | Free transform |
| `Ctrl/⌘ A` / `Ctrl/⌘ D` | Select all · Deselect |
| `Enter` / `Esc` | Apply · cancel a transform or crop |
| `?` | Help & all shortcuts |

Right-click paints with the secondary color; shift constrains lines, shapes and
selections.

## Architecture

```
index.html
icon.svg               app icon and favicon
css/    glass.css    reusable Liquid Glass primitives (surfaces, buttons, inputs)
        app.css      application layout
js/
  core/  i18n.js      translation table + locale switching
         doc.js       Doc + Layer model, cached composite
         pixels.js    Painter: ImageData blending, brush stamps, fills, shapes
         selection.js coverage mask, boolean ops, marching-ants outline
         history.js   undo stack, dirty-rect and full-layer snapshots
         view.js      pan/zoom, screen <-> image coordinate mapping
         renderer.js  checkerboard, composite, grid, ants, tool overlays
         bus.js       tiny event bus     util.js  DOM/color/canvas helpers
  tools/ base.js      Tool + PixelTool (edit checkout, preview, undo entry)
         paint.js  select.js  transform.js  navigate.js  index.js
  ops/   image.js     document/layer operations     filters.js     io.js
  ui/    commands.js  single registry backing menus + shortcuts
         menu.js  toolbar.js  color.js  layers.js  modal.js
         export.js    export dialog, live preview, save-in-place
         help.js      shortcut reference generated from the registries
         navigator.js document overview + viewport rectangle
         tooltip.js   hover help with title, description and shortcut
         shortcuts.js  pointer.js  icons.js
  app.js  application shell wiring everything together
```

Key design points:

- **One paint path.** Every pixel tool goes through `Painter`, so selection
  masking, alpha blending, stroke opacity accumulation and dirty-rect tracking
  behave identically for all of them.
- **Bounded undo.** Strokes and filters snapshot only the rectangle they touched
  rather than the whole layer.
- **Non-destructive transforms.** Free transform lifts pixels into a floating
  canvas rendered with a live affine transform; nothing is resampled until you
  commit, so scaling and rotating repeatedly does not degrade the image.
- **Commands as the source of truth.** Menus, the shortcut table and programmatic
  calls all dispatch through the same registry in `ui/commands.js`. Tool letters
  come from `TOOL_GROUPS` in `tools/index.js`, and the help page is generated
  from both — so tooltips, key bindings and documentation cannot drift apart.
- **English strings are the translation keys.** `t('Merge Down')` reads normally
  at the call site and degrades to English if an entry is missing, so no screen
  can ever show a raw key. Model code (tools, ops, history labels) stays in
  English and is translated only where it is displayed, which keeps history
  entries and undo grouping stable across a language switch.

## Browser support

Needs ES modules, `Path2D`, `backdrop-filter` and Pointer Events — any current
Chrome, Edge, Safari or Firefox. Where `prefers-reduced-transparency` is set the
glass surfaces fall back to opaque panels.

Saving in place uses the File System Access API, which today means Chromium
(Chrome, Edge, Opera). Firefox and Safari transparently fall back to downloading
the exported file.
