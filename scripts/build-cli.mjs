/**
 * CLI build. Bundles the workspace core in (data + helpers only) and keeps
 * puppeteer-core external — the heavy lifting happens in the headless page, so
 * the CLI itself stays small and starts fast.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..', 'packages', 'cli');
mkdirSync(resolve(pkgRoot, 'dist'), { recursive: true });

const result = await esbuild.build({
  absWorkingDir: pkgRoot,
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: ['node20'],
  format: 'esm',
  outfile: 'dist/index.js',
  external: ['puppeteer-core', 'mermaid'],
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
});

const size = result.metafile.outputs['dist/index.js'].bytes;
console.log(`  dist/index.js  ${(size / 1024).toFixed(1)} kB`);

const tsc = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(tsc, ['tsc', '-p', resolve(pkgRoot, 'tsconfig.json'), '--emitDeclarationOnly', '--declaration'], {
  stdio: 'inherit',
  cwd: pkgRoot,
  shell: process.platform === 'win32',
});

console.log('cli: build complete');
