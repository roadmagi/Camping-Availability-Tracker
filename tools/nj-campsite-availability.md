# Tool: nj-campsite-availability.js

Checks live campsite availability on the New Jersey state-park reservation portal
(`njportal.com/DEP/NJOutdoors`) and renders an interactive, color-coded HTML
calendar for your favorite sites across multiple parks.

**Read-only.** It only *views* availability. It never books, pays, or logs in.

## What it does

1. Reads your favorites from [`../config/preferred-sites.json`](../config/preferred-sites.json)
   (parks + site numbers, plus default `months` / `startDateDefault`).
2. For each park: resolves the park name → `locationId`, opens a session
   (cookie + anti-forgery token), and calls the portal's
   `Park/ListSiteAvailabilityJson` endpoint in ~28-day windows to cover the range.
3. Computes each day's status per site: **available** (nothing blocking),
   **booked**, or **closed/unavailable** (seasonal/non-seasonal/locked/inactive).
4. Writes one self-contained calendar to
   `../temp/outputs/campsite-availability/availability-YYYY-MM-DD.html`.

## Inputs / Outputs

- **Input:** `config/preferred-sites.json` and/or CLI flags (below).
- **Output:** an HTML file (open in a browser; no server needed). Green = available,
  red = booked, grey = closed. **Click a green day** (or use the date picker) to see
  which park + site is open that day.
- **Secrets:** none. No `.env` entry required. No login.

## How to invoke

```bash
# Build the calendar from your stored favorites (the everyday command):
node tools/nj-campsite-availability.js

# Manage your stored favorites (no JSON editing needed):
node tools/nj-campsite-availability.js --list
node tools/nj-campsite-availability.js --add --park "High Point" --sites 1,2,3
node tools/nj-campsite-availability.js --remove --park "High Point" --sites 2
node tools/nj-campsite-availability.js --remove --park "High Point"     # remove whole park

# Discover parks and site numbers:
node tools/nj-campsite-availability.js --list-parks
node tools/nj-campsite-availability.js --list-sites --park "Stokes"

# One-off check without saving to config:
node tools/nj-campsite-availability.js --park "High Point" --sites 1,2,3

# Override the window on any build:
node tools/nj-campsite-availability.js --start 2026-08-01 --months 12
```

## Notes & edge cases

- **Site numbers** are matched loosely: `1` matches the portal's `001`. If a number
  you list isn't found at that park, the run prints a `⚠` warning — use
  `--list-sites --park "<name>"` to find the correct number.
- **Park names** are fuzzy/case-insensitive (`"high point"` → `HIGH POINT STATE PARK`).
  Ambiguous names list the matches and stop.
- **Closure notices**: if a park posts a closure/alert banner (e.g. Allaire's
  "Family Campsites and Shelters Closed due to capital improvements"), it is shown
  at the top of that park's calendar section and printed to the console during the
  run — so an all-grey calendar reads as "park closed", not "tool broken".
- The portal returns ~30 days per request, so a 12-month build makes ~13 requests
  per park (a small polite delay between each). More parks/months = a longer run.
- **Calendar layout**: each site shows its months in a horizontal strip — about 7
  months fit on screen and the rest scroll right; all sites scroll together.
  The default window is 12 months (set via `months` in the config).
- Dates are parsed in UTC to keep calendar days correct.
- Requires Node 18+ or Bun (uses built-in `fetch`); no npm install.
