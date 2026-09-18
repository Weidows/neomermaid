/**
 * The preview panel: one webview per mermaid document.
 *
 * Rendering happens *inside* the webview — `@neomermaid/core` is DOM-only, which
 * is exactly the right place for it — while this file owns the document lifecycle
 * (live updates, settings, exports) and the save/clipboard side effects that the
 * webview is not allowed to do.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import {
  VIEW_TYPE,
  isWebviewToHostMessage,
  type Appearance,
  type CopySvgResultMessage,
  type ExportFormat,
  type ExportResultMessage,
  type HostToWebviewMessage,
  type PreviewState,
  type RenderMessage,
} from './protocol.js';
import { configuredPreset, configuredState, liveUpdateDelay, presetAppearance, presetCatalog, saveDefault } from './config.js';

export interface PreviewDeps {
  context: vscode.ExtensionContext;
  output: vscode.OutputChannel;
  /** Called whenever a render finishes, so the extension can update the UI. */
  onRendered?: (panel: PreviewPanel, message: RenderMessage) => void;
  /** The toolbar asks for an export; the host owns the save dialog. */
  onExportIntent?: (panel: PreviewPanel, format: ExportFormat) => void;
  onCopyIntent?: (panel: PreviewPanel) => void;
}

export function isMermaidDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === 'mermaid') return true;
  return /\.(mmd|mermaid)$/i.test(document.uri.path);
}

function basename(document: vscode.TextDocument): string {
  const path = document.uri.path;
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name || 'untitled';
}

function nonce(): string {
  return randomBytes(16).toString('hex');
}

export class PreviewPanel {
  private static readonly panels = new Map<string, PreviewPanel>();
  private static deps: PreviewDeps | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly pending = new Map<string, (value: ExportResultMessage | CopySvgResultMessage) => void>();
  private requestCounter = 0;

