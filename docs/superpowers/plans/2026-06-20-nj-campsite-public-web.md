# NJ Campsite Availability — Public Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public Netlify site where any visitor picks an NJ state park and sees that park's live (≤~20-min-cached) campsite availability as a color-coded calendar.

**Architecture:** Static frontend (`public/`) → Netlify Functions (`parks`, `availability`, scheduled `warm`) → Netlify Blobs cache → njportal (only on cache miss, windows fetched in parallel). The portal-scraping internals are extracted from the existing CLI tool into a shared `lib/nj-portal.js` that both the CLI and the functions import.

**Tech Stack:** Node 18+ (built-in `fetch`), CommonJS, `@netlify/blobs` (only runtime dep), Netlify Functions + Scheduled Functions, vanilla HTML/CSS/JS frontend (no framework, no build), `node:test` for unit tests.

## Global Constraints
- **Node ≥ 18** (built-in `fetch`, `getSetCookie`). Pin in `netlify.toml` / `package.json` engines.
- **CommonJS** everywhere (`require`); load ESM-only `@netlify/blobs` via dynamic `await import('@netlify/blobs')` inside functions.
- **Public window:** default `months = 3`, **hard max `6`** (clamp server-side). Personal CLI default stays unchanged.
- **Cache TTL:** availability `~20 min`; park list `~24 h`. Cache is the primary throttle — njportal hit ≤ once per (park, window) per TTL.
- **Read-only / no secrets:** never books or logs in; no `.env` keys; honest descriptive `User-Agent` (reuse existing `UA`).
- **No favorites/descriptions/Korean layer** in the public UI — general per-park view only.
- Keep the existing CLI tool's behavior byte-for-byte unchanged after the refactor.

---

### Task 1: Extract `lib/nj-portal.js` shared module (+ parallel fetch) and repoint the CLI

**Files:**
- Create: `lib/nj-portal.js`
- Modify: `tools/nj-campsite-availability.js` (remove moved internals; `require('../lib/nj-portal')`)
- Test: `test/nj-portal.test.js`

**Interfaces:**
- Produces (module exports): `BASE`, `UA`, `httpGet`, `cookiesFrom`, `cleanText`, `extractAlert`, `getParks`, `norm`, `resolvePark`, `getSession`, `parseNetDate`, `isoUTC`, `mmddyyyy`, `addDays`, `todayUTC`, `fetchWindow`, `dayStatus`, `getParkAvailability(park, startDate, months, opts)`, `normSite`, `sleep`.
- `getParkAvailability` gains a 4th arg `opts = { parallel?: boolean }`. Default (CLI) = sequential w/ 300ms delay (unchanged). `parallel:true` = compute all window cursors up front, one shared session, `Promise.all` the `fetchWindow` calls, no sleep. Same return shape: `{ parkName, locationId, alert, sites:[{siteId,shortName,name,type,cost,days:{iso:status}}] }`.

- [ ] **Step 1: Create `lib/nj-portal.js`** by moving lines ~38–306 of `tools/nj-campsite-availability.js` verbatim (constants `BASE`/`UA`, `sleep`, `httpGet`, `cookiesFrom`, `cleanText`, `extractAlert`, `_parksCache`/`getParks`, `norm`, `resolvePark`, `getSession`, all date helpers, `fetchWindow`, `dayStatus`, `getParkAvailability`, `normSite`). Do NOT move `applyFavorites` (CLI/config-specific — leave it in the tool; it only uses `norm`/`normSite`, which it will import). End the file with a single `module.exports = { … }` listing every name in Interfaces above.

- [ ] **Step 2: Refactor `getParkAvailability` to support parallel windows.** Replace the sequential `while` loop body so window start-dates are precomputed, then:

```js
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
```

- [ ] **Step 3: Repoint the CLI.** In `tools/nj-campsite-availability.js`, delete the moved blocks and add near the top (after `fs`/`path`):

```js
const nj = require('../lib/nj-portal');
const {
  BASE, UA, httpGet, cleanText, extractAlert, getParks, norm, resolvePark,
  getSession, parseNetDate, isoUTC, mmddyyyy, addDays, todayUTC, fetchWindow,
  dayStatus, getParkAvailability, normSite,
} = nj;
```
Leave `parseArgs`, `esc`, `buildHtml`, `applyFavorites`, `loadConfig`/`saveConfig`, all `cmd*`, and `main` in place. `applyFavorites` uses `norm`/`normSite` from the destructure above.

- [ ] **Step 4: Write unit tests** `test/nj-portal.test.js` (pure logic only — no network):

