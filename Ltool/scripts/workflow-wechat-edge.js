#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ExtensionBridge } from '../src/bridge.js';
import { getConfig } from '../src/config.js';
import { CHROME_STATE_PATH, EDGE_STATE_PATH, launchChromeWithLtool, launchEdgeWithLtool, saveEdgeStorageState } from '../src/edge-ltool.js';
import { collectSyncDocs, formatDocSummary } from '../src/sync-doc.js';
import { runWechatDraftFlow } from '../recordings/wechat-cover.edge.js';

const args = parseArgs(process.argv.slice(2));
const docsDir = resolve(args.dir || 'C:/Users/Administrator/Documents/temp');
const timeoutMs = Number(args.timeout || 180000);
const browser = args.browser || process.env.LTOOL_WECHAT_BROWSER || 'edge';
const edgePort = Number(args.port || (browser === 'chrome' ? process.env.LTOOL_CHROME_WS_PORT : process.env.LTOOL_EDGE_WS_PORT) || process.env.LTOOL_EDGE_WS_PORT || 9528);
const keepEdgeOpen = Boolean(args['keep-edge-open']);
const withPlaywrightSave = Boolean(args['with-playwright-save']);
const publishQr = Boolean(args['publish-qr']);
const qrScreenshot = args['qr-screenshot'] || process.env.LTOOL_WECHAT_QR_SCREENSHOT || '';
const noCover = Boolean(args['no-cover']);
const minimal = Boolean(args.minimal);
const loginRetry = args['login-retry'] !== false && args['no-login-retry'] !== true;
const loginWaitMs = Number(args['login-wait-ms'] || process.env.LTOOL_WECHAT_LOGIN_WAIT_MS || 180000);
const author = args.author || process.env.LTOOL_WECHAT_AUTHOR;
const collection = args.collection || process.env.LTOOL_WECHAT_COLLECTION;

const docs = collectSyncDocs(docsDir);
if (!docs.length) throw new Error(`No supported documents found in ${docsDir}`);

const config = getConfig();
const bridge = new ExtensionBridge({
  port: edgePort,
  token: config.token,
  requestTimeoutMs: timeoutMs,
  clientName: 'Ltool Edge WeChat Workflow',
});

