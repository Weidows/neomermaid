import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { postProcessSvg, shrinkForWidth } from '../src/svg.js';
import { resolveTheme } from '../src/theme.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(here, 'fixtures/mermaid-flowchart.svg'), 'utf8');

function run(overrides: Parameters<typeof postProcessSvg>[0] extends never ? never : Record<string, unknown> = {}) {
  const options = {
    svg: FIXTURE,
    id: 'neomtest1',
    tokens: resolveTheme({ preset: 'minimal/dracula' }).tokens,
    ...overrides,
  } as Parameters<typeof postProcessSvg>[0];
  return postProcessSvg(options);
}

describe('shrinkForWidth', () => {
  it('leaves labels that fit alone', () => {
    expect(shrinkForWidth(100, 120)).toBe(1);
    expect(shrinkForWidth(100, 100)).toBe(1);
    // 2% tolerance: rounding noise must not resize every label.
    expect(shrinkForWidth(101, 100)).toBe(1);
  });

  it('scales down just enough for labels that overflow', () => {
    expect(shrinkForWidth(125, 100)).toBeCloseTo(0.8, 3);
    expect(shrinkForWidth(150, 120)).toBeCloseTo(0.8, 3);
    expect(shrinkForWidth(112, 100)).toBeCloseTo(0.8928, 3);
  });

  it('never shrinks below the floor, so text stays legible', () => {
    expect(shrinkForWidth(1000, 100)).toBe(0.72);
    expect(shrinkForWidth(1000, 100, 0.5)).toBe(0.5);
  });

  it('degrades safely on nonsense input', () => {
    expect(shrinkForWidth(0, 100)).toBe(1);
    expect(shrinkForWidth(100, 0)).toBe(1);
    expect(shrinkForWidth(Number.NaN, 100)).toBe(1);
  });
});

