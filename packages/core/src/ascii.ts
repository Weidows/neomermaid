/**
 * @neomermaid/core — ASCII / Unicode rendering.
 *
 * Turns the SVG string produced by `render()` into a drawing that a terminal or
 * an agent can read without an image. There is deliberately **no DOM access
 * anywhere in this module**: everything is regex/string work plus a small
 * character-grid rasteriser, so it runs in plain Node, in a web worker, or
 * inside the VS Code extension host.
 *
 * Design notes
 * ------------
 *  - Mermaid owns layout; we de-layout it. Node/shape/label boxes are read out
 *    of the SVG, then re-projected onto a character grid. The projection is a
 *    monotone piecewise-linear map per axis (see `layoutAxis`): every box keeps
 *    its relative order and earns at least enough columns for its label, so a
 *    2000px-wide LR flowchart still reads at 120 columns.
 *  - Nothing here ever throws: unknown diagram families, garbage markup and
 *    internal errors all degrade to a labelled fallback string.
 *  - Deterministic: same SVG + same options ⇒ byte-identical output.
 *
 * ---------------------------------------------------------------------------
 * PARENT: wire this into `packages/core/src/index.ts` (nothing else imports it):
 *
 *   export { asciiFromSvg, renderAscii, ASCII_FALLBACK_PREFIX } from './ascii.js';
 *   export type { AsciiOptions } from './ascii.js';
 *
 * (`ASCII_FALLBACK_PREFIX` is exported so hosts can detect a degraded render;
 * it is the first thing on the first line of a fallback. `charWidth` /
 * `displayWidth` are exported for hosts that need to measure terminal output —
 * re-exporting those two is optional.) A CLI command is then just:
 *
 *   const out = await renderAscii(source, { ...renderOptions, ...asciiOptions });
 *
 * (`renderAscii` imports `render.ts` lazily, so importing this module stays
 * DOM-free and mermaid-free.)
 * ---------------------------------------------------------------------------
 */

import { parseColor } from './color.js';
import { resolveTheme } from './theme.js';
import type { RenderOptions, ThemeTokens } from './types.js';

/* ============================================================== public API */

export interface AsciiOptions {
  /** Hard cap on the width of every output line, in terminal columns. */
  maxWidth?: number;
  /** Blank columns/rows of margin around the drawing. */
  padding?: number;
  /** `true` → pure 7-bit ASCII (`+ - |`), `false` (default) → box drawing. */
  useAscii?: boolean;
  /** `false` renders the structure only, without any text. */
  showLabels?: boolean;
  /** Wrap label text in ANSI 24-bit colour derived from the resolved theme. */
  colour?: boolean;
}

/** Every line of a degraded render starts with this marker. */
export const ASCII_FALLBACK_PREFIX = '[ascii]';

/* Internal style ids — mapped to theme colours only when `colour` is on. */
const S_PLAIN = 0;
const S_NODE_TEXT = 1;
const S_NODE_BOX = 2;
const S_EDGE = 3;
const S_EDGE_LABEL = 4;
const S_CLUSTER_TEXT = 5;
const S_CLUSTER_BOX = 6;
const S_TITLE = 7;
const S_ACTOR_TEXT = 8;
const S_ACTOR_BOX = 9;
const S_NOTE = 10;

interface ResolvedAsciiOptions {
  maxWidth: number;
  padding: number;
  useAscii: boolean;
  showLabels: boolean;
  colour: boolean;
}

const MAX_LABEL = 60;
/** Roughly the pixel width of one terminal cell — keeps small diagrams small. */
const PX_PER_COLUMN = 8;
const MAX_ROWS = 400;
const CURVE_SAMPLES = 12;

/* ============================================================ text metrics */

/** Terminal columns occupied by one code point (2 for CJK/emoji, 0 for marks). */
export function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp >= 0x0300 && cp <= 0x036f) return 0; // combining marks
  if (cp >= 0x200b && cp <= 0x200f) return 0; // zero-width + bidi marks
  if (cp === 0xfeff) return 0;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 0; // variation selectors
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd);
  return wide ? 2 : 1;
}

/** Display width of a string in terminal columns (CJK = 2). */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch.codePointAt(0) ?? 0);
  return w;
}

/** Clip to `width` columns, appending `…` when something was dropped. */
function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (displayWidth(text) <= width) return text;
  if (width === 1) return '…';
  let out = '';
  let w = 0;
  for (const ch of text) {
    const cw = charWidth(ch.codePointAt(0) ?? 0);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** Greedy word wrap into at most `rows` rows of `width` columns. */
function wrapText(text: string, width: number, rows: number): string[] {
  if (rows <= 0 || width <= 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const all: string[] = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (displayWidth(candidate) <= width) {
      cur = candidate;
      continue;
    }
    if (cur) all.push(cur);
    cur = truncate(word, width);
  }
  if (cur) all.push(cur);
  if (all.length <= rows) return all;
  const kept = all.slice(0, rows);
  kept[rows - 1] = `${truncate(kept[rows - 1]!, width - 1)}…`;
  return kept;
}

/* =========================================================== svg utilities */

interface RawTag {
  name: string;
  attrs: string;
  closing: boolean;
  selfClosing: boolean;
  index: number;
  end: number;
}

function eachTag(svg: string, visit: (tag: RawTag) => void): void {
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    visit({
      name: (m[2] ?? '').toLowerCase(),
      attrs: m[3] ?? '',
      closing: m[1] === '/',
      selfClosing: m[4] === '/',
      index: m.index,
      end: m.index + m[0].length,
    });
  }
}

interface GroupSlice {
  attrs: string;
  inner: string;
}

/** Balanced `<g>` slices — the only nesting we need to track. */
function groupSlices(svg: string): GroupSlice[] {
  const out: GroupSlice[] = [];
  const stack: { attrs: string; start: number }[] = [];
  eachTag(svg, (tag) => {
    if (tag.name !== 'g') return;
    if (tag.closing) {
      const top = stack.pop();
      if (top) out.push({ attrs: top.attrs, inner: svg.slice(top.start, tag.index) });
      return;
    }
    if (tag.selfClosing) {
      out.push({ attrs: tag.attrs, inner: '' });
      return;
    }
    stack.push({ attrs: tag.attrs, start: tag.end });
  });
  for (const top of stack) out.push({ attrs: top.attrs, inner: svg.slice(top.start) });
  return out;
}

/** Drop `<style>`/`<defs>` so their numbers never leak into the geometry. */
function stripChrome(svg: string): string {
  return svg
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<defs[\s\S]*?<\/defs>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
  const m = re.exec(attrs);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? '';
}

function numAttr(attrs: string, name: string, fallback = 0): number {
  const raw = attr(attrs, name);
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function classOf(attrs: string): string {
  return attr(attrs, 'class') ?? '';
}

function classMatches(attrs: string, re: RegExp): boolean {
  return re.test(classOf(attrs));
}

const NUM = String.raw`-?\d*\.?\d+(?:e[-+]?\d+)?`;

function numbers(text: string): number[] {
  const out: number[] = [];
  const re = new RegExp(NUM, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(Number.parseFloat(m[0]));
  return out;
}

/** `translate(x, y)` / `translate(x y)`; every other transform is ignored. */
function translateOf(attrs: string): [number, number] {
  const raw = attr(attrs, 'transform');
  if (!raw) return [0, 0];
  const m = /translate\(\s*([^)]*)\)/.exec(raw);
  if (!m) return [0, 0];
  const nums = numbers(m[1] ?? '');
  return [nums[0] ?? 0, nums[1] ?? 0];
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    times: '×',
    laquo: '«',
    raquo: '»',
    copy: '©',
    rarr: '→',
    larr: '←',
  };
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return full;
      return String.fromCodePoint(code);
    }
    return named[body.toLowerCase()] ?? full;
  });
}

function plainText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Prefer the label span mermaid wraps user text in; fall back to everything. */
function extractLabel(fragment: string, spanClass = 'nodeLabel'): string {
  const re = new RegExp(`<span[^>]*\\bclass="[^"]*\\b${spanClass}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/span>`);
  const m = re.exec(fragment);
  return plainText(m ? m[1]! : fragment);
}

