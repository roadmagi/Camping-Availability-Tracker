'use strict';
// Default store factory uses the real Netlify Blobs store. Tests override it
// via _setStoreFactory() to inject an in-memory fake (Blobs needs `netlify dev`
// to run for real, so handler logic is unit-tested with a fake store).
let _storeFactory = async (name) => {
  const { getStore } = await import('@netlify/blobs');
  return getStore(name);
};
function _setStoreFactory(fn) { _storeFactory = fn; }

async function getCache(name, key) {
  const s = await _storeFactory(name);
  const v = await s.get(key, { type: 'json' });
  return v || null;
}
async function setCache(name, key, data) {
  const s = await _storeFactory(name);
  await s.setJSON(key, { data, fetchedAt: Date.now() });
}
function fresh(entry, ttlMs) {
  return !!entry && typeof entry.fetchedAt === 'number' && (Date.now() - entry.fetchedAt) < ttlMs;
}
function availKey(parkId, startIso, months) {
  return 'avail:' + parkId + ':' + startIso + ':' + months;
}
module.exports = { getCache, setCache, fresh, _setStoreFactory, availKey };
