#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ExtensionBridge } from '../src/bridge.js';
import { getConfig, setToken } from '../src/config.js';
import { uploadDraftCovers } from '../src/playwright-cover.js';
import { DEFAULT_PLATFORMS, normalizePlatforms } from '../src/platforms.js';
import { collectSyncDocs, resolveSyncDocDir } from '../src/sync-doc.js';

async function callExtension(method, params = {}, timeoutMs = 30000) {
  const config = getConfig();
  const bridge = new ExtensionBridge({
    port: config.wsPort,
    token: config.token,
    requestTimeoutMs: config.requestTimeoutMs,
    clientName: 'Ltool MCP',
  });
  await bridge.start();
  try {
    await bridge.waitForConnection(timeoutMs);
    return await bridge.request(method, params);
  } finally {
    await bridge.stop();
  }
}

const server = new McpServer({ name: 'Ltool', version: '0.2.1' });

server.registerTool(
  'ltool_get_status',
  {
    title: 'Get Ltool status',
    description: 'Get Chrome extension bridge and platform login status.',
    inputSchema: { timeoutMs: z.number().optional() },
  },
  async ({ timeoutMs = 30000 }) => {
    const status = await callExtension('getStatus', {}, timeoutMs);
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }
);

server.registerTool(
  'ltool_list_platforms',
  {
    title: 'List Ltool platforms',
    description: 'List supported platforms and current login status.',
    inputSchema: { forceRefresh: z.boolean().optional(), timeoutMs: z.number().optional() },
  },
  async ({ forceRefresh = true, timeoutMs = 30000 }) => {
    const result = await callExtension('listPlatforms', { forceRefresh }, timeoutMs);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'ltool_check_auth',
  {
    title: 'Check platform auth',
    description: 'Check one platform login status.',
    inputSchema: { platform: z.string(), timeoutMs: z.number().optional() },
  },
  async ({ platform, timeoutMs = 30000 }) => {
    const result = await callExtension('checkAuth', { platform }, timeoutMs);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'ltool_sync_doc',
  {
    title: 'Sync sync-doc folder',
    description: 'Read sync-doc and send articles to the Chrome extension.',
    inputSchema: {
      dir: z.string().optional(),
      platforms: z.union([z.string(), z.array(z.string())]).optional(),
      publish: z.boolean().optional(),
      skipCoverUpload: z.boolean().optional(),
      cdpUrl: z.string().optional(),
      timeoutMs: z.number().optional(),
    },
  },
  async ({ dir, platforms, publish = false, skipCoverUpload = false, cdpUrl, timeoutMs = 30000 }) => {
    const docs = collectSyncDocs(resolveSyncDocDir(dir));
    const platformIds = normalizePlatforms(platforms || DEFAULT_PLATFORMS);
    const result = await callExtension('syncArticleBatch', {
      batchId: `mcp_${Date.now()}`,
      platforms: platformIds,
      publish,
      articles: docs.map((doc) => doc.article),
    }, timeoutMs);
    if (!publish && !skipCoverUpload) {
      result.coverResults = await uploadDraftCovers({
        results: result.results || [],
        docs,
        cdpUrl,
      });
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'ltool_config_token',
  {
    title: 'Configure Ltool token',
    description: 'Save the bridge token used by CLI/MCP and the Chrome extension.',
    inputSchema: { token: z.string() },
  },
  async ({ token }) => {
    setToken(token);
    return { content: [{ type: 'text', text: 'Token saved.' }] };
  }
);

await server.connect(new StdioServerTransport());
