/**
 * Core build:
 *  - dist/index.js   ESM, mermaid left external (for bundlers / Node)
 *  - dist/browser.js IIFE global `NeoMermaid`, mermaid inlined — this is what the
 *    CLI injects into a headless page
 *  - dist/*.d.ts     types via tsc
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..', 'packages', 'core');

const shared = {
  absWorkingDir: pkgRoot,
  entryPoints: ['src/index.ts'],
  bundle: true,
  target: ['es2022'],
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
};

mkdirSync(resolve(pkgRoot, 'dist'), { recursive: true });

await esbuild.build({
  ...shared,
  format: 'esm',
  platform: 'neutral',
  external: ['mermaid'],
  outfile: 'dist/index.js',
});

const browserResult = await esbuild.build({
  ...shared,
  format: 'iife',
  globalName: 'NeoMermaid',
  platform: 'browser',
  outfile: 'dist/browser.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  // Mermaid ships web fonts inside its bundle for some diagram types.
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  metafile: true,
});

const sizeKb = Math.round(browserResult.metafile.outputs['dist/browser.js'].bytes / 1024);
console.log(`  dist/browser.js  ${sizeKb} kB (mermaid inlined)`);

const tsc = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(tsc, ['tsc', '-p', resolve(pkgRoot, 'tsconfig.json'), '--emitDeclarationOnly', '--declaration'], {
  stdio: 'inherit',
  cwd: pkgRoot,
  shell: process.platform === 'win32',
});

// The browser entry has the same surface as the main entry.
writeFileSync(resolve(pkgRoot, 'dist/browser.d.ts'), `export * from './index.js';\nexport as namespace NeoMermaid;\n`);

console.log('core: build complete');
