#!/usr/bin/env node
/**
 * NeoMermaid demo — headless smoke test.
 *
 * Builds the app, serves `dist/` with vite preview, drives it in the real system
 * Edge (puppeteer-core, no bundled browser) and asserts the behaviour the demo
 * promises. Prints a PASS/FAIL table and exits non-zero on any failure.
 *
 *   node scripts/smoke.mjs
 *
 * Env: SMOKE_PORT (4173), SMOKE_BROWSER (system Edge path), SMOKE_KEEP_OPEN=1
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const PORT = Number(process.env.SMOKE_PORT ?? 4173);
const BASE = `http://127.0.0.1:${PORT}/`;
const BROWSER_CANDIDATES = [
  process.env.SMOKE_BROWSER,
  process.env.NEOMERMAID_BROWSER,
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
/** First installed Chromium-based browser — Linux/macOS CI included. */
const EDGE = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
if (!EDGE) {
  console.error(`No Chromium-based browser found. Tried:\n${BROWSER_CANDIDATES.join('\n')}`);
  process.exit(1);
}

const rows = [];
const log = (...args) => console.log(...args);

function check(name, pass, detail = '') {
  rows.push({ name, pass: Boolean(pass), detail: String(detail) });
  log(`${pass ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function resolveViteBin() {
  const candidates = [];
  try {
    candidates.push(join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js'));
  } catch {
    /* not resolvable from here — fall back to path guesses */
  }
  candidates.push(
    join(appDir, 'node_modules', 'vite', 'bin', 'vite.js'),
    join(appDir, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js'),
  );
  return candidates.find((p) => existsSync(p));
}

async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.status;
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`preview server never became ready: ${last}`);
}

/* ------------------------------------------------------------- page helpers */

const host = '#stage-host';

async function renderId(page) {
  return page.evaluate((sel) => document.querySelector(sel)?.dataset.renderId ?? null, host);
}

async function waitForRender(page, prevId, timeout = 60000) {
  await page.waitForFunction(
    (sel, prev) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const state = el.dataset.renderState;
      return (state === 'ready' || state === 'error') && el.dataset.renderId !== prev;
    },
    { timeout, polling: 120 },
    host,
    prevId,
  );
  return page.evaluate((sel) => document.querySelector(sel).dataset.renderState, host);
}

async function svgSnapshot(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const svg = el?.querySelector('svg');
    const rect = svg?.getBoundingClientRect();
    return {
      hasSvg: Boolean(svg),
      rectWidth: rect ? Math.round(rect.width * 100) / 100 : 0,
      rectHeight: rect ? Math.round(rect.height * 100) / 100 : 0,
      attrWidth: svg ? Number(svg.getAttribute('width')) : 0,
      attrHeight: svg ? Number(svg.getAttribute('height')) : 0,
      viewBox: svg ? svg.getAttribute('viewBox') : null,
      html: el?.innerHTML ?? '',
      text: (el?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      preset: el?.dataset.preset ?? '',
    };
  }, host);
}

/* ------------------------------------------------------------------- runner */

let server;
let browser;
let step = 'bootstrap';

try {
  /* ---------------------------------------------------------- 1. vite build */
  step = 'vite build';
  log('\n[1/3] build');
  const viteBin = resolveViteBin();
  if (!viteBin) throw new Error('vite binary not found — run from the monorepo checkout');
  const build = spawnSync(process.execPath, [viteBin, 'build'], { cwd: appDir, encoding: 'utf8' });
  const buildTail = (build.stdout ?? '')
    .trim()
    .split('\n')
    .filter((line) => /dist\/|built in|error/i.test(line));
  log(buildTail.map((l) => `     ${l.trim()}`).join('\n'));
  check('vite build exits 0', build.status === 0, `exit=${build.status}`);

  const distHtmlPath = join(appDir, 'dist', 'index.html');
  const distHtml = readFileSync(distHtmlPath, 'utf8');
  const assetRefs = [...distHtml.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => url.includes('assets/'));
  check(
    'dist/index.html uses relative asset urls',
    assetRefs.length > 0 && assetRefs.every((url) => url.startsWith('./')),
    assetRefs.join(' ') || 'no asset references found',
  );

  /* -------------------------------------------------------- 2. vite preview */
  step = 'vite preview';
  log('\n[2/3] serve dist with vite preview');
  const { preview } = await import('vite');
  server = await preview({
    root: appDir,
    configFile: join(appDir, 'vite.config.ts'),
    preview: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  const status = await waitForHttp(BASE);
  log(`     serving ${BASE} (HTTP ${status})`);

  /* ------------------------------------------------------------- 3. browser */
  step = 'launch edge';
  log('\n[3/3] drive the page in headless Edge');
  if (!existsSync(EDGE)) throw new Error(`system browser not found at ${EDGE}`);
  const puppeteer = (await import('puppeteer-core')).default;
  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--disable-features=Translate,BackForwardCache',
    ],
  });
  log(`     ${await browser.version()}`);

  const errors = [];
  const attach = (page, tag) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`[${tag}] console.error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (url.startsWith(BASE)) {
        errors.push(`[${tag}] requestfailed: ${url} (${req.failure()?.errorText})`);
      }
    });
  };

  step = 'load app';
  const page = await browser.newPage();
  attach(page, 'main');
  const consoleErrorsOnLoad = [];
  await page.goto(BASE, { waitUntil: 'load' });
  const firstState = await waitForRender(page, null);
  check('initial render reaches a terminal state', firstState === 'ready', `state=${firstState}`);

  /* (a) an <svg> is rendered and is non-empty ----------------------------- */
  step = 'assert svg';
  const sprite = await svgSnapshot(page);
  check(
    '(a) svg rendered with nonzero size',
    sprite.hasSvg && sprite.rectWidth > 0 && sprite.attrWidth > 0 && sprite.attrHeight > 0,
    `css ${sprite.rectWidth}×${sprite.rectHeight}px, attrs ${sprite.attrWidth}×${sprite.attrHeight}, viewBox="${sprite.viewBox}"`,
  );

  /* (b) preset switching repaints the svg -------------------------------- */
  step = 'assert preset';
  let prev = await renderId(page);
  await page.select('#preset', 'neon/dracula');
  let stateAfter = await waitForRender(page, prev);
  const dracula = await svgSnapshot(page);
  const draculaHasPink = dracula.html.includes('#ff79c6');
  log(`     preset=${dracula.preset} state=${stateAfter}`);

  prev = await renderId(page);
  await page.select('#preset', 'minimal/github-light');
  stateAfter = await waitForRender(page, prev);
  const light = await svgSnapshot(page);
  const lightHasPink = light.html.includes('#ff79c6');
  log(`     preset=${light.preset} state=${stateAfter}`);
  check(
    "(b) 'neon/dracula' injects #ff79c6 and 'minimal/github-light' removes it",
    draculaHasPink && !lightHasPink,
    `dracula had #ff79c6=${draculaHasPink}, github-light had #ff79c6=${lightHasPink}`,
  );

  /* (c) switching the example changes the diagram text ------------------- */
  step = 'assert example';
  const beforeText = light.text;
  prev = await renderId(page);
  await page.select('#example', 'auth-sequence');
  await waitForRender(page, prev);
  const seq = await svgSnapshot(page);
  const textChanged = seq.text !== beforeText && seq.text.length > 0;
  const hasPkce = seq.text.includes('PKCE');
  check(
    '(c) switching the example changes the diagram content',
    textChanged && hasPkce,
    `changed=${textChanged}, contains "PKCE"=${hasPkce}, sample="${seq.text.slice(0, 70)}…"`,
  );

  /* (e) png export ------------------------------------------------------- */
  step = 'assert png export';
  await page.evaluate(() => {
    window.__nmExport = undefined;
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      window.__nmExport = blob;
      return original(blob);
    };
  });
  await page.click('#export-png');
  await page.waitForFunction(() => window.__nmExport instanceof Blob, { timeout: 60000, polling: 150 });
  const png = await page.evaluate(async () => {
    const blob = window.__nmExport;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const base64 = await new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => res(String(reader.result).split(',')[1] ?? '');
      reader.readAsDataURL(blob);
    });
    return {
      type: blob.type,
      size: blob.size,
      head: Array.from(bytes.slice(0, 8)),
      base64,
      status: document.querySelector('#status')?.textContent ?? '',
    };
  });
  const artifactDir = join(tmpdir(), 'neomermaid-demo-smoke');
  mkdirSync(artifactDir, { recursive: true });
  const pngPath = join(artifactDir, 'export.png');
  writeFileSync(pngPath, Buffer.from(png.base64, 'base64'));
  log(`     wrote ${pngPath} (${png.size} bytes)`);
  const signature = png.head.slice(0, 4).join(',');
  const isPng = signature === '137,80,78,71'; // \x89 P N G
  check(
    '(e) PNG export produces a \x89PNG blob',
    isPng,
    `head=[${png.head.join(' ')}] type=${png.type} size=${png.size}B status="${png.status}"`,
  );
  check(
    '(e2) exported PNG is a real raster (> 2 kB)',
    png.size > 2048,
    `${png.size} bytes for ${seq.attrWidth}×${seq.attrHeight} px source`,
  );

  /* (g) padding control actually repaints wider -------------------------- */
  step = 'assert padding control';
  const narrow = await svgSnapshot(page);
  prev = await renderId(page);
  await page.evaluate(() => {
    const el = document.querySelector('#padding');
    el.value = '48';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await waitForRender(page, prev);
  const wide = await svgSnapshot(page);
  const paddingHash = await page.evaluate(() => window.location.hash);
  check(
    '(g) padding slider widens the canvas and the share hash stays readable',
    wide.attrWidth > narrow.attrWidth &&
      paddingHash.includes('padding=48') &&
      paddingHash.includes('preset=minimal/github-light'),
    `${narrow.attrWidth}px → ${wide.attrWidth}px, hash="${paddingHash}"`,
  );

  /* (d) console cleanliness --------------------------------------------- */
  step = 'assert console';
  const dupes = [...consoleErrorsOnLoad];
  check(
    '(d) no console errors / page errors / failed same-origin requests',
    errors.length === 0,
    errors.length === 0 ? `${errors.length} errors` : errors.slice(0, 4).join(' | '),
  );
  void dupes;

  /* (f) deep link ------------------------------------------------------- */
  step = 'assert deep link';
  const deepUrl = `${BASE}#preset=tech/tokyo-night&example=commerce-er`;
  const deep = await browser.newPage();
  attach(deep, 'deeplink');
  await deep.goto(deepUrl, { waitUntil: 'load' });
  const deepState = await waitForRender(deep, null);
  const deepView = await deep.evaluate((sel) => ({
    preset: document.querySelector('#preset').value,
    example: document.querySelector('#example').value,
    theme: document.querySelector(sel)?.dataset.preset ?? '',
    hasTokyoCyan: (document.querySelector(sel)?.innerHTML ?? '').includes('#7dcfff'),
    padding: document.querySelector('#padding').value,
    text: (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  }), host);
  const deepOk =
    deepState === 'ready' &&
    deepView.preset === 'tech/tokyo-night' &&
    deepView.example === 'commerce-er' &&
    deepView.theme === 'tech/tokyo-night' &&
    deepView.hasTokyoCyan &&
    deepView.text.includes('ORDER_LINE');
  check(
    '(f) #preset=tech/tokyo-night&example=commerce-er deep-links into that state',
    deepOk,
    `state=${deepState} select=${deepView.preset}/${deepView.example} tokyo-cyan=${deepView.hasTokyoCyan} ORDER_LINE=${deepView.text.includes('ORDER_LINE')}`,
  );
  log(`     deep-link text: "${deepView.text.slice(0, 80)}…"`);
  check(
    '(h) deep link without ?padding keeps the 24px default (regression guard)',
    deepView.padding === '24',
    `#padding=${deepView.padding}`,
  );
  const shotPath = join(artifactDir, 'playground-tokyo-night.png');
  await deep.screenshot({ path: shotPath });
  log(`     wrote ${shotPath}`);

  /* (d2) console cleanliness, both pages -------------------------------- */
  check('(d2) still no console errors after all interactions', errors.length === 0, errors.length === 0 ? '0 errors' : errors.slice(0, 4).join(' | '));
} catch (error) {
  check(`unexpected failure during "${step}"`, false, (error?.stack ?? String(error)).split('\n').slice(0, 3).join(' ⏎ '));
} finally {
  if (process.env.SMOKE_KEEP_OPEN !== '1') {
    if (browser) await browser.close().catch(() => {});
    if (server) {
      server.httpServer?.closeAllConnections?.();
      await server.close().catch(() => {});
    }
  }
}

/* ------------------------------------------------------------------- report */

const width = Math.max(...rows.map((r) => r.name.length), 10);
log(`\n${'─'.repeat(width + 24)}`);
log('SMOKE RESULT');
log('─'.repeat(width + 24));
for (const row of rows) {
  log(`${row.pass ? 'PASS' : 'FAIL'}  ${row.name.padEnd(width)}  ${row.detail}`);
}
const failed = rows.filter((r) => !r.pass);
log('─'.repeat(width + 24));
log(`${rows.length - failed.length}/${rows.length} checks passed`);
process.exit(failed.length ? 1 : 0);
