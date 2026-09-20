import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASCII_FALLBACK_PREFIX, asciiFromSvg, renderAscii } from '../src/ascii.js';
import { parseColor } from '../src/color.js';
import { resolveTheme } from '../src/theme.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(here, 'fixtures/ascii-flowchart.svg'), 'utf8');

/**
 * Independent width implementation — deliberately *not* the module's own, so a
 * bug in its width table cannot hide behind itself. Anything in the CJK /
 * fullwidth ranges counts as two terminal columns.
 */
function measure(line: string): number {
  let width = 0;
  for (const ch of stripAnsi(line)) {
    const cp = ch.codePointAt(0) ?? 0;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3041 && cp <= 0x33ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f9ff);
    width += wide ? 2 : 1;
  }
  return width;
}

function stripAnsi(text: string): string {
  const esc = String.fromCharCode(27);
  return text
    .split(`${esc}[`)
    .map((part, i) => (i === 0 ? part : part.replace(/^[0-9;]*m/, '')))
    .join('');
}

function ansiFor(colour: string): string {
  const rgba = parseColor(colour);
  if (!rgba) throw new Error(`unparseable colour ${colour}`);
  return `${String.fromCharCode(27)}[38;2;${Math.round(rgba.r)};${Math.round(rgba.g)};${Math.round(rgba.b)}m`;
}

