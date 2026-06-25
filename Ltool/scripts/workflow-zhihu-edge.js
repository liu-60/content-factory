#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ExtensionBridge } from '../src/bridge.js';
import { getConfig } from '../src/config.js';
import { CHROME_STATE_PATH, EDGE_STATE_PATH, launchEdgeWithLtool, launchChromeWithLtool, saveEdgeStorageState } from '../src/edge-ltool.js';
import { collectSyncDocs, formatDocSummary } from '../src/sync-doc.js';
import { runZhihuCoverFlow } from '../recordings/zhihu-cover.js';

const args = parseArgs(process.argv.slice(2));
const docsDir = resolve(args.dir || 'C:/Users/Administrator/Documents/temp');
const timeoutMs = Number(args.timeout || 240000);
const edgePort = Number(args.port || process.env.LTOOL_EDGE_WS_PORT || 9528);
const skipCover = Boolean(args['skip-cover']);
const keepOpen = Boolean(args['keep-edge-open']);
const browser = args.browser || process.env.LTOOL_ZHIHU_BROWSER || 'edge';
const loginRetry = args['login-retry'] !== false && args['no-login-retry'] !== true;
const loginWaitMs = Number(args['login-wait-ms'] || process.env.LTOOL_ZHIHU_LOGIN_WAIT_MS || 180000);

const docs = collectSyncDocs(docsDir);
if (!docs.length) throw new Error(`No supported documents found in ${docsDir}`);

console.log('Workflow: temp -> Edge/Chrome Ltool extension -> Zhihu draft -> cover/publish');
console.log(`Docs: ${docsDir}`);
console.log(`Bridge port: ${edgePort}`);
console.log(`Browser preference: ${browser}`);
for (const doc of docs) console.log(formatDocSummary(doc));

const config = getConfig();
const bridge = new ExtensionBridge({
  port: edgePort,
  token: config.token,
  requestTimeoutMs: timeoutMs,
  clientName: 'Ltool Zhihu Workflow',
});

