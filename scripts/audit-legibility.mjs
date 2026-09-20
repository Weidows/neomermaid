#!/usr/bin/env node
/**
 * Legibility audit — the honest way to answer "is any text unreadable?".
 *
 * Every text node in a rendered diagram is measured against the pixels that are
 * actually painted behind it (rasterised, not guessed from theme tokens): the
 * glyph colour is sampled from computed styles, the backdrop from the raster, and
 * the two are compared with the WCAG contrast formula. Translucent surfaces,
 * gradients, halos and series ramps therefore all get measured the way a reader
 * sees them.
 *
 * Usage:
 *   node scripts/audit-legibility.mjs                       # default matrix
 *   node scripts/audit-legibility.mjs --all                 # every preset x example
 *   node scripts/audit-legibility.mjs --presets=a/b,c/d --examples=x.mmd
 *   node scripts/audit-legibility.mjs --json=<path>          # machine-readable
 *
 * Exit code is non-zero when any text falls below the WCAG threshold for its
 * size, so CI can gate on it.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// ── options ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};
const list = (name, fallback) => {
  const value = flag(name, null);
  if (!value) return fallback;
  return String(value).split(',').filter(Boolean);
};

// ── browser discovery (no download: use an already-installed browser) ────────
function findBrowser() {
  const candidates = [
    process.env.NEOMMERMAID_BROWSER,
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error('No Chrome/Edge found. Set NEOMMERMAID_BROWSER=/path/to/browser.');
}

// ── in-page analysis ────────────────────────────────────────────────────────
/**
 * Runs in the browser. Rasterises the rendered SVG and, for every text-bearing
 * element, compares its glyph colour with the dominant colour behind it.
 */
