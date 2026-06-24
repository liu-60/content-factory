import assert from 'node:assert/strict';
import test from 'node:test';

test('toutiao sync continues when image upload returns non-json', async () => {
  const calls = [];
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;

  globalThis.chrome = {
    cookies: {
      async getAll() {
        return [{ name: 'sessionid', value: 'ok', domain: '.toutiao.com' }];
      },
    },
    tabs: {
      async query() {
        return [{ id: 1, status: 'complete', url: 'https://mp.toutiao.com/profile_v4/graphic/publish' }];
      },
      async create() {
        return { id: 1, status: 'complete' };
      },
      async get() {
        return { id: 1, status: 'complete' };
      },
      onUpdated: {
        addListener() {},
        removeListener() {},
      },
    },
    scripting: {
      async executeScript({ func, args }) {
        return [{ result: await func(...args) }];
      },
    },
  };

  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('/mp/agw/media/get_media_info')) {
      return jsonResponse({ data: { user: { id: 1, screen_name: 'tester' } } });
    }
    if (href.includes('/ttwid/check/')) {
      return new Response('', { status: 200, headers: { 'x-ware-csrf-token': 'csrf' } });
    }
    if (href.startsWith('data:')) {
      return originalFetch(url, options);
    }
    if (href.includes('/spice/image')) {
      return new Response('<html>login or challenge</html>', { status: 200 });
    }
    if (href.includes('/mp/agw/article/publish')) {
      return jsonResponse({ err_no: 0, data: { pgc_id: 'pgc_mock' } });
    }
    return new Response('', { status: 404 });
  };

  try {
    const { syncArticleBatch } = await import(`../extension/sync-engine.js?test=${Date.now()}`);
    const result = await syncArticleBatch({
      platforms: ['toutiao'],
      articles: [{
        title: 'mock title',
        html: '<p>body</p><img src="data:image/png;base64,iVBORw0KGgo=" />',
        cover: 'data:image/png;base64,iVBORw0KGgo=',
      }],
    });

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].success, true);
    assert.equal(result.results[0].postId, 'pgc_mock');
    assert.ok(calls.some((href) => href.includes('/spice/image')));
    assert.ok(calls.some((href) => href.includes('/mp/agw/article/publish')));
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
