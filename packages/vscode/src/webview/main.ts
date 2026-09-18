/**
 * The preview webview.
 *
 * This is the only place a diagram is rendered: `@neomermaid/core` needs a DOM,
 * and a webview *is* a browser. The bundle inlines mermaid and the core, so the
 * panel works offline and produces the same SVG as `neomermaid render` does for
 * the same options.
 *
 * Protocol: see ../protocol.ts. The host owns preset/background/padding/scale;
 * the toolbar edits them and reports back, so the settings, the status bar and
 * what is on screen can never disagree.
 */

import mermaid from 'mermaid';
import { listPalettes, listPresets, listThemes, render } from '@neomermaid/core';
import type { RenderResult } from '@neomermaid/core';
import { WEBVIEW_ROOT_ID, isHostToWebviewMessage } from '../protocol.js';
import type {
  Appearance,
  Catalog,
  ExportFormat,
  HostToWebviewMessage,
  PaletteOption,
  PreviewState,
  WebviewToHostMessage,
} from '../protocol.js';
import { rasteriseSvg } from './png.js';

/* ------------------------------------------------------------------- wiring */

/**
 * Core looks for an injected `globalThis.mermaid` before it ever tries to import
 * one. Handing it the instance we already bundled avoids a second copy of mermaid
 * and makes the render path deterministic.
 */
const mermaidInstance = (mermaid as unknown as { default?: unknown }).default ?? (mermaid as unknown);
(globalThis as unknown as { mermaid?: unknown }).mermaid = mermaidInstance;

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

/** The real webview API under VS Code; a silent stub when driven by tests. */
const api: VsCodeApi =
  typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : { postMessage: () => undefined };

function post(message: WebviewToHostMessage): void {
  try {
    api.postMessage(message);
  } catch {
    /* the host went away; nothing useful to do */
  }
}

/* ------------------------------------------------------------------- state */

const DEFAULT_STATE: PreviewState = {
  preset: 'minimal/github-light',
  background: 'theme',
  padding: 16,
  exportScale: 2,
  zoom: 1,
  fitToWidth: true,
};

let state: PreviewState = { ...DEFAULT_STATE };
let catalog: Catalog = { themes: [], palettes: [], presets: [] };
let source = '';
let documentLabel = 'diagram';
let lastResult: RenderResult | undefined;
let chromeAppearance: Appearance = 'dark';
let renderToken = 0;
let booted = false;
const queued: unknown[] = [];

/* ------------------------------------------------------------------- utils */

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || 'mermaid could not render this diagram.';
}

/** Catalog straight out of the bundled core — the host's copy is optional. */
function localCatalog(): Catalog {
  return { themes: listThemes(), palettes: listPalettes(), presets: listPresets() };
}

function splitPreset(preset: string): { theme: string; palette: string } {
  const [theme = '', palette = ''] = preset.split('/');
  return { theme, palette };
}

function isColour(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) || /^(rgb|hsl)a?\(/i.test(value);
}

/** Appearance of the palette behind a preset — drives the diagram chrome. */
function appearanceOf(preset: string): Appearance {
  const { palette } = splitPreset(preset);
  return catalog.palettes.find((p) => p.id === palette)?.appearance ?? (palette.includes('light') ? 'light' : 'dark');
}

function normaliseState(input: Partial<PreviewState> | undefined, next: Catalog): PreviewState {
  const merged: PreviewState = { ...state };
  if (!input) return merged;
  if (typeof input.preset === 'string' && input.preset.trim()) merged.preset = input.preset;
  if (next.presets.length > 0 && !next.presets.includes(merged.preset)) {
    post({ type: 'log', level: 'warn', message: `unknown preset "${merged.preset}" — using ${DEFAULT_STATE.preset}` });
    merged.preset = DEFAULT_STATE.preset;
  }
  if (typeof input.background === 'string' && input.background.trim()) merged.background = input.background;
  if (typeof input.padding === 'number' && Number.isFinite(input.padding)) {
    merged.padding = clamp(Math.round(input.padding), 0, 96);
  }
  if (typeof input.exportScale === 'number' && Number.isFinite(input.exportScale)) {
    merged.exportScale = clamp(Math.round(input.exportScale), 1, 4);
  }
  if (typeof input.zoom === 'number' && Number.isFinite(input.zoom)) merged.zoom = clamp(input.zoom, 0.25, 4);
  if (typeof input.fitToWidth === 'boolean') merged.fitToWidth = input.fitToWidth;
  return merged;
}

/* --------------------------------------------------------------------- DOM */

