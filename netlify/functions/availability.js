'use strict';
const nj = require('../../lib/nj-portal');
const { getCache, setCache, fresh } = require('./_cache');
const TTL = 20 * 60 * 1000;

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  let key = null;
  try {
    const parks = await nj.getParks();
    const park = parks.find((p) => String(p.id) === String(q.park));
    if (!park) return json(400, { error: 'Unknown or missing park id' });

    let months = parseInt(q.months, 10);
    if (!Number.isFinite(months)) months = 3;
    months = Math.max(1, Math.min(6, months));

    const start = /^\d{4}-\d{2}-\d{2}$/.test(q.start || '')
      ? new Date(q.start + 'T00:00:00Z') : nj.todayUTC();
    const startIso = nj.isoUTC(start);
    key = `avail:${park.id}:${startIso}:${months}`;

    const cached = await getCache('availability', key);
    if (fresh(cached, TTL)) return json(200, cached.data);

    const avail = await nj.getParkAvailability(park, start, months, { parallel: true });
    avail.sites.sort((a, b) =>
      nj.normSite(a.shortName).localeCompare(nj.normSite(b.shortName), undefined, { numeric: true }));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()));
    const payload = {
      parkName: avail.parkName, locationId: avail.locationId, alert: avail.alert,
      start: startIso, end: nj.isoUTC(nj.addDays(end, -1)),
      generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      sites: avail.sites,
    };
    await setCache('availability', key, payload);
    return json(200, payload);
  } catch (e) {
    // Spec sect.8: prefer last-known data over an error, if we have it.
    if (key) {
      try {
        const stale = await getCache('availability', key);
        if (stale) return json(200, { ...stale.data, stale: true });
      } catch (_) { /* Blobs unavailable too — fall through to 502 */ }
    }
    return json(502, { error: 'Could not load availability right now. Try again shortly.' });
  }
};
function json(status, obj) {
  return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}
