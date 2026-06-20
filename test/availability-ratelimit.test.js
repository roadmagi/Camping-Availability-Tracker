const test = require('node:test');
const assert = require('node:assert');
const cache = require('../netlify/functions/_cache');
const nj = require('../lib/nj-portal');
const fn = require('../netlify/functions/availability');

function fakeStore() { const m = new Map(); return { async get(k){return m.has(k)?m.get(k):null;}, async setJSON(k,v){m.set(k,v);} }; }

test('rate limit: cold fetches beyond RATE_LIMIT_MAX return 429', async () => {
  fn._resetRateLimit();
  cache._setStoreFactory(async () => fakeStore()); // fresh store each access => every call is a cold miss
  const origP = nj.getParks, origA = nj.getParkAvailability;
  nj.getParks = async () => [{ id: '1', name: 'T' }];
  nj.getParkAvailability = async () => ({ parkName: 'T', locationId: '1', alert: null, sites: [] });
  try {
    const MAX = fn.RATE_LIMIT_MAX;
    for (let i = 0; i < MAX; i++) {
      const r = await fn.handler({ queryStringParameters: { park: '1', months: '1' } });
      assert.equal(r.statusCode, 200, 'call ' + i + ' should be 200');
    }
    const over = await fn.handler({ queryStringParameters: { park: '1', months: '1' } });
    assert.equal(over.statusCode, 429); // exceeds the per-window cap, no cache to fall back to
  } finally { nj.getParks = origP; nj.getParkAvailability = origA; fn._resetRateLimit(); }
});
