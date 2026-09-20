import { mix } from './color.js';
import { CONTRAST_LEVELS, contrastRatio, ensureContrast, readOn } from './contrast.js';
import type { Hues, Palette } from './types.js';

/**
 * Import a VS Code / Shiki theme as a NeoMermaid palette.
 *
 * Editor themes are the biggest source of colours developers already trust (Shiki
 * alone ships hundreds), so instead of hand-porting each one we read the two colours
 * a theme always declares — `editor.background` and `editor.foreground` — plus its
 * syntax colours for the hue ramp, and derive the rest.
 *
 * Two promises hold for the result:
 *  1. it is a normal `Palette`, usable anywhere a built-in one is (`palette:`/`preset`);
 *  2. it passes the same contrast contract the built-in palettes are tested against,
 *     because every derived slot goes through the measured `ensureContrast()` rather
 *     than a guess.
 */

export interface ShikiThemeLike {
  name?: string;
  /** Shiki calls it `type`, VS Code calls it `uiTheme`. */
  type?: 'light' | 'dark';
  uiTheme?: string;
  colors?: Record<string, string>;
  tokenColors?: unknown[];
  semanticTokenColors?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True for anything shaped like a Shiki/VS Code theme (tolerant on purpose). */
export function isShikiTheme(value: unknown): value is ShikiThemeLike {
  if (!isRecord(value)) return false;
  if (isRecord(value.colors) && Object.keys(value.colors).length > 0) {
    return typeof value.colors['editor.background'] === 'string' || typeof value.colors['editor.foreground'] === 'string';
  }
  return (value.type === 'light' || value.type === 'dark') && Array.isArray(value.tokenColors);
}

/** Keys we accept for each slot, in priority order. */
const KEYS = {
  bg: ['editor.background', 'editorGroup.background', 'sideBar.background'],
  text: ['editor.foreground', 'foreground'],
  muted: ['editorLineNumber.foreground', 'descriptionForeground', 'editorLineNumber.activeForeground', 'tab.inactiveForeground'],
  border: ['panel.border', 'editorWidget.border', 'input.border', 'contrastBorder', 'sideBar.border', 'editorGroup.border'],
  surface: ['editorWidget.background', 'sideBar.background', 'editorGroupHeader.tabsBackground', 'panel.background'],
  accent: ['button.background', 'focusBorder', 'textLink.foreground', 'activityBarBadge.background', 'progressBar.background'],
  edge: ['editorIndentGuide.background', 'editorLineNumber.foreground', 'panel.border'],
} as const;

const HUE_SLOTS: Array<{ slot: keyof Hues; match: RegExp; fallback: 'shift' | 'darken' }> = [
  { slot: 'blue', match: /function|method|blue|support\.function/i, fallback: 'shift' },
  { slot: 'cyan', match: /type|class|namespace|cyan|support\.class/i, fallback: 'shift' },
  { slot: 'green', match: /string|green|support\.constant/i, fallback: 'shift' },
  { slot: 'yellow', match: /number|constant|regexp|yellow|literal/i, fallback: 'shift' },
  { slot: 'orange', match: /parameter|attribute|orange|property/i, fallback: 'shift' },
  { slot: 'red', match: /keyword|operator|invalid|red|storage|control/i, fallback: 'shift' },
  { slot: 'purple', match: /variable|purple|entity\.name\.type|annotation/i, fallback: 'shift' },
  { slot: 'pink', match: /pink|magenta|tag|escape/i, fallback: 'shift' },
];

interface TokenColour {
  scope: string;
  colour: string;
}

/** Pull `scope -> foreground` pairs out of `tokenColors` (string or array scopes). */
function harvestTokenColours(theme: ShikiThemeLike): TokenColour[] {
  const out: TokenColour[] = [];
  for (const entry of theme.tokenColors ?? []) {
    if (!isRecord(entry)) continue;
    const settings = isRecord(entry.settings) ? entry.settings : undefined;
    const colour = typeof entry.foreground === 'string' ? entry.foreground : typeof settings?.foreground === 'string' ? settings.foreground : undefined;
    if (!colour) continue;
    const scope = entry.scope;
    const names = Array.isArray(scope) ? scope.filter((s): s is string => typeof s === 'string') : typeof scope === 'string' ? [scope] : [];
    for (const name of names) out.push({ scope: name, colour });
  }
  return out;
}

/** First string we find among `keys`, or undefined. */
function pick(colors: Record<string, string> | undefined, keys: readonly string[]): string | undefined {
  if (!colors) return undefined;
  for (const key of keys) {
    const value = colors[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Nudge a colour until it clears `min` on *every* surface it can land on. A theme's
 * `editor.background` and its widget background differ, and text that passes on one
 * can still fail on the other — the first cut of this importer shipped a Catppuccin
 * Latte palette with 6.57:1 body text for exactly that reason.
 */
function visible(colour: string, surfaces: string | string[], min: number): string {
  let value = colour;
  for (const surface of Array.isArray(surfaces) ? surfaces : [surfaces]) {
    value = ensureContrast(value, surface, min, { behind: surface });
  }
  return value;
}

/**
 * Turn a Shiki/VS Code theme into a palette.
 *
 * Missing keys fall back to values derived from the two colours a theme always has,
 * so a minimal theme (`{ colors: { 'editor.background': '#000' } }`) still produces a
 * usable, legible palette instead of throwing.
 */
export function paletteFromShiki(theme: ShikiThemeLike, options: { id?: string; name?: string } = {}): Palette {
  const raw = theme.colors;
  const declared = theme.type ?? (theme.uiTheme === 'vs' || theme.uiTheme === 'vs-dark' ? (theme.uiTheme === 'vs' ? 'light' : 'dark') : undefined);
  const bg = pick(raw, KEYS.bg) ?? (declared === 'light' ? '#ffffff' : '#111418');
  const isLight = declared ? declared === 'light' : contrastRatio('#ffffff', bg, bg) < 2;
  const surface = pick(raw, KEYS.surface) ?? mix(bg, isLight ? '#000000' : '#ffffff', 0.08);
  const surfaceAlt = mix(surface, isLight ? '#000000' : '#ffffff', 0.06);
  // Body text carries the AAA bar (the same one the palette contract asserts); the
  // `aa` threshold is for secondary text and graphics.
  const text = visible(pick(raw, KEYS.text) ?? (isLight ? '#111418' : '#e9edf5'), [bg, surface], CONTRAST_LEVELS.aaa.text);
  const accentRaw = pick(raw, KEYS.accent) ?? (isLight ? '#2563eb' : '#7aa2f7');
  const accent = visible(accentRaw, [surface, bg], CONTRAST_LEVELS.aa.graphic);
  const muted = visible(pick(raw, KEYS.muted) ?? mix(text, surface, 0.4), [surface, bg], CONTRAST_LEVELS.aa.text);
  const border = pick(raw, KEYS.border) ?? mix(surface, text, 0.18);
  const edge = visible(pick(raw, KEYS.edge) ?? border, bg, CONTRAST_LEVELS.aa.graphic);

  // Hue ramp: syntax colours matched to our semantic slots, then filled in from the
  // accent so every slot is a real, distinct colour.
  const harvested = harvestTokenColours(theme);
  const hues = {} as Hues;
  const used = new Set<string>();
  HUE_SLOTS.forEach((rule, index) => {
    const hit = harvested.find((entry) => rule.match.test(entry.scope) && !used.has(entry.colour));
    let colour = hit?.colour;
    if (!colour) {
      // Derive: walk the accent around the wheel-ish by mixing toward black/white.
      const shifted = index % 2 === 0 ? mix(accent, isLight ? '#000000' : '#ffffff', 0.18 + (index / HUE_SLOTS.length) * 0.4) : mix(accent, isLight ? '#ffffff' : '#000000', 0.15 + (index / HUE_SLOTS.length) * 0.4);
      colour = shifted;
    }
    const readable = visible(colour, surface, CONTRAST_LEVELS.aa.text);
    hues[rule.slot] = used.has(readable) ? mix(readable, isLight ? '#000000' : '#ffffff', 0.12) : readable;
    used.add(hues[rule.slot]);
  });

  const id = options.id ?? slug(theme.name ?? 'shiki-theme');
  return {
    id,
    name: options.name ?? theme.name ?? id,
    appearance: isLight ? 'light' : 'dark',
    bg,
    surface,
    surfaceAlt,
    border,
    text,
    textMuted: muted,
    accent,
    edge,
    edgeLabelBg: surface,
    hues,
  };
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'shiki-theme';
}

/** Convenience: the label colour a theme import would use on its own canvas. */
export function shikiLabelColour(palette: Palette): string {
  return readOn(palette.surface, { behind: palette.bg });
}
