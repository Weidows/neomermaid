# @neomermaid/core

**Themable Mermaid rendering — same syntax, none of the 2018 styling.**

Mermaid owns the parsing and the layout; this package owns everything visual. Your
diagrams keep working everywhere else, they just stop looking like a wiki from 2018.

- **6 themes × 20 palettes = 120 looks** — cartoon, neon, tech, glass, blueprint, minimal,
  paired with Dracula, One Dark Pro, Catppuccin (mocha + latte), Tokyo Night (+ light),
  GitHub (light + dark), Solarized (light + dark), Nord (+ light), Gruvbox (dark + light),
  Rosé Pine (+ dawn), Zinc (light + dark), Monokai, One Light
- **Legibility is measured, not guessed** — body text is checked against the surfaces it
  is painted on with the WCAG formula and nudged until it passes
- **Your editor theme is a palette** — `paletteFromShiki()` turns any VS Code / Shiki theme
  into a NeoMermaid palette
- **Layout habits without new syntax** — spacing, curvature, label wrapping, and an
  automatic direction choice for flowcharts whose source states none
- **ASCII output** — project a rendered diagram into Unicode box drawing for terminals and
  agents, with zero DOM dependencies

## Install

```bash
npm install @neomermaid/core
# mermaid is a peer dependency
npm install mermaid
```

## Quick start

`render()` needs a DOM (browser, webview, or a headless page):

```ts
import { render } from '@neomermaid/core';

const { svg, width, height, warnings } = await render('flowchart LR\n  a[Write] --> b[Ship]', {
  preset: 'tech/dracula',
});

document.querySelector('#stage')!.innerHTML = svg;
```

In Node, use [`@neomermaid/cli`](https://www.npmjs.com/package/@neomermaid/cli) — it drives a
headless browser for you (it reuses an installed Chrome/Edge, nothing to download):

```bash
npx @neomermaid/cli render diagram.mmd -o diagram.png --preset neon/dracula
```

## Theming

A **palette** owns colour, a **theme** owns shape, mood and effects. Any combination works:

```ts
await render(src, { preset: 'glass/one-dark-pro' });
await render(src, { theme: 'cartoon', palette: 'solarized-light' });
```

Four themes pin their own light/dark look (`neon`, `tech`, `glass`, `blueprint` are dark by
design, `cartoon` is light) — pairing one with a palette of the other appearance keeps the
palette's hues but not its canvas, and the render says so in `warnings`. `minimal` inherits
whatever the palette wants.

### Bring your own editor theme

```ts
import { paletteFromShiki, render } from '@neomermaid/core';
import githubDark from 'shiki/themes/github-dark.mjs';

const palette = paletteFromShiki(githubDark.default);
await render(src, { preset: 'tech', palette });
```

The import is not a colour dump: body text is nudged to 7:1 and connectors to 3:1 against
every surface they can land on, and an accent that would be invisible is repaired instead of
shipped. `isShikiTheme(value)` validates a parsed theme JSON first.

### Legibility guarantee

```ts
await render(src, { preset: 'neon/dracula' });                   // aa  (4.5:1, default)
await render(src, { preset: 'neon/dracula', contrast: 'aaa' });  // 7:1
await render(src, { preset: 'neon/dracula', contrast: 'off' });  // pixel-exact, no nudging
```

### Layout

```ts
await render(src, {
  layout: {
    direction: 'auto',   // respects the source; re-aims an unstated one if it reads badly
    nodeSpacing: 45,
    rankSpacing: 45,
    wrappingWidth: 200,
    curve: 'basis',
    maxAspect: 3.2,
  },
});
```

## Reading a diagram as text

```ts
import { renderAscii } from '@neomermaid/core';

console.log(await renderAscii('flowchart LR\n a[A] --> b{B?} -- yes --> c[C]', {
  preset: 'neon/dracula',
  maxWidth: 100,
}));
```

`asciiFromSvg(svg, options)` does the same from an SVG you already have, and works in plain
Node — no DOM, no browser.

## API surface

`render` · `renderToElement` · `validate` · `postProcessSvg` · `buildStylesheet` ·
`resolveTheme` · `listThemes` · `listPalettes` · `listPresets` · `paletteFromShiki` ·
`isShikiTheme` · `readableSeries` · `contrastRatio` · `readOn` · `ensureContrast` ·
`readablePair` · `asciiFromSvg` · `renderAscii` · `EXAMPLES` · `PALETTES` · `THEMES`

## Links

- **Repository & docs** — https://github.com/Weidows/neomermaid
- [Theming](https://github.com/Weidows/neomermaid/blob/main/docs/theming.md) ·
  [Layout](https://github.com/Weidows/neomermaid/blob/main/docs/layout.md) ·
  [Contrast](https://github.com/Weidows/neomermaid/blob/main/docs/contrast.md) ·
  [SDK](https://github.com/Weidows/neomermaid/blob/main/docs/api.md)
- **Live demo** — https://blog.weidows.tech/neomermaid/
- **VS Code extension** — NeoMermaid (live preview, theme picker, export to PNG/SVG)

## License

MIT
