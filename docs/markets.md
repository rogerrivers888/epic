# Epic — Markets

**Governing for the markets workstream.** Read with `docs/requirements.md`, `docs/technical-constraints.md`, and the build brief *Epic — Markets: build brief* (`Supporting docs/Markets & Translation/Epic Markets & Translation.md`, 29 Sep 2026). Where this doc and the master register (*Epic — Decisions and policies*) disagree, the register wins on policy; this doc is the markets-specific record.

**Not a translation project.** Epic launches UK → US → possibly Ireland, all English. There is no second language for at least a year, no translation screen, no foreign-language app, no right-to-left support (logical CSS properties only), no currency conversion / payments / tax / legal packs, and nothing that spends money in a new market. What markets give Epic is a proper idea of a *country* — currency, units, area shape, administrative levels, timezone, cost bands — and the ability to display a place from a country Epic has not launched in.

---

## 1. Ratified register entries (§13 of the brief; owner, 29 Sep 2026)

All seven ratified.

1. **Market and language are separate things.** A household's language never follows from the country it is browsing.
2. **Google's place types are a global vocabulary and are never translated.** The Mapping tab is finished for every country. New Google types appear globally and go through the existing "Needs a decision" flow; there is no per-country type mapping.
3. **Fact keys are canonical English forever; only labels are translated.** Foreign wording resolves as an alias of an English canonical key — the same alias mechanism that resolves `step_free` / `stepFree`. This must be in place *before* the first non-English extraction runs, never after.
4. **Google's prohibited territories are enforced in code.** No Google call may be issued for a blocked market, and no place from one may be stored. A blocked market fails cleanly and visibly, never as an empty result that reads as "nothing there".
5. **A place from a groundwork market can be displayed but not marketed to.** No households live there, no marketing, no local sources beyond the ones that exist everywhere. Thin facts read as "don't know", never as "no".
6. **A missing wording renders the `en-GB` version and logs the miss.** It never renders a key and never renders blank.
7. **Collection copy is never machine-written**, in any language or variant.

---

## 2. Markets

One row per country. A market holds: code, name, status, currency, distance unit, temperature unit, Google region code, default timezone, area-code shape (name + pattern + search-by), middle-level name, date format, wording locale, cost bands, and which owned sources apply there.

### 2.1 Status

`Live · Soft launch · Groundwork · Blocked`.

- **Live** — households can subscribe; prices in the local currency; places surfaced to local households.
- **Soft launch** — invited households only.
- **Groundwork** — Epic shows places *from* here to households elsewhere, but has not launched *in* here. Displayed, not marketed to (register 5).
- **Blocked** — derived, not set: Google's terms forbid the Maps Platform here. Enforced in code (register 4).

**Seed (owner, 29 Sep 2026 — this supersedes the design mock, which showed UK Live since 14 Sept and Ireland ahead of the US):**

- **GB — soft launch.**
- **US — groundwork.**
- **IE — groundwork.**
- **Groundwork also:** Portugal, Spain, France, Italy, Greece, Netherlands, Turkey, Croatia, Cyprus, Malta, Austria, UAE. These are where British families holiday, so their places display from launch. Spain carries a large share of British holiday volume on one row — the Canaries and Balearics share its country code and currency.

### 2.2 Blocked markets

Google's Maps Platform is forbidden in nine territories: **China, Crimea, Cuba, Donetsk, Iran, Luhansk, North Korea, Syria, Vietnam.** Enforced in code, not by convention. **Vietnam is the one to watch** — a real British holiday destination that someone will search; it must fail cleanly and visibly.

### 2.3 Owned sources vary by market

The schema says which sources apply where, because a missing source and an empty result look identical otherwise. A market that lacks a source says so on its page ("Not in the US"), and that source's facts read "don't know here", never "no".

- **Everywhere:** OpenStreetMap (Geofabrik extract), Wikidata, Wikipedia, venue websites.
- **Britain only:** FSA food hygiene register, ONS postcode directory, Historic England listings.
- **Market-specific, not yet connected:** NIAH (Ireland), National Register of Historic Places (US).

---

## 3. What differs between markets

### 3.1 Money

Stored as an **amount plus a currency code**, never a bare number with an implied pound sign.

### 3.2 Distance

Stored in **metres**, formatted at display (miles or kilometres per the market). The reach filter reads in the market's unit.

### 3.3 Cost bands

Cost bands move out of the fact definition and into the market. A band is a **per-market judgement set by a person**, seeded from a starting position and replaced with evidence once a local census has run — never derived from price data.

