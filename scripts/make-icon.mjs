#!/usr/bin/env node
/**
 * Generate the extension icon (and the Marketplace-sized variants) as real PNGs.
 *
 * Drawn as SVG so the source is reviewable and editable, then rasterised in the
 * browser that is already on the machine — no image library, no network, no design
 * tool. The corners are transparent, which is what a Marketplace listing wants.
 *
 *   node scripts/make-icon.mjs [--out packages/vscode/media/icon.png] [--size 256]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const [, value] = hit.split('=');
  return value ?? true;
};
const out = resolve(root, String(flag('out', 'packages/vscode/media/icon.png')));
const size = Number(flag('size', 256));

/**
 * A mermaid-ish motif: two source nodes feeding one accented node, i.e. the smallest
 * diagram that still reads as a diagram at 64 px. Colours come from the project's
 * Tokyo Night palette so the icon matches the product.
 */
const svg = (px) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1f2335"/>
      <stop offset="100%" stop-color="#12131a"/>
    </linearGradient>
    <!-- The output takes its gradient from the two inputs: the merge reads logically. -->
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7dcfff"/>
      <stop offset="100%" stop-color="#bb9af7"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect width="256" height="256" rx="58" fill="url(#bg)"/>

  <!-- connectors: one shared segment into the output, so the junction is not pinched -->
  <path d="M94 84 C 122 84, 118 128, 138 128" fill="none" stroke="#7dcfff" stroke-width="9" stroke-linecap="round"/>
  <path d="M94 172 C 122 172, 118 128, 138 128" fill="none" stroke="#bb9af7" stroke-width="9" stroke-linecap="round"/>
  <path d="M134 128 H 148" stroke="#9ecbff" stroke-width="9" stroke-linecap="round"/>
  <path d="M146 116 L 162 128 L 146 140 Z" fill="#a6c8ff"/>

  <!-- inputs -->
  <rect x="26" y="62" width="68" height="44" rx="12" fill="#2a3049" stroke="#7dcfff" stroke-width="6"/>
  <rect x="26" y="150" width="68" height="44" rx="12" fill="#2a3049" stroke="#bb9af7" stroke-width="6"/>

  <!-- the node everything flows into -->
  <rect x="154" y="104" width="76" height="48" rx="13" fill="url(#accent)" filter="url(#glow)"/>
</svg>
`;
function findBrowser() {
  const candidates = [
    process.env.NEOMMERMAID_BROWSER,
    process.env.CHROME_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error('No Chrome/Edge found. Set NEOMMERMAID_BROWSER=/path/to/browser.');
}

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
await page.setContent(
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${svg(size)}</body></html>`,
  { waitUntil: 'load' },
);
const buffer = Buffer.from(
  await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }),
);
await browser.close();

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buffer);
console.log(`icon: ${out} (${size}x${size}, ${buffer.length} bytes)`);
