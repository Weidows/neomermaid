import { describe, expect, it } from 'vitest';
import { buildStylesheet } from '../src/styles.js';
import { resolveTheme } from '../src/theme.js';

function css(preset: string, extra?: Record<string, unknown>): string {
  const resolved = resolveTheme({ preset, styling: extra as never });
  return buildStylesheet({ id: 'demo', tokens: resolved.tokens, refs: {}, paintsBackground: true });
}

describe('buildStylesheet', () => {
  it('scopes every rule to the diagram id', () => {
    const sheet = css('minimal/dracula');
    const blocks = sheet.split('}').filter((b) => b.includes('{'));
    expect(blocks.length).toBeGreaterThan(10);
    for (const block of blocks) {
      const selector = block.split('{')[0]!.trim();
      if (selector.startsWith('@keyframes')) continue;
      expect(selector).toContain('#demo');
    }
  });

  it('drives geometry tokens into real declarations', () => {
    const sheet = css('minimal/dracula', { geometry: { strokeWidth: 3.5, edgeWidth: 4 } });
    expect(sheet).toContain('stroke-width: 3.5px');
    expect(sheet).toContain('stroke-width: 4px');
  });

  it('propagates typography into HTML labels inside foreignObject', () => {
    const sheet = css('tech/dracula', { typography: { textTransform: 'uppercase', letterSpacing: 1.5 } });
    expect(sheet).toContain('text-transform: uppercase');
    expect(sheet).toContain('letter-spacing: 1.5px');
    // Labels are HTML, so `div`, `span` and `p` need the rule too.
    expect(sheet).toMatch(/#demo div,\s*#demo span,\s*#demo p/);
  });

  it('adds a march animation only when the theme asks for it', () => {
    expect(css('neon/dracula')).toContain('@keyframes neom-dash-demo');
    expect(css('minimal/dracula')).not.toContain('@keyframes');
  });

  it('paints shadows and glows with CSS filters, which never clip to a bbox', () => {
    const neon = css('neon/dracula');
    expect(neon).toContain('drop-shadow(');
    expect(neon).not.toContain('url(#'); // no SVG filter references at all
    expect(neon).toMatch(/#demo \.flowchart-link[\s\S]*?drop-shadow/);
  });

  it('uses the node gradient when one is injected', () => {
    const resolved = resolveTheme({ preset: 'glass/dracula' });
    const withGrad = buildStylesheet({
      id: 'demo',
      tokens: resolved.tokens,
      refs: { nodeGradient: 'demo-node' },
      paintsBackground: true,
    });
    const without = buildStylesheet({ id: 'demo', tokens: resolved.tokens, refs: {}, paintsBackground: true });
    expect(withGrad).toContain('fill: url(#demo-node)');
    expect(without).not.toContain('url(#demo-node)');
  });

  it('falls back to a hard offset shadow for sketch themes', () => {
    const sheet = css('cartoon/dracula');
    expect(sheet).toContain('drop-shadow(0 4px 0');
  });

  it('styles the whole diagram family, not just flowcharts', () => {
    const sheet = css('minimal/dracula');
    for (const selector of [
      '.actor',
      'text.actor',
      '.note',
      '.loopLine',
      '.er.relationshipLine',
      '.er.attributeBoxOdd',
      '.er.attributeBoxEven',
      '.transition',
      '.sequenceNumber',
      '.activation0',
      '.section0',
      '.task',
    ]) {
      expect(sheet).toContain(selector);
    }
  });

  it('gives sequence activations and autonumbers real presence', () => {
    const sheet = css('glass/nord');
    // Accent tint rather than a translucent white that disappears.
    expect(sheet).toMatch(/#demo \.activation0,[\s\S]*?fill: rgba\(136, 192, 208, 0\.2\)/);
    expect(sheet).toMatch(/#demo \.sequenceNumber[\s\S]*?fill: #88c0d0/);
  });

  it('paints one deliberate gantt band colour instead of mermaid\'s half-filled sections', () => {
    const sheet = css('tech/tokyo-night');
    expect(sheet).toMatch(/#demo \.section,[\s\S]*?#demo \.section3[\s\S]*?opacity: 1/);
  });

  it('never paints pie slices with the text colour', () => {
    const sheet = css('minimal/dracula');
    const pieBlock = /#demo \.pieCircle[\s\S]*?\}/.exec(sheet)?.[0] ?? '';
    expect(pieBlock).toBeTruthy();
    // A fill here would override mermaid's per-slice attribute colours.
    expect(pieBlock).not.toContain('fill:');
    expect(pieBlock).toContain('opacity: 1');
    // The percentage text keeps a readable colour over any slice.
    expect(/^#demo \.slice \{[\s\S]*?fill: #ffffff/m.test(sheet)).toBe(true);
  });

  it('cannot be broken out of with hostile values', () => {
    const sheet = css('minimal/dracula', {
      typography: { fontFamily: 'x} body{display:none' },
      colors: { edge: 'red}svg{opacity:0' },
    });
    expect(sheet).not.toContain('body{display:none');
    expect(sheet).not.toContain('svg{opacity:0');
  });

  it('carries the palette colours through', () => {
    expect(css('minimal/dracula')).toContain('#343746'); // dracula surface
    expect(css('minimal/github-light')).toContain('#f6f8fa'); // github-light surface
  });
});