let browserInstance;
let launchChannel = browser;
try {
  console.log('Starting bridge...');
  await bridge.start();

  browserInstance = await launchBrowserWithFallback(browser, { keepOpen, wsPort: edgePort });
  launchChannel = browserInstance._channel;

  console.log(`Waiting for ${launchChannel} extension connection...`);
  await bridge.waitForConnection(timeoutMs);

  const batchId = createHash('sha1')
    .update(JSON.stringify({ docsDir, docs: docs.map((doc) => doc.filePath), platform: 'zhihu', browser: launchChannel }))
    .digest('hex')
    .slice(0, 12);

  const payload = {
    batchId,
    platforms: ['zhihu'],
    publish: false,
    articles: docs.map((doc) => doc.article),
  };

  console.log('Creating Zhihu draft through extension API...');
  const result = await createDraftBatchWithLoginRetry(payload);

  console.log(`\nBatch: ${result.batchId || batchId}`);
  const successful = [];
  for (const item of result.results || []) {
    const ok = item.success ? 'OK' : 'FAIL';
    const link = item.postUrl ? ` ${item.postUrl}` : '';
    const error = item.error ? ` ${item.error}` : '';
    console.log(`${ok.padEnd(5)} ${item.platform.padEnd(12)} ${item.title || ''}${link}${error}`);
    if (item.success && item.platform === 'zhihu' && item.postUrl) successful.push(item);
  }

  if (!successful.length) throw new Error('Zhihu draft was not created; cover/publish skipped');

  if (!skipCover) {
    console.log(`\nOpening draft URL in ${browserName()} for cover upload and publish:`);
    for (const item of successful) {
      const doc = docs.find((candidate) => candidate.article.title === item.title);
      if (!doc?.coverPath) {
        console.log(`SKIP  zhihu        ${item.title || ''} no cover image`);
        continue;
      }
      const publishState = await runZhihuCoverFlow({
        draftUrl: item.postUrl,
        coverPath: doc.coverPath,
        context: browserInstance.context,
        publish: true,
      });
      const status = publishState.publishStatus ? ` status=${publishState.publishStatus}` : '';
      const finalUrl = publishState.url || item.postUrl;
      console.log(`OK    zhihu        ${item.title || ''} ${finalUrl}${status}`);
      item._finalUrl = finalUrl;
      item._publishStatus = publishState.publishStatus;
    }
  }

  console.log('\n=== Summary ===');
  for (const item of successful) {
    console.log(`  ${item.title}`);
    console.log(`  Draft:  ${item.postUrl}`);
    if (item._finalUrl) console.log(`  Final:  ${item._finalUrl}`);
    if (item._publishStatus) console.log(`  Status: ${item._publishStatus}`);
  }
} catch (error) {
  console.error(`ERROR zhihu workflow: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (browserInstance?.context) {
    const statePath = launchChannel === 'chrome' ? CHROME_STATE_PATH : EDGE_STATE_PATH;
    await saveEdgeStorageState(browserInstance.context, statePath).catch(() => {});
  }
  await bridge.stop().catch(() => {});
  if (browserInstance?.context && !keepOpen) await browserInstance.context.close().catch(() => {});
}

async function createDraftBatchWithLoginRetry(payload) {
  const first = await bridge.request('syncArticleBatch', payload);
  if (!isLoginFailure(first) || !loginRetry) return first;

  console.log('\nZhihu login is missing or expired in the browser profile.');
  console.log(`A ${browserName()} login tab has been opened. Finish Zhihu login in that window; the CLI will retry automatically.`);

  const page = await browserInstance.context.newPage();
  await page.goto('https://www.zhihu.com/signin', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await waitForZhihuAuth(loginWaitMs);
  const statePath = launchChannel === 'chrome' ? CHROME_STATE_PATH : EDGE_STATE_PATH;
  await saveEdgeStorageState(browserInstance.context, statePath).catch(() => {});
  await page.close().catch(() => {});

  console.log('Retrying Zhihu draft creation...');
  return await bridge.request('syncArticleBatch', payload);
}

async function waitForZhihuAuth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const auth = await bridge.request('checkAuth', { platform: 'zhihu' }).catch((error) => ({ isAuthenticated: false, error: error.message }));
    if (auth.isAuthenticated) {
      const user = auth.username || auth.userId || 'authenticated';
      console.log(`Zhihu login detected: ${user}`);
      return auth;
    }
    await sleep(3000);
  }
  throw new Error(`Zhihu login was not completed within ${timeoutMs}ms`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserName() {
  return launchChannel === 'chrome' ? 'Chrome' : 'Edge';
}

function isLoginFailure(result) {
  const items = result?.results || [];
  return items.length > 0 && items.every((item) => !item.success && /not logged in|login|登录|token/i.test(item.error || ''));
}

async function launchBrowserWithFallback(preferredBrowser, { keepOpen, wsPort }) {
  if (preferredBrowser === 'chrome') {
    console.log('Launching Chrome with Ltool extension...');
    try {
      const chrome = await launchChromeWithLtool({ keepOpen, wsPort });
      chrome._channel = 'chrome';
      return chrome;
    } catch (error) {
      throw new Error(`Chrome launch failed: ${error.message}`);
    }
  }

  console.log('Launching Edge with Ltool extension...');
  try {
    const edge = await launchEdgeWithLtool({ keepOpen, wsPort });
    edge._channel = 'edge';
    return edge;
  } catch (edgeError) {
    console.log(`Edge launch failed: ${edgeError.message}`);
    console.log('Falling back to Chrome...');
    try {
      const chrome = await launchChromeWithLtool({ keepOpen, wsPort });
      chrome._channel = 'chrome';
      return chrome;
    } catch (chromeError) {
      throw new Error(`Both Edge and Chrome failed.\n  Edge: ${edgeError.message}\n  Chrome: ${chromeError.message}`);
    }
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
