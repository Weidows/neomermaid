/**
 * VS Code extension build — two esbuild bundles, nothing else.
 *
 *   dist/extension.cjs  CommonJS for the extension host. `vscode` is external
 *                       (the host provides it) and `mermaid` never loads here:
 *                       rendering only ever happens in the webview.
 *   dist/webview.js     IIFE for the webview, with `mermaid` and
 *                       `@neomermaid/core` inlined so the panel needs no network.
 *
 * The script fails loudly if the two sides of the webview contract drift — the
 * template placeholders the extension substitutes and the root element the
 * webview mounts into.
 */
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..', 'packages', 'vscode');
const distDir = resolve(pkgRoot, 'dist');
mkdirSync(distDir, { recursive: true });

const shared = {
  absWorkingDir: pkgRoot,
  bundle: true,
  target: ['es2022'],
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
};

const extension = await esbuild.build({
  ...shared,
  entryPoints: ['src/extension.ts'],
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/extension.cjs',
  target: ['node18'],
  external: ['vscode', 'mermaid'],
  minify: false,
});

const webview = await esbuild.build({
  ...shared,
  entryPoints: ['src/webview/main.ts'],
  platform: 'browser',
  format: 'iife',
  outfile: 'dist/webview.js',
  minify: true,
  // Mermaid carries a few web fonts inside its bundle for specific diagram types.
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
});

/* ------------------------------------------------------------------ reporting */

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

function report(label, file, extra = '') {
  const path = resolve(distDir, file);
  const bytes = statSync(path).size;
  const gzip = gzipSync(readFileSync(path)).length;
  console.log(`  ${label.padEnd(22)} ${kb(bytes).padStart(11)}   gzip ${kb(gzip).padStart(10)}   ${extra}`);
  return { path, bytes, gzip };
}

console.log('vscode: bundles');
const extOut = report('dist/extension.cjs', 'extension.cjs', 'cjs · vscode external');
const webOut = report('dist/webview.js', 'webview.js', 'iife · mermaid + @neomermaid/core inlined');
console.log(`  total${' '.repeat(18)}${kb(extOut.bytes + webOut.bytes).padStart(11)}`);

/* -------------------------------------------------------------------- checks */

const problems = [];
const extensionSource = readFileSync(extOut.path, 'utf8');
const webviewSource = readFileSync(webOut.path, 'utf8');
const template = readFileSync(resolve(pkgRoot, 'media', 'webview.html'), 'utf8');
const tokens = ['{{csp}}', '{{nonce}}', '{{styleUri}}', '{{scriptUri}}'];

// 1. The extension entry really is CommonJS (VS Code will `require` it).
const head = extensionSource.slice(0, 400);
if (/^\s*(import|export)\s/m.test(head)) {
  problems.push('dist/extension.cjs looks like ESM — the extension host requires CommonJS.');
}
if (!/require\(["']vscode["']\)/.test(extensionSource)) {
  problems.push('dist/extension.cjs does not require("vscode") — the host import was not kept external.');
}

// 2. The webview bundle must be self-contained and mount into the template root.
if (!webviewSource.includes('neomermaid-root')) {
  problems.push('dist/webview.js does not reference #neomermaid-root — the mount point moved?');
}
if (!webviewSource.includes('#ff79c6')) {
  // dracula's pink, the neon theme's edge colour: a cheap canary for "core inlined".
  problems.push('dist/webview.js does not contain the core palettes — @neomermaid/core was not inlined.');
}

// 3. Template placeholders and the code that substitutes them must agree.
for (const token of tokens) {
  if (!template.includes(token)) problems.push(`media/webview.html is missing the ${token} placeholder.`);
  if (!extensionSource.includes(token)) problems.push(`dist/extension.cjs never substitutes ${token}.`);
}

if (problems.length > 0) {
  console.error('\nvscode: build failed');
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  process.exit(1);
}

console.log('vscode: build complete — run "node packages/vscode/scripts/webview-smoke.mjs" to verify the webview.');
