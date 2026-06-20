# Design Spec — Public Web "NJ Campsite Availability" (Netlify)

**Date:** 2026-06-20
**Status:** Approved design, pre-implementation
**Author:** Claude Code (brainstorming session)

---

## 1. Context & Problem

The current tool (`tools/nj-campsite-availability.js`) is a **personal local
script**. It fetches live availability from New Jersey's reservation portal
(`njportal.com/DEP/NJOutdoors`) and **bakes a frozen snapshot into a static HTML
file**.

That artifact cannot serve live data to the public: a deployed static page does no
fetching of its own. Browser-side calls to njportal are blocked by **CORS**, and
the portal additionally requires a server-side **session cookie + anti-forgery
token** handshake that a static page cannot perform.

**Goal:** a public website where **any visitor selects an NJ state park and sees
that park's live per-site availability**, with data **cached ~15–30 minutes** so
loads are fast and the portal is not overloaded.

## 2. Scope

**In scope**
- Visitor selects a park from the full NJ park list and a start month + window.
- Live (cached) availability for that park, rendered as a color-coded calendar.
- Hosted publicly on **Netlify**.

**Out of scope (YAGNI)**
- Per-visitor favorites, logins/accounts, booking/payment.
- A database (Netlify Blobs is the only persistence).
- All-parks precompute.
- The personal tool's favorites / Korean descriptions layer.

## 3. Known Risk (accepted)

Scraping NJ's official reservation portal on behalf of the public likely violates
the portal's Terms of Service. The design **minimizes** harm (caching as a hard
throttle, rate-limiting, an honest User-Agent) but **cannot eliminate** the risk;
NJ could block traffic or request takedown. The user has accepted this to proceed.

## 4. Architecture — On-demand Function + Cache (Approach A)

```
Browser (static page)
   │  GET /availability?park=&start=&months=
   ▼
Netlify Function ── cache hit (<~20 min)? ──► return cached JSON  (instant)
   │  miss / stale
   ▼
njportal  (parallel window fetches)  ──► store in Netlify Blobs ──► return JSON
```

njportal is contacted **at most once per park per ~20 minutes**, independent of how
many visitors are browsing.

### 4.1 Latency / timeout strategy
One park currently needs ~8 window requests done **sequentially** with polite
delays → 20–60s, but Netlify sync functions time out around 10s. Solved by:
- **Parallelizing** the per-park window fetches (~3–8s).
- **Public default window = 3 months, max 6** (fewer windows per fetch) vs the
  personal tool's 8.

### 4.2 What triggers a live fetch (hybrid)
There is **no process continuously scraping all parks**. njportal is contacted only:
- **On a visit** — a visitor picks a park whose cache is cold/stale (>~20 min); that
  click triggers the fetch. Fresh cache → no fetch, instant return.
- **On a schedule** — the `warm` function auto-refreshes a *small popular-park list*
  (~every 20 min) with no visitor needed.

Popular parks stay warm automatically; other parks fetch on-demand on first visit
per window; un-visited parks are never fetched.

## 5. Components

### 5.1 `lib/nj-portal.js` (shared module)
Refactor portal internals out of `tools/nj-campsite-availability.js` into a
reusable, side-effect-free module exporting:
`getParks`, `resolvePark`, `getSession`, `fetchWindow`, `getParkAvailability`,
`extractAlert`, plus date helpers (`parseNetDate`, `isoUTC`, `mmddyyyy`, `addDays`,
`todayUTC`) and `normSite`. No CLI parsing, no HTML generation.

- The existing CLI tool is updated to `require('../lib/nj-portal')` and **keeps its
  current behavior** (sequential polite fetch, HTML snapshot output).
- Add `fetchAllWindowsParallel(...)` (or a `parallel` option on
  `getParkAvailability`) used by the backend; the CLI keeps the polite sequential
  path.

### 5.2 `netlify/functions/parks.js`
GET → `getParks()` → list of `{ id, name }` for the dropdown. Cached in Blobs with
a long (~daily) TTL.

