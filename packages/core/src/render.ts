import { contrastText, mix, withAlpha } from './color.js';
import type { MermaidConfigLike, MermaidLike, Palette, RenderOptions, RenderResult } from './types.js';
import { resolveTheme } from './theme.js';
import { postProcessSvg } from './svg.js';

/** Thrown when mermaid rejects the diagram source or the host has no DOM. */
export class RenderError extends Error {
  readonly source?: string;
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown, source?: string) {
    super(message);
    this.name = 'RenderError';
    this.cause = cause;
    this.source = source;
  }
}

let idCounter = 0;

function nextId(): string {
  return `neom${Date.now().toString(36)}${(idCounter++).toString(36)}`;
}

/** Ids end up in CSS selectors and `url(#…)` references — keep them tame. */
export function sanitizeId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const clean = id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
  return clean.length ? clean : undefined;
}

/**
 * mermaid's render mutates module-global config, so concurrent renders race.
 * Every render goes through this chain.
 */
let renderChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = renderChain.then(task, task);
  renderChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function resolveMermaidInstance(options: RenderOptions): Promise<MermaidLike> {
  if (options.mermaidInstance) return options.mermaidInstance;

  const globalScope = globalThis as unknown as Record<string, unknown>;
  const injected = globalScope.mermaid as { default?: MermaidLike } & MermaidLike | undefined;
  if (injected && typeof injected.render === 'function') return injected;
  if (injected?.default && typeof injected.default.render === 'function') return injected.default;

  try {
    const mod = (await import('mermaid')) as unknown as { default?: MermaidLike } & MermaidLike;
    const candidate = (mod.default ?? mod) as MermaidLike;
    if (typeof candidate.render === 'function') return candidate;
  } catch (error) {
    throw new RenderError(
      'Could not load mermaid. Pass `mermaidInstance`, expose a global `mermaid`, or install the `mermaid` package.',
      error,
    );
  }

  throw new RenderError('No usable mermaid instance found.');
}

/**
 * Mermaid's multi-series families (pie slices, git branches, quadrants, timeline
 * bands) read colours from numbered theme variables that default to a single
 * hue — which is why an untouched pie chart comes out monochrome. Build a real
 * ramp from the palette instead.
 */
export function seriesPalette(palette: Palette, count = 12): string[] {
  const base = [
    palette.hues.blue,
    palette.hues.cyan,
    palette.hues.green,
    palette.hues.yellow,
    palette.hues.orange,
    palette.hues.red,
    palette.hues.purple,
    palette.hues.pink,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const hue = base[i % base.length]!;
    const cycle = Math.floor(i / base.length);
    // Second and third passes are shifted. Some schemes (Monokai) genuinely reuse
    // a hue across slots, so keep nudging until every slice is distinguishable.
    let colour = cycle === 0 ? hue : cycle === 1 ? mix(hue, '#ffffff', 0.32) : mix(hue, '#000000', 0.3);
    let guard = 0;
    while (seen.has(colour) && guard < 10) {
      colour = mix(colour, guard % 2 === 0 ? '#ffffff' : '#000000', 0.18);
      guard += 1;
    }
    seen.add(colour);
    out.push(colour);
  }
  return out;
}

/**
 * Translate our tokens into mermaid's own configuration. This matters beyond
 * cosmetics: mermaid measures every label through its theme typography, so the
 * font family/size must be configured *before* layout or text would overflow.
 */
