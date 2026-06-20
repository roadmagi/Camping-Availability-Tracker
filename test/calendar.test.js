const test = require('node:test');
const assert = require('node:assert');
const C = require('../public/calendar.js');

test('monthsBetween spans inclusive months across a year boundary', () => {
  const ms = C.monthsBetween('2026-11-15', '2027-02-03');
  assert.deepEqual(ms, [[2026,10],[2026,11],[2027,0],[2027,1]]);
});
test('escapeHtml escapes & < >', () => {
  assert.equal(C.escapeHtml('a & b <c>'), 'a &amp; b &lt;c&gt;');
  assert.equal(C.escapeHtml('"x" \'y\''), '&quot;x&quot; &#39;y&#39;');
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
test('siteRowHtml renders label + one cal per month; plain tier has no tag', () => {
  const site = { shortName: '07', name: 'Oak', type: 'Tent', cost: 25, days: {} };
  const html = C.siteRowHtml(site, [[2026,6],[2026,7]], '2026-07-04');
  assert.match(html, /#07 Oak/);
  assert.match(html, /\$25/);
  assert.ok(!/tier-tag/.test(html));          // no tier tag
  assert.match(html, /<div class="site">/);   // no tier class
  assert.equal((html.match(/class="cal"/g) || []).length, 2); // two months
});
test('siteRowHtml renders 베스트 tag + .best for tier best', () => {
  const site = { shortName: '07', name: 'Oak', type: '', cost: null, days: {}, tier: 'best' };
  const html = C.siteRowHtml(site, [[2026,6]], '2026-07-04');
  assert.match(html, /<div class="site best">/);
  assert.match(html, /<span class="tier-tag best">★ 베스트<\/span>/);
});
test('siteRowHtml renders 추천 tag + .rec for tier recommended', () => {
  const site = { shortName: '12', name: '', type: '', cost: null, days: {}, tier: 'recommended' };
  const html = C.siteRowHtml(site, [[2026,6]], '2026-07-04');
  assert.match(html, /<div class="site rec">/);
  assert.match(html, /<span class="tier-tag rec">추천<\/span>/);
});
