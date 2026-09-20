/**
 * @neomermaid/core — themable Mermaid rendering.
 *
 * ```ts
 * import { render } from '@neomermaid/core';
 * const { svg } = await render('flowchart LR\n a --> b', { preset: 'neon/dracula' });
 * ```
 */

import { PALETTES } from './palettes.js';
import { THEMES } from './themes.js';

/* ------------------------------------------------------------------ runtime */

export {
  render,
  renderToElement,
  validate,
  RenderError,
  buildMermaidConfig,
  seriesPalette,
  readableSeries,
  sourceDirection,
  withDirection,
  sanitizeId,
} from './render.js';
export { postProcessSvg, wrapInHtml } from './svg.js';
export { asciiFromSvg, renderAscii, ASCII_FALLBACK_PREFIX } from './ascii.js';
export { buildStylesheet, buildHostStyles } from './styles.js';
export { resolveTheme, parsePreset, deepMerge, listThemes } from './theme.js';
export { PALETTES, PALETTE_IDS, getPalette, listPalettes, normalizePalette, isPalette } from './palettes.js';
export { THEMES, THEME_IDS, getTheme, defineTheme, asThemeDefinition } from './themes.js';
export { EXAMPLES, DEFAULT_EXAMPLE, getExample } from './examples.js';

export {
  parseColor,
  toHex,
  toRgbaString,
  withAlpha,
  mix,
  darken,
  lighten,
  luminance,
  isDark,
  contrastText,
  saturate,
  glowVariant,
} from './color.js';

export {
  contrastRatio,
  readOn,
  ensureContrast,
  readablePair,
  passesContrast,
  CONTRAST_LEVELS,
} from './contrast.js';

export type { ContrastLevel } from './contrast.js';

/* --------------------------------------------------------------------- types */

export type { Example } from './examples.js';
export type { AsciiOptions } from './ascii.js';
export type { ResolvedTheme } from './theme.js';
export type { SeriesColors, FlowDirection } from './render.js';
export type { StyleRefs, StyleContext } from './styles.js';
export type { PostProcessOptions, PostProcessResult, DomLike } from './svg.js';

export type {
  Appearance,
  ColorTokens,
  DeepPartial,
  EffectTokens,
  GeometryTokens,
  HueName,
  Hues,
  LayoutOptions,
  MermaidConfigLike,
  MermaidLike,
  Palette,
  PaletteRef,
  PaletteSummary,
  RenderOptions,
  RenderResult,
  StylingOverrides,
  ThemeDefinition,
  ThemeRef,
  ThemeSummary,
  ThemeTokens,
  TypographyTokens,
} from './types.js';

/* ------------------------------------------------------------------ helpers */

/** Every `theme/palette` combination — feeds galleries, docs and pickers. */
export function listPresets(): string[] {
  const out: string[] = [];
  for (const theme of Object.keys(THEMES)) {
    for (const palette of Object.keys(PALETTES)) {
      out.push(`${theme}/${palette}`);
    }
  }
  return out;
}
