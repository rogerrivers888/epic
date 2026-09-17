# Epic — Places, Collect and Demand
## Build brief, 17 September 2026

**One sentence.** Five back-office screens that are each bound to a different table
become three that are each bound to a different question — *what do we have here*,
*go and get more*, *what did people ask for and did it work* — on top of one written-down
index of every place Epic knows about.

Owner, 17 Sep 2026: "It feels like, from one screen, I may be able to do all of this,
but just putting different lenses on this… Our big problem in this business is data.
It doesn't matter how good the app looks if the data we provide is not good."

Owner, same day, on the merge: "Agreed. Atlas and sweep dissolve into Places plus
Collect. Just make sure we don't lose any behaviour." §2 is that inventory and it is
a contract: **nothing in it may be dropped without asking him.**

Names in this brief (Places / Collect / Demand) are working titles. He has said the
naming is his and Claude Design's to settle once he can see UI.

---

## 1. Why, in terms of what the code does today

| Screen | Reads | What it is |
|---|---|---|
| Atlas — `/admin/library` | `attractions`, `image_assets` | A harvest: top 15–20 attractions per UK region from Wikidata/Wikipedia/Commons, ranked, with owned pictures. Attractions only. |
| The sweep — `/admin/scout` | `scout_areas`, `scout_places` | A different harvest: a food census of one outcode from OSM + Google Text Search, chains dropped, ratings banded and the figure discarded, menus crawled. Food only. |
| Coverage — `/admin/coverage` | `attractions` ∪ `scout_places` | A geography lens over those two harvests and nothing else. |
| Places — `/admin/places` | same union | The same lens at close range, plus the per-place inspector. |
| Lookup — `/admin/lookup` | **nothing** — a live ring search | OSM + Google + atlas + sweep + `place_records`, asked afresh every time, held only in process memory. |

Three consequences, all of which this work exists to fix:

1. **Coverage and Places cannot see owned records or anything Google knows that we
   have not harvested.** `repositories/localities.js` counts over `attractions` and
   `scout_places` only. So "how many places do we know about here, and how many do we
   own" is currently unanswerable on any screen.
2. **Lookup stores nothing**, so it cannot be compared with anything, cannot be
   ranked by demand, and re-asks the providers for every question.
3. **It already breaks.** `GET /api/admin/lookup/place` (`apps/api/src/routes/lookup.js:332`)
   does not look a place up — it re-runs the whole ring search and then hunts for the
   ref in the new results. The search cache is in-process, 12 h, 300 entries, wiped by
   every deploy (`apps/api/src/sources/cache.js:19`), and Google's nearby search caps at
   20 per group. Miss either and the endpoint 404s and the screen prints "Could not
   open it." The owner hit this on a Google row and on Thorpe Park. **Do not patch the
   404 — Part A removes the re-search.**

---

## 2. Behaviour inventory — nothing here may be lost

Everything below exists today and must be reachable after the merge. Where it moves,
the new home is named. Where it is dropped, that is a question for the owner, not a
decision for the implementer (CLAUDE.md: never remove without asking).

### From Atlas (`admin/screens/Library.tsx`, 989 lines)
1. **Coverage of the 107 UK regions** against each region's `target_count`, harvest
   state per region, and the button that runs the harvest → **Collect**.
2. **Harvest runs** (`harvest_runs`), resume-after-deploy and the "Not done yet"
   recovery → **Collect**. The warning that a deploy kills a run in flight must survive.
3. **Attractions for one region**, ranked, with the score's working on each row
   (`score_parts`: sitelinks, pageviews) and **publish / hide / pin + note** → **Places**,
   at the place level. Pinning surviving a re-rank is the mechanism by which a hand
   correction sticks; keep it.
