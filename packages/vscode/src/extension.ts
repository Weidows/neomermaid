/**
 * NeoMermaid — a preview for mermaid that actually uses the NeoMermaid SDK.
 *
 * The vscode layer stays thin on purpose: it resolves the document, forwards the
 * source and options into the webview, and owns the two things a webview cannot
 * do itself (a save dialog and the clipboard). All rendering is
 * `@neomermaid/core` running in the panel, so a diagram exported from here is
 * byte-for-byte the diagram `neomermaid render --preset …` produces.
 */

import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { listPalettes, listThemes } from '@neomermaid/core';
import { PreviewPanel, isMermaidDocument, upcomingPreset } from './preview.js';
import { saveDefault } from './config.js';
import type { ExportFormat, RenderMessage } from './protocol.js';

let output: vscode.OutputChannel;
const renders = new Map<string, RenderMessage>();

/** The mermaid document a command should act on. */
function targetDocument(): vscode.TextDocument | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && isMermaidDocument(active.document)) return active.document;
  for (const editor of vscode.window.visibleTextEditors) {
    if (isMermaidDocument(editor.document)) return editor.document;
  }
  return undefined;
}

function noDocumentMessage(): void {
  void vscode.window.showWarningMessage(
    'NeoMermaid: open a mermaid diagram (.mmd, .mermaid) first, or pick "Mermaid" as the language mode.',
  );
}

function previewFor(context: vscode.ExtensionContext, column: vscode.ViewColumn): PreviewPanel | undefined {
  const document = targetDocument();
  if (!document) {
    noDocumentMessage();
    return undefined;
  }
  return PreviewPanel.createOrShow(context, document, column);
}

function openPreview(context: vscode.ExtensionContext, column: vscode.ViewColumn): void {
  const panel = previewFor(context, column);
  if (panel) output.appendLine(`opened preview for ${panel.documentUri.toString()} (${panel.currentState.preset})`);
}

