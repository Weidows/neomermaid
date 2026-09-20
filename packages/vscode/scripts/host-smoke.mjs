#!/usr/bin/env node
/**
 * Host-side smoke test for the extension bundle.
 *
 * `dist/extension.cjs` cannot run in Node without VS Code, so this script loads
 * it with a stub `vscode` module injected into the CommonJS loader and drives a
 * whole preview session: activation, the `openPreviewToSide` command, the real
 * `media/webview.html` template, the ready → init handshake, a debounced live
 * update, PNG export (including the file write) and the clipboard path.
 *
 * It never touches the network and never launches a browser, so it is fast enough
 * to run on every change — the browser-side behaviour is covered by
 * webview-smoke.mjs.
 *
 * Usage:  node packages/vscode/scripts/host-smoke.mjs
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const EXTENSION_CJS = join(pkgRoot, 'dist', 'extension.cjs');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A 1×1 PNG, so the export path has real PNG magic bytes to write. */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/* -------------------------------------------------------------------- stub */

class Uri {
  constructor(path, scheme = 'file') {
    this.scheme = scheme;
    this.path = path.replace(/\\/g, '/');
    this.fsPath = this.path;
  }
  toString() {
    return `${this.scheme}:${this.path}`;
  }
  with() {
    return this;
  }
  static file(p) {
    return new Uri(p, 'file');
  }
  static joinPath(base, ...parts) {
    const root = base.path.replace(/\/+$/, '');
    return new Uri([root, ...parts].join('/'), base.scheme);
  }
}

function makeEvent() {
  const listeners = [];
  return {
    event: (listener) => {
      listeners.push(listener);
      return { dispose() {} };
    },
    fire: (...args) => {
      for (const listener of listeners) listener(...args);
    },
    count: () => listeners.length,
  };
}

function createHarness(saveDir) {
  const state = {
    saveDir,
    messages: [], // every webview → host message the extension handled
    posted: [], // every host → webview message
    configUpdates: [],
    info: [],
    warnings: [],
    errors: [],
    savedTo: [],
    clipboard: [],
    panels: [],
    commands: new Map(),
    quickPicks: [],
  };

  const config = {
    followEditorTheme: true,
    defaultPreset: 'minimal/github-light',
    lightPreset: 'minimal/github-light',
    darkPreset: 'neon/dracula',
    background: 'theme',
    padding: 16,
    exportScale: 2,
    liveUpdateDelay: 250,
  };

  const events = {
    changeTextDocument: makeEvent(),
    changeConfiguration: makeEvent(),
    changeColorTheme: makeEvent(),
    changeActiveEditor: makeEvent(),
    closeTextDocument: makeEvent(),
    disposePanel: new Map(),
  };

  const vscode = {
    version: '1.90.0',
    Uri,
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },

    window: {
      activeTextEditor: undefined,
      visibleTextEditors: [],
      activeColorTheme: { kind: 2 },
      createOutputChannel: () => {
        const lines = [];
        return { appendLine: (line) => lines.push(line), lines, dispose() {} };
      },
      createStatusBarItem: () => ({
        text: '',
        tooltip: '',
        command: '',
        visible: false,
        show() {
          this.visible = true;
        },
        hide() {
          this.visible = false;
        },
        dispose() {},
      }),
      createWebviewPanel: (viewType, title, column, options) => {
        const panel = {
          viewType,
          title,
          viewColumn: column,
          options,
          iconPath: undefined,
          visible: true,
          disposed: false,
          webview: {
            cspSource: 'vscode-webview://smoke-test',
            html: '',
            asWebviewUri: (uri) => new Uri(`/vscode-resource${uri.path}`, 'https'),
            postMessage: async (message) => {
              state.posted.push(message);
              await respondToHostMessage(message);
              return true;
            },
            onDidReceiveMessage: (listener) => {
              panel.webview.receive = listener;
              return { dispose() {} };
            },
          },
          reveal() {
            this.visible = true;
          },
          dispose() {
            if (this.disposed) return;
            this.disposed = true;
            for (const listener of events.disposePanel.get(panel) ?? []) listener();
          },
          onDidDispose: (listener) => {
            const list = events.disposePanel.get(panel) ?? [];
            list.push(listener);
            events.disposePanel.set(panel, list);
            return { dispose() {} };
          },
        };
        state.panels.push(panel);
        return panel;
      },
      showInformationMessage: async (...args) => {
        state.info.push(args);
        return undefined;
      },
      showWarningMessage: async (...args) => {
        state.warnings.push(args);
        return undefined;
      },
      showErrorMessage: async (...args) => {
        state.errors.push(args);
        return undefined;
      },
      showQuickPick: async () => undefined,
      showSaveDialog: async () => Uri.file(join(state.saveDir, 'export.png')),
      onDidChangeActiveTextEditor: events.changeActiveEditor.event,
      onDidChangeActiveColorTheme: events.changeColorTheme.event,
    },

    workspace: {
      workspaceFolders: undefined,
      getConfiguration: () => ({
        get: (key, fallback) => (key in config ? config[key] : fallback),
        update: async (key, value, target) => {
          config[key] = value;
          state.configUpdates.push({ key, value, target });
        },
      }),
      onDidChangeTextDocument: events.changeTextDocument.event,
      onDidChangeConfiguration: events.changeConfiguration.event,
      onDidCloseTextDocument: events.closeTextDocument.event,
      fs: {
        writeFile: async (uri, bytes) => {
          state.savedTo.push({ path: uri.fsPath, bytes: Buffer.from(bytes) });
        },
      },
    },

    commands: {
      registerCommand: (name, handler) => {
        state.commands.set(name, handler);
        return { dispose() {} };
      },
      executeCommand: async () => undefined,
    },

    env: { clipboard: { writeText: async (text) => state.clipboard.push(text) } },
  };

  /** Stand-in for the webview: answers the requests the host sends it. */
  async function respondToHostMessage(message) {
    const panel = [...state.panels].reverse().find((p) => p.webview.receive && !p.disposed);
    const reply = (payload) => panel?.webview.receive?.(payload);

    if (message.type === 'exportRequest') {
      reply({
        type: 'exportResult',
        requestId: message.requestId,
        format: message.format,
        ok: true,
        base64: message.format === 'png' ? TINY_PNG_BASE64 : undefined,
        svg: message.format === 'svg' ? '<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>' : undefined,
        width: 1,
        height: 1,
        opaqueSamples: 1,
      });
    } else if (message.type === 'copySvgRequest') {
      reply({ type: 'copySvgResult', requestId: message.requestId, ok: true, svg: '<svg id="copied"/>' });
    }
  }

  vscode.__state = state;
  vscode.__config = config;
  vscode.__events = events;
  return vscode;
}

