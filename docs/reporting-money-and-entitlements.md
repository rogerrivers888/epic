# Epic — Reporting, Money and Entitlements: build brief

**For:** Claude Code, in the Epic repo
**Companions:** *14 Epic Reporting Suite — Research Brief* (the requirements and the production audit) · *Epic Reporting & Analytics: research answers* (the evidence behind every decision here) · *Epic Data Policy*, 19 Sep 2026 (already pasted into `CLAUDE.md`)
**Date:** 19 September 2026

---

## 1. What this is

Four things, and they are one brief because the last one cannot be built without the first three.

| | |
|---|---|
| **The attribution spine** | Every cost and every act resolved to an actor, a class and a session. Without it there is no cost to serve, no funnel denominator and no honest household figure. |
| **The commercial register** | Every counterparty Epic pays or is paid by, with a versioned rate card. Provider cost stops being a number hardcoded in an adapter and becomes a row with an effective date. |
| **The entitlement engine** | Plans, prices and what each one grants, all versioned. One place that answers "may this household do this", read by the API, the app and the reporting. |
| **The reporting suite** | Twelve screens over the three above. |

**Build them in that order.** Nine of the twelve screens read from tables that do not exist yet. Starting with the screens produces a suite that reports what was easy to measure rather than what matters — which is the failure the production audit already documents.

## 2. The one rule that governs everything

**A completed thing is counted from its own table, never from a log.** A trip is a trip; a rating is a rating; a booking is a booking. That rule is already Epic's, the codebase argues for it explicitly, and it is correct. Nothing in this brief replaces a table with an event stream.

Three ledgers keep one job each:

| Ledger | Owns | Change |
|---|---|---|
| `provider_calls` | What it cost | Add `class` and `rate_id` |
| `activity_events` | That somebody was here, and where | Start sending `action`, with a closed verb list |
| `searches` + `search_events` | What was asked for and what happened to it | Becomes *the* demand spine; `source_impressions` and `place_ledger` fold into it |

---

## 3. Migrations

Next in sequence, house-style comment block at the top of each explaining the shape and why. Keep them separate — each should be independently revertible.

### 3.1 Identity and origin — the unblocker

Nothing downstream works until a session resolves to an account with a role.

- Fix `ownerAccount()` so it falls back to the founding household's lead account when no row carries `role = 'owner'`. Build the guard **before** touching production data, so the fault cannot silently recur on a fresh install.
- Resolve the owner's account by whichever of the two options the owner picks (Part H §5 of the research brief). Either way, record the choice and whether the 366 past sessions and 4,846 activity events were backfilled — the reporting must be able to say which periods are attributable and which are not.
- `households.origin`: `founding | signup | guest_invite | peer | marketplace`. Not nullable, defaulted for existing rows.

**Why `origin` matters more than it looks.** Guests invited to a group trip get their own household, and non-subscribers who book an event from a public page get one too. Both are successes. Put them in the same denominator as a trial signup and activation, retention and trial conversion all read as broken while the business works. **Every estate metric is reported by origin or it is wrong.**

### 3.2 Cost classification — `(purpose × actor)`, never a prefix match

The production audit's $96.46 "cost of serving a household" was the owner exercising the planning endpoints as an admin. The purposes were `plan.*`, `trip.*`, `places.*`; the cost was research. **A purpose does not carry enough information to classify a cost; a purpose plus an actor does.**

- `provider_calls.class`: `library | serve | office | research`. Resolved and stored **at write time**, never derived at read time, so a later rule change cannot rewrite last quarter.
- `purpose_classes` — `purpose`, `default_class`, `effective_from`, `effective_to`. Insert-only, same discipline as prices.
- Resolution rule: start from `default_class`; **if the session's account holds any back-office capability, downgrade `serve` to `research`.** Default to non-serve and require an explicit override, not the other way round — defaulting the other way is what produced the bad figure.
- `research` is new and is not `office`. Office is somebody using the admin screens; research is production endpoints exercised deliberately to learn something.
- **Report `serve` cost only over households with no back-office account attached.** Until such households exist, the correct display is the label, not a number.

### 3.3 The commercial register

Two directions of money, one register. This is the screen described in §5.4.

