#!/usr/bin/env node
/**
 * Headless smoke test for the NeoMermaid VS Code preview.
 *
 * It loads the *real* build artefacts in a real browser engine:
 *
 *   dist/webview.js     the shipped webview bundle (mermaid + core inlined)
 *   media/webview.html  the real webview template, placeholders substituted
 *   dist/extension.cjs  checked for the template placeholders it must fill in
 *
 * The fixture is served over HTTP on 127.0.0.1 rather than opened as a file://
 * URL: a file:// document has an opaque origin, which taints the canvas and
 * blocks the PNG readback checks. A webview has a real origin, so the test uses
 * one too.
 *
 * then drives the panel exactly like the extension host does — an `init`
 * message, a `setState` theme change, a UI-driven pick, a source update and PNG
 * / SVG export round-trips — and asserts the rendered SVG really carries the
 * preset's colours.
 *
 * Usage:  node packages/vscode/scripts/webview-smoke.mjs
 * Env:    NEOMERMAID_BROWSER / CHROME_PATH / PUPPETEER_EXECUTABLE_PATH override
 *         the browser that is used (defaults to the system Edge, then Chrome).
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const distDir = join(pkgRoot, 'dist');
const mediaDir = join(pkgRoot, 'media');

const WEBVIEW_JS = join(distDir, 'webview.js');
const EXTENSION_CJS = join(distDir, 'extension.cjs');
const TEMPLATE = join(mediaDir, 'webview.html');
const STYLESHEET = join(mediaDir, 'webview.css');

const ROOT_ID = 'neomermaid-root';
const NEON_EDGE = '#ff79c6'; // neon theme × dracula palette
const LIGHT_EDGE = '#8c959f'; // minimal theme × github-light palette
const LIGHT_SURFACE = '#f6f8fa'; // github-light node fill
const SOURCE = `flowchart LR
  a["Alpha"] --> b["Beta"]
  b -- "ok" --> c(["Gamma"])
`;
const UPDATED_SOURCE = `flowchart LR
  only["OnlyNode"] --> done(["Finished"])
`;

/* ------------------------------------------------------------------ harness */

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  const pass = Boolean(ok);
  if (!pass) failures += 1;
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return pass;
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}`);
}

function fatal(message) {
  console.error(`\nFAIL  ${message}`);
  process.exit(1);
}

/* ------------------------------------------------------------- browser pick */

const BROWSER_CANDIDATES = [
  process.env.NEOMERMAID_BROWSER,
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe') : undefined,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/chromium',
].filter(Boolean);

function pickBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  fatal(`no Chromium-based browser found. Tried:\n${BROWSER_CANDIDATES.join('\n')}`);
  return '';
}

/* ------------------------------------------------------------------- fixtures */

function buildFixture() {
  const dir = join(tmpdir(), `neomermaid-webview-smoke-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const template = readFileSync(TEMPLATE, 'utf8');
  // Same shape as the CSP the extension generates (a real origin, so 'self' works).
  const html = template
    .replaceAll(
      '{{csp}}',
      "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src data:; img-src data: blob:; script-src 'nonce-smoke-nonce'; connect-src 'none'",
    )
    .replaceAll('{{nonce}}', 'smoke-nonce')
    .replaceAll('{{styleUri}}', 'webview.css')
    .replaceAll('{{scriptUri}}', 'webview.js');

  writeFileSync(join(dir, 'preview.html'), html, 'utf8');
  copyFileSync(WEBVIEW_JS, join(dir, 'webview.js'));
  copyFileSync(STYLESHEET, join(dir, 'webview.css'));
  return { dir, template };
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Serve the fixture on loopback so the page has a real, non-opaque origin. */
function serveFixture(dir) {
  const server = createServer((request, response) => {
    const name = (request.url ?? '/').replace(/^\/+/, '').split('?')[0] || 'preview.html';
    const file = join(dir, name);
    if (!file.startsWith(dir) || !existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolvePromise({
        url: `http://127.0.0.1:${port}/preview.html`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/* ------------------------------------------------------------------ PNG sniff */

function pngInfo(bytes) {
  const signature = bytes.subarray(0, 8).toString('hex');
  const isPng = signature === '89504e470d0a1a0a';
  if (!isPng) return { isPng, signature };
  const chunkType = bytes.subarray(12, 16).toString('ascii');
  return {
    isPng,
    signature,
    chunkType,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

/* ---------------------------------------------------------------------- main */

class Page {
  constructor(page) {
    this.page = page;
  }

  async outbox() {
    return this.page.evaluate(() => window.__neomOutbox ?? []);
  }

  async marker() {
    return (await this.outbox()).length;
  }

  async send(message) {
    await this.page.evaluate((payload) => {
      window.dispatchEvent(new MessageEvent('message', { data: payload }));
    }, message);
  }

  async waitFor(since, predicate, description, timeout = 60_000) {
    const deadline = Date.now() + timeout;
    let seen = [];
    while (Date.now() < deadline) {
      const messages = await this.outbox();
      seen = messages.slice(since);
      const hit = seen.find(predicate);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `timed out waiting for ${description}. Messages since marker:\n${JSON.stringify(seen, null, 1).slice(0, 1500)}`,
    );
  }

  async eval(fn) {
    return this.page.evaluate(fn);
  }
}

async function main() {
  section('artefacts');

  for (const file of [WEBVIEW_JS, EXTENSION_CJS, TEMPLATE, STYLESHEET]) {
    if (!existsSync(file)) fatal(`${file} is missing — run "node scripts/build-vscode.mjs" first.`);
  }

  const webviewBytes = readFileSync(WEBVIEW_JS);
  const webviewSize = statSync(WEBVIEW_JS).size;
  const webviewHash = createHash('sha256').update(webviewBytes).digest('hex').slice(0, 16);
  const extensionSize = statSync(EXTENSION_CJS).size;
  check(
    'dist/webview.js and dist/extension.cjs are present',
    webviewSize > 100_000 && extensionSize > 5_000,
    `webview ${(webviewSize / 1024).toFixed(1)} kB sha256:${webviewHash} · extension ${(extensionSize / 1024).toFixed(1)} kB`,
  );
  check(
    'dist/webview.js inlines mermaid + @neomermaid/core',
    webviewBytes.includes('mermaid') && webviewBytes.includes('flowchart'),
  );

  const fixture = buildFixture();
  const server = await serveFixture(fixture.dir);

  // The template placeholders the extension substitutes, cross-checked against
  // the built extension: if one side is renamed the panel renders blank.
  const extensionSource = readFileSync(EXTENSION_CJS, 'utf8');
  const tokens = ['{{csp}}', '{{nonce}}', '{{styleUri}}', '{{scriptUri}}'];
  check(
    'webview template and extension agree on the placeholders',
    tokens.every((t) => fixture.template.includes(t) && extensionSource.includes(t)),
    tokens.join(' '),
  );

  const browserPath = pickBrowser();
  section('browser');
  console.log(`      ${browserPath}`);

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--force-color-profile=srgb'],
    timeout: 60_000,
  });

  const pageErrors = [];
  let exitCode = 1;

  try {
    const raw = await browser.newPage();
    await raw.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    raw.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
    raw.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(`console.error: ${message.text()}`);
    });

    // Stand in for VS Code: the webview bundle talks to the host through this.
    await raw.evaluateOnNewDocument(() => {
      window.__neomOutbox = [];
      window.acquireVsCodeApi = () => ({
        postMessage(message) {
          window.__neomOutbox.push(message);
        },
        getState() {
          return undefined;
        },
        setState() {},
      });
    });

    await raw.goto(server.url, { waitUntil: 'load' });
    const page = new Page(raw);

    /* ---------------------------------------------------------- boot + init */

    section('boot');
    await page.waitFor(0, (m) => m.type === 'ready', 'the webview ready handshake');

    const shell = await page.eval(() => ({
      root: Boolean(document.querySelector('#neomermaid-root')),
      toolbar: Boolean(document.querySelector('#neomermaid-root .neom-toolbar')),
      canvas: Boolean(document.querySelector('#neomermaid-root [data-role="canvas"]')),
      themes: [...document.querySelectorAll('#neomermaid-root [data-role="theme"] option')].map((o) => o.value),
      palettes: [...document.querySelectorAll('#neomermaid-root [data-role="palette"] option')].map((o) => o.value),
    }));
    check('template mounts #neomermaid-root', shell.root, `meta ${shell.themes.length} themes / ${shell.palettes.length} palettes`);
    check(
      'toolbar and canvas are mounted inside the root',
      shell.toolbar && shell.canvas,
      `themes ${shell.themes.join(',')}`,
    );
    check(
      'core catalog is populated from the bundle (no host catalog needed)',
      shell.themes.length === 6 && shell.palettes.length === 11 && shell.themes.includes('neon') && shell.palettes.includes('dracula'),
      `${shell.themes.length} themes · ${shell.palettes.length} palettes`,
    );

    /* -------------------------------------------------------- init / render */

    section('init → render (neon/dracula)');
    let marker = await page.marker();
    await page.send({
      type: 'init',
      source: SOURCE,
      documentLabel: 'smoke.mmd',
      state: { preset: 'neon/dracula', background: 'theme', padding: 16, exportScale: 2, zoom: 1, fitToWidth: true },
      appearance: 'dark',
      liveUpdateDelay: 120,
    });

    const neonRender = await page.waitFor(marker, (m) => m.type === 'rendered' && m.ok, 'the first render');
    check(
      'init message renders a diagram',
      neonRender.ok && neonRender.preset === 'neon/dracula' && neonRender.width > 0 && neonRender.height > 0,
      `${neonRender.preset} ${neonRender.width}×${neonRender.height} in ${Math.round(neonRender.durationMs)} ms`,
    );

    const neonSvg = await page.eval(() => document.querySelector('#neomermaid-root svg')?.outerHTML ?? '');
    check('an <svg> lives inside the webview root', neonSvg.startsWith('<svg'), `${(neonSvg.length / 1024).toFixed(1)} kB of SVG`);
    check(
      'neon/dracula colours are in the rendered SVG',
      neonSvg.includes(NEON_EDGE) && neonSvg.includes('#282a36'),
      `${NEON_EDGE} + dracula canvas`,
    );
    check(
      'github-light colours are absent for neon/dracula',
      // Specific palette colours, not generic white: the stylesheet legitimately
      // contains #ffffff (pie slice labels, for instance) in every theme.
      !neonSvg.includes(LIGHT_EDGE) && !neonSvg.includes(LIGHT_SURFACE),
      `${LIGHT_EDGE} not present`,
    );
    const zoomLabel = await page.eval(() => document.querySelector('#neomermaid-root [data-role="zoom"]')?.textContent ?? '');
    const statusText = await page.eval(() => document.querySelector('#neomermaid-root [data-role="status"]')?.textContent ?? '');
    check('status line and zoom control updated', /neon\/dracula/.test(statusText) && /%$/.test(zoomLabel), `${statusText} · zoom ${zoomLabel}`);

    /* ------------------------------------------------- theme change (host) */

    section('theme change (host setState → minimal/github-light)');
    marker = await page.marker();
    await page.send({ type: 'setState', state: { preset: 'minimal/github-light' }, appearance: 'light' });
    const lightRender = await page.waitFor(marker, (m) => m.type === 'rendered' && m.ok, 'the light re-render');
    check(
      'setState re-renders with the new preset',
      lightRender.preset === 'minimal/github-light' && lightRender.appearance === 'light',
      `${lightRender.preset} · ${lightRender.width}×${lightRender.height}`,
    );
    const lightSvg = await page.eval(() => document.querySelector('#neomermaid-root svg')?.outerHTML ?? '');
    check(
      'minimal/github-light colours replaced the neon ones',
      lightSvg.includes(LIGHT_EDGE) && !lightSvg.includes(NEON_EDGE),
      `${LIGHT_EDGE} present, ${NEON_EDGE} gone`,
    );

    /* --------------------------------------------- theme change (toolbar UI) */

    section('theme change (toolbar pick → neon/dracula)');
    marker = await page.marker();
    await page.eval(() => {
      const theme = document.querySelector('#neomermaid-root [data-role="theme"]');
      const palette = document.querySelector('#neomermaid-root [data-role="palette"]');
      theme.value = 'neon';
      palette.value = 'dracula';
      palette.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const pick = await page.waitFor(
      marker,
      (m) => m.type === 'rendered' && m.ok && m.preset === 'neon/dracula',
      'the toolbar-driven render',
    );
    const stateChanged = await page.waitFor(
      marker,
      (m) => m.type === 'stateChanged' && m.reason === 'user',
      'the state report back to the host',
    );
    const backToNeon = await page.eval(() => document.querySelector('#neomermaid-root svg')?.outerHTML ?? '');
    check(
      'toolbar pick re-renders and reports state to the host',
      pick.preset === 'neon/dracula' && stateChanged.state.preset === 'neon/dracula',
      `stateChanged(${stateChanged.reason}) → ${stateChanged.state.preset}`,
    );
    check('neon edge colour is back after the toolbar pick', backToNeon.includes(NEON_EDGE) && !backToNeon.includes(LIGHT_EDGE));

    /* --------------------------------------------------------- live update */

    section('live update');
    marker = await page.marker();
    await page.send({ type: 'update', source: UPDATED_SOURCE });
    const updateRender = await page.waitFor(marker, (m) => m.type === 'rendered' && m.ok, 'the updated render');
    const updatedSvg = await page.eval(() => document.querySelector('#neomermaid-root svg')?.outerHTML ?? '');
    check(
      'source update re-renders the diagram',
      updatedSvg.includes('OnlyNode') && updatedSvg.includes('Finished'),
      `${updateRender.width}×${updateRender.height}`,
    );

    /* -------------------------------------------------------- SVG export */

    section('export round-trips');
    marker = await page.marker();
    await page.send({ type: 'exportRequest', requestId: 'smoke-svg', format: 'svg' });
    const svgResult = await page.waitFor(marker, (m) => m.type === 'exportResult' && m.requestId === 'smoke-svg', 'the SVG export');
    check(
      'SVG export returns the rendered document',
      svgResult.ok && typeof svgResult.svg === 'string' && svgResult.svg.startsWith('<svg') && svgResult.svg.includes(NEON_EDGE),
      `${(svgResult.svg.length / 1024).toFixed(1)} kB`,
    );

    /* -------------------------------------------------------- PNG export */

    marker = await page.marker();
    await page.send({ type: 'exportRequest', requestId: 'smoke-png', format: 'png' });
    const pngResult = await page.waitFor(marker, (m) => m.type === 'exportResult' && m.requestId === 'smoke-png', 'the PNG export');
    const pngBytes = Buffer.from(pngResult.base64 ?? '', 'base64');
    const info = pngInfo(pngBytes);
    check(
      'PNG export round-trip starts with the PNG magic bytes',
      info.isPng,
      `signature ${info.signature || '(empty)'} · ${(pngBytes.length / 1024).toFixed(1)} kB${pngResult.ok ? '' : ` · error: ${pngResult.error}`}`,
    );
    check(
      'PNG header carries the expected raster size',
      info.chunkType === 'IHDR' &&
        info.width === (pngResult.width ?? -1) &&
        info.height === (pngResult.height ?? -1) &&
        info.width === (updateRender.width ?? -1) * 2,
      `IHDR ${info.width}×${info.height} (2× of ${updateRender.width}×${updateRender.height})`,
    );
    check(
      'the rasterised PNG is not blank',
      (pngResult.opaqueSamples ?? 0) > 0,
      `${pngResult.opaqueSamples} sampled pixels are opaque`,
    );

    /* ------------------------------------------------------- copy request */

    marker = await page.marker();
    await page.send({ type: 'copySvgRequest', requestId: 'smoke-copy' });
    const copyResult = await page.waitFor(marker, (m) => m.type === 'copySvgResult' && m.requestId === 'smoke-copy', 'the copy request');
    check('copy-SVG request answers with the SVG', copyResult.ok && copyResult.svg.length > 500);

    /* ------------------------------------------- toolbar → host intents */

    marker = await page.marker();
    await page.eval(() => {
      for (const action of ['export-png', 'export-svg', 'copy-svg', 'save-default']) {
        document.querySelector(`#neomermaid-root [data-action="${action}"]`)?.click();
      }
    });
    const intents = await page.outbox().then((box) => box.slice(marker));
    const kinds = intents.map((m) => m.type).join(',');
    check(
      'toolbar buttons ask the host to export / copy / save',
      intents.some((m) => m.type === 'exportIntent' && m.format === 'png') &&
        intents.some((m) => m.type === 'exportIntent' && m.format === 'svg') &&
        intents.some((m) => m.type === 'copyIntent') &&
        intents.some((m) => m.type === 'saveDefault' && m.preset === 'neon/dracula'),
      kinds,
    );

    /* ----------------------------------------------------------- hygiene */

    section('hygiene');
    check('no page errors or console errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'clean');

    exitCode = failures === 0 ? 0 : 1;
  } catch (error) {
    failures += 1;
    console.error(`\nFAIL  ${error instanceof Error ? error.message : String(error)}`);
    if (pageErrors.length > 0) {
      console.error('      page errors:');
      for (const entry of pageErrors.slice(0, 10)) console.error(`        ${entry}`);
    }
    exitCode = 1;
  } finally {
    await browser.close();
    await server.close();
    rmSync(fixture.dir, { recursive: true, force: true });
  }

  section('summary');
  const passed = results.filter((r) => r.pass).length;
  console.log(`      ${passed} passed · ${failures} failed (${results.length} assertions)`);
  console.log(`      webview sha256:${webviewHash} (${(webviewSize / 1024).toFixed(1)} kB)`);
  console.log(failures === 0 ? '      RESULT: PASS' : '      RESULT: FAIL');
  process.exit(exitCode);
}

await main();
