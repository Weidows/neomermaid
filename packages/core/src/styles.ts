import { mix, withAlpha } from './color.js';
import type { ThemeTokens } from './types.js';

/**
 * The generated stylesheet is the single biggest lever on how a diagram *looks*.
 * It is appended after mermaid's own `<style>` inside the SVG, so equal-specificity
 * rules win by document order without needing `!important` (which would make
 * downstream overrides painful).
 */

export interface StyleRefs {
  /** `url(#…)` references for injected defs, omitted when unused. */
  bg?: string;
  pattern?: string;
  nodeGradient?: string;
}

export interface StyleContext {
  /** Bare element id used as the CSS scope, without the leading `#`. */
  id: string;
  tokens: ThemeTokens;
  refs: StyleRefs;
  /** True when a background rect is painted by the post-processor. */
  paintsBackground: boolean;
}

/** Padding used by edge-label pills — shared by the stylesheet and the SVG fitter. */
export function pillPadding(tokens: ThemeTokens): { x: number; y: number } {
  const { geometry: g, typography: t } = tokens;
  const base = tokens.effects.sketch ? 9 : Math.round(g.nodeRadius * 0.55) + 3;
  const x = Math.min(14, Math.max(6, base + Math.round(g.strokeWidth)));
  const y = Math.min(5, Math.max(1, Math.round(g.strokeWidth * 0.8)));
  return { x, y: Math.max(y, t.labelFontSize > 14 ? 3 : 2) };
}

/** Guard against user CSS values breaking out of the style element. */
function v(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[<>{}]/g, '').trim();
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

const NODE_SHAPES = [
  '.node rect',
  '.node circle',
  '.node ellipse',
  '.node polygon',
  '.node path',
  '.node .label-container',
  '.basic.label-container',
];

const EDGE_PATHS = [
  '.edgePaths path',
  '.edgePath path',
  '.flowchart-link',
  'path.relation',
  'path.transition',
  '.messageLine0',
  '.messageLine1',
  '.er.relationshipLine',
  '.edge-thickness-normal',
  '.edge-thickness-thick',
];

/**
 * Edges the author drew as solid. Scoping theme dashes to these keeps `-.->`
 * (dashed) and `-.-` (dotted) exactly as written.
 */
const SOLID_EDGES = [
  '.flowchart-link.edge-pattern-solid',
  '.edgePaths path.edge-pattern-solid',
  '.edgePath path.edge-pattern-solid',
  'path.transition',
  'path.relation',
];

const LABEL_SELECTORS = [
  '.label',
  '.label text',
  '.nodeLabel',
  '.nodeLabel p',
  'span',
  'p',
  '.cluster-label text',
  '.cluster-label span',
  '.messageText',
  '.noteText',
  '.noteText > tspan',
  '.labelText',
  '.labelText > tspan',
  '.loopText',
  '.loopText > tspan',
  '.stateLabel text',
  '.taskText',
  '.taskTextOutsideRight',
  '.taskTextOutsideLeft',
  '.slice',
  '.pieCircle',
  '.titleText',
  '.legend text',
];

function scope(id: string, selectors: string[]): string {
  return selectors.map((sel) => `#${id} ${sel}`).join(',\n  ');
}

