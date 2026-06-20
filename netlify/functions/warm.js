'use strict';
const nj = require('../../lib/nj-portal');
const { setCache, availKey } = require('./_cache');
const POPULAR = ['High Point', 'Stokes', 'Wharton', 'Bass River'];

exports.handler = async () => {
  for (const name of POPULAR) {
    try {
      const hits = await nj.resolvePark(name);
      if (hits.length !== 1) continue;
      const park = hits[0];
      const start = nj.todayUTC();
      const months = 3;
      const key = availKey(park.id, nj.isoUTC(start), months);
      const avail = await nj.getParkAvailability(park, start, months, { parallel: true });
      avail.sites.sort((a, b) =>
        nj.normSite(a.shortName).localeCompare(nj.normSite(b.shortName), undefined, { numeric: true }));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()));
      await setCache('availability', key, {
        parkName: avail.parkName, locationId: avail.locationId, alert: avail.alert,
        start: nj.isoUTC(start), end: nj.isoUTC(nj.addDays(end, -1)),
        generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
        sites: avail.sites,
      });
    } catch (_) { /* skip a failing park this cycle */ }
  }
  return { statusCode: 200, body: 'warmed' };
};