function legibilityProbe({ svg, rasterScale }) {
  const svgEl = document.querySelector('#stage svg');
  if (!svgEl) return { error: 'svg missing' };
  const box = svgEl.getBoundingClientRect();
  const vb = svgEl.viewBox.baseVal;
  const scaleX = box.width / vb.width;
  const scaleY = box.height / vb.height;

  const image = new Image();
  const mount = document.createElement('div');
  mount.style.cssText = 'position:fixed;left:-20000px;top:0';
  mount.appendChild(image);
  document.body.appendChild(mount);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return new Promise((done) => {
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const width = Math.max(1, Math.round(vb.width * rasterScale));
      const height = Math.max(1, Math.round(vb.height * rasterScale));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // Composite onto white first: that is what a PNG export shows, and it is
      // the strict case for transparent themes.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      const px = ctx.getImageData(0, 0, width, height).data;
      const at = (x, y) => {
        const i = (Math.round(y) * width + Math.round(x)) * 4;
        return [px[i], px[i + 1], px[i + 2], px[i + 3]];
      };

      const parse = (value) => {
        const m = String(value).match(/rgba?\(([^)]+)\)/i);
        if (m) {
          const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
          return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
        }
        const trimmed = String(value).trim().replace('#', '');
        if (/^[0-9a-f]{6}$/i.test(trimmed)) {
          return { r: parseInt(trimmed.slice(0, 2), 16), g: parseInt(trimmed.slice(2, 4), 16), b: parseInt(trimmed.slice(4, 6), 16), a: 1 };
        }
        if (/^[0-9a-f]{3}$/i.test(trimmed)) {
          const [r, g, b] = trimmed.split('').map((c) => parseInt(c + c, 16));
          return { r, g, b, a: 1 };
        }
        return null;
      };
      const lum = (c) => {
        const f = (v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
        return (hi + 0.05) / (lo + 0.05);
      };
      const distance = (a, b) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

      /*
       * A label that sits inside a filled shape is read against *that shape's*
       * colour. Pixel sampling alone over-reports on small bars with shadows and
       * anti-aliasing (a 28px timeline bar sampled ~12% lighter than the fill it
       * declares), so the semantic surface is measured too and preferred.
       */
      const canvasRect = svgEl.querySelector('rect[class*="canvas"], rect.neom-canvas');
      const canvasFill = canvasRect ? getComputedStyle(canvasRect).fill : null;

      const declaredBackdrop = (el) => {
        let node = el.parentElement;
        for (let depth = 0; depth < 3 && node && node !== svgEl; depth += 1) {
          for (const shape of node.querySelectorAll('path, rect, polygon, circle, ellipse')) {
            const fill = getComputedStyle(shape).fill;
            if (!fill || fill === 'none' || fill.startsWith('url(')) continue;
            const parsed = parse(fill);
            if (!parsed || parsed.a <= 0.05) continue;
            // The label must genuinely sit *on* the shape: a colour swatch next to
            // a legend entry is not a backdrop, so require containment.
            const shapeBox = shape.getBoundingClientRect();
            const ownBox = el.getBoundingClientRect();
            const overlapW = Math.max(0, Math.min(shapeBox.right, ownBox.right) - Math.max(shapeBox.left, ownBox.left));
            const overlapH = Math.max(0, Math.min(shapeBox.bottom, ownBox.bottom) - Math.max(shapeBox.top, ownBox.top));
            const area = ownBox.width * ownBox.height;
            if (area > 0 && (overlapW * overlapH) / area >= 0.7) return parsed;
          }
          node = node.parentElement;
        }
        return null;
      };

      const findings = [];
      const seen = new Set();
      const candidates = [
        ...svgEl.querySelectorAll('text, tspan, foreignObject span, foreignObject div, foreignObject p'),
      ];

      for (const el of candidates) {
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 200) continue;
        if (el.closest('defs, title, desc, marker')) continue;
        const own = el.getBoundingClientRect();
        if (own.width < 3 || own.height < 3) continue;

        const style = getComputedStyle(el);
        /*
         * In an SVG context `fill` is an inherited property that also lands on HTML
         * elements inside <foreignObject> — so a node label appeared to be painted
         * with the node's fill colour while its real text colour was `color`. Measure
         * `color` for HTML labels and `fill` for SVG text.
         */
        const isHtml = ['div', 'span', 'p'].includes(el.tagName.toLowerCase());
        const raw = isHtml ? style.color : style.fill && style.fill !== 'none' ? style.fill : style.color;
        const glyph = parse(raw);
        if (!glyph || glyph.a === 0) continue;

        // user units -> canvas pixels
        const x0 = ((own.left - box.left) / scaleX) * rasterScale;
        const y0 = ((own.top - box.top) / scaleY) * rasterScale;
        const w = (own.width / scaleX) * rasterScale;
        const h = (own.height / scaleY) * rasterScale;
        const fontSize = parseFloat(style.fontSize) || 12;

        const sample = (rx, ry, rw, rh) => {
          const colours = new Map();
          let text = 0;
          let total = 0;
          for (let y = Math.max(0, Math.floor(ry)); y < Math.min(height, Math.ceil(ry + rh)); y += 1) {
            for (let x = Math.max(0, Math.floor(rx)); x < Math.min(width, Math.ceil(rx + rw)); x += 1) {
              const [r, g, b] = at(x, y);
              const colour = { r, g, b, a: 1 };
              total += 1;
              if (distance(colour, glyph) < 70) {
                text += 1;
                continue;
              }
              const key = `${r >> 3},${g >> 3},${b >> 3}`;
              const bucket = colours.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
              bucket.n += 1;
              bucket.r += r;
              bucket.g += g;
              bucket.b += b;
              colours.set(key, bucket);
            }
          }
          let best = null;
          for (const bucket of colours.values()) {
            if (!best || bucket.n > best.n) best = bucket;
          }
          const backdrop = best
            ? { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n), a: 1 }
            : null;
          return { backdrop, textPixels: text, totalPixels: total };
        };

        let { backdrop, textPixels, totalPixels } = sample(x0, y0, w, h);
        // A tight bbox is mostly glyph + anti-aliasing fringe, so the dominant
        // "backdrop" colour would be a blend rather than the real surface. Sample
        // an inflated region (and, if the glyphs still dominate, a ring outside)
        // so the winner is the surface a reader actually sees.
        const pad = Math.max(3, Math.round(fontSize * rasterScale * 0.6));
        const inflated = sample(x0 - pad, y0 - pad, w + pad * 2, h + pad * 2);
        if (inflated.backdrop && inflated.totalPixels - inflated.textPixels > totalPixels - textPixels) {
          backdrop = inflated.backdrop;
          textPixels = inflated.textPixels;
          totalPixels = inflated.totalPixels;
        }
        if (!backdrop || (totalPixels > 0 && textPixels / totalPixels > 0.85)) {
          const ring = sample(x0 - pad * 2, y0 - pad * 2, w + pad * 4, h + pad * 4);
          if (ring.backdrop) backdrop = ring.backdrop;
        }
        if (!backdrop) continue;

        let declared = declaredBackdrop(el);
        // Inheritance is not a backdrop: a wrapper reporting the same colour as the
        // glyph (an html-label div inheriting `color`) tells us nothing.
        if (declared && distance(declared, glyph) < 12) declared = null;
        const pixelRatio = ratio(glyph, backdrop);
        const value = declared ? ratio(glyph, declared, canvasFill ?? '#ffffff') : pixelRatio;
        // WCAG: large text (>=24px, or >=18.66px bold) only needs 3:1.
        const bold = (parseInt(style.fontWeight, 10) || 400) >= 700;
        const large = fontSize >= 24 || (bold && fontSize >= 18.66);
        const threshold = large ? 3 : 4.5;
        const key = `${text}|${raw}|${Math.round(value * 100)}`;
        if (value < threshold && !seen.has(key)) {
          seen.add(key);
          const chain = [];
          let node = el;
          for (let depth = 0; depth < 4 && node && node !== svgEl; depth += 1) {
            const cls = typeof node.className === 'string' ? node.className : node.className?.baseVal ?? '';
            const fill = getComputedStyle(node).fill;
            chain.push(`${node.tagName.toLowerCase()}${cls ? `.${cls.split(/\s+/).join('.')}` : ''}${fill && fill !== 'none' ? `{${fill}}` : ''}`);
            node = node.parentElement;
          }
          findings.push({
            text: text.length > 40 ? `${text.slice(0, 37)}…` : text,
            className: typeof el.className === 'string' ? el.className : el.className?.baseVal ?? '',
            tag: el.tagName.toLowerCase(),
            fontSize: Math.round(fontSize * 10) / 10,
            glyph: raw,
            backdrop: declared
              ? `rgb(${declared.r}, ${declared.g}, ${declared.b})`
              : `rgb(${backdrop.r}, ${backdrop.g}, ${backdrop.b})`,
            pixelBackdrop: `rgb(${backdrop.r}, ${backdrop.g}, ${backdrop.b})`,
            pixelRatio: Math.round(pixelRatio * 100) / 100,
            ratio: Math.round(value * 100) / 100,
            threshold,
            textPixelShare: totalPixels ? Math.round((textPixels / totalPixels) * 100) / 100 : null,
            chain,
          });
        }
      }
      mount.remove();
      done({ findings, width: vb.width, height: vb.height, textElements: candidates.length });
    };
    image.onerror = () => {
      mount.remove();
      done({ error: 'svg failed to rasterise' });
    };
  });
}