  private state: PreviewState;
  private stateWarning: string | undefined;
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private initSent = false;
  private lastSource: string | undefined;
  private updateTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly document: vscode.TextDocument,
    private readonly deps: PreviewDeps,
    state: PreviewState,
    warning: string | undefined,
  ) {
    this.state = state;
    this.stateWarning = warning;
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    panel.webview.html = this.buildHtml();

    panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this.handleMessage(message);
      },
      undefined,
      this.disposables,
    );

    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (event.document.uri.toString() === this.document.uri.toString()) this.scheduleUpdate();
      },
      undefined,
      this.disposables,
    );

    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  /* ------------------------------------------------------------- lifecycle */

  static configure(deps: PreviewDeps): void {
    PreviewPanel.deps = deps;
  }

  static forDocument(document: vscode.TextDocument): PreviewPanel | undefined {
    return PreviewPanel.panels.get(document.uri.toString());
  }

  static all(): PreviewPanel[] {
    return [...PreviewPanel.panels.values()];
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    column: vscode.ViewColumn,
  ): PreviewPanel {
    const deps = PreviewPanel.deps;
    if (!deps || deps.context !== context) {
      throw new Error('PreviewPanel.configure() must be called during activation.');
    }

    const key = document.uri.toString();
    const existing = PreviewPanel.panels.get(key);
    if (existing) {
      existing.panel.title = `NeoMermaid: ${basename(document)}`;
      if (!existing.panel.visible) existing.panel.reveal(column, true);
      return existing;
    }

    const { state, warning } = configuredState();
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, `NeoMermaid: ${basename(document)}`, column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist'),
        vscode.Uri.joinPath(context.extensionUri, 'media'),
      ],
    });

    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'preview.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'preview.svg'),
    };

    const created = new PreviewPanel(panel, document, deps, state, warning);
    PreviewPanel.panels.set(key, created);
    return created;
  }

  static disposeAll(): void {
    for (const panel of PreviewPanel.all()) panel.dispose();
  }

  dispose(): void {
    PreviewPanel.panels.delete(this.document.uri.toString());
    if (this.updateTimer) clearTimeout(this.updateTimer);
    for (const settle of this.pending.values()) {
      settle({
        type: 'exportResult',
        requestId: 'disposed',
        format: 'png',
        ok: false,
        error: 'The preview was closed before the export finished.',
      });
    }
    this.pending.clear();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    try {
      this.panel.dispose();
    } catch {
      /* already gone */
    }
  }

  /* --------------------------------------------------------------- messages */

  private async handleMessage(raw: unknown): Promise<void> {
    if (!isWebviewToHostMessage(raw)) {
      this.deps.output.appendLine(`Ignored malformed webview message: ${String(raw)}`);
      return;
    }

    switch (raw.type) {
      case 'ready': {
        this.resolveReady();
        this.sendInit();
        break;
      }
      case 'rendered': {
        if (raw.ok) {
          this.deps.output.appendLine(
            `rendered ${this.state.preset} ${raw.width}×${raw.height} in ${Math.round(raw.durationMs)}ms` +
              (raw.warnings?.length ? ` (warnings: ${raw.warnings.join('; ')})` : ''),
          );
        } else {
          this.deps.output.appendLine(`render failed: ${raw.error ?? 'unknown error'}`);
        }
        this.deps.onRendered?.(this, raw);
        break;
      }
      case 'stateChanged': {
        // The webview is a separate context: keep only well-formed values.
        const incoming = raw.state;
        if (incoming && typeof incoming === 'object') {
          const current = this.state;
          this.state = {
            preset: typeof incoming.preset === 'string' && incoming.preset ? incoming.preset : current.preset,
            background: typeof incoming.background === 'string' && incoming.background ? incoming.background : current.background,
            padding: Number.isFinite(incoming.padding) ? incoming.padding : current.padding,
            exportScale: Number.isFinite(incoming.exportScale) ? incoming.exportScale : current.exportScale,
            zoom: Number.isFinite(incoming.zoom) ? incoming.zoom : current.zoom,
            fitToWidth: typeof incoming.fitToWidth === 'boolean' ? incoming.fitToWidth : current.fitToWidth,
          };
        }
        if (raw.reason === 'user') this.stateWarning = undefined;
        break;
      }
      case 'saveDefault': {
        await saveDefault({
          preset: raw.preset,
          background: raw.background,
          padding: raw.padding,
        });
        const label = raw.preset;
        void vscode.window.showInformationMessage(`NeoMermaid: saved "${label}" as the default preset.`);
        break;
      }
      case 'exportIntent': {
        this.deps.onExportIntent?.(this, raw.format);
        break;
      }
      case 'copyIntent': {
        this.deps.onCopyIntent?.(this);
        break;
      }
      case 'exportResult':
      case 'copySvgResult': {
        this.pending.get(raw.requestId)?.(raw);
        this.pending.delete(raw.requestId);
        break;
      }
      case 'log': {
        this.deps.output.appendLine(`[webview:${raw.level}] ${raw.message}`);
        break;
      }
    }
  }

  private sendInit(): void {
    if (this.initSent) return;
    this.initSent = true;
    this.post({
      type: 'init',
      source: this.document.getText(),
      documentLabel: basename(this.document),
      state: this.state,
      appearance: presetAppearance(this.state.preset),
      liveUpdateDelay: liveUpdateDelay(),
      catalog: presetCatalog(),
    });
    this.lastSource = this.document.getText();
    if (this.stateWarning) {
      void vscode.window.showWarningMessage(`NeoMermaid: ${this.stateWarning}`);
      this.stateWarning = undefined;
    }
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  /* ----------------------------------------------------------- live updates */

  private scheduleUpdate(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined;
      void this.sendUpdate();
    }, liveUpdateDelay());
  }

  private async sendUpdate(): Promise<void> {
    await this.ready;
    const source = this.document.getText();
    if (source === this.lastSource) return;
    this.lastSource = source;
    this.post({ type: 'update', source });
  }

  /** Force a re-send of the document text (used after a settings change). */
  async refresh(): Promise<void> {
    await this.ready;
    const source = this.document.getText();
    this.lastSource = source;
    this.post({ type: 'update', source });
  }

  /* ---------------------------------------------------------------- states */

  /** Apply a partial state (toolbar-driven or settings-driven) in the webview. */
  applyState(partial: Partial<PreviewState>, appearance?: Appearance): void {
    this.state = { ...this.state, ...partial };
    this.post({
      type: 'setState',
      state: partial,
      appearance: appearance ?? presetAppearance(this.state.preset),
    });
  }

  /** Re-read settings after `neomermaid.*` or the colour theme changed. */
  syncFromConfiguration(): void {
    const cfg = configuredState();
    const kind = presetAppearance(cfg.state.preset);
    // Preset comes from settings; zoom/fit belong to the user's current session.
    this.state = { ...this.state, ...cfg.state, zoom: this.state.zoom, fitToWidth: this.state.fitToWidth };
    this.post({
      type: 'setState',
      state: {
        preset: cfg.state.preset,
        background: cfg.state.background,
        padding: cfg.state.padding,
        exportScale: cfg.state.exportScale,
      },
      appearance: kind,
    });
  }

  setPreset(preset: string): void {
    this.applyState({ preset }, presetAppearance(preset));
  }

  get currentState(): PreviewState {
    return this.state;
  }

  get label(): string {
    return basename(this.document);
  }

  get documentUri(): vscode.Uri {
    return this.document.uri;
  }

  /** The document this panel renders — used by toolbar-driven exports. */
  get textDocument(): vscode.TextDocument {
    return this.document;
  }

  /* --------------------------------------------------------------- requests */

  private async request<T extends ExportResultMessage | CopySvgResultMessage>(
    build: (requestId: string, format: ExportFormat) => HostToWebviewMessage,
    format: ExportFormat,
    timeoutMs = 30_000,
  ): Promise<T> {
    await this.ready;
    if (!this.panel.visible) this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Beside, true);

    const requestId = `req${++this.requestCounter}`;
    const answer = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('NeoMermaid: the preview did not answer in time.'));
      }, timeoutMs);
      this.pending.set(requestId, (value) => {
        clearTimeout(timer);
        resolve(value as T);
      });
    });

    this.post(build(requestId, format));
    return answer;
  }

  requestExport(format: ExportFormat): Promise<ExportResultMessage> {
    return this.request<ExportResultMessage>(
      (requestId) => ({ type: 'exportRequest', requestId, format }),
      format,
    );
  }

  requestCopySvg(): Promise<CopySvgResultMessage> {
    return this.request<CopySvgResultMessage>(
      (requestId) => ({ type: 'copySvgRequest', requestId }),
      'svg',
    );
  }

  /* ------------------------------------------------------------------ html */

  private buildHtml(): string {
    const webview = this.panel.webview;
    const distUri = vscode.Uri.joinPath(this.deps.context.extensionUri, 'dist');
    const mediaUri = vscode.Uri.joinPath(this.deps.context.extensionUri, 'media');
    const templatePath = vscode.Uri.joinPath(mediaUri, 'webview.html');

    let template: string;
    try {
      template = readFileSync(templatePath.fsPath, 'utf8');
    } catch (error) {
      return `<!doctype html><html><body><h1>NeoMermaid</h1><p>The webview template is missing: ${String(error)}</p></body></html>`;
    }

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js')).toString();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'webview.css')).toString();
    const token = nonce();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      "img-src data: blob:",
      `script-src 'nonce-${token}'`,
      "connect-src 'none'",
    ].join('; ');

    return template
      .replaceAll('{{csp}}', csp)
      .replaceAll('{{nonce}}', token)
      .replaceAll('{{styleUri}}', styleUri)
      .replaceAll('{{scriptUri}}', scriptUri);
  }
}

/** Guard used by every command: only mermaid documents get a preview. */
export function requireMermaidDocument(): vscode.TextDocument | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMermaidDocument(editor.document)) return undefined;
  return editor.document;
}

/** The preset a *new* preview would start from — used by the status bar. */
export function upcomingPreset(): string {
  return configuredPreset().preset;
}
