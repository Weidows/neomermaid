/**
 * NeoMermaid live playground.
 *
 * Thin shell around `@neomermaid/core`: pick an example, pick a
 * `theme/palette` preset, tweak a couple of tokens, export. Everything the page
 * shows comes out of one `render()` call — there is no second styling path.
 *
 * Deep links: `#preset=neon/dracula&example=auth-sequence&background=transparent&padding=32&animated=1&sketch=1`
 */
/// <reference types="vite/client" />
import { EXAMPLES, PALETTES, THEMES, getExample, render } from '@neomermaid/core';
import type { RenderResult } from '@neomermaid/core';
import './styles.css';

/* --------------------------------------------------------------- dom helpers */

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`demo: missing #${id}`);
  return el as T;
}

const els = {
  example: byId<HTMLSelectElement>('example'),
  preset: byId<HTMLSelectElement>('preset'),
  background: byId<HTMLSelectElement>('background'),
  padding: byId<HTMLInputElement>('padding'),
  paddingValue: byId<HTMLOutputElement>('padding-value'),
  animated: byId<HTMLInputElement>('animated'),
  sketch: byId<HTMLInputElement>('sketch'),
  source: byId<HTMLTextAreaElement>('source'),
  renderBtn: byId<HTMLButtonElement>('render'),
  resetSource: byId<HTMLButtonElement>('reset-source'),
  share: byId<HTMLButtonElement>('share'),
  exportSvg: byId<HTMLButtonElement>('export-svg'),
  exportPng: byId<HTMLButtonElement>('export-png'),
  copySvg: byId<HTMLButtonElement>('copy-svg'),
  exampleDesc: byId<HTMLParagraphElement>('example-desc'),
  stageHost: byId<HTMLDivElement>('stage-host'),
  meta: byId<HTMLDListElement>('meta'),
  status: byId<HTMLParagraphElement>('status'),
  error: byId<HTMLDivElement>('error'),
  warnings: byId<HTMLUListElement>('warnings'),
  warningsWrap: byId<HTMLDetailsElement>('warnings-wrap'),
};

/* --------------------------------------------------------------------- state */

const DEFAULT_PRESET = 'neon/dracula';

interface DemoState {
  exampleId: string;
  preset: string;
  background: string;
  padding: number;
  animatedEdges: boolean;
  sketch: boolean;
  /** Diagram source currently in the textarea. */
  source: string;
  /** True once the textarea diverges from the selected example. */
  dirtySource: boolean;
}

const state: DemoState = {
  exampleId: EXAMPLES[0]?.id ?? 'release-flow',
  preset: DEFAULT_PRESET,
  background: 'theme',
  padding: 24,
  animatedEdges: false,
  sketch: false,
  source: EXAMPLES[0]?.source ?? '',
  dirtySource: false,
};

let lastResult: RenderResult | null = null;
let renderSeq = 0;
let renderTimer: number | undefined;

/* ------------------------------------------------------------------ hash url */

function readHash(): Partial<DemoState> {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const out: Partial<DemoState> = {};

  const preset = params.get('preset');
  if (preset && THEMES[preset.split('/')[0] ?? ''] && PALETTES[preset.split('/')[1] ?? '']) {
    out.preset = preset;
  }
  const example = params.get('example');
  if (example && getExample(example)) out.exampleId = example;

  const background = params.get('background') ?? params.get('bg');
  if (background === 'theme' || background === 'transparent') out.background = background;

  const paddingRaw = params.get('padding');
  if (paddingRaw !== null) {
    const padding = Number(paddingRaw);
    if (Number.isFinite(padding) && padding >= 0 && padding <= 72) out.padding = padding;
  }

  const animated = params.get('animated');
  if (animated !== null) out.animatedEdges = animated === '1' || animated === 'true';
  const sketch = params.get('sketch');
  if (sketch !== null) out.sketch = sketch === '1' || sketch === 'true';

  return out;
}

function currentHash(): string {
  const params = new URLSearchParams();
  params.set('preset', state.preset);
  params.set('example', state.exampleId);
  if (state.background !== 'theme') params.set('background', state.background);
  if (state.padding !== 24) params.set('padding', String(state.padding));
  if (state.animatedEdges) params.set('animated', '1');
  if (state.sketch) params.set('sketch', '1');
  // `preset=neon/dracula` reads better than `preset=neon%2Fdracula`; both parse.
  return `#${params.toString().replace(/%2F/g, '/')}`;
}

