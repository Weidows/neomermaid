# Theming reference

A theme decides **shape, weight and mood**. A palette decides **colour**. Keeping
them apart is why 6 themes × 11 palettes give 66 genuinely different looks from
one code path — and why adding a palette never breaks a theme.

```ts
import { render, listThemes, listPalettes, listPresets, resolveTheme } from '@neomermaid/core';

await render(source, { theme: 'tech', palette: 'tokyo-night' });
await render(source, { preset: 'tech/tokyo-night' });   // same thing
await render(source, { theme: 'minimal', styling: { geometry: { strokeWidth: 3 } } });
```

Resolution order (last wins): **palette → theme → preset → `styling`**.

## Themes

| id | appearance | idea |
|---|---|---|
| `minimal` | palette | Hairline borders, soft corners, no decoration — document-grade |
| `neon` | dark | Saturated outlines, glowing edges, near-black canvas, animated dashes |
| `tech` | dark | Sharp corners, monospace, blueprint grid, uppercase labels |
| `cartoon` | light | Hand-drawn (rough.js) shapes, chunky ink, hard offset shadows |
| `glass` | dark | Translucent panels on a deep gradient, ambient shadows |
| `blueprint` | dark | Cyanotype canvas, ruled grid, thin precise strokes |

`listThemes()` returns `{ id, name, description, appearance }`. `appearance:
'inherit'` means the theme follows the palette's own light/dark setting.

## Palettes

`dracula`, `one-dark-pro`, `nord`, `gruvbox-dark`, `catppuccin-mocha`, `tokyo-night`,
`monokai`, `rose-pine`, `github-light`, `solarized-light`, `nord-light`.

A palette is plain data, so you can pass your own object — missing fields are
filled in from the base scheme:

```ts
await render(source, {
  theme: 'minimal',
  palette: {
    id: 'internal',
    name: 'Internal brand',
    appearance: 'dark',
    bg: '#0b1220',
    surface: '#131c2f',
    border: '#2b3a55',
    text: '#e6ecff',
    accent: '#5eead4',
    // surfaceAlt, textMuted, edge, edgeLabelBg, hues… all optional
  } as never,
});
```

## Tokens

Every token is optional in `styling`, and every one is also a CLI flag
(`docs/cli.md`) and a settings entry in the extension.

### `geometry`

| token | default (minimal) | meaning |
|---|---|---|
| `nodeRadius` | 8 | node corner radius, px (`0` = square) |
| `strokeWidth` | 1 | node border width, px |
| `edgeWidth` | 1.4 | connector width, px |
| `edgeDash` | `null` | dash pattern for **solid** edges, e.g. `'6 4'`; `-.->` keeps its own dash |
| `arrowScale` | 0.95 | multiplier on mermaid's arrowheads (box *and* anchor are scaled together) |
| `clusterRadius` | 10 | subgraph corner radius, px |
| `nodeShadow` | 0 | shadow/glow blur for nodes, px (`0` = off) |
| `nodeShadowY` | 0 | vertical offset; with `nodeShadow: 0` this becomes a hard comic shadow |
| `edgeGlow` | 0 | glow blur around connectors, px |

### `typography`

| token | meaning |
|---|---|
| `fontFamily` | CSS font stack — also fed to mermaid *before* layout, so labels never overflow |
| `fontSize` | base text size, px |
| `fontWeight` | base weight |
| `letterSpacing` | px |
| `textTransform` | `none` \| `uppercase` |
| `labelFontSize` | edge labels and subgraph titles |
| `titleWeight` | subgraph title weight |

### `effects`

| token | meaning |
|---|---|
| `nodeFill` | `flat` \| `gradient` \| `soft` (subtle top-light gradient) |
| `gradientAngle` | degrees, for node and canvas gradients |
| `background` | `solid` \| `gradient` \| `grid` \| `dots` \| `transparent` |
| `patternColor` / `patternSize` | grid/dot colour and spacing |
| `animatedEdges` | marching-ants animation on solid edges |
| `sketch` | hand-drawn shapes via mermaid's `handDrawn` look (and per-path colouring) |

### `colors`

`bg`, `nodeFill`, `nodeFillAlt`, `nodeStroke`, `nodeText`, `edge`, `edgeLabelBg`,
`edgeLabelText`, `clusterFill`, `clusterStroke`, `clusterText`, `accent`.

Any CSS colour works, including `rgba()` for translucent fills. `bg` is also used
to paint the halo behind edge-label pills, so a connector never shows through the
rounded corners.

## Writing a theme

```ts
import { defineTheme, type Palette, type ThemeTokens } from '@neomermaid/core';

export const midnight = defineTheme({
  id: 'midnight',
  name: 'Midnight',
  description: 'Deep navy, thin gold rules.',
  appearance: 'dark',
  derive: (p: Palette): ThemeTokens => ({ /* … */ }),
});
```

Notes:

- `derive` must be **pure** — same palette in, same tokens out. That keeps
  screenshots and exports reproducible.
- Return every token group; the simplest way is to start from an existing theme
  and override (`import { THEMES } from '@neomermaid/core'` then spread
  `THEMES.minimal!.derive(p)`).
- Themes are just objects, so they work in the CLI too: register one with
  `defineTheme` in your own script and call the SDK directly, or export SVG/PNG
  through the programmatic API (`Pilot` from `@neomermaid/cli`).
- `styling` on `render()` is applied *after* the theme, so per-render tweaks
  never require a new theme.

## Recipes

**Pixel-stable docs** (no shadows, no animation, light or dark via palette):

```ts
{ theme: 'minimal', background: 'transparent', styling: { geometry: { edgeWidth: 1.5 } } }
```

**Print / PDF**: `theme: 'minimal'`, `background: 'theme'` with `solarized-light`,
`typography: { fontSize: 13 }`.

**Dark-mode site**: `<picture>` with two renders, or `background: 'transparent'`
plus CSS `color-scheme` on the container.

**Locked-down brand**: one custom theme + one palette, `listPresets()` unused.
