import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { resolveBrowserPath, type BrowserCandidate } from './browser.js';

/**
 * The CLI never renders in Node. mermaid measures every label through real font
 * metrics, so the diagram is produced inside a headless Chromium page and the
 * finished SVG is handed back — that is why output matches what the VS Code
 * preview and the demo page show, pixel for pixel.
 */

export interface RenderOutcome {
  svg: string;
  width: number;
  height: number;
  theme: string;
  palette: string;
  preset: string;
  appearance: 'light' | 'dark';
  /** Flowchart direction actually used; `auto` may re-aim an unstated one. */
  direction?: string;
  /** Resolved canvas colour, `transparent` when the diagram has no background. */
  background: string;
  warnings: string[];
}

export interface RasterOptions {
  width: number;
  height: number;
  /** Device pixel ratio for raster output. */
  scale: number;
  /** `transparent` keeps the alpha channel. */
  background: string;
  title?: string;
}

const require = createRequire(import.meta.url);

/** Absolute path to the browser build of the core, shipped inside @neomermaid/core. */
export function coreBundlePath(): string {
  try {
    return require.resolve('@neomermaid/core/browser');
  } catch {
    // Fall back to the repo layout so `npm run build && node bin/...` works.
    const fallback = new URL('../../core/dist/browser.js', import.meta.url);
    return fallback.pathname.replace(/^\/([A-Za-z]:)/, '$1');
  }
}

export function coreBundleSize(): number {
  const path = coreBundlePath();
  if (!existsSync(path)) return 0;
  return statSync(path).size;
}

export interface PilotEvents {
  onBrowser?: (candidate: BrowserCandidate) => void;
}

export class Pilot {
  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly bundle: string,
    private readonly scale: number,
    private readonly version: string,
  ) {}

  static async launch(options: {
    browserPath?: string;
    scale?: number;
    timeout?: number;
    onBrowser?: (candidate: BrowserCandidate) => void;
  } = {}): Promise<Pilot> {
    const candidate = resolveBrowserPath(options.browserPath);
    options.onBrowser?.(candidate);

    const bundlePath = coreBundlePath();
    if (!existsSync(bundlePath)) {
      throw new Error(
        `The NeoMermaid browser bundle is missing (${bundlePath}).\nRun "npm run build:core" first, or install the published package.`,
      );
    }
    const { readFileSync } = await import('node:fs');
    const bundle = readFileSync(bundlePath, 'utf8');

    const scale = options.scale ?? 2;
    const browser = await puppeteer.launch({
      executablePath: candidate.path,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
        '--force-color-profile=srgb',
      ],
      timeout: options.timeout ?? 60_000,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: scale });
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>', {
      waitUntil: 'load',
    });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(async () => {
      await document.fonts?.ready;
    });

    return new Pilot(browser, page, bundle, scale, await browser.version());
  }

  get browserName(): string {
    return this.version;
  }

  /** Render mermaid source with NeoMermaid options; runs in the page context. */
  async render(source: string, options: Record<string, unknown>): Promise<RenderOutcome> {
    const result = await this.page.evaluate(
      async (input: string, opts: Record<string, unknown>) => {
        const scope = globalThis as unknown as { NeoMermaid?: { render: (s: string, o: unknown) => Promise<RenderOutcome> } };
        if (!scope.NeoMermaid?.render) throw new Error('NeoMermaid bundle did not load in the page.');
        return scope.NeoMermaid.render(input, opts);
      },
      source,
      options,
    );
    return result;
  }

  /** Turn a rendered SVG into PNG bytes at the requested scale. */
  async toPng(svg: string, options: RasterOptions): Promise<Buffer> {
    await this.mount(svg, options);
    const element = await this.page.$('#neom-canvas');
    if (!element) throw new Error('Canvas wrapper missing while rasterizing.');
    const shot = await element.screenshot({
      type: 'png',
      omitBackground: options.background === 'transparent',
    });
    return Buffer.from(shot);
  }

  /** Print-style export (vector, selectable text). */
  async toPdf(svg: string, options: RasterOptions): Promise<Buffer> {
    await this.mount(svg, options);
    const pdf = await this.page.pdf({
      printBackground: true,
      width: `${options.width}px`,
      height: `${options.height}px`,
      pageRanges: '1',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  }

  private async mount(svg: string, options: RasterOptions): Promise<void> {
    const maxSide = 16_000;
    const width = Math.min(Math.max(1, Math.ceil(options.width)), maxSide);
    const height = Math.min(Math.max(1, Math.ceil(options.height)), maxSide);
    await this.page.setViewport({ width, height, deviceScaleFactor: options.scale });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${(options.title ?? 'neomermaid').replace(/[<>]/g, '')}</title>
<style>
  html, body { margin: 0; padding: 0; background: ${options.background === 'transparent' ? 'transparent' : options.background}; }
  #neom-canvas { display: block; width: ${width}px; height: ${height}px; }
  svg { display: block; }
</style></head><body><div id="neom-canvas">${svg}</div></body></html>`;
    await this.page.setContent(html, { waitUntil: 'load' });
    await this.page.evaluate(async () => {
      await document.fonts?.ready;
    });
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

/** Run `fn` with a launched pilot, always closing the browser afterwards. */
export async function withPilot<T>(
  options: { browserPath?: string; scale?: number } & PilotEvents,
  fn: (pilot: Pilot) => Promise<T>,
): Promise<T> {
  const pilot = await Pilot.launch(options);
  try {
    return await fn(pilot);
  } finally {
    await pilot.close();
  }
}
