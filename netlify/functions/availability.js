'use strict';
const nj = require('../../lib/nj-portal');
const { getCache, setCache, fresh, connect, availKey } = require('./_cache');
const PREFS = require('../../config/preferred-sites.json');
const TTL = 20 * 60 * 1000;

// Build norm(parkName) -> favorites[] / description from the personal config
// (bundled at deploy). Both are applied on the way OUT (egress), never cached.
const _favByPark = {};   // best tier (베스트)
const _recByPark = {};   // recommended tier (추천) = the full preferred `sites` list
const _descByPark = {};
const _cgByPark = {};    // campground groups [{ name, sites[] }] for multi-campground parks
for (const p of (PREFS.parks || [])) {
  if (!p || !p.park) continue;
  const k = nj.norm(p.park);
  if (p.favorites && p.favorites.length) _favByPark[k] = p.favorites;
  if (p.sites && p.sites.length) _recByPark[k] = p.sites;
  if (p.description) _descByPark[k] = p.description;
  if (p.campgrounds && p.campgrounds.length) _cgByPark[k] = p.campgrounds;
}
// exact match, else loose includes (mirrors the CLI's applyFavorites matching)
function _byPark(map, parkName) {
  const k = nj.norm(parkName);
  if (map[k] != null) return map[k];
  for (const key of Object.keys(map)) {
    if (key && (k.includes(key) || key.includes(k))) return map[key];
  }
  return undefined;
}
function favoritesFor(parkName) { return _byPark(_favByPark, parkName) || []; }
function recommendedFor(parkName) { return _byPark(_recByPark, parkName) || []; }
function descriptionFor(parkName) { return _byPark(_descByPark, parkName) || ''; }
function campgroundsFor(parkName) { return _byPark(_cgByPark, parkName) || []; }

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
  let key = null, rec = [], best = [], desc = '', cgs = [];
  try {
    await connect(event);
    const parks = await nj.getParks();
    const park = parks.find((p) => String(p.id) === String(q.park));
    if (!park) return json(400, { error: 'Unknown or missing park id' });
    best = favoritesFor(park.name);
    rec = recommendedFor(park.name);
    desc = descriptionFor(park.name);
    cgs = campgroundsFor(park.name);

    let months = parseInt(q.months, 10);
    if (!Number.isFinite(months)) months = 3;
    months = Math.max(1, Math.min(6, months));

    const start = /^\d{4}-\d{2}-\d{2}$/.test(q.start || '')
      ? new Date(q.start + 'T00:00:00Z') : nj.todayUTC();
    const startIso = nj.isoUTC(start);
    key = availKey(park.id, startIso, months);

    const cached = await getCache('availability', key);
    if (fresh(cached, TTL)) return json(200, decorate(cached.data, rec, best, desc, cgs));

    // A cold fetch is required — apply the rate limit.
    if (!_coldAllowed()) {
      if (cached) return json(200, decorate({ ...cached.data, stale: true }, rec, best, desc, cgs)); // expired but present
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
    return json(200, decorate(payload, rec, best, desc, cgs));
  } catch (e) {
    console.error('availability: ' + (e && e.message));
    if (key) {
      try {
        const stale = await getCache('availability', key);
        if (stale) return json(200, decorate({ ...stale.data, stale: true }, rec, best, desc, cgs));
      } catch (_) { /* Blobs unavailable too — fall through to 502 */ }
    }
    return json(502, { error: 'Could not load availability right now. Try again shortly.' });
  }
};
exports._resetRateLimit = _resetRateLimit;
exports.RATE_LIMIT_MAX = RL_MAX;

// Tag sites by tier (best/recommended/plain), group by campground when configured,
// sort, and attach the park description on the response (not in the cache).
// rec/best/desc/cgs come from config.
function decorate(data, rec, best, desc, cgs) {
  let sites = nj.markTiers(data.sites, rec, best);
  if (cgs && cgs.length) sites = nj.markCampgrounds(sites, cgs);
  return { ...data, description: desc || '', sites };
}
function json(status, obj) {
  return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}
