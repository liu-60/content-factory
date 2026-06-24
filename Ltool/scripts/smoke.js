import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_PLATFORMS } from '../src/platforms.js';
import { collectSyncDocs, resolveSyncDocDir } from '../src/sync-doc.js';
import { PLATFORMS } from '../extension/sync-engine.js';

const root = resolve(import.meta.dirname, '..', '..');
const manifestPath = resolve(root, 'Ltool', 'extension', 'manifest.json');
const popupPath = resolve(root, 'Ltool', 'extension', 'popup.html');
const docsDir = resolveSyncDocDir(resolve(root, 'sync-doc'));
const docs = collectSyncDocs(docsDir);

await stat(manifestPath);
await stat(popupPath);

assert.equal(Object.keys(PLATFORMS).length, DEFAULT_PLATFORMS.length);
assert.ok(DEFAULT_PLATFORMS.includes('weixin'));
assert.ok(DEFAULT_PLATFORMS.includes('baijiahao'));
assert.ok(DEFAULT_PLATFORMS.includes('toutiao'));
assert.ok(docs.length > 0, 'sync-doc should contain at least one supported document');

for (const doc of docs) {
  assert.ok(doc.article.title, 'doc title should be derived from filename');
  assert.ok(doc.article.html.includes('<'), 'doc content should be converted to html');
}

console.log(`Smoke OK: ${docs.length} document(s), ${DEFAULT_PLATFORMS.length} platform(s).`);
