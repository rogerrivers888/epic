# Epic — Schema notes

**What this is.** A description of three tables whose columns have outrun the prose that describes them, written so the next session does not have to reverse-engineer them from migrations. It **describes what exists** — it proposes nothing, fixes nothing, renames nothing. Where a column's purpose is not recoverable from the code, it says **unknown** rather than guess; an honest unknown is worth more than a plausible invention.

Compiled 29 Sep 2026 against `origin/main` (migrations through 302). Structural boilerplate (`id`, `created_at`, `updated_at`) is noted but not dwelt on. This is a snapshot; verify against the migrations before relying on a detail.

The three were chosen because they drift most, and for reasons that matter: `place_attributes` governs how every fact behaves, and the host/events build is still ahead, so whoever picks it up reads `host_offers` first.

---

## 1. `place_attributes` — the fact vocabulary

**Source:** `105_place_attributes.sql` (create); alters in `113` (added then dropped in `114`), `131`, `216`, `266`, `274`. Used by `repositories/placeAttributes.js`, `desk/facts.js`, `desk/pipeline.js`, `routes/taxonomy.js`, `repositories/questionSets.js`.

**What a row is.** One entry in Epic's own **secondary-label vocabulary** — a "fact" Epic can hold about a place (`indoor`, `step-free`, `suits-ages`, `cuisine`, …). The row is only the *definition* of the fact; the values live in four other tables that reference `place_attributes(key)`: `place_attribute_values` (what one place says for itself), `shelf_subcategory_attributes` (a drawer's default), `attribute_brings` (labels a label drags along), and `taxonomy_label_carries` (what a provider word carries besides its filing). `placeAttributes.js` loads the vocabulary once and `resolveFor()` reads a place as *its own value → a carried word's value → the drawer default*, then adds brought labels — over `active` rows only.

**`kind` decides the shape of every value** (enforced by `mustFit()` and DB triggers):
- **`yesno`** (default) — a boolean; backs the standard facts; `question` holds the family-facing wording.
- **`range`** — two integers (`from_value`/`to_value`); `range_min`/`range_max` bound the control, `unit` names the numbers ("years"). E.g. `suits-ages` 0–99.
- **`oneof`** — a single `choice` from `options`. E.g. `cuisine`, `dining`.
- **`scale`** — added by `216` for the eight graded axes, **cancelled by `246`**: `saveAttribute`/`mustFit` refuse it, its rows are `active = false`, its `level` values are never read. The kind string is still permitted but treated as retired.

**The flags each gate a behaviour:**
- **`standard`** (266) — one of the ten standard facts; applies to "All" subcategories, gets a definition page, asked broadly rather than per-subcategory.
- **`active`** (105) — live; retired labels keep their rows but take no new values.
- **`seeded`** (105) — inserted by a seed migration (system vocabulary). Provenance only; no app read path.
- **`access`** (266) — accessibility fact; drives `recheckAccess` cadence and is exempt from the "on nearly every place → ignore" rule.
- **`age`** (266) — age fact (`suits-ages`); shareMax-exempt; routes the question to households with a child ≤17.
- **`dietary`** (266) — food/dietary fact; drives `recheckFood` cadence.
- **`access_need`** (274) — an accessibility *need*; distinct from `access` — routed **only** to households that said access matters.

**Other columns:** `only_in` (131) — shelf categories this label is asked in, empty = all; `question` (274) — the `{place}`-placeholder family question; `blurb` (105) — the human explanation shown on screens; `position` (105) — sort order; `label` (105) — display name.

| column | type | what it does | migration |
|---|---|---|---|
| key | text PK | vocabulary key, immutable | 105 |
| label | text | display name | 105 |
| kind | text (yesno/range/oneof; scale retired) | value shape | 105 (scale 216) |
| blurb | text | human explanation on screens | 105 |
| options | text[] | allowed choices for `oneof` | 105 |
| range_min / range_max | integer | bounds the range control offers | 105 |
| unit | text | what the range numbers are called | 105 |
| position | integer | sort order | 105 |
| active | boolean | label is live | 105 |
| seeded | boolean | came from a seed migration (provenance; not read) | 105 |
| only_in | text[] | shelf categories this label is asked in; empty = all | 131 |
| standard | boolean | one of the ten standard facts | 266 |
| access | boolean | accessibility fact (recheck + shareMax-exempt) | 266 |
| age | boolean | age fact (routes to households with a child) | 266 |
| dietary | boolean | food/dietary fact (recheck cadence) | 266 |
| **definition** | text | **unknown** — added by 266, never populated or read (the fact page computes its definition from the shape) | 266 |
| question | text | family question with `{place}` placeholder | 274 |
| access_need | boolean | accessibility-*need* fact (routed only to access households) | 274 |

*Dropped:* `comes_with text[]` (113) was dropped by `114`; its data moved into `attribute_brings`.

---

## 2. `provider_calls` — the outbound-call ledger

**Source:** `002_visits_concepts_spend.sql` (create); alters `012`, `174`, `203`, `205`, `254`, `256`, `261`, `276`, `300`. Used by `repositories/providerCalls.js`, `domain/providerPrices.js`, `domain/costClass.js`, `desk/billing.js`, `desk/claudeSpend.js`, `desk/supplierCost.js`, `desk/pilot.js`, `sources/meter.js`.

**What a row is.** One outbound provider call (or one metered batch), attributed to a household and a session, priced at list price. It never stores provider *content* — only provider, purpose, counts, cost and outcome. Written on the way out of every integration; read by the daily/monthly caps.

