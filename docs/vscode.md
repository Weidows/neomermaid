# VS Code extension

Replaces the dated official preview with the NeoMermaid renderer — same syntax,
themes, palettes and real exports.

## Install

```bash
# from a checkout
npm run build:vscode
code --install-extension packages/vscode/neomermaid-vscode-0.1.0.vsix

# or `npm run build:vscode && code --extensionDevelopmentPath=<repo>/packages/vscode`
```

## Use

Open a file with the `mermaid` language id (`.mmd`, `.mermaid`) and:

| action | how |
|---|---|
| Open preview | `NeoMermaid: Open Preview` in the command palette |
| Open preview to the side | <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>, or the preview icon in the editor title bar |
| Change theme / palette | the two pickers in the preview toolbar |
| Switch diagram | pick any of the 10 built-in examples from the toolbar |
| Export PNG / SVG | toolbar, or `NeoMermaid: Export as PNG` / `… as SVG` (save dialog) |
| Copy SVG | `NeoMermaid: Copy SVG to Clipboard` |
| Reset to settings default | `Reset` in the toolbar |

The preview updates as you type (250 ms debounce by default) and remembers the
theme you picked for the session.

## Settings

| setting | default | meaning |
|---|---|---|
| `neomermaid.defaultPreset` | `minimal/github-light` | preset used when a preview opens |
| `neomermaid.followEditorTheme` | `true` | pick a light or dark preset from the active VS Code theme |
| `neomermaid.background` | `theme` | `theme` \| `transparent` \| any CSS colour |
| `neomermaid.padding` | `16` | canvas padding in px |
| `neomermaid.exportScale` | `2` | raster scale for PNG export |
| `neomermaid.liveUpdateDelay` | `250` | debounce before re-render, ms |

Example `settings.json`:

```json
{
  "neomermaid.defaultPreset": "neon/dracula",
  "neomermaid.followEditorTheme": false,
  "neomermaid.exportScale": 3
}
```

## Notes

- Rendering happens in the webview with the same `@neomermaid/core` the CLI uses,
  so a preview and a CLI export of the same file with the same preset are
  byte-comparable.
- PNG export rasterises the SVG in the webview (offscreen canvas) — no extra
  process, and it respects `neomermaid.exportScale`.
- The extension uses mermaid's `securityLevel: 'loose'` like the official preview,
  so `classDef` styles and rich labels work. Previewing diagrams from untrusted
  sources is therefore equivalent to the official extension; do not open
  untrusted `.mmd` files with either.
- Markdown code fences are not touched: this extension owns the `.mmd`/`.mermaid`
  preview, and leaves VS Code's built-in markdown preview alone.
