/**
 * The message contract between the extension host and the preview webview.
 *
 * Both bundles (dist/extension.cjs, dist/webview.js) import this file, so the
 * shape of a message can never drift between the two sides. Everything that is
 * only a type is imported through `import type` — the repo runs with
 * `verbatimModuleSyntax`.
 *
 * Trust model: the webview is a separate context, so *every* inbound message is
 * checked with the guards at the bottom before it is acted on.
 */

/** Id of the element the webview mounts into — also used by the smoke test. */
export const WEBVIEW_ROOT_ID = 'neomermaid-root';

/** `WebviewPanel.viewType`. */
export const VIEW_TYPE = 'neomermaid.preview';

/**
 * Placeholders inside `media/webview.html`. The extension replaces them when it
 * builds the document; `scripts/webview-smoke.mjs` asserts that both the
 * template and the built extension still contain exactly these tokens, so a
 * rename on either side fails the smoke test instead of shipping a blank panel.
 */
export const TEMPLATE_TOKENS = ['{{csp}}', '{{nonce}}', '{{styleUri}}', '{{scriptUri}}'] as const;

export type Appearance = 'light' | 'dark';

export type ExportFormat = 'png' | 'svg';

/** Everything that describes *what* the preview shows, minus the diagram text. */
export interface PreviewState {
  /** `<theme>/<palette>`, e.g. `neon/dracula`. */
  preset: string;
  /** `theme`, `transparent`, or any CSS colour. */
  background: string;
  /** Canvas padding in px. */
  padding: number;
  /** Raster scale factor for PNG export. */
  exportScale: number;
  /** 1 = 100%. */
  zoom: number;
  fitToWidth: boolean;
}

export interface ThemeOption {
  id: string;
  name: string;
  description: string;
  appearance: Appearance | 'inherit';
}

export interface PaletteOption {
  id: string;
  name: string;
  appearance: Appearance;
  accent: string;
  bg: string;
}

/** Theme + palette lists for the toolbar pickers. */
export interface Catalog {
  themes: ThemeOption[];
  palettes: PaletteOption[];
  presets: string[];
}

/* ------------------------------------------------------------ host → webview */

export interface InitMessage {
  type: 'init';
  source: string;
  /** Shown in the status line; usually the file name. */
  documentLabel: string;
  state: PreviewState;
  /** Appearance the host wants the chrome to use (follows the VS Code theme). */
  appearance: Appearance;
  liveUpdateDelay: number;
  /**
   * Optional: when omitted the webview builds the catalog from the core bundle
   * it already ships, which keeps the two sides from disagreeing about presets.
   */
  catalog?: Catalog;
}

export interface UpdateMessage {
  type: 'update';
  source: string;
}

/** Host-driven state change (settings changed, preset picked from the palette). */
export interface SetStateMessage {
  type: 'setState';
  state: Partial<PreviewState>;
  /** Which appearance the chrome should switch to, if it changed. */
  appearance?: Appearance;
}

export interface ExportRequestMessage {
  type: 'exportRequest';
  requestId: string;
  format: ExportFormat;
}

export interface CopySvgRequestMessage {
  type: 'copySvgRequest';
  requestId: string;
}

export type HostToWebviewMessage =
  | InitMessage
  | UpdateMessage
  | SetStateMessage
  | ExportRequestMessage
  | CopySvgRequestMessage;

/* ------------------------------------------------------------ webview → host */

export interface ReadyMessage {
  type: 'ready';
}

export interface RenderMessage {
  type: 'rendered';
  ok: boolean;
  durationMs: number;
  width?: number;
  height?: number;
  theme?: string;
  palette?: string;
  preset?: string;
  appearance?: Appearance;
  warnings?: string[];
  error?: string;
}

export interface StateChangedMessage {
  type: 'stateChanged';
  state: PreviewState;
  /** `user` = clicked in the toolbar, `init` = applied the host's state. */
  reason: 'user' | 'init';
}

export interface SaveDefaultMessage {
  type: 'saveDefault';
  preset: string;
  background: string;
  padding: number;
}

/**
 * The toolbar cannot open a save dialog or touch the clipboard, so it asks the
 * host to run the same code path as the "Export as …" commands.
 */
export interface ExportIntentMessage {
  type: 'exportIntent';
  format: ExportFormat;
}

export interface CopyIntentMessage {
  type: 'copyIntent';
}

export interface ExportResultMessage {
  type: 'exportResult';
  requestId: string;
  format: ExportFormat;
  ok: boolean;
  /** PNG payload, base64. */
  base64?: string;
  /** SVG payload, as text. */
  svg?: string;
  width?: number;
  height?: number;
  /**
   * How many sampled pixels of the raster were not fully transparent. A blank
   * render still produces a valid PNG, so the host (and the smoke test) can tell
   * "exported an image" from "exported an empty image".
   */
  opaqueSamples?: number;
  error?: string;
}

export interface CopySvgResultMessage {
  type: 'copySvgResult';
  requestId: string;
  ok: boolean;
  svg?: string;
  error?: string;
}

export interface LogMessage {
  type: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type WebviewToHostMessage =
  | ReadyMessage
  | RenderMessage
  | StateChangedMessage
  | SaveDefaultMessage
  | ExportIntentMessage
  | CopyIntentMessage
  | ExportResultMessage
  | CopySvgResultMessage
  | LogMessage;

/* -------------------------------------------------------------- message guards */

const HOST_MESSAGE_TYPES = new Set<string>([
  'init',
  'update',
  'setState',
  'exportRequest',
  'copySvgRequest',
]);

const WEBVIEW_MESSAGE_TYPES = new Set<string>([
  'ready',
  'rendered',
  'stateChanged',
  'saveDefault',
  'exportIntent',
  'copyIntent',
  'exportResult',
  'copySvgResult',
  'log',
]);

function hasType(value: unknown, allowed: Set<string>): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && allowed.has(type);
}

export function isHostToWebviewMessage(value: unknown): value is HostToWebviewMessage {
  return hasType(value, HOST_MESSAGE_TYPES);
}

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  return hasType(value, WEBVIEW_MESSAGE_TYPES);
}
