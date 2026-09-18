# SDK API

```bash
npm install @neomermaid/core
```

`@neomermaid/core` runs in a **browser-like** environment: a VS Code webview, an
Electron renderer, a web page, or a headless page driven by `@neomermaid/cli`.
It needs a DOM and a `mermaid` instance.

## render

```ts
import { render } from '@neomermaid/core';

const result = await render(source, options?);
```

| field | type | notes |
|---|---|---|
| `svg` | `string` | standalone SVG document, namespaced, ready for `innerHTML` or a file |
| `width` / `height` | `number` | intrinsic size in CSS px, including padding |
| `theme` / `palette` / `preset` | `string` | what was actually resolved |
| `appearance` | `'light' \| 'dark'` | follow this for page chrome |
| `background` | `string` | resolved canvas colour, or `'transparent'` |
| `warnings` | `string[]` | non-fatal notes (e.g. unparseable SVG fallback) |

Throws `RenderError` (with `.cause` and the offending `.source`) when mermaid
rejects the diagram or no DOM is available.

### Options

| option | type | default | notes |
|---|---|---|---|
| `theme` | `string \| ThemeDefinition \| Partial<ThemeTokens>` | `minimal` | id, `defineTheme(...)` result, or inline tokens |
| `palette` | `string \| Palette` | `github-light` | id or a custom palette object |
| `preset` | `string` | — | `<theme>/<palette>`, wins over the two above |
| `background` | `string` | `'theme'` | `'theme'` \| `'transparent'` \| any CSS colour |
| `padding` | `number` | `16` | canvas padding, px |
| `scale` | `number` | — | raster hint; the CLI uses it, SVG output ignores it |
| `styling` | `DeepPartial<ThemeTokens>` | — | applied last (see `theming.md`) |
| `mermaid` | `Record<string, unknown>` | — | raw mermaid config, merged last |
| `mermaidInstance` | `MermaidLike` | — | bring your own instance |
| `extraCss` | `string` | — | appended to the generated stylesheet |
| `id` | `string` | generated | SVG id / CSS scope; must be unique per page |

### Mermaid instance resolution

In order: `options.mermaidInstance` → a global `mermaid` (or `mermaid.default`) →
`await import('mermaid')`. Bundling `@neomermaid/core` with your app pulls mermaid
in automatically; that is how the extension and the demo work.

## Other exports

```ts
renderToElement(container, source, options)  // render + inject + make it responsive
validate(source, options)                    // [] when the syntax is fine, else [message]
buildMermaidConfig(options)                  // inspect the mermaid config we generate
postProcessSvg({ svg, id, tokens, … })       // restyle an SVG you already have
wrapInHtml(svg, tokens, title)               // standalone HTML page
buildStylesheet({ id, tokens, refs, paintsBackground })
pillPadding(tokens)                          // edge-label padding used by both above

THEMES, THEME_IDS, getTheme, defineTheme, asThemeDefinition
PALETTES, PALETTE_IDS, getPalette, listPalettes, normalizePalette, isPalette
listThemes(), listPalettes(), listPresets(), resolveTheme(options), parsePreset(s), deepMerge
EXAMPLES, DEFAULT_EXAMPLE, getExample(id)
parseColor, toHex, toRgbaString, withAlpha, mix, darken, lighten, luminance, isDark,
contrastText, saturate, glowVariant
```

Types: `ThemeTokens`, `ThemeDefinition`, `Palette`, `RenderOptions`, `RenderResult`,
`GeometryTokens`, `TypographyTokens`, `EffectTokens`, `ColorTokens`, `MermaidLike`, …

## Browser bundle

Each release ships `dist/browser.js` — an IIFE that exposes everything as
`window.NeoMermaid`, with mermaid inlined. That is what the CLI injects into a
headless page, and what you want for a `<script>` tag with no build step:

```html
<script src="https://unpkg.com/@neomermaid/core/dist/browser.js"></script>
<script type="module">
  const { svg } = await NeoMermaid.render('flowchart LR\n A-->B', { preset: 'neon/dracula' });
  document.body.innerHTML = svg;
</script>
```

## Rendering many diagrams

`render()` serialises internally (mermaid's config is module-global), so
`Promise.all` over a list is safe — but each call carries mermaid's render cost.
For bulk work, render a whole page and reuse one instance.

## Gotchas worth knowing

- **Fonts must exist on the machine.** Themes reference font families by name
  only; there is no font download. Pick stacks that are commonly installed
  (`Inter, Segoe UI, …`, `JetBrains Mono, Consolas, monospace`).
- **`classDef` wins over the theme** — that is intentional: the author's inline
  styles are applied as attributes and make them the highest priority.
- **Layout is mermaid's.** Changing a font size changes measured text and
  therefore node sizes; that is handled by feeding typography into mermaid before
  layout rather than by scaling the finished SVG.
- **Unique `id`s.** Pass `id` when you render several diagrams into one document;
  the stylesheet and injected defs are scoped by it.
