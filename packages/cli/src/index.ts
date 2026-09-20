import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { PALETTES, THEMES, EXAMPLES, listPalettes, listPresets, listThemes, getExample } from '@neomermaid/core';
import { parseArgs, reader } from './args.js';
import { coreBundlePath, coreBundleSize, withPilot, type Pilot, type RenderOutcome } from './renderer.js';
import { findBrowsers } from './browser.js';

const VERSION = '0.1.0';

type OutputFormat = 'svg' | 'png' | 'pdf' | 'html';

interface RenderPlan {
  options: Record<string, unknown>;
  format: OutputFormat;
  out?: string;
  scale: number;
  background: string;
  padding: number;
  json: boolean;
  embedContent: boolean;
  quiet: boolean;
}

const HELP = `neomermaid ${VERSION} — themable mermaid renderer

USAGE
  neomermaid render <input.mmd|-> [options]
  neomermaid gallery [dir] [options]
  neomermaid themes|palettes|presets|examples [--json]
  neomermaid doctor
  neomermaid help

RENDER
  -o, --out <file>        Output path (default: stdout for svg)
  -f, --format <fmt>      svg | png | pdf | html   (default: from --out, else svg)
  -t, --theme <name>      ${listThemes().map((t) => t.id).join(', ')}
  -p, --palette <name>    ${listPalettes().map((p) => p.id).join(', ')}
      --preset <t/p>      Shorthand for theme + palette, e.g. neon/dracula
      --background <c>    CSS colour or "transparent" or "theme"
      --canvas <style>    solid | gradient | grid | dots | transparent
      --padding <px>      Canvas padding (default 16)
  -s, --scale <n>         Raster scale factor for png/pdf (default 2)

STYLE OVERRIDES
      --stroke-width <n>  Node border width        --edge-width <n>
      --radius <n>        Node corner radius       --cluster-radius <n>
      --edge-dash <d>     e.g. "6 4"               --arrow-scale <n>
      --shadow-blur <n>   Node shadow blur         --shadow-y <n>
      --glow <n>          Connector glow blur
      --font-family <f>   --font-size <n>          --font-weight <n>
      --letter-spacing <n>                         --uppercase
      --fill <mode>       flat | gradient | soft
      --animate           Marching-ants edges      --sketch
      --stroke-color <c>  --node-color <c>         --text-color <c>
      --edge-color <c>    --bg-color <c>           --accent <c>

LAYOUT  (arrangement, not syntax)
      --direction <d>     auto (default) | TB | TD | BT | LR | RL
      --node-spacing <px> --rank-spacing <px>
      --wrap <px>         Label line-break width (0 disables)
      --curve <name>      basis | linear | step | cardinal …
      --max-aspect <n>    Re-aim unstated directions wider than this (default 3.2)
      --contrast <level>  aa (default) | aaa | off   — legibility guarantee

MERMAID PASSTHROUGH
      --security <level>  strict | loose
      --mermaid-json <j>  Raw mermaid config merged last

AGENT / AUTOMATION
  -j, --json              Machine readable result on stdout
      --embed             Include the rendered svg in the json payload
      --quiet             Suppress progress chatter on stderr

EXAMPLES
  neomermaid render flow.mmd -o flow.png --preset neon/dracula
  cat flow.mmd | neomermaid render - --theme tech --palette tokyo-night --json
  neomermaid gallery examples -o .gallery --presets minimal/github-light,neon/dracula
`;

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buildRenderOptions(r: ReturnType<typeof reader>): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  const geometry: Record<string, unknown> = {};
  const typography: Record<string, unknown> = {};
  const effects: Record<string, unknown> = {};
  const colors: Record<string, unknown> = {};
  const mermaid: Record<string, unknown> = {};

  if (r.has('preset')) options.preset = r.get('preset');
  if (r.has('theme')) options.theme = r.get('theme');
  if (r.has('palette')) options.palette = r.get('palette');
  if (r.has('background')) options.background = r.get('background');
  const padding = toNumber(r.get('padding'));
  if (padding !== undefined) options.padding = padding;

  const geometryMap: Array<[string, string]> = [
    ['stroke-width', 'strokeWidth'],
    ['edge-width', 'edgeWidth'],
    ['radius', 'nodeRadius'],
    ['cluster-radius', 'clusterRadius'],
    ['arrow-scale', 'arrowScale'],
    ['shadow-blur', 'nodeShadow'],
    ['shadow-y', 'nodeShadowY'],
    ['glow', 'edgeGlow'],
  ];
  for (const [flag, key] of geometryMap) {
    const value = toNumber(r.get(flag));
    if (value !== undefined) geometry[key] = value;
  }
  if (r.has('edge-dash')) {
    const raw = r.get('edge-dash') ?? '';
    geometry.edgeDash = raw === 'none' || raw === 'solid' ? null : raw;
  }

  const typographyMap: Array<[string, string]> = [
    ['font-family', 'fontFamily'],
    ['font-size', 'fontSize'],
    ['font-weight', 'fontWeight'],
    ['letter-spacing', 'letterSpacing'],
  ];
  for (const [flag, key] of typographyMap) {
    const value = key === 'fontFamily' ? r.get(flag) : toNumber(r.get(flag));
    if (value !== undefined) typography[key] = value;
  }
  if (r.has('uppercase')) typography.textTransform = r.bool('uppercase') ? 'uppercase' : 'none';

  if (r.has('fill')) effects.nodeFill = r.get('fill');
  if (r.has('canvas')) effects.background = r.get('canvas');
  const patternSize = toNumber(r.get('pattern-size'));
  if (patternSize !== undefined) effects.patternSize = patternSize;
  if (r.has('animate')) effects.animatedEdges = r.bool('animate');
  if (r.has('sketch')) effects.sketch = r.bool('sketch');

  const colorMap: Array<[string, string]> = [
    ['stroke-color', 'nodeStroke'],
    ['node-color', 'nodeFill'],
    ['text-color', 'nodeText'],
    ['edge-color', 'edge'],
    ['bg-color', 'bg'],
    ['accent', 'accent'],
  ];
  for (const [flag, key] of colorMap) {
    const value = r.get(flag);
    if (value !== undefined) colors[key] = value;
  }

  if (r.has('curve')) mermaid.flowchart = { curve: r.get('curve') };
  if (r.has('security')) mermaid.securityLevel = r.get('security');
  if (r.has('mermaid-json')) {
    try {
      Object.assign(mermaid, JSON.parse(r.get('mermaid-json')!) as Record<string, unknown>);
    } catch (error) {
      throw new Error(`--mermaid-json is not valid JSON: ${(error as Error).message}`);
    }
  }

  const layout: Record<string, unknown> = {};
  if (r.has('direction')) layout.direction = r.get('direction');
  if (r.has('node-spacing')) layout.nodeSpacing = r.number('node-spacing');
  if (r.has('rank-spacing')) layout.rankSpacing = r.number('rank-spacing');
  if (r.has('wrap')) layout.wrappingWidth = r.number('wrap');
  if (r.has('max-aspect')) layout.maxAspect = r.number('max-aspect');
  if (r.has('curve')) layout.curve = r.get('curve');
  if (Object.keys(layout).length) options.layout = layout;

  // Legibility is on by default in the SDK; the flag exists to opt out.
  if (r.has('contrast')) options.contrast = r.get('contrast');

  const styling: Record<string, unknown> = {};
  if (Object.keys(geometry).length) styling.geometry = geometry;
  if (Object.keys(typography).length) styling.typography = typography;
  if (Object.keys(effects).length) styling.effects = effects;
  if (Object.keys(colors).length) styling.colors = colors;
  if (Object.keys(styling).length) options.styling = styling;
  if (Object.keys(mermaid).length) options.mermaid = mermaid;

  return options;
}