```
counterparties        key, name, direction (inbound_cost | outbound_revenue | both),
                      status (live | trial | approved | evaluating | declined | retired),
                      adapter_state (none | built | wired | enabled),
                      contract_ref, account_ref, owner_contact, notes

counterparty_rates    counterparty_key, sku, unit (call | place | photo | token | booking | night),
                      amount, currency, tier_from, effective_from, effective_to,
                      source_url, confirmed_at, confirmed_by
                      -- INSERT ONLY. A rate change inserts and closes; no editable amount.

counterparty_allowances  counterparty_key, sku, free_units, period, effective_from
```

**The architectural point, and the reason this is not just an admin screen.** `provider_calls.estimated_cost_usd` should be computed from **the rate row in force at the moment of the call**, with `rate_id` stored on the call. Today the figure comes from constants in adapters; the day Google changes a SKU price, every historical cost silently changes meaning or silently goes wrong. Pinning the rate makes cost restatement-proof in exactly the way price versioning makes revenue restatement-proof. Do this, and "what did last quarter cost" stays true forever.

Seed it from what is already known:

| Counterparty | Direction | Rate as at 19 Sep 2026 |
|---|---|---|
| Google Places (New) | cost | Essentials 10,000/month free; display search 3.2p per 20 places; detail 2p; photo 0.55p |
| TripAdvisor Content API | cost | 1,000 places free, then $0.015 falling to $0.009; 3 reviews / 5 photos; 10k calls/day |
| Anthropic | cost | per-token, by model — carry input, output, cache-read and cache-write separately |
| Google Routes | cost | the `plan.matrix` call measured at $1.33 — confirm the SKU |
| OpenAI (speech) | cost | per minute |
| Overpass, Wikipedia, Wikidata, Nominatim, Photon, postcodes, TfL | cost | £0, keyless — still register them, with allowance and rate-limit notes |
| LiteAPI | revenue | hotel commission — rate to confirm |
| Booking.com Demand, Expedia Rapid | revenue | to negotiate |
| Viator, GetYourGuide, Travelpayouts | revenue | affiliate rates by category |
| Epic hosts | revenue | host-paid, by the host's trust level — **Verified 20%, Checked 15%, Epic Trusted 10%**; 5% on host-sourced direct links at any level; 0% for the first 90 days or 10 bookings; £1.50 minimum, never on an intro booking. The guarantee pool is funded from this fee, not deducted separately. (Settings revised v2, SX14, 1 Oct 2026 — this replaces the earlier flat 15%.) The rate schedule and the per-booking resolver live in `apps/api/src/domain/hostFees.js`; every fee line carries its rate and its reason. |
| Stripe | cost | 1.5% + 20p UK cards (debit and credit alike), 1.9% + 20p premium, 2.5% + 20p EEA, 3.25% + 20p international, +2% FX, £2/month per active connected account, £20 per dispute, 0.5% + 20p open banking |

`confirmed_at` matters. A rate nobody has checked in six months should say so on the screen.

**Do not merge this with `Sources.tsx`.** That screen is the data-provenance register — licence, attribution, retention, what resolves a vocabulary. This one is the commercial register — who we pay, what we pay, who pays us, is the pipe plugged in. Link them; keep them apart.

### 3.4 Plans, prices and entitlements

```
plans                 key, name, audience, active, position
                      -- never deleted, only deactivated

plan_prices           plan_key, currency, amount_pence, interval,
                      effective_from, effective_to (null = current),
                      created_by, created_at
                      -- INSERT ONLY

entitlement_keys      key, label, kind (boolean | numeric | unlimited), unit, description

plan_entitlements     plan_price_id, entitlement_key, value
                      -- versioned WITH the price: a price change that also changes
                         what is included is a different product, and last quarter
                         must keep the old one

subscriptions         household_id, plan_key, plan_price_id, state
                      (trialing | active | past_due | cancelled | expired),
                      trial_started_at, trial_ends_at, current_period_start,
                      current_period_end, cancel_at, stripe_ref

account_plan_history  household_id, plan_key, plan_price_id, from_at, to_at, reason
                      -- exists, empty. This is the table that makes last quarter
                         unrewritable.

commission_rates      scope (global | counterparty | host | category), rate_bps,
                      min_pence, effective_from, effective_to
```

**The query rule that makes it work:** revenue for any period joins each subscription or booking period to **the price row in force at that time**, never to a plan's current price. If any revenue query reads a current-price column, the model has failed however many history tables exist.