function syncHash(): void {
  const next = currentHash();
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next);
  }
}

/* ---------------------------------------------------------------- build ui */

function buildExampleOptions(): void {
  els.example.replaceChildren(
    ...EXAMPLES.map((ex) => {
      const option = document.createElement('option');
      option.value = ex.id;
      option.textContent = ex.title;
      option.title = ex.description;
      return option;
    }),
  );
}

function buildPresetOptions(): void {
  const groups: HTMLElement[] = [];
  for (const theme of Object.values(THEMES)) {
    const group = document.createElement('optgroup');
    group.label = theme.name;
    for (const palette of Object.values(PALETTES)) {
      const option = document.createElement('option');
      option.value = `${theme.id}/${palette.id}`;
      option.textContent = `${palette.name} · ${palette.appearance}`;
      option.title = `${theme.name} / ${palette.name} — ${theme.description}`;
      group.append(option);
    }
    groups.push(group);
  }
  els.preset.replaceChildren(...groups);
}

function paintMeta(result: RenderResult | null, ms: number): void {
  const rows: Array<[string, string]> = [
    ['preset', state.preset],
    ['theme', result?.theme ?? '—'],
    ['palette', result?.palette ?? '—'],
    ['appearance', result?.appearance ?? '—'],
    ['size', result ? `${Math.round(result.width)}×${Math.round(result.height)}` : '—'],
    ['background', result?.background ?? '—'],
    ['render', `${ms.toFixed(0)} ms`],
  ];
  els.meta.replaceChildren(
    ...rows.map(([label, value]) => {
      const wrap = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      wrap.append(dt, dd);
      return wrap;
    }),
  );
}

function setStatus(text: string): void {
  els.status.textContent = text;
}

function setError(message: string | null): void {
  els.error.hidden = message === null;
  els.error.textContent = message ?? '';
}

function setWarnings(list: string[]): void {
  els.warningsWrap.hidden = list.length === 0;
  els.warnings.replaceChildren(
    ...list.map((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      return li;
    }),
  );
}

/* ------------------------------------------------------------------ render */

function optionsFromState(): Parameters<typeof render>[1] {
  return {
    preset: state.preset,
    background: state.background,
    padding: state.padding,
    styling: {
      effects: {
        animatedEdges: state.animatedEdges,
        sketch: state.sketch,
      },
    },
  };
}

async function renderNow(): Promise<void> {
  const seq = ++renderSeq;
  const source = state.source.trim();
  els.stageHost.dataset.renderState = 'rendering';
  setError(null);
  if (!source) {
    els.stageHost.dataset.renderState = 'error';
    setError('源码为空');
    setStatus('等待输入');
    return;
  }

  const started = performance.now();
  try {
    const result = await render(source, optionsFromState());
    if (seq !== renderSeq) return; // a newer render superseded this one
    lastResult = result;
    els.stageHost.innerHTML = result.svg;
    els.stageHost.dataset.renderState = 'ready';
    els.stageHost.dataset.renderId = String(seq);
    els.stageHost.dataset.preset = result.preset;
    const ms = performance.now() - started;
    paintMeta(result, ms);
    setWarnings(result.warnings);
    setStatus(
      `已渲染 · ${result.preset} · ${Math.round(result.width)}×${Math.round(result.height)} · ${ms.toFixed(0)} ms` +
        (result.warnings.length ? ` · ${result.warnings.length} 条警告` : ''),
    );
  } catch (error) {
    if (seq !== renderSeq) return;
    lastResult = null;
    els.stageHost.dataset.renderState = 'error';
    els.stageHost.dataset.renderId = String(seq);
    els.stageHost.replaceChildren();
    const message = error instanceof Error ? error.message : String(error);
    setError(`渲染失败：${message}`);
    setStatus('渲染失败');
    paintMeta(null, performance.now() - started);
    setWarnings([]);
  }
}

function scheduleRender(delay = 260): void {
  if (renderTimer !== undefined) window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    renderTimer = undefined;
    void renderNow();
  }, delay);
}

/* ----------------------------------------------------------- state ↔ inputs */

function applyStateToInputs(): void {
  els.example.value = state.exampleId;
  els.preset.value = state.preset;
  els.background.value = state.background;
  els.padding.value = String(state.padding);
  els.paddingValue.textContent = String(state.padding);
  els.animated.checked = state.animatedEdges;
  els.sketch.checked = state.sketch;
  els.source.value = state.source;
  const example = getExample(state.exampleId);
  els.exampleDesc.textContent = example
    ? `${example.description}${example.highlights?.length ? ` — ${example.highlights.join(' / ')}` : ''}`
    : '';
}

