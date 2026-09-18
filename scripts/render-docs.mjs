/**
 * Generates the images used by the README and docs.
 *
 *   node scripts/render-docs.mjs
 *
 * The "before" image is produced by mermaid itself with its stock default theme —
 * no strawman editing, the comparison is honest. NeoMermaid images are produced
 * by shelling out to the published CLI, so the docs are also a CLI smoke test.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'docs', 'images');
const cacheDir = resolve(root, '.cache');
mkdirSync(outDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const cliEntry = resolve(root, 'packages', 'cli', 'dist', 'index.js');
if (!existsSync(cliEntry)) {
  console.error('packages/cli/dist/index.js is missing — run `npm run build` first.');
  process.exit(1);
}
const { findBrowsers } = await import(pathToFileURL(cliEntry).href);

const browser = (() => {
  const found = findBrowsers();
  if (!found.length) throw new Error('No Chromium-based browser found.');
  return found[0].path;
})();

/* ------------------------------------------------- 1. honest stock baseline */

const stockBundle = resolve(cacheDir, 'mermaid-stock.js');
await esbuild.build({
  entryPoints: [resolve(root, 'node_modules', 'mermaid', 'dist', 'mermaid.esm.min.mjs')],
  bundle: true,
  format: 'iife',
  globalName: 'mermaid',
  outfile: stockBundle,
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

const example = (id) => {
  const file = resolve(root, 'examples', `${id}.mmd`);
  if (!existsSync(file)) throw new Error(`Missing ${file} — run \`npm run examples\` first.`);
  // Strip the generated header comments.
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('%%'))
    .join('\n')
    .trim();
};

{
  const puppeteerBrowser = await puppeteer.launch({ executablePath: browser, headless: true, args: ['--no-sandbox'] });
  const page = await puppeteerBrowser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  await page.setContent('<!doctype html><html><body style="margin:0;background:#ffffff"></body></html>');
  await page.addScriptTag({ content: readFileSync(stockBundle, 'utf8') });
  const size = await page.evaluate(async (src) => {
    const m = window.mermaid.default ?? window.mermaid;
    m.initialize({ startOnLoad: false, theme: 'default' });
    const { svg } = await m.render('baseline', src);
    document.body.innerHTML = `<div id="shot" style="display:inline-block;padding:24px">${svg}</div>`;
    const el = document.querySelector('#shot svg');
    return [el.getBoundingClientRect().width, el.getBoundingClientRect().height];
  }, example('release-flow'));
  await page.setViewport({
    width: Math.ceil(size[0]) + 48,
    height: Math.ceil(size[1]) + 48,
    deviceScaleFactor: 2,
  });
  const shot = await (await page.$('#shot')).screenshot({ type: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(resolve(outDir, 'baseline-mermaid-default.png'), Buffer.from(shot));
  await puppeteerBrowser.close();
  console.log('✓ docs/images/baseline-mermaid-default.png (mermaid stock theme)');
}

/* ------------------------------------------------------- 2. NeoMermaid output */

const cli = resolve(root, 'packages', 'cli', 'bin', 'neomermaid.mjs');
function neo(exampleId, preset, out, extra = []) {
  execFileSync(process.execPath, [cli, 'render', resolve(root, 'examples', `${exampleId}.mmd`), '-o', resolve(outDir, out), '--preset', preset, '--scale', '2', '--padding', '24', '--quiet', ...extra], {
    stdio: 'inherit',
  });
  console.log(`✓ docs/images/${out}  (${preset})`);
}

neo('release-flow', 'minimal/github-light', 'hero-light.png');
neo('release-flow', 'neon/dracula', 'hero-dark.png');

const grid = [
  ['minimal', 'github-light'],
  ['neon', 'dracula'],
  ['tech', 'tokyo-night'],
  ['cartoon', 'solarized-light'],
  ['glass', 'nord'],
  ['blueprint', 'dracula'],
];
for (const [theme, palette] of grid) {
  neo('service-architecture', `${theme}/${palette}`, `theme-${theme}.png`);
}

// Transparent-background export, to prove alpha survives the pipeline.
neo('release-flow', 'tech/tokyo-night', 'export-transparent.png', ['--background', 'transparent']);

console.log('\nAll docs images written to docs/images');
