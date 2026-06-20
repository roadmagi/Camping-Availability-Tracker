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

const STOKES_CG = [
  { name: 'Steam Mill', sites: ['T201', 'T209', 'T218'] },
  { name: 'Oquittunk', sites: ['T007', 'T015'] },
  { name: 'Shotwell Lean-tos', sites: ['L020', 'L021'] },
];
test('markCampgrounds tags by group, orders group→tier→number, ungrouped last', () => {
  const sites = [
    { shortName: 'L020', tier: '' },
    { shortName: 'T007', tier: '' },
    { shortName: 'T999', tier: '' },  // not in any group → Other (last)
    { shortName: 'T209', tier: 'best' },
    { shortName: 'T201', tier: 'recommended' },
  ];
  const out = nj.markCampgrounds(sites, STOKES_CG);
  // Steam Mill first (best T209 → rec T201), then Oquittunk (T007), then Lean-tos (L020), then ungrouped (T999)
  assert.deepEqual(out.map((s) => s.shortName), ['T209', 'T201', 'T007', 'L020', 'T999']);
  assert.deepEqual(out.map((s) => s.campground),
    ['Steam Mill', 'Steam Mill', 'Oquittunk', 'Shotwell Lean-tos', '']);
});
test('markCampgrounds matching survives zero-stripping (L020/T07)', () => {
  const out = nj.markCampgrounds(
    [{ shortName: 'L20', tier: '' }, { shortName: 'T7', tier: '' }],
    STOKES_CG
  );
  assert.equal(out.find((s) => s.shortName === 'L20').campground, 'Shotwell Lean-tos');
  assert.equal(out.find((s) => s.shortName === 'T7').campground, 'Oquittunk');
});
test('markCampgrounds is non-mutating and drops the internal sort key', () => {
  const sites = [{ shortName: 'T015', tier: '' }, { shortName: 'T007', tier: '' }];
  const out = nj.markCampgrounds(sites, STOKES_CG);
  assert.deepEqual(sites.map((s) => s.shortName), ['T015', 'T007']); // original order untouched
  assert.ok(out.every((s) => !('_gi' in s)));                        // no leaked sort key
});

test('markCampgrounds matches by prefix on raw ShortName (groups every site)', () => {
  const cgs = [
    { name: 'Steam Mill', prefix: 'T2' },
    { name: 'Oquittunk', prefix: 'T0' },
    { name: 'Oquittunk Cabins', prefix: 'C' },
    { name: 'Shotwell Lean-tos', prefix: 'L' },
  ];
  const sites = [
    { shortName: 'L023', tier: '' },          // Lean-tos (not in any curated list)
    { shortName: 'T024', tier: '' },          // Oquittunk
    { shortName: 'C007', tier: '' },          // Cabins
    { shortName: 'T210', tier: 'recommended' },// Steam Mill (rec)
    { shortName: 'T201', tier: 'best' },       // Steam Mill (best → first)
  ];
  const out = nj.markCampgrounds(sites, cgs);
  assert.deepEqual(out.map((s) => s.shortName), ['T201', 'T210', 'T024', 'C007', 'L023']);
  assert.deepEqual(out.map((s) => s.campground),
    ['Steam Mill', 'Steam Mill', 'Oquittunk', 'Oquittunk Cabins', 'Shotwell Lean-tos']);
  assert.ok(out.every((s) => s.campground)); // nothing falls through to Other
});
