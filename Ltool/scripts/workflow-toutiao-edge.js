#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ExtensionBridge } from '../src/bridge.js';
import { getConfig } from '../src/config.js';
import { launchEdgeWithLtool, saveEdgeStorageState } from '../src/edge-ltool.js';
import { collectSyncDocs, formatDocSummary } from '../src/sync-doc.js';
import { runToutiaoCoverFlow } from '../recordings/toutiao-cover.edge.js';

const args = parseArgs(process.argv.slice(2));
const docsDir = resolve(args.dir || 'C:/Users/Administrator/Documents/temp');
const timeoutMs = Number(args.timeout || 180000);
const edgePort = Number(args.port || process.env.LTOOL_EDGE_WS_PORT || 9528);
const skipCover = Boolean(args['skip-cover']);
const keepEdgeOpen = Boolean(args['keep-edge-open']);

const docs = collectSyncDocs(docsDir);
if (!docs.length) throw new Error(`No supported documents found in ${docsDir}`);

console.log('Workflow: temp -> Edge Ltool extension -> Toutiao draft -> Edge cover/publish script');
console.log(`Docs: ${docsDir}`);
console.log(`Edge bridge port: ${edgePort}`);
for (const doc of docs) console.log(formatDocSummary(doc));

const config = getConfig();
const bridge = new ExtensionBridge({
  port: edgePort,
  token: config.token,
  requestTimeoutMs: timeoutMs,
  clientName: 'Ltool Edge Toutiao Workflow',
});

let edge;
try {
  console.log('Starting Edge bridge...');
  await bridge.start();

  console.log('Launching Edge with Ltool extension...');
  edge = await launchEdgeWithLtool({ keepOpen: keepEdgeOpen, wsPort: edgePort });

  console.log('Waiting for Edge extension connection...');
  await bridge.waitForConnection(timeoutMs);

  const batchId = createHash('sha1')
    .update(JSON.stringify({ docsDir, docs: docs.map((doc) => doc.filePath), platform: 'toutiao', browser: 'edge' }))
    .digest('hex')
    .slice(0, 12);

  console.log('Creating Toutiao draft through extension API...');
  const result = await bridge.request('syncArticleBatch', {
    batchId,
    platforms: ['toutiao'],
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
    if (item.success && item.platform === 'toutiao' && item.postUrl) successful.push(item);
  }

  if (!successful.length) throw new Error('Toutiao draft was not created; cover/publish skipped');
  if (!skipCover) {
    console.log('\nOpening draft URL in Edge for cover upload, preview, and publish:');
    for (const item of successful) {
      const doc = docs.find((candidate) => candidate.article.title === item.title);
      if (!doc?.coverPath) {
        console.log(`SKIP  toutiao      ${item.title || ''} no cover image`);
        continue;
      }
      const publishState = await runToutiaoCoverFlow({
        draftUrl: item.postUrl,
        coverPath: doc.coverPath,
        context: edge.context,
        publish: true,
      });
      const status = publishState.publishStatus ? ` status=${publishState.publishStatus}` : '';
      console.log(`OK    toutiao      ${item.title || ''} ${publishState.url || item.postUrl}${status}`);
    }
  }
} finally {
  if (edge?.context) await saveEdgeStorageState(edge.context).catch(() => {});
  await bridge.stop().catch(() => {});
  if (edge?.context && !keepEdgeOpen) await edge.context.close().catch(() => {});
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
