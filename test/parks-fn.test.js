const test = require('node:test');
const assert = require('node:assert');
const cache = require('../netlify/functions/_cache');
const nj = require('../lib/nj-portal');

function fakeStore() {
  const m = new Map();
  return {
    async get(key) { return m.has(key) ? m.get(key) : null; },
    async setJSON(key, val) { m.set(key, val); },
  };
}

test('parks handler: miss fetches+caches, hit serves cache (getParks called once)', async () => {
  const s = fakeStore();
  cache._setStoreFactory(async () => s);
  let calls = 0;
  const orig = nj.getParks;
  nj.getParks = async () => { calls++; return [{ id: '1', name: 'TEST PARK' }]; };
  try {
    const parks = require('../netlify/functions/parks');
    const r1 = await parks.handler();
    assert.equal(r1.statusCode, 200);
    assert.deepEqual(JSON.parse(r1.body).parks, [{ id: '1', name: 'TEST PARK' }]);
    const r2 = await parks.handler();
    assert.equal(r2.statusCode, 200);
    assert.deepEqual(JSON.parse(r2.body).parks, [{ id: '1', name: 'TEST PARK' }]);
    assert.equal(calls, 1); // second call served from cache
  } finally {
    nj.getParks = orig;
  }
});
