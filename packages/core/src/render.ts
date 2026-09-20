import { contrastText, mix, withAlpha } from './color.js';
import { readOn, readablePair } from './contrast.js';
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
 * Series colours for the multi-series families, paired with a label colour that
 * is *measured* to be readable on each fill. Fills may be nudged along their
 * luminance axis when a mid-tone leaves no room for a legible label (mid-tones
 * such as dracula's `#6272a4` cap out at ~4.2:1 with white), which is the
 * difference between a pretty ramp and a readable one.
 */
export function readableSeries(palette: Palette, count = 12): SeriesColors {
  const pairs = seriesPalette(palette, count).map((fill) => readablePair(fill));
  return {
    fills: pairs.map((p) => p.fill),
    labels: pairs.map((p) => p.label),
  };
}

export interface SeriesColors {
  /** Series fills, safe to paint labels on. */
  fills: string[];
  /** Label colour that passes WCAG AA on the matching fill. */
  labels: string[];
}

/** Flowchart/graph direction header — the only thing we are allowed to re-aim. */
const FLOW_HEADER = /^([^\S\n]*)(flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/m;
const FLOW_ANY = /^([^\S\n]*)(flowchart|graph)\b/m;

export type FlowDirection = 'TB' | 'TD' | 'BT' | 'LR' | 'RL';

/** The direction written in the source, if the source states one. */
export function sourceDirection(source: string): FlowDirection | null {
  const hit = FLOW_HEADER.exec(source);
  return (hit?.[3] as FlowDirection | undefined) ?? null;
}

/**
 * Rewrite (or add) the direction of a flowchart/graph. Anything that is not a
 * flowchart is returned untouched, so this can never damage another family's
 * syntax. `TD`/`TB` are synonyms to mermaid.
 */
export function withDirection(source: string, direction: FlowDirection): string {
  if (FLOW_HEADER.test(source)) {
    return source.replace(FLOW_HEADER, (_match, pad: string, keyword: string) => `${pad}${keyword} ${direction}`);
  }
  if (FLOW_ANY.test(source)) {
    return source.replace(FLOW_ANY, (_match, pad: string, keyword: string) => `${pad}${keyword} ${direction}`);
  }
  return source;
}

/** The opposite orientation: tall diagrams become wide, wide ones become tall. */
function flipDirection(direction: FlowDirection): FlowDirection {
  return direction === 'LR' || direction === 'RL' ? 'TB' : 'LR';
}

/** `TD` and `TB` are the same direction to mermaid. */
function sameDirection(a: FlowDirection, b: FlowDirection): boolean {
  const norm = (d: FlowDirection) => (d === 'TD' ? 'TB' : d);
  return norm(a) === norm(b);
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
  const series = readableSeries(palette, 12);
  const layout = options.layout ?? {};

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
    sequenceNumberColor: readOn(colors.accent),
    ...Object.fromEntries(series.fills.map((colour, i) => [`pie${i + 1}`, colour])),
    ...Object.fromEntries(series.fills.map((colour, i) => [`cScale${i}`, colour])),
    ...Object.fromEntries(series.fills.map((colour, i) => [`cScaleInv${i}`, mix(colour, '#000000', 0.35)])),
    // The numbered *label* variables are what git branch pills, timeline bands and
    // pie labels actually read. Leaving them unset (or setting them from a single
    // token) paints white text on cyan at 1.01:1 — invisible.
    ...Object.fromEntries(series.labels.map((colour, i) => [`cScaleLabel${i}`, colour])),
    ...Object.fromEntries(series.labels.map((colour, i) => [`gitBranchLabel${i}`, colour])),
    ...Object.fromEntries(series.fills.slice(0, 8).map((colour, i) => [`git${i}`, colour])),
    quadrant1Fill: withAlpha(series.fills[0]!, 0.25, colors.nodeFillAlt),
    quadrant2Fill: withAlpha(series.fills[2]!, 0.25, colors.nodeFillAlt),
    quadrant3Fill: withAlpha(series.fills[5]!, 0.25, colors.nodeFillAlt),
    quadrant4Fill: withAlpha(series.fills[5]!, 0.18, colors.nodeFillAlt),
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
    /*
     * XY charts ship their own light plot background and axis colours, so a dark
     * theme rendered white text on a white canvas — measured 1.02:1, i.e. axis
     * labels you cannot see. Paint the plot with the theme's surface instead.
     */
    'xyChart.backgroundColor': colors.nodeFill,
    'xyChart.titleColor': colors.nodeText,
    'xyChart.xAxisLabelColor': colors.clusterText,
    'xyChart.xAxisTitleColor': colors.nodeText,
    'xyChart.xAxisTickColor': colors.clusterText,
    'xyChart.xAxisLineColor': colors.clusterStroke,
    'xyChart.yAxisLabelColor': colors.clusterText,
    'xyChart.yAxisTitleColor': colors.nodeText,
    'xyChart.yAxisTickColor': colors.clusterText,
    'xyChart.yAxisLineColor': colors.clusterStroke,
    'xyChart.plotColorPalette': series.fills.join(','),
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
      curve: layout.curve ?? 'basis',
      padding: 10,
      nodeSpacing: layout.nodeSpacing ?? 45,
      rankSpacing: layout.rankSpacing ?? 45,
      diagramPadding: layout.diagramPadding ?? 8,
      ...(layout.wrappingWidth === undefined ? {} : { wrappingWidth: layout.wrappingWidth }),
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

  const layout = options.layout ?? {};
  const requested = layout.direction ?? 'auto';
  const stated = sourceDirection(source);
  const maxAspect = layout.maxAspect ?? 3.2;
  const isFlow = FLOW_ANY.test(source);

  // A forced direction re-aims the header; `auto` leaves the source's own choice
  // alone (and only second-guesses it later, when the source made no choice).
  const planned =
    requested !== 'auto' && (!stated || !sameDirection(stated, requested))
      ? withDirection(source, requested)
      : source;

  const attempt = async (text: string): Promise<ReturnType<typeof postProcessSvg>> => {
    const raw = await enqueue(async () => {
      mermaid.initialize(buildMermaidConfig(options));
      const out = await mermaid.render(id, text);
      return typeof out === 'string' ? out : out.svg;
    });
    return postProcessSvg({
      svg: raw,
      id,
      tokens: resolved.tokens,
      background: options.background,
      padding: options.padding,
      extraCss: options.extraCss,
      series: readableSeries(resolved.palette, 12),
    });
  };

  let chosen: { processed: ReturnType<typeof postProcessSvg>; direction: FlowDirection };
  try {
    const first = stated ?? (requested === 'auto' ? 'TB' : requested);
    chosen = { processed: await attempt(planned), direction: first };
    /*
     * Layout habit, not syntax: a flowchart nobody gave a direction to is laid out
     * tall by default, and a wide graph then runs 4:1 sideways and reads badly in
     * a README. When the source stayed silent we try the other orientation and
     * keep whichever lands closer to a comfortable aspect ratio.
     */
    if (requested === 'auto' && !stated && isFlow && chosen.processed.height > 0) {
      const aspect = chosen.processed.width / chosen.processed.height;
      if (aspect > maxAspect) {
        const flipped = flipDirection(first);
        // The second opinion is optional: if it fails, the first render stands.
        try {
          const alternative = await attempt(withDirection(planned, flipped));
          const altAspect =
            alternative.height > 0 ? alternative.width / alternative.height : Number.POSITIVE_INFINITY;
          if (Math.abs(altAspect - 1.6) < Math.abs(aspect - 1.6)) {
            alternative.warnings.unshift(
              `layout: re-rendered ${flipped} — the ${aspect.toFixed(1)}:1 ${first} attempt read badly`,
            );
            chosen = { processed: alternative, direction: flipped };
          }
        } catch {
          chosen.processed.warnings.push(`layout: kept ${first}; the ${flipped} alternative failed to render`);
        }
      }
    }
  } catch (error) {
    cleanupScratch(id);
    throw new RenderError(describeMermaidError(error), error, source);
  }

  const processed = chosen.processed;

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
    direction: isFlow ? chosen.direction : undefined,
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