```js
const test = require('node:test');
const assert = require('node:assert');
const nj = require('../lib/nj-portal');

test('normSite strips leading zeros in digit runs', () => {
  assert.equal(nj.normSite('001'), nj.normSite('1'));
  assert.equal(nj.normSite('T07'), nj.normSite('t7'));
});
test('dayStatus maps flags', () => {
  assert.equal(nj.dayStatus({ Booked: true }), 'booked');
  assert.equal(nj.dayStatus({ Arrival: true }), 'booked');
  assert.equal(nj.dayStatus({ ClosedSeasonal: true }), 'closed');
  assert.equal(nj.dayStatus({}), 'available');
});
test('isoUTC / parseNetDate round-trip in UTC', () => {
  const d = nj.parseNetDate('/Date(1781481600000)/');
  assert.match(nj.isoUTC(d), /^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 5: Run tests** — `node --test test/`  → Expected: all pass.

- [ ] **Step 6: Regression-check the CLI** — `node tools/nj-campsite-availability.js --rebuild` → Expected: `✅ Rebuilt HTML from cached data` (proves the refactor didn't break the tool).

- [ ] **Step 7: Commit** — `git add lib/ tools/nj-campsite-availability.js test/ && git commit -m "refactor: extract lib/nj-portal.js shared module + parallel window fetch"`

---

### Task 2: Project scaffolding (`package.json`, `netlify.toml`, `.gitignore`)

**Files:**
- Create: `package.json`, `netlify.toml`
- Modify/Create: `.gitignore`

**Interfaces:**
- Produces: a Netlify-deployable project rooted at repo root; `publish = "public"`, functions at `netlify/functions`, scheduled `warm` every 20 min; `@netlify/blobs` installed.

- [ ] **Step 1: Create `package.json`:**

```json
{
  "name": "nj-campsite-availability-web",
  "version": "1.0.0",
  "private": true,
  "engines": { "node": ">=18" },
  "scripts": { "test": "node --test test/", "dev": "netlify dev" },
  "dependencies": { "@netlify/blobs": "^8.1.0" }
}
```
(No `"type"` field → CommonJS default, keeping `require` working.)

- [ ] **Step 2: Create `netlify.toml`:**

```toml
[build]
  publish = "public"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "18"

[functions]
  node_bundler = "esbuild"

[functions."warm"]
  schedule = "*/20 * * * *"
```

- [ ] **Step 3: Update `.gitignore`** — ensure these lines exist: `node_modules/`, `.env`, `temp/`, `.netlify/`.

- [ ] **Step 4: Install deps** — `npm install` → Expected: `node_modules/@netlify/blobs` exists, `package-lock.json` written.

- [ ] **Step 5: Commit** — `git add package.json package-lock.json netlify.toml .gitignore && git commit -m "chore: netlify project scaffolding + @netlify/blobs"`

---

### Task 3: `netlify/functions/parks.js` (park list for the dropdown)

**Files:**
- Create: `netlify/functions/parks.js`
- Create: `netlify/functions/_cache.js` (tiny Blobs helper shared by functions)

**Interfaces:**
- `_cache.js` produces: `getCache(store, key)` → `{ data, fetchedAt } | null`; `setCache(store, key, data)` writes `{ data, fetchedAt: <ms> }`; `fresh(entry, ttlMs)` → boolean. Uses dynamic `import('@netlify/blobs')`.
- `parks` produces HTTP `GET /.netlify/functions/parks` → `{ parks: [{ id, name }] }`, cached 24h.

- [ ] **Step 1: Create `_cache.js`:**

```js
async function store(name) {
  const { getStore } = await import('@netlify/blobs');
  return getStore(name);
}
async function getCache(name, key) {
  const s = await store(name);
  const v = await s.get(key, { type: 'json' });
  return v || null;
}
async function setCache(name, key, data) {
  const s = await store(name);
  await s.setJSON(key, { data, fetchedAt: Date.now() });
}
function fresh(entry, ttlMs) {
  return !!entry && typeof entry.fetchedAt === 'number' && (Date.now() - entry.fetchedAt) < ttlMs;
}
module.exports = { getCache, setCache, fresh };
```

- [ ] **Step 2: Create `parks.js`:**

```js
const nj = require('../../lib/nj-portal');
const { getCache, setCache, fresh } = require('./_cache');
const DAY = 24 * 60 * 60 * 1000;

exports.handler = async () => {
  try {
    const cached = await getCache('parks', 'list');
    if (fresh(cached, DAY)) return json(200, { parks: cached.data });
    const parks = await nj.getParks();
    await setCache('parks', 'list', parks);
    return json(200, { parks });
  } catch (e) {
    const stale = await getCache('parks', 'list');
    if (stale) return json(200, { parks: stale.data, stale: true });
    return json(502, { error: 'Could not load park list' });
  }
};
function json(status, obj) {
  return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}