function collectTexts(svg: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<(?:text|tspan|p)\b[^>]*>([\s\S]*?)<\/(?:text|tspan|p)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const value = plainText(m[1] ?? '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/* ============================================================ path parsing */

interface Pt {
  x: number;
  y: number;
}

/** Parse an SVG path into a polyline; Béziers are sampled into segments. */
function parsePath(d: string, samples = CURVE_SAMPLES): Pt[] {
  const tokens: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    if (m[1]) tokens.push(m[1]);
    else tokens.push(Number.parseFloat(m[2]!));
  }

  const out: Pt[] = [];
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevCx = 0;
  let prevCy = 0;
  let prevKind = '';
  const read = (): number => {
    const v = tokens[i];
    i += 1;
    return typeof v === 'number' ? v : 0;
  };
  const push = (x: number, y: number): void => {
    out.push({ x, y });
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): void => {
    for (let s = 1; s <= samples; s += 1) {
      const t = s / samples;
      const u = 1 - t;
      push(
        u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
      );
    }
    prevCx = x2;
    prevCy = y2;
  };
  const quad = (x1: number, y1: number, x: number, y: number): void => {
    for (let s = 1; s <= samples; s += 1) {
      const t = s / samples;
      const u = 1 - t;
      push(u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y);
    }
    prevCx = x1;
    prevCy = y1;
  };

  let guard = 0;
  while (i < tokens.length && guard < 40000) {
    guard += 1;
    const token = tokens[i];
    if (typeof token === 'string') {
      cmd = token;
      i += 1;
      if (cmd === 'z' || cmd === 'Z') {
        push(sx, sy);
        cx = sx;
        cy = sy;
        prevKind = 'z';
      }
      continue;
    }
    if (!cmd) {
      i += 1;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        let x = read();
        let y = read();
        if (rel) {
          x += cx;
          y += cy;
        }
        cx = x;
        cy = y;
        sx = x;
        sy = y;
        push(x, y);
        cmd = rel ? 'l' : 'L';
        prevKind = 'm';
        break;
      }
      case 'L': {
        let x = read();
        let y = read();
        if (rel) {
          x += cx;
          y += cy;
        }
        cx = x;
        cy = y;
        push(x, y);
        prevKind = 'l';
        break;
      }
      case 'H': {
        let x = read();
        if (rel) x += cx;
        cx = x;
        push(x, cy);
        prevKind = 'l';
        break;
      }
      case 'V': {
        let y = read();
        if (rel) y += cy;
        cy = y;
        push(cx, y);
        prevKind = 'l';
        break;
      }
      case 'C': {
        let x1 = read();
        let y1 = read();
        let x2 = read();
        let y2 = read();
        let x = read();
        let y = read();
        if (rel) {
          x1 += cx;
          y1 += cy;
          x2 += cx;
          y2 += cy;
          x += cx;
          y += cy;
        }
        cubic(x1, y1, x2, y2, x, y);
        cx = x;
        cy = y;
        prevKind = 'c';
        break;
      }
      case 'S': {
        const smooth = prevKind === 'c' || prevKind === 's';
        const x1 = smooth ? 2 * cx - prevCx : cx;
        const y1 = smooth ? 2 * cy - prevCy : cy;
        let x2 = read();
        let y2 = read();
        let x = read();
        let y = read();
        if (rel) {
          x2 += cx;
          y2 += cy;
          x += cx;
          y += cy;
        }
        cubic(x1, y1, x2, y2, x, y);
        cx = x;
        cy = y;
        prevKind = 's';
        break;
      }
      case 'Q': {
        let x1 = read();
        let y1 = read();
        let x = read();
        let y = read();
        if (rel) {
          x1 += cx;
          y1 += cy;
          x += cx;
          y += cy;
        }
        quad(x1, y1, x, y);
        cx = x;
        cy = y;
        prevKind = 'q';
        break;
      }
      case 'T': {
        const smooth = prevKind === 'q' || prevKind === 't';
        const x1 = smooth ? 2 * cx - prevCx : cx;
        const y1 = smooth ? 2 * cy - prevCy : cy;
        let x = read();
        let y = read();
        if (rel) {
          x += cx;
          y += cy;
        }
        quad(x1, y1, x, y);
        cx = x;
        cy = y;
        prevKind = 't';
        break;
      }
      case 'A': {
        read();
        read();
        read();
        read();
        read();
        let x = read();
        let y = read();
        if (rel) {
          x += cx;
          y += cy;
        }
        cx = x;
        cy = y;
        push(x, y);
        prevKind = 'a';
        break;
      }
      default: {
        i += 1;
        break;
      }
    }
  }
  return out;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boundsOf(points: Pt[]): Box | undefined {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!valid.length) return undefined;
  let x0 = valid[0]!.x;
  let x1 = valid[0]!.x;
  let y0 = valid[0]!.y;
  let y1 = valid[0]!.y;
  for (const p of valid) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

function unionBox(a: Box | undefined, b: Box): Box {
  if (!a) return b;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/* ========================================================= character grid */

const N = 1;
const E = 2;
const S = 4;
const W = 8;

const BOX_UNICODE: Record<number, string> = {
  [N | S]: '│',
  [E | W]: '─',
  [S | E]: '┌',
  [S | W]: '┐',
  [N | E]: '└',
  [N | W]: '┘',
  [N | S | E]: '├',
  [N | S | W]: '┤',
  [N | E | W]: '┴',
  [S | E | W]: '┬',
  [N | S | E | W]: '┼',
  [N]: '│',
  [S]: '│',
  [E]: '─',
  [W]: '─',
};

const BOX_ASCII: Record<number, string> = {
  [N | S]: '|',
  [E | W]: '-',
  [S | E]: '+',
  [S | W]: '+',
  [N | E]: '+',
  [N | W]: '+',
  [N | S | E]: '+',
  [N | S | W]: '+',
  [N | E | W]: '+',
  [S | E | W]: '+',
  [N | S | E | W]: '+',
  [N]: '|',
  [S]: '|',
  [E]: '-',
  [W]: '-',
};

const KIND_EMPTY = 0;
const KIND_LINE = 1;
const KIND_GLYPH = 2;

class CharGrid {
  readonly w: number;
  readonly h: number;
  private readonly ch: string[];
  private readonly kind: Uint8Array;
  private readonly style: Int8Array;
  private readonly mask: Uint8Array;
  private readonly over: string[];

  constructor(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    const size = this.w * this.h;
    this.ch = new Array<string>(size).fill('');
    this.kind = new Uint8Array(size);
    this.style = new Int8Array(size);
    this.mask = new Uint8Array(size);
    this.over = new Array<string>(size).fill('');
  }

  private idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Hard glyph write — used for text, borders, arrow heads and frame corners. */
  set(x: number, y: number, ch: string, style = S_PLAIN): void {
    if (!this.inside(x, y)) return;
    const i = this.idx(x, y);
    this.ch[i] = ch;
    this.kind[i] = KIND_GLYPH;
    this.style[i] = style;
  }

  text(x: number, y: number, text: string, style = S_PLAIN, align: 'left' | 'center' | 'right' = 'left'): void {
    const width = displayWidth(text);
    let col = align === 'center' ? x - Math.floor(width / 2) : align === 'right' ? x - width : x;
    for (const ch of text) {
      const cw = charWidth(ch.codePointAt(0) ?? 0);
      if (cw === 0) continue;
      if (col >= 0 && col + cw <= this.w && this.inside(col, y)) {
        this.set(col, y, ch, style);
        if (cw === 2) this.set(col + 1, y, '', style);
      }
      col += cw;
    }
  }

  /** Junction bookkeeping for connectors: never paints over a glyph. */
  bit(x: number, y: number, bits: number): void {
    if (!this.inside(x, y)) return;
    const i = this.idx(x, y);
    if (this.kind[i] === KIND_GLYPH) return;
    this.kind[i] = KIND_LINE;
    this.mask[i] |= bits;
  }

  private override(x: number, y: number, ch: string): void {
    if (!this.inside(x, y)) return;
    const i = this.idx(x, y);
    if (this.kind[i] === KIND_GLYPH) return;
    this.kind[i] = KIND_LINE;
    this.over[i] = ch;
  }

  /** Polyline through grid cells, keeping junction information in the mask. */
  line(points: Pt[]): void {
    for (let p = 1; p < points.length; p += 1) {
      const steps = bresenham(points[p - 1]!, points[p]!);
      for (let s = 1; s < steps.length; s += 1) {
        const from = steps[s - 1]!;
        const to = steps[s]!;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        if (dx === 0 && dy === 0) continue;
        if (dx !== 0 && dy !== 0) {
          this.override(to.x, to.y, dx * dy > 0 ? '\\' : '/');
          continue;
        }
        if (dx > 0) {
          this.bit(from.x, from.y, E);
          this.bit(to.x, to.y, W);
        } else if (dx < 0) {
          this.bit(from.x, from.y, W);
          this.bit(to.x, to.y, E);
        } else if (dy > 0) {
          this.bit(from.x, from.y, S);
          this.bit(to.x, to.y, N);
        } else {
          this.bit(from.x, from.y, N);
          this.bit(to.x, to.y, S);
        }
      }
    }
  }

  box(x0: number, y0: number, x1: number, y1: number, rounded: boolean, style: number, ascii = false): void {
    const bx0 = Math.min(x0, x1);
    const bx1 = Math.max(x0, x1);
    const by0 = Math.min(y0, y1);
    const by1 = Math.max(y0, y1);
    for (let x = bx0; x <= bx1; x += 1) {
      this.bit(x, by0, E | W);
      this.bit(x, by1, E | W);
    }
    for (let y = by0; y <= by1; y += 1) {
      this.bit(bx0, y, N | S);
      this.bit(bx1, y, N | S);
    }
    if (by0 === by1) {
      this.set(bx0, by0, ascii ? '+' : rounded ? '╭' : '┌', style);
      this.set(bx1, by0, ascii ? '+' : rounded ? '╮' : '┐', style);
      return;
    }
    this.bit(bx0, by0, S | E);
    this.bit(bx1, by0, S | W);
    this.bit(bx0, by1, N | E);
    this.bit(bx1, by1, N | W);
    const corners: [number, number, string][] = ascii
      ? [
          [bx0, by0, '+'],
          [bx1, by0, '+'],
          [bx0, by1, '+'],
          [bx1, by1, '+'],
        ]
      : rounded
        ? [
            [bx0, by0, '╭'],
            [bx1, by0, '╮'],
            [bx0, by1, '╰'],
            [bx1, by1, '╯'],
          ]
        : [
            [bx0, by0, '┌'],
            [bx1, by0, '┐'],
            [bx0, by1, '└'],
            [bx1, by1, '┘'],
          ];
    for (const [x, y, ch] of corners) this.set(x, y, ch, style);
  }

  /** Single-row frame (`╭── label ──╮`) used by sequence notes and loops. */
  frameRow(x0: number, x1: number, y: number, style: number, ascii: boolean): void {
    const bx0 = Math.min(x0, x1);
    const bx1 = Math.max(x0, x1);
    for (let x = bx0; x <= bx1; x += 1) this.set(x, y, ascii ? '-' : '─', style);
    this.set(bx0, y, ascii ? '+' : '╭', style);
    this.set(bx1, y, ascii ? '+' : '╮', style);
  }

  insideBox(boxes: Box[], x: number, y: number): boolean {
    return boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
  }

  /** A cell that holds no character yet (blank or line). */
  isFree(x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    return this.kind[this.idx(x, y)] !== KIND_GLYPH;
  }

  /**
   * Row cells: `' '` for empty cells, `''` for the second half of a wide glyph
   * (so painters know not to emit a column for it).
   */
  row(y: number, ascii: boolean): string[] {
    const cells: string[] = [];
    for (let x = 0; x < this.w; x += 1) {
      const i = this.idx(x, y);
      if (this.kind[i] === KIND_EMPTY) {
        cells.push(' ');
        continue;
      }
      if (this.kind[i] === KIND_GLYPH) {
        cells.push(this.ch[i] ?? '');
        continue;
      }
      if (this.over[i]) {
        cells.push(this.over[i]!);
        continue;
      }
      const table = ascii ? BOX_ASCII : BOX_UNICODE;
      cells.push(table[this.mask[i]!] ?? (ascii ? '+' : '·'));
    }
    return cells;
  }

  styleAt(x: number, y: number): number {
    return this.style[this.idx(x, y)] ?? S_PLAIN;
  }

  kindAt(x: number, y: number): number {
    return this.kind[this.idx(x, y)]!;
  }
}

function bresenham(a: Pt, b: Pt): Pt[] {
  const points: Pt[] = [];
  let x = Math.round(a.x);
  let y = Math.round(a.y);
  const x1 = Math.round(b.x);
  const y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x);
  const dy = Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx - dy;
  let guard = 0;
  for (;;) {
    points.push({ x, y });
    if ((x === x1 && y === y1) || guard > 4000) break;
    guard += 1;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

/* ============================================================ axis layout */

interface Interval {
  a: number;
  b: number;
  min: number;
}

interface AxisLayout {
  map(p: number): number;
  size: number;
}

interface Anchor {
  p: number;
  c: number;
}

function slope(a: Anchor, b: Anchor, fallback = 1): number {
  const dp = b.p - a.p;
  if (Math.abs(dp) < 1e-9) return fallback;
  return (b.c - a.c) / dp;
}

function interp(anchors: Anchor[], p: number): number {
  if (!anchors.length) return 0;
  if (anchors.length === 1) return anchors[0]!.c;
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (p <= first.p) return first.c + (p - first.p) * slope(first, anchors[1]!);
  if (p >= last.p) return last.c + (p - last.p) * slope(anchors[anchors.length - 2]!, last);
  let lo = 0;
  let hi = anchors.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid]!.p <= p) lo = mid;
    else hi = mid;
  }
  return anchors[lo]!.c + (p - anchors[lo]!.p) * slope(anchors[lo]!, anchors[hi]!);
}

