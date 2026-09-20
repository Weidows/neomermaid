import { isDark, mix, withAlpha } from './color.js';
import { CONTRAST_LEVELS, contrastRatio, readOn } from './contrast.js';
import { buildStylesheet, pillPadding, type StyleRefs } from './styles.js';
import type { ThemeTokens } from './types.js';

/**
 * SVG post-processing. Mermaid owns *layout*; this module owns everything that
 * makes the result look like it came from this decade: canvas, gradients, glow
 * filters, corner radii, arrow scaling and a full replacement stylesheet.
 *
 * Design rules:
 *  - Never rename mermaid's element ids. Its own stylesheet is scoped to that id
 *    and dropping it would silently lose structural rules we do not reimplement.
 *  - Everything we inject is namespaced with that id so several diagrams can
 *    live on one page without their `url(#…)` references colliding.
 */

export interface DomLike {
  DOMParser: typeof DOMParser;
  XMLSerializer: typeof XMLSerializer;
}

export interface PostProcessOptions {
  /** Raw SVG string straight out of `mermaid.render`. */
  svg: string;
  /** The id mermaid rendered with; also our CSS scope. */
  id: string;
  tokens: ThemeTokens;
  /** `transparent`, `theme`, or any CSS colour. */
  background?: string;
  padding?: number;
  /** Override the DOM implementation (tests, non-browser hosts). */
  dom?: DomLike;
  extraCss?: string;
  /** Series fills + measured-readable labels, forwarded to the stylesheet. */
  series?: { fills: string[]; labels: string[] };
}

export interface PostProcessResult {
  svg: string;
  width: number;
  height: number;
  /** Resolved canvas colour — hosts use it to paint the area around the SVG. */
  background: string;
  warnings: string[];
}

interface BackgroundPlan {
  paints: boolean;
  refs: StyleRefs;
  defs: string;
  /** Fill applied to the injected canvas rect. */
  fill: string;
  /** Solid colour behind the canvas, for host pages. */
  css: string;
}

const XML_ENTITIES: Record<string, string> = {
  nbsp: '&#160;',
  mdash: '&#8212;',
  ndash: '&#8211;',
  hellip: '&#8230;',
  times: '&#215;',
  laquo: '&#171;',
  raquo: '&#187;',
  copy: '&#169;',
};

/** Mermaid occasionally emits HTML named entities that XML mode rejects. */
function escapeUnknownEntities(svg: string): string {
  return svg.replace(/&([a-z]+);/gi, (full, name: string) => XML_ENTITIES[name.toLowerCase()] ?? full);
}

function gradientOrientation(angleDeg: number): { x1: string; y1: string; x2: string; y2: string } {
  const rad = (angleDeg * Math.PI) / 180;
  const x = Math.cos(rad) / 2;
  const y = Math.sin(rad) / 2;
  return {
    x1: `${(0.5 - x) * 100}%`.replace('-', '-'),
    y1: `${(0.5 - y) * 100}%`,
    x2: `${(0.5 + x) * 100}%`,
    y2: `${(0.5 + y) * 100}%`,
  };
}