### 5.3 `netlify/functions/availability.js`
GET `?park=<id>&start=<iso>&months=N`.
- Validate `park` against the real park list; clamp `months ≤ 6`; default
  `start = today`.
- Cache key `avail:<parkId>:<startMonth>:<months>`. Fresh (<~20 min) → return
  cached JSON. Else parallel-fetch, store `{ data, fetchedAt }`, return.
- Payload includes any closure/alert banner (`extractAlert`).
- On portal error: return last cached value if present, else a clean error JSON
  (HTTP 200 with `{ error }` or 5xx — frontend handles both).

### 5.4 `netlify/functions/warm-background.js` (scheduled)
Runs ~every 20 min (schedule in `netlify.toml`). Re-fetches a short hardcoded list
of popular parks (e.g. High Point, Stokes, Wharton, Bass River) into the same cache
keys so common picks are never cold.

### 5.5 Frontend `public/`
Vanilla static — `index.html`, `app.js`, `styles.css` (no framework, no build step).
- Park `<select>` populated from `/parks`; start-month + window controls.
- On selection → `GET /availability` → render the **same color-coded calendar**
  (green = available, red = booked, grey = closed; click-a-day summary; horizontal
  month slider; closure banner) by lifting the render markup + CSS out of
  `buildHtml` and driving it from the **fetched JSON** instead of a baked-in `DATA`
  blob.
- Explicit **loading** and **error** states.
- This is the personal UI **stripped to a general per-park view** — no favorites,
  descriptions, or Korean layer.

### 5.6 Plumbing
- `netlify.toml` — `publish = "public"`, `functions = "netlify/functions"`,
  scheduled-function entry, pinned Node version.
- `package.json` — add `@netlify/blobs`; no build step for vanilla static.
- `.gitignore` — ensure `.env`, `temp/`, `node_modules/` are ignored.
- No secrets/login (portal data is public) → no `.env` keys added.

## 6. Data Flow (per visitor request)
1. Page loads → fetch `/parks` → fill dropdown.
2. Visitor picks a park (+ optional start/window) → fetch `/availability`.
3. Function returns cached JSON (instant) or performs a parallel live fetch
   (~3–8s), caches, returns.
4. Frontend renders the calendar; click a green day → cross-site summary for that
   date within the selected park.

## 7. Politeness & Safety (built-in, not optional)
- **Cache** is the primary throttle: ≤1 portal hit per park per ~20 min.
- **Global rate-limit** on `availability` (Blobs counter or in-memory) to cap burst
  load on the portal.
- Honest, descriptive **User-Agent**; small bounded request bursts, not floods.
- Friendly UI states for: park closed (banner), portal unreachable, no sites found.

## 8. Error Handling
| Condition | Behavior |
|-----------|----------|
| Park closed (alert banner) | Banner shown above grid; grid reads as closed |
| Portal unreachable / 5xx | Serve last cached value if any; else clean error UI |
| Invalid/unknown park param | 400 + message; dropdown only offers valid parks |
| Fetch exceeds budget | Return partial/stale cache if available; log it |

## 9. Verification
1. **Local:** `netlify dev` serves `public/` + functions. Pick a park → live
   calendar; **second load instant** (cache hit); stale park re-fetches after TTL;
   logs show parallel fetch **< timeout**.
2. **Closed park:** Allaire → closure banner + closed grid.
3. **Errors:** break the portal URL → clean error UI, no crash.
4. **Regression:** `node tools/nj-campsite-availability.js --rebuild` still builds
   the personal HTML (shared-module refactor intact).
5. **Deploy:** push to GitHub → connect Netlify → deploy; repeat on the live URL;
   confirm scheduled `warm` runs (function logs) and popular parks load instantly.

## 10. Build Order
1. Extract `lib/nj-portal.js`; repoint the CLI; verify no regression.
2. `availability` + `parks` functions + Blobs caching; test with `netlify dev`.
3. Frontend rendering from the function; loading/error states.
4. `warm` scheduled function + rate-limit.
5. `netlify.toml` / `package.json`; deploy + live verification.
