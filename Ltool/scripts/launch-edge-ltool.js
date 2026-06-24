#!/usr/bin/env node
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { launchEdgeWithLtool, saveEdgeStorageState, EDGE_PROFILE_DIR, EDGE_EXTENSION_DIR, EDGE_STATE_PATH, EDGE_DEFAULT_WS_PORT } from '../src/edge-ltool.js';

const args = parseArgs(process.argv.slice(2));
const edgePort = Number(process.env.LTOOL_EDGE_WS_PORT || EDGE_DEFAULT_WS_PORT);
const platform = args.platform || 'toutiao';
const loginUrls = {
  toutiao: 'https://mp.toutiao.com/',
  baijiahao: 'https://baijiahao.baidu.com/',
};
const loginUrl = loginUrls[platform] || platform;

console.log(`Launching Edge with Ltool extension`);
console.log(`Profile: ${EDGE_PROFILE_DIR}`);
console.log(`Extension: ${EDGE_EXTENSION_DIR}`);
console.log(`Bridge: ws://localhost:${edgePort}`);
console.log(`Login URL: ${loginUrl}`);

const { context } = await launchEdgeWithLtool({ keepOpen: true, wsPort: edgePort });
const page = await context.newPage();
await page.goto(loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

console.log('Edge is ready. Log in inside this Edge window, then return here and press Enter to save the session.');
console.log(`Session backup: ${EDGE_STATE_PATH}`);

const rl = createInterface({ input, output });
try {
  await rl.question('Press Enter after login to save and close Edge...');
  const savedPath = await saveEdgeStorageState(context);
  console.log(`Saved Edge login state: ${savedPath}`);
} finally {
  rl.close();
  await context.close().catch(() => {});
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