function buildBackground(tokens: ThemeTokens, id: string, background: string | undefined): BackgroundPlan {
  const { colors, effects: e, geometry: g } = tokens;
  const refs: StyleRefs = {};
  const mode = !background || background === 'theme' ? e.background : 'solid';
  const css =
    background && background !== 'theme'
      ? background
      : e.background === 'transparent'
        ? 'transparent'
        : colors.bg;

  if (background === 'transparent' || (background === undefined && e.background === 'transparent')) {
    return { paints: false, refs, defs: '', fill: 'transparent', css: 'transparent' };
  }

  let defs = '';
  let fill = css === 'transparent' ? colors.bg : css;

  if (mode === 'gradient') {
    const stops = [fill, mix(fill, colors.accent, isDark(fill) ? 0.35 : 0.18)];
    const o = gradientOrientation(e.gradientAngle || 150);
    const gradId = `${id}-bg`;
    defs += `<linearGradient id="${gradId}" x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}">` +
      stops
        .map((c, i) => `<stop offset="${i === 0 ? '0%' : '100%'}" stop-color="${c}"/>`)
        .join('') +
      `</linearGradient>`;
    refs.bg = gradId;
    fill = `url(#${gradId})`;
  } else if (mode === 'grid' || mode === 'dots') {
    const size = Math.max(8, e.patternSize);
    const patternId = `${id}-pattern`;
    const line = e.patternColor;
    const body =
      mode === 'grid'
        ? `<path d="M ${size} 0 L 0 0 0 ${size}" fill="none" stroke="${line}" stroke-width="1"/>`
        : `<circle cx="${size / 2}" cy="${size / 2}" r="1.4" fill="${line}"/>`;
    defs +=
      `<pattern id="${patternId}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">` +
      `<rect width="${size}" height="${size}" fill="${css === 'transparent' ? colors.bg : css}"/>${body}</pattern>`;
    refs.pattern = patternId;
    fill = `url(#${patternId})`;
  }

  return { paints: true, refs, defs, fill, css };
}

function buildNodeGradient(tokens: ThemeTokens, id: string): { defs: string; ref: string | undefined } {
  const { colors, effects: e } = tokens;
  if (e.nodeFill === 'flat') return { defs: '', ref: undefined };
  const gradId = `${id}-node`;
  const o = gradientOrientation(e.gradientAngle || 180);
  const from = e.nodeFill === 'soft' ? withAlpha('#ffffff', 0.12, colors.nodeFillAlt) : colors.nodeFill;
  const to =
    e.nodeFill === 'soft' ? mix(colors.nodeFill, colors.accent, 0.12) : mix(colors.nodeFill, colors.accent, 0.28);
  const defs =
    `<linearGradient id="${gradId}" x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}">` +
    `<stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient>`;
  return { defs, ref: gradId };
}

