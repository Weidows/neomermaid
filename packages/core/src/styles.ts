import { contrastText, mix, withAlpha } from './color.js';
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
  /** Series fills paired with their measured-readable label colours. */
  series?: { fills: string[]; labels: string[] };
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
  '.titleText',
  '.legend text',
];
// NOTE: `.slice` is the pie *percentage text*; `.pieCircle` is the slice shape and
// must never be given a text colour — doing so painted every slice the same pale
// colour and hid the per-slice fills mermaid writes as attributes.

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
  const labelLineHeight = Math.max(1.2, Math.min(1.6, (Math.ceil(t.labelFontSize * 1.5) / t.labelFontSize)));

  // Only the pill surface carries the box: background, border, padding and halo.
  // Everything else in the label keeps a neutral box model so a host page's CSS
  // reset cannot move the text out of the foreignObject viewport.
  rules.push(`${scope(id, ['.labelBkg']) } {
  display: block;
  box-sizing: border-box;
  line-height: ${Math.round(labelLineHeight * 100) / 100};
  margin: 0;
  padding: ${px(pad.y)} ${px(pad.x)};
  text-align: center;
  white-space: nowrap;
  background-color: ${v(colors.edgeLabelBg)};
  color: ${v(colors.edgeLabelText)};
  fill: ${v(colors.edgeLabelText)};
  border-radius: ${px(pill)};
  font-size: ${px(t.labelFontSize)};
  ${labelBorder}
  ${halo}
}`);
  rules.push(`${scope(id, ['.edgeLabel', '.edgeLabel span', '.edgeLabel p']) } {
  margin: 0;
  padding: 0;
  background-color: transparent;
  color: ${v(colors.edgeLabelText)};
  fill: ${v(colors.edgeLabelText)};
  font-size: ${px(t.labelFontSize)};
}`);
  // HTML label boxes only (an inline `display: table-cell` from mermaid is removed
  // in the post-processor, otherwise a host `box-sizing: border-box` reset moves
  // the text out of the foreignObject viewport).
  rules.push(`${scope(id, ['.edgeLabel span', '.edgeLabel p']) } {
  display: block;
  box-sizing: border-box;
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
  // Activations: tinted with the accent so they read as "this participant is
  // busy" on translucent themes instead of vanishing into the canvas.
  rules.push(`${scope(id, ['.activation0', '.activation1', '.activation2']) } {
  fill: ${v(withAlpha(colors.accent, 0.3, colors.nodeFillAlt))};
  stroke: ${v(withAlpha(colors.accent, 0.75, colors.nodeStroke))};
  stroke-width: ${Math.max(1, g.strokeWidth)}px;
}`);
  // Sequence autonumbering: the class paints the badge circle, the number text
  // itself lives under an id selector — both need styling or the numbers vanish.
  rules.push(`${scope(id, ['.sequenceNumber']) } {
  fill: ${v(colors.accent)};
  stroke: ${v(colors.nodeStroke)};
  stroke-width: 1px;
}`);
  rules.push(`${scope(id, ['[id$="-sequencenumber"]', '[id$="-sequencenumber"] tspan', '.sequenceNumber text', '.sequenceNumber tspan']) } {
  fill: ${v(contrastText(colors.accent))};
  color: ${v(contrastText(colors.accent))};
  font-weight: 700;
}`);
  // Sequence arrowheads are also id-selector based, so they need explicit colours.
  rules.push(`${scope(id, ['[id$="-arrowhead"] path', '[id$="-crosshead"] path', '[id$="-arrowhead"]', '[id$="-crosshead"]']) } {
  fill: ${v(colors.edge)};
  stroke: ${v(colors.edge)};
}`);
  rules.push(`${scope(id, ['.er.attributeBoxOdd']) } {
  fill: ${v(colors.nodeFillAlt)};
  stroke: ${v(colors.nodeStroke)};
}`);
  rules.push(`${scope(id, ['.er.attributeBoxEven']) } {
  fill: ${v(colors.nodeFill)};
  stroke: ${v(colors.nodeStroke)};
}`);
  rules.push(`${scope(id, ['.note']) } {
  fill: ${v(withAlpha(colors.accent, 0.2, colors.nodeFillAlt))};
  stroke: ${v(colors.accent)};
  stroke-width: ${Math.max(1, g.strokeWidth)}px;
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
  // mermaid ships `.section{opacity:.2}` with fills only for section0/section2,
  // which makes the bands look random. One deliberate band colour for all of
  // them keeps gantt rows readable.
  rules.push(`${scope(id, ['.section', '.section0', '.section1', '.section2', '.section3']) } {
  fill: ${v(withAlpha(colors.nodeFillAlt, 0.5, 'transparent'))};
  stroke: none;
  opacity: 1;
}`);
  rules.push(`${scope(id, ['.slice']) } {
  fill: ${v(contrastText(colors.bg))};
  color: ${v(contrastText(colors.bg))};
  font-size: ${px(t.fontSize)};
  font-weight: 600;
  /* Outline behind the glyphs: percentages sit on both light and dark slices. */
  paint-order: stroke;
  stroke: ${v(withAlpha(colors.bg, 0.65, 'transparent'))};
  stroke-width: 3px;
  stroke-linejoin: round;
}`);
  // Slices keep the per-slice colour mermaid writes as an attribute; we only
  // sharpen the edge and drop mermaid's washed-out 0.7 opacity.
  rules.push(`${scope(id, ['.pieCircle', '.pieOuterCircle']) } {
  opacity: 1;
  stroke: ${v(colors.bg)};
  stroke-width: 2px;
}`);
  rules.push(`${scope(id, ['.titleText', '.legend text']) } {
  fill: ${v(colors.nodeText)};
  color: ${v(colors.nodeText)};
}`);

  /* ------------------------------------------------------------------- errors */

  rules.push(`${scope(id, ['.error-icon', '.error-text', '.error-text tspan', '.error-icon path']) } {
  fill: #e5484d;
  stroke: #e5484d;
  font-weight: 600;
}`);

  /* ------------------------------------------------- per-series label colours */

  /*
   * Families with numbered series (git branches, timeline bands) pick their text
   * colour from a numbered mermaid variable, and they paint that text *inside* a
   * `.label`-ish group — exactly where our generic `text { fill: … }` rule used to
   * win and flatten every label to one colour. Measured result: white on dracula's
   * cyan branch pill at 1.01:1, i.e. invisible. These rules are emitted last, so
   * equal specificity resolves in their favour and each slot keeps its own
   * measured label colour.
   */
  const series = ctx.series;
  if (series?.labels?.length) {
    const highest = Math.max(series.labels.length, 8);
    for (let index = 0; index < highest; index += 1) {
      const fill = series.fills[index % series.fills.length]!;
      const label = series.labels[index % series.labels.length]!;
      // gitGraph: `.branch-labelN` (0-based) wraps the branch pill and its text.
      rules.push(
        `${scope(id, [
          `.branch-label${index}`,
          `.branch-label${index} text`,
          `.branch-label${index} tspan`,
        ])} {\n  fill: ${v(label)};\n}`,
      );
      if (index > 0) {
        rules.push(`${scope(id, [`.branch-label${index} rect`, `.branch-label${index} path`])} {\n  fill: ${v(fill)};\n}`);
      }
      // timeline: mermaid numbers sections from -1 upwards in its own stylesheet,
      // so slot N owns class `section--1` for N = 0 and `section-(N-1)` after.
      const suffix = index === 0 ? '-1' : String(index - 1);
      const sectionClass = `.section-${suffix}`;
      rules.push(
        `${scope(id, [
          `${sectionClass} text`,
          `${sectionClass} tspan`,
          `.timeline-node${sectionClass} text`,
          `.timeline-node${sectionClass} tspan`,
        ])} {\n  fill: ${v(label)};\n}`,
      );
      if (index < 8) {
        rules.push(
          `${scope(id, [
            `.timeline-node${sectionClass} path`,
            `.timeline-node${sectionClass} rect`,
            `.timeline-node${sectionClass} circle`,
          ])} {\n  fill: ${v(fill)};\n}`,
        );
      }
    }
  }

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