/**
 * Monotone piecewise-linear projection of one axis onto character cells.
 *
 * Bands (overlapping intervals merged) keep their order, earn at least `min`
 * cells and share the budget proportionally to their pixel size. With
 * `hard: true` the result is squeezed to fit `budget` — gaps shrink first, then
 * the widest band — which is what keeps `maxWidth` a hard promise on the
 * horizontal axis. The vertical axis calls this with `hard: false`: rows are
 * cheap, so proportions win and nothing is squashed below its minimum.
 */
function layoutAxis(raw: Interval[], budget: number, hard = true, preferredScale = Number.POSITIVE_INFINITY): AxisLayout {
  const items = raw
    .filter((i) => Number.isFinite(i.a) && Number.isFinite(i.b))
    .map((i) => ({ a: i.a, b: Math.max(i.b, i.a + 1e-6), min: Math.max(1, Math.round(i.min)) }))
    .sort((p, q) => p.a - q.a);

  const bands: Interval[] = [];
  for (const item of items) {
    const last = bands[bands.length - 1];
    if (last && item.a <= last.b + 1e-9) {
      last.b = Math.max(last.b, item.b);
      last.min = Math.max(last.min, item.min);
    } else {
      bands.push({ ...item });
    }
  }
  if (!bands.length) return { map: () => 0, size: 0 };

  const minA = bands[0]!.a;
  const maxB = bands[bands.length - 1]!.b;
  const span = Math.max(maxB - minA, 1e-6);
  // `preferredScale` stops a small diagram from being blown up to fill the whole
  // budget: a single-column flowchart should stay a column wide, not stretch.
  const baseScale = Math.min(Math.max(budget, 4) / span, preferredScale);

  const sizes = bands.map((b) => Math.max(b.min, Math.round((b.b - b.a) * baseScale)));
  const gaps = bands.slice(0, -1).map((b, i) => Math.max(1, Math.round((bands[i + 1]!.a - b.b) * baseScale)));

  if (hard) {
    const total = (): number => sizes.reduce((s, v) => s + v, 0) + gaps.reduce((s, v) => s + v, 0);
    let guard = 0;
    while (total() > budget && guard < 5000) {
      guard += 1;
      let gapIdx = -1;
      let gapBest = 1;
      for (let i = 0; i < gaps.length; i += 1) {
        if (gaps[i]! > gapBest) {
          gapBest = gaps[i]!;
          gapIdx = i;
        }
      }
      if (gapIdx >= 0) {
        gaps[gapIdx] = gapBest - 1;
        continue;
      }
      let sizeIdx = -1;
      let sizeBest = 1;
      for (let i = 0; i < sizes.length; i += 1) {
        if (sizes[i]! > sizeBest) {
          sizeBest = sizes[i]!;
          sizeIdx = i;
        }
      }
      if (sizeIdx < 0) break;
      sizes[sizeIdx] = sizeBest - 1;
    }
  }

  const anchors: Anchor[] = [];
  let cursor = 0;
  for (let i = 0; i < bands.length; i += 1) {
    anchors.push({ p: bands[i]!.a, c: cursor });
    cursor += sizes[i]!;
    anchors.push({ p: bands[i]!.b, c: cursor });
    if (i < gaps.length) cursor += gaps[i]!;
  }

  return { map: (p: number) => interp(anchors, p), size: cursor };
}

/* ============================================================== svg model */

type ShapeKind = 'rect' | 'rounded' | 'diamond' | 'hexagon' | 'circle' | 'text';

interface GraphNode {
  id: string;
  box: Box;
  label: string;
  shape: ShapeKind;
}

interface GraphCluster {
  box: Box;
  label: string;
}

interface GraphEdge {
  points: Pt[];
  label: string;
  /** Where mermaid itself parked the edge label pill, when there is one. */
  labelAt?: Pt;
  arrowEnd: boolean;
  arrowStart: boolean;
  id?: string;
}

interface GraphModel {
  bounds: Box;
  nodes: GraphNode[];
  clusters: GraphCluster[];
  edges: GraphEdge[];
}

const NODE_CLASS = /(?:^|\s)node(?:\s|$)|statediagram-state|entityBox|classGroup/;
const EDGE_CLASS =
  /flowchart-link|edge-thickness|edge-pattern|relationshipLine|(?:^|\s)relation(?:\s|$)|(?:^|\s)transition(?:\s|$)/;

function viewBox(svg: string): Box {
  const m = /viewBox\s*=\s*"([^"]*)"/i.exec(svg);
  if (m) {
    const parts = numbers(m[1] ?? '');
    if (parts.length === 4) {
      const x = parts[0]!;
      const y = parts[1]!;
      const w = parts[2]!;
      const h = parts[3]!;
      if (w > 0 && h > 0) return { x0: x, y0: y, x1: x + w, y1: y + h };
    }
  }
  const root = /<svg\b([^>]*)>/i.exec(svg);
  const rootAttrs = root?.[1] ?? '';
  const w = numAttr(rootAttrs, 'width');
  const h = numAttr(rootAttrs, 'height');
  if (w > 0 && h > 0) return { x0: 0, y0: 0, x1: w, y1: h };
  return { x0: 0, y0: 0, x1: 800, y1: 600 };
}

