const test = require('node:test');
const assert = require('node:assert');
const cache = require('../netlify/functions/_cache');
const { availKey } = require('../netlify/functions/_cache');
const nj = require('../lib/nj-portal');
const fn = require('../netlify/functions/availability');

function fakeStore() { const m = new Map(); return { async get(k){return m.has(k)?m.get(k):null;}, async setJSON(k,v){m.set(k,v);} }; }

test('error with EXPIRED cache present -> 200 stale:true', async () => {
  fn._resetRateLimit();
  const store = fakeStore();
  cache._setStoreFactory(async () => store);
  const origP = nj.getParks, origA = nj.getParkAvailability;
  nj.getParks = async () => [{ id: '1', name: 'T' }];
  nj.getParkAvailability = async () => { throw new Error('portal down'); };
  try {
    // pre-seed an EXPIRED entry under the exact key the handler computes (default start=today, months=3)
    const key = availKey('1', nj.isoUTC(nj.todayUTC()), 3);
    await store.setJSON(key, { data: { parkName: 'T', locationId: '1', alert: null, start: 'a', end: 'b', sites: [] }, fetchedAt: Date.now() - 99999999 });
    const r = await fn.handler({ queryStringParameters: { park: '1' } }); // months default 3
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).stale, true);
  } finally { nj.getParks = origP; nj.getParkAvailability = origA; }
});

test('error with NO cache -> 502', async () => {
  fn._resetRateLimit();
  cache._setStoreFactory(async () => fakeStore());
  const origP = nj.getParks, origA = nj.getParkAvailability;
  nj.getParks = async () => [{ id: '1', name: 'T' }];
  nj.getParkAvailability = async () => { throw new Error('portal down'); };
  try {
    const r = await fn.handler({ queryStringParameters: { park: '1', months: '3' } });
    assert.equal(r.statusCode, 502);
  } finally { nj.getParks = origP; nj.getParkAvailability = origA; }
});
