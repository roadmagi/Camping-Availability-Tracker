const test = require('node:test');
const assert = require('node:assert');
const C = require('../public/calendar.js');

test('monthsBetween spans inclusive months across a year boundary', () => {
  const ms = C.monthsBetween('2026-11-15', '2027-02-03');
  assert.deepEqual(ms, [[2026,10],[2026,11],[2027,0],[2027,1]]);
});
test('escapeHtml escapes & < >', () => {
  assert.equal(C.escapeHtml('a & b <c>'), 'a &amp; b &lt;c&gt;');
});
test('statusClass maps statuses', () => {
  assert.equal(C.statusClass('available'), 'available');
  assert.equal(C.statusClass('booked'), 'booked');
  assert.equal(C.statusClass('closed'), 'closed');
  assert.equal(C.statusClass(''), 'empty');
});
test('renderCal marks available cell clickable with data-date, and today', () => {
  const days = { '2026-07-04': 'available', '2026-07-05': 'booked' };
  const html = C.renderCal(days, 2026, 6, '2026-07-04');
  assert.match(html, /class="cell available today" data-date="2026-07-04"/);
  assert.match(html, /class="cell booked" data-date="2026-07-05"/);
  assert.match(html, /July 2026/);
});
test('siteRowHtml renders label + one cal per month, no favorite star', () => {
  const site = { shortName: '07', name: 'Oak', type: 'Tent', cost: 25, days: {} };
  const html = C.siteRowHtml(site, [[2026,6],[2026,7]], '2026-07-04');
  assert.match(html, /#07 Oak/);
  assert.match(html, /\$25/);
  assert.ok(!/★/.test(html));            // no favorite star
  assert.equal((html.match(/class="cal"/g) || []).length, 2); // two months
});