```

- [ ] **Step 3: Run locally** — `npx netlify dev` then `curl localhost:8888/.netlify/functions/parks` → Expected: JSON with a non-empty `parks` array of `{id,name}`. Second call returns instantly (cache hit).

- [ ] **Step 4: Commit** — `git add netlify/functions/parks.js netlify/functions/_cache.js && git commit -m "feat: parks function with Blobs cache"`

---

### Task 4: `netlify/functions/availability.js` (the core)

**Files:**
- Create: `netlify/functions/availability.js`

**Interfaces:**
- Consumes: `nj.getParks`, park validation, `nj.getParkAvailability(park, start, months, {parallel:true})`, `nj.todayUTC`, `nj.isoUTC`, `nj.addDays`; `_cache` helpers.
- Produces HTTP `GET /.netlify/functions/availability?park=<id>&start=<YYYY-MM-DD>&months=<N>` → `{ parkName, locationId, start, end, alert, generatedAt, sites:[{siteId,shortName,name,type,cost,days}] }`. Validates `park` against the real list; clamps `months` to 1..6; default `start` = today; cache key `avail:<id>:<start>:<months>`, TTL 20m.

- [ ] **Step 1: Create `availability.js`:**

```js
const nj = require('../../lib/nj-portal');
const { getCache, setCache, fresh } = require('./_cache');
const TTL = 20 * 60 * 1000;

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const parks = await nj.getParks();
    const park = parks.find((p) => String(p.id) === String(q.park));
    if (!park) return json(400, { error: 'Unknown or missing park id' });

    let months = parseInt(q.months, 10); if (!Number.isFinite(months)) months = 3;
    months = Math.max(1, Math.min(6, months));

    const start = /^\d{4}-\d{2}-\d{2}$/.test(q.start || '')
      ? new Date(q.start + 'T00:00:00Z') : nj.todayUTC();
    const startIso = nj.isoUTC(start);
    const key = `avail:${park.id}:${startIso}:${months}`;

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
    return json(502, { error: 'Could not load availability right now. Try again shortly.' });
  }
};
function json(status, obj) {
  return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}
```

- [ ] **Step 2: Run locally** — with a real park id from Task 3's `/parks` output:
`curl "localhost:8888/.netlify/functions/availability?park=<id>&months=3"` → Expected: JSON with `sites[]`, each site having a `days` map of `iso→available|booked|closed`. Note response time in logs is **< function timeout**.

- [ ] **Step 3: Verify cache hit** — repeat the same curl → returns instantly; a different `months` re-fetches.

- [ ] **Step 4: Commit** — `git add netlify/functions/availability.js && git commit -m "feat: availability function (parallel fetch + 20m Blobs cache)"`

---

### Task 5: Frontend (`public/index.html`, `public/styles.css`, `public/app.js`)

**Files:**
- Create: `public/index.html`, `public/styles.css`, `public/app.js`

**Interfaces:**
- Consumes: `GET /.netlify/functions/parks`, `GET /.netlify/functions/availability`.
- Reuses (lifted from `tools/nj-campsite-availability.js`): the CSS block (lines 341–406) minus favorites/description rules; the `renderCal`, `monthsBetween`, `iso`, `MON`/`WD`, and bottom-slider logic (lines 435–567). Drives them from the **fetched** payload instead of a baked-in `DATA` const.

- [ ] **Step 1: `index.html`** — header, a control `<div class="bar">` with a park `<select id="parkSel">`, a start-month `<input type="month" id="startSel">`, a window `<select id="monthsSel">` (1,2,3,6; default 3), the legend, a `<div id="status">` for loading/error, `<main id="main">`, and the bottom `slider-bar`. Link `styles.css` and `app.js`.

- [ ] **Step 2: `styles.css`** — paste the CSS from the tool's `<style>` (lines 341–406) EXCEPT the favorites/description rules (`.info-btn*`, `.park-desc*`, `.site.fav*`, `.lbl .star`, `.fav-toggle*`, `body.fav-only*`). Add `#status{padding:14px 22px;font-size:14px}` and a simple spinner style.

- [ ] **Step 3: `app.js`** — on load, fetch `/parks`, fill `#parkSel`. On any control change, call `load()`:

```js
async function load() {
  const park = parkSel.value; if (!park) return;
  const months = monthsSel.value;
  const start = startSel.value ? startSel.value + '-01' : '';
  status.textContent = 'Loading live availability…';
  main.innerHTML = '';
  try {
    const r = await fetch(`/.netlify/functions/availability?park=${encodeURIComponent(park)}&months=${months}${start ? '&start=' + start : ''}`);
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'Request failed');
    status.textContent = '';
    render(d);            // builds the same calendar markup from d.sites/d.start/d.end
  } catch (e) {
    status.textContent = '⚠ ' + e.message;
  }
}
```
`render(d)` reuses `renderCal`/`monthsBetween`/the per-site month-strip markup (lifted from lines 455–500) but **omits** the favorite star, description button, and `applyFavorites` ordering. Then wire the bottom slider exactly as lines 534–558, and the click/date-pick highlight (lines 560–567), recomputed after each `render`.

