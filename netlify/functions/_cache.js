'use strict';
// Default store factory uses the real Netlify Blobs store. Tests override it
// via _setStoreFactory() to inject an in-memory fake (Blobs needs `netlify dev`
// to run for real, so handler logic is unit-tested with a fake store).
const _defaultFactory = async (name) => {
  const { getStore } = await import('@netlify/blobs');
  return getStore(name);
};
let _storeFactory = _defaultFactory;
let _injected = false;
function _setStoreFactory(fn) { _storeFactory = fn || _defaultFactory; _injected = !!fn; }

// Classic (Lambda-compatibility) functions must call connectLambda(event) once
// per invocation before touching Blobs, or getStore() throws "environment not
// configured". No-op when a test/dev store is injected (real Blobs not in use)
// or when there is no Lambda event (e.g. unit tests).
async function connect(event) {
  if (_injected || !event) return;
  const { connectLambda } = await import('@netlify/blobs');
  connectLambda(event);
}

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
module.exports = { getCache, setCache, fresh, connect, _setStoreFactory, availKey };
