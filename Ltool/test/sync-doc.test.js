import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { collectSyncDocs } from '../src/sync-doc.js';
import { buildCoverTasks } from '../src/playwright-cover.js';

test('collectSyncDocs derives title from filename and uses folder image as cover', async () => {
  const dir = join(tmpdir(), `ltool-sync-doc-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'cover.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  await writeFile(join(dir, '标题来自文件名.md'), '# Ignored Heading\n\n正文内容\n\n![本地图](cover.png)', 'utf8');

  const docs = collectSyncDocs(dir);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].article.title, '标题来自文件名');
  assert.equal(docs[0].article.coverSource, 'folder-image-data-uri');
  assert.equal(docs[0].article.coverPath, join(dir, 'cover.png'));
  assert.ok(docs[0].article.cover.startsWith('data:image/png;base64,'));
  assert.ok(docs[0].article.html.includes('data:image/png;base64,'));

  const tasks = buildCoverTasks([
    { platform: 'toutiao', title: '标题来自文件名', success: true, postUrl: 'https://mp.toutiao.com/draft' },
  ], docs);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].coverPath, join(dir, 'cover.png'));
});
