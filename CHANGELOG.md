# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Legibility guarantee** (`contrast: 'aa' | 'aaa' | 'off'`, default `aa`): every
  text token is measured against the surfaces it is painted on and nudged until it
  meets the WCAG threshold, so no theme × palette pair can produce unreadable text.
- **Measured series labels**: git branch pills, timeline bands and pie slices get a
  label colour computed from the fill a reader actually sees, and pie percentages
  are repainted from the slice they sit on. Fixes white-on-cyan branch labels that
  measured **1.01:1** (invisible).
- **`layout` options** — `direction`, `nodeSpacing`, `rankSpacing`,
  `wrappingWidth`, `curve`, `diagramPadding`, `maxAspect`. `direction: 'auto'`
  re-aims a flowchart whose source states no direction when the first attempt is
  more extreme than `maxAspect` (3.5:1-wide → 696×832 instead of 1544×438) and
  reports why in `warnings`.
- **`scripts/audit-legibility.mjs`** (`npm run audit:legibility`): rasterises every
  preset, measures each text element against the pixels behind it and exits
  non-zero on failure — the regression net for the bug above.
- New examples covering the families the audit was blind to: timeline, quadrant,
  user journey, git graph and XY chart.
- CLI: `--direction`, `--node-spacing`, `--rank-spacing`, `--wrap`, `--max-aspect`,
  `--contrast`, plus `direction` in the `--json` payload.
- **ASCII / Unicode projection** (`asciiFromSvg`, `renderAscii`, `neomermaid ascii`):
  diagrams an agent or a terminal can read without an image — flowcharts with
  subgraphs and edge labels, sequence diagrams with lifelines and numbered messages,
  plus a labelled text fallback for the other families. Zero DOM dependencies, so it
  works in plain Node.`,1

## [0.1.0] — unreleased

First public version. Everything below is new.

### Added

- **`@neomermaid/core`** — themable mermaid rendering for browsers and webviews.
  Mermaid keeps parsing and layout; NeoMermaid owns style: canvas, background
  patterns, gradients, CSS-filter glows and shadows, corner radii, arrow scaling,
  per-path colouring of hand-drawn shapes, and a generated stylesheet per render.
- **6 themes** — `minimal`, `neon`, `tech`, `cartoon`, `glass`, `blueprint`.
- **11 palettes** — Dracula, One Dark Pro, Nord, Gruvbox Dark, Catppuccin Mocha,
  Tokyo Night, Monokai, Rosé Pine, GitHub Light, Solarized Light, Nord Light.
  Themes × palettes = 66 presets, addressed as `theme/palette`.
- **Full token surface** — `geometry` (radii, stroke/edge widths, dash, arrow
  scale, shadow/glow), `typography` (family, size, weight, spacing, transform),
  `effects` (fill style, canvas style, patterns, animation, sketch) and `colors`,
  each overridable per render via `styling`, and `--flags` on the CLI.
- **Custom themes** — `defineTheme()` plus `Palette` objects, so a brand look is
  data, not a fork.
- **`@neomermaid/cli`** — `render` (SVG/PNG/PDF/HTML, stdin, `--json` contract),
  `gallery`, `themes`/`palettes`/`presets`, `examples`, `doctor`. Uses the Chrome,
  Edge, Brave or Chromium already installed; never downloads a browser.
- **VS Code extension** — live preview beside `.mmd`/`.mermaid` files, theme and
  palette pickers, example picker, export PNG/SVG, copy SVG, editor-theme
  following, sensible settings.
- **Live playground** — browser demo with the example corpus, theme/palette
  switching, token controls, side-by-side stock-mermaid comparison and exports.
- **Examples** — 10 diagrams covering flowcharts (subgraphs, classDef), sequence,
  state, class, ER, gantt, pie, mindmap and decision trees.
- **Docs** — README with honest stock-vs-themed comparisons, `docs/theming.md`,
  `docs/cli.md`, `docs/api.md`, `docs/vscode.md`, plus CI and release workflows.

### Fixed (disabled-by-default traps from upstream behaviour)

These are mermaid 12 behaviours that would otherwise silently break theming, all
covered by regression tests:

- mermaid's inline per-edge `stroke-dasharray` is stripped so theme dashes and
  animated edges apply; `@{ animation: … }` edges are left alone.
- Edge labels are re-measured with the theme's font and their `foreignObject` is
  grown, otherwise restyled labels render as text clipped outside the viewport.
- Glows and shadows use CSS `drop-shadow()` rather than SVG filters, because a
  horizontal edge has a zero-height bounding box and `filter: url(#…)` would render
  nothing at all.
- `look: handDrawn` nodes are coloured path by path: the dense hatch path is the
  fill, not an outline.

[0.1.0]: https://github.com/Weidows/neomermaid/releases/tag/v0.1.0
