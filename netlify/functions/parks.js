'use strict';
const nj = require('../../lib/nj-portal');
const { getCache, setCache, fresh, connect } = require('./_cache');
const DAY = 24 * 60 * 60 * 1000;

exports.handler = async (event) => {
  try {
    await connect(event);
    const cached = await getCache('parks', 'list');
    if (fresh(cached, DAY)) return json(200, { parks: cached.data });
    const parks = await nj.getParks();
    await setCache('parks', 'list', parks);
    return json(200, { parks });
  } catch (e) {
    console.error('parks: ' + (e && e.message));
    try {
      const stale = await getCache('parks', 'list');
      if (stale) return json(200, { parks: stale.data, stale: true });
    } catch (_) { /* Blobs unavailable too — fall through to 502 */ }
    return json(502, { error: 'Could not load park list' });
  }
};
function json(status, obj) {
  return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}
