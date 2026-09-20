import { normalizePalette } from './palettes.js';
import { asThemeDefinition, getTheme, THEME_IDS } from './themes.js';
import { CONTRAST_LEVELS, ensureContrast, type ContrastLevel } from './contrast.js';
import type {
  Appearance,
  DeepPartial,
  Palette,
  PaletteRef,
  RenderOptions,
  ThemeDefinition,
  ThemeRef,
  ThemeTokens,
  ThemeSummary,
} from './types.js';

export interface ResolvedTheme {
  theme: ThemeDefinition;
  palette: Palette;
  tokens: ThemeTokens;
  appearance: Appearance;
  /** `<theme>/<palette>` */
  preset: string;
  /**
   * True when the theme pins its own light/dark look and the chosen palette wants
   * the opposite — the palette's hues still apply, but its canvas does not.
   */
  appearancePinned: boolean;
}

export interface ResolvedPreset {
  theme?: string;
  palette?: string;
}

/** Parse `neon/dracula`, `neon:dracula`, `neon` or `dracula` shorthands. */
export function parsePreset(preset: string): ResolvedPreset {
  const raw = preset.trim();
  if (!raw) return {};
  const parts = raw.split(/[/@:]/).filter(Boolean);
  if (parts.length === 1) {
    const only = parts[0]!;
    if (getTheme(only)) return { theme: only };
    return { palette: only };
  }
  return { theme: parts[0], palette: parts[1] };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out as T;
}

/**
 * Turn loose render options into concrete theme tokens.
 * Order of application: palette → theme → preset → styling overrides.
 */
export function resolveTheme(options: RenderOptions = {}): ResolvedTheme {
  const fromPreset = options.preset ? parsePreset(options.preset) : {};

  const themeRef: ThemeRef | undefined = fromPreset.theme ?? options.theme;
  const paletteRef: PaletteRef | undefined = fromPreset.palette ?? options.palette;

  const theme: ThemeDefinition = themeRef === undefined ? getTheme('minimal')! : resolveThemeRef(themeRef);

  const palette = normalizePalette(paletteRef ?? 'github-light');

  const base = theme.derive(palette);
  const merged = deepMerge(base, options.styling as DeepPartial<ThemeTokens>);

  // Legibility is a guarantee, not a hope: theme authors pick colours by eye, so
  // every text token is measured against the surfaces it is painted on and nudged
  // along its luminance axis until it passes. `contrast: 'off'` opts out for
  // pixel-exact reproductions.
  const level: ContrastLevel = options.contrast ?? 'aa';
  const tokens = level === 'off' ? merged : enforceContrast(merged, level);

  const appearance: Appearance =
    theme.appearance && theme.appearance !== 'inherit' ? theme.appearance : palette.appearance;

  return {
    theme,
    palette,
    tokens,
    appearance,
    preset: `${theme.id}/${palette.id}`,
    appearancePinned: Boolean(
      theme.appearance && theme.appearance !== 'inherit' && theme.appearance !== palette.appearance,
    ),
  };
}

/**
 * Nudge every text token until it is legible on the surfaces it is painted on.
 * Connectors are treated as meaningful graphics (3:1), node borders only at the
 * stricter `aaa` level — a hairline border is decorative, a connector is not.
 */
function enforceContrast(tokens: ThemeTokens, level: Exclude<ContrastLevel, 'off'>): ThemeTokens {
  const limits = CONTRAST_LEVELS[level];
  const colors = { ...tokens.colors };
  const behind = colors.bg;
  const pass = (
    key: keyof typeof colors,
    surfaces: string[],
    min: number,
  ): void => {
    let value = colors[key];
    for (const surface of surfaces) {
      value = ensureContrast(value, surface, min, { behind: surface === colors.bg ? '#ffffff' : behind });
    }
    colors[key] = value;
  };

  const nodeSurfaces = [colors.nodeFill, colors.nodeFillAlt, colors.clusterFill, colors.bg];
  pass('nodeText', nodeSurfaces, limits.text);
  // `clusterText` is painted on the translucent cluster fill *and* on the canvas.
  pass('clusterText', [colors.clusterFill, colors.bg], limits.text);
  pass('edgeLabelText', [colors.edgeLabelBg, colors.bg], limits.text);
  pass('edge', [colors.bg], limits.graphic);
  if (level === 'aaa') pass('nodeStroke', [colors.bg], limits.graphic);

  return { ...tokens, colors };
}

export function listThemes(): ThemeSummary[] {
  return THEME_IDS.map((id) => {
    const t = getTheme(id)!;
    return { id: t.id, name: t.name, description: t.description, appearance: t.appearance ?? 'inherit' };
  });
}

/** Resolve a theme reference, throwing a helpful error for unknown ids. */
function resolveThemeRef(ref: ThemeRef): ThemeDefinition {
  const resolved = asThemeDefinition(ref);
  if (resolved) return resolved;
  throw new Error(`Unknown theme "${String(ref)}". Available themes: ${THEME_IDS.join(', ')}`);
}
