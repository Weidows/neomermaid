/**
 * Public type surface of the SDK. Everything a host (VS Code extension, CLI,
 * demo page, or your own app) can configure lives here.
 */

export type Appearance = 'light' | 'dark';

import type { ContrastLevel } from './contrast.js';
export type { ContrastLevel } from './contrast.js';

/**
 * Layout habits, not syntax: how the diagram is arranged, spaced and broken into
 * lines. These map onto mermaid's own layout knobs, so the source stays vanilla
 * mermaid — nothing here requires a new keyword.
 */
export interface LayoutOptions {
  /**
   * `auto` (default) keeps the direction written in the source, and only picks a
   * better one when the source does not state it. `TB`/`TD`/`BT`/`LR`/`RL` forces
   * one. An explicit direction in the source always wins over `auto`.
   */
  direction?: 'auto' | 'TB' | 'TD' | 'BT' | 'LR' | 'RL';
  /** Gap between sibling nodes in px (mermaid default 45). */
  nodeSpacing?: number;
  /** Gap between ranks in px (mermaid default 45). */
  rankSpacing?: number;
  /** Label line-breaking width in px; 0 disables wrapping (mermaid default 200). */
  wrappingWidth?: number;
  /** Connector shape: `basis` (default), `linear`, `step`, `cardinal`, `monotone`. */
  curve?: string;
  /** Canvas padding in px added on top of `padding` (mermaid default 8). */
  diagramPadding?: number;
  /**
   * When `direction: 'auto'` and the source states no direction, a first attempt
   * wider or taller than this ratio is re-rendered in the other direction and the
   * better of the two is kept. Default 3.2.
   */
  maxAspect?: number;
}

/** Semantic hues. A theme decides which ones it actually uses. */
export interface Hues {
  blue: string;
  cyan: string;
  green: string;
  yellow: string;
  orange: string;
  red: string;
  purple: string;
  pink: string;
}

export type HueName = keyof Hues;

/** A named colour scheme. Palettes carry colour only — never shape. */
export interface Palette {
  id: string;
  name: string;
  appearance: Appearance;
  /** Canvas background. */
  bg: string;
  /** Optional multi-stop background (used when a theme enables gradients). */
  bgGradient?: string[];
  /** Primary node/card fill. */
  surface: string;
  /** Secondary fill (alternating rows, subgraphs, actor boxes…). */
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  /** Signature colour of the scheme. */
  accent: string;
  /** Connector colour. */
  edge: string;
  /** Edge-label pill background. */
  edgeLabelBg: string;
  hues: Hues;
}

export interface GeometryTokens {
  /** Node corner radius in px (0 = sharp). */
  nodeRadius: number;
  /** Node / shape border width in px. */
  strokeWidth: number;
  /** Connector stroke width in px. */
  edgeWidth: number;
  /** SVG dash pattern for connectors, e.g. `6 4`; `null` = solid. */
  edgeDash: string | null;
  /** Multiplier applied to mermaid's arrowheads. */
  arrowScale: number;
  /** Subgraph corner radius in px. */
  clusterRadius: number;
  /** Node drop-shadow blur in px (0 = off). */
  nodeShadow: number;
  /** Node drop-shadow vertical offset in px. */
  nodeShadowY: number;
  /** Glow blur applied to connectors in px (0 = off). */
  edgeGlow: number;
}

export interface TypographyTokens {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  textTransform: 'none' | 'uppercase';
  /** Font size for edge labels and subgraph titles. */
  labelFontSize: number;
  /** Weight used for subgraph titles. */
  titleWeight: number;
}

export interface EffectTokens {
  /** Node fill treatment. */
  nodeFill: 'flat' | 'gradient' | 'soft';
  /** Gradient angle in degrees (used by `gradient`). */
  gradientAngle: number;
  background: 'solid' | 'gradient' | 'grid' | 'dots' | 'transparent';
  patternColor: string;
  patternSize: number;
  /** Marching-ants animation on connectors. */
  animatedEdges: boolean;
  /** Hand-drawn (rough.js) shapes via mermaid's `handDrawn` look. */
  sketch: boolean;
}

export interface ColorTokens {
  bg: string;
  nodeFill: string;
  nodeFillAlt: string;
  nodeStroke: string;
  nodeText: string;
  edge: string;
  edgeLabelBg: string;
  edgeLabelText: string;
  clusterFill: string;
  clusterStroke: string;
  clusterText: string;
  accent: string;
}

/** Fully resolved look of a single render. */
export interface ThemeTokens {
  colors: ColorTokens;
  geometry: GeometryTokens;
  typography: TypographyTokens;
  effects: EffectTokens;
}

/** A theme turns a palette into tokens. Register your own with `defineTheme`. */
export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  /** `inherit` follows the palette's own appearance. */
  appearance?: Appearance | 'inherit';
  derive(palette: Palette): ThemeTokens;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type ThemeRef = string | ThemeDefinition | DeepPartial<ThemeTokens>;
export type PaletteRef = string | Palette;

export interface StylingOverrides extends DeepPartial<ThemeTokens> {}

/** Escape hatch: raw mermaid config (flowchart curve, spacing, securityLevel…). */
export type MermaidConfigLike = Record<string, unknown>;

export interface RenderOptions {
  /** Theme id, a `defineTheme(...)` definition, or partial tokens. */
  theme?: ThemeRef;
  /** Palette id or a custom `Palette`. */
  palette?: PaletteRef;
  /** Shorthand `<theme>/<palette>` — wins over `theme`/`palette`. */
  preset?: string;
  /** `transparent` keeps the canvas see-through, `theme` uses the palette bg. */
  background?: string;
  /** Canvas padding in px. */
  padding?: number;
  /** Device pixel ratio hint for raster exports (used by the CLI). */
  scale?: number;
  /** Fine-grained token tweaks applied last. */
  styling?: StylingOverrides;
  /** Overrides the mermaid instance (useful for tests or a pre-initialised one). */
  mermaidInstance?: MermaidLike;
  /** Raw mermaid config merged over ours. */
  mermaid?: MermaidConfigLike;
  /** Extra CSS appended to the generated stylesheet. */
  extraCss?: string;
  /**
   * Legibility guarantee for text/connector colours: `aa` (WCAG 4.5:1, default),
   * `aaa` (7:1), or `off` for pixel-exact reproductions.
   */
  contrast?: ContrastLevel;
  /** Arrangement and spacing — how the diagram is laid out, not how it is painted. */
  layout?: LayoutOptions;
  /** SVG id / css scope. Auto-generated when omitted. */
  id?: string;
}

export interface RenderResult {
  /** Standalone SVG document as a string. */
  svg: string;
  width: number;
  height: number;
  theme: string;
  palette: string;
  preset: string;
  appearance: Appearance;
  /** Resolved canvas colour, `transparent` when the canvas is see-through. */
  background: string;
  warnings: string[];
  /** Flowchart direction actually used (`auto` may re-aim an unstated one). */
  direction?: string;
}

export interface ThemeSummary {
  id: string;
  name: string;
  description: string;
  appearance: Appearance | 'inherit';
}

export interface PaletteSummary {
  id: string;
  name: string;
  appearance: Appearance;
  accent: string;
  bg: string;
}

/** Minimal structural type for a mermaid instance, so we never hard-depend on it. */
export interface MermaidLike {
  initialize(config: MermaidConfigLike): void;
  render(id: string, source: string): Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
  parse?(source: string): Promise<boolean> | boolean;
}