- **UK (pounds):** Free · Cheap under £10 · Mid £10–25 · Dear over £25, per person.
- **Ireland (euros):** Free · under €12 · €12–30 · over €30, per person.
- **US (dollars) — owner starting position, 29 Sep 2026:** Free · under $15 · $15–40 · over $40, per person. Boundaries sit where a real US family's decision changes, not at a conversion of the UK bands. Reference points: children's museums ~$43 for a family of four (~$11/head); regional zoos and science centres $20–30 adult, $15–25 child; mid-size aquariums $30–40; big-name zoos and theme parks $68–100+/head. **Replace with evidence from the actual distribution once a US census has run** — flag when there is enough to do so.
- **Cost bands are not a prerequisite for groundwork.** A market without them shows cost as "don't know" (the standard honest behaviour). **Portugal and Greece need their own euro bands — they do not inherit Ireland's.** Other eurozone groundwork markets may use Ireland's as a placeholder.

**Which band a place is in — the V1 signal is Google, the destination is owned (owner, 30 Sep 2026).** The place-page cost scale (`/api/cost-band`, increment 4) fills a band from Google's `priceLevel` (0–4 → Free/£/££/£££), then labels it with the market's absolute money range ("££ means £10–25 a person"). This is a known interim, not the design: Google's `priceLevel` is a *relative*, food-weighted judgement (how a place compares with others of its kind nearby), so pairing it with our *absolute* money bands asserts a price we have not verified. It is the V1 signal only.
- **A place with no band to show has no cost row at all — never a "not known yet" line, never Free, never a guess** (owner, 1 Oct 2026; register B11, a knowing exception to the §4 "Not known yet" block). On the home market 45 of 80 SL5 places have no `priceLevel`; a row blank that often trains families to ignore it, so cost alone is silent on absence. Budget filters still keep unpriced places in — only the display of the absence goes.
- **Owned admission comes first, Google's level second, nothing if neither** (owner, 1 Oct 2026; built — `sources/admission.js`). The venue's own page is read by `own.js`; a free entry there is written as the owned `cost-band` answer and shown before Google's `priceLevel`. **Only "free" is stored, deliberately and for good:** free needs no market, no money bands and never goes stale, where a price is a number that rots — paid entries fall through to Google even when the extractor reads them. The free guard errs conservative: any qualifier, day, time, month, season or paid ticket near the claim and it is not stored, because a wrong Free sends a family to a gate expecting not to pay, while falling back costs nothing.
- **Market-expansion item — the owned admission route is GB-only.** `site.js` `admissionFrom` recognises only £ prices, so outside GB a €/$ charge goes undetected and a paid venue could read Free. `recordAdmissionAnswer` therefore writes only for GB venues (GB must be known — the index's country, or a postcode whose outcode we hold; an unknown or non-GB country is skipped and any earlier answer cleared). **Whoever opens a euro or dollar market must teach the extractor € and $ (and that market's free-entry wording) before lifting this gate**; until then those markets show Google's level or nothing.

### 3.4 Areas and administrative levels

Three drill levels, each market naming them. Field names stay market-neutral in the schema; display labels come from the market.

- **UK:** Country → County → Postcode district. The UK keeps saying "County".
- **US:** Country → State → City. The US structurally has four levels (state → county → city → ZIP); **ZIP is dropped as a drill level** — the equivalent of "places in SL5" is "places in Boulder", not "places in 80301". **ZIP stays as a search input on the area filter only.**

The area input accepts a **town or city everywhere** as the common denominator; the code type follows the market (postcode in GB, Eircode in IE, ZIP in US; none when no market is chosen). The ONS postcode dataset and its placement logic are Britain-only and must stop being assumed. This is expected to be the largest single piece of work.