/** A wide LR flowchart: 12 nodes, 220px apart — much wider than any budget. */
function wideSvg(count = 12): string {
  const pitch = 220;
  const nodes = Array.from({ length: count }, (_, i) => {
    const cx = 60 + i * pitch;
    return (
      `<g class="node default" id="n${i}" transform="translate(${cx}, 100)">` +
      `<rect class="basic label-container" x="-90" y="-30" width="180" height="60"></rect>` +
      `<g class="label"><foreignObject width="170" height="24"><div><span class="nodeLabel"><p>Step ${i + 1}</p></span></div></foreignObject></g>` +
      `</g>`
    );
  });
  const edges = Array.from({ length: count - 1 }, (_, i) => {
    const x0 = 60 + i * pitch + 90;
    const x1 = 60 + (i + 1) * pitch - 90;
    return `<path d="M${x0},100L${x1},100" class="edge-thickness-normal flowchart-link" data-id="L_${i}_${i + 1}_0" marker-end="url(#wide-pointEnd)"></path>`;
  });
  const width = 60 + (count - 1) * pitch + 60 + 120;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="flowchart" viewBox="0 0 ${width} 200" aria-roledescription="flowchart-v2">` +
    `<g class="root"><g class="clusters"></g><g class="edgePaths">${edges.join('')}</g><g class="nodes">${nodes.join('')}</g></g>` +
    `</svg>`
  );
}

/** Two CJK-labelled nodes: 4 + 3 wide characters → 8 and 6 columns. */
const CJK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" class="flowchart" viewBox="0 0 400 320" aria-roledescription="flowchart-v2">` +
  `<g class="root"><g class="edgePaths"><path d="M200,84L200,196" class="flowchart-link" data-id="L_1" marker-end="url(#a)"></path></g>` +
  `<g class="nodes">` +
  `<g class="node default" id="cjk-a" transform="translate(200, 60)"><rect class="basic label-container" x="-80" y="-24" width="160" height="48"></rect>` +
  `<g class="label"><foreignObject width="150" height="24"><div><span class="nodeLabel"><p>登录流程</p></span></div></foreignObject></g></g>` +
  `<g class="node default" id="cjk-b" transform="translate(200, 220)"><rect class="basic label-container" x="-80" y="-24" width="160" height="48"></rect>` +
  `<g class="label"><foreignObject width="150" height="24"><div><span class="nodeLabel"><p>完成</p></span></div></foreignObject></g></g>` +
  `</g></g></svg>`;

/** A minimal sequence diagram: two actors, a request, a response and a note. */
const SEQUENCE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" class="sequence" viewBox="0 0 600 400" aria-roledescription="sequence">` +
  `<style>.actor-line{stroke:#999}.messageLine0{stroke:#333}</style>` +
  `<g><line id="actor1" x1="400" y1="76" x2="400" y2="2000" class="actor-line 200" name="B" data-et="life-line" data-id="B"></line>` +
  `<g id="root-1" data-et="participant" data-type="participant" data-id="B">` +
  `<rect x="325" y="0" width="150" height="76" class="actor actor-top" name="B" rx="6"></rect>` +
  `<text x="400" y="38" class="actor actor-box"><tspan x="400" dy="0">Beta</tspan></text></g></g>` +
  `<g><line id="actor0" x1="175" y1="76" x2="175" y2="2000" class="actor-line 200" name="A" data-et="life-line" data-id="A"></line>` +
  `<g id="root-0" data-et="participant" data-type="participant" data-id="A">` +
  `<rect x="100" y="0" width="150" height="76" class="actor actor-top" name="A" rx="6"></rect>` +
  `<text x="175" y="38" class="actor actor-box"><tspan x="175" dy="0">Alpha</tspan></text></g></g>` +
  `<text x="287" y="91" class="messageText" text-anchor="middle">hello world</text>` +
  `<line x1="182" y1="116" x2="393" y2="116" class="messageLine0" data-et="message" data-id="i1" data-from="A" data-to="B" stroke-width="2" marker-end="url(#a)"></line>` +
  `<line x1="175" y1="116" x2="175" y2="116" stroke-width="0" marker-start="url(#n)"></line>` +
  `<text x="175" y="120" class="sequenceNumber">1</text>` +
  `<g data-et="note" data-id="i2"><rect x="100" y="150" width="300" height="36" class="note"></rect>` +
  `<text x="250" y="170" class="noteText" dy="1em">a note here</text></g>` +
  `<text x="287" y="201" class="messageText" text-anchor="middle">ack</text>` +
  `<line x1="393" y1="226" x2="182" y2="226" class="messageLine1" data-et="message" data-id="i3" data-from="B" data-to="A" stroke-width="2" marker-end="url(#a)"></line>` +
  `</svg>`;

const PIE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" aria-roledescription="pie" viewBox="0 0 400 300">` +
  `<g transform="translate(150,150)">` +
  `<g><circle cx="0" cy="0" r="100" class="pieOuterCircle"></circle>` +
  `<path d="M0,-100A100,100,0,0,1,50,86L0,0Z" class="pieCircle"></path>` +
  `<path d="M50,86A100,100,0,0,1,0,-100L0,0Z" class="pieCircle"></path>` +
  `<text class="slice" transform="translate(60,-40)">60%</text>` +
  `<text class="slice" transform="translate(-40,60)">40%</text>` +
  `<text x="0" y="-120" class="pieTitleText">Split</text></g>` +
  `<g class="legend" transform="translate(100,-40)"><rect width="18" height="18"></rect><text x="22" y="14">Alpha [60]</text></g>` +
  `<g class="legend" transform="translate(100,-18)"><rect width="18" height="18"></rect><text x="22" y="14">Beta [40]</text></g>` +
  `</svg>`;

describe('asciiFromSvg — flowcharts', () => {
  it('draws boxes, both node labels and the connector of a two-node diagram', () => {
    const out = asciiFromSvg(FIXTURE);
    const lines = out.split('\n');

    expect(lines.length).toBeGreaterThan(5);
    expect(out).toContain('┌');
    expect(out).toContain('┘');
    expect(out).toContain('Start here');
    expect(out).toContain('Finish');
    // subgraph frame + its label, and the connector with its arrow head
    expect(out).toContain('╭─Local');
    expect(out).toMatch(/[▶▼◀▲]/);
    expect(out).toContain('next');
  });

  it('gives every line the same display width', () => {
    for (const options of [{}, { padding: 0 }, { padding: 3 }, { maxWidth: 40 }, { useAscii: true }]) {
      const out = asciiFromSvg(FIXTURE, options);
      const widths = new Set(out.split('\n').map(measure));
      expect([...widths], JSON.stringify(options)).toHaveLength(1);
    }
  });

  it('respects maxWidth on a diagram that is far too wide', () => {
    const svg = wideSvg(12);
    for (const maxWidth of [120, 80, 40]) {
      const out = asciiFromSvg(svg, { maxWidth });
      const widths = new Set(out.split('\n').map(measure));
      expect([...widths]).toHaveLength(1);
      expect(Math.max(...widths)).toBeLessThanOrEqual(maxWidth);
      // …and the space is actually used, otherwise the test would pass on "  "
      expect(Math.max(...widths)).toBeGreaterThan(Math.floor(maxWidth * 0.8));
    }
  });

  it('counts CJK characters as two columns', () => {
    const out = asciiFromSvg(CJK_SVG, { maxWidth: 60 });
    const lines = out.split('\n');

    expect(out).toContain('登录流程');
    expect(out).toContain('完成');
    // Uniform width is only possible if 登录流程 occupies 8 columns, not 4 —
    // a width-1 table would push the label row past the box borders.
    const widths = new Set(lines.map(measure));
    expect([...widths]).toHaveLength(1);

    const border = lines.find((l) => l.includes('┌'));
    const labelRow = lines.find((l) => l.includes('登录流程'));
    expect(border).toBeTruthy();
    expect(labelRow).toBeTruthy();
    expect(measure(border!)).toBe(measure(labelRow!));
    // 8 columns of text + borders ⇒ the box cannot be narrower than 10.
    expect(measure(border!.trim())).toBeGreaterThanOrEqual(10);
  });

  it('is deterministic and honours showLabels / useAscii', () => {
    expect(asciiFromSvg(FIXTURE)).toBe(asciiFromSvg(FIXTURE));

    const bare = asciiFromSvg(FIXTURE, { showLabels: false });
    expect(bare).not.toContain('Start here');
    expect(bare).toContain('┌');

    const sevenBit = asciiFromSvg(FIXTURE, { useAscii: true });
    expect(sevenBit).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
    expect(sevenBit).toContain('Start here');
  });

  it('colours labels with ANSI codes derived from the resolved theme', () => {
    const tokens = resolveTheme({}).tokens;
    const out = asciiFromSvg(FIXTURE, { colour: true });

    expect(out).toContain(ansiFor(tokens.colors.nodeText));
    expect(out).toContain(ansiFor(tokens.colors.clusterText));
    // no colour ⇒ no escape sequences at all
    expect(asciiFromSvg(FIXTURE)).not.toContain(String.fromCharCode(27));
    // every line still measures the same once the codes are stripped
    const widths = new Set(out.split('\n').map(measure));
    expect([...widths]).toHaveLength(1);
  });
});

describe('asciiFromSvg — other diagram families', () => {
  it('renders a sequence diagram with actors, lifelines, arrows and labels', () => {
    const out = asciiFromSvg(SEQUENCE_SVG);
    const lines = out.split('\n');

    expect(out).toContain('Alpha');
    expect(out).toContain('Beta');
    // Alpha is left of Beta, even though mermaid emits participants reversed.
    expect(out.indexOf('Alpha')).toBeLessThan(out.indexOf('Beta'));
    expect(out).toContain('│');
    expect(out).toContain('hello world');
    expect(out).toContain('1. hello world');
    expect(out).toContain('▶');
    expect(out).toContain('a note here');
    // messageLine1 is a dashed response
    expect(out).toContain('┄');
    expect(new Set(lines.map(measure)).size).toBe(1);
  });

  it('renders a pie chart as a titled bar list', () => {
    const out = asciiFromSvg(PIE_SVG);
    expect(out).toContain('Split');
    expect(out).toContain('Alpha');
    expect(out).toContain('Beta');
    expect(out).toContain('60%');
    expect(out).toContain('40%');
    expect(out).toContain('█');
    expect(out).toMatch(/Alpha\s+█+ 60%/);
  });

  it('falls back to a text dump for diagram families it cannot lay out', () => {
    const gantt =
      `<svg xmlns="http://www.w3.org/2000/svg" aria-roledescription="gantt" viewBox="0 0 400 200">` +
      `<g><text class="titleText">Rollout</text><text class="taskText">Design</text><text class="taskText">Build</text></g></svg>`;
    const out = asciiFromSvg(gantt);
    expect(out.startsWith(ASCII_FALLBACK_PREFIX)).toBe(true);
    expect(out).toContain('gantt');
    expect(out).toContain('Rollout');
    expect(out).toContain('Design');
  });

  it('wraps curved connectors instead of dropping them', () => {
    const curved =
      `<svg xmlns="http://www.w3.org/2000/svg" class="flowchart" viewBox="0 0 500 300" aria-roledescription="flowchart-v2">` +
      `<g class="root"><g class="edges edgePaths">` +
      `<path d="M160,100C240,100 260,200 340,200" class="edge-thickness-normal flowchart-link" data-id="L_x" marker-end="url(#a)"></path>` +
      `</g><g class="nodes">` +
      `<g class="node default" transform="translate(80, 100)"><rect class="basic label-container" x="-80" y="-25" width="160" height="50"></rect>` +
      `<g class="label"><foreignObject width="150" height="24"><div><span class="nodeLabel"><p>Curvy A</p></span></div></foreignObject></g></g>` +
      `<g class="node default" transform="translate(420, 200)"><rect class="basic label-container" x="-80" y="-25" width="160" height="50"></rect>` +
      `<g class="label"><foreignObject width="150" height="24"><div><span class="nodeLabel"><p>Curvy B</p></span></div></foreignObject></g></g>` +
      `</g></g></svg>`;
    const out = asciiFromSvg(curved);
    expect(out).toContain('Curvy A');
    expect(out).toContain('Curvy B');
    expect(out).toMatch(/[─│\/\\]/);
    expect(out).toContain('▶');
  });
});

describe('asciiFromSvg — never throws', () => {
  const garbage = [
    '',
    '   ',
    'not markup at all',
    '<html><body><p>hello</p></body></html>',
    '<svg><g class="node"><rect></svg>',
    '<svg viewBox="0 0 10 10"><g class="label"><rect width="10" height="10"></rect></g></svg>',
    '<svg aria-roledescription="sequence"><g data-et="participant"></g></svg>',
    '<svg><g class="cluster"><rect width="0" height="0"></rect></g></svg>',
  ];

  it('returns a labelled fallback string for every kind of junk', () => {
    for (const input of garbage) {
      let out = '';
      expect(() => {
        out = asciiFromSvg(input);
      }, JSON.stringify(input)).not.toThrow();
      const [first = '', second = ''] = out.split('\n');
      expect(out.length, JSON.stringify(input)).toBeGreaterThan(0);
      // The marker is on the first line, unpadded, so hosts can detect it.
      expect(first.startsWith(ASCII_FALLBACK_PREFIX), JSON.stringify(input)).toBe(true);
      expect(second.startsWith(ASCII_FALLBACK_PREFIX), JSON.stringify(input)).toBe(true);
    }
  });

  it('still draws a node whose shape markup is unusable', () => {
    // A node group with a transform but no measurable shape: the renderer
    // invents a small box instead of giving up on the diagram.
    const out = asciiFromSvg(
      '<svg viewBox="0 0 100 100"><g class="node" transform="translate(50,50)"><polygon points=""></polygon></g></svg>',
    );
    expect(out).not.toContain(ASCII_FALLBACK_PREFIX);
    expect(out).toContain('┌');
  });

  it('labels the fallback with the diagram type it could not draw', () => {
    const out = asciiFromSvg('<svg aria-roledescription="mindmap"><g><text>Root</text></g></svg>');
    expect(out).toContain('mindmap');
    expect(out).toContain('Root');
  });

  it('accepts non-string input without throwing', () => {
    expect(() => asciiFromSvg(undefined as unknown as string)).not.toThrow();
    expect(asciiFromSvg(null as unknown as string).startsWith(ASCII_FALLBACK_PREFIX)).toBe(true);
  });
});

describe('renderAscii', () => {
  it('is exported and returns a promise', async () => {
    expect(typeof renderAscii).toBe('function');
    // `render()` needs a browser; asserting the rejected promise still resolves
    // through our fallback path would require a DOM, so only the shape is
    // checked here (the CLI smoke run covers the DOM path end to end).
    const result = renderAscii('flowchart LR\n a --> b').catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return `${ASCII_FALLBACK_PREFIX} ${message}`;
    });
    expect(result).toBeInstanceOf(Promise);
    await result;
  });
});
