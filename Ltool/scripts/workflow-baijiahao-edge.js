#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { ExtensionBridge } from '../src/bridge.js';
import { getConfig } from '../src/config.js';
import { launchEdgeWithLtool, saveEdgeStorageState } from '../src/edge-ltool.js';
import { collectSyncDocs, formatDocSummary } from '../src/sync-doc.js';
import { runBaijiahaoCoverFlow } from '../recordings/baijiahao-cover.edge.js';

const args = parseArgs(process.argv.slice(2));
const docsDir = resolve(args.dir || 'C:/Users/Administrator/Documents/temp');
const timeoutMs = Number(args.timeout || 180000);
const edgePort = Number(args.port || process.env.LTOOL_EDGE_WS_PORT || 9528);
const skipCover = Boolean(args['skip-cover']);
const keepEdgeOpen = Boolean(args['keep-edge-open']);
const loginRetry = args['login-retry'] !== false && args['no-login-retry'] !== true;
const schedulePublish = Boolean(args['schedule-publish']);

const docs = collectSyncDocs(docsDir);
if (!docs.length) throw new Error(`No supported documents found in ${docsDir}`);

const config = getConfig();
const bridge = new ExtensionBridge({
  port: edgePort,
  token: config.token,
  requestTimeoutMs: timeoutMs,
  clientName: 'Ltool Edge Baijiahao Workflow',
});

let edge;
try {
  await main();
} catch (error) {
  console.error(`ERROR baijiahao workflow: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (edge?.context) await saveEdgeStorageState(edge.context).catch(() => {});
  await bridge.stop().catch(() => {});
  if (edge?.context && !keepEdgeOpen) await edge.context.close().catch(() => {});
}

async function main() {
  console.log('Workflow: temp -> Edge Ltool extension -> Baijiahao draft -> Edge cover/publish script');
  console.log(`Docs: ${docsDir}`);
  console.log(`Edge bridge port: ${edgePort}`);
  for (const doc of docs) console.log(formatDocSummary(doc));

  console.log('Starting Edge bridge...');
  await bridge.start();

  console.log('Launching Edge with Ltool extension...');
  edge = await launchEdgeWithLtool({ keepOpen: keepEdgeOpen, wsPort: edgePort });

  console.log('Waiting for Edge extension connection...');
  await bridge.waitForConnection(timeoutMs);

  const batchId = createHash('sha1')
    .update(JSON.stringify({ docsDir, docs: docs.map((doc) => doc.filePath), platform: 'baijiahao', browser: 'edge' }))
    .digest('hex')
    .slice(0, 12);

  console.log('Creating Baijiahao draft through extension API...');
  const result = await createDraftBatchWithLoginRetry({
    batchId,
    platforms: ['baijiahao'],
    publish: false,
    articles: docs.map((doc) => doc.article),
  });

  console.log(`\nBatch: ${result.batchId || batchId}`);
  const successful = [];
  for (const item of result.results || []) {
    const ok = item.success ? 'OK' : 'FAIL';
    const link = item.postUrl ? ` ${item.postUrl}` : '';
    const error = item.error ? ` ${item.error}` : '';
    console.log(`${ok.padEnd(5)} ${item.platform.padEnd(12)} ${item.title || ''}${link}${error}`);
    if (item.success && item.platform === 'baijiahao' && item.postUrl) successful.push(item);
  }

  if (!successful.length) throw new Error('Baijiahao draft was not created; cover step skipped');
  if (!skipCover) {
    console.log('\nOpening draft URL in Edge for cover setup and draft save:');
    for (const item of successful) {
      const doc = docs.find((candidate) => candidate.article.title === item.title);
      if (!doc?.coverPath) {
        console.log(`SKIP  baijiahao  ${item.title || ''} no cover image`);
        continue;
      }
      const state = await runBaijiahaoCoverFlow({
        draftUrl: item.postUrl,
        coverPath: doc.coverPath,
        context: edge.context,
        schedulePublish,
      });
      console.log(`OK    baijiahao  ${item.title || ''} ${state.url || item.postUrl}`);
    }
  }
}

async function createDraftBatchWithLoginRetry(payload) {
  const first = await bridge.request('syncArticleBatch', payload);
  if (!isLoginFailure(first) || !loginRetry) return first;

  console.log('\nBaijiahao login is missing or expired in the Edge profile.');
  console.log('An Edge login tab has been opened. Finish Baijiahao login in that window, then return here.');

  if (!input.isTTY) {
    throw new Error('Baijiahao is not logged in. Run `npm run edge:ltool -- --platform baijiahao` first, then retry this workflow.');
  }

  const rl = createInterface({ input, output });
  try {
    await rl.question('Press Enter after Baijiahao login to retry draft creation...');
  } finally {
    rl.close();
  }

  await saveEdgeStorageState(edge.context).catch(() => {});
  console.log('Retrying Baijiahao draft creation...');
  return await bridge.request('syncArticleBatch', payload);
}

function isLoginFailure(result) {
  const items = result?.results || [];
  return items.length > 0 && items.every((item) => !item.success && /not logged in|login|登录/i.test(item.error || ''));
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
