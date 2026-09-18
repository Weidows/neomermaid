import type { Palette, ThemeDefinition, ThemeTokens } from './types.js';

/**
 * Built-in themes. A theme owns *shape, weight and mood*; a palette owns colour.
 * Every theme is a pure function of the palette, which is why 6 themes × 12
 * palettes gives you 72 genuinely different looks with one code path.
 */

const SANS =
  '"Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
const MONO =
  '"JetBrains Mono", "SF Mono", "Cascadia Code", "Fira Code", Consolas, "Liberation Mono", monospace';
const ROUND =
  '"Nunito", "Quicksand", "Varela Round", "Segoe UI", "Trebuchet MS", system-ui, sans-serif';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", serif';

function tokens(t: ThemeTokens): ThemeTokens {
  return t;
}

/** Dark canvas even for light palettes — neon needs the contrast to exist at all. */
function darkCanvas(p: Palette): string {
  return p.appearance === 'dark' ? p.bg : '#0d0f16';
}

/* ------------------------------------------------------------------ minimal */

const minimal: ThemeDefinition = {
  id: 'minimal',
  name: 'Minimal',
  description:
    'Quiet, document-grade styling. Hairline borders, soft corners, no decoration — the diagram gets out of the way.',
  appearance: 'inherit',
  derive: (p) =>
    tokens({
      colors: {
        bg: p.bg,
        nodeFill: p.surface,
        nodeFillAlt: p.surfaceAlt,
        nodeStroke: p.border,
        nodeText: p.text,
        edge: p.edge,
        edgeLabelBg: p.edgeLabelBg,
        edgeLabelText: p.textMuted,
        clusterFill: p.surfaceAlt,
        clusterStroke: p.border,
        clusterText: p.textMuted,
        accent: p.accent,
      },
      geometry: {
        nodeRadius: 8,
        strokeWidth: 1,
        edgeWidth: 1.4,
        edgeDash: null,
        arrowScale: 0.95,
        clusterRadius: 10,
        nodeShadow: 0,
        nodeShadowY: 0,
        edgeGlow: 0,
      },
      typography: {
        fontFamily: SANS,
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: 0,
        textTransform: 'none',
        labelFontSize: 13,
        titleWeight: 600,
      },
      effects: {
        nodeFill: 'flat',
        gradientAngle: 180,
        background: 'transparent',
        patternColor: p.border,
        patternSize: 24,
        animatedEdges: false,
        sketch: false,
      },
    }),
};

/* --------------------------------------------------------------------- neon */

const neon: ThemeDefinition = {
  id: 'neon',
  name: 'Neon',
  description:
    'Cyberpunk signage. Glowing connectors, saturated outlines on a near-black canvas, optional marching-ants flow.',
  appearance: 'dark',
  derive: (p) => {
    const canvas = darkCanvas(p);
    return tokens({
      colors: {
        bg: canvas,
        nodeFill: 'rgba(12, 14, 24, 0.82)',
        nodeFillAlt: 'rgba(20, 22, 38, 0.85)',
        nodeStroke: p.hues.cyan,
        nodeText: '#f2f6ff',
        edge: p.hues.pink,
        edgeLabelBg: 'rgba(10, 12, 22, 0.9)',
        edgeLabelText: p.hues.cyan,
        clusterFill: 'rgba(12, 14, 24, 0.55)',
        clusterStroke: p.hues.purple,
        clusterText: p.hues.cyan,
        accent: p.hues.cyan,
      },
      geometry: {
        nodeRadius: 12,
        strokeWidth: 1.8,
        edgeWidth: 2,
        edgeDash: '6 5',
        arrowScale: 1.15,
        clusterRadius: 14,
        nodeShadow: 10,
        nodeShadowY: 0,
        edgeGlow: 6,
      },
      typography: {
        fontFamily: MONO,
        fontSize: 14,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: 'none',
        labelFontSize: 12,
        titleWeight: 700,
      },
      effects: {
        nodeFill: 'soft',
        gradientAngle: 160,
        background: 'gradient',
        patternColor: p.hues.purple,
        patternSize: 32,
        animatedEdges: true,
        sketch: false,
      },
    });
  },
};

/* --------------------------------------------------------------------- tech */