- [ ] **Step 4: Manual verify in `netlify dev`** — open `localhost:8888`, pick a park → spinner → calendar renders (green/red/grey, click highlights a day, slider scrolls months). Pick **Allaire** → closure banner shows. Break the URL (bad park id via devtools) → clean `⚠` message, no crash.

- [ ] **Step 5: Commit** — `git add public/ && git commit -m "feat: public frontend (park picker + live calendar)"`

---

### Task 6: Scheduled `warm` function + simple rate-limit

**Files:**
- Create: `netlify/functions/warm.js`
- Modify: `netlify/functions/availability.js` (add a global rate-limit guard)

**Interfaces:**
- `warm` consumes the same `availability` fetch path for a hardcoded popular-park name list; runs on the `netlify.toml` schedule (Task 2). No HTTP response needed.

- [ ] **Step 1: Create `warm.js`** — resolve a small name list, fetch + cache each (sequential, polite):

```js
const nj = require('../../lib/nj-portal');
const { setCache } = require('./_cache');
const POPULAR = ['High Point', 'Stokes', 'Wharton', 'Bass River'];

exports.handler = async () => {
  const parks = await nj.getParks();
  for (const name of POPULAR) {
    const hits = await nj.resolvePark(name);
    if (hits.length !== 1) continue;
    const park = hits[0];
    const start = nj.todayUTC(); const months = 3;
    const key = `avail:${park.id}:${nj.isoUTC(start)}:${months}`;
    try {
      const avail = await nj.getParkAvailability(park, start, months, { parallel: true });
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
```
NOTE: keep the warm key formula **identical** to `availability.js` so visitor reads hit the same entry.

- [ ] **Step 2: Add a coarse rate-limit to `availability.js`** — before the live fetch, increment a per-minute Blobs counter and short-circuit if over a cap (e.g. 30 cold fetches/min globally), returning stale cache if present else `429`. Keep it simple; the cache already absorbs most load.

- [ ] **Step 3: Verify** — `netlify dev`, then `npx netlify functions:invoke warm` → Expected: `warmed`; afterwards a `/availability` call for High Point returns instantly (cache pre-populated).

- [ ] **Step 4: Commit** — `git add netlify/functions/warm.js netlify/functions/availability.js && git commit -m "feat: scheduled warm-up + availability rate-limit"`

---

### Task 7: Deploy + live verification

- [ ] **Step 1:** Confirm repo is a git repo (`git init` + initial commit if not), push to a new GitHub repo.
- [ ] **Step 2:** In Netlify: "Add new site → Import from GitHub", pick the repo. Build settings come from `netlify.toml`. Deploy.
- [ ] **Step 3:** On the live URL: pick several parks → live calendars; closed park shows banner; repeat-pick is instant (cache).
- [ ] **Step 4:** In Netlify → Functions, confirm `warm` shows scheduled invocations every ~20 min and popular parks load instantly for a fresh visitor.
- [ ] **Step 5:** Final commit/tag if desired.

---

## Verification (end-to-end)
- `node --test test/` → unit tests pass (Task 1).
- `node tools/nj-campsite-availability.js --rebuild` → personal CLI still builds (no regression).
- `netlify dev` → `/parks` and `/availability` return correct JSON; second calls are instant; frontend renders, highlights, scrolls; Allaire shows closure banner; bad input shows a clean error.
- `netlify functions:invoke warm` pre-warms popular parks.
- Deployed site behaves the same on the public URL; scheduled `warm` visible in logs.

## Self-Review notes
- **Spec coverage:** §4 architecture→Tasks 1,3,4; §4.1 parallel/timeout→Task 1 Step 2 + Task 4 (`parallel:true`, clamp 6); §4.2 hybrid triggers→Tasks 4 (on-demand) + 6 (scheduled); §5.1 shared module→Task 1; §5.2/5.3/5.4 functions→Tasks 3/4/6; §5.5 frontend→Task 5; §5.6 plumbing→Task 2; §7 politeness→Tasks 4 (TTL), 6 (rate-limit), shared `UA`; §8 errors→Tasks 3/4 catch + Task 5 Step 4.
- **Type consistency:** cache entry shape `{data,fetchedAt}` and key formula `avail:<id>:<start>:<months>` are identical in `availability.js` and `warm.js`; `getParkAvailability` return shape unchanged across CLI and functions.
- **No favorites layer** carried into `public/` (Global Constraints) — Task 5 Steps 2–3 explicitly strip it.