const mounted = document.getElementById(WEBVIEW_ROOT_ID);
if (!mounted) {
  document.body.innerHTML = `<pre class="neom-fatal">NeoMermaid: #${WEBVIEW_ROOT_ID} is missing from the webview template.</pre>`;
  throw new Error(`NeoMermaid: #${WEBVIEW_ROOT_ID} not found in the webview template.`);
}
const root: HTMLElement = mounted;

const SHELL = `
<header class="neom-toolbar">
  <div class="neom-group">
    <label class="neom-field"><span class="neom-label">Theme</span>
      <select data-role="theme" aria-label="Theme"></select>
    </label>
    <label class="neom-field"><span class="neom-label">Palette</span>
      <select data-role="palette" aria-label="Palette"></select>
    </label>
    <label class="neom-field"><span class="neom-label">Background</span>
      <select data-role="background" aria-label="Background">
        <option value="theme">Canvas</option>
        <option value="transparent">Transparent</option>
        <option value="custom">Colour…</option>
      </select>
    </label>
    <input type="color" class="neom-color" data-role="bgColor" aria-label="Canvas colour" value="#282a36" />
    <label class="neom-field"><span class="neom-label">Padding</span>
      <input type="number" class="neom-number" data-role="padding" aria-label="Padding" min="0" max="96" step="4" value="16" />
    </label>
    <label class="neom-field"><span class="neom-label">PNG scale</span>
      <select data-role="scale" aria-label="PNG scale">
        <option value="1">1×</option>
        <option value="2">2×</option>
        <option value="3">3×</option>
        <option value="4">4×</option>
      </select>
    </label>
  </div>
  <div class="neom-group neom-actions">
    <button type="button" class="neom-btn" data-action="zoom-out" title="Zoom out">−</button>
    <button type="button" class="neom-btn" data-action="zoom-reset" data-role="zoom" title="Reset zoom">100%</button>
    <button type="button" class="neom-btn" data-action="zoom-in" title="Zoom in">+</button>
    <button type="button" class="neom-btn" data-action="fit" title="Fit the diagram to the panel width">Fit</button>
    <span class="neom-sep"></span>
    <button type="button" class="neom-btn" data-action="export-png" title="Export a PNG">PNG</button>
    <button type="button" class="neom-btn" data-action="export-svg" title="Export an SVG">SVG</button>
    <button type="button" class="neom-btn" data-action="copy-svg" title="Copy the SVG to the clipboard">Copy SVG</button>
    <button type="button" class="neom-btn" data-action="save-default" title="Store preset, background and padding in settings">Save default</button>
  </div>
</header>
<main class="neom-stage" data-role="stage">
  <div class="neom-canvas" data-role="canvas" data-transparent="false"></div>
</main>
<footer class="neom-statusbar">
  <span class="neom-file" data-role="file"></span>
  <span class="neom-status" data-role="status">Waiting for the diagram…</span>
  <span class="neom-warnings" data-role="warnings"></span>
</footer>
`;

root.innerHTML = SHELL;

function el<T extends Element>(role: string): T {
  const found = root.querySelector<T>(`[data-role="${role}"]`);
  if (!found) throw new Error(`NeoMermaid: the toolbar control "${role}" is missing.`);
  return found;
}

function action(name: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
  if (!found) throw new Error(`NeoMermaid: the toolbar button "${name}" is missing.`);
  return found;
}

const themeSelect = el<HTMLSelectElement>('theme');
const paletteSelect = el<HTMLSelectElement>('palette');
const backgroundSelect = el<HTMLSelectElement>('background');
const colourInput = el<HTMLInputElement>('bgColor');
const paddingInput = el<HTMLInputElement>('padding');
const scaleSelect = el<HTMLSelectElement>('scale');
const zoomButton = el<HTMLButtonElement>('zoom');
const canvas = el<HTMLDivElement>('canvas');
const statusEl = el<HTMLSpanElement>('status');
const warningsEl = el<HTMLSpanElement>('warnings');
const fileEl = el<HTMLSpanElement>('file');

/* --------------------------------------------------------------- toolbar UI */

function fillPickers(next: Catalog): void {
  themeSelect.innerHTML = next.themes
    .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
    .join('');

  const groups: Record<Appearance, PaletteOption[]> = { dark: [], light: [] };
  for (const palette of next.palettes) groups[palette.appearance]?.push(palette);
  paletteSelect.innerHTML = (['dark', 'light'] as const)
    .filter((kind) => groups[kind].length > 0)
    .map(
      (kind) =>
        `<optgroup label="${kind === 'dark' ? 'Dark' : 'Light'}">` +
        groups[kind]
          .map((p) => `<option value="${escapeHtml(p.id)}" title="${escapeHtml(p.accent)}">${escapeHtml(p.name)}</option>`)
          .join('') +
        '</optgroup>',
    )
    .join('');
}