/* ------------------------------------------------------------------- runner */

function installStub(vscode) {
  const original = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return original.call(this, request, parent, isMain);
  };
  return () => {
    Module._load = original;
  };
}

function makeDocument(text, name = 'smoke.mmd') {
  const state = { text };
  return {
    languageId: 'mermaid',
    uri: Uri.file(join(tmpdir(), 'neomermaid-host-smoke', name)),
    fileName: name,
    getText: () => state.text,
    set: (next) => {
      state.text = next;
    },
  };
}

/* --------------------------------------------------------------------- main */

section('artefacts');
if (!existsSync(EXTENSION_CJS)) {
  console.error(`\nFAIL  ${EXTENSION_CJS} is missing — run "node scripts/build-vscode.mjs" first.`);
  process.exit(1);
}
const extensionBytes = readFileSync(EXTENSION_CJS);
check(
  'dist/extension.cjs exists and looks like CommonJS',
  extensionBytes.length > 5_000 && !/^\s*(import|export)\s/m.test(extensionBytes.subarray(0, 400).toString('utf8')),
  `${(extensionBytes.length / 1024).toFixed(1)} kB`,
);
check('dist/extension.cjs carries the template placeholders', extensionBytes.includes(Buffer.from('{{scriptUri}}')));

const saveDir = mkdtempSync(join(tmpdir(), 'neomermaid-host-save-'));
const vscode = createHarness(saveDir);
const restore = installStub(vscode);
const require = createRequire(import.meta.url);
let exitCode = 1;