**Grandfathering is a property of `account_plan_history`, not of the plan.** A household keeps the price row it was sold. Migrating someone is an explicit act writing a new history row with a stated reason, so "who is on what" is a query rather than a policy document.

Support **future-dated prices** from day one. It is what lets a price change be announced before it bites.

### 3.5 Sessionisation and the action vocabulary

- **A session is heartbeats from one household with no gap greater than 30 minutes.** A definition, not a new instrument — it is derivable retrospectively from data collected since 4 September. Build it as a view or a nightly rollup, not a client change. Cheapest win in the whole brief.
- `action` events: the API already accepts `kind: 'action'` and the client never sends one. **Keep the verb list closed and tiny**, in code, rejecting anything not on it. Start with entry into flows that have no row yet: `host.start`, `offer.start`. Add only with a reason.
- **`step` column on every draft row** holding the furthest step reached. That single integer gives per-step drop-off for every wizard forever, as inspectable state rather than a log you have to trust.
- Trip state machine: `draft → planned → booked → travelled → rated`. Offer: `draft → submitted → live | paused`. Abandonment is then `count(draft older than N days)` — a union over real tables, exactly as the philosophy demands.

**Instrument entry, derive exit.** Never write an `abandon` event: an absence is not an event, and it would have to be sent at the moment the client is least reliable.

### 3.6 The search spine

- Fold `source_impressions` and `place_ledger` into `searches` / `search_events`. Three tables with three keys and three definitions of "shown" cannot produce a reliable funnel.
- **Stop storing ~400 `shown` rows per search.** Store the impression set as **one row per search** — count, source mix, top-N identifiers — and keep individual rows only for interactions: `open | dismiss | save | shortlist | add_to_trip | refine | close`, with position and dwell. This removes roughly 95% of the volume and loses nothing anyone will ever query.
- Partition `search_events`, `activity_events` and `provider_calls` by month **now, before there is data**. Dropping a partition is instant; a `DELETE` over 100M rows on Railway is an outage.
- Leave `search_rollups` switched off until a table passes ~50M rows, then turn it on. With the reduced schema above that is a long way out.

### 3.7 Metric definitions

`metric_definitions` — `key, label, definition, source_tables, owner, effective_from`. Versioned like prices. Seventy metrics with no single definition is how two screens come to disagree and nobody can say which is right; and redefining "active household" must not silently rewrite last quarter's chart.

### 3.8 Privacy

`households.analytics_opt_out` — honoured at **write time**, not at read time. See §8.

---

## 4. Entitlements — what each plan grants

Settled 19 September. Pro adds events, hosting and the AI-powered tools; Household is up to six **logins**.

| Entitlement | Guest | Solo £5.99 | Household £8.99 | Pro £12.99 |
|---|---|---|---|---|
| Public host, event and tag pages | ✓ | ✓ | ✓ | ✓ |
| Search Epic's own hosts and events | ✓ | ✓ | ✓ | ✓ |
| Book and pay for an event | ✓ | ✓ | ✓ | ✓ |
| Search Google-backed places | — | ✓ | ✓ | ✓ |
| Place drawer (live detail, reviews, photos) | — | ✓ | ✓ | ✓ |
| Create and keep trips | — | ✓ | ✓ | ✓ |
| Group trips with invited guests | — | ✓ | ✓ | ✓ |
| Saved places, visits, ratings | — | ✓ | ✓ | ✓ |
| Menu reading | — | ✓ ceiling | ✓ ceiling | ✓ higher ceiling |
| Voice intake | — | ✓ | ✓ | ✓ |
| AI planning and itinerary generation | — | ✓ ceiling | ✓ ceiling | ✓ higher ceiling |
| Travel-time matrices | — | ✓ ceiling | ✓ ceiling | ✓ higher ceiling |
| Logins | 0 | 1 | 6 | 6 |
| Household members (children, diets, allergies) | — | 1 | unlimited | unlimited |
| Exclusive offers and discounts | — | ✓ | ✓ | ✓ |
| Publish host offers | — | — | — | ✓ |
| Organise and run events | — | — | — | ✓ |

**Cap logins, not members.** Children are members with diets and ages, not accounts. A six-*member* cap would catch two adults and four children, which is the core family. Members are the product.

**Ceilings are entitlements, expressed in outcomes, not calls.** "200 menu reads a month" is a sentence a family understands; "8,000 provider calls" is not, and changes meaning whenever the implementation does. Set them at roughly the 99th percentile of real use so they are invisible to everyone they should be invisible to, and **report pressure against them, not breaches** — `ceilingPressure` already exists.

