# Workflow: Check NJ Campsite Availability

## Goal
Show, on a clickable color-coded calendar, which of your preferred campsites —
across one or more New Jersey state parks — are available on which days, so you
can pick a date and instantly see which park has a site open. **Read-only:** this
workflow only views availability; it never books, pays, or logs in.

## Inputs
- **[`config/preferred-sites.json`](../config/preferred-sites.json)** — your stored
  favorites: each park and its site numbers, plus default `months` and optional
  `startDateDefault`. This is the only required input for a normal run.
- Optional overrides at run time: `--start YYYY-MM-DD`, `--months N`.

## Tool
All steps use **[`tools/nj-campsite-availability.js`](../tools/nj-campsite-availability.js)**
(see its doc, [`tools/nj-campsite-availability.md`](../tools/nj-campsite-availability.md)).

## Steps

1. **(First time / when adding a park) Find your site numbers.**
   Run `node tools/nj-campsite-availability.js --list-parks` to see every NJ park,
   then `node tools/nj-campsite-availability.js --list-sites --park "<name>"` to
   list that park's site numbers (e.g. `#001 Sawmill`).

2. **Store your favorites.** Add them with
   `node tools/nj-campsite-availability.js --add --park "<name>" --sites 1,2,3`
   (repeat per park). Review anytime with `--list`; adjust with `--remove`.
   Numbers are saved to `config/preferred-sites.json`.

3. **Build the calendar.** Run `node tools/nj-campsite-availability.js`
   (add `--months 12` or `--start 2026-08-01` to override defaults). The tool fetches
   live availability for every stored park/site and writes the HTML calendar.

4. **Open and use it.** Open the generated file (Step output below) in a browser.
   Green = available, red = booked, grey = closed/unavailable. **Click a green day**
   (or use the date picker) to see a cross-park summary of which sites are open that day.

## Output
`temp/outputs/campsite-availability/availability-YYYY-MM-DD.html` — a self-contained,
interactive calendar grouped by park, one row per preferred site. No server needed;
opens straight from the folder.

## Notes / edge cases
- A site number you list but that doesn't exist at the park prints a `⚠` warning;
  use `--list-sites` to find the right number.
- The portal serves ~30 days per request, so longer windows / more parks take longer
  (≈13 requests per park for the 12-month default, with a brief polite delay between each).
- No credentials needed — availability is public. The workflow never reserves a site;
  to actually book, use the portal directly.
- `/temp/` is disposable: the HTML is a regenerated artifact, but your favorites in
  `config/preferred-sites.json` persist.
