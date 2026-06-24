import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getConfig } from './config.js';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const EDGE_PROFILE_DIR = resolve(PROJECT_ROOT, '.playwright/ltool-edge-profile');
export const EDGE_EXTENSION_DIR = resolve(PROJECT_ROOT, 'Ltool/extension');
export const EDGE_STATE_PATH = resolve(PROJECT_ROOT, '.playwright/ltool-edge-state.json');
export const EDGE_DEFAULT_WS_PORT = 9528;

export async function launchEdgeWithLtool({
  userDataDir = process.env.LTOOL_EDGE_USER_DATA_DIR || EDGE_PROFILE_DIR,
  extensionDir = process.env.LTOOL_EDGE_EXTENSION_DIR || EDGE_EXTENSION_DIR,
  wsPort = Number(process.env.LTOOL_EDGE_WS_PORT || EDGE_DEFAULT_WS_PORT),
  restoreLocalStorage = false,
  headless = false,
  keepOpen = false,
} = {}) {
  mkdirSync(resolve(userDataDir), { recursive: true });
  const extensionPath = resolve(extensionDir);
  const context = await chromium.launchPersistentContext(resolve(userDataDir), {
    channel: 'msedge',
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-blink-features=AutomationControlled',
    ],
  });
  await restoreEdgeStorageState(context, EDGE_STATE_PATH, { restoreLocalStorage });
  const worker = await waitForLtoolWorker(context);
  await seedLtoolSettings(worker, { wsPort });
  return { context, worker, keepOpen };
}

export async function waitForLtoolWorker(context, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const worker = context.serviceWorkers().find((item) => item.url().endsWith('/background.js'));
    if (worker) return worker;
    try {
      const worker = await context.waitForEvent('serviceworker', { timeout: 1000 });
      if (worker.url().endsWith('/background.js')) return worker;
    } catch {}
  }
  throw new Error('Ltool Edge extension service worker not found');
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