**Enforcement lives in one place.** A single `can(household, entitlement)` in the API, reading the entitlement rows for the price the household is actually on. Never a plan-key comparison scattered through route handlers, because the whole point of versioned entitlements is that two households on the same plan may hold different grants.

**Trial:** one month, card up front, granting the tier the household chose. State machine `trialing → active | expired`. The trial is revertible as a policy, so keep the mechanic in configuration rather than in code paths.

---

## 5. The screens

Twelve. Each is capability-gated, each has a unique URL, each works at 390px and wide. A withheld figure says it is withheld rather than vanishing.

### 5.1 Overview — *is anything wrong, in three seconds*
Extends the existing screen. **Three states, not forty tiles:** what changed, what is broken, what needs a decision. One headline number, one comparison, then a short list of things needing attention. Everything else one click away.

### 5.2 Money — `view_financials`
Revenue, cost, margin; period plus slice by counterparty, purpose, class, household, section.

Four revenue figures that are **never summed and never share an axis**:
- **Contracted** — what the plans people are on are priced at
- **Modelled** — scenario, from the pricing screen
- **Collected** — real money, and until Stripe is connected it says "no payment provider", not £0
- **GMV / gross bookings** — what guests paid through the marketplace. A volume measure, **never revenue**: under IFRS 15 an agent recognises only its commission, so summing GMV with revenue overstates by 5–10× depending on the host's level (the fee is 10–20%, less for intro and direct-link bookings)

Cost split by `class`: **serve** (the unit cost), **library** (a programme with its own return), **office**, **research**. Cost to serve as a **distribution** — p50, p90, p99 and the top ten households — never a mean over a power law. Refunds and cooling-off cancellations as a visible contra on both subscription and marketplace revenue.

### 5.3 Pricing & Plans — `manage_plans`
**Not a report: the input every report reads.** Plans list; the **price timeline** per plan with a count of households on each price row; entitlements per price row; commission rates with the same shape.

The "change price" action is visibly an **insert**, with an effective date that may be future. **No editable amount field on a plan row, anywhere.** Nothing on Money is meaningful until this screen is filled in, and until a price is set Money says "no price set".

### 5.4 Commercial — `view_financials`
The register from §3.3. One row per counterparty: direction, status, adapter state, current rate, allowance remaining this month, spend or income this period, `confirmed_at` on the rate.

Open a row for the **rate history** — every rate we have ever paid, with effective dates and the source URL it was taken from — plus the SKUs, the contract reference, and the purposes that consume it.

Two things it must answer at a glance: **which approved counterparties are not yet wired** (adapter_state `approved` but not `enabled`), and **which live rates have not been confirmed recently**. Changing a rate is a capability distinct from reading one — that rule is explicit in the back-office capability model and applies here.

### 5.5 Demand — `view_reporting`
Exists. Searches, empty rate, no-click rate, no-trip rate, top subjects, top areas, coverage gaps where demand exceeds what Epic holds, degraded-source rate. The three faults already identified stay on it.

### 5.6 Funnels — `view_reporting`
Every flow, its steps, its drop-offs, each rate with its denominator. Three of the four steps in each funnel come from tables.

- **Search → click → save → trip**, as three separate rates, never one
- **Host tab → `host.start` → `host_offers` draft → live**
- **Trip start → draft → planned → travelled → rated**
- **Install → trial start → paid**, held as three rates so the card-up-front decision can be evaluated honestly. Trial-to-paid alone cannot answer it: reverting to no-card makes that number fall while the business improves
- **Booking → subscription** — the non-subscriber who booked an event from a public page is the warmest upsell population Epic will have

Every funnel is segmentable by `origin`.

### 5.7 Engagement — `view_reporting`
Sessions per household, session length, screens per session, actions per active household, minutes per tab, tab reach, voice usage, offline usage, cohort retention.

**On frequency, follow Epic's own thesis rather than the travel benchmarks.** Epic's position is that local and day-trip use is central, not peripheral, so do not import travel-app seasonality as the default frame. Report **active weeks per quarter** and **time to second trip** alongside the standard cohort grid, and split **local versus away** trips — that split is the evidence for or against the frequency thesis, and nothing else on the suite tests it.

