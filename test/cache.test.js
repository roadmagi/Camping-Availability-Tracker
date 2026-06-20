const test = require('node:test');
const assert = require('node:assert');
const cache = require('../netlify/functions/_cache');

// simple in-memory fake of a Blobs store
function fakeStore() {
  const m = new Map();
  return {
    async get(key, opts) { return m.has(key) ? m.get(key) : null; },
    async setJSON(key, val) { m.set(key, val); },
    _map: m,
  };
}

test('fresh(): null/old are not fresh, recent is fresh', () => {
  assert.equal(cache.fresh(null, 1000), false);
  assert.equal(cache.fresh({ fetchedAt: Date.now() - 5000 }, 1000), false);
  assert.equal(cache.fresh({ fetchedAt: Date.now() }, 10000), true);
  assert.equal(cache.fresh({}, 1000), false);
});

test('setCache stores {data,fetchedAt}; getCache returns it', async () => {
  const s = fakeStore();
  cache._setStoreFactory(async () => s);
  await cache.setCache('store', 'k', { hello: 'world' });
  const got = await cache.getCache('store', 'k');
  assert.deepEqual(got.data, { hello: 'world' });
  assert.equal(typeof got.fetchedAt, 'number');
});