export function buildStylesheet(ctx: StyleContext): string {
  const { id, tokens, refs } = ctx;
  const { colors, geometry: g, typography: t, effects: e } = tokens;
  const s = `#${id}`;
  const rules: string[] = [];

  /* ---------------------------------------------------------------- canvas */

  rules.push(`${s} {
  font-family: ${v(t.fontFamily)};
  font-size: ${px(t.fontSize)};
  font-weight: ${t.fontWeight};
  letter-spacing: ${px(t.letterSpacing)};
  text-transform: ${v(t.textTransform)};
  color: ${v(colors.nodeText)};
}`);

  rules.push(`${scope(id, ['text', 'tspan', '.label', '.nodeLabel', '.messageText', '.loopText']) } {
  font-family: inherit;
  letter-spacing: inherit;
}`);
  // text-transform must reach labels inside <foreignObject> HTML too.
  rules.push(`${scope(id, ['div', 'span', 'p', 'a']) } {
  font-family: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
}`);

  /* ------------------------------------------------------------------ text */

  rules.push(`${scope(id, LABEL_SELECTORS) } {
  fill: ${v(colors.nodeText)};
  color: ${v(colors.nodeText)};
}`);

  rules.push(`${scope(id, ['.titleText', '.title', 'h1', 'h2', 'h3']) } {
  fill: ${v(colors.nodeText)};
  color: ${v(colors.nodeText)};
  font-size: ${px(t.fontSize * 1.2)};
  font-weight: 700;
}`);

  rules.push(`${scope(id, ['.cluster-label text', '.cluster-label span', '.cluster-label span p', '.loopText', '.loopText > tspan']) } {
  fill: ${v(colors.clusterText)};
  color: ${v(colors.clusterText)};
  font-size: ${px(t.labelFontSize)};
  font-weight: ${t.titleWeight};
}`);

  /* ----------------------------------------------------------------- nodes */

  const nodeFill = refs.nodeGradient ? `url(#${refs.nodeGradient})` : v(colors.nodeFill);
  // Shadows and glows are CSS drop-shadows on purpose: an SVG filter region is
  // derived from the element's bounding box, and a perfectly horizontal edge has
  // a zero-height box — the filter then renders nothing at all. CSS filters use
  // the painted (stroke) extent, so nothing silently disappears.
  const nodeFilter =
    g.nodeShadow > 0
      ? g.nodeShadowY === 0
        ? `filter: drop-shadow(0 0 ${round(g.nodeShadow * 0.6)}px ${withAlpha(colors.nodeStroke, 0.8, 'transparent')}) drop-shadow(0 0 ${round(g.nodeShadow * 1.5)}px ${withAlpha(colors.nodeStroke, 0.4, 'transparent')});`
        : `filter: drop-shadow(0 ${g.nodeShadowY}px ${round(g.nodeShadow * 0.45)}px ${withAlpha('#000000', 0.38, 'transparent')}) drop-shadow(0 ${Math.round(g.nodeShadowY * 1.8)}px ${round(g.nodeShadow * 0.8)}px ${withAlpha('#000000', 0.2, 'transparent')});`
      : g.nodeShadowY > 0
        ? `filter: drop-shadow(0 ${g.nodeShadowY}px 0 ${withAlpha(colors.nodeStroke, 0.9, 'rgba(0,0,0,0.6)')});`
        : '';

  rules.push(`${scope(id, NODE_SHAPES) } {
  fill: ${nodeFill};
  stroke: ${v(colors.nodeStroke)};
  stroke-width: ${g.strokeWidth}px;
  stroke-linejoin: round;
  ${nodeFilter}
}`);

  // Hand-drawn (rough.js) nodes are coloured path by path in the SVG
  // post-processor; the stylesheet must not repaint them or the hatch fill path
  // would be turned into a solid ink blob.
  rules.push(`${scope(id, ['.rough-node']) } {
  ${nodeFilter}
}`);

  // Special node kinds that mermaid colours separately.
  rules.push(`${scope(id, ['.node .statediagram-state rect', '.statediagram-state rect', '.stateGroup rect']) } {
  fill: ${v(colors.nodeFill)};
  stroke: ${v(colors.nodeStroke)};
  stroke-width: ${g.strokeWidth}px;
}`);
  rules.push(`${scope(id, ['.node circle.state-start', '.state-start']) } {
  fill: ${v(colors.nodeStroke)};
  stroke: ${v(colors.nodeStroke)};
}`);
  rules.push(`${scope(id, ['.node circle.state-end', '.state-end']) } {
  fill: ${v(colors.nodeFill)};
  stroke: ${v(colors.nodeStroke)};
  stroke-width: ${Math.max(2, g.strokeWidth)}px;
}`);
  rules.push(`${scope(id, ['.node .katex path']) } {
  fill: ${v(colors.nodeText)};
  stroke: ${v(colors.nodeText)};
}`);

  /* ----------------------------------------------------------------- edges */

  const edgeFilter =
    g.edgeGlow > 0
      ? `filter: drop-shadow(0 0 ${round(g.edgeGlow * 0.5)}px ${withAlpha(colors.edge, 0.95, 'transparent')}) drop-shadow(0 0 ${round(g.edgeGlow * 1.6)}px ${withAlpha(colors.edge, 0.5, 'transparent')});`
      : '';

  rules.push(`${scope(id, EDGE_PATHS.filter((sel) => !sel.startsWith('.edge-thickness'))) } {
  stroke: ${v(colors.edge)};
  stroke-width: ${g.edgeWidth}px;
  fill: none;
  stroke-linejoin: round;
  stroke-linecap: round;
  ${edgeFilter}
}`);

  if (g.edgeDash) {
    // Only solid edges are re-styled: `A -.-> B` must keep the dash the author
    // asked for.
    rules.push(`${scope(id, SOLID_EDGES) } {
  stroke-dasharray: ${v(g.edgeDash)};
}`);
  }

  if (e.animatedEdges) {
    rules.push(`${scope(id, SOLID_EDGES) } {
  stroke-dasharray: ${v(g.edgeDash ?? '8 6')};
  animation: neom-dash-${id} 1.4s linear infinite;
}`);
    rules.push(`@keyframes neom-dash-${id} {
  from { stroke-dashoffset: 28; }
  to { stroke-dashoffset: 0; }
}`);
  }

  rules.push(`${scope(id, ['.marker', '.marker path', '.marker.cross', '.marker.cross path', '.arrowheadPath']) } {
  fill: ${v(colors.edge)};
  stroke: ${v(colors.edge)};
}`);
  rules.push(`${scope(id, ['.marker circle', '.marker polygon']) } {
  fill: ${v(colors.edge)};
  stroke: ${v(colors.edge)};
}`);

  /* ------------------------------------------------------------ edge labels */

  const pill = Math.max(4, Math.round(g.nodeRadius * 0.7));
  const pad = pillPadding(tokens);
  const sketch = e.sketch;
  // Sketch themes get a heavy ink outline; everything else a hairline, so the
  // pill reads as a badge instead of a hole in the theme.
  const labelBorder = sketch
    ? `border: ${Math.max(1.5, g.strokeWidth * 0.7)}px solid ${v(colors.edge)};`
    : `border: 1px solid ${v(withAlpha(colors.edge, 0.32, 'transparent'))};`;
  // The connector runs straight through the label, so the pill needs a halo of
  // canvas colour — otherwise its rounded corners leak the stroke behind it.
  const halo = ctx.paintsBackground
    ? `box-shadow: 0 0 0 ${Math.max(2, Math.round(g.edgeWidth + 1))}px ${v(colors.bg)};`
    : '';
  // The pill padding here is mirrored in `fitEdgeLabels` (svg.ts), which grows
  // mermaid's measured foreignObject so the text can never be clipped.
  rules.push(`${scope(id, ['.edgeLabel', '.edgeLabel p', '.labelBkg']) } {
  background-color: ${v(colors.edgeLabelBg)};
  color: ${v(colors.edgeLabelText)};
  fill: ${v(colors.edgeLabelText)};
  border-radius: ${px(pill)};
  padding: ${px(pad.y)} ${px(pad.x)};
  font-size: ${px(t.labelFontSize)};
  line-height: 1.4;
  ${labelBorder}
}`);
  // The halo only belongs on the surface that carries the background.
  rules.push(`${scope(id, ['.labelBkg']) } {
  ${halo}
}`);
  rules.push(`${scope(id, ['.edgeLabel']) } {
  padding: 0;
  background-color: transparent;
}`);
  // The wrapper mermaid puts around HTML labels adds its own box; keep the pill
  // as the only visible surface.
  rules.push(`${scope(id, ['.edgeLabel > .label', '.edgeLabel .label']) } {
  background-color: transparent;
  padding: 0;
}`);
  // mermaid draws an extra rect behind the label; keep it out of the way so the
  // pill is the only box the user sees.
  rules.push(`${scope(id, ['.edgeLabel rect', '.edgeLabel .label rect']) } {
  fill: none;
  stroke: none;
}`);

  /* ---------------------------------------------------------------- clusters */

  rules.push(`${scope(id, ['.cluster rect', '.statediagram-cluster rect']) } {
  fill: ${v(colors.clusterFill)};
  stroke: ${v(colors.clusterStroke)};
  stroke-width: ${g.strokeWidth}px;
  stroke-dasharray: none;
  rx: ${px(g.clusterRadius)};
  ry: ${px(g.clusterRadius)};
}`);
  rules.push(`${scope(id, ['.cluster-label', '.cluster-label foreignObject', '.cluster-label .nodeLabel']) } {
  background-color: transparent;
}`);

  /* ------------------------------------------------------------ other families */

  rules.push(`${scope(id, ['.actor', '.classGroup rect', '.labelBox', '.entityBox']) } {
  fill: ${v(colors.nodeFill)};
  stroke: ${v(colors.nodeStroke)};
  stroke-width: ${g.strokeWidth}px;
}`);
  rules.push(`${scope(id, ['text.actor', 'text.actor > tspan', '.actor > text']) } {
  fill: ${v(colors.nodeText)};
  stroke: none;
}`);
  rules.push(`${scope(id, ['.actor-line']) } {
  stroke: ${v(colors.edge)};
  stroke-width: 1px;
  stroke-dasharray: 4 4;
}`);
  rules.push(`${scope(id, ['.activation0', '.activation1', '.activation2', '.er.attributeBoxOdd']) } {
  fill: ${v(colors.nodeFillAlt)};
  stroke: ${v(colors.nodeStroke)};
}`);
  rules.push(`${scope(id, ['.er.attributeBoxEven', '.er.attributeBoxOdd']) } {
  stroke: ${v(colors.nodeStroke)};
}`);
  rules.push(`${scope(id, ['.note']) } {
  fill: ${v(withAlpha(colors.accent, 0.14, colors.nodeFillAlt))};
  stroke: ${v(colors.accent)};
}`);
  rules.push(`${scope(id, ['.noteText', '.noteText > tspan']) } {
  fill: ${v(colors.nodeText)};
  stroke: none;
}`);
  rules.push(`${scope(id, ['.loopLine', '.loopLine path']) } {
  stroke: ${v(colors.clusterStroke)};
  stroke-width: 1.4px;
  fill: none;
  stroke-dasharray: 3 3;
}`);
  rules.push(`${scope(id, ['.sectionTitle', '.sectionTitle text', '.grid .tick text']) } {
  fill: ${v(colors.clusterText)};
}`);
  rules.push(`${scope(id, ['.grid .tick line', '.grid path']) } {
  stroke: ${v(mix(colors.edge, colors.bg, 0.6))};
}`);
  rules.push(`${scope(id, ['.task']) } {
  fill: ${v(colors.nodeFill)};
  stroke: ${v(colors.nodeStroke)};
}`);
  rules.push(`${scope(id, ['.slice', '.pieCircle', '.pieOuterCircle']) } {
  stroke: ${v(colors.bg)};
  stroke-width: 2px;
}`);

  /* ------------------------------------------------------------------- errors */

  rules.push(`${scope(id, ['.error-icon', '.error-text', '.error-text tspan', '.error-icon path']) } {
  fill: #e5484d;
  stroke: #e5484d;
  font-weight: 600;
}`);

  return rules.join('\n\n');
}

/** CSS applied to the *host page*, not the SVG — used by preview surfaces. */
export function buildHostStyles(ctx: StyleContext): string {
  const { tokens } = ctx;
  const parts = [
    `font-family: ${v(tokens.typography.fontFamily)};`,
    `color: ${v(tokens.colors.nodeText)};`,
  ];
  if (ctx.paintsBackground) parts.push(`background: ${v(tokens.colors.bg)};`);
  return parts.join(' ');
}