### 5.8 Household — `view_accounts`
Extends the People drawer. The single-customer card: activity, trips, events, searches, search→trip conversion, places held, cost to serve, revenue, margin, satisfaction proxy, plan and price row, entitlement grants, ceiling pressure.

Fixes the "spent $453, never logged in" row: cost is household-scoped and account-scoped figures need the identity fix in §3.1 before they read true.

### 5.9 Sections — `view_reporting`
One row per area of the product — Inspire, Places, Trips, Host, Settings — with the same six measures each, so they can be compared: reach, depth, frequency, the one action that says the section worked, cost, and satisfaction proxy.

### 5.10 Data & Library — `view_reporting`
What Epic holds, what it cost, what it is worth, what is stale. Places, owned records by completeness, menus read and **menu yield**, images per place, coverage by county, census counts against OSM and FHRS, staleness.

**Cost per place held, and cost per place *used*.** The second is the one that says whether harvesting 27,613 places was worth it when 361 are ready. Library spend shown as a programme with a management amortisation over 24–36 months — **labelled on the screen as a reporting convention**, because IAS 38.63 bars capitalising it in the statutory accounts and a management convention must never leak into a statutory presentation.

### 5.11 Health — `view_reporting`
p50/p95 latency by endpoint, error rate, provider failure and degraded rate, empty-search rate, queue depth.

**Unit cost and yield side by side, never one alone** — 17¢ per menu read next to 13% menu yield. The yield is the finding; the blended cost hides it. A worst-offenders row by cost per successful outcome, with `plan.matrix` at $1.33 a call and no per-call ceiling as the standing example.

### 5.12 Instrumentation — `view_reporting` — **new, and build it early**
**Rows written per ledger per day, against an expected range, with a quiet-ledger alert.**

The production audit found `atlas.match` spent $14.62 and wrote nothing back, and a search log holding two rows because it was never wired into the surfaces. Both would have surfaced here within a day. A suite whose inputs can stop without saying so reports confidently and wrongly, and this is the cheapest screen in the set.

Also carries: the metric dictionary from §3.7, and **the cost of the reporting itself** — one back-office screen spent $13.70 in a day, and a screen that costs money to render should say so before the click.

### 5.13 Forward model — `view_financials` — **new**
The suite reports the past; the decision in front of the owner is about the future. At price P, cost-to-serve distribution D and take rate T, what is the margin at 100, 1,000 and 10,000 households.

Reads plan prices and entitlements from §5.3 and the cost distribution from Money. It is what makes the pricing screen decidable rather than merely editable.

### 5.14 Also needed, not a reporting screen
**The analytics opt-out toggle** (§8) — a single visible control in Settings, one step, free. It is a compliance artefact, not a preference, and there is nowhere for it today.

---

## 6. Shared components

**One period control, on every reporting screen.** Period, comparison period, dimension. **State in the querystring**, because every page has a unique URL and a reporting screen two layers in must be shareable as a link. Period state that resets on navigation turns one suite back into nine screens.

At 390px it reads as a sentence — *Last 30 days · vs previous · by provider* — where each part is a tap target opening a sheet. Not three dropdowns, not a filter bar, not a desktop calendar that becomes a wheel on mobile. Defaults differ per screen (Money: this month; Health: last 24 hours; Engagement: last 90 days); the control does not.

**Three honesty components, implemented once and called everywhere.** A policy each screen implements for itself will be inconsistent within a month, and the first inconsistency is the one that gets quoted.

| Component | Rule |
|---|---|
| `Gap` | A missing figure is labelled with its reason — "no payment provider", "no price set", "not attributable before 19 Sep" — and never drawn as a zero. |
| `Rate` | Below 30 in the denominator, show the counts ("3 of 7") and suppress the percentage. Between 30 and 100, show the percentage with an interval. Above 100, the percentage. Never a trend line through fewer than eight points. Always show the denominator on the face of the figure. |
| `Withheld` | A capability-gated figure says it is withheld and which capability would show it. It does not vanish. |

**Cost counter**, as already specified for the Places tab: this action, this session, today, live from `provider_calls`, and every paid control shows its price before the click.

---

## 7. API

Extend the existing admin route pattern; back-office CRUD in new route files, gated by the capability model in `034_back_office.sql`. **Reading a vocabulary and changing it are separate capabilities** — explicit in `034` and it applies to rates, prices and entitlements alike.

