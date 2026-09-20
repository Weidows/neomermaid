import { isDark, mix, parseColor, toRgbaString, type Rgba } from './color.js';

/**
 * Contrast maths and legibility guarantees.
 *
 * The rule this module exists to enforce: **a colour pair must be measurable, not
 * guessed**. Every previous "this theme looks washed out" bug came from picking a
 * foreground and a background independently and hoping they worked together, so
 * anything that paints text now goes through `readablePair()` / `readOn()` /
 * `ensureReadable()` instead of `contrastText()`.
 *
 * Ratios follow WCAG 2.1: 4.5:1 for body text, 3:1 for large text and for
 * meaningful graphics (connectors, borders that carry meaning).
 */

/** WCAG thresholds, keyed by the `contrast` render option. */
export const CONTRAST_LEVELS = {
  aa: { text: 4.5, large: 3, graphic: 3 },
  aaa: { text: 7, large: 4.5, graphic: 3 },
  off: { text: 0, large: 0, graphic: 0 },
} as const;

export type ContrastLevel = keyof typeof CONTRAST_LEVELS;

/** Dark and light label candidates, in preference order for light surfaces first. */
const INK = '#111418';
const PAPER = '#ffffff';

/** Composite `colour` over `behind` — the only honest way to measure translucent fills. */
export function flatten(colour: string, behind: string): Rgba {
  const top = parseColor(colour);
  const bottom = parseColor(behind) ?? { r: 255, g: 255, b: 255, a: 1 };
  if (!top) return bottom;
  if (top.a >= 1) return { ...top, a: 1 };
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  };
}

function relativeLuminance(c: Rgba): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/**
 * WCAG contrast ratio between two colours, compositing translucent values onto
 * `behind` (the page/canvas) first so stacked glass surfaces measure correctly.
 */
export function contrastRatio(foreground: string, background: string, behind = PAPER): number {
  const stack = flatten(behind, PAPER);
  const surface = flatten(background, toRgbaString(stack));
  const text = flatten(foreground, toRgbaString(surface));
  const a = relativeLuminance(text);
  const b = relativeLuminance(surface);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The most readable of the candidate label colours on `background`.
 * Unlike `contrastText()` this compares ratios instead of trusting a luminance
 * threshold near the black/white crossover, where both choices are ~4.5:1 and
 * the wrong pick is immediately visible.
 */
export function readOn(
  background: string,
  options: { candidates?: string[]; behind?: string; preferred?: string } = {},
): string {
  const behind = options.behind ?? PAPER;
  const candidates = options.candidates ?? [INK, PAPER];
  let best = candidates[0] ?? INK;
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, background, behind);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  // `preferred` wins ties so a theme can keep its typographic character.
  if (options.preferred) {
    const preferredRatio = contrastRatio(options.preferred, background, behind);
    if (preferredRatio >= bestRatio - 0.25) return options.preferred;
  }
  return best;
}

/**
 * Nudge `colour` toward black or white until it reaches `min` against `surface`.
 * Returns the original colour when it is already legible, so untouched themes
 * keep their exact intended values.
 */
export function ensureContrast(
  colour: string,
  surface: string,
  min = 4.5,
  options: { behind?: string } = {},
): string {
  if (min <= 0) return colour;
  const behind = options.behind ?? PAPER;
  if (contrastRatio(colour, surface, behind) >= min) return colour;
  // Move away from the surface: a light label darkens a light surface's label…
  const direction = isDark(surface) ? PAPER : INK;
  let lo = 0;
  let hi = 1;
  let out = colour;
  for (let i = 0; i < 12; i += 1) {
    const t = (lo + hi) / 2;
    const candidate = mix(colour, direction, t);
    if (contrastRatio(candidate, surface, behind) >= min) {
      out = candidate;
      hi = t;
    } else {
      lo = t;
    }
  }
  if (contrastRatio(out, surface, behind) < min) {
    // Even full travel failed (a mid-tone surface can cap both directions):
    // fall back to whichever pole is measurably better.
    return readOn(surface, { candidates: [INK, PAPER], behind });
  }
  return out;
}

/**
 * A series colour plus the label colour that is guaranteed readable on it.
 *
 * When neither black nor white reaches `min` on the original fill (mid-tones such
 * as `#6272a4` sit right at the boundary), the *fill* is nudged along the
 * luminance axis instead — keeping its hue, so a pie/git/timeline palette still
 * looks like the palette. `adjustment` records how far it had to move.
 */
export function readablePair(
  fill: string,
  options: { min?: number; behind?: string; maxAdjust?: number } = {},
): { fill: string; label: string; ratio: number; adjustment: number } {
  const min = options.min ?? CONTRAST_LEVELS.aa.text;
  const behind = options.behind ?? PAPER;
  const maxAdjust = options.maxAdjust ?? 0.4;
  const label = readOn(fill, { candidates: [INK, PAPER], behind });
  const ratio = contrastRatio(label, fill, behind);
  if (ratio >= min) return { fill, label, ratio, adjustment: 0 };

  // Walk the fill away from the label in small steps; stop at the first pass so
  // the colour stays as close to the palette's intent as possible.
  const target = label === PAPER ? '#000000' : '#ffffff';
  for (let step = 1; step <= 20; step += 1) {
    const t = (step / 20) * maxAdjust;
    const candidate = mix(fill, target, t);
    const candidateRatio = contrastRatio(label, candidate, behind);
    if (candidateRatio >= min) {
      return { fill: candidate, label, ratio: candidateRatio, adjustment: Math.round(t * 100) / 100 };
    }
  }
  // Cap reached: give the caller the best available pair rather than a wrong one.
  const fallbackFill = mix(fill, target, maxAdjust);
  const fallbackLabel = readOn(fallbackFill, { candidates: [INK, PAPER], behind });
  return {
    fill: fallbackFill,
    label: fallbackLabel,
    ratio: contrastRatio(fallbackLabel, fallbackFill, behind),
    adjustment: maxAdjust,
  };
}

/** True when the pair already passes — used by tests and the legibility audit. */
export function passesContrast(foreground: string, background: string, min = 4.5, behind = PAPER): boolean {
  return contrastRatio(foreground, background, behind) >= min;
}