let edge;
try {
  await main();
} catch (error) {
  console.error(`ERROR wechat workflow: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (edge?.context) await saveEdgeStorageState(edge.context, browser === 'chrome' ? CHROME_STATE_PATH : EDGE_STATE_PATH).catch(() => {});
  await bridge.stop().catch(() => {});
  if (edge?.context && !keepEdgeOpen) await edge.context.close().catch(() => {});
}

async function main() {
  console.log(`Workflow: temp -> ${browserName()} Ltool extension -> WeChat API draft/cover`);
  console.log(`Docs: ${docsDir}`);
  console.log(`${browserName()} bridge port: ${edgePort}`);
  if (noCover) console.log('Cover: disabled for API draft A/B test');
  if (minimal) console.log('Article: using minimal API draft payload for A/B test');
  for (const doc of docs) console.log(formatDocSummary(doc));

  console.log('Starting Edge bridge...');
  await bridge.start();

  console.log(`Launching ${browserName()} with Ltool extension...`);
  edge = browser === 'chrome'
    ? await launchChromeWithLtool({ keepOpen: keepEdgeOpen, wsPort: edgePort })
    : await launchEdgeWithLtool({ keepOpen: keepEdgeOpen, wsPort: edgePort });

  console.log('Waiting for Edge extension connection...');
  await bridge.waitForConnection(timeoutMs);

  const batchId = createHash('sha1')
    .update(JSON.stringify({ docsDir, docs: docs.map((doc) => doc.filePath), platform: 'weixin', browser }))
    .digest('hex')
    .slice(0, 12);

  console.log('Creating WeChat draft through Edge extension API...');
  const result = await createDraftBatchWithLoginRetry({
    batchId,
    platforms: ['weixin'],
    publish: false,
    articles: docs.map((doc) => {
      const article = minimal
        ? { ...doc.article, title: `${doc.article.title.slice(0, 20)}-test`, html: '<p>test</p>', content: '<p>test</p>', text: 'test' }
        : doc.article;
      return noCover ? { ...article, cover: undefined, coverPath: undefined, coverSource: 'disabled' } : article;
    }),
  });

  console.log(`\nBatch: ${result.batchId || batchId}`);
  const successful = [];
  for (const item of result.results || []) {
    const ok = item.success ? 'OK' : 'FAIL';
    const link = item.postUrl ? ` ${item.postUrl}` : '';
    const error = item.error ? ` ${item.error}` : '';
    console.log(`${ok.padEnd(5)} ${item.platform.padEnd(12)} ${item.title || ''}${link}${error}`);
    if (item.success && item.platform === 'weixin' && item.postUrl) successful.push(item);
  }

  if (!successful.length) throw new Error('WeChat draft was not created; draft URL unavailable');

  console.log('\nWeChat draft URLs:');
  for (const item of successful) console.log(item.postUrl);

  if (withPlaywrightSave || publishQr) {
    console.log(`\nOpening draft URL in ${browserName()} for ${publishQr ? 'publish QR capture' : 'login verification and draft save'}:`);
    for (const item of successful) {
      const state = await runWechatDraftFlow({
        draftUrl: item.postUrl,
        context: edge.context,
        author,
        collection,
        saveDraft: true,
        publish: publishQr,
        screenshotPath: qrScreenshot,
      });
      if (state.qrScreenshot) console.log(`QR    weixin       ${item.title || ''} ${state.qrScreenshot}`);
      console.log(`OK    weixin       ${item.title || ''} ${state.url || item.postUrl}`);
    }
  } else {
    console.log('\nPlaywright page-save skipped. Pass --with-playwright-save or --publish-qr after the CLI upload path is verified.');
  }
}

async function createDraftBatchWithLoginRetry(payload) {
  const first = await bridge.request('syncArticleBatch', payload);
  if (!isLoginFailure(first) || !loginRetry) return first;

  console.log('\nWeChat login is missing or expired in the Edge profile.');
  console.log(`A ${browserName()} login tab has been opened. Finish WeChat login in that window; the CLI will retry automatically.`);

  const page = await edge.context.newPage();
  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await clickWechatLogin(page).catch(() => {});
  await waitForWechatAuth(loginWaitMs);
  await saveEdgeStorageState(edge.context, browser === 'chrome' ? CHROME_STATE_PATH : EDGE_STATE_PATH).catch(() => {});

  await page.close().catch(() => {});
  console.log('Retrying WeChat draft creation...');
  return await bridge.request('syncArticleBatch', payload);
}

async function waitForWechatAuth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const auth = await bridge.request('checkAuth', { platform: 'weixin' }).catch((error) => ({ isAuthenticated: false, error: error.message }));
    if (auth.isAuthenticated) {
      const user = auth.username || auth.userId || 'authenticated';
      console.log(`WeChat login detected: ${user}`);
      return auth;
    }
    await sleep(3000);
  }
  throw new Error(`WeChat login was not completed within ${timeoutMs}ms`);
}

async function clickWechatLogin(page) {
  const candidates = [
    page.getByRole('button', { name: /登录|Log in/i }).first(),
    page.getByText('登录', { exact: true }).first(),
    page.locator('a,button').filter({ hasText: /登录|Log in/i }).first(),
  ];
  for (const locator of candidates) {
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserName() {
  return browser === 'chrome' ? 'Chrome' : 'Edge';
}

function isLoginFailure(result) {
  const items = result?.results || [];
  return items.length > 0 && items.every((item) => !item.success && /not logged in|login|\u767b\u5f55|token/i.test(item.error || ''));
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