The existing derived functions (`estateDaily`, `installCounts`, `activeCounts`, `retentionCohorts`, `estateScreens`, `engagementByAccount`, `mrrByPlan`, `revenueByMonth`, `costByMonth`, `costByProvider`, `costByHousehold`, `estateTotals`, `ceilingPressure`) are the foundation — extend rather than replace, and add the `class`, `origin` and price-row joins to each.

Every reporting endpoint takes the same period/comparison/dimension shape, so the shared control maps to one contract.

---

## 8. Privacy

**The law changed on 5 February 2026 and it is why Epic can hand-build rather than buy.** DUAA 2025 s.112 / Sch 12 inserted Schedule A1 into PECR; paragraph 5 removes the consent requirement for storage or access whose **sole purpose** is collecting statistical information about how the service is used with a view to improving it. Epic fits — first-party, no third party, everything in its own Postgres — provided three things hold:

1. **Nothing in the analytics is ever repurposed to target an offer or set a price.** The moment a behavioural score changes what a household is sold it stops being statistical and returns to consent. This is a build constraint, not a policy note.
2. **A visible, one-step, free opt-out** (§5.14). The ICO has indicated an immediately visible toggle may satisfy this; a buried menu will not.
3. **IndexedDB is in scope.** Schedule A1 governs storage and access on terminal equipment, which includes web storage. The existing explicit allow-list is the right control and is also the compliance artefact — write it down as one.

At the UK GDPR layer, legitimate interests is now available for this processing; document an LIA and honour objections. The ICO finalised its Storage and Access Technologies guidance on 29 April 2026 and reads the exception narrowly; PECR penalties rose to £17.5m / 4% on the same commencement.

**Retention:** raw event rows 13 months, rolled-up aggregates indefinitely. **The rollup job is what ages data out** — aggregate, verify, drop the partition, as one job. If deletion is a separate schedule, a failed rollup silently destroys data nobody aggregated. And decide the rollup dimensions before switching it on: you cannot re-derive a dimension you did not roll up.

**Buying a third-party analytics product would break this.** It puts a consent banner back on the product, it puts a key in the web bundle against Technical Constraints §13.7, and at Epic's search-log volume it would cost thousands a month to store data Epic already has. Self-hosted Metabase over the same Postgres is a reasonable exploratory layer for questions the built screens do not answer; it is not a substitute for them, because these are capability-gated operator screens.

---

## 9. House rules

Read `CLAUDE.md` first — every rule there applies, including the Data Policy block added 19 September. Then `docs/requirements.md` and `docs/technical-constraints.md`.

**Precedents to follow rather than reinvent.** `apps/web/src/admin/screens/Categories.tsx` is the reference screen — one thing at a time chosen from a control at the top, nothing boxed. `Sources.tsx` is the precedent for a register: a row is the fact, a count, and the detail on open, with no sentence repeated per row. The existing migrations establish the vocabulary shape (namespace plus key, `active`, `seeded`).

**Screen rules.** No boxes — no tiles, panels, pills or outlined chips. Sections are a kicker over one ink rule; rows sit on hairlines; controls are plain text with a chevron; the only filled things are the selected row and the one primary button. **No prose on a UI** — the screen tells the story, detail goes behind an info icon, never a paragraph.

**Brand.** Lime `#C8F542` big and flat; ink `#201E1D` for every letter and rule; cream `#FFFDF9` ground. Square corners, 2px ink rules, no shadows. Never cream or white type on lime. Archivo throughout, no second face. Red is retired except for allergen warnings, overrun warnings and the Stop button while listening — **note that an overrun warning is exactly what ceiling pressure is**, so red is available there and nowhere else on these screens. Icons from the one Lucide-based set; never an emoji or a symbol character as an icon.

Colours from `apps/web/src/theme.ts`, never a hex in a screen. Icons from `components/Icon.tsx`. Width from `useViewport()` — one tree with different styles, not two returns, nothing overflowing 390px. Check both views with the Web/Mobile toggle on the Railway deployment, not just a desktop window.

Each screen registered in `src/routes.ts` with a case in `test/routes.test.ts`. Not done without both.

**Every outbound call is ledgered in `provider_calls`** with purpose, household, session, units and — now — class and rate_id, before the integration is enabled. The web bundle never holds a provider key.

---

## 10. Sequence

Each stage independently shippable.

