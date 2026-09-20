# Epic — distances, bands and reach: everything that is built

Written 20 September 2026, from the code and from production, as a record to carry into Claude Chat.
Nothing here is remembered or assumed: every claim has a file and a line, and every number was measured on the live API today.

---

## 0. The idea, in your words

> Owner, 17 September 2026: "We could calculate the distance to all the other postcodes within a 30-minute or 60-minute distance, and then we will know the postcode of each of the locations that we surface. Therefore, instead of having to do map distance calculations every time someone does a search, we will already hold and know instantly which activities are within their particular area. Please let me know whether that's doable."

It was doable, it was built the same day, and it is live. This document says exactly how much of it is built, what is not, and whether it pays.

---

## 1. The unit: the postcode sector

- A cell is a **postcode sector** — `SL4 1`, the district plus the first character of the incode.
- About **eleven thousand** in Britain. The alternatives were measured and rejected: 2,980 districts (a rural district is twenty kilometres across — too coarse) and 1.8 million units (far too many to pair up).
- Sectors are drawn around **people**, not land, so they are small where places are dense and large where there is nothing. That is exactly the behaviour a catchment wants.
- The code **carries its scheme**: `sector:SL4 1`. A postcode sector is a British idea; France has communes, the United States has ZIPs of a quite different size. `grid:` and `h3:` land in the same column with no migration and nothing downstream learns a second shape.
- A sector's **centre is a running mean** of every postcode we have seen inside it, so it improves as more places are indexed. `points` carries the count that makes the mean work.

`apps/api/src/domain/reach.js` · `sectorOf()`, `cellCode()`, `recentre()`

---

## 2. The tables

Migrations **139** (`the_map_is_worked_out_once`), **140** (`a_cell_says_what_it_was_built_to`), **141** (`a_marker_remembers_where_the_cell_was`).

| Table | What it holds |
|---|---|
| `geo_cells` | One row per sector: code, scheme, label, country, outcode, lat/lng (the running mean), `points`, `places`, source |
| `reach` | **The matrix.** `(from_cell, to_cell, mode) → minutes, km, method`. Primary key on the three; index on `(from_cell, mode, minutes) include (to_cell, km)` so "everything within 30 minutes of here" never reads a row further away |
| `place_cells` | Which cell each place sits in, keyed on `venue_ref`, with the postcode beside it. `cell` is **nullable on purpose** — a place in the sea, outside the UK, or two miles from the nearest postcode gets a row with no cell and is never asked about again |
| `cell_builds` | What each origin was actually built to (mode, cap, pairs, method, and where the centre was when it was built) |
| `reach_runs` | One build of the matrix, so a run that stopped halfway can be told from an area that is genuinely thin |

---

## 3. The numbers: what is actually in production today (20 Sep 2026)

Read live from `GET /api/admin/reach`:

- **6,205 sectors** held
- **3,240,775 pairs** in the matrix
- **27,385 places stamped** into a cell
- **638 places unplaceable** (no postcode we could resolve — remembered as such, never asked about again)
- Mode built: **driving only**, to a cap of **95 minutes**
- `needsRebuild: []` — nothing is short

The first build, for comparison (recorded in Technical Constraints §13.21): 1,296 places into 590 sectors, 244,798 pairs, **six seconds** to build, **1.5–3ms** to answer.

### The ballparks, measured from Ascot (`sector:SL5 7`) today

| Asked | Sectors in reach | Places in reach |
|---|---|---|
| 5 min | 2 | 115 |
| 15 min | 26 | 758 |
| 30 min | 174 | 2,868 |
| 45 min | 380 | 5,724 |
| 60 min | 753 | 7,903 |
| 90 min | 1,085 | 9,887 |

Round trip from a laptop to Railway, including the network: **49–57ms** for the cell list, **123–147ms** with the place refs joined. The database work inside that is the 1.5–3ms above; the rest is the Atlantic and the gateway.

**This is the thing you described.** We already know, instantly and for nothing, that half an hour's drive from Ascot contains 2,868 places we hold, in 174 sectors.

---

## 4. Where the minutes come from

`apps/api/src/domain/travel.js` — `estimateTravelMinutes(from, to, mode)`.

Not a router. A straight-line distance, a **detour factor**, and a speed that **climbs smoothly with the distance**:

| Mode | Town km/h | Open km/h | Ramp km | Detour | Fixed overhead |
|---|---|---|---|---|---|
| walking | 4.8 | 4.8 | 1 | 1.15 | 0 min |
| cycling | 15 | 18 | 8 | 1.2 | 2 min |
| driving | **32.5** | **102** | **32** | **1.4** | **3 min** | ← fitted 20 Sep 2026
| transit | 22 | 45 | 10 | 1.35 | 8 min (18 min beyond 8km — beyond city scale, transit means rail) |

The smooth curve exists because the two-speed version had a **step at 15km** that you found from orbit (6 Sep 2026: a twenty-mile run to Crystal Palace came back with one restaurant and no activities). 14.9km scored 45 minutes and 15.1km scored 26. A place standing *on the road* halfway along a 38km drive came out 24 minutes off it.

**Those driving numbers were wrong until 20 September 2026, and it mattered.** They were assumed, not measured. Routed against Google Routes on 473 random sector pairs, free of traffic, Epic **overstated three driving journeys in four** — five minutes at the median, up to thirty-five on a long one, and the bias grew with distance (−1.6 min on a quarter-hour hop, −15.9 on an hour and a half). Overstating a journey never shows a household a wrong number: it shows them **fewer places**, because every list is fenced on that number. Crystal Palace (6 Sep) and Bristol (12 Sep) were the same fault reported twice.

The four driving numbers are now fitted — absolute error as the loss, so the sea-loch pairs cannot drag the curve — and **tested on 393 further pairs from 90 origins the fit never saw**:

| on the holdout | old | new |
|---|---|---|
| journeys overstated | 74.8% | **41.2%** |
| wrongly out of reach at a 5-min allowance | 37.4% | **10.2%** |
| allowance needed to cover 95% of pairs | 20 min | **7 min** |
| median absolute error | 5 min | **3 min** |

Walking, cycling and transit are untouched: only driving was measured.

**The limitation the fit cannot reach.** About one pair in eight has a road more than 1.8× its straight line — the Firth of Clyde, the Wester Ross sea lochs, the estuaries, the islands. PA16 7 → G84 0 is 21 minutes by our arithmetic and 90 by road. No speed curve fixes water. Accepted as a known limitation (owner, 20 Sep 2026): the planning paths buy a real road time for what they are about to show and drop these; the browsing paths have no exact pass, so for those places the number on screen is simply wrong. A road network is the only real fix.

**The matrix deliberately uses the same function every list in the app is already fenced with.** A matrix that disagreed with the fence would offer a place the next pass then threw away, and nobody could see why. Every row carries `method = 'estimate'`; a real road-network build would write `'osrm'` and the screens can then say which they are looking at.

---

## 5. The three rules that make it safe

1. **The matrix is the filter, never the answer.** Centre-to-centre is an approximation — good in a city, loose in rural Wales. It decides *which* places are candidates; the final list is still ordered by the real distance to each place.
2. **Be generous at the edge.** The ring is built and read **five minutes wider than asked** (`EDGE_MINUTES = 5`). A place near the edge of its sector can be inside the limit while its sector's centre is outside it. The exact pass can throw a place away; it can never go and find one the matrix never offered, so the asymmetry has to be paid for in the matrix.
3. **The horizon is wider than the cap.** `CAP_MINUTES = 90`, `HORIZON_MINUTES = 95`. Building to the same ninety the cap allows would quietly cancel the allowance at the one distance it is most needed. (Codex caught this, 17 Sep 2026.)

---

## 6. The three passes

| Pass | What it does | Cost | Resumable? |
|---|---|---|---|
| **stamp** | Every place gets a postcode from ONS via postcodes.io, in batches of 100, and therefore a cell | £0 — Open Government Licence | Yes: a place with a row in `place_cells` is never asked about again |
| **build** | Every cell gets its neighbours within the horizon | £0 — pure arithmetic, **no network at all** | Rebuilt from scratch rather than patched, like `score()` |
| **read** | A search asks for the cells within N minutes | One indexed range read | The only one that runs while somebody is waiting |

**It keeps itself up to date.** `refresh()` runs from the hourly sweep in `server.js` and again after every area sweep. It stamps what is unstamped and works out neighbours only for cells that have none — seconds, not minutes. It **writes both directions at once**: a new cell needs its own neighbours *and* a row from each of them pointing back, or the places in a newly swept town are invisible to every search that does not start inside it.

**The centre moving invalidates the build.** If a sector's mean centre drifts more than **250m** from where it was when its rows were calculated, that cell's `cell_builds` marker is deleted and it is worked out again. The comparison is against the centre the rows were built from, not the last nudge — forty stamps moving the mean twenty metres each would otherwise never trip a threshold while the cell ended up the better part of a kilometre from where its rows were calculated.