function syncControls(): void {
  const { theme, palette } = splitPreset(state.preset);
  themeSelect.value = theme;
  paletteSelect.value = palette;
  paddingInput.value = String(state.padding);
  scaleSelect.value = String(state.exportScale);

  if (state.background === 'theme' || state.background === 'transparent') {
    backgroundSelect.value = state.background;
    colourInput.classList.add('neom-hidden');
  } else {
    backgroundSelect.value = 'custom';
    colourInput.classList.remove('neom-hidden');
    if (isColour(state.background)) colourInput.value = state.background;
  }

  root.dataset.chrome = chromeAppearance;
  root.dataset.fit = String(state.fitToWidth);
}

function setStatus(text: string, tone: 'idle' | 'ok' | 'error' = 'idle'): void {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function setWarnings(warnings: readonly string[]): void {
  warningsEl.textContent = warnings.length > 0 ? `⚠ ${warnings.join(' ')}` : '';
  warningsEl.title = warnings.join('\n');
}

function zoomFactor(): number {
  if (!lastResult) return 1;
  if (!state.fitToWidth) return state.zoom;
  const available = canvas.clientWidth - 2;
  if (available <= 0 || lastResult.width <= 0) return state.zoom;
  return clamp(available / lastResult.width, 0.25, 2);
}

function applyZoom(): void {
  const svg = canvas.querySelector('svg');
  if (!svg || !lastResult) return;
  const factor = zoomFactor();
  svg.setAttribute('width', String(Math.round(lastResult.width * factor)));
  svg.setAttribute('height', String(Math.round(lastResult.height * factor)));
  zoomButton.textContent = `${Math.round(factor * 100)}%`;
}

/* ------------------------------------------------------------------ render */

function resolveBackground(): string {
  if (backgroundSelect.value === 'transparent') return 'transparent';
  if (backgroundSelect.value === 'custom') return colourInput.value || 'theme';
  return 'theme';
}

async function doRender(): Promise<void> {
  const token = ++renderToken;
  const started = performance.now();

  if (!source.trim()) {
    lastResult = undefined;
    canvas.innerHTML = '<div class="neom-empty">This diagram is empty — start typing mermaid in the editor.</div>';
    canvas.dataset.transparent = 'false';
    setWarnings([]);
    setStatus(`${documentLabel} · empty`, 'idle');
    post({ type: 'rendered', ok: false, error: 'The diagram is empty.', durationMs: performance.now() - started });
    return;
  }

  try {
    const result = await render(source, {
      preset: state.preset,
      background: resolveBackground(),
      padding: state.padding,
      id: 'neomermaid-preview',
    });
    if (token !== renderToken) return; // a newer render already landed

    lastResult = result;
    canvas.innerHTML = result.svg;
    canvas.dataset.transparent = result.background === 'transparent' ? 'true' : 'false';
    applyZoom();
    setWarnings(result.warnings);
    setStatus(
      `${documentLabel} · ${result.preset} · ${result.width}×${result.height} · ${Math.round(performance.now() - started)} ms`,
      'ok',
    );
    post({
      type: 'rendered',
      ok: true,
      durationMs: performance.now() - started,
      width: result.width,
      height: result.height,
      theme: result.theme,
      palette: result.palette,
      preset: result.preset,
      appearance: result.appearance,
      warnings: result.warnings,
    });
  } catch (error) {
    if (token !== renderToken) return;
    const message = errorText(error);
    lastResult = undefined;
    canvas.innerHTML = `<div class="neom-error"><strong>mermaid error</strong><pre>${escapeHtml(message)}</pre></div>`;
    setWarnings([]);
    setStatus(`${documentLabel} · render failed`, 'error');
    post({ type: 'rendered', ok: false, error: message, durationMs: performance.now() - started });
  }
}

function reportState(reason: 'user' | 'init'): void {
  post({ type: 'stateChanged', state: { ...state }, reason });
}

/** A toolbar edit: update state and re-render when a render input changed. */
function userEdit(partial: Partial<PreviewState>): void {
  const before = `${state.preset}|${state.background}|${state.padding}`;
  state = { ...state, ...partial };
  syncControls();
  reportState('user');
  if (`${state.preset}|${state.background}|${state.padding}` === before) applyZoom();
  else void doRender();
}

/* ---------------------------------------------------------------- controls */

themeSelect.addEventListener('change', () => {
  userEdit({ preset: `${themeSelect.value}/${paletteSelect.value}` });
});
paletteSelect.addEventListener('change', () => {
  userEdit({ preset: `${themeSelect.value}/${paletteSelect.value}` });
});
backgroundSelect.addEventListener('change', () => {
  if (backgroundSelect.value === 'custom') userEdit({ background: colourInput.value });
  else userEdit({ background: backgroundSelect.value });
});
colourInput.addEventListener('change', () => userEdit({ background: colourInput.value }));
paddingInput.addEventListener('change', () => {
  userEdit({ padding: clamp(Math.round(Number(paddingInput.value) || 0), 0, 96) });
});
scaleSelect.addEventListener('change', () => {
  state = { ...state, exportScale: clamp(Math.round(Number(scaleSelect.value) || 1), 1, 4) };
  syncControls();
  reportState('user');
});

action('zoom-out').addEventListener('click', () => userEdit({ zoom: clamp(state.zoom / 1.25, 0.25, 4), fitToWidth: false }));
action('zoom-in').addEventListener('click', () => userEdit({ zoom: clamp(state.zoom * 1.25, 0.25, 4), fitToWidth: false }));
action('zoom-reset').addEventListener('click', () => userEdit({ zoom: 1, fitToWidth: false }));
action('fit').addEventListener('click', () => userEdit({ fitToWidth: true }));

/** The webview cannot save files or use the clipboard — ask the host instead. */
action('export-png').addEventListener('click', () => {
  post({ type: 'exportIntent', format: 'png' });
});
action('export-svg').addEventListener('click', () => {
  post({ type: 'exportIntent', format: 'svg' });
});
action('copy-svg').addEventListener('click', () => {
  post({ type: 'copyIntent' });
});
action('save-default').addEventListener('click', () => {
  post({ type: 'saveDefault', preset: state.preset, background: state.background, padding: state.padding });
});

window.addEventListener('resize', () => {
  if (state.fitToWidth) applyZoom();
});

/* --------------------------------------------------------------- host glue */

async function handleExport(requestId: string, format: ExportFormat): Promise<void> {
  if (!lastResult) {
    post({
      type: 'exportResult',
      requestId,
      format,
      ok: false,
      error: 'Nothing to export yet — the preview has not rendered a diagram.',
    });
    return;
  }

  try {
    if (format === 'svg') {
      post({
        type: 'exportResult',
        requestId,
        format,
        ok: true,
        svg: lastResult.svg,
        width: lastResult.width,
        height: lastResult.height,
      });
      return;
    }
    const raster = await rasteriseSvg(lastResult.svg, lastResult.width, lastResult.height, state.exportScale);
    post({
      type: 'exportResult',
      requestId,
      format,
      ok: true,
      base64: raster.base64,
      width: raster.width,
      height: raster.height,
      opaqueSamples: raster.opaqueSamples,
    });
  } catch (error) {
    post({ type: 'exportResult', requestId, format, ok: false, error: errorText(error) });
  }
}

async function handleHostMessage(message: HostToWebviewMessage): Promise<void> {
  switch (message.type) {
    case 'init': {
      documentLabel = message.documentLabel || documentLabel;
      fileEl.textContent = documentLabel;
      chromeAppearance = message.appearance;
      // The catalog is optional: the core in this bundle is the source of truth.
      catalog = message.catalog && message.catalog.presets.length > 0 ? message.catalog : localCatalog();
      state = normaliseState(message.state, catalog);
      fillPickers(catalog);
      source = message.source;
      syncControls();
      await doRender();
      reportState('init');
      break;
    }
    case 'update': {
      if (message.source === source) break;
      source = message.source;
      await doRender();
      break;
    }
    case 'setState': {
      chromeAppearance = message.appearance ?? appearanceOf(message.state.preset ?? state.preset);
      state = normaliseState(message.state, catalog);
      syncControls();
      await doRender();
      break;
    }
    case 'exportRequest': {
      await handleExport(message.requestId, message.format);
      break;
    }
    case 'copySvgRequest': {
      if (!lastResult) {
        post({ type: 'copySvgResult', requestId: message.requestId, ok: false, error: 'Nothing rendered yet.' });
        break;
      }
      post({ type: 'copySvgResult', requestId: message.requestId, ok: true, svg: lastResult.svg });
      break;
    }
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  const data: unknown = event.data;
  if (!isHostToWebviewMessage(data)) return;
  if (!booted) {
    queued.push(data);
    return;
  }
  void handleHostMessage(data);
});

/* -------------------------------------------------------------------- boot */

function boot(): void {
  catalog = localCatalog();
  fillPickers(catalog);
  syncControls();
  setStatus('Waiting for the diagram…');
  booted = true;
  post({ type: 'ready' });
  for (const message of queued.splice(0)) {
    if (isHostToWebviewMessage(message)) void handleHostMessage(message);
  }
}

boot();
