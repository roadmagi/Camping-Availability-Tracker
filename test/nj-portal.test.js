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
test('markFavorites matches (zeros/suffixes/prefixes) and groups favorites first', () => {
  const sites = [
    { shortName: '001' }, { shortName: '005' }, { shortName: '016W' }, { shortName: '#06' },
  ];
  const out = nj.markFavorites(sites, ['005', '016W', '#06']);
  // the 3 favorites come before the 1 non-favorite (intra-group order is collation-defined)
  assert.deepEqual(out.slice(0, 3).map((s) => s.favorite), [true, true, true]);
  assert.equal(out[3].shortName, '001');
  assert.equal(out[3].favorite, false);
  // matched regardless of leading zeros (005), W suffix (016W), # prefix (#06)
  assert.ok(out.find((s) => s.shortName === '005').favorite);
  assert.ok(out.find((s) => s.shortName === '016W').favorite);
  assert.ok(out.find((s) => s.shortName === '#06').favorite);
});
test('markFavorites with a plain number matches a zero-padded ShortName', () => {
  const out = nj.markFavorites([{ shortName: '055' }], ['55']);
  assert.equal(out[0].favorite, true);
});
test('markFavorites with empty favorites → all false, numeric order, non-mutating', () => {
  const sites = [{ shortName: '10' }, { shortName: '2' }];
  const out = nj.markFavorites(sites, []);
  assert.deepEqual(out.map((s) => s.shortName), ['2', '10']);
  assert.ok(out.every((s) => s.favorite === false));
  assert.deepEqual(sites.map((s) => s.shortName), ['10', '2']); // original untouched
});