**Completeness is recorded, never inferred.** `max(minutes)` is not a cap anybody built to. A complete build over sparse cells reads as short; an interrupted rebuild reads as finished the moment one origin produces one far-off row. So `cell_builds` holds it per origin, and the **run row** is what proves a build reached the end.

---

## 7. The endpoints

All behind the admin door (`requires('view_library')` to read, `manage_library` to write). `apps/api/src/routes/reach.js`, mounted at `/api/admin/reach`.

| Call | What it answers |
|---|---|
| `GET /` | What has been built: cells, pairs, stamped, unplaced, per-mode caps, `needsRebuild` |
| `GET /at?lat=&lng=` | Which cell a point falls in — or the nearest one we hold, with the distance said out loud |
| `GET /from?cell=&minutes=&mode=&places=1` | Everything within reach, and optionally the place refs in it |
| `GET /sector?postcode=` | The sector a postcode belongs to. Free and pure |
| `POST /stamp` | Give every place a postcode. Background, resumable |
| `POST /build` | Work the matrix out. No network, no spend, run it as often as you like |
| `POST /refresh` | Bring it up to date without rebuilding |

---

## 8. The bands

**In the code today the band set is `[5, 30, 60, 90]`** — `apps/api/src/routes/placeIndex.js:244` and `apps/web/src/admin/screens/Places.tsx:75`. The first one is the default, which is your note of 20 September ("5 minutes, which should be the default"); it used to be 30, so a postcode with nothing said drew half an hour's drive under a chooser nobody had been asked.

There is a **second, unused band list** — `BANDS = [15, 30, 45, 60, 90]` in `domain/reach.js:68` with a `bandFor()` beside it. Nothing imports either. It is the leftover of the rolled-up-counts design that was never built (§10).

**The matrix itself is not banded.** It stores the exact estimated minutes for every pair and indexes on minutes, so any number between 1 and 90 is one range read. The bands are a chooser on a screen, not a constraint in the data. Adding 15 minutes to the live set is a one-line change in two files.

---

## 9. The second half: tightening up the ones we actually show

This is the part of your logic that says "in the background we can then tighten it up by calculating exact distances for the 20 or so activities we show". It exists — **in two places, not everywhere**.

**Where real road times are bought** (Google Routes, `apps/api/src/sources/routing.js`):

- **The plan pool** (`routes/plan.js:628`): the nearest **60** by estimate get a real road time from one route-matrix call; the far tail keeps its estimate and is nearly always dropped by the reach filter anyway. The cap is `MATRIX_MAX`, env `EPIC_MATRIX_MAX`, default 60. It exists because **200 of these on every plan was three quarters of a day's allowance** — that is the breach of 4 September 2026.
- **The taste tables** (`routes/tastes.js:152`): the finalists only — four places — get one matrix call. The estimate shortlist is deliberately generous (`capMinutes × 1.2`) and the real drive decides.
- **A trip's day** (`routes/journey.js`): each leg is routed individually, cached in process for six hours, because a matrix would bill N² elements when a reorder only creates a handful of new pairs.

**The quota discipline around it:** a 429 pauses that *method* (matrix and route have separate quotas) for 5, then 15, then 60, then 240 minutes, never past the daily reset at midnight Pacific. Every fallback is flagged `travelEstimated: true` and the screen says so in plain words — "a road is longer than a straight line" — never a provider error.

**Where real road times are *not* bought:** Inspire, Places and Discover. They run `estimateTravelMinutes` over the whole pool and show the estimate. That is a deliberate saving, not an oversight, but it means the "tighten the twenty we show" rule is **implemented on the planning paths and not on the browsing ones**.

---

## 10. What is *not* built

Honest list, so nothing in the Claude Chat record reads as done when it is not.