interface ShapeRead {
  box: Box;
  kind: ShapeKind;
}

/** Shape bounds inside a node group, relative to the group's own translate. */
function readShape(inner: string, origin: [number, number]): ShapeRead {
  const [ox, oy] = origin;
  let best: ShapeRead | undefined;

  eachTag(inner, (tag) => {
    if (best) return;
    const [tx, ty] = translateOf(tag.attrs);
    if (tag.name === 'rect') {
      const w = numAttr(tag.attrs, 'width', 0);
      const h = numAttr(tag.attrs, 'height', 0);
      if (!(w > 0 && h > 0)) return;
      const x = numAttr(tag.attrs, 'x', 0) + tx;
      const y = numAttr(tag.attrs, 'y', 0) + ty;
      const rounded = numAttr(tag.attrs, 'rx', 0) > 0;
      best = {
        box: { x0: ox + x, y0: oy + y, x1: ox + x + w, y1: oy + y + h },
        kind: rounded ? 'rounded' : 'rect',
      };
      return;
    }
    if (tag.name === 'polygon' || tag.name === 'polyline') {
      const raw = numbers(attr(tag.attrs, 'points') ?? '');
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < raw.length; i += 2) pts.push({ x: raw[i]!, y: raw[i + 1]! });
      const b = boundsOf(pts);
      if (!b) return;
      const kind: ShapeKind = pts.length <= 4 ? 'diamond' : pts.length <= 6 ? 'hexagon' : 'rect';
      best = {
        box: { x0: b.x0 + ox + tx, y0: b.y0 + oy + ty, x1: b.x1 + ox + tx, y1: b.y1 + oy + ty },
        kind,
      };
      return;
    }
    if (tag.name === 'circle' || tag.name === 'ellipse') {
      const cx = numAttr(tag.attrs, 'cx', 0) + tx;
      const cy = numAttr(tag.attrs, 'cy', 0) + ty;
      const rx = tag.name === 'circle' ? numAttr(tag.attrs, 'r', 0) : numAttr(tag.attrs, 'rx', 0);
      const ry = tag.name === 'circle' ? numAttr(tag.attrs, 'r', 0) : numAttr(tag.attrs, 'ry', 0);
      if (!(rx > 0)) return;
      best = {
        box: { x0: ox + cx - rx, y0: oy + cy - ry, x1: ox + cx + rx, y1: oy + cy + ry },
        kind: 'circle',
      };
      return;
    }
    if (tag.name === 'path') {
      const d = attr(tag.attrs, 'd');
      if (!d || !/[mlcq]/i.test(d)) return;
      const b = boundsOf(parsePath(d, 3));
      if (!b) return;
      best = {
        box: { x0: b.x0 + ox + tx, y0: b.y0 + oy + ty, x1: b.x1 + ox + tx, y1: b.y1 + oy + ty },
        kind: 'rounded',
      };
    }
  });

  return best ?? { box: { x0: ox - 40, y0: oy - 20, x1: ox + 40, y1: oy + 20 }, kind: 'text' };
}

function parseGraph(svg: string): GraphModel {
  const body = stripChrome(svg);
  const nodes: GraphNode[] = [];
  const clusters: GraphCluster[] = [];
  const edges: GraphEdge[] = [];
  const edgeLabelById = new Map<string, { x: number; y: number; label: string }>();
  let edgeLabelAnchors: { x: number; y: number; label: string }[] = [];

  for (const slice of groupSlices(body)) {
    const attrs = slice.attrs;

    if (classMatches(attrs, /(?:^|\s)cluster(?:\s|$)/) && !/cluster-label/.test(classOf(attrs))) {
      const rect = /<rect\b([^>]*)>/.exec(slice.inner);
      if (rect) {
        const attrs2 = rect[1] ?? '';
        const w = numAttr(attrs2, 'width', 0);
        const h = numAttr(attrs2, 'height', 0);
        if (w > 0 && h > 0) {
          const x = numAttr(attrs2, 'x', 0);
          const y = numAttr(attrs2, 'y', 0);
          clusters.push({ box: { x0: x, y0: y, x1: x + w, y1: y + h }, label: extractLabel(slice.inner) });
        }
      }
      continue;
    }

    if (classMatches(attrs, NODE_CLASS) && attr(attrs, 'transform') !== undefined) {
      const [tx, ty] = translateOf(attrs);
      const shape = readShape(slice.inner, [tx, ty]);
      nodes.push({
        id: attr(attrs, 'id') ?? `node-${nodes.length}`,
        box: shape.box,
        label: extractLabel(slice.inner),
        shape: shape.kind,
      });
      continue;
    }

    if (classMatches(attrs, /(?:^|\s)edgeLabel(?:\s|$)/)) {
      const [x, y] = translateOf(attrs);
      const anchor = { x, y, label: extractLabel(slice.inner, 'edgeLabel') };
      const idMatch = /\bdata-id\s*=\s*"([^"]*)"/.exec(slice.inner);
      if (idMatch) edgeLabelById.set(idMatch[1]!, anchor);
      edgeLabelAnchors.push(anchor);
    }
  }

  eachTag(body, (tag) => {
    if (tag.name !== 'path') return;
    if (!classMatches(tag.attrs, EDGE_CLASS) && attr(tag.attrs, 'data-edge') === undefined) return;
    const d = attr(tag.attrs, 'd');
    if (!d) return;
    const points = parsePath(d, CURVE_SAMPLES);
    if (points.length < 2) return;
    const markerEnd = attr(tag.attrs, 'marker-end');
    const markerStart = attr(tag.attrs, 'marker-start');
    edges.push({
      points,
      label: '',
      // `-margin` markers are the invisible hit-area twins mermaid emits right
      // next to the visible arrow head; both mean "this end has an arrow".
      arrowEnd: Boolean(markerEnd) && !/sequencenumber/i.test(markerEnd ?? ''),
      arrowStart: Boolean(markerStart) && !/sequencenumber/i.test(markerStart ?? ''),
      id: attr(tag.attrs, 'data-id') ?? attr(tag.attrs, 'id') ?? undefined,
    });
  });

  const usedAnchors = new Set<{ x: number; y: number; label: string }>();
  for (const edge of edges) {
    if (edge.id) {
      const short = edge.id.split('-').slice(1).join('-');
      const found = edgeLabelById.get(edge.id) ?? (short ? edgeLabelById.get(short) : undefined);
      const hit = found && !usedAnchors.has(found) ? found : undefined;
      if (hit) {
        usedAnchors.add(hit);
        edge.label = hit.label;
        edge.labelAt = { x: hit.x, y: hit.y };
        edgeLabelAnchors = edgeLabelAnchors.filter((a) => a !== hit);
        continue;
      }
    }
    const m = edge.points[Math.floor(edge.points.length / 2)] ?? edge.points[0]!;
    let best: (typeof edgeLabelAnchors)[number] | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const anchor of edgeLabelAnchors) {
      if (usedAnchors.has(anchor)) continue;
      const dist = Math.hypot(anchor.x - m.x, anchor.y - m.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = anchor;
      }
    }
    if (best && bestDist < 60) {
      usedAnchors.add(best);
      edge.label = best.label;
      edge.labelAt = { x: best.x, y: best.y };
      edgeLabelAnchors = edgeLabelAnchors.filter((a) => a !== best);
    }
  }

  const centerOf = (b: Box): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
  const contains = (box: Box, p: Pt, slack = 1): boolean =>
    p.x >= box.x0 - slack && p.x <= box.x1 + slack && p.y >= box.y0 - slack && p.y <= box.y1 + slack;
  const keptClusters = clusters.filter((c) => nodes.some((n) => contains(c.box, centerOf(n.box))));

  let bounds: Box | undefined;
  for (const n of nodes) bounds = unionBox(bounds, n.box);
  for (const c of keptClusters) bounds = unionBox(bounds, c.box);
  for (const e of edges) for (const p of e.points) bounds = unionBox(bounds, { x0: p.x, y0: p.y, x1: p.x, y1: p.y });

  return {
    bounds: bounds ?? viewBox(svg),
    nodes,
    clusters: keptClusters,
    edges,
  };
}

/* ======================================================== graph rendering */

function arrowGlyph(from: Pt, to: Pt, ascii: boolean): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (ascii) return dx >= 0 ? '>' : '<';
    return dx >= 0 ? '▶' : '◀';
  }
  if (ascii) return dy >= 0 ? 'v' : '^';
  return dy >= 0 ? '▼' : '▲';
}

