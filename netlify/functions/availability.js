'use strict';
const nj = require('../../lib/nj-portal');
const { getCache, setCache, fresh, availKey } = require('./_cache');
const TTL = 20 * 60 * 1000;

// Coarse per-instance rate limit on COLD fetches. The cache already absorbs
// most load (<=1 fetch/park/20min); this just caps a single hot instance's
// burst to the portal. Best-effort, per-instance (not a global counter).
const RL_MAX = 20;          // max cold fetches per window per instance
const RL_WIN = 60 * 1000;   // 1 minute
let _rlStart = 0, _rlCount = 0;
function _coldAllowed() {
  const now = Date.now();
  if (now - _rlStart >= RL_WIN) { _rlStart = now; _rlCount = 0; }
  _rlCount += 1;
  return _rlCount <= RL_MAX;
}
function _resetRateLimit() { _rlStart = 0; _rlCount = 0; }

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
    key = availKey(park.id, startIso, months);

    const cached = await getCache('availability', key);
    if (fresh(cached, TTL)) return json(200, cached.data);

    // A cold fetch is required — apply the rate limit.
    if (!_coldAllowed()) {
      if (cached) return json(200, { ...cached.data, stale: true }); // expired but present
      return json(429, { error: 'Busy right now — please retry in a moment.' });
    }

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
    if (key) {
      try {
        const stale = await getCache('availability', key);
        if (stale) return json(200, { ...stale.data, stale: true });
      } catch (_) { /* Blobs unavailable too — fall through to 502 */ }
    }
    return json(502, { error: 'Could not load availability right now. Try again shortly.' });
  }
};
exports._resetRateLimit = _resetRateLimit;
exports.RATE_LIMIT_MAX = RL_MAX;

function json(status, obj) {
  return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}
