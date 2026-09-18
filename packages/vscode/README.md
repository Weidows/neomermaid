# NeoMermaid for VS Code

A preview for [mermaid](https://mermaid.js.org) diagrams that uses the NeoMermaid
SDK instead of mermaid's default styling: six themes × eleven colour schemes,
canvas/transparency control, zoom/fit and SVG/PNG export.

Because the panel renders with `@neomermaid/core` inside the webview, a diagram
shown here is the same diagram `neomermaid render` produces for the same preset —
same colour tokens, same stylesheet, same dimensions.

## Features

| | |
| --- | --- |
| **Preview** | `NeoMermaid: Open Preview` / `Open Preview to the Side` (`Ctrl/Cmd+Shift+M`). One panel per document, live-updating while you type (debounced by `neomermaid.liveUpdateDelay`). |
| **Themes** | Toolbar pickers for all 66 presets (`theme/palette`): minimal, neon, tech, cartoon, glass, blueprint × dracula, one-dark-pro, nord, gruvbox-dark, catppuccin-mocha, tokyo-night, monokai, rose-pine, github-light, solarized-light, nord-light. |
| **Canvas** | `Canvas` (palette background), `Transparent` (checkerboard) or any CSS colour, plus an adjustable padding. |
| **Zoom** | −, +, reset, and *Fit* to the panel width. |
| **Export** | `NeoMermaid: Export as PNG` (1×–4× raster scale) and `Export as SVG`. The toolbar buttons run the same commands. |
| **Clipboard** | `NeoMermaid: Copy SVG to Clipboard`. |
| **Follows the editor** | With `neomermaid.followEditorTheme` on, light/dark presets are chosen from the active VS Code colour theme. |
| **Status bar** | Shows the active preset and rendered size for mermaid editors. |

## Commands

| Command | What it does |
| --- | --- |
| `neomermaid.openPreview` | Open the preview in the current column. |
| `neomermaid.openPreviewToSide` | Open the preview beside the editor. |
| `neomermaid.exportPng` | Rasterise the diagram and save it as PNG. |
| `neomermaid.exportSvg` | Save the themed SVG. |
| `neomermaid.copySvg` | Copy the themed SVG to the clipboard. |
| `neomermaid.choosePreset` | Pick a theme and palette from the palette (optionally saving them as the default). |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `neomermaid.followEditorTheme` | `true` | Use the light/dark preset that matches the editor theme. |
| `neomermaid.lightPreset` / `neomermaid.darkPreset` | `minimal/github-light` / `neon/dracula` | Preset per editor appearance. |
| `neomermaid.defaultPreset` | `minimal/github-light` | Preset used when `followEditorTheme` is off. |
| `neomermaid.background` | `theme` | `theme`, `transparent`, or any CSS colour. |
| `neomermaid.padding` | `16` | Canvas padding in px. |
| `neomermaid.exportScale` | `2` | Raster scale for PNG export (1–4). |
| `neomermaid.liveUpdateDelay` | `250` | Debounce in ms before re-rendering while typing. |

## Build and verify

```sh
node scripts/build-vscode.mjs                      # → dist/extension.cjs + dist/webview.js
npx tsc -p packages/vscode/tsconfig.json --noEmit  # typecheck
node packages/vscode/scripts/webview-smoke.mjs     # headless browser smoke test
node packages/vscode/scripts/host-smoke.mjs        # extension-host smoke test
npm run verify --workspace neomermaid-vscode        # all four, in order
```

**`webview-smoke.mjs`** loads the real `dist/webview.js` in headless Edge behind
the real `media/webview.html`, stubs `acquireVsCodeApi`, and asserts that an
`<svg>` appears in `#neomermaid-root`, that the preset's colours are present (and
the other preset's are not), that a toolbar pick and a `setState` both re-render,
and that PNG/SVG exports round-trip (PNG magic bytes, IHDR size, non-blank raster).

**`host-smoke.mjs`** loads `dist/extension.cjs` with a stub `vscode` module and
drives a full session without a browser: activation, the command surface, the
template's CSP nonce, the `ready` → `init` handshake (preset, catalog, source),
a debounced live update, the PNG write, the clipboard path and the unknown-preset
fallback.

### Comparing with the CLI

Same source, same preset, different surface:

```sh
printf 'flowchart LR\n  a["Alpha"] --> b["Beta"]\n' > /tmp/d.mmd
node packages/cli/bin/neomermaid.mjs render /tmp/d.mmd -o /tmp/cli.svg --preset neon/dracula
```

Rendered through the preview, the SVG matches the CLI's byte-for-byte after the
element id is normalised — identical `width`/`height`/`viewBox`, a byte-identical
theme stylesheet and the same colour set. The only difference between two *runs*
is mermaid's own randomised path jitter, which also differs between two CLI runs.

## Layout

```
src/extension.ts        activation, commands, status bar, export/clipboard
src/preview.ts          the webview panel: document lifecycle, messages, exports
src/config.ts           settings → PreviewState, preset resolution
src/protocol.ts         the shared host ⇄ webview message contract
src/webview/main.ts     the panel UI and the render loop (runs in the webview)
src/webview/png.ts      SVG → PNG rasterisation
media/                  webview template, stylesheet, icon
scripts/                headless smoke test
```