1. **Precomputed counts (`reach_stats`).** The design said: precompute "soft plays within 30 min of SL4 1" so it is one row read. It was never built. Counts today are a live join of `reach` against `place_cells` — fast (the measurements in §3), but a join per read rather than a single stored number.
2. **The walking matrix.** Only `driving` is built. The hourly refresh only ever asks for driving. Walking is computed live — a mile or two, and cheap — and transit **cannot be one number** (08:30 and 23:00 are different journeys), so it stays estimated and labelled until a real isochrone provider exists.
3. **The OSRM road-network build.** Designed and costed: self-hosted OSRM's `table` service over the GB extract, eleven thousand calls, hours of compute, **£0**. Through Google Routes the same matrix is tens of thousands of pounds. It has not been run. Until it is, every stored minute is an estimate.
4. **The household app does not use the matrix at all.** Every importer of `repositories/reach.js` is the back office (`routes/placeIndex.js`, `routes/reach.js`), the sweep, or the hourly refresh. Inspire and Places still compute distances per row.
5. **The matrix does not shape the Google call.** When we ask Google for an area we bound it with `reachRadiusKm(mode, minutes)` — a straight-line radius derived from the minutes — not with the cells in reach. So the matrix currently saves us *our own* arithmetic and *Routes* elements; it does not yet save a single Places request.
6. **638 places have no cell.** They are remembered as unplaceable and are invisible to every ring query.
7. **The 15-minute band** you asked for is not in the live set.

---

## 11. Is it in "How it works"? — Yes, one entry, and one gap

`apps/web/src/admin/screens/HowItWorks.tsx`, section **"How fast it is, and what makes it slow"**:

> **The map is worked out once, not on every search** — *live*
> "Every place Epic holds is given a postcode sector — SL4 1, the district plus one character — and the travel time between every pair of sectors within ninety minutes is worked out once and kept. A catchment is then a lookup rather than a calculation: everything within thirty minutes of Windsor comes back in about two milliseconds, with no arithmetic and no provider call. The matrix is the filter; a list is still ordered by the exact distance to each place, so being a little generous at the edge costs nothing."
> *Where:* `domain/reach.js · repositories/reach.js · migration 139` — and your words of 17 Sep 2026 are quoted under it.

Also on that screen, related:
- **"When Google Routes refuses for want of quota"** — the per-method backoff and the plain-words fallback.
- **The beds entry** — why five intersected isochrones buy nothing and the ordering is done from what is already in memory.
- **A live banner at the top of the page** that reads the API and says whether travel times are real *right now* or worked out from the distance.

**The gap:** there is **no entry for the second half of your logic** — that only the ones we are about to show get a real road time, that the cap is 60 on a plan and 4 on a taste table, and why. That rule is the one that stopped the quota breach recurring and it is not written down on that screen.

The fuller version is in `docs/technical-constraints.md` **§13.21**, which is the governing text.

---

## 12. Does it actually pay? — Yes, but not for the reason it is easiest to assume

**Where the money is.**

- Building the matrix is **£0**: our own arithmetic over ONS postcodes (Open Government Licence) and open coordinates. Nothing licensed goes near it. Buying the same 3.24 million pairs from a routing provider would be **tens of thousands of pounds**.
- It does **not** reduce Google **Places** spend. Google bills per search request, not per distance, and we still bound those with a radius rather than with cells (§10.5).
- It **does** reduce Google **Routes** spend, and that is where the saving is real and already banked: Routes bills per origin×destination element. The coarse filter is what makes "only route the sixty we might show" and "only route the four we will show" possible. Two hundred elements per plan was three quarters of a day's quota. That is the breach you hit on 4 September, and this is the shape that prevents it.

**Where the speed is.** A catchment stops being a distance computed for every row and becomes one indexed range read — 1.5–3ms. That matters less at 27,000 places than it will at several million, which is the real argument: **a distance computed per row cannot survive millions of rows in several countries.** The matrix is the thing that makes the index scale rather than the thing that makes today fast.

**What it does not buy, and this matters for the Claude Chat record.** Precomputing an estimate does not make the estimate accurate. The bands are ballparks and must stay labelled as ballparks; the accuracy still comes entirely from the exact pass on the handful we show. If you want the ballpark itself to be close to true, the answer is the OSRM build — hours of compute, £0, and every row then says `osrm` instead of `estimate`.

**So: yes.** It is free, it is already live, it already prevents the one provider bill that actually ran away, and it is the only version of this that survives the index getting big. The three things that would make it pay considerably more are, in order:

1. **Wire the household app to it.** Today only the back office reads the matrix. Inspire and Places still compute per row — the exact thing the matrix exists to stop.
2. **Use the cells to bound the Google call — for relevance, not for the bill.** "These 174 sectors are in reach, and we already hold 2,868 places in them" is a much better opening position for deciding *what* to buy than a radius in kilometres. It does not make the buying cheaper: Google bills per request and takes one box per request, so a cleverer box buys a better twenty, not a smaller invoice. Any saving has to come from asking fewer times, not from asking more precisely.
3. **Run OSRM.** £0, hours, and the ballpark stops being a straight line with a fudge factor.