const tech: ThemeDefinition = {
  id: 'tech',
  name: 'Tech',
  description:
    'Engineering schematic. Sharp corners, monospace labels, blueprint grid, accent rail on every node — reads like a system diagram, not a mind map.',
  appearance: 'dark',
  derive: (p) => {
    const canvas = p.appearance === 'dark' ? canvasFrom(p.bg, 0.45) : '#0b1220';
    return tokens({
      colors: {
        bg: canvas,
        nodeFill: p.appearance === 'dark' ? canvasFrom(p.surface, 0.35) : '#111a2b',
        nodeFillAlt: p.appearance === 'dark' ? canvasFrom(p.surfaceAlt, 0.3) : '#16213a',
        nodeStroke: p.hues.cyan,
        nodeText: '#eaf2ff',
        edge: p.hues.blue,
        edgeLabelBg: '#0f172a',
        edgeLabelText: p.hues.cyan,
        clusterFill: 'rgba(15, 23, 42, 0.55)',
        clusterStroke: 'rgba(94, 234, 212, 0.45)',
        clusterText: p.hues.cyan,
        accent: p.hues.cyan,
      },
      geometry: {
        nodeRadius: 2,
        strokeWidth: 1.2,
        edgeWidth: 1.5,
        edgeDash: null,
        arrowScale: 1,
        clusterRadius: 3,
        nodeShadow: 0,
        nodeShadowY: 0,
        edgeGlow: 0,
      },
      typography: {
        fontFamily: MONO,
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        labelFontSize: 11,
        titleWeight: 600,
      },
      effects: {
        nodeFill: 'flat',
        gradientAngle: 180,
        background: 'grid',
        patternColor: 'rgba(94, 234, 212, 0.12)',
        patternSize: 28,
        animatedEdges: false,
        sketch: false,
      },
    });
  },
};

/* ------------------------------------------------------------------ cartoon */

const cartoon: ThemeDefinition = {
  id: 'cartoon',
  name: 'Cartoon',
  description:
    'Hand-drawn marker doodle. Wobbly rough.js shapes, chunky outlines, hard offset shadows and candy colours.',
  appearance: 'light',
  derive: (p) => {
    const ink = '#2b2b33';
    return tokens({
      colors: {
        bg: p.appearance === 'light' ? p.bg : '#fffaf0',
        nodeFill: p.appearance === 'light' ? p.surface : '#ffe9c9',
        nodeFillAlt: p.appearance === 'light' ? p.surfaceAlt : '#ffe0b5',
        nodeStroke: ink,
        nodeText: p.appearance === 'light' ? p.text : ink,
        edge: ink,
        edgeLabelBg: '#fffaf0',
        edgeLabelText: ink,
        clusterFill: 'rgba(255, 255, 255, 0.55)',
        clusterStroke: ink,
        clusterText: ink,
        accent: p.hues.orange,
      },
      geometry: {
        nodeRadius: 16,
        strokeWidth: 2.6,
        edgeWidth: 2.6,
        edgeDash: null,
        arrowScale: 1.3,
        clusterRadius: 18,
        nodeShadow: 0,
        nodeShadowY: 4,
        edgeGlow: 0,
      },
      typography: {
        fontFamily: ROUND,
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: 0,
        textTransform: 'none',
        labelFontSize: 13,
        titleWeight: 800,
      },
      effects: {
        nodeFill: 'flat',
        gradientAngle: 180,
        background: 'dots',
        patternColor: 'rgba(43, 43, 51, 0.1)',
        patternSize: 22,
        animatedEdges: false,
        sketch: true,
      },
    });
  },
};

/* --------------------------------------------------------------------- glass */

const glass: ThemeDefinition = {
  id: 'glass',
  name: 'Glass',
  description:
    'Frosted panels over a deep gradient. Translucent fills, hairline highlights, soft ambient shadows — best on a dark palette.',
  appearance: 'dark',
  derive: (p) => ({
    colors: {
      bg: darkCanvas(p),
      nodeFill: 'rgba(255, 255, 255, 0.08)',
      nodeFillAlt: 'rgba(255, 255, 255, 0.055)',
      nodeStroke: 'rgba(255, 255, 255, 0.32)',
      nodeText: '#f6f8ff',
      edge: 'rgba(255, 255, 255, 0.55)',
      edgeLabelBg: 'rgba(255, 255, 255, 0.22)',
      edgeLabelText: '#ffffff',
      clusterFill: 'rgba(255, 255, 255, 0.06)',
      clusterStroke: 'rgba(255, 255, 255, 0.18)',
      clusterText: 'rgba(255, 255, 255, 0.85)',
      accent: p.accent,
    },
    geometry: {
      nodeRadius: 14,
      strokeWidth: 1,
      edgeWidth: 1.6,
      edgeDash: null,
      arrowScale: 1,
      clusterRadius: 16,
      nodeShadow: 18,
      nodeShadowY: 8,
      edgeGlow: 0,
    },
    typography: {
      fontFamily: SANS,
      fontSize: 15,
      fontWeight: 500,
      letterSpacing: 0.1,
      textTransform: 'none',
      labelFontSize: 13,
      titleWeight: 600,
    },
    effects: {
      nodeFill: 'soft',
      gradientAngle: 140,
      background: 'gradient',
      patternColor: p.accent,
      patternSize: 30,
      animatedEdges: false,
      sketch: false,
    },
  }),
};

