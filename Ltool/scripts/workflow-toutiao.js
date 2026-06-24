#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { ExtensionBridge } from '../src/bridge.js';
import { getConfig } from '../src/config.js';
import { collectSyncDocs, formatDocSummary } from '../src/sync-doc.js';

const args = parseArgs(process.argv.slice(2));
const docsDir = resolve(args.dir || 'C:/Users/Administrator/Documents/temp');
const timeoutMs = Number(args.timeout || 180000);
const skipCover = Boolean(args['skip-cover']);

const docs = collectSyncDocs(docsDir);
if (!docs.length) throw new Error(`No supported documents found in ${docsDir}`);

console.log(`Workflow: temp -> Chrome extension -> Toutiao draft -> recorded Playwright cover script`);
console.log(`Docs: ${docsDir}`);
for (const doc of docs) console.log(formatDocSummary(doc));

const config = getConfig();
const bridge = new ExtensionBridge({
  port: config.wsPort,
  token: config.token,
  requestTimeoutMs: config.requestTimeoutMs,
  clientName: 'Ltool Toutiao Workflow',
});

await bridge.start();
try {
  await bridge.waitForConnection(timeoutMs);
  const batchId = createHash('sha1')
    .update(JSON.stringify({ docsDir, docs: docs.map((doc) => doc.filePath), platform: 'toutiao' }))
    .digest('hex')
    .slice(0, 12);
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

  if (!successful.length) throw new Error('Toutiao draft was not created; cover upload skipped');
  if (!skipCover) {
    console.log('\nCover upload via recorded Playwright script:');
    for (const item of successful) {
      const doc = docs.find((candidate) => candidate.article.title === item.title);
      if (!doc?.coverPath) {
        console.log(`SKIP  toutiao      ${item.title || ''} no cover image`);
        continue;
      }
      await runToutiaoCoverScript({ draftUrl: item.postUrl, coverPath: doc.coverPath });
      console.log(`OK    toutiao      ${item.title || ''} ${item.postUrl}`);
    }
  }
} finally {
  await bridge.stop();
}

function runToutiaoCoverScript({ draftUrl, coverPath }) {
  const scriptPath = resolve('Ltool/recordings/toutiao-cover.codegen.js');
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        LTOOL_TOUTIAO_DRAFT_URL: draftUrl,
        LTOOL_COVER_PATH: coverPath,
      },
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Toutiao cover script failed with exit code ${code}`));
    });
  });
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
