const test = require('node:test');
const assert = require('node:assert');
const cache = require('../netlify/functions/_cache');
const nj = require('../lib/nj-portal');
const fn = require('../netlify/functions/availability');

function fakeStore() {
  const m = new Map();
  return { async get(key, opts) { return m.has(key) ? m.get(key) : null; },
           async setJSON(key, val) { m.set(key, val); } };
}

test('missing park id → 400', async () => {
  cache._setStoreFactory(async () => fakeStore());
  const origP = nj.getParks; nj.getParks = async () => [{ id: '1', name: 'TEST' }];
  try {
    const r = await fn.handler({ queryStringParameters: {} });
    assert.equal(r.statusCode, 400);
  } finally { nj.getParks = origP; }
});

test('unknown park id → 400', async () => {
  cache._setStoreFactory(async () => fakeStore());
  const origP = nj.getParks; nj.getParks = async () => [{ id: '1', name: 'TEST' }];
  try {
    const r = await fn.handler({ queryStringParameters: { park: '999' } });
    assert.equal(r.statusCode, 400);
  } finally { nj.getParks = origP; }
});

test('valid miss → 200, shaped payload, parallel:true, months clamped to 6', async () => {
  const store = fakeStore();
  cache._setStoreFactory(async () => store);
  const origP = nj.getParks, origA = nj.getParkAvailability;
  let seenOpts = null, seenMonths = null;
  nj.getParks = async () => [{ id: '1', name: 'TEST PARK' }];
  nj.getParkAvailability = async (park, start, months, opts) => {
    seenOpts = opts; seenMonths = months;
    return { parkName: park.name, locationId: park.id, alert: null,
      sites: [{ siteId: 2, shortName: '02', name: '', type: '', cost: null, days: {} },
              { siteId: 1, shortName: '01', name: '', type: '', cost: null, days: {} }] };
  };
  try {
    const r = await fn.handler({ queryStringParameters: { park: '1', months: '99' } });
    assert.equal(r.statusCode, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.parkName, 'TEST PARK');
    assert.ok(body.start && body.end && Array.isArray(body.sites));
    assert.equal(seenOpts.parallel, true);
    assert.equal(seenMonths, 6);            // clamped
    assert.equal(body.sites[0].shortName, '01'); // sorted numeric
  } finally { nj.getParks = origP; nj.getParkAvailability = origA; }
});

test('NaN months → defaults to 3', async () => {
  cache._setStoreFactory(async () => fakeStore());
  const origP = nj.getParks, origA = nj.getParkAvailability;
  let seenMonths = null;
  nj.getParks = async () => [{ id: '1', name: 'T' }];
  nj.getParkAvailability = async (park, start, months) => { seenMonths = months; return { parkName: 'T', locationId: '1', alert: null, sites: [] }; };
  try {
    await fn.handler({ queryStringParameters: { park: '1', months: 'abc' } });
    assert.equal(seenMonths, 3);
  } finally { nj.getParks = origP; nj.getParkAvailability = origA; }
});

test('cache hit: second call does not refetch', async () => {
  const store = fakeStore();
  cache._setStoreFactory(async () => store);
  const origP = nj.getParks, origA = nj.getParkAvailability;
  let calls = 0;
  nj.getParks = async () => [{ id: '1', name: 'T' }];
  nj.getParkAvailability = async () => { calls++; return { parkName: 'T', locationId: '1', alert: null, sites: [] }; };
  try {
    await fn.handler({ queryStringParameters: { park: '1', months: '3' } });
    await fn.handler({ queryStringParameters: { park: '1', months: '3' } });
    assert.equal(calls, 1);
  } finally { nj.getParks = origP; nj.getParkAvailability = origA; }
});