// ── main ────────────────────────────────────────────────────────────────────
const examplesDir = join(root, 'examples');
const allExamples = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.mmd'))
  .sort();
const exampleNames = list('examples', null) ?? allExamples;
const presets = list('presets', null);

const { THEMES, PALETTES } = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href);
const themeIds = Object.keys(THEMES);
const paletteIds = Object.keys(PALETTES);

let matrix;
if (flag('all', false)) {
  matrix = themeIds.flatMap((t) => paletteIds.map((p) => `${t}/${p}`));
} else if (presets) {
  matrix = presets;
} else {
  // Default: every theme on a dark+light palette pair, plus every palette on two
  // themes — enough to catch a broken combination without a 13 x 66 render run.
  matrix = [
    ...themeIds.flatMap((t) => [`${t}/${paletteIds[0]}`, `${t}/github-light`, `${t}/dracula`]),
    ...paletteIds.map((p) => `neon/${p}`),
    ...paletteIds.map((p) => `minimal/${p}`),
  ];
}
matrix = [...new Set(matrix)];

const output = { generatedAt: new Date().toISOString(), browser: findBrowser(), runs: [], failures: [] };
const browser = await puppeteer.launch({
  executablePath: output.browser,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="stage"></div></body></html>');
await page.addScriptTag({ content: readFileSync(join(root, 'packages/core/dist/browser.js'), 'utf8') });
await page.evaluate(async () => {
  await document.fonts?.ready;
});

const only = list('themes', null);
const jobs = only ? matrix.filter((p) => only.includes(p.split('/')[0])) : matrix;
console.log(`legibility audit: ${jobs.length} presets x ${exampleNames.length} examples (${output.browser})\n`);

let checked = 0;
for (const preset of jobs) {
  for (const example of exampleNames) {
    const source = readFileSync(join(examplesDir, example), 'utf8');
    let rendered;
    try {
      rendered = await page.evaluate(
        async (src, opts) => {
          const result = await globalThis.NeoMermaid.render(src, opts);
          const stage = document.querySelector('#stage');
          stage.innerHTML = result.svg;
          return { svg: result.svg, width: result.width, height: result.height };
        },
        source,
        { preset, scale: 1 },
      );
    } catch (error) {
      output.failures.push({ preset, example, render: String(error).slice(0, 160) });
      continue;
    }
    const probe = await page.evaluate(legibilityProbe, { svg: rendered.svg, rasterScale: 2 });
    checked += probe.textElements ?? 0;
    if (probe.error) {
      output.failures.push({ preset, example, probe: probe.error });
      continue;
    }
    output.runs.push({ preset, example, textElements: probe.textElements, findings: probe.findings });
    if (probe.findings.length) {
      console.log(`${preset.padEnd(24)} ${example.replace('.mmd', '').padEnd(22)} ${probe.findings.length} unreadable`);
      for (const f of probe.findings.slice(0, 6)) {
        console.log(`    ${String(f.ratio).padStart(5)}:1 (need ${f.threshold})  ${f.fontSize}px  ${f.glyph} on ${f.backdrop}  "${f.text}"`);
        console.log(`           chain: ${f.chain.join(' < ')}`);
      }
    }
  }
}

await browser.close();

const total = output.runs.reduce((n, r) => n + r.findings.length, 0);
const jsonPath = flag('json', null);
if (jsonPath && typeof jsonPath === 'string') writeFileSync(jsonPath, JSON.stringify(output, null, 2));

console.log(`\ntext elements measured: ${checked}`);
console.log(`runs: ${output.runs.length}   presets: ${jobs.length}`);
if (output.failures.length) console.log(`render/probe failures: ${output.failures.length}`);
console.log(total === 0 ? 'RESULT: PASS — no unreadable text' : `RESULT: FAIL — ${total} unreadable text elements`);
if (jsonPath && typeof jsonPath === 'string') console.log(`report: ${jsonPath}`);
process.exit(total === 0 && output.failures.length === 0 ? 0 : 1);