try {
  const extension = require(EXTENSION_CJS);

  section('activation');
  const context = {
    subscriptions: [],
    extensionUri: Uri.file(pkgRoot),
    globalState: { get: () => undefined, update: async () => undefined },
  };
  extension.activate(context);

  const commands = [...vscode.__state.commands.keys()].sort();
  check(
    'every contributed command is registered',
    commands.length === 6 && commands.includes('neomermaid.openPreviewToSide'),
    commands.join(', '),
  );

  section('open preview → init handshake');
  const document = makeDocument('flowchart LR\n  a["Alpha"] --> b["Beta"]\n');
  vscode.__state.panels.length = 0;
  vscode.window.activeTextEditor = { document };
  await vscode.__state.commands.get('neomermaid.openPreviewToSide')();

  const panel = vscode.__state.panels[0];
  check('createWebviewPanel was called with the mermaid view type', panel?.viewType === 'neomermaid.preview');
  check(
    'the panel is a scripted webview with only our two resource roots',
    panel?.options.enableScripts === true && panel.options.localResourceRoots.length === 2,
    `roots ${panel?.options.localResourceRoots.map((r) => r.path).join(' , ')}`,
  );

  const html = panel.webview.html;
  const nonce = html.match(/<script nonce="([0-9a-f]+)"/)?.[1];
  check(
    'the real template is rendered with no placeholders left',
    html.includes('id="neomermaid-root"') && !html.includes('{{'),
    `${html.length} bytes`,
  );
  check(
    'the CSP nonce matches the script tag nonce',
    Boolean(nonce) && html.includes(`script-src 'nonce-${nonce}'`) && html.includes(`nonce="${nonce}"`),
    `nonce ${nonce?.slice(0, 12)}…`,
  );
  check(
    'script and stylesheet resolve to webview URIs',
    html.includes('/vscode-resource') && html.includes('dist/webview.js') && html.includes('media/webview.css'),
    html.match(/src="([^"]+)"/)?.[1]?.slice(-40),
  );

  panel.webview.receive({ type: 'ready' });
  await sleep(50);
  const init = vscode.__state.posted.find((m) => m.type === 'init');
  check(
    'ready → init carries the document and the theme-driven preset',
    init?.source === document.getText() &&
      init.state.preset === 'neon/dracula' &&
      init.appearance === 'dark' &&
      init.documentLabel === 'smoke.mmd' &&
      init.liveUpdateDelay === 250,
    `${init?.state.preset} · ${init?.documentLabel} · ${init?.source.length} chars`,
  );
  check(
    'the catalog matches @neomermaid/core (6 themes · 11 palettes · 66 presets)',
    init?.catalog.themes.length === 6 && init.catalog.palettes.length >= 18 && init.catalog.presets.length === init.catalog.themes.length * init.catalog.palettes.length,
    `${init?.catalog.themes.length} themes · ${init?.catalog.palettes.length} palettes · ${init?.catalog.presets.length} presets`,
  );

  section('live update');
  document.set('flowchart LR\n  x["Changed"] --> y["Yes"]\n');
  const before = vscode.__state.posted.length;
  vscode.__events.changeTextDocument.fire({ document });
  await sleep(400); // liveUpdateDelay is 250 ms
  const update = vscode.__state.posted.slice(before).find((m) => m.type === 'update');
  check(
    'a document change is debounced and pushed to the webview',
    update?.source.includes('Changed'),
    `${update?.source.split('\n').length ?? 0} lines after ~${400} ms`,
  );

  section('export PNG');
  await vscode.__state.commands.get('neomermaid.exportPng')();
  const exportRequest = vscode.__state.posted.find((m) => m.type === 'exportRequest' && m.format === 'png');
  const written = vscode.__state.savedTo.at(-1);
  check('the PNG command asks the webview to rasterise', Boolean(exportRequest), `requestId ${exportRequest?.requestId}`);
  check(
    'the returned bytes are written to the chosen file',
    written?.bytes.subarray(0, 4).toString('hex') === '89504e47' && written.path.endsWith('export.png'),
    `${written?.bytes.length} bytes → ${written?.path.split(/[\\/]/).pop()}`,
  );

  section('copy SVG');
  await vscode.__state.commands.get('neomermaid.copySvg')();
  check('copy-SVG puts the webview payload on the clipboard', vscode.__state.clipboard.at(-1) === '<svg id="copied"/>');

  section('toolbar messages');
  vscode.__state.posted.length = 0;
  panel.webview.receive({ type: 'stateChanged', state: { ...init.state, preset: 'tech/nord' }, reason: 'user' });
  panel.webview.receive({ type: 'saveDefault', preset: 'tech/nord', background: 'transparent', padding: 24 });
  await sleep(50);
  const updates = Object.fromEntries(vscode.__state.configUpdates.map((u) => [u.key, u.value]));
  check(
    'a toolbar preset change is remembered and persisted',
    updates.darkPreset === 'tech/nord' && updates.background === 'transparent' && updates.padding === 24,
    JSON.stringify(updates),
  );

  section('invalid configuration');
  vscode.__config.followEditorTheme = false;
  vscode.__config.defaultPreset = 'nope/nope';
  vscode.window.activeTextEditor = { document: makeDocument('flowchart LR\n  a --> b\n', 'second.mmd') };
  vscode.__state.panels.length = 0;
  vscode.__state.posted.length = 0;
  await vscode.__state.commands.get('neomermaid.openPreviewToSide')();
  const secondPanel = vscode.__state.panels[0];
  secondPanel.webview.receive({ type: 'ready' });
  await sleep(50);
  const secondInit = vscode.__state.posted.find((m) => m.type === 'init');
  check(
    'an unknown preset falls back to the default and warns',
    secondInit?.state.preset === 'minimal/github-light' &&
      vscode.__state.warnings.some((w) => String(w[0]).includes('Unknown preset')),
    `${secondInit?.state.preset} · warning raised`,
  );

  section('shutdown');
  extension.deactivate();
  check(
    'deactivate disposes the open panels',
    vscode.__state.panels.every((p) => p.disposed),
    `${vscode.__state.panels.length} panels`,
  );

  exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  failures += 1;
  console.error(`\nFAIL  ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  exitCode = 1;
} finally {
  restore();
  rmSync(saveDir, { recursive: true, force: true });
}

section('summary');
const passed = results.filter((r) => r.pass).length;
console.log(`      ${passed} passed · ${failures} failed (${results.length} assertions)`);
console.log(failures === 0 ? '      RESULT: PASS' : '      RESULT: FAIL');
process.exit(exitCode);