/** Parse an XML fragment and import it into the target document. */
function importFragment(doc: Document, xml: string): Element | undefined {
  if (!xml.trim()) return undefined;
  const Parser = (globalThis as unknown as DomLike).DOMParser;
  const frag = new Parser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${xml}</svg>`,
    'image/svg+xml',
  );
  const root = frag.documentElement;
  const imported = doc.createElementNS('http://www.w3.org/2000/svg', 'defs');
  for (const child of Array.from(root.childNodes)) {
    imported.appendChild(doc.importNode(child, true));
  }
  return imported;
}

function num(value: string | null, fallback = 0): number {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Mermaid writes an inline `stroke-dasharray`/`stroke-dashoffset` on every edge
 * to seed its draw-in animation. Inline styles beat our stylesheet, so the theme's
 * dash pattern and marching-ants animation would never apply — strip it. Edges
 * that opt into mermaid's own animation keep working: that path adds an
 * `edge-animation-*` class whose rules use `!important`.
 */
function stripInlineEdgeAnimation(root: Element): number {
  const selectors = ['.flowchart-link', '.edgePaths path', 'path.relation', 'path.transition', '.messageLine0', '.messageLine1'];
  let touched = 0;
  for (const el of Array.from(root.querySelectorAll(selectors.join(',')))) {
    const style = (el as Element).getAttribute('style');
    if (!style) continue;
    const kept = style
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part && !/^stroke-dash(offset|array)/i.test(part));
    if (kept.length === style.split(';').filter((p) => p.trim()).length) continue;
    if (kept.length) (el as Element).setAttribute('style', kept.join('; '));
    else (el as Element).removeAttribute('style');
    touched += 1;
  }
  return touched;
}

/** Measure a single line of text with the browser's own font metrics. */
function measureText(
  text: string,
  font: string,
  options: { letterSpacing?: number; uppercase?: boolean } = {},
): number | undefined {
  try {
    const doc = globalThis.document;
    if (!doc) return undefined;
    const canvas = doc.createElement('canvas');
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return undefined;
    ctx.font = font;
    // mermaid cannot measure letter-spacing or text-transform, so we must.
    if (options.letterSpacing && 'letterSpacing' in ctx) {
      (ctx as unknown as { letterSpacing: string }).letterSpacing = `${options.letterSpacing}px`;
    }
    const sample = options.uppercase ? text.toUpperCase() : text;
    const width = ctx.measureText(sample).width;
    return Number.isFinite(width) && width > 0 ? width : undefined;
  } catch {
    return undefined;
  }
}

function measureOptions(tokens: ThemeTokens): { letterSpacing: number; uppercase: boolean } {
  return {
    letterSpacing: tokens.typography.letterSpacing,
    uppercase: tokens.typography.textTransform === 'uppercase',
  };
}

/** Append declarations to an element's inline style, keeping what is there. */
function appendInlineStyle(el: Element, css: string): void {
  const existing = el.getAttribute('style') ?? '';
  el.setAttribute('style', `${existing.replace(/;\s*$/, '')}; ${css}`);
}

/**
 * Mermaid sizes each edge-label `<foreignObject>` from *its* font metrics; our
 * theme changes the font, size, weight and adds pill padding, so the text ends
 * up outside the foreignObject viewport and vanishes. Grow the box to fit the
 * real label and re-centre the label group, which mermaid anchors at `-w/2,-h/2`.
 */
function fitEdgeLabels(root: Element, tokens: ThemeTokens): number {
  const pad = pillPadding(tokens);
  const { typography: t } = tokens;
  const font = `${t.fontWeight} ${t.labelFontSize}px ${t.fontFamily}`;
  const lineHeight = Math.ceil(t.labelFontSize * 1.5);
  let fitted = 0;

  for (const group of Array.from(root.querySelectorAll('g.edgeLabel'))) {
    const labelGroup = group.querySelector(':scope > g.label') ?? group.querySelector('g.label');
    const fo = labelGroup?.querySelector('foreignObject');
    if (!labelGroup || !fo) continue;

    // mermaid hard-codes `display: table-cell` (and a line-height) on the label
    // div. Inside a host page that resets `box-sizing: border-box` — a VS Code
    // webview, any site with a CSS reset — the table-cell box grows taller than
    // the foreignObject viewport and its vertically centred text lands outside
    // the visible area, so the label disappears. We own the pill layout: drop
    // those inline declarations and set them from the stylesheet instead.
    const inner = fo.firstElementChild;
    if (inner) {
      const cleaned = (inner.getAttribute('style') ?? '')
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part && !/^(display|line-height|box-sizing)\s*:/i.test(part))
        .join('; ');
      if (cleaned) inner.setAttribute('style', cleaned);
      else inner.removeAttribute('style');
    }

    const currentW = num(fo.getAttribute('width'), 0);
    const currentH = num(fo.getAttribute('height'), 0);
    const text = (fo.textContent ?? '').replace(/\s+/g, ' ').trim();
    // Multi-line / rich labels: leave mermaid's measurement alone, just pad.
    const isPlain = Boolean(text) && !/[\n]/.test(fo.textContent ?? '');

    const measured = isPlain ? measureText(text, font, measureOptions(tokens)) : undefined;
    const textWidth = Math.max(measured ?? 0, currentW);
    const textHeight = Math.max(currentH, lineHeight);

    const width = Math.round((textWidth + pad.x * 2) * 100) / 100;
    const height = Math.round((textHeight + pad.y * 2) * 100) / 100;
    if (width === currentW && height === currentH) continue;

    fo.setAttribute('width', String(width));
    fo.setAttribute('height', String(height));
    labelGroup.setAttribute('transform', `translate(${-width / 2}, ${-height / 2})`);
    fitted += 1;
  }
  return fitted;
}

/** Font-size multiplier that makes `measured` fit into `available`. Pure, so it is testable. */
export function shrinkForWidth(measured: number, available: number, floor = 0.72): number {
  if (!(measured > 0) || !(available > 0)) return 1;
  if (measured <= available * 1.02) return 1;
  return Math.max(floor, available / measured);
}

/**
 * Series labels that sit *on* a coloured shape must take their colour from that
 * shape. Pie percentages are the clearest case: mermaid emits the slice paths
 * first and the `<text class="slice">` labels in the same order, fills the slices
 * from `pie1…n`, and paints every label with a single colour — which measured
 * 1.12:1 (white on yellow) on most schemes. Pair them by index and repaint from
 * the fill a reader actually sees.
 */
function repaintSeriesLabels(root: Element, warnings: string[]): number {
  const slices = Array.from(root.querySelectorAll('path.pieCircle'))
    .map((path) => path.getAttribute('fill'))
    .filter((fill): fill is string => typeof fill === 'string' && fill !== 'none' && !fill.startsWith('url('));
  if (!slices.length) return 0;

  const labels = Array.from(root.querySelectorAll('text.slice'));
  for (let index = 0; index < labels.length; index += 1) {
    const sliceFill = slices[index % slices.length]!;
    const label = labels[index]!;
    // Inline style wins over both the attribute and the generated stylesheet.
    const existing = label.getAttribute('style') ?? '';
    label.setAttribute('style', `${existing}${existing && !existing.trimEnd().endsWith(';') ? ';' : ''}fill:${readOn(sliceFill)}`);
  }
  if (labels.length > slices.length) {
    warnings.push(`${labels.length - slices.length} pie label(s) had no slice to measure against.`);
  }
  return labels.length;
}

function hideEmptyLabels(root: Element): number {
  let hidden = 0;
  for (const group of Array.from(root.querySelectorAll('g.edgeLabel'))) {
    if ((group.textContent ?? '').replace(/\s+/g, '') !== '') continue;
    const target = group.querySelector('foreignObject') ?? group;
    (target as Element).setAttribute('style', 'display: none');
    hidden += 1;
  }
  return hidden;
}

/**
 * Mermaid sizes a label's `<foreignObject>` from *its* font metrics. Themes that
 * add letter-spacing or uppercase (or simply a wider font) push the rendered text
 * past that box, and the label gets clipped mid-word — very visible on mindmaps
 * and ER diagrams. Measure with the real font and shrink the offending labels a
 * little instead of letting them break.
 */
function fitClippedLabels(root: Element, tokens: ThemeTokens): number {
  const { typography: t } = tokens;
  const font = `${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
  const options = measureOptions(tokens);
  let adjusted = 0;

  for (const fo of Array.from(root.querySelectorAll('foreignObject'))) {
    if (fo.closest('g.edgeLabel')) continue; // handled by fitEdgeLabels
    const width = num(fo.getAttribute('width'), 0);
    if (width <= 0) continue;
    const inner = fo.firstElementChild;
    if (!inner) continue;
    const raw = (inner.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;

    const measured = measureText(raw, font, options);
    if (!measured) continue;
    const factor = shrinkForWidth(measured, width - 2);
    if (factor === 1) continue;
    const size = Math.round(t.fontSize * factor * 100) / 100;
    appendInlineStyle(inner, `font-size: ${size}px;`);
    adjusted += 1;
  }
  return adjusted;
}

/**
 * Rough.js shapes (mermaid's `handDrawn` look) need per-path treatment:
 * mermaid emits a *hatch* path — dozens of short strokes that act as the shape's
 * fill — plus sparse outline paths. Styling both with the ink colour turns the
 * node into a solid black blob, so each path is coloured by its role, and the
 * values are set as attributes (which is also why the stylesheet must not
 * repaint `.rough-node path`).
 */
function fillSketchShapes(root: Element, tokens: ThemeTokens): number {
  const { colors, geometry: g } = tokens;
  const ink = colors.nodeStroke;
  let touched = 0;

  for (const node of Array.from(root.querySelectorAll('.rough-node, [data-look="handDrawn"]'))) {
    const container = (node as Element).querySelector('.label-container') ?? (node as Element);
    const paths = Array.from(container.querySelectorAll('path'));
    if (!paths.length) continue;

    const subpaths = (p: Element) => (p.getAttribute('d') ?? '').split('M').length - 1;
    // Only when a second path exists can the densest one be the hatch fill.
    const hatch = paths.length > 1 ? paths.reduce((a, b) => (subpaths(a) >= subpaths(b) ? a : b)) : undefined;
    const hatchIsFill = hatch !== undefined && subpaths(hatch) >= 12;

    for (const path of paths) {
      const isHatch = path === hatch && hatchIsFill;
      path.setAttribute('fill', isHatch ? colors.nodeFill : 'none');
      path.setAttribute('stroke', isHatch ? colors.nodeFill : ink);
      path.setAttribute('stroke-width', isHatch ? '1.2' : String(g.strokeWidth));
      path.setAttribute('stroke-dasharray', 'none');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('stroke-linecap', 'round');
      touched += 1;
    }
  }
  return touched;
}

export function postProcessSvg(options: PostProcessOptions): PostProcessResult {
  const warnings: string[] = [];
  const dom = options.dom ?? (globalThis as unknown as DomLike);
  const padding = options.padding ?? 16;

  const parser = new dom.DOMParser();
  const doc = parser.parseFromString(escapeUnknownEntities(options.svg), 'image/svg+xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    // Defensive fallback: keep the diagram, still restyle it.
    warnings.push('SVG could not be parsed as XML; styles were appended verbatim.');
    const bg = buildBackground(options.tokens, options.id, options.background);
    const css = buildStylesheet({
      id: options.id,
      tokens: options.tokens,
      refs: { ...bg.refs },
      paintsBackground: bg.paints,
      series: options.series,
    });
    const patched = options.svg
      .replace(/<defs[^>]*>/, (m) => `${m}${bg.defs}`)
      .replace('</svg>', `<style data-neomermaid="theme">${css}</style></svg>`);
    return { svg: patched, width: 0, height: 0, background: bg.css, warnings };
  }

  const root = doc.documentElement;
  const background = buildBackground(options.tokens, options.id, options.background);
  const nodeGrad = buildNodeGradient(options.tokens, options.id);
  const refs: StyleRefs = { ...background.refs, nodeGradient: nodeGrad.ref };

  /* --------------------------------------------------------------- sizing */

  const vb = root.getAttribute('viewBox');
  let minX = 0;
  let minY = 0;
  let width = num(root.getAttribute('width'), 0);
  let height = num(root.getAttribute('height'), 0);

  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      [minX, minY, width, height] = parts as [number, number, number, number];
    }
  }
  if (!width || !height) {
    warnings.push('Diagram size could not be determined; falling back to 800×600.');
    width = width || 800;
    height = height || 600;
  }

  const canvasW = Math.round(width + padding * 2);
  const canvasH = Math.round(height + padding * 2);

  root.setAttribute('viewBox', `${minX - padding} ${minY - padding} ${canvasW} ${canvasH}`);
  root.setAttribute('width', String(canvasW));
  root.setAttribute('height', String(canvasH));
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // mermaid writes `max-width` to make diagrams responsive inside prose; a
  // standalone export should honour its real size instead.
  const inlineStyle = (root.getAttribute('style') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !/^max-width/i.test(part))
    .join('; ');
  root.setAttribute('style', inlineStyle);

  /* ---------------------------------------------------------------- canvas */

  if (background.paints) {
    const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'neom-canvas');
    rect.setAttribute('x', String(minX - padding));
    rect.setAttribute('y', String(minY - padding));
    rect.setAttribute('width', String(canvasW));
    rect.setAttribute('height', String(canvasH));
    rect.setAttribute('fill', background.fill);
    root.insertBefore(rect, root.firstChild);
  }

  /* ------------------------------------------------------------------ defs */

  const defsMarkup = background.defs + nodeGrad.defs;
  if (defsMarkup) {
    const defsEl = importFragment(doc, defsMarkup);
    if (defsEl) {
      const existing = root.querySelector(':scope > defs');
      if (existing) existing.appendChild(defsEl);
      else root.insertBefore(defsEl, root.firstChild);
    }
  }

  /* ------------------------------------------------- geometry post-process */

  const g = options.tokens.geometry;
  const nodeRects = root.querySelectorAll(
    '.node rect, .node .label-container, .node .basic.label-container, .statediagram-state rect',
  );
  for (const node of Array.from(nodeRects)) {
    if (!(node instanceof Element)) continue;
    const el = node as Element;
    const w = num(el.getAttribute('width'));
    const h = num(el.getAttribute('height'));
    // Skip the tiny 0-size placeholder mermaid sometimes renders for labels.
    if (w === 0 || h === 0) continue;
    const radius = Math.min(g.nodeRadius, w / 2, h / 2);
    el.setAttribute('rx', String(radius));
    el.setAttribute('ry', String(radius));
  }

  for (const el of Array.from(root.querySelectorAll('.cluster rect, .statediagram-cluster rect'))) {
    const w = num((el as Element).getAttribute('width'));
    const h = num((el as Element).getAttribute('height'));
    if (w === 0 || h === 0) continue;
    const radius = Math.min(g.clusterRadius, w / 2, h / 2);
    (el as Element).setAttribute('rx', String(radius));
    (el as Element).setAttribute('ry', String(radius));
  }

  if (g.arrowScale !== 1) {
    for (const marker of Array.from(root.querySelectorAll('marker'))) {
      const el = marker as Element;
      for (const attr of ['markerWidth', 'markerHeight', 'refX', 'refY']) {
        const current = num(el.getAttribute(attr), NaN);
        if (!Number.isFinite(current)) continue;
        el.setAttribute(attr, String(Math.round(current * g.arrowScale * 100) / 100));
      }
    }
  }

  /* ------------------------------------------------- theme compatibility */

  // 1. mermaid's inline edge animation would defeat our dash/motion styling.
  stripInlineEdgeAnimation(root);

  // 2. Labels with no text at all must not be painted as empty pills.
  hideEmptyLabels(root);

  // 3. Edge labels were measured with mermaid's font, not ours.
  const fitted = fitEdgeLabels(root, options.tokens);
  if (fitted > 0 && !globalThis.document) {
    warnings.push(`${fitted} edge label(s) padded without font metrics; text may sit tight.`);
  }

  // 4. Node labels can overflow their measured box once our fonts land.
  fitClippedLabels(root, options.tokens);

  // 5. Hand-drawn nodes ship as unfilled outlines; give them the theme fill.
  fillSketchShapes(root, options.tokens);

  // 6. Series text paints itself on a coloured shape: measure it, don't assume.
  repaintSeriesLabels(root, warnings);

  /* ------------------------------------------------------------- stylesheet */

  const css = [
    buildStylesheet({ id: options.id, tokens: options.tokens, refs, paintsBackground: background.paints, series: options.series }),
    options.extraCss ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const styleEl = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
  styleEl.setAttribute('data-neomermaid', 'theme');
  styleEl.textContent = `\n${css}\n`;
  // Appended last: equal-specificity rules beat mermaid's own sheet by order.
  root.appendChild(styleEl);

  const serializer = new dom.XMLSerializer();
  const svg = serializer.serializeToString(doc)
    .replace(/^<\?xml[^>]*\?>\s*/, '')
    .replace(/<svg([^>]*?)\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '<svg$1 xmlns="http://www.w3.org/2000/svg"');

  return { svg, width: canvasW, height: canvasH, background: background.paints ? background.css : 'transparent', warnings };
}

/** Standalone HTML page wrapping a rendered SVG — used by CLI PDF/HTML export. */
export function wrapInHtml(svg: string, tokens: ThemeTokens, title = 'NeoMermaid'): string {
  const bg = tokens.effects.background === 'transparent' ? 'transparent' : tokens.colors.bg;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title.replace(/[<>]/g, '')}</title>
<style>
  html, body { margin: 0; padding: 0; background: ${bg}; }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  svg { display: block; }
</style>
</head>
<body>
${svg}
</body>
</html>`;
}