export function buildMermaidConfig(options: RenderOptions): MermaidConfigLike {
  const { tokens, palette } = resolveTheme(options);
  const { colors, typography: t, effects: e } = tokens;
  const fontFamily = t.fontFamily;
  const fontSize = `${t.fontSize}px`;
  const series = seriesPalette(palette, 12);

  const themeVariables: Record<string, string> = {
    fontFamily,
    fontSize,
    primaryColor: colors.nodeFill,
    primaryTextColor: colors.nodeText,
    primaryBorderColor: colors.nodeStroke,
    secondaryColor: colors.nodeFillAlt,
    secondaryTextColor: colors.nodeText,
    secondaryBorderColor: colors.nodeStroke,
    tertiaryColor: colors.clusterFill,
    tertiaryTextColor: colors.clusterText,
    tertiaryBorderColor: colors.clusterStroke,
    lineColor: colors.edge,
    textColor: colors.nodeText,
    mainBkg: colors.nodeFill,
    nodeBorder: colors.nodeStroke,
    nodeTextColor: colors.nodeText,
    clusterBkg: colors.clusterFill,
    clusterBorder: colors.clusterStroke,
    titleColor: colors.nodeText,
    edgeLabelBackground: colors.edgeLabelBg,
    labelBackground: colors.edgeLabelBg,
    defaultLinkColor: colors.edge,
    // Sequence / state / class families read the same slots.
    actorBkg: colors.nodeFill,
    actorBorder: colors.nodeStroke,
    actorTextColor: colors.nodeText,
    actorLineColor: colors.edge,
    signalColor: colors.edge,
    signalTextColor: colors.nodeText,
    labelBoxBkgColor: colors.nodeFill,
    labelBoxBorderColor: colors.nodeStroke,
    labelTextColor: colors.nodeText,
    loopTextColor: colors.clusterText,
    noteBkgColor: colors.nodeFillAlt,
    noteBorderColor: colors.accent,
    noteTextColor: colors.nodeText,
    activationBkgColor: colors.nodeFillAlt,
    activationBorderColor: colors.nodeStroke,
    classText: colors.nodeText,
    fillType0: colors.nodeFill,
    fillType1: colors.nodeFillAlt,
    fillType2: colors.clusterFill,
    // Sequence diagrams colour the autonumber text through an id selector.
    sequenceNumberColor: contrastText(colors.accent),
    ...Object.fromEntries(series.map((colour, i) => [`pie${i + 1}`, colour])),
    ...Object.fromEntries(series.map((colour, i) => [`cScale${i}`, colour])),
    ...Object.fromEntries(series.map((colour, i) => [`cScaleInv${i}`, mix(colour, '#000000', 0.35)])),
    ...Object.fromEntries(series.map((colour, i) => [`cScaleLabel${i}`, contrastText(colour)])),
    ...Object.fromEntries(series.slice(0, 8).map((colour, i) => [`git${i}`, colour])),
    quadrant1Fill: withAlpha(series[0]!, 0.25, colors.nodeFillAlt),
    quadrant2Fill: withAlpha(series[2]!, 0.25, colors.nodeFillAlt),
    quadrant3Fill: withAlpha(series[5]!, 0.25, colors.nodeFillAlt),
    quadrant4Fill: withAlpha(series[5]!, 0.18, colors.nodeFillAlt),
    quadrant1TextFill: colors.nodeText,
    quadrant2TextFill: colors.nodeText,
    quadrant3TextFill: colors.nodeText,
    quadrant4TextFill: colors.nodeText,
    quadrantPointFill: colors.accent,
    quadrantPointTextFill: colors.nodeText,
    quadrantXAxisTextFill: colors.clusterText,
    quadrantYAxisTextFill: colors.clusterText,
    quadrantInternalBorderStrokeFill: colors.clusterStroke,
    quadrantExternalBorderStrokeFill: colors.nodeStroke,
  };

  const config: MermaidConfigLike = {
    startOnLoad: false,
    // `loose` keeps `classDef … style` and rich labels working, matching what
    // people expect from the official preview. Override for untrusted input.
    securityLevel: 'loose',
    theme: 'base',
    fontFamily,
    fontSize,
    themeVariables,
    flowchart: {
      useMaxWidth: false,
      htmlLabels: true,
      curve: 'basis',
      padding: 10,
      nodeSpacing: 45,
      rankSpacing: 45,
      diagramPadding: 8,
    },
    sequence: { useMaxWidth: false, boxMargin: 8, mirrorActors: false, wrap: false },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    er: { useMaxWidth: false },
    gantt: { useMaxWidth: false, barHeight: 22, barGap: 6, topPadding: 50, gridLineStartPadding: 30 },
    pie: { useMaxWidth: false },
    journey: { useMaxWidth: false },
    mindmap: { useMaxWidth: false },
    timeline: { useMaxWidth: false },
    gitGraph: { useMaxWidth: false },
    quadrantChart: { useMaxWidth: false },
    ...(e.sketch ? { look: 'handDrawn' } : {}),
    ...(options.mermaid ?? {}),
  };

  return config;
}

/** Remove the scratch nodes mermaid parks in `document.body` when it fails. */
function cleanupScratch(id: string): void {
  const body = globalThis.document?.body;
  if (!body) return;
  for (const selector of [`#d${id}`, `#${id}`]) {
    try {
      for (const el of Array.from(body.querySelectorAll(selector))) {
        el.remove();
      }
    } catch {
      /* ignore */
    }
  }
}

function describeMermaidError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || 'mermaid failed to render the diagram';
}

/**
 * Render mermaid source into a themed, standalone SVG.
 *
 * Requires a DOM (browser, webview, headless page). Hosts that live in Node —
 * see `@neomermaid/cli` — run this inside a headless browser.
 */
export async function render(source: string, options: RenderOptions = {}): Promise<RenderResult> {
  if (typeof source !== 'string' || !source.trim()) {
    throw new RenderError('Diagram source is empty.', undefined, source);
  }
  if (!globalThis.document) {
    throw new RenderError(
      'NeoMermaid core needs a DOM. In Node, run it inside @neomermaid/cli or a headless browser.',
      undefined,
      source,
    );
  }

  const resolved = resolveTheme(options);
  const mermaid = await resolveMermaidInstance(options);
  const id = sanitizeId(options.id) ?? nextId();

  let raw: string;
  try {
    raw = await enqueue(async () => {
      mermaid.initialize(buildMermaidConfig(options));
      const out = await mermaid.render(id, source);
      return typeof out === 'string' ? out : out.svg;
    });
  } catch (error) {
    cleanupScratch(id);
    throw new RenderError(describeMermaidError(error), error, source);
  }

  const processed = postProcessSvg({
    svg: raw,
    id,
    tokens: resolved.tokens,
    background: options.background,
    padding: options.padding,
    extraCss: options.extraCss,
  });

  return {
    svg: processed.svg,
    width: processed.width,
    height: processed.height,
    theme: resolved.theme.id,
    palette: resolved.palette.id,
    preset: resolved.preset,
    appearance: resolved.appearance,
    background: processed.background,
    warnings: processed.warnings,
  };
}

/** Convenience for preview surfaces: render and drop the SVG into an element. */
export async function renderToElement(
  container: Element,
  source: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const result = await render(source, options);
  container.innerHTML = result.svg;
  const svg = container.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', 'auto');
  }
  return result;
}

/** Validate syntax without styling. Returns an error message list. */
export async function validate(source: string, options: RenderOptions = {}): Promise<string[]> {
  try {
    await render(source, options);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}
