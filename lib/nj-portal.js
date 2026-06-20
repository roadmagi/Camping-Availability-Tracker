'use strict';
/*
 * nj-portal.js — NJ State Park portal internals (shared module)
 * --------------------------------------------------------------
 * Provides all portal-fetching functions and date helpers for the NJ campsite
 * availability tool. Consumed by tools/nj-campsite-availability.js (CLI) and
 * by future Netlify Functions (serverless).
 *
 * READ-ONLY: never books, never logs in.
 */

const BASE = 'https://www.njportal.com/DEP/NJOutdoors';
const UA = 'NJ-Campsite-Availability/1.0 (personal NJ state park availability viewer)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function httpGet(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const text = await res.text();
  return { status: res.status, setCookie, text };
}

function cookiesFrom(setCookie) {
  return (setCookie || []).map((c) => c.split(';')[0]).join('; ');
}

function cleanText(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract a park's closure/alert banner from its Details page, if any.
// Parks with no notice have no `alert-header-h5` element → returns null.
function extractAlert(html) {
  const tm = html.match(/<div class="alert-header-h5">([\s\S]*?)<\/div>/i);
  if (!tm) return null;
  const title = cleanText(tm[1]);
  if (!title) return null;
  let rest = html.slice(html.indexOf(tm[0]) + tm[0].length);
  const ps = [];
  while (ps.length < 5) {
    const m = rest.match(/^\s*<p>([\s\S]*?)<\/p>/i);
    if (!m) break;
    const txt = cleanText(m[1]);
    if (txt) ps.push(txt);
    rest = rest.slice(m[0].length);
  }
  return { title, body: ps.join(' ') };
}

// ---------------------------------------------------------------------------
// Park directory (name <-> locationId) from the Search page's ParkName select
// ---------------------------------------------------------------------------
let _parksCache = null;
async function getParks() {
  if (_parksCache) return _parksCache;
  const { text } = await httpGet(BASE + '/Park/Search');
  const sel = text.match(/<select\b[^>]*\b(?:id|name)="ParkName"[^>]*>([\s\S]*?)<\/select>/i);
  const body = sel ? sel[1] : text;
  const parks = [...body.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/gi)]
    .map((m) => ({ id: m[1], name: m[2].replace(/\s+/g, ' ').trim() }))
    .filter((p) => p.name && p.id !== '0');
  _parksCache = parks;
  return parks;
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function resolvePark(query) {
  const parks = await getParks();
  const q = norm(query);
  // exact, then startsWith, then includes
  let hits = parks.filter((p) => norm(p.name) === q);
  if (!hits.length) hits = parks.filter((p) => norm(p.name).startsWith(q));
  if (!hits.length) hits = parks.filter((p) => norm(p.name).includes(q));
  if (!hits.length) {
    // token-subset match (e.g. "high point" vs "HIGH POINT STATE PARK")
    const qt = q.split(' ');
    hits = parks.filter((p) => {
      const pt = norm(p.name).split(' ');
      return qt.every((t) => pt.includes(t));
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Per-park session (cookies + anti-forgery token)
// ---------------------------------------------------------------------------
async function getSession(locationId) {
  const { setCookie, text } = await httpGet(BASE + '/Park/Details?locationId=' + locationId);
  const cookie = cookiesFrom(setCookie);
  const tok = (text.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1];
  if (!cookie || !tok) {
    throw new Error('Could not establish a session for locationId ' + locationId);
  }
  return { cookie, token: tok, alert: extractAlert(text) };
}

// ---------------------------------------------------------------------------
// Date helpers (work in UTC throughout to avoid off-by-one)
// ---------------------------------------------------------------------------
function parseNetDate(s) {
  const m = /\/Date\((\d+)\)\//.exec(s);
  return m ? new Date(Number(m[1])) : null;
}
function isoUTC(d) {
  return (
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}
function mmddyyyy(d) {
  return (
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '/' +
    String(d.getUTCDate()).padStart(2, '0') +
    '/' +
    d.getUTCFullYear()
  );
}
function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}
function todayUTC() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Availability fetch
// ---------------------------------------------------------------------------
async function fetchWindow(session, locationId, fromDate) {
  const body = new URLSearchParams({
    locationId: String(locationId),
    fromDate: mmddyyyy(fromDate),
    limitTypes: '',
    limitFeatures: '',
    trailerLength: '0',
    peopleSupported: '1',
    vehiclesSupported: '0',
    __RequestVerificationToken: session.token,
  }).toString();
  const res = await fetch(BASE + '/Park/ListSiteAvailabilityJson', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Cookie: session.cookie,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Origin: 'https://www.njportal.com',
      Referer: BASE + '/Park/Details?locationId=' + locationId,
    },
    body,
  });
  const txt = await res.text();
  let json;
  try {
    json = JSON.parse(txt);
  } catch (e) {
    throw new Error('Non-JSON response from ListSiteAvailabilityJson (got ' + txt.slice(0, 60) + '…)');
  }
  if (!json.success) throw new Error('Availability request returned success=false');
  return json.sites || [];
}

function dayStatus(d) {
  if (d.Booked || d.Arrival) return 'booked';
  if (d.ClosedSeasonal || d.ClosedNonSeasonal || d.Unavailable || d.Inactive || d.Locked) return 'closed';
  return 'available';
}

// Returns { parkName, locationId, alert, sites: [{ siteId, shortName, name, type, cost, days:{iso:status} }] }
async function getParkAvailability(park, startDate, months, opts = {}) {
  const session = await getSession(park.id);
  const endDate = new Date(Date.UTC(
    startDate.getUTCFullYear(), startDate.getUTCMonth() + months, startDate.getUTCDate()));
  // precompute 28-day window cursors
  const cursors = [];
  for (let c = new Date(startDate.getTime()); c < endDate && cursors.length < 60; c = addDays(c, 28)) {
    cursors.push(new Date(c.getTime()));
  }
  const sitesById = new Map();
  const absorb = (sites) => {
    for (const s of sites) {
      const det = s.SiteDetails || {};
      const id = det.SiteId;
      if (!sitesById.has(id)) sitesById.set(id, {
        siteId: id,
        shortName: det.ShortName != null ? String(det.ShortName) : String(id),
        name: det.Name || '',
        type: (det.SiteTypes || []).map((t) => t.Name).join(', '),
        cost: det.ResidentCost != null ? det.ResidentCost : null,
        days: {},
      });
      const entry = sitesById.get(id);
      for (const dd of s.Dates || []) {
        const dt = parseNetDate(dd.Date);
        if (dt) entry.days[isoUTC(dt)] = dayStatus(dd);
      }
    }
  };
  if (opts.parallel) {
    const batches = await Promise.all(cursors.map((c) => fetchWindow(session, park.id, c)));
    for (const b of batches) absorb(b);
  } else {
    for (const c of cursors) { absorb(await fetchWindow(session, park.id, c)); await sleep(300); }
  }
  return { parkName: park.name, locationId: park.id, alert: session.alert, sites: [...sitesById.values()] };
}

// ---------------------------------------------------------------------------
// Site matching (user "1" should match ShortName "001")
// ---------------------------------------------------------------------------
function normSite(s) {
  // lowercase, trim, and strip leading zeros from every digit-run so that
  // "1"=="001", "T7"=="T07", "S-09"=="S-9" all match the portal's ShortName.
  return String(s).trim().toLowerCase().replace(/0*(\d+)/g, '$1');
}

// Return a new sites array with each site marked { favorite } (matched against the
// favorites list via normSite) and sorted favorites-first, then numeric ShortName.
// Empty favorites → all favorite:false, plain numeric order. Pure; non-mutating.
function markFavorites(sites, favorites) {
  const favSet = new Set((favorites || []).map(normSite));
  const out = (sites || []).map((s) => ({ ...s, favorite: favSet.has(normSite(s.shortName)) }));
  out.sort((a, b) => {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    return normSite(a.shortName).localeCompare(normSite(b.shortName), undefined, { numeric: true });
  });
  return out;
}

module.exports = {
  BASE,
  UA,
  httpGet,
  cookiesFrom,
  cleanText,
  extractAlert,
  getParks,
  norm,
  resolvePark,
  getSession,
  parseNetDate,
  isoUTC,
  mmddyyyy,
  addDays,
  todayUTC,
  fetchWindow,
  dayStatus,
  getParkAvailability,
  normSite,
  markFavorites,
  sleep,
};