**Where the area copy lives (owner Change 3, 29 Sep 2026):** the family-facing area sentences — the input placeholder and the "not a place we know yet…" message — live in the **wording table (migration B)**, keyed per market and resolved per household locale. `markets.area_code` holds **structure only** (`pattern`, `searchBy`, and the code type's own noun for the wording to interpolate) — no sentences, so the copy cannot fall between the two files or end up hardcoded.

### 3.5 Time

Opening hours and events are held in **UTC plus the place's own timezone** — the place's, never the household's — or every American opening time is wrong for most of the country. A zone is named on screen only when it differs from the household's. Until a place has learned its own zone it falls back to its market's `default_timezone`; because the US spans six zones that market default is only a fallback, and a place's own zone always wins.

### 3.6 Wording (en-GB / en-US)

British and American English are different locales; Google treats them as such. A key-based **wording table**, `en-GB` and `en-US` as the first two entries, everything falling back to `en-GB`. Three namespaces: **Interface · Places & facts · Collection copy**.

- **Wording follows the household, never the market of the place (register 1; owner Change 1, 29 Sep 2026).** A British family browsing Florida reads "car park"; an American browsing Cornwall reads "parking lot". The resolver reads the **household's own locale**, falling back to `en-GB` — never the market of the place being displayed. `markets.default_wording_locale` **only seeds a household registering in that market** and does nothing else; it is never read at display time. The resolver and a test that pins this (fails if it ever reaches for the place's market) land with the wording work (migration B / step 3), where `households` gains its own locale column seeded from `default_wording_locale`.
- A missing wording renders `en-GB` and logs the miss (register 6).
- Machine drafts show as a greyed "Suggested: …" placeholder with status *Needs review* until a person types. **Collection copy is never machine-written** (register 7) — a blank `en-US` collection line is the correct state (American households see the British line) until a real American writes theirs. That emptiness must never become a reason to fill them automatically.
- The mechanical differences (car park → parking lot — the ones with a single right answer) may be drafted for review; collection copy may not.

---

## 4. Displaying a place from a groundwork market

A groundwork market's places display to households elsewhere: local name is the name (English name beneath in grey only where Wikidata has one — never translated by us), cost bands in the local currency, opening times in the place's timezone, distances in the household's units. Facts will be thinner because venue-website extraction has not run there and local registers do not exist — the place still shows, with fewer facts, and per the standing rule that reads as "we don't know yet", never "no" (M3: missing standard facts named once under "Not known yet"; no description rather than filler).

**Provenance is non-negotiable (C3 / C22).** A displayed Google rating (e.g. "4.7 · 61k") is rented, **display-only, never stored, and needs attribution on screen**. The Epic score is ours (derived) and must not carry a Google-shaped review count beside it. A description written from owned sources is fine and says so; Google's editorial summary cannot be stored and needs attribution if shown.

---

## 5. Design decisions ratified (Part 2, owner 29 Sep 2026)

- **The "Not known yet" block** names missing standard facts once — the can't-speak rule done properly. Not per-fact "unknown" rows.
- **Three wording tabs** (Interface · Places & facts · Collection copy) rather than a namespace list.
- **Blank `en-US` cell / blank status = "same"**, matching Active on the facts list.
- **"Suggested:" in grey** for machine drafts; none at all on collection copy.
- **Per-market area input** with the code type and unknown message following the market.
- **Cost display (owner DECIDED, 29 Sep 2026 — euros only, no FX):** the card shows the **band symbol alone**; the place page shows the band symbol and the **band's range labelled plainly as the band's range, not the place's price**. No pounds, no conversion, no FX field anywhere. **M2c as drawn ("€12–30 · about £10–26") is superseded** — it implied a place-specific price we do not have, in a currency pair we will not support. The exact final wording comes from Design; the build implements the honest structure (band symbol + band range).
- **The market page must be built** (missing from the artboards): where cost bands are set, the source list lives, area shape and middle-level label are named, and "what is missing before this can go live" is explained. Build from the brief's description.
- **A fourth wording status — "not applicable in this market".** A pub-with-a-garden is not a bar-with-a-patio: choosing this status means the subcategory is *not offered* in that market at all, rather than given a local label that leaves a correctly-named but near-empty drawer reading as a coverage failure. Build the minimum: the status, and counts reading "not applicable here" rather than 0. Same logic as "Not known yet".
- **List-column wording (P2.6):** the cost-bands column must not imply bands are derived from price data — they are a per-market human judgement. The Sources column reads "of the sources that exist for this market" (a varying denominator is correct but must not invite a meaningless cross-market comparison).

---

## 6. Provenance on a displayed place (C3 / C22 — owner confirmed, 29 Sep 2026)

Three rules, on the record, with a UI consequence that is **not yet designed** and must be built:

- **A displayed Google rating ("4.7 · 61k") is Google's:** rented at display, never stored, and it **must carry on-screen Google attribution.** The M1 artboard has none — a visible change flagged back to Design.
- **The Epic score must never appear next to a Google-shaped review count.** If both ever show on one page they must read as unmistakably separate things.
- **The description is written from owned sources** — Wikipedia (credit + link), Wikidata, the venue's own page. Google's editorial summary is never stored and never used.

## 7. Settled and closed

- **FX / M2c — DECIDED (a): euros only for launch.** No FX field, no rate source, no conversion anywhere. See §5.
- **US cost bands** are a starting position pending a US census (§3.3); flag when the distribution can replace them.
- **Who reads the American copy** — a reader is found nearer launch; not a blocker. Collection copy stays `en-GB`-only until then.

