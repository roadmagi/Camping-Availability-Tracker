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
