/**
 * Configuration bridge: turns `neomermaid.*` settings into the `PreviewState`
 * the webview renders with, and knows how to follow the editor theme.
 *
 * The catalog comes straight from `@neomermaid/core`, so the pickers, the
 * validation here and the CLI all agree on the same 66 presets.
 */

import * as vscode from 'vscode';
import { listPalettes, listPresets, listThemes } from '@neomermaid/core';
import type { Appearance, Catalog, PreviewState } from './protocol.js';

export const SECTION = 'neomermaid';

export const DEFAULT_PRESET = 'minimal/github-light';
export const DARK_PRESET = 'neon/dracula';
export const LIGHT_PRESET = 'minimal/github-light';

const PRESETS: readonly string[] = listPresets();
const PALETTE_APPEARANCE = new Map(listPalettes().map((p) => [p.id, p.appearance] as const));

export function presetCatalog(): Catalog {
  return {
    themes: listThemes().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      appearance: t.appearance,
    })),
    palettes: listPalettes().map((p) => ({
      id: p.id,
      name: p.name,
      appearance: p.appearance,
      accent: p.accent,
      bg: p.bg,
    })),
    presets: [...PRESETS],
  };
}

export function isKnownPreset(preset: string | undefined): preset is string {
  return typeof preset === 'string' && PRESETS.includes(preset);
}

/** Split `neon/dracula` into its two halves, tolerating junk input. */
export function splitPreset(preset: string): { theme: string; palette: string } {
  const [theme = '', palette = ''] = preset.split('/');
  return { theme, palette };
}

export function joinPreset(theme: string, palette: string): string {
  return `${theme}/${palette}`;
}

/** The appearance a preset renders with — read from its palette. */
export function presetAppearance(preset: string): Appearance {
  const { palette } = splitPreset(preset);
  return PALETTE_APPEARANCE.get(palette) ?? 'dark';
}

export function themeKindAppearance(kind: vscode.ColorThemeKind): Appearance {
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark';
}

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

function pickPreset(
  configured: unknown,
  fallback: string,
): { preset: string; warning?: string } {
  if (isKnownPreset(typeof configured === 'string' ? configured : undefined)) {
    return { preset: configured as string };
  }
  if (configured === undefined || configured === '') return { preset: fallback };
  return {
    preset: fallback,
    warning: `Unknown preset "${String(configured)}" — falling back to ${fallback}. Pick one from the preview toolbar.`,
  };
}

/**
 * Resolve the preset a fresh preview should use. With `followEditorTheme` on,
 * the light/dark preset settings win over the fixed default, so a preview opened
 * in a light editor is light even if the user prefers neon/dracula for dark.
 */
export function configuredPreset(): { preset: string; warning?: string } {
  const cfg = configuration();
  if (cfg.get<boolean>('followEditorTheme', true)) {
    const light = themeKindAppearance(vscode.window.activeColorTheme.kind) === 'light';
    const key = light ? 'lightPreset' : 'darkPreset';
    const fallback = light ? LIGHT_PRESET : DARK_PRESET;
    return pickPreset(cfg.get(key), fallback);
  }
  return pickPreset(cfg.get('defaultPreset'), DEFAULT_PRESET);
}

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** The full state a preview panel starts from. */
export function configuredState(): { state: PreviewState; warning?: string } {
  const cfg = configuration();
  const resolved = configuredPreset();
  const background = cfg.get<string>('background', 'theme') || 'theme';
  return {
    warning: resolved.warning,
    state: {
      preset: resolved.preset,
      background,
      padding: numberSetting(cfg.get('padding'), 16, 0, 96),
      exportScale: numberSetting(cfg.get('exportScale'), 2, 1, 4),
      zoom: 1,
      fitToWidth: true,
    },
  };
}

export function liveUpdateDelay(): number {
  return numberSetting(configuration().get('liveUpdateDelay'), 250, 0, 2000);
}

export function setting<T>(key: string, fallback: T): T {
  return configuration().get<T>(key, fallback);
}

/** Persist a preset (and friends) so the next preview starts there. */
export async function saveDefault(
  values: { preset: string; background: string; padding: number },
): Promise<void> {
  const cfg = configuration();
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const light = presetAppearance(values.preset) === 'light';
  // Store into the slot the current theme mode actually reads from, otherwise
  // "Save default" would look like it did nothing.
  const key = cfg.get<boolean>('followEditorTheme', true)
    ? light
      ? 'lightPreset'
      : 'darkPreset'
    : 'defaultPreset';
  await cfg.update(key, values.preset, target);
  await cfg.update('background', values.background, target);
  await cfg.update('padding', values.padding, target);
}