1. **Identity and origin** (§3.1) — the `ownerAccount()` guard first, then the owner account decision, then `households.origin`. Everything else is blocked behind this.
2. **Cost classification** (§3.2) — `class` on `provider_calls`, `purpose_classes`, resolution at write time. Backfill what is safely attributable and label the rest as unattributable rather than guessing.
3. **Commercial register** (§3.3) and the Commercial screen — including repointing `estimated_cost_usd` at the rate table. Do this before the pricing screen: it is the cost half of the same idea and it is where the owner can see what is plugged in.
4. **Plans, prices, entitlements** (§3.4) and the Pricing screen, then `can()` enforcement across the API. Money is meaningless until this lands.
5. **Sessionisation** (§3.5) — a view over data already collected. Cheapest win; do it whenever there is a gap.
6. **Search spine and partitioning** (§3.6). The impression-per-search change before any real traffic arrives.
7. **Instrumentation screen** (§5.12) — early, because it protects everything after it.
8. **Money, Household, Funnels, Engagement, Sections, Data & Library, Health**, in that order.
9. **Forward model** (§5.13) and the **opt-out toggle** (§5.14).
10. Metric dictionary populated as each screen lands, not afterwards.

Tests for the API and the routes. Then `codex exec review --base <branch>` against the handover range, reporting what it found and what was done about each finding, including the ones not acted on and why. That does not replace the tests or checking the deployed site.

---

## 11. Open questions

Where one blocks you, pick the reversible option and say which you picked.

**Settled, do not reopen:** Solo £5.99, Household £8.99 (six logins), Pro £12.99 — Pro adds events, hosting and the AI tools. One-month trial, card up front, revertible. No free tier. Non-subscribers can book events; searching Google-backed places is subscriber-only. Public host, event and tag pages render logged out. Commission is host-paid by trust level — **Verified 20%, Checked 15%, Epic Trusted 10%** — with 5% on direct-link bookings, 0% for the cold-start window (first 90 days or 10 bookings), and a £1.50 minimum that never applies to intro bookings; the guarantee pool comes out of the fee (`hostFees.js`). This supersedes the earlier flat 15%.

**Open:**

- The **annual prices** for all three tiers. £100 Household and £140 Pro were set against the earlier two-tier structure and now need restating against Solo/Household/Pro; ~£65 is the proposal for Solo. The discount band is 10–15%, shallower than the category norm, because cost to serve does not discount.
- Whether **group trips** sit at Solo or Household. Defaulting to Solo, because guest households are the cheapest acquisition Epic has and gating the loop is expensive — but it is a revenue call.
- **Where the ceilings sit** numerically. They cannot be set from evidence until §3.2 yields a real cost-to-serve distribution. Ship the mechanism with generous provisional values and a screen to change them.
- Whether **Pro splits** into a consumer-premium tier and a Host/Business tier once hosting is live. Different buyers, very different willingness to pay.
- **Which account-fix option** the owner picked, and whether the 366 sessions and 4,846 events were backfilled. The reporting must state which periods are attributable either way.
- Whether the **marketplace booker** gets a household immediately or a lightweight record promoted on first subscription. Affects §3.1's `origin` and the booking → subscription funnel.
- **Payment provider** — still outstanding, and it now blocks the commission line as well as subscription revenue. Stripe Connect **destination charges**, where the host's funds never sit in an Epic-controlled balance: no wallet, no stored balance, no discretion over settlement timing beyond a standard post-event hold. Anything resembling an Epic-held float changes the regulatory analysis under the PSRs.
- **Per-host annual earnings** must be reportable by 31 January under the UK platform reporting rules — capture each host's name, address and tax identification number at onboarding, because retrofitting it is painful.

**Dated, and to be re-checked rather than trusted:**

- The **DMCC subscription regime applies from spring 2027**, not at launch. When it arrives: a 14-day cooling-off right on the renewal following a trial with proportionate refund (tacit waiver was explicitly rejected), prescribed reminder notices before that first renewal and six-monthly after, self-service online cancellation, and a cancellation window extending to 14 days after any breach is corrected up to twelve months. Build the notices and the cancel flow now rather than retrofitting them, and make refunds and cooling-off cancellations a visible contra on subscription revenue.
- The **PECR Schedule A1 position** is seven months old, the ICO guidance five, and nothing has been tested by enforcement. Confirm before relying on it.