4. **The picture library and its index** — weighted tsvector search, facets, every
   licence field on one picture including the attribution URL **as a link** → **Places**,
   as a section of the place view plus an estate-wide picture search. The owner asked
   for this by name (4 Sep 2026: "some form of index, a proper form of indexing, so we
   can search and find the images that we own").
5. **Uploads** — household-submitted photographs awaiting review, and what each
   contributor has earned (`image_rewards`) → its own section; it is a moderation
   queue, not geography. Propose keeping it under Places as "Uploads".
6. **Types** — the editable Wikidata-type classifier (`place_kinds`) that decides what
   counts as somewhere to go → **Data › Categories** (it is vocabulary).
7. **Reading** (`Reading.tsx`, `visitingEvidence.js`) — the visiting evidence → carries
   over unchanged; confirm its home with the owner.

### From The sweep (`admin/screens/Scout.tsx`, 645 lines)
1. **Areas** — swept outcodes, `seen` / `chains` / `kept`, what each sweep cost, sweep
   again, rescore (free, no network), `next_sweep_at` → **Collect**.
2. **Places for one area**, best first, with the working shown: `roam_score`,
   `owned_score`, `crowd_band`, `count_band`, accolades, dish counts → **Places**.
   **No rating column, ever** — the licensed figure is banded inside `sweepArea()` and
   discarded. "Top"/"high" is our judgement and ours to show.
3. **Menus** — every menu we could not read, grouped by coded cause, with **`ours`
   never merged into the others** (`domain/menuCauses.js`; 132 of the first 341 failures
   were Epic's own bugs) → **Collect**, as the failure report of the menu runs.
4. **The bench** — our ordering against the licensed one, ρ, verdicts stored and
   figures dropped (`source_bench_runs`, migration 055) → **Collect**, beside the
   Sources bench, which is the same idea.

### From Coverage (`admin/screens/Coverage.tsx`)
1. The six-fact grid (picture, description, hours, website, menu, shelf), rows being a
   county **with its towns and the outcodes its own places fall in, together**.
2. Each cell is a percentage *and* a doorway: `/admin/places?where=<slug>&missing=<fact>`.
   **The work queue is a URL somebody can be sent** — this is the whole point of the
   screen and must survive into the new address grammar.
3. Shade is a hint, never the information: every cell prints its own number, tints of
   the one lime, no red-to-green ramp.

### From Places (`admin/screens/Places.tsx`, `PlaceInspector.tsx`)
1. **One picker, one page**, and the page does not change shape for a county, a town or
   a postcode district. `MATCH` in `repositories/localities.js` is the only thing that
   differs (`county→region_slug`, `town→locality_slug`, `postcode→outcode`).
2. **Geography is two ladders, not one.** A town nests under its county; an outcode
   does not (SL4 spans five councils and reaches into Surrey), so it is reached by name
   and offers *the towns its own places sit in* as the way back across. Preserve this.
3. The coverage strip as a click-through at close range; `?where=&missing=` in the address.
4. **The inspector**: hero with credit, every fact with where it came from, all the
   pictures, and **Edit on Category opens a sentence, not a dropdown** — it says how far
   the change would travel ("every amusement park: 45 places, 34 counties") before it saves.

### From Lookup (`admin/screens/Lookup.tsx`, 797 lines)
1. Resolution of a typed place: Photon for areas first, Nominatim for postcodes and
   addresses, `lat,lng` as given. Ring from `reachKm` inverting `estimateTravelMinutes`,
   **capped at 50 km with `capped: true` said on screen**. Travel time is an estimate and
   is labelled as one.
2. **Activities and Food & drink are tabs, not panels.**
3. **Two lenses**: by category (categories down, sources across, click a cell) and by
   source (click Google, see its places with their categories).
4. **The Not-owned column** and its list ranked by `priorityOf` = reviews × (rating ÷ 5)²
   with a Top 20% cut. His rule: count first, stars only as a weight.
5. **Three runs**: Ask Google for ratings, Ask Tripadvisor (**capped at 120 locations a
   month** via `EPIC_LOOKUP_TRIPADVISOR_CAP`), and Curate (`sources/curate.js` — written
   only from the venue's own site, Wikipedia and OSM, **never from provider reviews**) →
   **Collect**, but launchable in place from a selected area in Places.
6. **Compare**: ours beside Google's beside Tripadvisor's, field by field, blank cells
   being the holes he is hunting; one Place Details call per place, held in memory 6 h,
   logged to `provider_calls` as `admin.lookup.compare`.
7. **Each provider's raw record** via `recordsOf(venue)` — "literally the fields that we
   get". Opt-in sources that were not called are listed as "not asked", never as empty.
8. The screen's own design rules, set by the owner on 12 Sep: no bordered panels or
   tiles, hairline rows, **blank cells rather than zeros**, the chosen tab a flat lime
   word, all controls one height (40), light `lineSoft` borders with 8px corners, the
   chevron its own target, search box a fixed width, **legend first**, and drill down
   rather than show everything.

---

## 3. Part A — the place index (build this first; everything else reads it)

### A1. What it is
One row per `venue_ref` for every place Epic has ever seen anywhere, holding
**identifiers and our own derivations only**. This is the thing that makes the other
two parts possible and cheap.

```sql
create table place_index (
  venue_ref     text primary key,        -- 'google:ChIJ…' | 'osm:node/123' | 'atlas:<uuid>'
  lat           double precision,
  lng           double precision,
  country_code  text not null default 'GB',
  -- our derivations, never a provider's content
  category      text,                    -- shelf_categories key
  subcategory   text,                    -- shelf_subcategories key
  derived_by    text,                    -- 'rule:<id>' | 'hand' | 'provider-type'
  ownership     text not null,           -- 'identified' | 'owned' | 'claimed'
  data_score    real,                    -- 0–100, §A4
  ready         boolean,                 -- meets the bar for its own kind, §A4
  score_parts   jsonb not null default '{}',
  oldest_fact   timestamptz,             -- the staleness lens, §A5
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);

create table place_index_sources (
  venue_ref       text not null references place_index(venue_ref) on delete cascade,
  source          text not null,         -- 'google' | 'osm' | 'atlas' | 'sweep' | 'tripadvisor' | 'own'
  source_place_id text not null,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  primary key (venue_ref, source)
);

create table place_areas (
  venue_ref  text not null references place_index(venue_ref) on delete cascade,
  area_slug  text not null references localities(slug) on delete cascade,
  primary key (venue_ref, area_slug)
);
```

`place_areas` is the reason any level works the same way: a place belongs to its
country, its county, its town and its outcode at once, and each of those is one indexed
lookup rather than a different column and a different query.

### A2. The licence rule, stated so it cannot be got wrong
**`place_index` has no name column, and no hours, rating, review, photo or description.**
CLAUDE.md: licensed place content is rented; we store identifiers and household-generated
annotations only. The index's job is to *count and locate*, not to describe.

Names on screen come from where they are already legitimately held:
- an **owned** place → `place_records.name`;
- an **atlas** place → `attractions.name` (Wikipedia/Wikidata, ours to keep);
- an **OSM**-matched place → the OSM name (ODbL, ours to keep) — this is most of them;
- a **Google-only** ref → **fetched at display**, exactly as Lookup does today with its
  6 h in-memory hold, and shown as the bare ref when we have not fetched it.

That last case is a feature: a nameless row in the back office *is* the finding —
it means Google is the only source that has ever seen this place.

### A3. The rollups
```sql
create table area_stats (
  area_slug   text not null,
  category    text,                      -- null = all
  subcategory text,                      -- null = all
  source      text,                      -- null = any
  ownership   text,                      -- null = any
  places      integer not null,
  owned       integer not null,
  ready       integer not null,
  avg_score   real,
  refreshed_at timestamptz not null default now(),
  primary key (area_slug, category, subcategory, source, ownership)
);
```
Every level of the Places screen above the final list reads `area_stats`, never
`place_index`. Selecting a country must not become a `count(*)` over millions of rows at
page load. Refresh on a job after every collect run, and on demand from the screen.

### A4. The data score, and "ready"
The owner: "Whether we have sufficient data to meet our required user needs to be able
to describe the place properly."

- **`data_score`** is a weighted completeness score over the facts a drawer needs, 0–100,
  with `score_parts` showing the working (the same honesty as the atlas's `score_parts`).
- **`ready` is per-category, not a flat six columns.** A restaurant is not ready without
  a menu; a playground never has one and is currently marked down for it forever.
  Define the bar per shelf category in a table the back office can edit, the way
  `place_kinds` is editable. Coverage then means "% of places ready *for what they are*".
- Pure function, in `domain/` with tests, recomputed rather than adjusted — the same
  rule as `score()` in `domain/scoring.js`.

### A5. Staleness
`place_facts` already carries `fetched_at` and `expires_at`. Carry the oldest
contributing fact onto the index row so "hours we last checked fourteen months ago" is
a lens for nearly nothing. Stale is a quality problem that completeness alone never shows.

### A6. Distance at scale — precomputed, not calculated

Owner, 17 Sep 2026: "We could just calculate, for each county, the distance from any
given postcode… say maybe it's even the first four digits of the postcode… We could
calculate the distance to all the other postcodes within a 30-minute or 60-minute
distance… Therefore, instead of having to do map distance calculations every time
someone does a search, we will already hold and know instantly which activities are
within their particular area."

**This is right, it is feasible, and it is cheaper than he thinks.** Build it. Two
refinements: it is done **once nationally**, not per county, and the key is a generic
cell so it survives leaving Britain.

#### The cells
The unit is the **postcode sector** — `SL4 1`, the outcode plus the first character of
the incode. About **11,000 live sectors in Britain**, against 2,980 districts (too
coarse — an outcode can be 20 km across) and 1.8 million units (far too many). Sectors
are population-weighted, so they are small where places are dense and large where
nothing is, which is exactly the behaviour wanted.

Store the key as **text with a scheme prefix** — `sector:SL4 1` — so that a country with
no postcode sectors uses `h3:<index>` or `grid:<x>/<y>` in the same column with no
migration. Every row in `place_index` carries its `cell`, stamped once at index time
from api.postcodes.io (bulk, 100 coordinates a request, keyless, already in use).

#### The matrix
```sql
create table reach (
  from_cell text     not null,
  to_cell   text     not null,
  mode      text     not null default 'drive',
  minutes   smallint not null,
  km        real,
  primary key (from_cell, to_cell, mode)
);
create index on reach (from_cell, mode, minutes) include (to_cell);
```
Pruned at 90 minutes. A sector has on the order of 500–2,000 others within 90 minutes'
drive, so the table is roughly **10–20 million rows, a few hundred megabytes** — nothing
for Postgres. A search then reads `select to_cell from reach where from_cell = $1 and
mode = 'drive' and minutes <= 30`, joins to `place_areas`/`place_index`, and no distance
is computed at request time at all.

#### Computing it, for nothing
Do **not** buy this from a provider: 11,000 × ~1,500 pairs through Google Routes would
be tens of thousands of pounds. Run **OSRM** (or Valhalla) in a container over the
OpenStreetMap Great Britain extract and use its `table` service, which is built for
exactly this — many origins to many destinations in one call. One call per sector with
its ~1,500 straight-line neighbours as destinations, 11,000 calls, **hours on one
machine, £0 in provider spend**. Rebuild yearly, or when the road network changes
materially. The same container answers the fine-grained routing questions in §A6.3.

#### The upgrade that makes it pay twice
Because the reachable set of every sector is now known, the **counts** can be
precomputed too:
```sql
create table reach_stats (
  from_cell text, mode text, band smallint,       -- 15 | 30 | 45 | 60 | 90
  category text, subcategory text, ownership text,
  places integer, owned integer, ready integer, avg_score real,
  refreshed_at timestamptz not null default now(),
  primary key (from_cell, mode, band, category, subcategory, ownership)
);
```
"How many soft plays within 30 minutes of SL4 1, and how many do we own" becomes **one
row read**. Both the household app's ring search and the Places screen's ring level
become instant, and the Demand lens can rank every sector in Britain by unmet demand
without touching a place row.

#### The honest caveats, each with its answer
1. **Centroid to centroid is an approximation.** Fine in cities where sectors are small;
   looser in rural Wales. Answer: the matrix is the **coarse filter**; the final list of
   twenty is ordered by exact straight-line distance, or by a real route call when it
   matters. Two tiers, and the coarse tier is free.
2. **The origin may not be a postcode.** A GPS fix or a town name snaps to the nearest
   sector centroid. The error is smaller than the error already in the travel-time
   estimate, but the screen must keep saying the time is estimated.
3. **Walking is not worth precomputing** — the radius is a mile or two and the
   straight-line answer is good enough. Compute it live.
4. **Transit cannot be one number.** A journey at 08:30 and one at 23:00 are different
   journeys, so transit stays estimated and labelled, exactly as it is today, until a
   timetable provider exists (Technical Constraints §6.2).
5. **A new country needs cells before it needs places.** Stamping `place_index.cell` is
   part of onboarding a country, not an afterthought.

#### The fallback if OSRM is not stood up in v1
Straight-line distance between sector centroids, banded by an assumed road speed — the
same `estimateTravelMinutes` used today, but computed **once per pair and stored**
rather than per request. Every benefit above still holds; only the accuracy is the
current accuracy. **`cube` and `earthdistance` are available on the Postgres image we
run** (checked: 17.11 on Alpine — `postgis` absent, those two present), so a GiST index
on `ll_to_earth(lat, lng)` builds the neighbour lists. Verify the same on Railway with
`select * from pg_available_extensions where name in ('cube','earthdistance')`.

### A7. Filling it
Backfill from `attractions`, `scout_places`, `place_records` and `provider_matches`.
Then write to it from every path that resolves a venue: the sources layer
(`sources/index.js`), the sweep, the harvest, Lookup's runs, and a household claiming a
place. An index that is only filled by a nightly job will always be behind the screen
that reads it.

### A8. What this deletes
`/api/admin/lookup/place` stops re-running the search and reads the index plus
`recordsOf`. The "Could not open it" 404 goes with it.

---

## 4. Part B — Places: one screen, one grammar, every lens

### B1. The address
`src/routes.ts` is the only place a URL is spelled and `src/router.tsx` the only thing
that touches the address bar (CLAUDE.md). A new level is not done until it has a route
in `routes.ts` and a case in `test/routes.test.ts`.

```
/admin/places?where=gb                                  a country
             ?where=berkshire                           a county — no radius needed
             ?where=windsor&within=30&by=drive          a town and its ring
             ?where=sl4                                 an outcode
             …&lens=coverage|category|source|quality|demand
             …&cat=<category>&sub=<subcategory>|none
             …&source=<key>|all&own=owned|identified|not-ready
             …&place=<ref>                              one place
```
Only what differs from the default is written down. A move pushes; a filter replaces.
The owner's rule holds: a county needs no radius, a town or postcode may take one.

### B2. The stat line
Every level prints the same five numbers, so a country, a county, a ring, a category
and a subcategory all read the same way:

**known · owned · identified only · ready · average data score**

"Identified only" is the number he asked for by name: *we know from Google that this
place exists and we own nothing about it.*

### B3. The lenses
- **Coverage** — the six facts, or better, `ready` and its parts. Every cell still a
  doorway (§2 Coverage 2).
- **Category** — the ladder, and **driven by the taxonomy, not by the data**. All 8
  categories and ~51 subcategories are listed with counts left-joined on, so *soft play,
  Berkshire, blank* is a finding rather than an absent row. This inverts how every
  category view we have is currently fetched. Same for labels
  (`taxonomy_labels`, `namespace:key`) — show the ones with nothing.
- **Source** — which providers have seen the places here, and which places only one has.
- **Quality** — data score distribution, staleness, and the not-owned list ranked by
  `priorityOf` (§2 Lookup 4).
- **Demand** — Part D's numbers, in place. *This lens is why Parts A and D belong in one
  programme:* it ranks the gaps by what people actually searched for, so the Google
  budget is not spent enriching an area nobody asks about.

### B4. The final drill-down
One place: our record, Google's and Tripadvisor's field by field (§2 Lookup 6), then
**each provider's raw record** (§2 Lookup 7), plus the atlas's publish/hide/pin, the
pictures with every licence field, and teach-in-place category editing that says how far
the change travels before it saves.

### B5. Design rules
The screen follows the back-office rules the owner set on 12 Sep — no tiles, panels,
pills or outlined chips; hairline rows; blank cells rather than zeros; legend first;
`Section` / `TextAction` / `Choice` / `Dropdown` from `admin/kit.tsx`; `Categories.tsx`
is the reference. Width from `useViewport()`, one tree across layouts, nothing over 390px,
icons from `Icon.tsx` only, colours from `theme.ts` only.

---

## 5. Part C — Collect

Every way of getting more data, in one list: the atlas harvest, the sweep, menu fills
and retries, Ask Google for ratings, Ask Tripadvisor, Curate, the source bench, the
rating bench.

- Each run shows **its cost, its cap, its state, its history and its failures by coded
  cause**, with `ours` never folded into theirs.
- **Launchable from an area you are standing in on Places** — the run is an action on a
  selection, not a separate journey.
- Separate from Places because it spends money, runs for hours and needs `manage_library`
  / `manage_settings` rather than `view_library`. Different rhythm, different risk.
- Provider caps and the ledger are unchanged: every outbound call attributed in
  `provider_calls` with its purpose, and the Tripadvisor month cap enforced before the call.

---

## 6. Part D — Demand

### D1. What exists and what does not
- **Exists**: `source_impressions` (household, query_id, source, source_place_id,
  resolved_venue_key, `selected`) and `place_ledger` (shown / dismissed / saved).
- **Does not exist**: the search itself. `queryId` is a `crypto.randomUUID()` made in
  `apps/api/src/routes/discover.js:88`, returned to the client and **never written to any
  table**. The where, the filters, the counts and the outcome are discarded the moment
  the response is sent. There is also no click stream between "shown" and "saved".

**Demand data cannot be backfilled.** Every day this is not logged is gone.

### D2. The tables
```sql
create table searches (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references households(id) on delete cascade,
  account_id    uuid references accounts(id) on delete set null,
  session_id    uuid,
  at            timestamptz not null default now(),
  surface       text not null,            -- 'find' | 'inspire' | 'plan' | 'places' | 'trip'
  area_slug     text, lat double precision, lng double precision,
  radius_km     real, mode text, minutes integer,
  asked         jsonb not null default '{}',   -- categories, kinds, filters, party size — counts, never names
  shown_total   integer not null default 0,
  shown         jsonb not null default '[]',   -- [{category, subcategory, source, n}]
  sources_queried text[], degraded text[],
  empty         boolean not null default false,
  outcome       text,                     -- 'none' | 'clicked' | 'saved' | 'tripped'
  outcome_at    timestamptz,
  trip_id       uuid references trips(id) on delete set null
);

create table search_events (
  id         bigserial primary key,
  search_id  uuid not null references searches(id) on delete cascade,
  at         timestamptz not null default now(),
  kind       text not null,               -- 'open' | 'dismiss' | 'save' | 'shortlist' | 'add_to_trip' | 'refine'
  venue_ref  text,
  position   integer,
  meta       jsonb
);
```
Make `source_impressions.query_id` **be** `searches.id` — today it points at nothing.

Write points to enumerate and cover: `routes/discover.js`, `routes/plan.js` (preview),
`routes/places.js`, `routes/inspire.js`, and the Find/sketch path. A search that returns
nothing must be logged as loudly as one that returns forty.

### D3. The report — three numbers, not one conversion rate
| What happened | What it means | Where it is fixed |
|---|---|---|
| Searched, **shown nothing** (or a source was degraded) | A coverage hole | Collect: go and get that area |
| Shown things, **clicked nothing** | The wrong things were shown | Categories and the label rules |
| Clicked, **did not add to a trip** | The place itself is too thin to convince | The data score on that place |

A single conversion rate hides which of the three it was, and the three have different
owners. Report them separately, by area and by category, and feed them back into the
demand lens in §B3.

### D4. Replay
Opening one search shows exactly what that household was shown, in order, with what
they clicked. **The stored rows are identifiers; names are re-resolved at display**, and
for Google-only refs that costs a call. Fine for an occasional investigation, not for a
dashboard — so replay is a deliberate action with the cost said on screen, never
something a list does forty times on load.

### D5. Identity and retention — the owner's decisions, 17 Sep 2026
- **`account_id` is stored.** He asked for it ("it would just be nice to understand
  specific user behaviours and then also to be able to target them with specific
  communication"). This is lawful under UK GDPR on legitimate interests for product
  analytics, subject to §9.
- **Retain everything for now.** He: "I think we should retain all searches for now, but
  once that starts to become too big, then we can certainly start to remove or aggregate."
  So: no deletion job in v1, but **build the aggregate-and-drop path at the same time**
  (a monthly rollup of `searches` into `area_stats`-shaped counts) so switching it on
  later is a setting and not a migration under pressure.
- Erasure must reach both tables. `searches.household_id` cascades; `account_id` is
  `set null` so a deleted account leaves the counts intact and the person gone.

---

## 7. Cross-cutting rules (do not rediscover these)

- **Rented vs owned.** No provider name, hours, rating, review or photo in
  `place_index`, `place_areas`, `area_stats`, `searches` or `search_events`. Ever.
- **Offline policy.** `apps/web/src/offline/policy.ts` decides what may be written to
  IndexedDB; an endpoint not named there is not saved. **No admin endpoint goes in it.**
- **Every page has an address** — `routes.ts` + a case in `test/routes.test.ts`, never
  `window.location` or `window.history` from a screen.
- **Capabilities**: `view_library` to look, `manage_library` / `manage_settings` to run
  anything that spends. The API answers 404 without the door and 403 without the
  capability whatever the app draws.
- **Plain words, never a provider's error** on any screen a household can reach; raw
  429s belong in the back office.
- **Migrations are append-only** — never edit one that has run; `schema_migrations` keys
  on the filename and the edit is silently skipped in production.
- **Codex reviews this before it is called done** (owner, 4 Sep 2026). `codex exec review
  --base <branch>` over the range being handed over, and every finding reported with what
  was done about it, including the ones not acted on and why.

## 8. Multiple countries

`localities` is already a parent-linked tree with `country_code` and a `kind`, so a
country is a **new row kind above county**, not a rewrite — but `MATCH` in
`repositories/localities.js` hard-codes `county→region_slug`, `town→locality_slug`,
`postcode→outcode` on the harvest tables. `place_areas` replaces that with one join that
does not care what shape a country's administrative ladder is (departments, states,
comunas). Build against `place_areas` from the first day; leave `MATCH` alone for the
legacy harvest screens until they are retired.

## 9. Legal note on §D5 (not legal advice)

Storing `account_id` against a search is lawful under UK GDPR on **legitimate interests**
for improving the product, provided:
1. the privacy notice says plainly that searches and taps are recorded against an
   account and what they are used for;
2. a legitimate-interests assessment is written down once (it is a two-page document);
3. **marketing and surveys are a separate basis.** Emailing somebody because of what
   they searched for is profiling for direct marketing: PECR needs consent, or the
   soft opt-in (an existing customer, a similar product, an unsubscribe in every
   message). Build the flag — `accounts.marketing_opt_in` — with the log, not after it.
4. export and erasure reach both new tables.

## 10. Ratings — decided, 17 September 2026

Owner: "I thought we were going to be taking all the providers' stars and come up with
our own rating, which we can retain. I should be able to then run an order of how that's
calculated, even if that means hitting the same APIs again to recalculate it. Show me
the calculation logic."

**That is what `apps/api/src/domain/scoring.js` already does**, and the question that had
been open since the rating bench is now closed in its favour:

- **No provider's raw star figure is ever written to a table.** `crowdBand()` maps a wide range of ratings onto four words at the moment of the call
  and the figure dies there; `countBand()` does the same for the number of reviews. The
  band cannot be read backwards into the rating, which is the point. Whether a figure may
  appear *transiently* on a back-office screen — as it does today on Lookup's not-owned
  list, which he asked for — is narrower and still his; change nothing there without
  asking, and audit only for figures that reach a **table**.
- **`score()` is pure and recomputes from scratch**, so nothing has to remember what the
  last sweep was told. This is the answer to his 4 Sep question — "how do we know how to
  change our overall score unless we know what the original rating was?" — nothing is
  ever *changed*; it is recomputed.
- **`ownedScore` is kept beside `epicScore`**: the same ranking with the licensed input
  removed. If the key dies on a Tuesday, the ranking stands.
- Accolades and designations are facts about who said what, published to be quoted, and
  **ours for good** — Michelin, AA rosettes, World Heritage, Green Flag, Grade I.

**What is missing is a screen, not a mechanism.** Build the workings view described in
the design brief §7c: for one place, the inputs with their words, what each was worth,
the arithmetic, the two numbers out, and a **Recalculate** that states its cost before it
spends. Also expose the weights (`CROWD_POINTS`, `COUNT_POINTS`, `ACCOLADE_POINTS`,
`DESIGNATION_POINTS`, `PRIOR`, `PRIOR_WEIGHT`, the 0.5/0.3/0.2 composite split) read-only
on screen, sourced from the module rather than retyped into the UI — a weight that can
drift from the code is worse than no screen.

## 11. "What we owe" — a new section on How it works

Owner, 17 Sep 2026: "In that How It Works section, you can add a section about stuff we
need to do, and you can add these marketing requirements in there."

`/admin/how` currently says what Epic decided, what it cost and where each rule lives.
Add a section — **What we owe** — listing the obligations this work creates and their
state (done / not started / owner's to do). It is the same honesty rule as the rest of
that screen: a thing we have not done is said plainly rather than left off.

Seed it with:
1. **Privacy notice** — say plainly that searches and taps are recorded against an
   account and what they are used for. *Not started.*
2. **Legitimate-interests assessment** for analytics on identified search logs. Two
   pages, written once. *Not started.*
3. **`accounts.marketing_opt_in`**, built with the search log and not after it — using
   behaviour to target communications or surveys is direct marketing and needs consent
   or the soft opt-in (existing customer, similar product, unsubscribe in every message).
   *Build with Part D.*
4. **Unsubscribe in every non-service message**, and the distinction between a service
   e-mail and a marketing one held in code, not in the sender's head.
5. **Export and erasure reach `searches` and `search_events`** — `household_id` cascades,
   `account_id` sets null. *Build with Part D.*
6. **Retention review**: everything is kept for now, by his decision; the
   aggregate-and-drop path is built and switched off. Name the trigger to revisit it
   (a row count, not a date).
7. The obligations already outstanding elsewhere — the Heritage Crafts e-mail about
   referencing the Red List properly, and the four things outside the repo still called
   Roam (README › "The rebrand: what is still called Roam").

The section is a table with a state word per row and nothing else. No prose.

## 12. Decisions taken 17 September 2026

- **Atlas and the sweep dissolve** into Places + Collect, on the condition that §2 is
  honoured in full.
- **Everything is built** — no phasing question. Order is the implementer's to choose,
  but the search log writes on day one because it cannot be backfilled.
- **`account_id` is stored** against every search, with §9 and §11 alongside it.
- **All searches retained for now**; the aggregate-and-drop path built and left off.
- **Ratings**: ours, composite, retained, recomputable, workings on screen; no raw
  provider figure anywhere (§10).
- **Sex is asked** — a stated, optional, self-declared field, so that the "Women" /
  "Men" preferences on casual meet-ups can be honoured instead of reported as
  unverifiable. *This is a separate piece of work from this brief; it closes
  `unverifiablePrefs()` in `domain/openTo.js`.*
- **The reachability matrix is built** (§A6).
- **The per-category ready bar is composed in the UI**, not coded — it goes to Claude
  Design as a composer with the effect shown before saving.

### Still open
1. **Names** for the three screens — his and Claude Design's.
2. **Host credential gates** — which credentials are compulsory to publish in which of
   the sixteen browse categories. Lives in **Back office › Skills › Credentials**, is
   built, and is currently empty, so every credential ships as a badge and nothing is
   blocked. He has parked it deliberately ("I'm not ready to think about that right now…
   definitely we'll come back to it, so keep it in mind and remind me every now and
   again") — **raise it periodically; do not set it.**
3. **Uploads, Reading and "Can you visit?"** — three of the seven sections on
   `/admin/library` he had not seen. Confirm their home after he has looked (§13).

## 13. Note on the three unseen Atlas sections

He replied: "I don't see any uploads in the Atlas, and Reading is just a city, so I
don't have any clue what you're talking about." They are section tabs at the top of
`/admin/library`, alongside Coverage and Attractions:

- **Can you visit?** — whether an attraction can actually be visited, from the visiting
  evidence (`sources/visitingEvidence.js`).
- **Reading** — the screen he asked for on 5 Sep 2026: "We could go one by one, comparing
  the wiki page to a location's page, showing what you're extracting and what you're
  going to be showing to the user. We could then train the AI on whether that's the right
  data to capture." Sources on the left as fetched, the filled-in form on the right, and
  **every read field carries the sentence it came from** — a field with no sentence is a
  judgement and is marked as one. Approve makes it a worked example; Correct becomes a
  lesson scoped to the kind of place.
- **Uploads** — household-submitted photographs awaiting review and what each contributor
  has earned. It will look empty because no household has submitted one yet.

Reading is the more valuable of the three and is the obvious home for checking Curate's
output as well as the atlas's. Do not move or drop any of them without asking him.

## 14. Household-made content: filtering and approval

Owner, 17 Sep 2026: "We're definitely going to need a means to be able to filter
user-generated content and probably approve them, like photographs, etc., and also
reviews."

One queue over everything a household made — `household_place_photos`, `ratings`,
`visits`, `dish_notes`, `host_reviews`, `host_media`, `prototype_reviews`, chat topics
and replies, `open_entries` — filtered by kind, state, place, person and age, with
approve / reject / reject-and-tell-them and a **closed list of reasons** so the common
ones can be counted and designed out. Reported content jumps the queue. Batch approval
where it is safe (forty beach photographs), never on a rejection. The rejection message
is built with the button, not after it.

Two rules from the architecture: the queue only ever shows household-made content and
owned pictures — **a provider's photograph must never appear in it**, and if one does
something is wrong upstream; and the reviewer's trail goes to `admin_audit`, which
already exists, rather than a new table. Design brief §9d has the screen.
