const test = require('node:test');
const assert = require('node:assert');
const cache = require('../netlify/functions/_cache');
const nj = require('../lib/nj-portal');
const warm = require('../netlify/functions/warm');
const fn = require('../netlify/functions/availability');

function fakeStore() { const m = new Map(); return { async get(k){return m.has(k)?m.get(k):null;}, async setJSON(k,v){m.set(k,v);} }; }

test('warm caches a park; availability then serves it from cache (identical keys)', async () => {
  fn._resetRateLimit();
  const store = fakeStore();
  cache._setStoreFactory(async () => store);
  const origR = nj.resolvePark, origP = nj.getParks, origA = nj.getParkAvailability;
  let availCalls = 0;
  nj.resolvePark = async () => [{ id: '9', name: 'HIGH POINT STATE PARK' }];
  nj.getParks = async () => [{ id: '9', name: 'HIGH POINT STATE PARK' }];
  nj.getParkAvailability = async (park) => { availCalls++; return { parkName: park.name, locationId: park.id, alert: null, sites: [{ siteId: 1, shortName: '01', name: '', type: '', cost: null, days: {} }] }; };
  try {
    const w = await warm.handler();
    assert.equal(w.statusCode, 200);
    const afterWarm = availCalls;             // warm fetched the popular list
    const r = await fn.handler({ queryStringParameters: { park: '9', months: '3' } });
    assert.equal(r.statusCode, 200);
    assert.equal(availCalls, afterWarm);      // NO extra fetch => availability hit warm's cache entry => keys identical
  } finally { nj.resolvePark = origR; nj.getParks = origP; nj.getParkAvailability = origA; }
});
