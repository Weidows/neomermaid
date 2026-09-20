import { describe, expect, it } from 'vitest';
import { isShikiTheme, paletteFromShiki } from '../src/shiki.js';
import { contrastRatio } from '../src/contrast.js';
import { resolveTheme } from '../src/theme.js';

/** Real values from the GitHub Dark theme (Primer). */
const GITHUB_DARK = {
  name: 'GitHub Dark',
  type: 'dark' as const,
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#e6edf3',
    'editorLineNumber.foreground': '#6e7681',
    'panel.border': '#30363d',
    'editorWidget.background': '#161b22',
    'button.background': '#2f81f7',
    'focusBorder': '#2f81f7',
  },
  tokenColors: [
    { scope: 'keyword', settings: { foreground: '#ff7b72' } },
    { scope: ['string', 'string.quoted'], settings: { foreground: '#a5d6ff' } },
    { scope: 'entity.name.function', settings: { foreground: '#d2a8ff' } },
    { scope: 'constant.numeric', settings: { foreground: '#79c0ff' } },
    { scope: 'support.type', settings: { foreground: '#ffa657' } },
    { scope: 'variable.other', settings: { foreground: '#7ee787' } },
    { scope: 'entity.name.tag', settings: { foreground: '#7ee787' } },
  ],
};

/** Real values from Catppuccin Latte. */
const LATTE = {
  name: 'Catppuccin Latte',
  type: 'light' as const,
  colors: {
    'editor.background': '#eff1f5',
    'editor.foreground': '#4c4f69',
    'editorLineNumber.foreground': '#8c8fa1',
    'panel.border': '#bcc0cc',
    'editorWidget.background': '#e6e9ef',
    'button.background': '#1e66f5',
  },
  tokenColors: [
    { scope: 'keyword', settings: { foreground: '#8839ef' } },
    { scope: 'string', settings: { foreground: '#40a02b' } },
    { scope: 'constant.numeric', settings: { foreground: '#fe640b' } },
    { scope: 'entity.name.function', settings: { foreground: '#1e66f5' } },
  ],
};

const RULES = [
  ['text / surface', 7, (p: ReturnType<typeof paletteFromShiki>) => [p.text, p.surface] as const],
  ['text / bg', 7, (p: ReturnType<typeof paletteFromShiki>) => [p.text, p.bg] as const],
  ['muted / surface', 4.5, (p: ReturnType<typeof paletteFromShiki>) => [p.textMuted, p.surface] as const],
  ['edge / bg', 3, (p: ReturnType<typeof paletteFromShiki>) => [p.edge, p.bg] as const],
] as const;

describe('isShikiTheme', () => {
  it('accepts real theme shapes', () => {
    expect(isShikiTheme(GITHUB_DARK)).toBe(true);
    expect(isShikiTheme(LATTE)).toBe(true);
    expect(isShikiTheme({ type: 'dark', tokenColors: [] })).toBe(true);
  });

  it('rejects things that are not themes', () => {
    for (const value of [null, undefined, 'dracula', 42, [], {}, { colors: {} }, { colors: { 'editor.fontSize': 12 } }]) {
      expect(isShikiTheme(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('paletteFromShiki', () => {
  it('reads the two colours every theme declares', () => {
    const palette = paletteFromShiki(GITHUB_DARK);
    expect(palette.bg).toBe('#0d1117');
    expect(palette.text).toBe('#e6edf3');
    expect(palette.appearance).toBe('dark');
    expect(palette.id).toBe('github-dark-theme'.replace('-theme', '')); // slug of the name
    expect(palette.surface).toBe('#161b22');
  });

  it('detects a light theme and keeps it light', () => {
    const palette = paletteFromShiki(LATTE);
    expect(palette.appearance).toBe('light');
    expect(contrastRatio(palette.text, palette.bg, palette.bg)).toBeGreaterThan(7);
  });

  it('harvests the hue ramp from syntax colours', () => {
    const palette = paletteFromShiki(GITHUB_DARK);
    // `keyword` -> red slot, `constant.numeric` -> yellow slot: real theme colours,
    // adjusted only as far as legibility requires.
    expect(palette.hues.red).toBe('#ff7b72');
    expect(palette.hues.yellow).toBe('#79c0ff');
    expect(new Set(Object.values(palette.hues)).size).toBeGreaterThanOrEqual(6);
  });

  it.each([
    ['GitHub Dark', GITHUB_DARK],
    ['Catppuccin Latte', LATTE],
  ])('produces a palette for %s that passes the built-in contrast contract', (_name, theme) => {
    const palette = paletteFromShiki(theme);
    for (const [label, min, pick] of RULES) {
      const [foreground, background] = pick(palette);
      const ratio = contrastRatio(foreground, background, palette.bg);
      expect(Math.round(ratio * 100) / 100, `${label} measured ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    }
    // Every hue has to be legible as text on the node surface.
    for (const [slot, colour] of Object.entries(palette.hues)) {
      expect(contrastRatio(colour, palette.surface, palette.bg), `hue ${slot}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('repairs an accent that would be invisible, instead of shipping it', () => {
    const palette = paletteFromShiki({ type: 'dark', colors: { 'editor.background': '#101014', 'editor.foreground': '#e8e8f0', 'button.background': '#14141a' } });
    expect(contrastRatio(palette.accent, palette.surface, palette.bg)).toBeGreaterThanOrEqual(3);
  });

  it('falls back sensibly for a theme that declares almost nothing', () => {
    const palette = paletteFromShiki({ colors: { 'editor.background': '#0b1020' } });
    expect(palette.appearance).toBe('dark');
    expect(palette.text).not.toBe('');
    expect(contrastRatio(palette.text, palette.bg, palette.bg)).toBeGreaterThanOrEqual(7);
    expect(Object.values(palette.hues).every((hue) => typeof hue === 'string' && hue.startsWith('#'))).toBe(true);
  });

  it('drops into the normal render path as `palette`', () => {
    const palette = paletteFromShiki(LATTE);
    const { tokens, appearance } = resolveTheme({ theme: 'minimal', palette });
    expect(appearance).toBe('light');
    expect(tokens.colors.nodeText).toBeDefined();
    expect(contrastRatio(tokens.colors.nodeText, tokens.colors.nodeFill, tokens.colors.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
