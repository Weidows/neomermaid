import { describe, expect, it } from 'vitest';
import { buildMermaidConfig, seriesPalette } from '../src/render.js';
import { resolveTheme } from '../src/theme.js';
import { THEMES } from '../src/themes.js';
import { PALETTES } from '../src/palettes.js';

interface Vars {
  [key: string]: string;
}

function vars(options: Parameters<typeof buildMermaidConfig>[0]): Vars {
  return buildMermaidConfig(options).themeVariables as Vars;
}

describe('seriesPalette', () => {
  it('produces distinct colours for every slot', () => {
    const series = seriesPalette(PALETTES['dracula']!, 12);
    expect(series).toHaveLength(12);
    expect(new Set(series).size).toBe(12);
  });

  it('starts from the palette hues', () => {
    const series = seriesPalette(PALETTES['dracula']!, 8);
    expect(series[0]).toBe(PALETTES['dracula']!.hues.blue);
    expect(series[1]).toBe(PALETTES['dracula']!.hues.cyan);
    expect(series[7]).toBe(PALETTES['dracula']!.hues.pink);
  });

  it('separates slots even when a scheme reuses a hue (Nord, Monokai)', () => {
    // Those schemes genuinely have fewer accents than slots, so the ramp nudges
    // duplicates apart instead of emitting identical slices.
    for (const id of ['nord', 'monokai', 'rose-pine']) {
      const series = seriesPalette(PALETTES[id]!, 12);
      expect(new Set(series).size, `${id} repeats a series colour`).toBe(12);
    }
  });

  it('never repeats a colour between neighbours after the first pass', () => {
    const series = seriesPalette(PALETTES['github-light']!, 16);
    expect(new Set(series).size).toBe(16);
  });
});

describe('buildMermaidConfig', () => {
  it('gives pie charts real slice colours', () => {
    const themeVariables = vars({ preset: 'neon/dracula' });
    const slices = Array.from({ length: 12 }, (_, i) => themeVariables[`pie${i + 1}`]);
    expect(slices.every((c) => typeof c === 'string' && c.startsWith('#'))).toBe(true);
    expect(new Set(slices).size).toBe(12);
  });

  it('keeps every multi-series family on the palette', () => {
    const themeVariables = vars({ preset: 'tech/tokyo-night' });
    for (const i of [0, 3, 7]) {
      expect(themeVariables[`cScale${i}`]).toMatch(/^#|^rgb/);
      expect(themeVariables[`git${i}`]).toMatch(/^#|^rgb/);
      expect(themeVariables[`cScaleLabel${i}`]).toMatch(/^#|^rgb/);
    }
    for (const key of ['quadrant1Fill', 'quadrant2Fill', 'quadrant3Fill', 'quadrant4Fill']) {
      expect(themeVariables[key]).toBeTruthy();
    }
  });

  it('configures typography before layout so text is measured correctly', () => {
    const resolved = resolveTheme({ preset: 'cartoon/solarized-light' });
    const config = buildMermaidConfig({ preset: 'cartoon/solarized-light' });
    expect(config.fontFamily).toBe(resolved.tokens.typography.fontFamily);
    expect(config.fontSize).toBe(`${resolved.tokens.typography.fontSize}px`);
    const themeVariables = config.themeVariables as Vars;
    expect(themeVariables.fontFamily).toBe(resolved.tokens.typography.fontFamily);
    expect(themeVariables.fontSize).toBe(`${resolved.tokens.typography.fontSize}px`);
  });

  it('asks mermaid for intrinsic sizes and hand-drawn shapes when the theme does', () => {
    const plain = buildMermaidConfig({ preset: 'minimal/github-light' }) as Record<string, Vars>;
    expect(plain.flowchart!.useMaxWidth).toBe(false);
    expect(plain.look).toBeUndefined();

    const sketch = buildMermaidConfig({ preset: 'cartoon/dracula' }) as Record<string, Vars>;
    expect(sketch.look).toBe('handDrawn');
  });

  it('keeps classDef styles working (loose security by default, overridable)', () => {
    expect(buildMermaidConfig({}).securityLevel).toBe('loose');
    expect(buildMermaidConfig({ mermaid: { securityLevel: 'strict' } }).securityLevel).toBe('strict');
  });

  it('lets raw mermaid config win over the derived defaults', () => {
    const config = buildMermaidConfig({
      preset: 'minimal/github-light',
      mermaid: { flowchart: { curve: 'linear' }, themeVariables: { pie1: '#ff0000' } },
    }) as Record<string, Vars>;
    expect(config.flowchart!.curve).toBe('linear');
    expect(config.themeVariables!.pie1).toBe('#ff0000');
  });

  it('produces a distinct series ramp for every shipped preset', () => {
    for (const themeId of Object.keys(THEMES)) {
      for (const paletteId of Object.keys(PALETTES)) {
        const themeVariables = vars({ preset: `${themeId}/${paletteId}` });
        const slices = Array.from({ length: 12 }, (_, i) => themeVariables[`pie${i + 1}`]);
        expect(slices.every(Boolean), `${themeId}/${paletteId} has empty pie slots`).toBe(true);
        expect(new Set(slices).size, `${themeId}/${paletteId} repeats a pie colour`).toBe(slices.length);
      }
    }
  });
});
