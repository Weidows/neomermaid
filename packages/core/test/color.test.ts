import { describe, expect, it } from 'vitest';
import { contrastText, isDark, luminance, mix, parseColor, saturate, withAlpha } from '../src/color.js';

describe('color toolkit', () => {
  it('parses shorthand, longhand and functional notation', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor('#282a36')).toEqual({ r: 40, g: 42, b: 54, a: 1 });
    expect(parseColor('#00000080')!.a).toBeCloseTo(0.5, 1);
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(255,255,255,0.4)')!.a).toBeCloseTo(0.4, 2);
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('not-a-colour')).toBeNull();
    expect(parseColor('')).toBeNull();
  });

  it('applies alpha without losing the base colour', () => {
    expect(withAlpha('#8be9fd', 0.5)).toBe('rgba(139, 233, 253, 0.5)');
    expect(withAlpha('#8be9fd', 1)).toBe('#8be9fd');
    expect(withAlpha('nonsense', 0.5, 'fallback')).toBe('fallback');
  });

  it('mixes toward the target colour', () => {
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('bogus', '#ffffff', 0.5)).toBe('#ffffff');
  });

  it('judges luminance and picks readable text', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 2);
    expect(luminance('#000000')).toBe(0);
    expect(isDark('#282a36')).toBe(true);
    expect(isDark('#fdf6e3')).toBe(false);
    expect(contrastText('#282a36')).toBe('#ffffff');
    expect(contrastText('#fdf6e3')).toBe('#111418');
  });

  it('saturates around the greyscale axis', () => {
    const boosted = parseColor(saturate('#808080', 0))!;
    expect(boosted.r).toBeCloseTo(128, 0);
    const red = parseColor(saturate('#ff0000', 0.5))!;
    expect(red.r).toBe(255);
    expect(red.g).toBe(0);
  });
});