function loadExample(id: string): void {
  const example = getExample(id);
  if (!example) return;
  state.exampleId = example.id;
  state.source = example.source;
  state.dirtySource = false;
  applyStateToInputs();
}

/* ------------------------------------------------------------------ exports */

function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function exportName(extension: string): string {
  const preset = state.preset.replace('/', '-');
  return `neomermaid-${preset}-${state.exampleId}.${extension}`;
}

/** Standalone SVG → PNG blob. Rasterised at 2× so the export stays crisp. */
async function svgToPngBlob(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const markup = /xmlns=/.test(svg) ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  if (lastResult && lastResult.background !== 'transparent') {
    ctx.fillStyle = lastResult.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const image = new Image();
  image.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('SVG 无法解码为位图'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas.toBlob 返回空');
  return blob;
}

async function exportPng(): Promise<void> {
  if (!lastResult) {
    setError('还没有可导出的渲染结果');
    return;
  }
  els.exportPng.disabled = true;
  setStatus('正在导出 PNG…');
  try {
    const blob = await svgToPngBlob(lastResult.svg, lastResult.width, lastResult.height);
    triggerDownload(blob, exportName('png'));
    setStatus(`已导出 PNG · ${blob.size} bytes`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setError(`PNG 导出失败：${message}`);
    setStatus('PNG 导出失败');
  } finally {
    els.exportPng.disabled = false;
  }
}

async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`已复制${what}`);
  } catch {
    setStatus(`复制${what}失败（浏览器拒绝访问剪贴板）`);
  }
}

/* --------------------------------------------------------------------- wiring */

function wire(): void {
  els.example.addEventListener('change', () => {
    loadExample(els.example.value);
    syncHash();
    void renderNow();
  });

  els.preset.addEventListener('change', () => {
    state.preset = els.preset.value;
    syncHash();
    void renderNow();
  });

  els.background.addEventListener('change', () => {
    state.background = els.background.value;
    syncHash();
    void renderNow();
  });

  els.padding.addEventListener('input', () => {
    state.padding = Number(els.padding.value);
    els.paddingValue.textContent = String(state.padding);
    syncHash();
    scheduleRender();
  });

  els.animated.addEventListener('change', () => {
    state.animatedEdges = els.animated.checked;
    syncHash();
    void renderNow();
  });

  els.sketch.addEventListener('change', () => {
    state.sketch = els.sketch.checked;
    syncHash();
    void renderNow();
  });

  els.source.addEventListener('input', () => {
    state.source = els.source.value;
    state.dirtySource = true;
    scheduleRender(420);
  });

  els.source.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const el = els.source;
      const { selectionStart, selectionEnd, value } = el;
      el.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      el.selectionStart = el.selectionEnd = selectionStart + 2;
      state.source = el.value;
      scheduleRender(420);
    }
  });

  els.renderBtn.addEventListener('click', () => void renderNow());

  els.resetSource.addEventListener('click', () => {
    loadExample(state.exampleId);
    void renderNow();
  });

  els.exportSvg.addEventListener('click', () => {
    if (!lastResult) {
      setError('还没有可导出的渲染结果');
      return;
    }
    triggerDownload(svgBlob(lastResult.svg), exportName('svg'));
    setStatus(`已导出 SVG · ${lastResult.svg.length} chars`);
  });

  els.exportPng.addEventListener('click', () => {
    void exportPng();
  });

  els.copySvg.addEventListener('click', () => {
    if (!lastResult) {
      setError('还没有可复制的渲染结果');
      return;
    }
    void copyText(lastResult.svg, ' SVG 源码');
  });

  els.share.addEventListener('click', () => {
    syncHash();
    void copyText(window.location.href, '分享链接');
  });

  window.addEventListener('hashchange', () => {
    const patch = readHash();
    Object.assign(state, patch);
    if (patch.exampleId) loadExample(patch.exampleId);
    else applyStateToInputs();
    void renderNow();
  });
}

/* --------------------------------------------------------------------- boot */

function boot(): void {
  buildExampleOptions();
  buildPresetOptions();
  Object.assign(state, readHash());
  if (state.exampleId) loadExample(state.exampleId);
  applyStateToInputs();
  wire();
  setStatus('正在渲染…');
  void renderNow();
}

boot();
