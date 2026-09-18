import { normalizePalette } from './palettes.js';
import { asThemeDefinition, getTheme, THEME_IDS } from './themes.js';
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
  const tokens = deepMerge(base, options.styling as DeepPartial<ThemeTokens>);

  const appearance: Appearance =
    theme.appearance && theme.appearance !== 'inherit' ? theme.appearance : palette.appearance;

  return {
    theme,
    palette,
    tokens,
    appearance,
    preset: `${theme.id}/${palette.id}`,
  };
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