function planFromArgs(argv: string[]): { plan: RenderPlan; positional: string[] } {
  const parsed = parseArgs(argv);
  const r = reader(parsed);

  const out = r.get('out');
  const explicitFormat = r.get('format')?.toLowerCase() as OutputFormat | undefined;
  let format: OutputFormat = explicitFormat ?? 'svg';
  if (!explicitFormat && out) {
    const ext = extname(out).slice(1).toLowerCase();
    if (ext === 'png' || ext === 'pdf' || ext === 'svg' || ext === 'html') format = ext;
  }
  if (explicitFormat && !['svg', 'png', 'pdf', 'html'].includes(explicitFormat)) {
    throw new Error(`Unknown format "${explicitFormat}". Use svg, png, pdf or html.`);
  }

  const backgroundFlag = r.get('background');
  const options = buildRenderOptions(r);
  const background = backgroundFlag ?? 'theme';

  return {
    plan: {
      options,
      format,
      out,
      scale: toNumber(r.get('scale')) ?? 2,
      background,
      padding: toNumber(r.get('padding')) ?? 16,
      json: r.bool('json'),
      embedContent: r.bool('embed'),
      quiet: r.bool('quiet'),
    },
    positional: parsed.positional,
  };
}

function readSource(input: string | undefined): { source: string; name: string } {
  if (!input || input === '-') {
    try {
      const source = readFileSync(0, 'utf8');
      return { source, name: 'stdin' };
    } catch {
      throw new Error('No input given. Pass a file path, or pipe the diagram on stdin.');
    }
  }
  const example = getExample(input);
  if (example && !existsSync(input)) return { source: example.source, name: `${example.id} (built-in example)` };
  if (!existsSync(input)) throw new Error(`Input not found: ${input}`);
  return { source: readFileSync(input, 'utf8'), name: input };
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

interface JsonResult {
  ok: boolean;
  [key: string]: unknown;
}

function emit(result: JsonResult, plan: RenderPlan, text?: string): void {
  if (plan.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (text !== undefined) {
    process.stdout.write(text);
  }
}

async function commandRender(argv: string[]): Promise<number> {
  const { plan, positional } = planFromArgs(argv);
  const { source, name } = readSource(positional[0]);

  return withPilot(
    { scale: plan.scale, onBrowser: undefined },
    async (pilot) => {
      const outcome = await pilot.render(source, plan.options);
      return writeOutcome(pilot, outcome, plan, name);
    },
  );
}

async function writeOutcome(
  pilot: Pilot,
  outcome: RenderOutcome,
  plan: RenderPlan,
  name: string,
): Promise<number> {
  const result: JsonResult = {
    ok: true,
    source: name,
    format: plan.format,
    theme: outcome.theme,
    palette: outcome.palette,
    preset: outcome.preset,
    appearance: outcome.appearance,
    direction: outcome.direction,
    width: outcome.width,
    height: outcome.height,
    scale: plan.format === 'svg' || plan.format === 'html' ? 1 : plan.scale,
    warnings: outcome.warnings,
  };

  let payload: Buffer | string;
  switch (plan.format) {
    case 'svg':
      payload = outcome.svg;
      break;
    case 'html': {
      const { wrapInHtml, resolveTheme } = await import('@neomermaid/core');
      payload = wrapInHtml(outcome.svg, resolveTheme(plan.options as never).tokens, name);
      break;
    }
    case 'png':
      payload = await pilot.toPng(outcome.svg, {
        width: outcome.width,
        height: outcome.height,
        scale: plan.scale,
        background: plan.background === 'transparent' ? 'transparent' : outcome.background,
        title: name,
      });
      break;
    case 'pdf':
      payload = await pilot.toPdf(outcome.svg, {
        width: outcome.width,
        height: outcome.height,
        scale: plan.scale,
        background: plan.background === 'transparent' ? 'transparent' : outcome.background,
        title: name,
      });
      break;
    default:
      throw new Error(`Unsupported format ${plan.format}`);
  }

  if (plan.out) {
    const target = resolve(plan.out);
    ensureDir(dirname(target));
    writeFileSync(target, payload);
    result.out = target;
    result.bytes = typeof payload === 'string' ? Buffer.byteLength(payload) : payload.length;
  } else if (plan.format !== 'svg' && plan.format !== 'html') {
    throw new Error(`--format ${plan.format} needs an output file (-o out.${plan.format}).`);
  }

  if (plan.embedContent) {
    result.content = typeof payload === 'string' ? payload : payload.toString('base64');
    result.contentEncoding = typeof payload === 'string' ? 'utf8' : 'base64';
  }

  const text = typeof payload === 'string' && !plan.out ? payload : undefined;
  emit(result, plan, text);

  if (!plan.json && plan.out) {
    const kb = typeof payload === 'string' ? Buffer.byteLength(payload) : payload.length;
    process.stderr.write(
      `✓ ${name} → ${plan.out} (${outcome.theme}/${outcome.palette}, ${outcome.width}×${outcome.height}, ${(kb / 1024).toFixed(1)} kB)\n`,
    );
  }
  return 0;
}

async function commandGallery(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const r = reader(parsed);
  const dir = parsed.positional[0];
  const outDir = resolve(r.get('out') ?? '.gallery');
  const presets = (r.get('presets') ?? 'minimal/github-light,neon/dracula,tech/tokyo-night,cartoon/solarized-light,glass/nord,blueprint/dracula')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const format = (r.get('format') ?? 'png').toLowerCase() as 'png' | 'svg';
  const scale = toNumber(r.get('scale')) ?? 2;

  const files: Array<{ name: string; source: string }> = [];
  if (dir && existsSync(dir)) {
    const entries = statSync(dir).isDirectory()
      ? readdirSync(dir).filter((f) => /\.(mmd|mermaid)$/i.test(f)).map((f) => join(dir, f))
      : [dir];
    for (const entry of entries) {
      files.push({ name: basename(entry, extname(entry)), source: readFileSync(entry, 'utf8') });
    }
  } else {
    for (const example of EXAMPLES) files.push({ name: example.id, source: example.source });
  }

  ensureDir(outDir);
  const rendered: Array<{ file: string; preset: string; example: string; width: number; height: number }> = [];

  await withPilot({ scale }, async (pilot) => {
    for (const preset of presets) {
      for (const file of files) {
        const outcome = await pilot.render(file.source, { preset, padding: 24 });
        const target = join(outDir, `${file.name}--${preset.replace(/[/@:]/g, '_')}.${format}`);
        if (format === 'svg') {
          writeFileSync(target, outcome.svg);
        } else {
          writeFileSync(
            target,
            await pilot.toPng(outcome.svg, {
              width: outcome.width,
              height: outcome.height,
              scale,
              background: 'transparent',
              title: file.name,
            }),
          );
        }
        rendered.push({ file: basename(target), preset, example: file.name, width: outcome.width, height: outcome.height });
        if (!r.bool('quiet')) process.stderr.write(`✓ ${basename(target)}\n`);
      }
    }
  });

  writeFileSync(
    join(outDir, 'index.html'),
    galleryHtml(rendered, presets, format),
  );

  if (r.bool('json')) {
    process.stdout.write(`${JSON.stringify({ ok: true, out: outDir, count: rendered.length, items: rendered }, null, 2)}\n`);
  } else {
    process.stdout.write(`${rendered.length} images → ${outDir}\n`);
  }
  return 0;
}

function galleryHtml(
  items: Array<{ file: string; preset: string; example: string }>,
  presets: string[],
  format: string,
): string {
  const groups = presets.map((preset) => {
    const cells = items
      .filter((i) => i.preset === preset)
      .map(
        (i) =>
          `<figure><img src="${i.file}" alt="${i.example} in ${i.preset}" loading="lazy"><figcaption>${i.example}</figcaption></figure>`,
      )
      .join('\n');
    return `<section><h2>${preset}</h2><div class="grid">${cells}</div></section>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>NeoMermaid gallery</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 32px; background: #0b0d12; color: #e6e8ef; font: 15px/1.5 system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.sub { color: #8b93a7; margin: 0 0 32px; }
  h2 { font-size: 15px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #8b93a7; margin: 40px 0 12px; }
  .grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  figure { margin: 0; background: #12151d; border: 1px solid #232838; border-radius: 12px; padding: 12px; }
  img { width: 100%; height: auto; display: block; }
  figcaption { margin-top: 8px; font-size: 12px; color: #8b93a7; }
</style></head>
<body><h1>NeoMermaid gallery</h1><p class="sub">${items.length} renders (${format}) across ${presets.length} presets.</p>
${groups.join('\n')}
</body></html>`;
}

function commandThemes(json: boolean): number {
  const themes = listThemes();
  const palettes = listPalettes();
  const presets = listPresets();
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, themes, palettes, presets, count: { themes: themes.length, palettes: palettes.length, presets: presets.length } }, null, 2)}\n`,
    );
    return 0;
  }
  process.stdout.write(`Themes (${themes.length})\n`);
  for (const t of themes) process.stdout.write(`  ${t.id.padEnd(12)} ${t.appearance.padEnd(8)} ${t.description}\n`);
  process.stdout.write(`\nPalettes (${palettes.length})\n`);
  for (const p of palettes) process.stdout.write(`  ${p.id.padEnd(18)} ${p.appearance.padEnd(6)} accent ${p.accent}\n`);
  process.stdout.write(`\nPresets (${presets.length}): ${presets.slice(0, 8).join(', ')}, …\n`);
  return 0;
}

function commandExamples(json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, examples: EXAMPLES }, null, 2)}\n`);
    return 0;
  }
  for (const e of EXAMPLES) {
    process.stdout.write(`  ${e.id.padEnd(22)} ${e.title}\n      ${e.description}\n`);
  }
  return 0;
}

