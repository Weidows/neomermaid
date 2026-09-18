import { describe, expect, it } from 'vitest';
import { deepMerge, listThemes, parsePreset, resolveTheme } from '../src/theme.js';
import { listPalettes } from '../src/palettes.js';
import { listPresets } from '../src/index.js';

describe('presets', () => {
  it('parses the shorthand forms', () => {
    expect(parsePreset('neon/dracula')).toEqual({ theme: 'neon', palette: 'dracula' });
    expect(parsePreset('neon:dracula')).toEqual({ theme: 'neon', palette: 'dracula' });
    expect(parsePreset('neon')).toEqual({ theme: 'neon' });
    expect(parsePreset('dracula')).toEqual({ palette: 'dracula' });
    expect(parsePreset('')).toEqual({});
  });

  it('resolves theme and palette from a preset string', () => {
    const resolved = resolveTheme({ preset: 'tech/tokyo-night' });
    expect(resolved.theme.id).toBe('tech');
    expect(resolved.palette.id).toBe('tokyo-night');
    expect(resolved.preset).toBe('tech/tokyo-night');
  });

  it('lets a preset win over loose theme/palette options', () => {
    const resolved = resolveTheme({ preset: 'tech/tokyo-night', palette: 'nord' });
    expect(resolved.theme.id).toBe('tech');
    expect(resolved.palette.id).toBe('tokyo-night');
  });

  it('exposes the full theme × palette matrix', () => {
    expect(listThemes().length).toBe(6);
    expect(listPalettes().length).toBe(11);
    expect(listPresets().length).toBe(66);
    expect(listPresets()).toContain('cartoon/solarized-light');
  });
});

describe('resolveTheme', () => {
  it('defaults to minimal + github-light', () => {
    const resolved = resolveTheme();
    expect(resolved.theme.id).toBe('minimal');
    expect(resolved.palette.id).toBe('github-light');
    expect(resolved.appearance).toBe('light');
  });

  it('reports a helpful error for an unknown theme', () => {
    expect(() => resolveTheme({ theme: 'nope' })).toThrowError(/Unknown theme "nope"/);
  });

  it('reports a helpful error for an unknown palette', () => {
    expect(() => resolveTheme({ palette: 'nope' })).toThrowError(/Unknown palette "nope"/);
  });

  it('follows the palette appearance, except for locked themes', () => {
    expect(resolveTheme({ theme: 'minimal', palette: 'dracula' }).appearance).toBe('dark');
    expect(resolveTheme({ theme: 'minimal', palette: 'github-light' }).appearance).toBe('light');
    // neon is dark-only by design.
    expect(resolveTheme({ theme: 'neon', palette: 'github-light' }).appearance).toBe('dark');
  });

  it('applies styling overrides last, without dropping the rest', () => {
    const resolved = resolveTheme({
      preset: 'minimal/dracula',
      styling: { geometry: { strokeWidth: 4 }, typography: { fontSize: 21 } },
    });
    expect(resolved.tokens.geometry.strokeWidth).toBe(4);
    expect(resolved.tokens.typography.fontSize).toBe(21);
    // Untouched tokens survive the merge.
    expect(resolved.tokens.geometry.nodeRadius).toBe(8);
    expect(resolved.tokens.typography.fontFamily).toContain('Inter');
  });

  it('accepts a fully custom palette object', () => {
    const resolved = resolveTheme({
      theme: 'minimal',
      palette: { id: 'custom', name: 'Custom', appearance: 'dark', bg: '#000000' } as never,
    });
    // Missing fields fall back to the base scheme instead of crashing.
    expect(resolved.palette.id).toBe('custom');
    expect(resolved.palette.hues.cyan).toBeTruthy();
  });

  it('accepts inline theme tokens', () => {
    const resolved = resolveTheme({ theme: { geometry: { nodeRadius: 30 } } });
    expect(resolved.tokens.geometry.nodeRadius).toBe(30);
    expect(resolved.tokens.colors.bg).toBeTruthy();
  });
});

describe('deepMerge', () => {
  it('merges nested objects and replaces primitives and arrays', () => {
    const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] };
    const merged = deepMerge(base, { nested: { y: 9 }, list: [3] } as never);
    expect(merged).toEqual({ a: 1, nested: { x: 1, y: 9 }, list: [3] });
    expect(base.nested.y).toBe(2);
  });

  it('ignores undefined values', () => {
    expect(deepMerge({ a: 1 }, { a: undefined } as never)).toEqual({ a: 1 });
  });
});
