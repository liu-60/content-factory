import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getConfig } from './config.js';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const EDGE_PROFILE_DIR = resolve(PROJECT_ROOT, '.playwright/ltool-edge-profile');
export const CHROME_PROFILE_DIR = resolve(PROJECT_ROOT, '.playwright/ltool-chrome-profile');
export const EDGE_EXTENSION_DIR = resolve(PROJECT_ROOT, 'Ltool/extension');
export const EDGE_STATE_PATH = resolve(PROJECT_ROOT, '.playwright/ltool-edge-state.json');
export const CHROME_STATE_PATH = resolve(PROJECT_ROOT, '.playwright/ltool-chrome-state.json');
export const EDGE_DEFAULT_WS_PORT = 9528;

export async function launchEdgeWithLtool({
  userDataDir = process.env.LTOOL_EDGE_USER_DATA_DIR || EDGE_PROFILE_DIR,
  extensionDir = process.env.LTOOL_EDGE_EXTENSION_DIR || EDGE_EXTENSION_DIR,
  wsPort = Number(process.env.LTOOL_EDGE_WS_PORT || EDGE_DEFAULT_WS_PORT),
  channel = 'msedge',
  executablePath,
  statePath = EDGE_STATE_PATH,
  restoreLocalStorage = false,
  restoreState = process.env.LTOOL_EDGE_RESTORE_STATE === 'true',
  reloadExtension = process.env.LTOOL_EDGE_RELOAD_EXTENSION !== 'false',
  headless = false,
  keepOpen = false,
} = {}) {
  mkdirSync(resolve(userDataDir), { recursive: true });
  const extensionPath = resolve(extensionDir);
  const context = await chromium.launchPersistentContext(resolve(userDataDir), {
    ...(executablePath ? { executablePath } : { channel }),
    headless,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-blink-features=AutomationControlled',
    ],
  });
  if (restoreState) await restoreEdgeStorageState(context, statePath, { restoreLocalStorage });
  let worker = await waitForLtoolWorker(context);
  if (reloadExtension) {
    await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await sleep(1500);
    worker = await waitForLtoolWorker(context);
  }
  await seedLtoolSettings(worker, { wsPort }).catch(async (error) => {
    if (!/Service worker restarted/i.test(error.message || '')) throw error;
    await sleep(1500);
    worker = await waitForLtoolWorker(context);
    await seedLtoolSettings(worker, { wsPort });
  });
  return { context, worker, keepOpen };
}

export async function launchChromeWithLtool(options = {}) {
  return await launchEdgeWithLtool({
    userDataDir: process.env.LTOOL_CHROME_USER_DATA_DIR || CHROME_PROFILE_DIR,
    extensionDir: process.env.LTOOL_CHROME_EXTENSION_DIR || process.env.LTOOL_EDGE_EXTENSION_DIR || EDGE_EXTENSION_DIR,
    wsPort: Number(process.env.LTOOL_CHROME_WS_PORT || process.env.LTOOL_EDGE_WS_PORT || EDGE_DEFAULT_WS_PORT),
    channel: process.env.LTOOL_GOOGLE_CHROME === 'true' ? 'chrome' : undefined,
    executablePath: process.env.LTOOL_GOOGLE_CHROME === 'true' ? undefined : resolveChromiumExecutable(),
    statePath: CHROME_STATE_PATH,
    restoreState: process.env.LTOOL_CHROME_RESTORE_STATE === 'true',
    reloadExtension: process.env.LTOOL_CHROME_RELOAD_EXTENSION === 'true',
    ...options,
  });
}

function resolveChromiumExecutable() {
  const preferred = chromium.executablePath();
  if (existsSync(preferred)) return preferred;
  const root = resolve(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!existsSync(root)) return preferred;
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
    .map((entry) => resolve(root, entry.name, 'chrome-win64', 'chrome.exe'))
    .filter((file) => existsSync(file))
    .sort()
    .reverse();
  return candidates[0] || preferred;
}

export async function waitForLtoolWorker(context, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      if (await isLtoolWorker(worker)) return worker;
    }
    try {
      const worker = await context.waitForEvent('serviceworker', { timeout: 1000 });
      if (await isLtoolWorker(worker)) return worker;
    } catch {}
  }
  throw new Error('Ltool Edge extension service worker not found');
}

async function isLtoolWorker(worker) {
  if (!/^chrome-extension:\/\//.test(worker.url())) return false;
  try {
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    return manifest?.name === 'Ltool Sync Bridge';
  } catch {
    return false;
  }
}

export async function seedLtoolSettings(worker, { wsPort = EDGE_DEFAULT_WS_PORT } = {}) {
  const config = getConfig();
  await worker.evaluate(async ({ token, wsPort }) => {
    await chrome.storage.local.set({
      token,
      wsUrl: `ws://localhost:${wsPort}`,
      enabled: true,
    });
  }, { token: config.token, wsPort });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function saveEdgeStorageState(context, statePath = EDGE_STATE_PATH) {
  mkdirSync(dirname(statePath), { recursive: true });
  await context.storageState({ path: statePath });
  return statePath;
}

export async function restoreEdgeStorageState(context, statePath = EDGE_STATE_PATH, { restoreLocalStorage = false } = {}) {
  if (!existsSync(statePath)) return false;
  let state;
  try {
    state = JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return false;
  }
  if (Array.isArray(state.cookies) && state.cookies.length) {
    await context.addCookies(state.cookies).catch(() => {});
  }
  if (restoreLocalStorage && Array.isArray(state.origins)) {
    for (const origin of state.origins) {
      if (!origin.origin || !Array.isArray(origin.localStorage) || !origin.localStorage.length) continue;
      const page = await context.newPage();
      try {
        await page.goto(origin.origin, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.evaluate((entries) => {
          for (const entry of entries) localStorage.setItem(entry.name, entry.value);
        }, origin.localStorage).catch(() => {});
      } finally {
        await page.close().catch(() => {});
      }
    }
  }
  return true;
}
