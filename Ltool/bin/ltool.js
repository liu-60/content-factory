#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ExtensionBridge } from '../src/bridge.js';
import { clearToken, getConfig, setToken, showConfigPath } from '../src/config.js';
import { uploadDraftCovers } from '../src/playwright-cover.js';
import { DEFAULT_PLATFORMS, normalizePlatforms, PLATFORM_REGISTRY } from '../src/platforms.js';
import { collectSyncDocs, formatDocSummary, resolveSyncDocDir } from '../src/sync-doc.js';

function printHelp() {
  console.log(`Ltool

Usage:
  Ltool token set <token>
  Ltool token show
  Ltool token clear
  Ltool platforms
  Ltool status [--timeout <ms>]
  Ltool sync-doc [dir] [--platforms <ids|all>] [--publish] [--dry-run] [--timeout <ms>] [--skip-cover-upload] [--cdp-url <url>]
  Ltool mcp

Config: ${showConfigPath()}
Extension: ${resolve('Ltool', 'extension')}
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const flags = {};
  const positional = [];
  while (args.length) {
    const arg = args.shift();
    if (!arg.startsWith('--')) {
      positional.push(arg);
    } else if (['publish', 'dry-run', 'json'].includes(arg.slice(2))) {
      flags[arg.slice(2)] = true;
    } else {
      flags[arg.slice(2)] = args.shift();
    }
  }
  return { positional, flags };
}

async function withBridge(timeoutMs, clientName, fn) {
  const config = getConfig();
  const bridge = new ExtensionBridge({
    port: config.wsPort,
    token: config.token,
    requestTimeoutMs: config.requestTimeoutMs,
    clientName,
  });
  await bridge.start();
  try {
    await bridge.waitForConnection(timeoutMs);
    return await fn(bridge);
  } finally {
    await bridge.stop();
  }
}

async function commandStatus(flags) {
  await withBridge(Number(flags.timeout || 30000), 'Ltool CLI', async (bridge) => {
    const status = await bridge.request('getStatus');
    const platforms = await bridge.request('listPlatforms', { forceRefresh: true });
    console.log(`Bridge: connected (${status.bridgeUrl || `ws://localhost:${getConfig().wsPort}`})`);
    console.log(`Extension: ${status.extensionVersion || 'unknown'}`);
    console.log(`CLI/MCP: ${status.lastClient?.name || 'connected'}`);
    console.log(`Last request: ${status.lastRequest?.method || '-'} ${status.lastRequest?.at || ''}`);
    console.log('');
    for (const platform of platforms) {
      const state = platform.isAuthenticated ? 'logged in' : 'not logged in';
      const user = platform.username ? ` (${platform.username})` : '';
      console.log(`${platform.id.padEnd(12)} ${platform.name.padEnd(12)} ${state}${user}`);
    }
  });
}

async function commandSyncDoc(dirArg, flags) {
  const dir = resolveSyncDocDir(dirArg);
  const platforms = normalizePlatforms(flags.platforms || DEFAULT_PLATFORMS);
  const docs = collectSyncDocs(dir);
  const publish = Boolean(flags.publish);
  const dryRun = Boolean(flags['dry-run']);
  const skipCoverUpload = Boolean(flags['skip-cover-upload']) || publish;
  if (!docs.length) throw new Error(`No supported documents found in ${dir}`);

  console.log(`Docs: ${dir}`);
  console.log(`Platforms: ${platforms.join(', ')}`);
  console.log(`Mode: ${publish ? 'publish' : 'draft/upload'}`);
  console.log('');
  for (const doc of docs) console.log(formatDocSummary(doc));
  if (dryRun) {
    console.log('\nDry run only. No browser task was sent.');
    return;
  }

  await withBridge(Number(flags.timeout || 30000), 'Ltool CLI', async (bridge) => {
    const batchId = createHash('sha1')
      .update(JSON.stringify({ dir, platforms, publish, docs: docs.map((doc) => doc.filePath) }))
      .digest('hex')
      .slice(0, 12);
    const result = await bridge.request('syncArticleBatch', {
      batchId,
      platforms,
      publish,
      articles: docs.map((doc) => doc.article),
    });
    console.log(`\nBatch: ${result.batchId || batchId}`);
    for (const item of result.results || []) {
      const ok = item.success ? 'OK' : 'FAIL';
      const link = item.postUrl ? ` ${item.postUrl}` : '';
      const error = item.error ? ` ${item.error}` : '';
      console.log(`${ok.padEnd(5)} ${item.platform.padEnd(12)} ${item.title || ''}${link}${error}`);
    }
    if (!skipCoverUpload) {
      const coverResults = await uploadDraftCovers({
        results: result.results || [],
        docs,
        cdpUrl: flags['cdp-url'],
        headless: flags.headless === 'true',
      });
      if (coverResults.length) {
        console.log('\nCover upload:');
        for (const item of coverResults) {
          const ok = item.success ? 'OK' : 'FAIL';
          const error = item.error ? ` ${item.error}` : '';
          console.log(`${ok.padEnd(5)} ${item.platform.padEnd(12)} ${item.title || ''}${error}`);
        }
      }
    }
  });
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, subcommand, third] = positional;
  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') return printHelp();
    if (command === 'token') {
      if (subcommand === 'set') {
        if (!third) throw new Error('Missing token');
        setToken(third);
        console.log(`Token saved to ${showConfigPath()}`);
        return;
      }
      if (subcommand === 'show') {
        const token = getConfig().token;
        console.log(token ? `Token configured (${token.slice(0, 4)}...${token.slice(-4)})` : 'Token not configured');
        console.log(showConfigPath());
        return;
      }
      if (subcommand === 'clear') {
        clearToken();
        console.log('Token cleared');
        return;
      }
      throw new Error('Usage: Ltool token set|show|clear');
    }
    if (command === 'platforms') {
      for (const platform of Object.values(PLATFORM_REGISTRY)) {
        console.log(`${platform.id.padEnd(12)} ${platform.name.padEnd(12)} ${platform.composeUrl}`);
      }
      return;
    }
    if (command === 'status') return await commandStatus(flags);
    if (command === 'sync-doc') {
      const dirArg = subcommand && !subcommand.startsWith('--') ? subcommand : undefined;
      return await commandSyncDoc(dirArg, flags);
    }
    if (command === 'mcp') return await import('./ltool-mcp.js');
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