function area(b: Box): number {
  return (b.x1 - b.x0) * (b.y1 - b.y0);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function renderGraph(model: GraphModel, opts: ResolvedAsciiOptions, tokens: ThemeTokens | undefined): string {
  const { bounds, nodes, clusters, edges } = model;
  const budget = Math.max(6, opts.maxWidth - opts.padding * 2);

  /* --- horizontal projection: each node claims room for its own label --- */
  const xIntervals: Interval[] =
    nodes.length > 0
      ? nodes.map((n) => ({
          a: n.box.x0,
          b: n.box.x1,
          min: Math.min(MAX_LABEL, displayWidth(n.label) + 4),
        }))
      : [
          { a: bounds.x0, b: bounds.x1, min: 8 },
          { a: bounds.y0, b: bounds.y1, min: 8 },
        ];
  // Edge labels get their own band: without reserved columns the boxes are laid
  // edge to edge and every label ends up shoved onto a spare row instead of
  // sitting on its own connector.
  if (opts.showLabels) {
    for (const edge of edges) {
      if (!edge.label || !edge.labelAt) continue;
      xIntervals.push({
        a: edge.labelAt.x - 1,
        b: edge.labelAt.x + 1,
        // label + at least one column of connector on either side, so the
        // label reads as sitting *on* the arrow instead of replacing it
        min: Math.min(18, displayWidth(edge.label) + 3),
      });
    }
  }
  const xLayout = layoutAxis(xIntervals, budget, true, 1 / PX_PER_COLUMN);

  /* --- vertical projection: proportional, but never below a 3-row box --- */
  const yIntervals: Interval[] = [
    ...nodes.map((n) => ({ a: n.box.y0, b: n.box.y1, min: 3 })),
    ...edges
      .filter((e) => e.label)
      .map((e) => {
        const p = e.labelAt ?? e.points[Math.floor(e.points.length / 2)] ?? e.points[0]!;
        return { a: p.y - 1, b: p.y + 1, min: 1 };
      }),
  ];
  if (!yIntervals.length) yIntervals.push({ a: bounds.y0, b: bounds.y1, min: 6 });
  // Rows are cheap and terminal cells are ~1:2, so the vertical axis is *not*
  // squeezed proportionally: every band gets its minimum (3 rows for a box,
  // 1 for a label) and gaps collapse to a single row. Squeezing y to match the
  // pixel aspect made diamonds three times taller than the boxes next to them.
  const yLayout = layoutAxis(yIntervals, 0, false);

  const yOffset = clusters.length ? 2 : 0; // one blank row + the cluster title row
  const cols = Math.min(budget, Math.round(xLayout.size) + 1);
  const mapRow = (v: number): number => Math.max(0, Math.round(yLayout.map(v)) + yOffset);
  const px = (v: number): number => clampInt(Math.round(xLayout.map(v)), 0, cols - 1);

  /* Nodes are drawn as uniform boxes centred on their vertical midpoint: the
     pixel heights mermaid gives a diamond and a rectangle differ by 3×, and
     reproducing that in a terminal just looks ragged. A box grows only when its
     label needs the extra rows to wrap. */
  const draft = nodes.map((n) => {
    const x0 = Math.min(px(n.box.x0), cols - 3);
    const x1 = Math.min(cols - 1, Math.max(px(n.box.x1), x0 + 2));
    const width = x1 - x0 + 1;
    const label = opts.showLabels ? n.label : '';
    const lines = width >= 3 ? wrapText(label, width - 2, 4) : [];
    return { node: n, lines, x0, x1, width, center: mapRow((n.box.y0 + n.box.y1) / 2) };
  });
  // One height for every box: mixing a 2-line wrap next to single-line labels
  // makes the whole diagram look torn. The tallest label wins.
  const boxHeight = Math.max(3, Math.max(1, ...draft.map((d) => d.lines.length)) * 2 + 1);
  const boxes = draft.map((d) => ({
    node: d.node,
    lines: d.lines,
    b: {
      x0: d.x0,
      y0: Math.max(0, d.center - Math.floor(boxHeight / 2)),
      x1: d.x1,
      y1: Math.max(0, d.center - Math.floor(boxHeight / 2)) + boxHeight - 1,
    },
  }));

  /* ---- rows: whatever the boxes, cluster frames and label rows need ---- */
  const neededRows = (): number => {
    let bottom = Math.max(3, Math.round(yLayout.size) + 1 + yOffset);
    for (const { b } of boxes) bottom = Math.max(bottom, b.y1 + 1);
    for (const c of clusters) {
      const members = boxes.filter((b) => containsBox(c.box, {
        x: (b.node.box.x0 + b.node.box.x1) / 2,
        y: (b.node.box.y0 + b.node.box.y1) / 2,
      }));
      if (!members.length) continue;
      bottom = Math.max(bottom, Math.max(...members.map((m) => m.b.y1)) + 2);
    }
    return Math.min(MAX_ROWS, bottom);
  };
  const rows = neededRows();
  const grid = new CharGrid(cols, rows);
  const py = (v: number): number => clampInt(mapRow(v), 0, rows - 1);
  const hitBoxes: Box[] = boxes.map(({ b }) => b);
  const insideAny = (x: number, y: number): boolean => grid.insideBox(hitBoxes, x, y);

  /* --- connectors first: boxes and labels then sit on top of them ---

     Mermaid anchors every connector on a node border, and that border cell
     belongs to the box, so "drop the points that are inside a box" erases short
     edges (and their arrow heads) completely. Instead the whole polyline is
     rasterised and only the cells that fall outside every box are drawn. */
  for (const edge of edges) {
    const pts = edge.points.map((p) => ({ x: px(p.x), y: py(p.y) }));
    const cells: Pt[] = [];
    for (let i = 1; i < pts.length; i += 1) {
      const seg = bresenham(pts[i - 1]!, pts[i]!);
      for (let s = i === 1 ? 0 : 1; s < seg.length; s += 1) cells.push(seg[s]!);
    }
    if (cells.length < 2) continue;

    const visible: number[] = [];
    for (let i = 0; i < cells.length; i += 1) {
      if (!insideAny(cells[i]!.x, cells[i]!.y)) visible.push(i);
    }
    if (!visible.length) continue;

    let run: Pt[] = [];
    const flush = (): void => {
      if (run.length >= 2) grid.line(run);
      else if (run.length === 1) grid.bit(run[0]!.x, run[0]!.y, E | W);
      run = [];
    };
    for (const cell of cells) {
      if (insideAny(cell.x, cell.y)) {
        flush();
        continue;
      }
      run.push(cell);
    }
    flush();

    const head = visible[0]!;
    const tail = visible[visible.length - 1]!;
    if (edge.arrowEnd) {
      const tip = cells[tail]!;
      const from = cells[tail - 1] ?? cells[Math.min(tail + 1, cells.length - 1)]!;
      grid.set(tip.x, tip.y, arrowGlyph(from, tip, opts.useAscii), S_EDGE);
    }
    if (edge.arrowStart) {
      const tip = cells[head]!;
      const from = cells[head + 1] ?? cells[Math.max(head - 1, 0)]!;
      grid.set(tip.x, tip.y, arrowGlyph(from, tip, opts.useAscii), S_EDGE);
    }
  }

  /* --- clusters: outline around their members, title baked into the top --- */
  const clusterRows = clusters
    .map((c) => ({
      cluster: c,
      members: boxes.filter((b) => {
        const p = { x: (b.node.box.x0 + b.node.box.x1) / 2, y: (b.node.box.y0 + b.node.box.y1) / 2 };
        return containsBox(c.box, p);
      }),
    }))
    .filter((c) => c.members.length > 0)
    .sort((a, b) => area(b.cluster.box) - area(a.cluster.box));

  const frames = clusterRows.map(({ cluster, members }) => ({
    label: cluster.label,
    members,
    gx0: Math.max(0, Math.min(...members.map((m) => m.b.x0)) - 1),
    gx1: Math.min(cols - 1, Math.max(...members.map((m) => m.b.x1)) + 1),
    gy0: Math.max(0, Math.min(...members.map((m) => m.b.y0)) - 2),
    gy1: Math.min(rows - 1, Math.max(...members.map((m) => m.b.y1)) + 1),
  }));
  // Side-by-side clusters share the single column between them; without this
  // clamp their frames interleave and the corner glyphs collide into nonsense.
  frames.sort((a, b) => a.gx0 - b.gx0);
  for (let i = 0; i + 1 < frames.length; i += 1) {
    const left = frames[i]!;
    const right = frames[i + 1]!;
    if (left.gx1 < right.gx0) continue;
    const ownMax = Math.max(...left.members.map((m) => m.b.x1));
    left.gx1 = Math.max(ownMax, right.gx0 - 1);
    const ownMin = Math.min(...right.members.map((m) => m.b.x0));
    if (left.gx1 >= right.gx0) right.gx0 = Math.min(ownMin, left.gx1 + 1);
  }

  for (const frame of frames) {
    const { gx0, gx1, gy0, gy1, label } = frame;
    if (gx1 - gx0 < 2 || gy1 - gy0 < 2) continue;
    grid.box(gx0, gy0, gx1, gy1, !opts.useAscii, S_CLUSTER_BOX, opts.useAscii);
    if (opts.showLabels && label) {
      const text = truncate(label, Math.max(0, gx1 - gx0 - 3));
      if (text) grid.text(gx0 + 2, gy0, text, S_CLUSTER_TEXT);
    }
  }

  /* --- nodes --- */
  for (const { node, lines, b } of boxes) {
    const width = b.x1 - b.x0 + 1;
    const height = b.y1 - b.y0 + 1;
    // centre of the *interior* span, so a label that exactly fills the box
    // does not eat its left border
    const centerX = (b.x0 + b.x1 + 1) >> 1;
    const label = opts.showLabels ? node.label : '';
    if (width >= 3 && height >= 3) {
      const rounded = !opts.useAscii && (node.shape === 'rounded' || node.shape === 'circle');
      grid.box(b.x0, b.y0, b.x1, b.y1, rounded, S_NODE_BOX, opts.useAscii);
      const centerY = Math.floor((b.y0 + b.y1) / 2) - Math.floor((lines.length - 1) / 2);
      lines.forEach((line, i) => grid.text(centerX, centerY + i, line, S_NODE_TEXT, 'center'));
    } else if (label) {
      grid.text(centerX, Math.floor((b.y0 + b.y1) / 2), truncate(decorate(label, node.shape), Math.max(width, 3)), S_NODE_TEXT, 'center');
    }
  }

  /* --- edge labels last: they may sit on top of their own connector --- */
  if (opts.showLabels) {
    for (const edge of edges) {
      if (!edge.label) continue;
      const anchor = edge.labelAt ?? edge.points[Math.floor(edge.points.length / 2)] ?? edge.points[0];
      if (!anchor) continue;
      const text = truncate(edge.label, 16);
      const cx = px(anchor.x);
      const cy = py(anchor.y);
      let placed = false;
      for (const dy of [0, -1, 1, -2, 2]) {
        const y = cy + dy;
        if (y < 0 || y >= rows) continue;
        if (overlapsAny(insideAny, cx - Math.floor(displayWidth(text) / 2), y, displayWidth(text))) continue;
        grid.text(cx, y, text, S_EDGE_LABEL, 'center');
        placed = true;
        break;
      }
      if (!placed && cy >= 0 && cy < rows) grid.text(cx, cy, text, S_EDGE_LABEL, 'center');
    }
  }

  return paint(grid, opts, tokens);
}

function containsBox(box: Box, p: Pt, slack = 1): boolean {
  return p.x >= box.x0 - slack && p.x <= box.x1 + slack && p.y >= box.y0 - slack && p.y <= box.y1 + slack;
}

function decorate(label: string, shape: ShapeKind): string {
  if (shape === 'diamond') return `<${label}>`;
  if (shape === 'circle' || shape === 'rounded') return `(${label})`;
  if (shape === 'hexagon') return `{${label}}`;
  return `[${label}]`;
}

function overlapsAny(insideAny: (x: number, y: number) => boolean, x0: number, y: number, width: number): boolean {
  for (let x = x0; x < x0 + width; x += 1) if (insideAny(x, y)) return true;
  return false;
}

/* ===================================================== sequence rendering */

interface Actor {
  id: string;
  name: string;
  centerX: number;
}

interface SeqItem {
  kind: 'message' | 'note' | 'loop';
  y: number;
  y1: number;
  label: string;
  from: string;
  to: string;
  arrowEnd: boolean;
  dashed: boolean;
  number?: string;
}

function parseSequence(svg: string): { actors: Actor[]; items: SeqItem[] } | undefined {
  const body = stripChrome(svg);
  const actors: Actor[] = [];
  const items: SeqItem[] = [];
  const numbers: { index: number; text: string }[] = [];
  const endpoints = new Map<string, number>();

  for (const slice of groupSlices(body)) {
    const et = attr(slice.attrs, 'data-et');
    if (et === 'participant') {
      const rect = /<rect\b([^>]*)>/.exec(slice.inner);
      if (!rect) continue;
      const rectAttrs = rect[1] ?? '';
      const x = numAttr(rectAttrs, 'x', 0);
      const w = numAttr(rectAttrs, 'width', 0);
      const text = /<text\b([^>]*)>([\s\S]*?)<\/text>/.exec(slice.inner);
      actors.push({
        id: attr(slice.attrs, 'data-id') ?? attr(rectAttrs, 'name') ?? `actor-${actors.length}`,
        name: text ? plainText(text[2] ?? '') : '',
        centerX: text ? numAttr(text[1] ?? '', 'x', x + w / 2) : x + w / 2,
      });
      continue;
    }
    if (et === 'note') {
      const rect = /<rect\b([^>]*)>/.exec(slice.inner);
      if (!rect) continue;
      const rectAttrs = rect[1] ?? '';
      const text = /<text\b[^>]*>([\s\S]*?)<\/text>/.exec(slice.inner);
      const y = numAttr(rectAttrs, 'y', 0);
      const h = numAttr(rectAttrs, 'height', 12);
      const x0 = numAttr(rectAttrs, 'x', 0);
      items.push({
        kind: 'note',
        y,
        y1: y + h,
        label: text ? plainText(text[1] ?? '') : '',
        from: String(x0),
        to: String(x0 + numAttr(rectAttrs, 'width', 0)),
        arrowEnd: false,
        dashed: false,
      });
      continue;
    }
    if (et === 'control-structure') {
      let x0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      eachTag(slice.inner, (tag) => {
        if (tag.name !== 'line') return;
        const ax = numAttr(tag.attrs, 'x1', 0);
        const ay = numAttr(tag.attrs, 'y1', 0);
        const bx = numAttr(tag.attrs, 'x2', 0);
        const by = numAttr(tag.attrs, 'y2', 0);
        x0 = Math.min(x0, ax, bx);
        x1 = Math.max(x1, ax, bx);
        y0 = Math.min(y0, ay, by);
        y1 = Math.max(y1, ay, by);
      });
      if (!Number.isFinite(y0)) continue;
      const loopText = /<text[^>]*class="[^"]*loopText[^"]*"[^>]*>([\s\S]*?)<\/text>/.exec(slice.inner);
      const labelText = /<text[^>]*class="[^"]*labelText[^"]*"[^>]*>([\s\S]*?)<\/text>/.exec(slice.inner);
      items.push({
        kind: 'loop',
        y: y0,
        y1,
        label: `${plainText(labelText?.[1] ?? 'loop')} ${plainText(loopText?.[1] ?? '')}`.trim(),
        from: String(x0),
        to: String(x1),
        arrowEnd: false,
        dashed: false,
      });
    }
  }

  /* text/line events in document order, so labels pair with their own arrow */
  interface Event {
    index: number;
    kind: 'text' | 'message' | 'number';
    text: string;
    attrs: string;
  }
  const events: Event[] = [];
  const textRe = /<text\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = textRe.exec(body))) {
    const attrs = m[1] ?? '';
    const cls = classOf(attrs);
    if (/\bmessageText\b/.test(cls)) events.push({ index: m.index, kind: 'text', text: plainText(m[2] ?? ''), attrs });
    else if (/\bsequenceNumber\b/.test(cls)) events.push({ index: m.index, kind: 'number', text: plainText(m[2] ?? ''), attrs });
  }
  const lineRe = /<line\b((?:[^>"']|"[^"]*"|'[^']*')*)(\/?)>/g;
  while ((m = lineRe.exec(body))) {
    const attrs = m[1] ?? '';
    if (!/\bmessageLine[01]\b/.test(classOf(attrs))) continue;
    if (numAttr(attrs, 'stroke-width', 1) === 0) continue;
    events.push({ index: m.index, kind: 'message', text: classOf(attrs), attrs });
  }
  events.sort((a, b) => a.index - b.index);

  // Pre-collect the autonumber labels: they follow their message line in the
  // document, so a single forward pass would never see them in time.
  for (const event of events) {
    if (event.kind === 'number') numbers.push({ index: event.index, text: event.text });
  }

  const pendingTexts: { index: number; text: string }[] = [];
  for (const event of events) {
    if (event.kind === 'text') {
      pendingTexts.push({ index: event.index, text: event.text });
      continue;
    }
    if (event.kind === 'number') continue;
    const attrs = event.attrs;
    const y = numAttr(attrs, 'y1', 0);
    const from = attr(attrs, 'data-from') ?? '';
    const to = attr(attrs, 'data-to') ?? '';
    endpoints.set(from, numAttr(attrs, 'x1', endpoints.get(from) ?? 0));
    endpoints.set(to, numAttr(attrs, 'x2', endpoints.get(to) ?? 0));
    const idx = pendingTexts.length - 1;
    const label = idx >= 0 ? pendingTexts[idx]!.text : '';
    if (idx >= 0) pendingTexts.splice(idx, 1);
    const num = numbers.find((n) => n.index > event.index);
    if (num) numbers.splice(numbers.indexOf(num), 1);
    items.push({
      kind: 'message',
      y,
      y1: y,
      label,
      from,
      to,
      dashed: /messageLine1/.test(event.text),
      arrowEnd: Boolean(attr(attrs, 'marker-end')),
      number: num?.text,
    });
  }

  if (!actors.length) {
    // Older/other mermaid builds may not mark participants; fall back to the
    // endpoints seen on the message lines.
    let i = 0;
    for (const [id, x] of [...endpoints.entries()].sort((a, b) => a[1] - b[1])) {
      actors.push({ id, name: id, centerX: x === 0 ? i * 60 : x });
      i += 1;
    }
  }
  if (!actors.length && !items.length) return undefined;
  // Mermaid emits participants in reverse layout order; the drawing reads
  // left-to-right, so order them by the x of their lifeline.
  actors.sort((a, b) => a.centerX - b.centerX);
  items.sort((a, b) => a.y - b.y || a.label.localeCompare(b.label));
  return { actors, items };
}

interface SeqRow {
  text?: string;
  center?: number;
  draw?: (grid: CharGrid, y: number) => void;
}

function renderSequence(svg: string, opts: ResolvedAsciiOptions, tokens: ThemeTokens | undefined): string | undefined {
  const parsed = parseSequence(svg);
  if (!parsed || !parsed.actors.length) return undefined;
  const { actors, items } = parsed;
  const budget = Math.max(10, opts.maxWidth - opts.padding * 2);

  /* --- actor columns: a box per name, gaps wide enough for the arrows --- */
  const boxWidths = actors.map((a) => Math.max(3, displayWidth(a.name) + 4));
  const index = new Map(actors.map((a, i) => [a.id, i]));
  const gaps: number[] = new Array(Math.max(0, actors.length - 1)).fill(3);
  for (const item of items) {
    const i = index.get(item.from);
    const j = index.get(item.to);
    if (i === undefined || j === undefined || item.kind !== 'message') continue;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    if (hi - lo === 0 || hi - lo > gaps.length) continue;
    const per = Math.ceil((displayWidth(item.label) + 2) / (hi - lo));
    for (let k = lo; k < hi; k += 1) gaps[k] = Math.max(gaps[k] ?? 3, per);
  }

  const total = (): number => boxWidths.reduce((s, v) => s + v, 0) + gaps.reduce((s, v) => s + v, 0);
  let guard = 0;
  while (total() > budget && guard < 5000) {
    guard += 1;
    let gapIdx = -1;
    let gapBest = 1;
    for (let i = 0; i < gaps.length; i += 1) {
      if (gaps[i]! > gapBest) {
        gapBest = gaps[i]!;
        gapIdx = i;
      }
    }
    if (gapIdx >= 0) {
      gaps[gapIdx] = gapBest - 1;
      continue;
    }
    let sizeIdx = -1;
    let sizeBest = 6;
    for (let i = 0; i < boxWidths.length; i += 1) {
      if (boxWidths[i]! > sizeBest) {
        sizeBest = boxWidths[i]!;
        sizeIdx = i;
      }
    }
    if (sizeIdx < 0) break;
    boxWidths[sizeIdx] = sizeBest - 1;
  }

  const cols = Math.min(budget, Math.max(3, total()));
  const starts: number[] = [];
  const centers: number[] = [];
  {
    let cursor = 0;
    actors.forEach((_, i) => {
      starts.push(cursor);
      centers.push(cursor + Math.floor(boxWidths[i]! / 2));
      cursor += boxWidths[i]!;
      if (i < gaps.length) cursor += gaps[i]!;
    });
  }
  const anchors: Anchor[] = actors
    .map((a, i) => ({ p: a.centerX, c: centers[i]! }))
    .sort((a, b) => a.p - b.p);
  const px = (v: number): number => clampInt(interp(anchors, v), 0, cols - 1);

  /* --- rows: label row above each arrow, frames around notes/loops --- */
  const rowsOut: SeqRow[] = [];
  const emit = (list: SeqItem[]): void => {
    const sorted = [...list].sort((a, b) => a.y - b.y || a.label.localeCompare(b.label));
    const consumed = new Set<SeqItem>();
    for (const item of sorted) {
      if (consumed.has(item)) continue;
      if (item.kind === 'loop') {
        const inner = sorted.filter((o) => o !== item && o.y > item.y && o.y < item.y1);
        inner.forEach((o) => consumed.add(o));
        const x0 = clampInt(px(Number(item.from)), 0, cols - 1);
        const x1 = clampInt(px(Number(item.to)), 0, cols - 1);
        const title = truncate(item.label, Math.max(0, Math.abs(x1 - x0) - 3));
        rowsOut.push({
          draw: (grid, y) => {
            grid.frameRow(x0, x1, y, S_NOTE, opts.useAscii);
            if (opts.showLabels && title) grid.text(Math.min(x0, x1) + 2, y, ` ${title} `, S_NOTE);
          },
        });
        emit(inner);
        rowsOut.push({ draw: (grid, y) => grid.frameRow(x0, x1, y, S_NOTE, opts.useAscii) });
        continue;
      }
      if (item.kind === 'note') {
        const x0 = clampInt(px(Number(item.from)), 0, cols - 1);
        const x1 = clampInt(px(Number(item.to)), 0, cols - 1);
        const left = Math.min(x0, x1);
        const right = Math.max(x0, x1);
        rowsOut.push({
          draw: (grid, y) => {
            grid.frameRow(left, right, y, S_NOTE, opts.useAscii);
            if (opts.showLabels && item.label) {
              grid.text(left + 2, y, ` ${truncate(item.label, Math.max(0, right - left - 3))} `, S_NOTE);
            }
          },
        });
        continue;
      }
      const i = index.get(item.from);
      const j = index.get(item.to);
      const text = item.number ? `${item.number}. ${item.label}` : item.label;
      if (i === undefined || j === undefined) continue;
      if (i === j) {
        rowsOut.push({
          text,
          center: centers[i]!,
          draw: (grid, y) => grid.text(centers[i]!, y, opts.useAscii ? 'o' : '⟲', S_EDGE, 'center'),
        });
        continue;
      }
      const a = centers[i]!;
      const b = centers[j]!;
      const left = Math.min(a, b);
      const right = Math.max(a, b);
      rowsOut.push({ text, center: Math.round((a + b) / 2) });
      rowsOut.push({
        draw: (grid, y) => {
          const char = item.dashed ? (opts.useAscii ? '-' : '┄') : opts.useAscii ? '-' : '─';
          for (let x = left; x <= right; x += 1) grid.set(x, y, char, S_EDGE);
          const tip = b > a ? { x: right, y } : { x: left, y };
          const tail = b > a ? { x: left, y } : { x: right, y };
          grid.set(tip.x, y, arrowGlyph(tail, tip, opts.useAscii), S_EDGE);
        },
      });
    }
  };
  emit(items);

  const totalRows = 3 + rowsOut.length + 1;
  const grid = new CharGrid(cols, Math.min(MAX_ROWS, totalRows));

  // Lifelines run behind every event row.
  for (let i = 0; i < actors.length; i += 1) {
    const x = centers[i]!;
    for (let y = 3; y < grid.h; y += 1) grid.bit(x, y, N | S);
  }

  actors.forEach((actor, i) => {
    const x0 = starts[i]!;
    grid.box(x0, 0, Math.min(cols - 1, x0 + boxWidths[i]! - 1), 2, !opts.useAscii, S_ACTOR_BOX, opts.useAscii);
    if (opts.showLabels && actor.name) {
      grid.text(centers[i]!, 1, truncate(actor.name, Math.max(0, boxWidths[i]! - 2)), S_ACTOR_TEXT, 'center');
    }
  });

  rowsOut.forEach((row, i) => {
    const y = 3 + i;
    if (row.text !== undefined && opts.showLabels) {
      grid.text(row.center ?? Math.floor(cols / 2), y, truncate(row.text, Math.max(0, cols - 2)), S_EDGE_LABEL, 'center');
    }
    row.draw?.(grid, y);
  });

  return paint(grid, opts, tokens);
}

/* ========================================================== pie rendering */

function renderPie(svg: string, opts: ResolvedAsciiOptions, tokens: ThemeTokens | undefined): string | undefined {
  const body = stripChrome(svg);
  const titleMatch = /<text[^>]*class="[^"]*pieTitleText[^"]*"[^>]*>([\s\S]*?)<\/text>/.exec(body);
  const values: number[] = [];
  const sliceRe = /<text[^>]*class="[^"]*slice[^"]*"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = sliceRe.exec(body))) {
    const n = Number.parseFloat(plainText(m[1] ?? '').replace('%', ''));
    if (Number.isFinite(n)) values.push(n);
  }
  const labels: string[] = [];
  const legendRe = /<g[^>]*class="[^"]*legend[^"]*"[^>]*>([\s\S]*?)<\/g>/g;
  while ((m = legendRe.exec(body))) {
    const text = /<text[^>]*>([\s\S]*?)<\/text>/.exec(m[1] ?? '');
    labels.push(plainText(text?.[1] ?? '').replace(/\s*\[\d+(?:\.\d+)?\]\s*$/, ''));
  }
  const title = plainText(titleMatch?.[1] ?? '');
  if (!values.length) {
    const texts = collectTexts(body);
    if (!texts.length) return undefined;
    return paintRows(texts.slice(0, 24), opts, tokens, title || (texts[0] ?? ''));
  }

  const labelWidth = Math.max(0, ...labels.map((l) => displayWidth(l)));
  const barBudget = Math.max(4, Math.min(40, opts.maxWidth - opts.padding * 2 - labelWidth - 8));
  const max = Math.max(...values);
  const barChar = opts.useAscii ? '#' : '█';
  const lines = values.map((value, i) => {
    const label = labels[i] ?? `slice ${i + 1}`;
    const bar = barChar.repeat(Math.max(0, Math.round((value / max) * barBudget)));
    return `${label.padEnd(labelWidth)}  ${bar} ${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
  });
  return paintRows(lines, opts, tokens, title);
}

/* ============================================================== fallbacks */

function fallbackSvg(svg: string, reason: string, opts: ResolvedAsciiOptions, tokens: ThemeTokens | undefined): string {
  const typeMatch = /aria-roledescription="([^"]*)"/i.exec(svg);
  const type = typeMatch?.[1] ?? 'unknown';
  const texts = svg.includes('<') ? collectTexts(stripChrome(svg)) : [];
  const lines = [`${ASCII_FALLBACK_PREFIX} ${reason}`, `${ASCII_FALLBACK_PREFIX} diagram type: ${type}`];
  if (texts.length) {
    lines.push(`${ASCII_FALLBACK_PREFIX} text found:`);
    for (const text of texts.slice(0, 24)) lines.push(`  - ${truncate(text, Math.max(8, opts.maxWidth - 4))}`);
    if (texts.length > 24) lines.push(`  … ${texts.length - 24} more`);
  }
  return paintRows(lines, opts, tokens, '');
}

/* ================================================================ painter */

function colourCodes(tokens: ThemeTokens | undefined): Map<number, string> {
  const map = new Map<number, string>();
  if (!tokens || !tokens.colors) return map;
  const { colors } = tokens;
  const roles: [number, string][] = [
    [S_NODE_TEXT, colors.nodeText],
    [S_NODE_BOX, colors.nodeStroke],
    [S_EDGE, colors.edge],
    [S_EDGE_LABEL, colors.edgeLabelText],
    [S_CLUSTER_TEXT, colors.clusterText],
    [S_CLUSTER_BOX, colors.clusterStroke],
    [S_TITLE, colors.accent],
    [S_ACTOR_TEXT, colors.nodeText],
    [S_ACTOR_BOX, colors.nodeStroke],
    [S_NOTE, colors.edgeLabelText],
  ];
  for (const [id, colour] of roles) {
    const rgba = parseColor(colour);
    if (!rgba) continue;
    map.set(id, `38;2;${Math.round(rgba.r)};${Math.round(rgba.g)};${Math.round(rgba.b)}`);
  }
  return map;
}

function padLimits(opts: ResolvedAsciiOptions): { pad: number; inner: number } {
  const pad = Math.max(0, Math.min(opts.padding, Math.floor((opts.maxWidth - 1) / 2)));
  return { pad, inner: Math.max(1, opts.maxWidth - pad * 2) };
}

function stripAnsi(text: string): string {
  const esc = String.fromCharCode(27);
  return text.split(`${esc}[`).map((part, i) => (i === 0 ? part : part.replace(/^[0-9;]*m/, ''))).join('');
}

/** Painter for plain line lists (pie charts, fallbacks, text dumps). */
function paintRows(lines: string[], opts: ResolvedAsciiOptions, tokens: ThemeTokens | undefined, title = ''): string {
  // Plain text output (fallbacks, pie charts, titles) gets no left margin: the
  // first line has to stay recognisable at column 0.
  const inner = Math.max(1, opts.maxWidth);
  const body = title ? [title, '', ...lines] : lines;
  const rendered = (body.length ? body : ['']).map((line) => truncate(line, inner));
  const width = Math.min(opts.maxWidth, Math.max(1, ...rendered.map((line) => displayWidth(line))));
  const codes = opts.colour ? colourCodes(tokens) : undefined;
  return rendered
    .map((line, i) => {
      const styled =
        codes && title && i === 0 && line
          ? `${String.fromCharCode(27)}[${codes.get(S_TITLE) ?? '39'}m${line}${String.fromCharCode(27)}[0m`
          : line;
      const fill = Math.max(0, width - displayWidth(line));
      return `${styled}${' '.repeat(fill)}`;
    })
    .join('\n');
}

/** Painter for the character grid. Every line is exactly `width` columns. */
function paint(grid: CharGrid, opts: ResolvedAsciiOptions, tokens: ThemeTokens | undefined): string {
  const { pad, inner } = padLimits(opts);
  const cols = Math.min(grid.w, inner);
  const capped = grid.h > MAX_ROWS;
  let rows = Math.min(grid.h, MAX_ROWS);
  // Blank rows above and below the drawing are pure noise in a terminal.
  while (rows > 1 && grid.row(rows - 1, true).every((cell) => cell === ' ' || cell === '')) rows -= 1;
  let top = 0;
  while (top < rows - 1 && grid.row(top, true).every((cell) => cell === ' ' || cell === '')) top += 1;
  const codes = opts.colour ? colourCodes(tokens) : undefined;
  const esc = String.fromCharCode(27);
  const width = Math.min(opts.maxWidth, pad * 2 + cols);
  const out: string[] = [];

  for (let y = top; y < rows; y += 1) {
    const cells = grid.row(y, opts.useAscii);
    let line = '';
    let current = -1;
    for (let x = 0; x < cols; x += 1) {
      const cell = cells[x] ?? ' ';
      if (cell === '') continue; // second half of a wide glyph: already covered
      const style = cell === ' ' ? S_PLAIN : grid.styleAt(x, y);
      if (codes && style !== current) {
        const code = codes.get(style);
        line += code ? `${esc}[${code}m` : `${esc}[39m`;
        current = style;
      }
      line += cell;
    }
    if (codes && current !== -1) line += `${esc}[0m`;
    const plain = displayWidth(stripAnsi(line));
    out.push(`${' '.repeat(pad)}${line}${' '.repeat(Math.max(0, width - pad - plain - pad))}${' '.repeat(pad)}`);
  }
  if (capped) out.push(`${ASCII_FALLBACK_PREFIX} output truncated at ${MAX_ROWS} rows`);
  return out.join('\n');
}

/* ================================================================== entry */

function resolveOptions(options: AsciiOptions | undefined): ResolvedAsciiOptions {
  const raw = options ?? {};
  const maxWidth = Number.isFinite(raw.maxWidth) && (raw.maxWidth ?? 0) > 0 ? Math.floor(raw.maxWidth!) : 120;
  const padding = Number.isFinite(raw.padding) && (raw.padding ?? -1) >= 0 ? Math.floor(raw.padding!) : 1;
  return {
    maxWidth: Math.max(4, maxWidth),
    padding: Math.max(0, padding),
    useAscii: raw.useAscii === true,
    showLabels: raw.showLabels !== false,
    colour: raw.colour === true,
  };
}

/**
 * Render an SVG string (straight from `render()`) as ASCII/Unicode art.
 *
 * Never throws: unrecognised input, diagram families without a graph model and
 * internal errors all come back as a string whose every line starts with
 * `ASCII_FALLBACK_PREFIX`.
 */
export function asciiFromSvg(svg: string, options?: AsciiOptions): string {
  const opts = resolveOptions(options);
  const tokens = tryTokens({});
  const source = typeof svg === 'string' ? svg : '';
  try {
    return dispatch(source, opts, tokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallbackSvg(source, `renderer error: ${message}`, opts, tokens);
  }
}

/**
 * Theme tokens, or `undefined` when they cannot be resolved. Colour is the only
 * consumer, so a broken theme must never take the whole drawing down with it.
 */
function tryTokens(options: RenderOptions): ThemeTokens | undefined {
  try {
    return resolveTheme(options).tokens;
  } catch {
    return undefined;
  }
}

function dispatch(svg: string, opts: ResolvedAsciiOptions, tokens: ThemeTokens | undefined): string {
  // Diagram-family sniffing must look at markup only: our own stylesheet
  // mentions `.actor-line`, `.messageLine0` and `.pieCircle` selectors, and a
  // naive `svg.includes(...)` would classify every flowchart as a sequence.
  const body = stripChrome(svg);
  if (!body.trim()) return fallbackSvg(svg, 'empty input', opts, tokens);

  if (/actor-line|messageLine[01]|aria-roledescription="sequence"/.test(body)) {
    const rendered = renderSequence(body, opts, tokens);
    if (rendered) return rendered;
  }
  if (/pieTitleText|pieCircle|aria-roledescription="pie"/.test(body)) {
    const rendered = renderPie(body, opts, tokens);
    if (rendered) return rendered;
  }

  const model = parseGraph(body);
  if (!model.nodes.length && !model.edges.length) {
    return fallbackSvg(svg, 'unsupported or unrecognised SVG — no graph structure found', opts, tokens);
  }
  return renderGraph(model, opts, tokens);
}

/**
 * `render()` + `asciiFromSvg()` in one call. `render()` is imported lazily so
 * this module stays importable in plain Node (no DOM, no mermaid at load time).
 */
export async function renderAscii(
  source: string,
  options: (RenderOptions & AsciiOptions) | undefined = undefined,
): Promise<string> {
  const { render } = await import('./render.js');
  const result = await render(source, options);
  const opts = resolveOptions(options);
  // Use the very tokens `render()` resolved, so CLI `--preset` colours match.
  const tokens = tryTokens(options ?? {});
  try {
    return dispatch(result.svg, opts, tokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallbackSvg(result.svg, `renderer error: ${message}`, opts, tokens);
  }
}