describe('postProcessSvg', () => {
  it('keeps mermaid\'s own stylesheet and appends ours after it', () => {
    const { svg } = run();
    const mermaidStyle = svg.indexOf('#neomtest1{font-family:"trebuchet ms"');
    const ourStyle = svg.indexOf('data-neomermaid="theme"');
    expect(mermaidStyle).toBeGreaterThan(-1);
    expect(ourStyle).toBeGreaterThan(mermaidStyle);
    expect(svg).toContain('flowchart-link');
  });

  it('sizes the canvas from the viewBox plus padding', () => {
    const { svg, width, height } = run({ padding: 16 });
    expect(width).toBe(392);
    expect(height).toBe(462);
    expect(svg).toContain('viewBox="-16 -16 392 462"');
    expect(svg).toContain('width="392"');
    expect(svg).toContain('height="462"');
  });

  it('honours a custom padding and drops mermaid\'s max-width lock on the root', () => {
    const { svg, width } = run({ padding: 0 });
    expect(width).toBe(360);
    // Mermaid's own CSS legitimately mentions max-width for labels; what must go
    // is the responsive lock on the <svg> element itself.
    expect(svg).not.toMatch(/<svg[^>]*style="[^"]*max-width/);
  });

  it('rounds node rectangles according to the theme', () => {
    const sharp = run({ tokens: resolveTheme({ preset: 'tech/dracula' }).tokens });
    const rounded = run({ tokens: resolveTheme({ preset: 'minimal/dracula' }).tokens });
    // tech: nodeRadius 2, minimal: nodeRadius 8
    expect(sharp.svg).toMatch(/class="basic label-container"[^>]*rx="2"/);
    expect(rounded.svg).toMatch(/class="basic label-container"[^>]*rx="8"/);
    // Subgraphs use their own radius token (minimal → 10).
    expect(rounded.svg).toMatch(/<rect[^>]*width="200"[^>]*rx="10"/);
  });

  it('never rounds a shape past its own half-height', () => {
    const { svg } = run({
      tokens: resolveTheme({ preset: 'minimal/dracula', styling: { geometry: { nodeRadius: 400 } } }).tokens,
    });
    // The 120×48 node clamps to 24, the 152×48 node also to 24.
    expect(svg).toContain('rx="24"');
    expect(svg).not.toContain('rx="400"');
  });

  it('injects a background canvas rect', () => {
    const { svg } = run({ tokens: resolveTheme({ preset: 'tech/nord' }).tokens });
    expect(svg).toContain('class="neom-canvas"');
    expect(svg).toMatch(/neomtest1-pattern/);
  });

  it('leaves the canvas transparent when asked', () => {
    const { svg } = run({ background: 'transparent' });
    expect(svg).not.toContain('class="neom-canvas"');
  });

  it('scales arrowheads without breaking their anchor', () => {
    const scaled = run({
      tokens: resolveTheme({ preset: 'cartoon/dracula' }).tokens,
    }).svg;
    // cartoon uses arrowScale 1.3 → 8 becomes 10.4, refX 5 becomes 6.5
    expect(scaled).toMatch(/markerWidth="10.4"/);
    expect(scaled).toMatch(/refX="6.5"/);
  });

  it('namespaces injected defs with the render id', () => {
    const { svg } = run({ tokens: resolveTheme({ preset: 'tech/nord' }).tokens });
    expect(svg).toContain('id="neomtest1-pattern"');
    // Never a bare, collision-prone id.
    expect(svg).not.toMatch(/id="pattern"/);
  });

  it('glows with CSS drop-shadows rather than SVG filters', () => {
    // An SVG filter region is derived from the bounding box, and a horizontal
    // edge has a zero-height box — the element would vanish entirely.
    const neon = run({ tokens: resolveTheme({ preset: 'neon/dracula' }).tokens }).svg;
    expect(neon).toContain('drop-shadow(');
    expect(neon).not.toContain('<filter');
    expect(neon).not.toMatch(/url\(#\w+-eglow\)/);
  });

  it('strips the inline edge animation mermaid seeds every path with', () => {
    const withInline = FIXTURE.replace(
      'class="edge-thickness-normal edge-pattern-solid edge-thickness-normal edge-pattern-solid flowchart-link"',
      'class="edge-thickness-normal flowchart-link" style="stroke-dasharray: 0 0 32 4; stroke-dashoffset: 0;;"',
    );
    const neon = resolveTheme({ preset: 'neon/dracula' }).tokens;
    const { svg } = run({ svg: withInline, tokens: neon });
    const path = /<path[^>]*flowchart-link[^>]*>/.exec(svg)?.[0] ?? '';
    expect(path).not.toContain('stroke-dasharray');
    expect(svg).toContain(`stroke-dasharray: ${neon.geometry.edgeDash}`);
    expect(svg).toContain('neom-dash-neomtest1');
  });

  it('grows edge-label foreignObjects and re-centres them', () => {
    const labelled = FIXTURE.replace(
      '<g class="edgeLabels"></g>',
      '<g class="edgeLabels"><g class="edgeLabel" transform="translate(100, 90)"><g class="label" transform="translate(-12.3, -10.5)">' +
        '<foreignObject width="24.609375" height="21"><div xmlns="http://www.w3.org/1999/xhtml" class="labelBkg" style="display: table-cell; white-space: nowrap; line-height: 1.5; max-width: 200px; text-align: center;"><span class="edgeLabel"><p>yes</p></span></div></foreignObject>' +
        '</g></g></g>',
    );
    const { svg } = run({ svg: labelled });
    const edge = /<g class="edgeLabel"[\s\S]*?<\/g><\/g>/.exec(svg)?.[0] ?? '';
    const fo = /<foreignObject width="([\d.]+)" height="([\d.]+)"/.exec(edge);
    expect(fo).toBeTruthy();
    expect(Number(fo![1])).toBeGreaterThan(24.609375);
    // The label group must stay centred on the anchor point.
    const transform = /<g class="label" transform="translate\(([-\d.]+), ([-\d.]+)\)"/.exec(edge);
    expect(Number(transform![1])).toBeCloseTo(-Number(fo![1]) / 2, 1);
    expect(Number(transform![2])).toBeCloseTo(-Number(fo![2]) / 2, 1);
    // mermaid's `display: table-cell` must not survive: with a host page's
    // `box-sizing: border-box` reset it pushes the text out of the viewport.
    expect(edge).not.toContain('display: table-cell');
    expect(edge).not.toContain('line-height: 1.5');
    expect(edge).toContain('white-space: nowrap');
  });

  it('colours hand-drawn (rough) nodes path by path', () => {
    // Real mermaid output: one dense hatch path (dozens of short strokes that
    // act as the fill) plus a sparse outline path. Painting both with the ink
    // colour is what turned cartoon nodes into black blobs.
    const hatch = `M${Array.from({ length: 15 }, (_, i) => `-70 ${-20 + i} L70 ${-20 + i}`).join(' M')}`;
    const rough = FIXTURE.replace(
      '<g class="node default" id="flowchart-A-0" data-look="neo"',
      '<g class="rough-node default" id="flowchart-A-0" data-look="handDrawn"',
    ).replace(
      '<rect class="basic label-container" style="" x="-76" y="-24" width="152" height="48" rx="5" ry="5"></rect>',
      `<g class="basic label-container"><path d="${hatch}" fill="none" stroke="none"></path><path d="M-76 -24 L76 -24 L76 24 Z" fill="none" stroke="none"></path></g>`,
    );
    const { svg, warnings } = run({ svg: rough, tokens: resolveTheme({ preset: 'cartoon/dracula' }).tokens });
    expect(warnings).toEqual([]);
    const hatchPath = /<path d="M-70 -20[^"]*"([^>]*)\/>/.exec(svg)?.[1] ?? '';
    const outlinePath = /<path d="M-76 -24[^"]*"([^>]*)\/>/.exec(svg)?.[1] ?? '';
    // Hatch: fill colour, so the shading reads as a fill instead of ink.
    expect(hatchPath).toContain('fill="#ffe9c9"');
    expect(hatchPath).toContain('stroke="#ffe9c9"');
    // Outline: ink, at the theme's border width.
    expect(outlinePath).toContain('fill="none"');
    expect(outlinePath).toContain('stroke="#2b2b33"');
    expect(outlinePath).toContain('stroke-width="2.6"');
    // …and the stylesheet must not repaint them.
    expect(svg).not.toMatch(/#\w+ \.rough-node path/);
  });

  it('hides empty edge-label groups instead of painting empty pills', () => {
    // Mindmaps emit label groups with no text, anchored at the origin.
    const withEmpty = FIXTURE.replace(
      '<g class="edgeLabels"></g>',
      '<g class="edgeLabels"><g class="edgeLabel" transform="translate(0, 0)"><g class="label">' +
        '<foreignObject width="12" height="21"><div xmlns="http://www.w3.org/1999/xhtml" class="labelBkg"><span class="edgeLabel"><p></p></span></div></foreignObject>' +
        '</g></g></g>',
    );
    const { svg } = run({ svg: withEmpty });
    expect(svg).toContain('display: none');
  });

  it('survives HTML entities that XML mode rejects', () => {
    const withEntity = FIXTURE.replace('Ship', 'Ship&nbsp;now');
    const { svg, warnings } = run({ svg: withEntity });
    expect(warnings).toEqual([]);
    // Parsed into a real non-breaking space rather than dropping the label.
    expect(svg).toContain('Ship\u00a0now');
  });

  it('falls back to appending styles when the XML is broken', () => {
    const broken = '<svg id="neomtest1" viewBox="0 0 10 10"><g class="node"><rect></svg>'.concat('<oops');
    const { svg, warnings } = run({ svg: broken });
    expect(warnings.join(' ')).toMatch(/parsed as XML/i);
    expect(svg).toContain('data-neomermaid');
  });

  it('produces a standalone svg document with namespaces', () => {
    const { svg } = run();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
});