---

## 8. Sequence (brief §11)

1. Census report — type vs text. **Done, 29 Sep 2026: type-driven** (bounding box + `includedType`); the only English strings are the type-fenced `WORD_QUESTIONS` in `apps/api/src/sources/censusQuestions.js` (correctness-safe untranslated) and the currently-empty `TEXT_QUESTIONS`. A new country opens with a bounding box.
2. Migration for §4/§5 — **migration 300 `a_place_belongs_to_a_market`, built 29 Sep 2026** (markets table + seed; `area_counts.country_code`; `host_offers.currency`+`timezone`; `place_records.timezone`; `provider_calls.language_code`/`region_code`/`field_mask`; blocked list as the code constant `apps/api/src/domain/markets.js`).
3. Wording table, resolver, miss log — **done 29 Sep 2026** (migration 302).
4. Markets screen, then wording screen — **both done 30 Sep 2026** (increments 2 and 3). Markets page (migration 304, three source states + Connect); wording screen (migration 305, `looked_at` so blank = looked-at-and-same, not-applicable per subcategory, exact undo). Two wording follow-ons:
   - **Drift Was/Now needs the old en-GB text stored.** The screen tells a reviewer "English changed" but cannot yet show *what* changed (a comma or a meaning) — and a reviewer who cannot see the change rubber-stamps it. Store the en-GB text a key's en-US was written against, then show Was (struck through) · Now. Small, but do it before a serious American pass leans on drift.
   - **en-GB key registration is `resolve()`-driven** (a key appears when the app first asks for it, or is seeded). So the wording key list is only as complete as the app's call sites: until every screen calls `resolve` instead of passing string literals, the list understates what exists. Increment 4 (the place page) is the first customer screen to wire `resolve`; its report gives the key count before vs after, and a large jump means other screens are still passing literals.

**Back-office concurrency note (owner, 29 Sep 2026):** the wording writes (`setEnGb` create-or-edit) carry a create-race — `setEnGb` selects for the current row, then upserts, and reports `created` from that pre-upsert read. Two people creating the *same* key in the same instant could both read "absent" and one would record `created: true`, whose undo deletes a row the other still holds. This is not a real risk on a single-admin back office and is deliberately not guarded. **If the desk ever goes multi-editor, the fix is a transaction-scoped advisory lock on `(namespace, key)` around the read-then-upsert** (`pg_advisory_xact_lock(hashtext(...))`), the same shape the census-share lock uses. Recorded so the reasoning survives rather than being re-derived. The stale-miss-row deferral is cosmetic — `wordingMisses` filters filled and en-GB entries at read, so a stale row never surfaces.
5. URLs, hreflang, sitemaps, slug history.
6. Area input and placement for the US — largest item; may warrant its own brief. **Hard prerequisite (Codex, 29 Sep 2026):** before any non-GB census, `area_counts.country_code` must be threaded through the whole access path, not merely added to the schema (it is, as of migration 300, only an unused column defaulting to `'GB'`). Three parts, all of this step: (1) **fold `country_code` into the primary key** — today it is `(area_slug, category, subcategory)` and every `on conflict` clause assumes that, so two markets whose slugs coincide would silently overwrite each other once the US is censused; (2) **every writer must set `country_code`** to the market being censused rather than lean on the `'GB'` default, or non-GB counts land under GB; (3) **every read must filter by `country_code`**, or counts mix across markets. The `'GB'` default is correct only while the census is Britain-only. **Built, 2 Oct 2026 (migration 357, owner-approved design):** a non-GB area's slug carries its country (`ie-w12`; GB unchanged, so the ~60 slug-alone lookups stay correct), held by the `localities_slug_names_its_country` check, and the migration stops and names any unprefixed non-GB area rather than renaming it (production had 0). `area_counts` keys on `(country_code, area_slug, category, subcategory)` with no default, every writer names the market (`CENSUS_MARKET`, `domain/markets.js`) and every read filters by it (`IN_CENSUS_MARKET`). The W12 collision is closed by one postcode rule (`POSTCODE_SAYS_GB`, `repositories/placeIndex.js`): a full ONS postcode is GB whatever the stamp; an outcode alone only fills a missing country. It governs the per-place settle, the whole-corpus correction and the admission check; the area correction (`normaliseOutcodeCountries`) is removed, because under the rule it had nothing left it may do. Still open for a US census: a US postcode dataset, and regions (`regions.slug`) are not yet prefixed.
7. The cross-language alias rule — small; any time before the first foreign extraction.
