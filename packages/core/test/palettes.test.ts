import { describe, expect, it } from 'vitest';
import { PALETTES } from '../src/palettes.js';
import { contrastRatio } from '../src/contrast.js';

/**
 * The palette contract.
 *
 * A palette is not just a bag of hex codes: text has to be readable on the surface
 * it sits on, connectors have to be visible on the canvas, and muted text still has
 * to be legible. These thresholds are asserted for EVERY palette, by looping over
 * the object, so a new scheme cannot land without meeting them.
 *
 * Where a scheme's authentic values conflict with legibility the *surface*, the
 * connector or a few percent of the body colour moves — never the brand hue. Each
 * such nudge is noted in `palettes.ts`.
 */
const RULES: Array<{ label: string; min: number; of: (p: (typeof PALETTES)[string]) => [string, string] }> = [
  { label: 'body text on a node surface', min: 7, of: (p) => [p.text, p.surface] },
  { label: 'body text on the canvas', min: 7, of: (p) => [p.text, p.bg] },
  { label: 'muted text on a node surface', min: 4.5, of: (p) => [p.textMuted, p.surface] },
  // Connectors carry meaning, so they get the WCAG non-text bar (3:1) — the same
  // bar the render-time guard enforces, so `contrast: 'off'` output stays readable.
  { label: 'connector on the canvas', min: 3, of: (p) => [p.edge, p.bg] },
  // Borders are decorative: the fill defines the shape. Authentic dark themes use
  // hairlines that measure ~1.3, so the bar is "present but quiet", not 3:1.
  { label: 'border on a node surface', min: 1.25, of: (p) => [p.border, p.surface] },
];

describe('palette contract', () => {
  it('ships a light and a dark variant for the schemes people switch between', () => {
    const pairs = [
      ['tokyo-night', 'tokyo-night-light'],
      ['catppuccin-mocha', 'catppuccin-latte'],
      ['github-dark', 'github-light'],
      ['solarized-dark', 'solarized-light'],
      ['one-dark-pro', 'one-light'],
      ['rose-pine', 'rose-pine-dawn'],
      ['zinc-dark', 'zinc-light'],
      ['gruvbox-dark', 'gruvbox-light'],
      ['nord', 'nord-light'],
    ];
    expect(Object.keys(PALETTES).length).toBeGreaterThanOrEqual(18);
    for (const [dark, light] of pairs) {
      expect(PALETTES[dark!], `${dark} missing`).toBeDefined();
      expect(PALETTES[light!], `${light} missing`).toBeDefined();
      expect(PALETTES[dark!]!.appearance).toBe('dark');
      expect(PALETTES[light!]!.appearance).toBe('light');
    }
  });

  for (const [id, palette] of Object.entries(PALETTES)) {
    describe(id, () => {
      it('declares the fields a renderer needs', () => {
        for (const field of ['id', 'name', 'appearance', 'bg', 'surface', 'border', 'text', 'textMuted', 'accent', 'edge'] as const) {
          expect(String(palette[field] ?? '').trim(), `${id}.${field}`).not.toBe('');
        }
        expect(Object.keys(palette.hues).sort()).toEqual(
          ['blue', 'cyan', 'green', 'orange', 'pink', 'purple', 'red', 'yellow'].sort(),
        );
      });

      for (const rule of RULES) {
        it(`keeps ${rule.label} at ${rule.min}:1 or better`, () => {
          const [foreground, background] = rule.of(palette);
          const ratio = contrastRatio(foreground, background, palette.bg);
          expect(
            Math.round(ratio * 100) / 100,
            `${id}: ${foreground} on ${background} measured ${ratio.toFixed(2)}:1 (needs ${rule.min})`,
          ).toBeGreaterThanOrEqual(rule.min);
        });
      }

      it('keeps the four identity colours distinct', () => {
        const unique = new Set([palette.bg, palette.surface, palette.text, palette.accent]);
        expect(unique.size).toBe(4);
      });
    });
  }
});