async function commandDoctor(json: boolean): Promise<number> {
  const browsers = findBrowsers();
  const bundle = coreBundlePath();
  const report = {
    ok: browsers.length > 0 && existsSync(bundle),
    version: VERSION,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    coreBundle: bundle,
    coreBundleBytes: coreBundleSize(),
    coreBundleExists: existsSync(bundle),
    browsers,
    themePaletteMatrix: `${Object.keys(THEMES).length} themes × ${Object.keys(PALETTES).length} palettes = ${listPresets().length} presets`,
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`neomermaid ${VERSION} on node ${process.version} (${process.platform})\n`);
    process.stdout.write(`core bundle: ${bundle} ${report.coreBundleExists ? `(${(report.coreBundleBytes / 1024 / 1024).toFixed(1)} MB)` : 'MISSING — run npm run build:core'}\n`);
    process.stdout.write(`browsers found: ${browsers.length}\n`);
    for (const b of browsers.slice(0, 6)) process.stdout.write(`  ${b.name.padEnd(20)} ${b.path}\n`);
    process.stdout.write(`${report.themePaletteMatrix}\n`);
  }
  return report.ok ? 0 : 1;
}

export { parseArgs, reader } from './args.js';
export { findBrowsers, resolveBrowserPath } from './browser.js';
export type { BrowserCandidate } from './browser.js';
export { Pilot, withPilot, coreBundlePath, coreBundleSize } from './renderer.js';
export type { RenderOutcome, RasterOptions } from './renderer.js';

export async function run(argv: string[]): Promise<number> {
  const command = argv[0];
  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      process.stdout.write(HELP);
      return 0;
    }
    if (command === '--version' || command === '-v' || command === 'version') {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    const rest = argv.slice(1);
    switch (command) {
      case 'render':
        return await commandRender(rest);
      case 'gallery':
        return await commandGallery(rest);
      case 'themes':
      case 'palettes':
      case 'presets':
        return commandThemes(parseArgs(rest).flags.has('json') || parseArgs(rest).flags.has('j'));
      case 'examples':
        return commandExamples(parseArgs(rest).flags.has('json'));
      case 'doctor':
        return await commandDoctor(parseArgs(rest).flags.has('json'));
      default:
        // Allow `neomermaid flow.mmd -o flow.png` without the explicit verb.
        if (command.endsWith('.mmd') || command.endsWith('.mermaid') || command === '-') {
          return await commandRender(argv);
        }
        process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
        return 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (argv.includes('--json') || argv.includes('-j')) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
    } else {
      process.stderr.write(`✗ ${message}\n`);
    }
    return 1;
  }
}