/* ----------------------------------------------------------------- blueprint */

const blueprint: ThemeDefinition = {
  id: 'blueprint',
  name: 'Blueprint',
  description:
    'Drafting-table aesthetic: cyanotype canvas, ruled grid, uppercase serif type, thin precise strokes.',
  appearance: 'dark',
  derive: (p) => ({
    colors: {
      bg: '#0f2b46',
      nodeFill: 'rgba(255, 255, 255, 0.06)',
      nodeFillAlt: 'rgba(255, 255, 255, 0.1)',
      nodeStroke: '#dbeafe',
      nodeText: '#f0f7ff',
      edge: '#a5d8ff',
      edgeLabelBg: 'rgba(9, 30, 50, 0.85)',
      edgeLabelText: '#dbeafe',
      clusterFill: 'rgba(255, 255, 255, 0.04)',
      clusterStroke: 'rgba(219, 234, 254, 0.5)',
      clusterText: '#dbeafe',
      accent: p.hues.cyan,
    },
    geometry: {
      nodeRadius: 0,
      strokeWidth: 1.2,
      edgeWidth: 1.2,
      edgeDash: null,
      arrowScale: 1,
      clusterRadius: 0,
      nodeShadow: 0,
      nodeShadowY: 0,
      edgeGlow: 0,
    },
    typography: {
      fontFamily: `${MONO}, ${SERIF}`,
      fontSize: 13,
      fontWeight: 500,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      labelFontSize: 11,
      titleWeight: 700,
    },
    effects: {
      nodeFill: 'flat',
      gradientAngle: 180,
      background: 'grid',
      patternColor: 'rgba(165, 216, 255, 0.18)',
      patternSize: 24,
      animatedEdges: false,
      sketch: false,
    },
  }),
};

function canvasFrom(color: string, amount: number): string {
  // Local import avoidance: mix is cheap and keeps this module dependency-light.
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export const THEMES: Record<string, ThemeDefinition> = {
  minimal,
  neon,
  tech,
  cartoon,
  glass,
  blueprint,
};

export const THEME_IDS = Object.keys(THEMES);

export function getTheme(id: string): ThemeDefinition | undefined {
  return THEMES[id] ?? THEMES[id.toLowerCase()];
}

/** Register a custom theme at runtime (webview, CLI plugin, demo page). */
export function defineTheme(definition: ThemeDefinition): ThemeDefinition {
  return definition;
}

/**
 * A theme may be given as partial tokens instead of a definition. This wraps
 * that shape so `resolveTheme` has a single code path.
 */
export function asThemeDefinition(input: unknown): ThemeDefinition | undefined {
  if (typeof input === 'string') return getTheme(input);
  if (typeof input !== 'object' || input === null) return undefined;
  const obj = input as Partial<ThemeDefinition> & Partial<ThemeTokens>;
  if (typeof obj.derive === 'function') return obj as ThemeDefinition;
  if (obj.colors || obj.geometry || obj.typography || obj.effects) {
    return {
      id: obj.id ?? 'custom',
      name: obj.name ?? 'Custom',
      description: obj.description ?? 'Inline theme tokens',
      appearance: obj.appearance as ThemeDefinition['appearance'],
      derive: () => ({
        colors: { ...(minimal.derive(PALETTES_FALLBACK).colors), ...(obj.colors ?? {}) },
        geometry: { ...minimal.derive(PALETTES_FALLBACK).geometry, ...(obj.geometry ?? {}) },
        typography: { ...minimal.derive(PALETTES_FALLBACK).typography, ...(obj.typography ?? {}) },
        effects: { ...minimal.derive(PALETTES_FALLBACK).effects, ...(obj.effects ?? {}) },
      }),
    };
  }
  return undefined;
}

const PALETTES_FALLBACK: Palette = {
  id: 'fallback',
  name: 'Fallback',
  appearance: 'light',
  bg: '#ffffff',
  surface: '#f6f8fa',
  surfaceAlt: '#eef1f4',
  border: '#d0d7de',
  text: '#1f2328',
  textMuted: '#59636e',
  accent: '#0969da',
  edge: '#8c959f',
  edgeLabelBg: '#eef1f4',
  hues: {
    blue: '#0969da',
    cyan: '#1b7c83',
    green: '#1a7f37',
    yellow: '#9a6700',
    orange: '#bc4c00',
    red: '#cf222e',
    purple: '#8250df',
    pink: '#bf3989',
  },
};
