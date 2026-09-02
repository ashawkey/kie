# kie — Pixel-Art Image Editor in Your Browser

A pure-static pixel-art image editor built with plain ES modules and CSS. Open, edit, and export images directly in a modern browser—no account, installation, runtime dependencies, or backend required.

**[Launch kie](https://ashawkey.github.io/kie/)** · [Chinese](./README_ZH.md) · [GitHub](https://github.com/ashawkey/kie)

## Why kie?

- **Local processing:** Images are processed in your browser and never need to be uploaded to a server.
- **Zero install:** Open the web app and start editing—no account or setup required.
- **Pure static app:** No backend and no runtime dependencies.
- **Lightweight:** Plain ES modules and CSS keep the runtime small and straightforward.
- **Cross-platform:** Runs in current Chrome, Edge, Safari, and Firefox on supported desktop platforms.
- **Pixel-art focused:** Nearest-neighbor scaling, pixel grids, pixel-perfect drawing, palettes, dithering, and other purpose-built tools.
- **Bilingual interface:** English and Simplified Chinese UI.

## Ideal For

- Creating and refining sprites, tiles, icons, and small game assets
- Cleaning up or recoloring existing pixel art
- Producing scaled exports while preserving hard pixel edges
- Making quick edits on a machine where installing software is inconvenient
- Keeping ordinary image workflows local instead of sending files to an editing service
- Saving multi-layer work as a `.glassx` project for later editing

## Features

### Open, Save, and Export

- Open, import, or drag and drop images
- Export with configurable format, scale, and quality
- Live export preview and exact encoded file-size readout
- Save in place through the File System Access API on supported Chromium browsers
- Download-based fallback on other browsers
- Layered `.glassx` project files

### Pixel-Art Workflow

- Pixel-perfect pencil mode
- Symmetric pixel brushes
- Nearest-neighbor image handling
- Optional pixel grid
- Dithering, posterize, and pixel-outline effects
- Built-in color palettes
- Foreground and background color controls

### Drawing and Editing Tools

- Move and transform
- Marquee, lasso, magic wand, and crop
- Pencil, brush, eraser, and bucket fill
- Gradient, line, rectangle, and ellipse
- Eyedropper, hand, and zoom
- Selection modes and masking

### Layers and Navigation

- Layer opacity and visibility
- Layer reordering and merging
- 16 blend modes
- Navigator for moving around the canvas
- Hover help for tool guidance

### Filters and History

- Brightness/contrast, HSV, grayscale, invert, sepia, posterize, threshold, dither, blur, sharpen, edge, noise, pixelate, and outline filters with previews
- Bounded undo/history to keep editing history under control

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `V` | Move |
| `M` | Cycle marquee tools |
| `L` / `W` / `C` | Lasso / magic wand / crop |
| `B` | Pencil or brush |
| `E` | Eraser |
| `G` | Bucket or gradient |
| `U` | Shape tools |
| `I` / `H` / `Z` | Eyedropper / hand / zoom |
| `Space` + drag | Pan canvas |
| `Ctrl`/`Option` + wheel | Zoom |
| `[` / `]` | Decrease / increase brush size |
| `X` / `D` | Swap / reset colors |
| `Alt` | Temporarily use eyedropper |
| `Ctrl`/`Cmd` + `S` | Save |
| `Ctrl`/`Cmd` + `Shift` + `S` | Export |
| `Ctrl`/`Cmd` + `Z` | Undo |
| `Ctrl`/`Cmd` + `Shift` + `Z` | Redo |
| `Ctrl`/`Cmd` + `T` | Transform |
| `Ctrl`/`Cmd` + `A` | Select all |
| `Ctrl`/`Cmd` + `D` | Deselect |
| `Ctrl`/`Cmd` + `Shift` + `D` | Reselect |
| `Ctrl`/`Cmd` + `Shift` + `C` | Copy merged |
| `Ctrl`/`Cmd` + `H` | Hide/show selection edges |
| `Shift` / `Alt` + click | Add to / subtract from a selection |
| `Alt` + drag (move tool) | Drag out a copy of the pixels |
| `Ctrl`/`Cmd` + click a layer thumbnail | Load that layer as a selection |
| Arrow keys (selection tools) | Nudge the selection |
| `Enter` / `Esc` | Apply / cancel |
| `?` | Help |

## Privacy

kie is a static browser application with no backend. Files are opened and processed locally in your browser and do not need to be uploaded to use the editor.

Local processing reduces the need to send images to a remote editing service, but it is not a guarantee of absolute security. Normal browser, device, extension, operating-system, and network security considerations still apply. Review the source and use a trusted deployment when handling sensitive material.

## Browser Support and Limitations

kie targets current versions of:

- Chrome
- Edge
- Safari
- Firefox

Saving directly back to an existing file relies on the File System Access API and is available only in supported Chromium browsers. Other browsers use a download-based save/export flow. Browser capabilities and file-system behavior may therefore differ by platform.

## Local Development

kie uses Vite and builds to `dist`.

```bash
npm install
npm run dev
```

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Technical Notes

- Plain JavaScript ES modules and CSS with no runtime dependencies
- Direct `ImageData` painting for exact pixel-level edits
- Dirty-rectangle history snapshots keep undo memory bounded
- Transforms stay non-destructive until committed
- Static production output in `dist`; no backend services

## License

kie is released under the [MIT License](./LICENSE). Third-party dependencies remain under their respective licenses.

**[Open the live editor](https://ashawkey.github.io/kie/)**
