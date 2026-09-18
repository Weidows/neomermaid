import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * Browser discovery. NeoMermaid renders in a real browser engine (that is the
 * only way to get mermaid's text measurement right), but it does **not** ship
 * one: on any normal machine Chrome, Edge, Brave or Chromium is already there.
 */

export interface BrowserCandidate {
  path: string;
  name: string;
}

const WINDOWS_ROOTS = [
  process.env['PROGRAMFILES'] ?? 'C:/Program Files',
  process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)',
  process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData/Local'),
];

const WINDOWS_BROWSERS: Array<[string, string]> = [
  ['Microsoft/Edge/Application/msedge.exe', 'Microsoft Edge'],
  ['Google/Chrome/Application/chrome.exe', 'Google Chrome'],
  ['Google/Chrome Beta/Application/chrome.exe', 'Google Chrome Beta'],
  ['BraveSoftware/Brave-Browser/Application/brave.exe', 'Brave'],
  ['Chromium/Application/chrome.exe', 'Chromium'],
  ['Vivaldi/Application/vivaldi.exe', 'Vivaldi'],
  ['Yandex/YandexBrowser/Application/browser.exe', 'Yandex Browser'],
];

const MAC_BROWSERS: Array<[string, string]> = [
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Google Chrome'],
  ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Microsoft Edge'],
  ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', 'Brave'],
  ['/Applications/Chromium.app/Contents/MacOS/Chromium', 'Chromium'],
  ['/Applications/Vivaldi.app/Contents/MacOS/Vivaldi', 'Vivaldi'],
];

const LINUX_BINARIES: Array<[string, string]> = [
  ['/usr/bin/google-chrome', 'Google Chrome'],
  ['/usr/bin/google-chrome-stable', 'Google Chrome'],
  ['/usr/bin/microsoft-edge', 'Microsoft Edge'],
  ['/usr/bin/chromium', 'Chromium'],
  ['/usr/bin/chromium-browser', 'Chromium'],
  ['/usr/bin/brave-browser', 'Brave'],
  ['/snap/bin/chromium', 'Chromium'],
];

/** Chromium builds that puppeteer/playwright may have cached locally. */
function cachedBrowsers(): BrowserCandidate[] {
  const home = homedir();
  const roots = [
    join(home, '.cache', 'puppeteer', 'chrome'),
    join(home, '.cache', 'puppeteer', 'chrome-headless-shell'),
    join(home, 'Library', 'Caches', 'ms-playwright'),
    join(home, '.cache', 'ms-playwright'),
    join(home, 'AppData', 'Local', 'ms-playwright'),
  ];
  const out: BrowserCandidate[] = [];
  const exeNames =
    platform() === 'win32'
      ? ['chrome.exe', 'chrome-headless-shell.exe', 'msedge.exe']
      : ['chrome', 'chrome-headless-shell', 'Chromium'];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(root, entry);
      for (const name of exeNames) {
        const direct = join(dir, name);
        if (existsSync(direct)) out.push({ path: direct, name: 'Cached Chromium' });
        const nested = join(dir, 'chrome-win64', name);
        if (existsSync(nested)) out.push({ path: nested, name: 'Cached Chromium' });
        const macNested = join(dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', name);
        if (existsSync(macNested)) out.push({ path: macNested, name: 'Cached Chromium' });
      }
    }
  }
  return out;
}

export function findBrowsers(): BrowserCandidate[] {
  const found: BrowserCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: BrowserCandidate) => {
    if (!candidate.path || seen.has(candidate.path)) return;
    try {
      if (!statSync(candidate.path).isFile()) return;
    } catch {
      return;
    }
    seen.add(candidate.path);
    found.push(candidate);
  };

  const fromEnv = process.env['NEOMERMAID_BROWSER'] ?? process.env['CHROME_PATH'] ?? process.env['PUPPETEER_EXECUTABLE_PATH'];
  if (fromEnv) add({ path: fromEnv, name: 'From environment' });

  if (platform() === 'win32') {
    for (const root of WINDOWS_ROOTS) {
      for (const [suffix, name] of WINDOWS_BROWSERS) {
        add({ path: join(root, suffix).replace(/\\/g, '/'), name });
      }
    }
  } else if (platform() === 'darwin') {
    for (const [path, name] of MAC_BROWSERS) add({ path, name });
  } else {
    for (const [path, name] of LINUX_BINARIES) add({ path, name });
  }

  for (const candidate of cachedBrowsers()) add(candidate);
  return found;
}

export function resolveBrowserPath(explicit?: string): BrowserCandidate {
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`Browser not found at --browser ${explicit}`);
    }
    return { path: explicit, name: 'Explicit' };
  }
  const candidates = findBrowsers();
  const first = candidates[0];
  if (!first) {
    throw new Error(
      [
        'No Chromium-based browser found.',
        'NeoMermaid needs Chrome, Edge, Brave or Chromium to measure text correctly.',
        'Install one, or point at it explicitly:',
        '  neomermaid render in.mmd -o out.png --browser "C:/path/to/msedge.exe"',
        '  NEOMERMAID_BROWSER=/path/to/chrome neomermaid render in.mmd -o out.png',
      ].join('\n'),
    );
  }
  return first;
}