| column | type | purpose | migration |
|---|---|---|---|
| household_id | uuid → households | who the call was for | 002 |
| session_id | uuid NOT NULL → api_sessions | session the spend is attributed to (NOT NULL since 254, FK 256, defaults to a service session 261) | 002 |
| provider | text | provider name; prices are per-provider | 002 |
| purpose | text | what the call was for (grouped into cost classes) | 002 |
| input_tokens / output_tokens | integer | Claude billed tokens | 002 |
| cache_read_tokens / cache_write_tokens | integer | Claude cache tokens | 002 |
| estimated_cost_usd | numeric(10,6) | list-price cost; summed by the monthly ceiling | 002 |
| units | jsonb | the meter — what the provider counts, e.g. `{google:1}` | 012 |
| venue_ref | text | which place the call was about (History tab reads by it) | 174 |
| ok | boolean | outcome: true/false/**null** = not recorded | 203 |
| ms | integer | wall-clock duration (p95 on the supplier panel) | 203 |
| failed | integer | count of failed requests within the row | 203 |
| fault | text | short failure reason in provider terms ('http_429','timeout') — never the raw message | 203 |
| watched | integer | how many calls the row observed = failure-rate denominator | 205 |
| plan_session_id | uuid → plan_sessions | which planning run the call belonged to (distinct from session_id) | 261 |
| billed_gbp | numeric | this row's apportioned share of its day's Google billed usage | 276 |
| billed_at | timestamptz | when `billed_gbp` was last written | 276 |
| language_code / region_code | text | the language/region a Google call asked in — **foundation columns (300), populated by later display/census steps, not yet written** | 300 |
| field_mask | text | the Google field mask requested (→ SKU via `skuFor`) — foundation column (300) | 300 |

*Not a column:* code refers to a `class` (cost class); it is derived at read time, not stored. There is no `class` column.

---

## 3. `host_offers` — a hosted experience

**Source:** `079_hosts_and_events.sql` (create); alters `084`, `091`, `102`, `274`, `300`. Used by `repositories/hosting.js`, `domain/hosting.js`, `routes/hosting.js`.

**What a row is.** One hosted experience. `shape` (`oneoff`/`series`/`anytime`) selects which schedule column-group is meaningful; `state` moves draft → in_review → live → paused/ended; `money`/`price_*` govern payment; `review_*` is the editorial pitch review. No column here was dropped or renamed. Grouped below; every column is from `079` unless noted.

**Identity & lifecycle:** `host_id` (→ hosts), `shape`, `state` (draft/in_review/live/paused/ended), `paused_until`, `visibility` (public/link), `link_token` (091, random 18-char, for link sharing), `money` (084: free/direct/epic — public must be 'epic'), `rules_accepted` (084, publish blocker), `submitted_at`, `published_at`, `cancelled_at`, `cancelled_note`.

**Listing & media:** `title`, `summary` (084), `description`, `why_you`, `includes`, `category` (old single passion word), `category_key` (102, → host_categories), `format_key` (102, → host_formats), `transcript` (084), `facts` (084, [{key,value}] from the video), `seeded` (084, which fields came from the video), `photo_ids`, `video_id` (→ host_media), `doc_id` (084, → host_media).

**Venue/location:** `venue` (their_place/your_place/out_about/online), `venue_ref` (274, the place ref for the after-visit rating), `venue_label` (revealed once booked), `venue_area` (shown before booking), `venue_lat`, `venue_lng`, `venue_country` (drives the regulated-country step), `venue_notes`, `travel_radius_min`, `travel_charge_pence`, `online_platform`, `timezone` (**foundation column, 300; no read path in hosting yet — unknown/unused**).

**Group size, duration, pricing:** `duration_min`, `min_count`, `expected_count`, `max_count`, `party_max`, `age_limit`, `price_mode` (free/same_each/by_numbers), `price_pence`, `total_pence` (by_numbers), `per` (person/household), `refund_rule` (24h/7d/none), `currency` (**foundation column, 300; no read path in hosting yet — unknown/unused**).

**One-off schedule:** `starts_on`, `starts_at`, `ends_at` (084), `running_order` ([{time,title,detail}]), `featured_people` ([{name,role,photoId}]).

**Series schedule:** `weekday` (0 Sun–6 Sat), `first_date`, `sessions`, `repeat_every` (084: weekly/fortnightly/monthly), `end_date` (084), `skipped_dates`, `outcome`, `arc`, `weeks` ([{n,title}]), `themes_differ` (084), `join_mode` (whole/drop_in/both), `drop_in_pence`, `missed_note`.

**Anytime schedule:** `availability` ({days,parts}), `slot_min`, `notice_days` (084, booking notice floor).

**Compliance & pitch review:** `regulated_answer` (no_commentary/licensed), `licence_number`, `licence_expiry`, `checks` (084: pub/qual/years/lic), `sub_detail` (084, sub-kind questionnaire), `review_checklist` ({what,home,suits,not_suits,photos}), `review_note`, `reviewed_at`.

---

**The pattern worth naming:** the drift is almost entirely the columns a feature grew *after* its write-up — observability/billing on `provider_calls` (203/205/276), the fact-behaviour flags on `place_attributes` (266/274), and the schedule/venue detail on `host_offers` that `§13.18` described in prose but never enumerated. `place_attributes` is the one to read before assuming how a fact behaves; its flags, not its values, are where the logic lives.
