# Contributing

Thanks for helping make mermaid diagrams not look like 2018. This file is short on
ceremony and long on the things that actually bite.

## Setup

```bash
git clone https://github.com/Weidows/neomermaid && cd neomermaid
npm install          # npm workspaces; Node >= 20
npm run build        # core (ESM + browser bundle) and CLI
npm test             # 44 unit tests, no browser needed
npm run demo         # the playground on http://localhost:5173
```

Everything is npm workspaces:

```
packages/core    @neomermaid/core    theme engine, palettes, SVG style layer (browser/ESM)
packages/cli     @neomermaid/cli     headless-browser renderer + commands
packages/vscode  neomermaid-vscode   preview webview, export, settings
apps/demo        live playground     Vite + TS, published to GitHub Pages
```

## Ground rules

1. **Never reimplement mermaid's parsing or layout.** Compatibility is the whole
   point of this project: if a diagram works in mermaid, it must work here.
2. **Colour belongs to palettes, shape/weight/mood belongs to themes.** A theme is
   a pure function of a palette — no exceptions, or screenshots stop being
   reproducible.
3. **Tokens are the API.** If something is visually noticeable and cannot be
   expressed as a token, it probably should not exist.
4. **No new runtime dependencies without a very good reason.** The core must stay
   loadable inside a VS Code webview; the CLI must not download a browser.

## The four mermaid-12 quirks you will hit

These cost real debugging time. Every one of them has a regression test in
`packages/core/test/`.

1. **Inline edge animation.** Mermaid writes
   `style="stroke-dasharray: 0 0 <len> 4; stroke-dashoffset: 0"` on every edge,
   and inline styles beat our stylesheet — so theme dashes and marching-ants
   motion would silently never apply. `stripInlineEdgeAnimation()` removes them,
   while leaving `@{ animation: fast }` edges alone (their class rules use
   `!important`).
2. **Edge labels are measured with mermaid's font.** Add padding or change the
   weight and the text is pushed outside the `foreignObject` viewport and becomes
   invisible. `fitEdgeLabels()` re-measures with `canvas.measureText()` and grows
   the box, re-centring the label group at `-w/2,-h/2`.
3. **SVG filter regions come from the bounding box.** A perfectly horizontal edge
   has a zero-height box, so `filter: url(#glow)` renders *nothing* and the edge
   disappears. All shadows and glows are therefore CSS `drop-shadow()`.
4. **`look: handDrawn` emits a hatch path.** Rough.js draws the fill as dozens of
   short strokes in one path plus sparse outline paths. Painting them all with the
   ink colour turns a node into a black blob; `fillSketchShapes()` colours each
   path by its role and sets attributes (the stylesheet must not repaint
   `.rough-node path`).

## Adding a theme

`packages/core/src/themes.ts` — copy an existing definition and change the tokens.
Then:

- add a unit test in `packages/core/test/theme.test.ts` if you introduced new
  behaviour (not just new numbers),
- bump the theme count expectations (`listThemes().length` and the preset count in
  `theme.test.ts`),
- regenerate the docs image: `node scripts/render-docs.mjs`.

## Adding a palette

`packages/core/src/palettes.ts`. Use real values from the upstream scheme, keep
`appearance` honest, and fill every `hues` slot — themes pick from those. Then
update the counts in `packages/core/test/theme.test.ts`
(`listPalettes().length`, `listPresets().length`) and the palette list in
`README.md` / `docs/theming.md`.

## Tests

- Unit tests (`vitest`, jsdom) cover tokens, stylesheet generation, SVG
  post-processing and the colour toolkit. They must not need a browser.
- Anything that needs real layout uses the CLI or a smoke script:
  `node scripts/render-docs.mjs` renders the README images end to end, and
  `packages/vscode/scripts/webview-smoke.mjs` / `apps/demo/scripts/smoke.mjs`
  drive the real bundles in headless Chromium.
- If you fix a rendering bug, add a fixture-based test that fails before the fix.
  `packages/core/test/fixtures/mermaid-flowchart.svg` is a trimmed real capture.

## Before opening a PR

```bash
npm run typecheck
npm test
npm run build
node scripts/render-docs.mjs   # if you touched anything visual
```

Look at the images it writes to `docs/images/` — if a diagram regressed, you will
see it there. That is the review that matters most in this repo.
