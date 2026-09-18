/**
 * Tiny colour toolkit. No dependencies — the SDK must stay installable in a
 * VS Code webview and a headless browser without extra weight.
 *
 * Supported inputs: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), a small set
 * of CSS keywords (including `transparent`). Anything else is passed through
 * untouched by the `passThrough` helpers so exotic palettes never crash a render.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  transparent: '#00000000',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  silver: '#c0c0c0',
  navy: '#000080',
  teal: '#008080',
  purple: '#800080',
  orange: '#ffa500',
  yellow: '#ffff00',
  pink: '#ffc0cb',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  currentcolor: '#000000',
};

function clamp(n: number, min = 0, max = 255): number {
  return Math.min(max, Math.max(min, n));
}

export function parseColor(input: string): Rgba | null {
  if (!input) return null;
  let value = String(input).trim().toLowerCase();
  if (value in NAMED) value = NAMED[value]!;

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split('');
      return {
        r: parseInt(r! + r!, 16),
        g: parseInt(g! + g!, 16),
        b: parseInt(b! + b!, 16),
        a: a ? parseInt(a + a, 16) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const m = value.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1]!.split(/[,/\s]+/).filter(Boolean).map((p) => p.trim());
    if (parts.length < 3) return null;
    const ch = (s: string) =>
      s.endsWith('%') ? (parseFloat(s) / 100) * 255 : parseFloat(s);
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return { r: clamp(ch(parts[0]!)), g: clamp(ch(parts[1]!)), b: clamp(ch(parts[2]!)), a: Number.isFinite(a) ? clamp(a, 0, 1) : 1 };
  }
  return null;
}

export function toHex(c: Rgba): string {
  const h = (n: number) => clamp(Math.round(n)).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function toRgbaString(c: Rgba): string {
  const h = (n: number) => clamp(Math.round(n));
  return c.a >= 1 ? toHex(c) : `rgba(${h(c.r)}, ${h(c.g)}, ${h(c.b)}, ${Math.round(c.a * 100) / 100})`;
}

/** Returns a colour with the given alpha; falls back to `fallback` on unparseable input. */
export function withAlpha(color: string, alpha: number, fallback = 'transparent'): string {
  const c = parseColor(color);
  if (!c) return fallback;
  return toRgbaString({ ...c, a: clamp(alpha, 0, 1) });
}

/** Mix two colours; `t = 0` yields `a`, `t = 1` yields `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca) return b;
  if (!cb) return a;
  const f = clamp(t, 0, 1);
  return toRgbaString({
    r: ca.r + (cb.r - ca.r) * f,
    g: ca.g + (cb.g - ca.g) * f,
    b: ca.b + (cb.b - ca.b) * f,
    a: ca.a + (cb.a - ca.a) * f,
  });
}

export function darken(color: string, amount: number): string {
  return mix(color, '#000000', amount);
}

export function lighten(color: string, amount: number): string {
  return mix(color, '#ffffff', amount);
}

/** Relative luminance (0 dark → 1 light). Unknown colours count as `fallback`. */
export function luminance(color: string, fallback = 0): number {
  const c = parseColor(color);
  if (!c) return fallback;
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function isDark(color: string, fallback = true): boolean {
  const c = parseColor(color);
  if (!c) return fallback;
  // Alpha-composited colours (e.g. rgba(0,0,0,0)) are judged by their own RGB.
  return luminance(color, 0) < 0.45;
}

/** Readable foreground for a background. */
export function contrastText(bg: string): string {
  return isDark(bg) ? '#ffffff' : '#111418';
}

/** Saturate/desaturate toward the greyscale axis. */
export function saturate(color: string, amount: number): string {
  const c = parseColor(color);
  if (!c) return color;
  const grey = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const f = 1 + amount;
  return toRgbaString({
    r: clamp(grey + (c.r - grey) * f),
    g: clamp(grey + (c.g - grey) * f),
    b: clamp(grey + (c.b - grey) * f),
    a: c.a,
  });
}

/** Brighten a colour toward full intensity — used for neon glow ramps. */
export function glowVariant(color: string, amount = 0.35): string {
  const c = parseColor(color);
  if (!c) return color;
  const lift = (v: number) => clamp(v + (255 - v) * amount);
  return toRgbaString({ r: lift(c.r), g: lift(c.g), b: lift(c.b), a: c.a });
}
