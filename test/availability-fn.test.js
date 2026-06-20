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

test('tiers from config: best > recommended > plain (HIGH POINT)', async () => {
  if (typeof fn._resetRateLimit === 'function') fn._resetRateLimit();
  cache._setStoreFactory(async () => fakeStore());
  const origP = nj.getParks, origA = nj.getParkAvailability;
  nj.getParks = async () => [{ id: '1', name: 'HIGH POINT STATE PARK' }];
  nj.getParkAvailability = async (park) => ({
    parkName: park.name, locationId: park.id, alert: null,
    sites: [
      { siteId: 99, shortName: '099', name: '', type: '', cost: null, days: {} }, // not listed → plain
      { siteId: 1, shortName: '001', name: '', type: '', cost: null, days: {} },   // in sites → recommended
      { siteId: 5, shortName: '005', name: '', type: '', cost: null, days: {} },   // in favorites → best
    ],
  });
  try {
    const r = await fn.handler({ queryStringParameters: { park: '1', months: '3' } });
    assert.equal(r.statusCode, 200);
    const body = JSON.parse(r.body);
    // HIGH POINT: favorites incl 005 (best), sites incl 001 (recommended), 099 unlisted
    assert.deepEqual(body.sites.map((s) => s.shortName), ['005', '001', '099']);
    assert.deepEqual(body.sites.map((s) => s.tier), ['best', 'recommended', '']);
  } finally { nj.getParks = origP; nj.getParkAvailability = origA; }
});

test('campgrounds from config: STOKES sites grouped by prefix, ordered by config', async () => {
  if (typeof fn._resetRateLimit === 'function') fn._resetRateLimit();
  cache._setStoreFactory(async () => fakeStore());
  const origP = nj.getParks, origA = nj.getParkAvailability;
  nj.getParks = async () => [{ id: '1', name: 'STOKES STATE FOREST' }];
  nj.getParkAvailability = async (park) => ({
    parkName: park.name, locationId: park.id, alert: null,
    sites: [
      { siteId: 1, shortName: 'L020', name: '', type: '', cost: null, days: {} }, // L → Shotwell Lean-tos
      { siteId: 2, shortName: 'T007', name: '', type: '', cost: null, days: {} }, // T0 → Oquittunk
      { siteId: 3, shortName: 'T999', name: '', type: '', cost: null, days: {} }, // T9 → no group → Other
      { siteId: 4, shortName: 'T209', name: '', type: '', cost: null, days: {} }, // T2 → Steam Mill
      { siteId: 5, shortName: 'T110', name: '', type: '', cost: null, days: {} }, // T1 → Shotwell
      { siteId: 6, shortName: 'C001', name: '', type: 'Cabin', cost: 55, days: {} }, // C → Oquittunk Cabins
    ],
  });
  try {
    const r = await fn.handler({ queryStringParameters: { park: '1', months: '3' } });
    assert.equal(r.statusCode, 200);
    const body = JSON.parse(r.body);
    // Each site is assigned the right campground by prefix (robust to config re-tiering/reorder).
    const cg = Object.fromEntries(body.sites.map((s) => [s.shortName, s.campground]));
    assert.equal(cg['T007'], 'Oquittunk');
    assert.equal(cg['C001'], 'Oquittunk Cabins');
    assert.equal(cg['T209'], 'Steam Mill');
    assert.equal(cg['T110'], 'Shotwell');
    assert.equal(cg['L020'], 'Shotwell Lean-tos');
    assert.equal(cg['T999'], ''); // unmatched prefix → ungrouped (Other)
    // Groups appear in the config's campground order, with ungrouped ('') always last.
    const PREFS = require('../config/preferred-sites.json');
    const cfgOrder = PREFS.parks.find((p) => p.park === 'STOKES STATE FOREST').campgrounds.map((c) => c.name).concat(['']);
    const seen = [];
    for (const s of body.sites) if (!seen.includes(s.campground)) seen.push(s.campground);
    assert.deepEqual(seen, cfgOrder.filter((g) => seen.includes(g)));
  } finally { nj.getParks = origP; nj.getParkAvailability = origA; }
});

test('park description from config is included in the response', async () => {
  if (typeof fn._resetRateLimit === 'function') fn._resetRateLimit();
  cache._setStoreFactory(async () => fakeStore());
  const origP = nj.getParks, origA = nj.getParkAvailability;
  nj.getParks = async () => [{ id: '1', name: 'HIGH POINT STATE PARK' }];
  nj.getParkAvailability = async (park) => ({ parkName: park.name, locationId: park.id, alert: null, sites: [] });
  try {
    const r = await fn.handler({ queryStringParameters: { park: '1', months: '3' } });
    const body = JSON.parse(r.body);
    assert.ok(body.description && body.description.indexOf('추천') !== -1); // HIGH POINT has a Korean description
  } finally { nj.getParks = origP; nj.getParkAvailability = origA; }
});

test('park NOT in config → empty description, no favorites', async () => {
  if (typeof fn._resetRateLimit === 'function') fn._resetRateLimit();
  cache._setStoreFactory(async () => fakeStore());
  const origP = nj.getParks, origA = nj.getParkAvailability;
  nj.getParks = async () => [{ id: '9', name: 'SOME UNLISTED PARK' }];
  nj.getParkAvailability = async (park) => ({ parkName: park.name, locationId: park.id, alert: null,
    sites: [{ siteId: 1, shortName: '001', name: '', type: '', cost: null, days: {} }] });
  try {
    const r = await fn.handler({ queryStringParameters: { park: '9', months: '3' } });
    const body = JSON.parse(r.body);
    assert.equal(body.description, '');
    assert.equal(body.sites[0].tier, '');
  } finally { nj.getParks = origP; nj.getParkAvailability = origA; }
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