function defaultTargetUri(document: vscode.TextDocument, extension: string): vscode.Uri {
  const stem = document.uri.path
    .slice(document.uri.path.lastIndexOf('/') + 1)
    .replace(/\.(mmd|mermaid)$/i, '') || 'diagram';
  const name = `${stem}.${extension}`;
  if (document.uri.scheme === 'file') {
    return vscode.Uri.file(join(dirname(document.uri.fsPath), name));
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
  return vscode.Uri.file(join(folder, name));
}

async function exportDiagram(
  context: vscode.ExtensionContext,
  format: ExportFormat,
  document = targetDocument(),
): Promise<void> {
  if (!document) {
    noDocumentMessage();
    return;
  }

  const panel = PreviewPanel.createOrShow(context, document, vscode.ViewColumn.Beside);
  let result;
  try {
    result = await panel.requestExport(format);
  } catch (error) {
    void vscode.window.showErrorMessage(`NeoMermaid: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (!result.ok) {
    void vscode.window.showErrorMessage(`NeoMermaid: export failed — ${result.error ?? 'unknown error'}`);
    return;
  }

  const target = await vscode.window.showSaveDialog({
    defaultUri: defaultTargetUri(document, format),
    filters: format === 'png' ? { Images: ['png'] } : { 'SVG image': ['svg'] },
    title: format === 'png' ? 'Export diagram as PNG' : 'Export diagram as SVG',
  });
  if (!target) return;

  const bytes =
    format === 'png'
      ? Buffer.from(result.base64 ?? '', 'base64')
      : Buffer.from(result.svg ?? '', 'utf8');

  if (format === 'png' && bytes.length < 8) {
    void vscode.window.showErrorMessage('NeoMermaid: the preview returned an empty PNG.');
    return;
  }

  await vscode.workspace.fs.writeFile(target, bytes);
  output.appendLine(`exported ${format} → ${target.fsPath} (${bytes.length} bytes)`);

  const size = result.width && result.height ? ` (${result.width}×${result.height})` : '';
  const choice = await vscode.window.showInformationMessage(
    `NeoMermaid: exported ${format.toUpperCase()}${size}.`,
    'Open file',
    'Reveal in Explorer',
  );
  if (choice === 'Open file') {
    await vscode.commands.executeCommand('vscode.open', target);
  } else if (choice === 'Reveal in Explorer') {
    await vscode.commands.executeCommand('revealFileInOS', target);
  }
}

async function copySvg(context: vscode.ExtensionContext, document = targetDocument()): Promise<void> {
  if (!document) {
    noDocumentMessage();
    return;
  }
  const panel = PreviewPanel.createOrShow(context, document, vscode.ViewColumn.Beside);
  let result;
  try {
    result = await panel.requestCopySvg();
  } catch (error) {
    void vscode.window.showErrorMessage(`NeoMermaid: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!result.ok || !result.svg) {
    void vscode.window.showErrorMessage(`NeoMermaid: ${result.error ?? 'could not read the SVG.'}`);
    return;
  }
  await vscode.env.clipboard.writeText(result.svg);
  const kb = (Buffer.byteLength(result.svg, 'utf8') / 1024).toFixed(1);
  void vscode.window.showInformationMessage(`NeoMermaid: SVG copied to the clipboard (${kb} kB).`);
}

async function choosePreset(context: vscode.ExtensionContext): Promise<void> {
  const theme = await vscode.window.showQuickPick(
    listThemes().map((t) => ({ label: t.name, description: t.id, detail: t.description, id: t.id })),
    { title: 'NeoMermaid: theme', placeHolder: 'minimal, neon, tech, cartoon, glass, blueprint' },
  );
  if (!theme) return;

  const palette = await vscode.window.showQuickPick(
    listPalettes().map((p) => ({
      label: p.name,
      description: p.appearance,
      detail: `accent ${p.accent} · canvas ${p.bg}`,
      id: p.id,
    })),
    { title: `NeoMermaid: palette for ${theme.label}`, placeHolder: 'dracula, nord, github-light, …' },
  );
  if (!palette) return;

  const preset = `${theme.id}/${palette.id}`;
  const panel = previewFor(context, vscode.ViewColumn.Beside);
  panel?.setPreset(preset);

  const choice = await vscode.window.showInformationMessage(
    `NeoMermaid: preview switched to ${preset}.`,
    'Save as default',
  );
  if (choice === 'Save as default') {
    const state = panel?.currentState;
    await saveDefault({
      preset,
      background: state?.background ?? 'theme',
      padding: state?.padding ?? 16,
    });
    void vscode.window.showInformationMessage(`NeoMermaid: ${preset} is now the default.`);
  }
}

function refreshPreviewFor(document: vscode.TextDocument | undefined): void {
  for (const panel of PreviewPanel.all()) {
    if (!document || panel.documentUri.toString() === document.uri.toString()) {
      panel.syncFromConfiguration();
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('NeoMermaid');
  context.subscriptions.push(output);

  PreviewPanel.configure({
    context,
    output,
    onRendered: (panel, message) => {
      renders.set(panel.documentUri.toString(), message);
      updateStatusBar();
      if (!message.ok && message.error) {
        output.appendLine(`render error: ${message.error}`);
      }
    },
    // Toolbar buttons run the same code path as the commands, just scoped to the
    // panel's document instead of the active editor.
    onExportIntent: (panel, format) => {
      void exportDiagram(context, format, panel.textDocument);
    },
    onCopyIntent: (panel) => {
      void copySvg(context, panel.textDocument);
    },
  });

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  status.command = 'neomermaid.openPreviewToSide';
  context.subscriptions.push(status);

  function updateStatusBar(): void {
    const document = targetDocument();
    if (!document) {
      status.hide();
      return;
    }
    const panel = PreviewPanel.forDocument(document);
    const key = document.uri.toString();
    const render = panel ? renders.get(key) : undefined;
    const preset = panel?.currentState.preset ?? upcomingPreset();
    const size = render?.ok && render.width ? ` · ${render.width}×${render.height}` : '';
    status.text = `$(open-preview) ${preset}${size}`;
    status.tooltip = render && !render.ok ? `NeoMermaid render error: ${render.error}` : 'Open the NeoMermaid preview';
    status.show();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('neomermaid.openPreview', () => openPreview(context, vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('neomermaid.openPreviewToSide', () =>
      openPreview(context, vscode.ViewColumn.Beside),
    ),
    vscode.commands.registerCommand('neomermaid.exportPng', () => exportDiagram(context, 'png')),
    vscode.commands.registerCommand('neomermaid.exportSvg', () => exportDiagram(context, 'svg')),
    vscode.commands.registerCommand('neomermaid.copySvg', () => copySvg(context)),
    vscode.commands.registerCommand('neomermaid.choosePreset', () => choosePreset(context)),

    vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('neomermaid')) return;
      refreshPreviewFor(undefined);
      updateStatusBar();
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      refreshPreviewFor(undefined);
      updateStatusBar();
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (!isMermaidDocument(document)) return;
      const panel = PreviewPanel.forDocument(document);
      if (panel) {
        renders.delete(document.uri.toString());
        panel.dispose();
      }
      updateStatusBar();
    }),
  );

  updateStatusBar();
  output.appendLine('NeoMermaid activated.');
}

export function deactivate(): void {
  PreviewPanel.disposeAll();
}
