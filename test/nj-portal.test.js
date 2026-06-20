const test = require('node:test');
const assert = require('node:assert');
const nj = require('../lib/nj-portal');

test('normSite strips leading zeros in digit runs', () => {
  assert.equal(nj.normSite('001'), nj.normSite('1'));
  assert.equal(nj.normSite('T07'), nj.normSite('t7'));
});
test('dayStatus maps flags', () => {
  assert.equal(nj.dayStatus({ Booked: true }), 'booked');
  assert.equal(nj.dayStatus({ Arrival: true }), 'booked');
  assert.equal(nj.dayStatus({ ClosedSeasonal: true }), 'closed');
  assert.equal(nj.dayStatus({}), 'available');
});
test('isoUTC / parseNetDate round-trip in UTC', () => {
  const d = nj.parseNetDate('/Date(1781481600000)/');
  assert.match(nj.isoUTC(d), /^\d{4}-\d{2}-\d{2}$/);
});
test('markTiers tags best/recommended/plain and orders best→recommended→plain', () => {
  const sites = [
    { shortName: '001' }, // recommended (in sites, not best)
    { shortName: '005' }, // best
    { shortName: '099' }, // unlisted → plain
  ];
  const recommended = ['001', '005']; // the full preferred list (best is a subset)
  const best = ['005'];
  const out = nj.markTiers(sites, recommended, best);
  assert.deepEqual(out.map((s) => s.shortName), ['005', '001', '099']); // best, rec, plain
  assert.deepEqual(out.map((s) => s.tier), ['best', 'recommended', '']);
});
test('markTiers matching survives zeros/suffixes/prefixes', () => {
  const out = nj.markTiers(
    [{ shortName: '016W' }, { shortName: '#06' }, { shortName: '055' }],
    ['016W', '055'],   // recommended
    ['#06']            // best
  );
  assert.equal(out.find((s) => s.shortName === '#06').tier, 'best');     // # prefix
  assert.equal(out.find((s) => s.shortName === '016W').tier, 'recommended'); // W suffix
  assert.equal(out.find((s) => s.shortName === '055').tier, 'recommended'); // exact
});
test('markTiers with empty lists → all plain, numeric order, non-mutating', () => {
  const sites = [{ shortName: '10' }, { shortName: '2' }];
  const out = nj.markTiers(sites, [], []);
  assert.deepEqual(out.map((s) => s.shortName), ['2', '10']);
  assert.ok(out.every((s) => s.tier === ''));
  assert.deepEqual(sites.map((s) => s.shortName), ['10', '2']); // original untouched
});
