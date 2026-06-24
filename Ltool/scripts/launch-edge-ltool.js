#!/usr/bin/env node
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { launchEdgeWithLtool, saveEdgeStorageState, EDGE_PROFILE_DIR, EDGE_EXTENSION_DIR, EDGE_STATE_PATH, EDGE_DEFAULT_WS_PORT } from '../src/edge-ltool.js';

const edgePort = Number(process.env.LTOOL_EDGE_WS_PORT || EDGE_DEFAULT_WS_PORT);

console.log(`Launching Edge with Ltool extension`);
console.log(`Profile: ${EDGE_PROFILE_DIR}`);
console.log(`Extension: ${EDGE_EXTENSION_DIR}`);
console.log(`Bridge: ws://localhost:${edgePort}`);

const { context } = await launchEdgeWithLtool({ keepOpen: true, wsPort: edgePort });
const page = await context.newPage();
await page.goto('https://mp.toutiao.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

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
