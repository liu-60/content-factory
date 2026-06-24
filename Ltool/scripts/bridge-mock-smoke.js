import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { ExtensionBridge } from '../src/bridge.js';

const token = `smoke_${Date.now()}`;
const bridge = new ExtensionBridge({
  port: 19527,
  token,
  requestTimeoutMs: 3000,
  clientName: 'Ltool Smoke',
});

await bridge.start();

const ws = new WebSocket('ws://localhost:19527');
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

ws.on('message', (raw) => {
  const request = JSON.parse(raw.toString());
  ws.send(JSON.stringify({
    id: request.id,
    result: {
      method: request.method,
      tokenMatched: request.token === token,
      client: request.client,
    },
  }));
});

try {
  await bridge.waitForConnection(1000);
  const response = await bridge.request('getStatus');
  assert.equal(response.method, 'getStatus');
  assert.equal(response.tokenMatched, true);
  assert.equal(response.client.name, 'Ltool Smoke');
  console.log('Bridge smoke OK');
} finally {
  ws.close();
  await bridge.stop();
}
