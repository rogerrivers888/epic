# G2 inventory: controls an agent credential must not hold

28 Sep 2026. This inventories every Epic API control that spends money or provider quota, deletes, resets, bulk-applies, raises a cap, or starts, resumes or stops a job. It also covers the in-process loops and repo scripts that do the same. The owner's register item G2 asks for it: "An inventory of every control that spends money or quota, deletes, resets or bulk-applies." Each entry carries a recommendation for the restricted agent role G2 describes. That role reads everything, writes only what non-destructive work needs, and never spends, resets, bulk-applies, retires or resumes. Recommendations follow H1 (a change applied across production is pressed by a person) and H2 (an agent proposes and stops). **This document is not the credential.** No role, capability, session kind or code was changed to produce it. The credential is built before launch.

**How it was produced.** Read-only, against the `epic-wt-backoffice` worktree at `833c829`. The inventory lists every `POST`/`PUT`/`PATCH`/`DELETE` in `apps/api/src/routes/*.js` and `server.js`: 383 route definitions, all accounted for when checked against a grep of the route files. It also lists every `GET` found to call a paid provider, start work or write. Each route was traced into `sources/*` and `repositories/*` far enough to classify it. Line numbers are the route's definition line. A cost with no figure was not measured, and the table leaves it blank rather than guessing.

**Columns.** *Classes*: every class an endpoint belongs to. Each endpoint is listed once, under the most serious of its classes. The order of seriousness is CAP › SPENDS › DELETES › RESETS › BULK › JOB › WRITE-OTHER › EDIT. *Guard*: the capability (`requires('…')`), `requireOwner`, *session-only* (any signed-in session, no capability), or *public* (outside the session door, gated by a link token). Every `/api/admin/*` and `/api/accounts/*` route also sits behind `requireDoor('admin')`. *Agent*: the recommendation for the restricted agent role, which is one of three values:
- **DENY**.
- **ALLOW**: a single-item edit that is logged or undoable, or a read.
- **READ-VARIANT**: a named parameter makes the call safe, and only that form is allowed.

## What the inventory says before the tables

1. **Today an agent is the owner.** A passcode session resolves to the owner role, with every door and every capability (`access.js` `accessFor`; register G1). The only thing that tells an agent apart is `sessionKindFor` (`auth.js:120`), which guesses from the user agent and label. By the code's own account, it is "a heuristic against a shared secret". The G8 paid gate uses that kind to refuse paid Google and Claude calls. It does not stop deletes, resets, bulk applies, job starts or ceiling changes. Nothing in this inventory marked DENY is refused to an agent today except the Google and Claude spending.
2. **The existing capabilities cannot express G2.** `manage_library` guards 135 routes. Its routes range from a single audited place edit to paid collection runs, whole-index rebuilds, taxonomy apply, census start and resume, and TripAdvisor spend. `manage_settings` covers both the collection ceiling and the provider on/off switch, as well as agent paid grants. `view_library` and `view_reporting` both have GETs that spend. The agent role needs finer capabilities, not a subset of today's (see *Capabilities today*).
3. **The G8 gate covers only Google Places, photos and Routes (`admitPaid`) and Claude (`assertWithinBounds`).** The following paid calls do not ask what kind of session made them:
   - TripAdvisor (`/place/compare`, `/lookup/*`, `/collect`, discover and trip searches);
   - LiteAPI (`/api/stays/*`, `/trips/:id/stays`);
   - PredictHQ, Ticketmaster, SeatGeek and Datathistle (event search);
   - OpenAI through `/api/host/offers/:id/extract` and `/api/open/heard`;
   - Twilio and Postmark sends.
4. **Background work spends on sessions the gate does not stop.**
   - `startScoutLoop` reads menus with Claude as the first household with no session. The Claude gate refuses agent sessions only, so the daily ceiling and the household Claude bound are the only limits.
   - An agent can queue that work without spending itself, through `POST /scout/menus/retry`, `/scout/counties/:name` and shortlisting a place.
   - `resumeSweeps` keeps spending paid Google on the starter's live session after every deploy.
   - `resumeCollections` spends on TripAdvisor with no session check.
5. **32 GETs spend or can spend.** A "read everything" role that allows every GET therefore spends. Nine are in the back office and one is the photo proxy:
   - `/api/admin/lookup`, `/lookup/place`, `/shelves/food` and `/scout/model/check` (Claude), all under `view_library`;
   - `/lookup/compare`, `/taxonomy/examples`, `/place-index/place/compare`, `/demand/search?names=1` and `/voice/probe`;
   - `/api/photos/google`.

   The other 22 are in the household app: Inspire, atlas, places, plan and trip searches, journeys, directions and stays. All are in the SPENDS table. Read access must be granted per route, not per HTTP verb.
6. **A `dryRun` that still spends.** `POST /api/admin/scout/areas/:code/sweep` and `POST /api/admin/library/sweep` still call Google when `dryRun` is set. Only the writes are skipped. Neither is a safe read variant.

## 1. Raises a cap, bound or ceiling, or changes a spend or access setting

14 endpoints whose most serious class is this one. Back-office routes come first, then household-app routes.

| Endpoint | Where | Guard | Classes | What it does | Cost / scale | Agent |
|---|---|---|---|---|---|---|
| `POST /api/accounts` | accounts.js:261 | manage_accounts | CAP, WRITE-OTHER | creates an account and household, sets monthlyCallBound, emails an invite | 1 email | DENY |
| `PATCH /api/accounts/:id` | accounts.js:342 | manage_accounts | CAP, RESETS, WRITE-OTHER | plan, status, monthlyCallBound; suspend revokes sessions | account | DENY |
| `PUT /api/admin/desk/settings/:key` | desk.js:116 | manage_library | CAP | Changes any setting, including budgetGoogle/budgetClaude (up to £100,000) | Logged and undoable; budgets are display-only today | DENY |
| `PATCH /api/admin/library/regions/:slug` | library.js:198 | manage_library | CAP, BULK | sets target count (1–500) and republishes the region | whole region | DENY |
| `POST /api/admin/place-index/census/run` | placeIndex.js:3543 | manage_library | CAP, SPENDS, JOB | Starts a census run; body sets `maxRequests`, `dailyCap`, `ratePerSec`, `nightShare`; audited | default 250k requests, 75k/day; values are not upper-bounded | DENY (READ-VARIANT: GET /census/quote; `paused:true` builds it without starting) |
| `PATCH /api/admin/plans/:key` | admin.js:463 | manage_plans | CAP, WRITE-OTHER | plan price, callBound, active | every account on the plan | DENY |
| `PUT /api/admin/runs/ceiling` | runs.js:54 | manage_settings | CAP | Sets the monthly paid-collection ceiling; no upper limit; audited | default 25000p (£250) | DENY |
| `POST /api/admin/scout/menus/share` | scout.js:325 | manage_library | CAP, BULK | menu share / keep / perCuisine; applies to all areas if no code is given | raises deferred spend | DENY |
| `POST /api/admin/sessions/:id/grant` | admin.js:698 | manage_settings (+device session only) | CAP | grants an agent session paid hours | ≤72h | DENY |
| `PUT /api/admin/skills/credential-type` | hostSkills.js:891 | manage_skills | CAP, BULK | Upsert credential rule; stricter rule auto-pauses every non-qualifying live offer | all live offers in gated categories | DENY |
| `POST /api/admin/suite/supplier/:key/adapter` | suite.js:444 | manage_settings | CAP | switches a provider on or off (setSourceOff); on=true re-enables paid calls | estate-wide | DENY |
| `POST /api/admin/taxonomy/not-sure/run` | taxonomy.js:776 | manage_library | CAP, SPENDS, JOB | Background Claude web-research run over waiting places | Default 250 places; `cap` in the body raises it to 1,000; ≤3 searches each | DENY |
| `PATCH /api/sources/:key` | server.js:497 | session-only (no capability) | CAP | Switches a provider source on or off for the whole estate | Turning a keyed source back on re-enables its paid calls everywhere | DENY |
| `PATCH /api/trips/:id` | trips.js:672 | session-only | CAP, EDIT | Edits the trip; the `sources` field sets which paid sources its searches use | `sources` can switch on TripAdvisor or the scout (Claude) for every later search | DENY when the body has `sources`; otherwise ALLOW |

## 2. Spends money or quota

87 endpoints whose most serious class is this one. Back-office routes come first, then household-app routes.

| Endpoint | Where | Guard | Classes | What it does | Cost / scale | Agent |
|---|---|---|---|---|---|---|
| `POST /api/admin/data/sources/bench` | admin.js:589 | manage_settings | SPENDS | Google Place Details bench on sampled places | ≤50 × Enterprise+Atmosphere, about $1.25, no confirm | DENY |
| `GET /api/admin/demand/search?names=1` | demand.js:175 | view_reporting (spends only if caller also has manage_library) + spendLimit | SPENDS | Search replay buys Google Place Details for nameless `google:` rows | ~2.5p per uncached row; ceiling reserved first | DENY (READ-VARIANT: leave out `names=1`) |
| `POST /api/admin/library/attractions/:id/category/read` | library.js:824 | manage_library | SPENDS | Claude turns a sentence into a proposal; writes nothing | 1 Claude call | DENY |
| `POST /api/admin/library/attractions/:id/read` | library.js:962 | manage_library | SPENDS | Claude reads one attraction and saves facts | 1 Claude call | DENY |
| `POST /api/admin/library/regions/:slug/read` | library.js:1078 | manage_library | SPENDS, BULK | Claude reads a whole region | ≤100 Claude calls; `anyway:true` skips the 5-approval check | DENY |
| `POST /api/admin/library/sweep` | library.js:630 | manage_library | SPENDS, BULK, JOB | Google activity sweep of up to 4 regions | hundreds of requests per county; dryRun still calls Google | DENY |
| `POST /api/admin/library/venues/read` | library.js:1147 | manage_library | SPENDS | Claude + web search on one venue | ≤8 searches | DENY |
| `GET /api/admin/lookup` | lookup.js:448 | view_library | SPENDS | ring search across rented sources | 2 Google requests if not cached; ceiling-checked | DENY |
| `GET /api/admin/lookup/compare` | lookup.js:510 | manage_library | SPENDS | live Google details plus TripAdvisor view | ≤4 Google + 2 TA locations; ceiling-claimed | DENY |
| `POST /api/admin/lookup/curate` | lookup.js:874 | manage_library | SPENDS | claims a place, paid enrich (Place Details), Google rating, Claude curation | ring + 2 Google + ≤2 Details + 1 Claude | DENY |
| `GET /api/admin/lookup/place` | lookup.js:466 | view_library | SPENDS | same ring search, one place opened | 2 Google requests if not cached | DENY |
| `POST /api/admin/lookup/rate` | lookup.js:696 | manage_library | SPENDS, BULK | Google match and rating for not-owned places | ≤62 Google requests; ceiling claim | DENY |
| `POST /api/admin/lookup/tripadvisor` | lookup.js:766 | manage_library | SPENDS, RESETS, BULK | joins places to TripAdvisor; retryMissed forgets misses | ≤80 TA locations + ring; TA cap | DENY |
| `POST /api/admin/place-index/ask` | placeIndex.js:2398 | manage_library + spendLimit | SPENDS, BULK | Google match + Place Details for up to 50 places; writes bands and IDs | about 2.5 to 5p each, so up to ~£2.50 a press; month ceiling reserved first | DENY (READ-VARIANT: GET /ask/quote) |
| `POST /api/admin/place-index/census/edge/run` | placeIndex.js:3521 | manage_library | SPENDS, JOB | Starts a finer census run on one ring's edge; audited | IDs Only mask, so free, but uses project quota; rate clamped 1 to 10/s | DENY (READ-VARIANT: GET /census/edge/quote; `maxRequests` must equal the quote) |
| `POST /api/admin/place-index/census/run/:id/resume` | placeIndex.js:3681 | manage_library + resume key (only if set) + label echoed as `confirm` | SPENDS, JOB | Resumes a stopped, paused or waiting census under the caller's session; audited | a day's quota | DENY |
| `POST /api/admin/place-index/collect` | placeIndex.js:2729 | manage_library + spendLimit | SPENDS, BULK, JOB | Starts a background run: free research + Google + Tripadvisor over a county or ring | up to 200 places per source; ceiling checked per chunk of 10; TA cap 120 locations/month | DENY (READ-VARIANT: GET /collect/quote) |
| `GET /api/admin/place-index/place/compare` | placeIndex.js:1735 | view_library (spends only if caller also has manage_library, via `can()`) | SPENDS, WRITE-OTHER | Fetches Google/Tripadvisor detail live; `?match=1` also buys a Google match; saves matches | Google ~2.5p a call (x2 with match); Tripadvisor view = 2 billed locations plus an ungated match search | DENY (READ-VARIANT: no `match=1` and no manage_library means nothing is bought, cached detail is free) |
| `POST /api/admin/questions/candidates/classify` | questions.js:247 | manage_questions | SPENDS, BULK | Claude sorts the holding pen, 80 words per call | up to 2000 words, about 25 Claude calls, no confirm | DENY |
| `POST /api/admin/questions/harvest/features` | questions.js:468 | manage_questions | SPENDS, BULK | Claude feature pass, one call per drawer | confirm=calls, session bound | DENY (GET /harvest/features/estimate is the read form) |
| `POST /api/admin/questions/harvest/google` | questions.js:636 | manage_questions | SPENDS, BULK | Google Text Search per subcategory × region | confirm=requests; capped at MAX_GOOGLE_REQUESTS | DENY (GET /harvest shows the plan) |
| `POST /api/admin/questions/harvest/probe` | questions.js:413 | manage_questions | SPENDS | one Google Text Search (Enterprise+Atmosphere); writes a run row | 1 paid request, no confirm | DENY |
| `POST /api/admin/questions/reference` | questions.js:544 | manage_questions | SPENDS, BULK, JOB | reference-set research sweep | confirm=requests | DENY (GET /reference/estimate) |
| `POST /api/admin/questions/sweep` | questions.js:510 | manage_questions | SPENDS, BULK, JOB | research sweep (Google + Claude), background worker, resumes at boot | confirm=requests; one running at a time | DENY (GET /sweep/estimate) |
| `POST /api/admin/questions/sweep/:id/retry` | questions.js:600 | manage_questions | SPENDS, RESETS, JOB | re-runs a sweep's failed places | confirm=requests | DENY (GET /sweep/:id/retry/estimate) |
| `POST /api/admin/scout/areas/:code/sweep` | scout.js:74 | manage_library | SPENDS, BULK | sweeps one area (OSM + Google, 8 queries × 2 pages) and rewrites its ranks | about 16 requests, about 20p; dryRun still spends | DENY |
| `POST /api/admin/scout/areas/sweep` | scout.js:92 | manage_library | SPENDS, BULK, JOB | sweeps a list of areas in the background, one after another | no limit on codes, no confirm | DENY |
| `POST /api/admin/scout/bench/:code` | scout.js:409 | manage_library | SPENDS | live Google bench of one area | about 16 requests, about 20p | DENY |
| `POST /api/admin/scout/menus/read` | scout.js:154 | manage_library | SPENDS, BULK, JOB | Claude reads menus, run as a background batch | ≤40 Claude calls; sessionId forced null so the session bound is skipped | DENY |
| `GET /api/admin/scout/model/check` | scout.js:208 | view_library | SPENDS | one Claude "say ok" call | a few tokens | DENY |
| `GET /api/admin/shelves/food` | shelves.js:261 | view_library | SPENDS | Live multi-source restaurant search around home | Paid sources on a cache miss; logged as a provider call | DENY |
| `POST /api/admin/shelves/read` | shelves.js:504 | manage_library | SPENDS | One Claude call turns a sentence into weights; doesn't write | 1 Claude call | DENY |
| `GET /api/admin/taxonomy/examples` | taxonomy.js:1068 | manage_library | SPENDS | One Google Text Search near home; `queue=1` also writes to Not sure | 1 paid call on the Enterprise tier (asks for websiteUri), about 2–3p | DENY |
| `POST /api/admin/taxonomy/word` | taxonomy.js:713 | manage_library | SPENDS | Claude with web search and fetch recommends a word's mapping; doesn't apply it | 1 Claude call, ≤4 searches | DENY |
| `GET /api/admin/voice/probe` | voice.js:330 | manage_settings | SPENDS | mints a live token and transcribes 0.2s of silence | tiny OpenAI | DENY |
| `POST /api/admin/voice/runs` | voice.js:374 | manage_settings | SPENDS | voice lab run: OpenAI plan for up to 3 transcripts, stores the run | ≤3 calls | READ-VARIANT (`plan:false` makes no calls) |
| `GET /api/atlas/places` | atlas.js:251 | session-only | SPENDS | Lists places, then fills missing photo/type/rating in the background | Up to 8 Google photo + 8 types + 8 rating calls per read, again on each poll | DENY |
| `POST /api/discover` | discover.js:22 | session-only | SPENDS | Live search of every enabled source, not cached | Google Places, Tripadvisor (~$0.15/search), PredictHQ/Ticketmaster/SeatGeek | DENY |
| `POST /api/host/offers/:id/extract` | hosting.js:909 | session-only | SPENDS | Transcribe offer video and write listing with an LLM | OpenAI transcribe + extract, no paidGate | DENY |
| `POST /api/household/members/:id/invite` | household.js:526 | session-only | SPENDS, WRITE-OTHER | Creates or reactivates an account, mints a sign-in link, texts and/or emails it | Twilio SMS + Postmark per send; can un-suspend an account | DENY |
| `GET /api/inspire/around` | inspire.js:533 | session-only | SPENDS | Ring board: census counts plus paid Google display pages | Up to 8 display searches per cache miss; `page` up to 24 | DENY |
| `GET /api/inspire/near` | inspire.js:653 | session-only | SPENDS | Home shelves: up to 8 Google display searches; `live=1` or an unswept area adds a look-around | As above + searchCached | DENY |
| `POST /api/menu/dish` | menus.js:330 | session-only | SPENDS | Claude description of a dish, cached globally | 1 Claude call per new dish | DENY |
| `POST /api/menu/read` | menus.js:185 | session-only | SPENDS | Reads a menu via headless browser + Claude; stores it for this household and a shared copy | ~1+ Claude calls | READ-VARIANT (`dryRun:true` stops before Claude) |
| `POST /api/open/heard` | openTo.js:160 | session-only | SPENDS | LLM turns a transcript into interest chips | OpenAI extract, no paidGate | DENY |
| `GET /api/photos/google` | server.js:523 | session-only, or a signed photo link | SPENDS | Fetches one Google photo through paidGate | 1 Places photo request each; held 1h in memory | DENY (paidGate already refuses agent sessions without a grant) |
| `GET /api/places/detail` | places.js:639 | session-only | SPENDS, JOB | Place Details on memory miss; claimed place queues paid research | Google Details / Tripadvisor 2 entities; queued Google ×2 + Claude web search | DENY |
| `GET /api/places/inside` | places.js:91 | session-only | SPENDS, JOB | Rides/animals inside a park via Overpass; background Claude "who can ride" once per park | Claude: 6 searches / 14 fetches | DENY |
| `GET /api/places/ratings` | places.js:806 | session-only | SPENDS | Google rating lookup for up to 24 refs | Up to 24+ calls per request | DENY |
| `POST /api/places/record` | places.js:849 | session-only | SPENDS, RESETS | Paid re-research of one place; `replace` wipes facts held | Google ×2 + Claude web search | DENY |
| `GET /api/places/reviews` | places.js:780 | session-only | SPENDS | Matches the place to Google, fetches rating and reviews | 1–2 Google calls | DENY |
| `GET /api/places/search` | places.js:335 | session-only | SPENDS | Place search across all sources | Google + Tripadvisor per miss | DENY |
| `GET /api/places/suggest` | places.js:515 | session-only | SPENDS | Google Autocomplete predictions | 1–2 calls per request | DENY |
| `POST /api/plan/day` | plan.js:2591 | session-only | SPENDS | New session and pool for one trip day | retrievePool (all sources, Routes) | DENY |
| `POST /api/plan/go` | plan.js:1895 | session-only | SPENDS, DELETES, JOB | Background plan run; overnight plans every day; deletes the previous untouched trip | Sources + Routes matrix/corridor/routeBetween | DENY |
| `POST /api/plan/inspire` | plan.js:1388 | session-only | SPENDS, JOB | Background Claude ideas run plus geocoding of each idea | 1–2 Sonnet calls; ≤5 Nominatim | DENY |
| `POST /api/plan/inspire/more` | plan.js:1598 | session-only | SPENDS, JOB | Five more ideas on the same session | Same as above | DENY |
| `GET /api/plan/inspire/things` | plan.js:1683 | session-only | SPENDS | Look-around search near an idea, plus a Google name search | searchCached across place sources; +1 Google text search | DENY |
| `POST /api/plan/inspire/trip` | plan.js:1826 | session-only | SPENDS, EDIT | Creates a trip from an idea and fills the shortlist | Look-around on cache miss; ≤3 Nominatim | DENY |
| `POST /api/plan/preview` | plan.js:1945 | session-only | SPENDS | Claude reads partial speech into rows | 1 Claude call (low effort) per call | DENY |
| `POST /api/plan/refine` | plan.js:2245 | session-only | SPENDS | Claude reads a spoken reaction to the options | 1 Claude call | DENY |
| `POST /api/plan/start` | plan.js:1084 | session-only | SPENDS, JOB | Claude reads the intent; "plan it" starts a background plan run | Claude call per utterance; run as /go | DENY |
| `POST /api/plan/tastes` | tastes.js:299 | session-only | SPENDS, JOB | Background "best dish" tables | ≤4 searches (Google dish search) + Routes matrix | DENY |
| `GET /api/plan/tastes/around` | tastes.js:345 | session-only | SPENDS | Look-around near a table's place | searchCached on miss | DENY |
| `POST /api/plan/tastes/menu` | tastes.js:404 | session-only | SPENDS, JOB | Background Claude web-search read of one menu | ~$0.05–0.20 each; 120/month/household (`EPIC_MENU_CHECKS_MONTHLY`) | DENY |
| `POST /api/plan/tastes/trip` | tastes.js:457 | session-only | SPENDS, EDIT | Creates a trip from a table and fills the shortlist | Look-around on miss; Nominatim | DENY |
| `GET /api/plan/trips/:tripId/sources` | plan.js:911 | session-only (trip not checked against household) | SPENDS | Admin diagnostic: runs full plan retrieval for one trip day | All default sources + Google Routes matrix; `scout=1` adds Claude | DENY |
| `POST /api/session/request-link` | session.js:184 | public (general limiter only) | SPENDS, WRITE-OTHER | Emails or texts a sign-in link to an existing account | Twilio / Postmark per request | DENY |
| `POST /api/shared/:token/enter` | shared.js:138 | public | SPENDS, WRITE-OTHER | Creates a guest and texts or emails a code to any contact typed | Twilio SMS / Postmark, 1 per call; only the general limit (900 per 5 min) | DENY |
| `GET /api/stays/options` | stays.js:45 | session-only | SPENDS | Counts the facilities on offer near a point | LiteAPI hotels + vocabularies (quota) | DENY |
| `GET /api/stays/probe` | stays.js:126 | requireOwner | SPENDS | Checks which fields LiteAPI actually sends | LiteAPI quota | DENY |
| `GET /api/trips/:id/along` | trips.js:891 | session-only | SPENDS | Browses places along the route, searching several circles | 2–6 circles × the default sources (Google Places, PredictHQ/Ticketmaster/SeatGeek/Datathistle, OSM) plus the trip's saved opt-ins; `refresh=1` skips the 12h cache; writes the search log and place index | DENY |
| `GET /api/trips/:id/directions` | journey.js:301 | session-only | SPENDS | Step-by-step directions for one leg | 1 Google Routes call | DENY |
| `GET /api/trips/:id/journey` | journey.js:244 | session-only | SPENDS | Works the shortlist into a timed day | Google Routes: 1 call per leg with a car, 3 per leg without; cached 6h in memory | DENY |
| `POST /api/trips/:id/journey/save` | journey.js:261 | session-only | SPENDS, RESETS | Wipes the day's stops and rewrites them from the journey | Same Routes calls; `force:true` skips the blocker checks | DENY |
| `GET /api/trips/:id/places` | trips.js:586 | session-only | SPENDS | Lists the trip's places; after replying, buys missing photos | Google photos, ≤8 per open; goes through `admitPaid` | READ-VARIANT (the list itself is free; the photo buying is already refused for agent sessions) |
| `GET /api/trips/:id/shortlist/search` | trips.js:1777 | session-only | SPENDS | Place and event search around the base | Default sources; `?sources=` can add TripAdvisor (billed per location) or the scout (Claude web search, "costs money for every place and day"); `refresh=1` | DENY |
| `GET /api/trips/:id/shortlist/search/stream` | trips.js:1793 | session-only | SPENDS | Same search, streamed as progress events | Same as above | DENY |
| `GET /api/trips/:id/stays` | trips.js:1329 | session-only | SPENDS | Ranks and prices beds near the trip | LiteAPI hotels+rates (quota, $0 on the ledger); Overpass; station lookup may fetch live and write the transit table | DENY |
| `GET /api/trips/:id/travel/suggest` | tripTravel.js:378 | session-only | SPENDS | Proposes a train or drive from home | 1 Google Routes call | DENY |
| `POST /api/voice/household/food` | voice.js:759 | session-only | SPENDS | OpenAI parses food | 1 call | DENY |
| `POST /api/voice/household/likes` | voice.js:775 | session-only | SPENDS | OpenAI parses likes | 1 call | DENY |
| `POST /api/voice/household/who` | voice.js:714 | session-only | SPENDS | OpenAI parses people | 1 call | DENY |
| `POST /api/voice/intake` | voice.js:585 | session-only | SPENDS | OpenAI trip facts; writes an intake | 1 call | DENY |
| `POST /api/voice/live-token` | voice.js:211 | session-only | SPENDS | mints an OpenAI Realtime session token | 60 per day | DENY |
| `POST /api/voice/plan` | voice.js:270 | session-only | SPENDS | OpenAI turns a transcript into intent | 1 call | DENY |
| `POST /api/voice/transcribe` | voice.js:151 | session-only | SPENDS | OpenAI transcription | ≤300s; household minutes cap + assertWithinBounds | DENY |

## 3. Deletes

56 endpoints whose most serious class is this one. Back-office routes come first, then household-app routes.

| Endpoint | Where | Guard | Classes | What it does | Cost / scale | Agent |
|---|---|---|---|---|---|---|
| `DELETE /api/accounts/:id` | accounts.js:386 | manage_accounts | DELETES, RESETS | deletes an account; withHousehold=1 wipes all their data | irreversible | DENY |
| `POST /api/admin/demand/roll-up` | demand.js:401 | manage_settings | DELETES, BULK | Folds the search log into monthly buckets; `drop:true` permanently deletes the rows | default: everything over a year old | DENY |
| `POST /api/admin/desk/mapping/:word/exclude` | desk.js:166 | manage_library | DELETES, BULK | Excludes the word: its places leave Epic, labels rule deleted | Confirmation happens on screen only, not in the API; undoable | DENY |
| `PUT /api/admin/filing/mapping/:word` | filing.js:1028 | manage_library | DELETES, BULK | Points a Google word at a drawer or excludes it; exclusion hard-deletes the rule | A word can file 100s–1,000s of places; logged with no undo record | DENY |
| `POST /api/admin/filing/rules/:id/retire` | filing.js:1364 | manage_library | DELETES | Hard-deletes a drawer default | Old value not kept, so it can't be undone | DENY |
| `DELETE /api/admin/library/images/:id` | library.js:488 | manage_library | DELETES | deletes an image; audited | 1 image | DENY |
| `DELETE /api/admin/library/images/:id/links` | library.js:481 | manage_library | DELETES | unlinks an image; not audited | 1 row | DENY |
| `POST /api/admin/place-index/reindex` | placeIndex.js:3161 | manage_library | DELETES, BULK, JOB | Deletes and rebuilds the whole index's derived tables; runs in background unless `wait` | free, whole estate | DENY |
| `POST /api/admin/questions/candidates/:id/ignore` | questions.js:294 | manage_questions | DELETES, EDIT | ignores the word and wipes its examples (evidence is lost) | 1 row | DENY |
| `POST /api/admin/questions/candidates/purge-sweep` | questions.js:449 | manage_questions | DELETES, BULK | hard-deletes the old sweep's candidates | confirm=count required | DENY |
| `DELETE /api/admin/questions/questions/:id` | questions.js:172 | manage_questions | DELETES | soft-deactivates a set question | 1 row | DENY |
| `POST /api/admin/questions/reference/wikipedia-audit/forget` | questions.js:574 | manage_questions | DELETES, BULK | deletes Wikipedia/Wikidata facts and recomposes records | every flagged place if `refs` is omitted; no confirm | DENY |
| `DELETE /api/admin/questions/sets/subcategories/:key` | questions.js:148 | manage_questions | DELETES | hard-deletes the set/subcategory link | 1 row | DENY |
| `POST /api/admin/reach/build` | reach.js:169 | manage_library | DELETES, BULK, JOB | Rebuilds the whole reach matrix from scratch, deleting per-cell rows first | free, cap up to 180 min | DENY |
| `DELETE /api/admin/roles/:id` | admin.js:447 | manage_roles | DELETES | deletes a non-system role | holders | DENY |
| `DELETE /api/admin/shelves/categories/:key` | shelves.js:562 | manage_library | DELETES | Hard-deletes a category (refused if it still has drawers) | No log | DENY |
| `DELETE /api/admin/shelves/rules/:id` | shelves.js:473 | manage_library | DELETES, BULK | Hard-deletes a rule and clears the word's mapping | Can unfile a whole type | DENY |
| `DELETE /api/admin/shelves/subcategories/:id` | shelves.js:587 | manage_library | DELETES, BULK | Hard-deletes a drawer; its places stop being sorted | No log; no undo | DENY |
| `DELETE /api/admin/skills/category/:key` | hostSkills.js:472 | manage_skills | DELETES | Delete unused category | - | DENY |
| `DELETE /api/admin/skills/format/:key` | hostSkills.js:473 | manage_skills | DELETES | Delete unused format | - | DENY |
| `DELETE /api/admin/suite/subscriptions/benefits/:id` | suite.js:313 | manage_plans | DELETES | removes a benefit | 1 row | DENY |
| `POST /api/admin/taxonomy/audit/apply` | taxonomy.js:651 | manage_library | DELETES, BULK | Applies every accepted proposal in one transaction | Can retire or merge drawers, switch facts off, exclude words, delete rules; snapshot kept | DENY |
| `POST /api/admin/taxonomy/audit/undo` | taxonomy.js:660 | manage_library | DELETES, BULK | Restores the snapshot and hard-deletes drawers it created that are unused | Estate-wide | DENY |
| `POST /api/admin/taxonomy/rules/batch` | taxonomy.js:1393 | manage_library | DELETES, BULK | Approves up to 500 mappings or exclusions in one press | ≤500 words; returns an undo token | DENY |
| `POST /api/admin/taxonomy/rules/undo` | taxonomy.js:1582 | manage_library | DELETES, BULK | Reverts a batch: deletes the rules it made, restores the rest | Size of the batch | DENY |
| `DELETE /api/admin/voice/runs/:id` | voice.js:473 | manage_settings | DELETES | hard-deletes a lab run | 1 row | DENY |
| `DELETE /api/atlas/cities` | atlas.js:465 | session-only | DELETES | Deletes a city the household created | — | DENY |
| `DELETE /api/atlas/places` | atlas.js:431 | session-only | DELETES | Removes a place and its saved/dismissed marks (refused if it has visits) | — | DENY |
| `POST /api/chat/faq/:id/withdraw` | chat.js:1022 | session-only | DELETES | Unpublish an FAQ entry | - | DENY |
| `DELETE /api/groups/:id` | groups.js:544 | session-only | DELETES | Delete group if no outsiders joined | - | DENY |
| `DELETE /api/groups/:id/items/:itemId` | groups.js:650 | session-only | DELETES | Delete item nobody has acted on | - | DENY |
| `DELETE /api/groups/:id/participants/:pid` | groups.js:709 | session-only | DELETES, WRITE-OTHER | Remove person; triggers tellWaitlist | email/SMS | DENY |
| `DELETE /api/host` | hosting.js:345 | session-only | DELETES, RESETS, BULK, WRITE-OTHER | Delete host, all offers and media; `?force=1` cancels bookings and emails/SMSes the guests | email/SMS per booked household | DENY |
| `DELETE /api/host/contacts/:id` | hosting.js:1041 | session-only | DELETES | Delete a contact | - | DENY |
| `DELETE /api/host/credentials/:typeKey` | hostSkills.js:289 | session-only | DELETES | Remove own credential, refused if live offers rely on it | - | DENY |
| `DELETE /api/host/evidence/:id` | hosting.js:1125 | session-only | DELETES | Delete evidence | - | DENY |
| `DELETE /api/host/media/:id` | hosting.js:446 | session-only | DELETES | Delete own media | - | DENY |
| `DELETE /api/host/offers/:id` | hosting.js:753 | session-only | DELETES | Delete offer, refused if live bookings exist | - | DENY |
| `DELETE /api/host/offers/:id/invites/:iid` | hosting.js:993 | session-only | DELETES | Remove an invite | - | DENY |
| `DELETE /api/household` | household.js:854 | session-only (confirmName must match) | DELETES, RESETS | Deletes the whole household and its provider-call history | Whole tenant | DENY |
| `DELETE /api/household/constraints/:id` | household.js:719 | session-only | DELETES | Removes a preference, including an allergen (safety data) | — | DENY |
| `DELETE /api/household/members/:id` | household.js:363 | session-only | DELETES | Deletes a member's profile and rating history | — | DENY |
| `DELETE /api/household/members/:id/invite` | household.js:608 | session-only | DELETES, RESETS | Deletes the member's account and revokes all its sessions | — | DENY |
| `DELETE /api/open/:id` | openTo.js:255 | session-only | DELETES | End entry (soft) | - | DENY |
| `POST /api/open/matches/:id/decide` | openTo.js:576 | session-only | DELETES, WRITE-OTHER | Yes/no after videos; deletes both videos | - | DENY |
| `POST /api/open/matches/:id/hello` | openTo.js:509 | session-only | DELETES, WRITE-OTHER | Upload hello video, delete the one it replaces | 30 MB | DENY |
| `POST /api/open/matches/:id/id/:which` | openTo.js:638 | session-only | DELETES, WRITE-OTHER | Upload ID document/selfie, delete previous | - | DENY |
| `DELETE /api/orders/:id` | menus.js:462 | session-only | DELETES | Deletes an uneaten order | — | DENY |
| `POST /api/plan/commit` | plan.js:2483 | session-only | DELETES, EDIT | Clears the day's unvisited stops and writes the chosen option | — | DENY |
| `DELETE /api/trips/:id` | trips.js:706 | session-only | DELETES | Hard-deletes the trip; days, stops, shortlist, travel, chat and guests go with it | 10 tables delete with it (cascade); no undo; no household check | DENY |
| `DELETE /api/trips/:id/share/guests/:guestId` | tripChat.js:231 | session-only | DELETES | Remove guest | - | DENY |
| `DELETE /api/trips/:id/shortlist/:itemId` | trips.js:1893 | session-only | DELETES | Removes one shortlist item | Single row, hard delete | DENY |
| `DELETE /api/trips/:id/stops/:stopId` | trips.js:1953 | session-only | DELETES | Removes one stop | Single row, hard delete | DENY |
| `DELETE /api/trips/:id/travel/legs/:legId` | tripTravel.js:289 | session-only | DELETES | Deletes one travel leg | Single row | DENY |
| `DELETE /api/visits/:id` | places.js:976 | session-only (no household check) | DELETES | Deletes any visit by id | — | DENY |
| `PUT /api/visits/:id/takes` | places.js:961 | session-only (no household check) | DELETES, EDIT | Replaces all ratings on a visit | — | DENY |

## 4. Resets, forgets or revokes

8 endpoints whose most serious class is this one. Back-office routes come first, then household-app routes.

| Endpoint | Where | Guard | Classes | What it does | Cost / scale | Agent |
|---|---|---|---|---|---|---|
| `POST /api/accounts/:id/sign-out` | accounts.js:431 | manage_accounts | RESETS | revokes all of the account's sessions | account | DENY |
| `POST /api/admin/scout/menus/causes/:cause/retry` | scout.js:242 | manage_library | RESETS, BULK | puts a whole cause back in the queue (loop then pays to read) | deferred Claude | DENY |
| `POST /api/admin/scout/menus/retry` | scout.js:248 | manage_library | RESETS, BULK | puts every miss back in the queue | deferred Claude | DENY |
| `POST /api/admin/skills/identifiers/propose` | hostSkills.js:772 | manage_skills | RESETS, BULK, JOB | Background run of up to 600 Wikidata lookups; `again` clears proposals first | ~465-600 free calls, quota | DENY |
| `PATCH /api/groups/:id` | groups.js:509 | session-only | RESETS, WRITE-OTHER, EDIT | Settings incl. auto-chasing, cadence, close, payment mode; `newLink` revokes invite link | drives the loop's messages | DENY |
| `PATCH /api/groups/:id/items/:itemId` | groups.js:587 | session-only | RESETS, BULK, WRITE-OTHER, EDIT | Edit item; a higher cost ceiling clears everyone's yes and messages them | webhook per person | DENY |
| `POST /api/groups/:id/items/:itemId/close` | groups.js:749 | session-only | RESETS, BULK, WRITE-OTHER | close bills everyone on the item; cancel; `reopen` clears settlement; `extend` is a plain edit | webhook per person | DENY (`action=extend` alone is an edit) |
| `DELETE /api/session` | session.js:110 | public (acts only with a live token) | RESETS | Signs out this device; `all=1` revokes sessions | See note 1 | DENY (`all=1`); signing out one device is safe |

## 5. Bulk-applies (one press changes many rows)

75 endpoints whose most serious class is this one. Back-office routes come first, then household-app routes.

| Endpoint | Where | Guard | Classes | What it does | Cost / scale | Agent |
|---|---|---|---|---|---|---|
| `POST /api/admin/census/ground` | censusFindings.js:87 | manage_library | BULK | OSM Overpass and FHRS ground counts over up to 50 tiles | free; 20s time limit | DENY |
| `POST /api/admin/desk/categories/defaults` | desk.js:226 | manage_library | BULK | Sets one fact default across many drawers | No limit on drawers; logged and undoable per drawer | READ-VARIANT (GET /categories/impact gives the preview) |
| `POST /api/admin/desk/mapping/:word/bring-back` | desk.js:170 | manage_library | BULK | Brings the word back as undecided | All places carrying the word; undoable | DENY |
| `PUT /api/admin/desk/mapping/:word/facts` | desk.js:154 | manage_library | BULK | Ticks or unticks a fact the word carries | All places carrying the word; undoable | DENY |
| `PUT /api/admin/desk/mapping/:word/targets` | desk.js:146 | manage_library | BULK | Repoints a word's drawers and rewrites its labels rule | All places carrying the word; logged and undoable | DENY |
| `POST /api/admin/desk/mapping/decisions/:id/undo` | desk.js:181 | manage_library | BULK | Reverses a word decision, re-filing its places | Newest decision only | DENY |
| `POST /api/admin/desk/mapping/proposals/:id` | desk.js:174 | manage_library | BULK | Carries out a proposal (may create a drawer or fact), or keeps it | One proposal; undoable | READ-VARIANT (`action:'keep'` only records a decline) |
| `POST /api/admin/desk/undo/:id` | desk.js:69 | manage_library | BULK | Undoes one logged change; undoing a word decision re-files all its places | Only the newest change to a thing can be undone | DENY |
| `POST /api/admin/filing/categories/:key/apply` | filing.js:2235 | manage_library | BULK | Sets yes/no defaults or "Also in" listings on many drawers at once | No limit on drawers × up to 20 picks; overwrites existing defaults; no undo | DENY |
| `POST /api/admin/filing/checks/run` | filing.js:110 | manage_library | BULK, JOB | Runs the bar checks; `repair` defaults to true: gives bars, rescores drawers, refreshes stats | Rescores every place in each unjudged drawer (synchronous) | READ-VARIANT (`repair:false`; still writes the run record) |
| `PUT /api/admin/filing/mapping/:word/carries` | filing.js:1108 | manage_library | BULK | Sets a fact carried by every place the word brings | Every place carrying the word; no undo | DENY |
| `POST /api/admin/filing/subcategories/:key/accept` | filing.js:625 | manage_library | BULK | Accepts every proposed default on a drawer at once | All proposed facts × all places in the drawer; no undo | DENY |
| `PUT /api/admin/filing/subcategories/:key/defaults` | filing.js:562 | manage_library | BULK | Accepts, flips or sets one drawer default; every place in the drawer inherits it | Logged, but no undo record in Changes | DENY |
| `POST /api/admin/library/attractions/:id/category` | library.js:860 | manage_library | BULK, EDIT | recategorise; scope=kind or category reclassifies the whole atlas | 1 row to atlas-wide | DENY (scope=place alone is a pinned single edit) |
| `POST /api/admin/library/attractions/:id/review` | library.js:1001 | manage_library | BULK, EDIT | verdict on one reading; optional `lesson` changes prompts for a whole type | type-wide if lesson | DENY (ALLOW without `lesson`) |
| `POST /api/admin/library/harvest` | library.js:519 | manage_library | BULK, JOB | atlas harvest (Wikimedia), background, scope=all | about 2h for the UK, free quota; one at a time | DENY |
| `PATCH /api/admin/library/kinds/:qid` | library.js:385 | manage_library | BULK, EDIT | changes a Wikidata type's admit/category; not audited | type-wide on next refresh | DENY |
| `POST /api/admin/library/kinds/refresh` | library.js:748 | manage_library | BULK | re-asks Wikidata, reclassifies every attraction, hides denied ones, retires them from the index | estate-wide | DENY |
| `PATCH /api/admin/library/lessons/:id` | library.js:1048 | manage_library | BULK, EDIT | edits or deactivates a lesson; not audited | type-wide prompt | DENY |
| `POST /api/admin/library/pictures` | library.js:599 | manage_library | BULK, JOB | picture-ladder sweep; force re-checks places already settled | ≤500, free quota | DENY |
| `POST /api/admin/library/portraits` | library.js:683 | manage_library | BULK, JOB | portrait sweep; replace=true overwrites | free Wikimedia | DENY |
| `POST /api/admin/library/regions/:slug/detail` | library.js:1060 | manage_library | BULK | fetches free sources for a whole region | ≤200 | DENY |
| `POST /api/admin/library/regions/:slug/rank` | library.js:363 | manage_library | BULK | re-ranks and republishes a region | region | DENY |
| `POST /api/admin/library/sweep/rematch` | library.js:665 | manage_library | BULK, JOB | re-matches regions against OSM | free; no limit on regions | DENY |
| `POST /api/admin/library/visiting/gather` | library.js:302 | manage_library | BULK | asks OSM and Wikipedia for visiting evidence | ≤2000, free quota | DENY |
| `POST /api/admin/library/visiting/rejudge` | library.js:348 | manage_library | BULK | re-runs the visiting rule | up to 200k rows, whole atlas | DENY |
| `PUT /api/admin/place-index/bars/:sub` | placeIndex.js:3144 | manage_library | BULK | Changes a subcategory's ready-bar and rescores every place in it; audited | free; every place in the subcategory | DENY (READ-VARIANT: POST /bars/:sub/effect) |
| `POST /api/admin/place-index/census/rollup` | placeIndex.js:3746 | manage_library | BULK | Rebuilds outcode summaries from census tiles | free, derived | DENY |
| `POST /api/admin/place-index/curate` | placeIndex.js:2135 | manage_library | BULK | Free research (`enrich` paid:false: OSM, encyclopedias, site) on up to 50 places; rescores | free; up to 50 x several third-party fetches; no audit | DENY |
| `POST /api/admin/place-index/pictures/find` | placeIndex.js:2440 | manage_library + spendLimit | BULK, WRITE-OTHER | Logo, Commons, KartaView/Mapillary search for up to 25 places; saves images to the library | free, but 25 x 3 outside services | DENY |
| `POST /api/admin/place-index/postcodes/refresh` | placeIndex.js:3391 | manage_library | BULK, JOB | Forces the ONS postcode directory download and reload of the `postcodes` table | free, whole-UK table | DENY |
| `POST /api/admin/place-index/refresh` | placeIndex.js:3177 | manage_library | BULK | Places new rows (`settleNew`, up to 5000), then recounts `area_stats` | free | DENY |
| `POST /api/admin/place-index/rescore` | placeIndex.js:3188 | manage_library | BULK | Rescores every place, or one subcategory | free, whole estate | DENY |
| `POST /api/admin/places/pass` | localities.js:133 | manage_library | BULK, JOB | Background postal pass (postcodes.io) or naming pass (Nominatim, 1/s) | up to 2000 places; one pass at a time | DENY |
| `POST /api/admin/places/recount` | localities.js:174 | manage_library | BULK | Recounts locality counts | free, no network, derived | DENY |
| `POST /api/admin/questions/candidates/:id/alias` | questions.js:305 | manage_questions | BULK, EDIT | aliases the word to a global question | estate-wide | DENY |
| `POST /api/admin/questions/candidates/:id/file` | questions.js:286 | manage_questions | BULK, EDIT | word files places into another drawer | estate-wide effect | DENY |
| `POST /api/admin/questions/candidates/:id/global` | questions.js:314 | manage_questions | BULK, EDIT | new global question asked of every place | estate-wide | DENY |
| `POST /api/admin/questions/candidates/:id/promote` | questions.js:270 | manage_questions | BULK, EDIT | word becomes a question/gate for every place of that kind | estate-wide effect | DENY |
| `POST /api/admin/questions/harvest/free` | questions.js:425 | manage_questions | BULK, JOB | free vocabulary sweep that writes candidates; live=true queries OSM in bulk | quota if live | DENY |
| `POST /api/admin/questions/questions` | questions.js:156 | manage_questions | BULK, EDIT | adds a question; with scope=global every place is asked it | estate-wide if global | DENY |
| `POST /api/admin/queue/approve` | queue.js:123 | manage_library | BULK, WRITE-OTHER | Publishes household content (photo batches allowed), gives reward points; audited | free; can publish many photos in one press | DENY |
| `POST /api/admin/reach/refresh` | reach.js:134 | manage_library | BULK, JOB | Stamps new places, then works out and replaces reach rows for new cells | free, stamps up to 2000 | DENY |
| `POST /api/admin/reach/rings/refresh` | reach.js:149 | manage_library | BULK, JOB | Recounts every ring | free | DENY |
| `POST /api/admin/reach/stamp` | reach.js:116 | manage_library | BULK, JOB | Gives places a postcode through postcodes.io, in background | up to 50,000 places | DENY |
| `PATCH /api/admin/roles/:id` | admin.js:422 | manage_roles | BULK, WRITE-OTHER | changes a role's capabilities (applies to every holder) | all holders | DENY |
| `POST /api/admin/scout/areas/:code/rescore` | scout.js:106 | manage_library | BULK | re-ranks an area from data we already own | free | DENY |
| `POST /api/admin/scout/counties/:name` | scout.js:286 | manage_library | BULK, JOB | queues every outcode in a county; optional menuShare | about 100 paid sweeps deferred | DENY |
| `POST /api/admin/scout/kinds` | scout.js:119 | manage_library | BULK | identifies place kinds from OSM and writes owned records | ≤50, free | DENY |
| `POST /api/admin/scout/menus/classify` | scout.js:235 | manage_library | BULK | re-codes the cause on every menu miss | all rows, free | DENY |
| `POST /api/admin/scout/menus/fill` | scout.js:127 | manage_library | BULK | crawls venue sites for menu URLs | ≤20, free | DENY |
| `PUT /api/admin/shelves/categories` | shelves.js:551 | manage_library | BULK | Creates or edits a category; `active:false` hides all its drawers | Estate-wide; no log | DENY |
| `POST /api/admin/shelves/kinds/name` | shelves.js:532 | manage_library | BULK | Names Wikidata types in bulk | Up to 2,000 per request; free but uses Wikidata quota | DENY |
| `PUT /api/admin/shelves/rules` | shelves.js:357 | manage_library | BULK | Teaches a shelf rule (kind scope covers every place of that type) | Estate-wide; recorded in admin_audit | DENY |
| `PUT /api/admin/shelves/subcategories` | shelves.js:570 | manage_library | BULK | Edits a drawer; moving category moves every place, `active` retires it | Estate-wide; no log | DENY |
| `PUT /api/admin/skills/identifiers` | hostSkills.js:854 | manage_skills | BULK | Accept/refuse/reopen identifier proposals for a keys[] list | n keys | DENY |
| `POST /api/admin/skills/queue/:id` | hostSkills.js:593 | manage_skills | BULK, EDIT | Approve/merge repoints every offer carrying the word, may pause live offers; reject is single | all carrying offers | DENY (reject alone is single-row) |
| `PUT /api/admin/skills/tag` | hostSkills.js:475 | manage_skills | BULK, EDIT | Upsert tag; category move re-files every offer and auto-pauses non-qualifying live offers | all offers with tag | DENY |
| `POST /api/admin/suite/subscriptions/publish` | suite.js:324 | manage_plans | BULK, WRITE-OTHER | publishes all outstanding benefits | all drafts | DENY |
| `POST /api/admin/taxonomy/adopt` | taxonomy.js:1658 | manage_library | BULK | Makes a Google word a new drawer and maps it (rewrites its "Also in" listings) | All places carrying the word; recorded in admin_audit | DENY |
| `PUT /api/admin/taxonomy/attributes` | taxonomy.js:947 | manage_library | BULK | Creates or edits a fact; `active:false` switches it off everywhere | Global; recorded in admin_audit | DENY |
| `PUT /api/admin/taxonomy/attributes/brings` | taxonomy.js:967 | manage_library | BULK | Sets what one of our labels brings with it | Every place with the label; no log | DENY |
| `PUT /api/admin/taxonomy/attributes/default` | taxonomy.js:998 | manage_library | BULK | Sets or clears one drawer default | All places in the drawer; no undo | DENY |
| `PUT /api/admin/taxonomy/audit/group` | taxonomy.js:640 | manage_library | BULK | Accepts or rejects a whole flag group | Many proposals and refusals | DENY |
| `PUT /api/admin/taxonomy/drawer` | taxonomy.js:674 | manage_library | BULK | Sets labels on many places in one transaction | Up to 2,000 places; not logged to Changes; no undo | DENY |
| `PUT /api/admin/taxonomy/labels` | taxonomy.js:1766 | manage_library | BULK | Renames a label, or `active:false` takes the word out of Epic | Exclusion affects all its places | DENY |
| `PUT /api/admin/taxonomy/labels/carries` | taxonomy.js:984 | manage_library | BULK | Sets a fact carried by a provider word | Every place with the word; no undo | DENY |
| `PUT /api/admin/taxonomy/rules` | taxonomy.js:1345 | manage_library | BULK | Teaches a labels, kind or word rule to a drawer; repoints the word | Every place matching; recorded in admin_audit; no undo | DENY |
| `POST /api/chat/:type/:id/topics` | chat.js:792 | session-only | BULK, WRITE-OTHER | New topic; notifies participants; host `notice` reaches everyone | email/SMS per person | DENY |
| `POST /api/groups/:id/reminders` | groups.js:866 | session-only | BULK, WRITE-OTHER | Send reminders now to all/selected participants | webhook per person | DENY |
| `POST /api/host/offers/:id/broadcast` | hosting.js:834 | session-only | BULK, WRITE-OTHER | Free-text message to everyone booked | email/SMS per household | DENY |
| `POST /api/host/offers/:id/cancel` | hosting.js:823 | session-only | BULK, WRITE-OTHER | Cancel offer, refund-mark every booking, message every booker | email/SMS per household | DENY |
| `POST /api/host/offers/:id/invites` | hosting.js:954 | session-only | BULK, WRITE-OTHER, EDIT | Add up to 200 invitees; on live/paused offer sends them immediately | email/SMS per invitee | READ-VARIANT (`send:false`) |
| `POST /api/host/offers/:id/invites/send` | hosting.js:982 | session-only | BULK, WRITE-OTHER | Send all unsent invites | email/SMS per invitee | DENY |
| `POST /api/stays/transit/harvest` | stays.js:200 | requireOwner | BULK, JOB | Harvests stations for a region (UK by default) in the background | ~30+ Overpass cells, minutes; writes the table every stay search reads; `refresh:true` redoes it; no stop control | DENY |

## 6. Starts, resumes or stops a job

8 endpoints whose most serious class is this one. Back-office routes come first, then household-app routes.

| Endpoint | Where | Guard | Classes | What it does | Cost / scale | Agent |
|---|---|---|---|---|---|---|
| `POST /api/admin/library/harvest/:id/cancel` | library.js:732 | manage_library | JOB | stops a harvest | none | DENY |
| `POST /api/admin/place-index/census/run/:id/stop` | placeIndex.js:3582 | manage_library | JOB | Asks a running census to stop; audited | free | DENY |
| `POST /api/admin/scout/areas` | scout.js:49 | manage_library | JOB, EDIT | adds a postcode area to the queue (the loop sweeps it later, which is paid); geocodes it (free) | deferred spend | DENY |
| `PATCH /api/household` | household.js:235 | session-only | JOB, EDIT | Edits household; changing home or travel mode starts ring refresh, pre-warm and census run in background | Census uses the free IDs-only mask; Nominatim geocode; runner takes one run at a time | DENY (or ALLOW if `home`/`homeText`/`travelMode` are stripped) |
| `GET /api/menu/openers` | menus.js:160 | session-only | JOB | `?probe=<url>` drives headless Chrome to any URL | compute; could be used to make the server fetch internal addresses | READ-VARIANT (safe without `probe`) |
| `POST /api/trips` | trips.js:410 | session-only | JOB, EDIT | Creates a trip; copies the household's atlas into the shortlist; queues research on the base | Free geocoders; free research only (reason 'stay', so no menu) | ALLOW |
| `POST /api/trips/:id/shortlist` | trips.js:1869 | session-only | JOB, EDIT | Shortlists a place, adds it to the atlas, queues research and a menu read | Research is free; the menu read runs later by Claude (see notes) | DENY (conservative, because of the queued Claude read) |
| `POST /api/trips/:id/stay` | trips.js:1740 | session-only | JOB, EDIT | Sets where they're staying; matches it to the open map; queues research — no household check in loadTrip: reaches any household's trip by id | One Overpass call; research is free-only | DENY |

## 7. Messages real people, changes accounts, trust or what is published

46 endpoints whose most serious class is this one. Back-office routes come first, then household-app routes.

| Endpoint | Where | Guard | Classes | What it does | Cost / scale | Agent |
|---|---|---|---|---|---|---|
| `POST /api/accounts/:id/invite` | accounts.js:416 | manage_accounts | WRITE-OTHER | mints a sign-in link and emails it via Postmark | 1 email | DENY |
| `POST /api/accounts/owner` | accounts.js:316 | door only (no capability) | WRITE-OTHER | binds an email as the owner account on the founding household | refused only if an owner already exists | DENY |
| `PUT /api/admin/filing/rows/:id` | filing.js:1233 | manage_library | WRITE-OTHER | Edits a live collection's title, copy or rule | Visible to households at once; the rule change is logged as "— → changed" | DENY |
| `PATCH /api/admin/hosting/hosts/:id` | hosting.js:1585 | manage_hosting | WRITE-OTHER | Set host trust level / checks | - | DENY |
| `POST /api/admin/hosting/offers/:id/decide` | hosting.js:1552 | manage_hosting | WRITE-OTHER | Pass pitch to live, or send back for changes | - | DENY |
| `PATCH /api/admin/library/images/:id` | library.js:442 | manage_library | WRITE-OTHER | moderates an image (publishes it); awards or reverses contributor points | 1 image, 1 account | DENY |
| `POST /api/admin/open/checks/:id/decide` | openTo.js:731 | manage_hosting | WRITE-OTHER | Pass/fail a person's ID; can open chat between strangers | - | DENY |
| `PATCH /api/admin/people/:id/role` | admin.js:239 | manage_roles | WRITE-OTHER | grants or removes a back-office role; audited | account | DENY |
| `POST /api/admin/queue/:id/reject` | queue.js:176 | manage_library | WRITE-OTHER | Rejects one item, takes back points; `tell:true` e-mails the household | Postmark mail | DENY |
| `POST /api/admin/roles` | admin.js:406 | manage_roles | WRITE-OTHER | creates a role with doors and capabilities | none | DENY |
| `POST /api/admin/skills/credentials/:id` | hostSkills.js:936 | manage_skills | WRITE-OTHER | Confirm/reject a host credential (trust evidence) | - | DENY |
| `PUT /api/admin/suite/subscriptions/price` | suite.js:274 | manage_plans | WRITE-OTHER | new plan price row | pricing | DENY |
| `POST /api/admin/suite/supplier/:key/credential` | suite.js:411 | manage_settings | WRITE-OTHER | records a masked credential-rotation hint | none | DENY |
| `POST /api/bookings/:id/cancel` | hosting.js:1490 | session-only | WRITE-OTHER | Cancel own booking, mark refunded | - | DENY |
| `POST /api/bookings/:id/review` | hosting.js:1508 | session-only | WRITE-OTHER | Post a review (published later), mark attended | - | DENY |
| `POST /api/chat/:type/:id/topics/:topicId/answer` | chat.js:824 | session-only | WRITE-OTHER | Mark answer, optionally publish to public FAQ, notify | email/SMS | DENY |
| `POST /api/chat/:type/:id/topics/:topicId/react` | chat.js:839 | session-only | WRITE-OTHER | Toggle reaction; notifies author | email/SMS | DENY |
| `POST /api/chat/:type/:id/topics/:topicId/replies` | chat.js:816 | session-only | WRITE-OTHER | Reply; notifies followers | email/SMS | DENY |
| `POST /api/chat/:type/:id/topics/:topicId/requests/:requestId/decide` | chat.js:847 | session-only | WRITE-OTHER | Consent to publish answer to FAQ/group; tells host | email/SMS | DENY |
| `POST /api/experiences/:id/book` | hosting.js:1331 | session-only | WRITE-OTHER | Book a place (recorded, no charge); may auto-pause offer, confirm held bookings | no payment provider | DENY |
| `POST /api/families/answer` | families.js:31 | session-only | WRITE-OTHER | Family's answer can settle or hide a shared place fact across the estate | — | DENY |
| `PATCH /api/groups/:id/participants/:pid` | groups.js:689 | session-only | WRITE-OTHER, EDIT | Edit/withdraw person; triggers tellWaitlist email/SMS | email/SMS per waitlister | DENY |
| `POST /api/host/offers/:id/dates` | hosting.js:1135 | session-only | WRITE-OTHER | Clone a one-off onto a new date; the copy goes straight live | - | DENY |
| `POST /api/host/offers/:id/resume` | hosting.js:803 | session-only | WRITE-OTHER | Put a paused offer back live, re-checks blockers | - | DENY |
| `POST /api/host/offers/:id/submit` | hosting.js:769 | session-only | WRITE-OTHER | Publish or send to review; live offer sends all unsent invites | Postmark/Twilio per invite | DENY |
| `POST /api/join/:token/account` | groups.js:1143 | public (token) | WRITE-OTHER | Create guest account, send 6-digit code, may open session | email/SMS/webhook | DENY |
| `POST /api/join/:token/book` | groups.js:1409 | public (token+ptoken) | WRITE-OTHER | Record itinerary booking and money lines (no charge) | - | DENY |
| `POST /api/join/:token/chat` | joinChat.js:57 | public (token+ptoken) | WRITE-OTHER | Topic/reply as participant; notifies | email/SMS | DENY |
| `POST /api/join/:token/chat/:topicId/react` | joinChat.js:77 | public | WRITE-OTHER | React; notifies author | email/SMS | DENY |
| `POST /api/join/:token/code` | groups.js:1270 | public (token) | WRITE-OTHER | Verify code, open session on the account | - | DENY |
| `POST /api/join/:token/code/again` | groups.js:1298 | public (token) | WRITE-OTHER | Re-send sign-in code | email/SMS per call | DENY |
| `POST /api/open` | openTo.js:178 | session-only | WRITE-OTHER, EDIT | Save "open to" entry; creates/ends introductions with other households | Nominatim reverse-geocode (free) | DENY |
| `PATCH /api/open/:id/who` | openTo.js:231 | session-only | WRITE-OTHER, EDIT | Change preferences; ends/creates introductions | - | DENY |
| `POST /api/open/matches/:id/guest` | openTo.js:486 | session-only | WRITE-OTHER | Guest answers an introduction | - | DENY |
| `POST /api/open/matches/:id/host` | openTo.js:463 | session-only | WRITE-OTHER | Host answers an introduction to a stranger | - | DENY |
| `POST /api/open/matches/:id/verify` | openTo.js:663 | session-only | WRITE-OTHER | Submit ID check to back office | - | DENY |
| `POST /api/session` | session.js:81 | public (sign-in limit 10/15 min) | WRITE-OTHER | Passcode opens a 90-day owner session | — | DENY |
| `POST /api/session/link` | session.js:141 | public | WRITE-OTHER | Uses up a magic link and opens a session | — | DENY |
| `POST /api/shared/:token/chat` | shared.js:249 | public | WRITE-OTHER | Guest posts a topic or reply; notifies members and followers | Messages real people; `guardRate` limits it | DENY |
| `POST /api/shared/:token/chat/:topicId/react` | shared.js:275 | public | WRITE-OTHER | Reaction; notifies | — | DENY |
| `POST /api/shared/:token/chat/:topicId/report` | shared.js:291 | public | WRITE-OTHER | Reports a topic | — | ALLOW |
| `POST /api/shared/:token/verify` | shared.js:193 | public | WRITE-OTHER | Checks the code; marks the guest joined; returns their permanent token | — | DENY |
| `POST /api/trips/:id/chat` | tripChat.js:84 | session-only | WRITE-OTHER | Topic/reply on trip chat; notifies | email/SMS | DENY |
| `POST /api/trips/:id/share/guests` | tripChat.js:200 | session-only | WRITE-OTHER | Add guest and email/SMS them the trip link | 1 email/SMS | DENY |
| `POST /api/trips/:id/share/guests/:guestId/resend` | tripChat.js:220 | session-only | WRITE-OTHER | Re-send guest invite | 1 email/SMS | DENY |
| `POST /api/voice/live-used` | voice.js:238 | session-only | WRITE-OTHER | writes client-reported minutes to the ledger | ≤3600s per call; can use up the household's minutes | DENY |

## 8. Single-item edits

137 endpoints whose most serious class is this one. Back-office routes come first, then household-app routes.

| Endpoint | Where | Guard | Classes | What it does | Cost / scale | Agent |
|---|---|---|---|---|---|---|
| `PATCH /api/admin/data/sources/bench/:id` | admin.js:652 | manage_settings | EDIT | records a decision on one bench row — a data verdict is the owner's | none | DENY |
| `POST /api/admin/desk/collections` | desk.js:342 | manage_library | EDIT | Creates a collection, live as soon as it is saved — live to households the moment it is saved | Undoable | DENY |
| `PUT /api/admin/desk/collections/:key` | desk.js:348 | manage_library | EDIT | Edits a collection, live as soon as it is saved — live to households the moment it is saved | Undoable | DENY |
| `POST /api/admin/desk/facts/excluded/:sub/:fact` | desk.js:265 | manage_library | EDIT | Puts back an excluded fact — H2: drawer-level decision | Undoable | DENY |
| `PUT /api/admin/desk/places/:ref/facts/:fact` | desk.js:284 | manage_library | EDIT | Corrects one place's fact | Undoable | ALLOW |
| `POST /api/admin/desk/subcategories` | desk.js:190 | manage_library | EDIT | Creates a drawer and its rule (`wouldBrowse:true` required) — H2 | Additive; logged, not undoable | DENY |
| `POST /api/admin/desk/subcategories/:key/defaults/:fact/accept` | desk.js:238 | manage_library | EDIT | Accepts one machine default — H2: accepting is the decision | Undoable | DENY |
| `POST /api/admin/desk/subcategories/:key/facts/:fact/remove` | desk.js:242 | manage_library | EDIT | Stops looking for a fact in a drawer — H2: drawer-level decision | Undoable | DENY |
| `POST /api/admin/desk/subcategories/:key/related` | desk.js:246 | manage_library | EDIT | Links or unlinks two drawers — H2: drawer-level decision | Undoable | DENY |
| `POST /api/admin/filing/categories` | filing.js:2178 | manage_library | EDIT | Creates an empty category — H2: new taxonomy is proposed, not made | Additive | DENY |
| `PUT /api/admin/filing/places/:ref` | filing.js:1714 | manage_library | EDIT | Sets one fact on one place — no before-value kept, so not undoable | Previous value not kept | DENY |
| `POST /api/admin/filing/rows/:id/heart` | filing.js:1273 | manage_library | EDIT | Hearts a collection as a member of the caller's household | One row; can be toggled off | ALLOW |
| `POST /api/admin/filing/subcategories` | filing.js:2202 | manage_library | EDIT | Creates an empty drawer and gives it an inherited bar — H2 | Additive | DENY |
| `POST /api/admin/filing/subcategories/:key/not-sure` | filing.js:1877 | manage_library | EDIT | Sends up to 50 places to the Not sure queue | ≤50 queue rows; no filing change | ALLOW |
| `PUT /api/admin/filing/thresholds` | filing.js:283 | manage_library | EDIT | Sets spotMentions / shareMax / collectionMinPlaces through the settings table — estate-wide setting (H1) | Global; logged in Changes, undoable | DENY |
| `POST /api/admin/hosting/reports/:id/resolve` | hosting.js:1597 | manage_hosting | EDIT | Mark a report resolved — a moderation decision | - | DENY |
| `PATCH /api/admin/library/attractions/:id` | library.js:229 | manage_library | EDIT | publish/hide/pin/visiting on one attraction; audited — publishes or hides to households | none | DENY |
| `POST /api/admin/library/attractions/:id/detail` | library.js:943 | manage_library | EDIT | fetches free sources for one attraction | free | ALLOW |
| `POST /api/admin/library/images/:id/links` | library.js:473 | manage_library | EDIT | links an image to a subject | none | ALLOW |
| `PUT /api/admin/library/portraits/:type/:id` | library.js:702 | manage_library | EDIT | hand-picks one portrait | free | ALLOW |
| `POST /api/admin/place-index/not-in-epic` | placeIndex.js:3360 | manage_library | EDIT | Takes one place off every shelf, with a reason; can be restored — H2: takes a place out of what households see | free; no `writeAudit`, reason is stored | DENY |
| `POST /api/admin/place-index/not-in-epic/restore` | placeIndex.js:3372 | manage_library | EDIT | Puts one set-aside place back on its old shelf — H2 | free | DENY |
| `PATCH /api/admin/place-index/place` | placeIndex.js:1533 | manage_library | EDIT | Edits one field of one place, then rescores it; audited with before/after | free | ALLOW |
| `POST /api/admin/questions/candidates/:id/kind` | questions.js:260 | manage_questions | EDIT | hand-sets one word's kind — H2: a verdict on a word | none | DENY |
| `POST /api/admin/questions/candidates/:id/restore` | questions.js:328 | manage_questions | EDIT | un-ignores a word — un-ignoring is a promotion door (C21, PROMOTABLE_SQL) | none | DENY |
| `PATCH /api/admin/questions/questions/:id` | questions.js:164 | manage_questions | EDIT | gate, reorder, change refresh days — H2: gating changes what every place is asked | none | DENY |
| `PUT /api/admin/questions/sets` | questions.js:136 | manage_questions | EDIT | name a set or switch one off — can switch a whole set off | none | DENY |
| `PUT /api/admin/questions/sets/:key/subcategories` | questions.js:140 | manage_questions | EDIT | attach subcategory; also un-settles the set (reopens paid Google pass for it) — un-settles the set, which reopens a paid pass for it | none now | DENY |
| `POST /api/admin/queue/:id/report` | queue.js:217 | manage_library | EDIT | Moves one item into the reported lane | free | ALLOW |
| `POST /api/admin/score` | scoring.js:106 | manage_library | EDIT | Recomputes and stores one place's scores | free, derived | ALLOW |
| `PUT /api/admin/shelves/place` | shelves.js:396 | manage_library | EDIT | Moves one place to a drawer (place rule) and records the override — a filing decision; admin_audit only, no undo | One place; admin_audit only, no undo | DENY |
| `PUT /api/admin/skills/category` | hostSkills.js:437 | manage_skills | EDIT | Upsert a browse category (incl. active flag), site-wide — site-wide host vocabulary (H2) | - | DENY |
| `PUT /api/admin/skills/facet` | hostSkills.js:510 | manage_skills | EDIT | Upsert facet + alias — site-wide host vocabulary (H2) | - | DENY |
| `PUT /api/admin/skills/format` | hostSkills.js:445 | manage_skills | EDIT | Upsert a format, site-wide — site-wide host vocabulary (H2) | - | DENY |
| `PUT /api/admin/skills/source` | hostSkills.js:972 | manage_skills | EDIT | Upsert source-register row | - | ALLOW |
| `POST /api/admin/suite/subscriptions/benefits` | suite.js:292 | manage_plans | EDIT | adds a draft plan benefit | none | DENY |
| `PATCH /api/admin/suite/subscriptions/benefits/:id` | suite.js:302 | manage_plans | EDIT | edits a benefit | none | DENY |
| `PATCH /api/admin/suite/supplier/:key` | suite.js:456 | manage_settings | EDIT | edits the register description | none | ALLOW |
| `POST /api/admin/suite/supplier/:key/confirm` | suite.js:391 | manage_settings | EDIT | stamps the rate as confirmed — a human attestation | none | DENY |
| `PUT /api/admin/suite/supplier/:key/rate` | suite.js:375 | manage_settings | EDIT | new supplier rate row (insert-only); audited — feeds cost and margin reporting | none | DENY |
| `GET /api/admin/taxonomy/` | taxonomy.js:202 | view_library | EDIT | Upserts the known label list every call; asks Wikidata for missing names in the background | See note 6 | ALLOW |
| `PUT /api/admin/taxonomy/attributes/place` | taxonomy.js:1044 | manage_library | EDIT | Sets one fact on one place — no before-value kept | Previous value not kept | DENY |
| `PUT /api/admin/taxonomy/audit/proposal` | taxonomy.js:629 | manage_library | EDIT | Accepts or rejects one proposal; rejections are remembered — H2: accepting a proposal is the decision; apply is the press | One row | DENY |
| `POST /api/admin/taxonomy/audit/run` | taxonomy.js:621 | manage_library | EDIT | Runs the taxonomy audit and stores its proposals | Free; production unchanged | ALLOW |
| `GET /api/admin/taxonomy/labels` | taxonomy.js:226 | view_library | EDIT | Same upserts as GET / | See note 6 | ALLOW |
| `GET /api/admin/taxonomy/matrix` | taxonomy.js:1294 | view_library | EDIT | Same upserts as GET / | See note 6 | ALLOW |
| `PUT /api/admin/taxonomy/not-sure` | taxonomy.js:851 | manage_library | EDIT | Settles one place: writes a place rule or drops it — writes a place rule; not logged to Changes | One place; not logged to Changes | DENY |
| `POST /api/admin/taxonomy/not-sure/queue` | taxonomy.js:752 | manage_library | EDIT | Queues places onto Not sure | Up to 200 rows | ALLOW |
| `GET /api/admin/taxonomy/pairs` | taxonomy.js:1256 | view_library | EDIT | Same upserts as GET / | See note 6 | ALLOW |
| `POST /api/admin/taxonomy/parts` | taxonomy.js:908 | manage_library | EDIT | Records that one place is inside another (null parent forgets it) | Recorded in admin_audit | ALLOW |
| `POST /api/admin/taxonomy/try` | taxonomy.js:1746 | view_library | EDIT | Dry-run of where labels would land, plus the same upserts | Free | ALLOW |
| `POST /api/activity` | activity.js:29 | session-only | EDIT | Screen/heartbeat telemetry | — | ALLOW |
| `POST /api/atlas/cities` | atlas.js:445 | session-only | EDIT | Creates a city (Photon lookup) | free | ALLOW |
| `PATCH /api/atlas/places` | atlas.js:414 | session-only | EDIT | Names an unnamed place | — | ALLOW |
| `GET /api/atlas/sketch` | atlas.js:486 | session-only | EDIT | Stores a sketch in the cache; fills neighbouring areas via Nominatim in the background | free quota | ALLOW |
| `PUT /api/chat/:type/:id/prefs` | chat.js:870 | session-only | EDIT | Notification prefs | - | ALLOW |
| `POST /api/chat/:type/:id/read` | chat.js:784 | session-only | EDIT | Mark read | - | ALLOW |
| `PATCH /api/chat/:type/:id/topics/:topicId` | chat.js:804 | session-only | EDIT | Edit own question / pin | - | ALLOW |
| `DELETE /api/chat/:type/:id/topics/:topicId/follow` | chat.js:835 | session-only | EDIT | Unfollow | - | ALLOW |
| `POST /api/chat/:type/:id/topics/:topicId/follow` | chat.js:832 | session-only | EDIT | Follow | - | ALLOW |
| `POST /api/chat/:type/:id/topics/:topicId/report` | chat.js:855 | session-only | EDIT | Report a message | - | ALLOW |
| `PUT /api/chat/settings` | chat.js:956 | session-only | EDIT | Digest/quiet hours | - | ALLOW |
| `POST /api/discover/drawn` | discover.js:187 | session-only | EDIT | Logs which results the screen drew | ≤500 refs | ALLOW |
| `POST /api/discover/event` | discover.js:159 | session-only | EDIT | Logs a click on a result | — | ALLOW |
| `POST /api/discover/select` | discover.js:202 | session-only | EDIT | Records a selection and a ledger status | — | ALLOW |
| `POST /api/groups/:id/items` | groups.js:556 | session-only | EDIT | Add checklist item/cost — group not scoped to a household | - | DENY |
| `POST /api/groups/:id/participants` | groups.js:672 | session-only | EDIT | Add person with a contact; the reminder loop will then chase them | - | DENY |
| `POST /api/groups/:id/participants/:pid/items/:itemId` | groups.js:723 | session-only | EDIT | Organiser marks paid/booked for someone — group not scoped to a household | - | DENY |
| `PATCH /api/host` | hosting.js:309 | session-only | EDIT | Edit own host profile; trust/checks stripped; payout 'connected' refused | - | ALLOW |
| `POST /api/host` | hosting.js:289 | session-only | EDIT | Create this household's host profile | - | ALLOW |
| `POST /api/host/contacts` | hosting.js:1027 | session-only | EDIT | Save a contact | - | ALLOW |
| `PUT /api/host/credentials` | hostSkills.js:251 | session-only | EDIT | Claim/re-claim credential (pending/stated only) | - | ALLOW |
| `POST /api/host/evidence` | hosting.js:1098 | session-only | EDIT | Add evidence row | - | ALLOW |
| `PATCH /api/host/evidence/:id` | hosting.js:1113 | session-only | EDIT | Edit evidence | - | ALLOW |
| `POST /api/host/media` | hosting.js:403 | session-only | EDIT | Upload video/photo/PDF into the DB | up to 41 MB | ALLOW |
| `PATCH /api/host/media/:id` | hosting.js:437 | session-only | EDIT | Trim marks on own media | - | ALLOW |
| `POST /api/host/offers` | hosting.js:551 | session-only | EDIT | New draft offer (creates host row if missing) | - | ALLOW |
| `PATCH /api/host/offers/:id` | hosting.js:621 | session-only | EDIT | Edit offer/tags; may auto-pause a live offer | - | ALLOW |
| `POST /api/host/offers/:id/doc` | hosting.js:852 | session-only | EDIT | Attach PDF, seed fields by local pdfjs parse | free | ALLOW |
| `POST /api/host/offers/:id/pause` | hosting.js:794 | session-only | EDIT | Pause a live offer | - | ALLOW |
| `GET /api/host/skills (+ /skills/suggest, /skills/tag/:key, public twins)` | hostSkills.js:129,169,192 | session / public | EDIT | Read; `ensureSkillsReady` writes idempotent self-aliases | - | ALLOW |
| `POST /api/hosts/:id/report` | hosting.js:1225 | public | EDIT | File a report about a host | - | ALLOW |
| `PATCH /api/household/constraints/:id` | household.js:707 | session-only | EDIT | Sets maxMinutes or favourite on one preference | — | ALLOW |
| `POST /api/household/members` | household.js:309 | session-only | EDIT | Adds a household member | — | ALLOW |
| `PATCH /api/household/members/:id` | household.js:334 | session-only | EDIT | Edits a member, including the email/mobile an invite is sent to | — | ALLOW |
| `POST /api/household/members/:id/constraints` | household.js:633 | session-only | EDIT | Adds an allergen/diet/like/dislike; may cap a clashing like | — | ALLOW |
| `POST /api/invited/:token` | hosting.js:1081 | public (token) | EDIT | Guest RSVPs yes/no | - | ALLOW |
| `POST /api/join/:token` | groups.js:1099 | public (token) | EDIT | Join group by link | - | ALLOW |
| `DELETE /api/join/:token/chat/:topicId/follow` | joinChat.js:89 | public | EDIT | Unfollow | - | ALLOW |
| `POST /api/join/:token/chat/:topicId/follow` | joinChat.js:86 | public | EDIT | Follow | - | ALLOW |
| `POST /api/join/:token/chat/:topicId/report` | joinChat.js:93 | public | EDIT | Report | - | ALLOW |
| `POST /api/join/:token/household` | groups.js:1367 | public (token+ptoken) | EDIT | Add members to joiner's own household, set heads | - | ALLOW |
| `POST /api/join/:token/items/:itemId` | groups.js:1470 | public (token+ptoken) | EDIT | Participant sets own status on an item | - | ALLOW |
| `POST /api/join/:token/waitlist` | groups.js:1348 | public (token) | EDIT | Add contact to waitlist | - | ALLOW |
| `POST /api/orders` | menus.js:404 | session-only | EDIT | Creates or replaces an in-progress order | — | ALLOW |
| `POST /api/orders/:id/eaten` | menus.js:480 | session-only | EDIT | Turns the order into a visit | — | ALLOW |
| `POST /api/orders/:id/ratings` | menus.js:523 | session-only | EDIT | Dish star ratings | — | ALLOW |
| `GET /api/places/geocode` | places.js:246 | session-only | EDIT | Nominatim/Photon lookup, logged | free quota | ALLOW |
| `POST /api/places/photo` | placePhotos.js:51 | session-only | EDIT | Stores the household's photo; Nominatim reverse geocode | — | ALLOW |
| `POST /api/places/photo/:id/attach` | placePhotos.js:104 | session-only | EDIT | Attaches the photo to a place and saves the place | — | ALLOW |
| `POST /api/places/photo/:id/place` | placePhotos.js:127 | session-only | EDIT | Makes a household-owned place from a photo | — | ALLOW |
| `POST /api/places/save` | places.js:726 | session-only | EDIT | Saves a place; queues free research and a menu-link lookup | free | ALLOW |
| `GET /api/places/where` | places.js:300 | session-only | EDIT | Reverse geocode, logged | free quota | ALLOW |
| `GET /api/plan/:sessionId` | plan.js:2618 | session-only | EDIT | Poll; marks a stale run as interrupted | — | ALLOW |
| `POST /api/plan/act` | plan.js:2358 | session-only | EDIT | Tap actions: like/dislike/choose/set; can change trip attendees and window — plan sessions are not scoped to a household | — | DENY |
| `POST /api/postmark/events` | postmark.js:34 | public (Basic auth, POSTMARK_WEBHOOK_TOKEN) | EDIT | Postmark delivery/bounce events update mail_messages | - | ALLOW (not agent-facing) |
| `PUT /api/prototypes/:file` | prototypes.js:24 | session-only | EDIT | Owner's verdict on a mock-up; `new` clears the row — the owner's global mock-up verdicts, no requireOwner | global, not per household | DENY |
| `GET /api/shared/:token` | shared.js:118 | public | EDIT | Guest view of the trip; updates the guest's last-seen | — | ALLOW |
| `GET /api/shared/:token/chat (and /chat/:topicId)` | shared.js:238, 267 | public | EDIT | Reads guest chat; updates last-seen | — | ALLOW |
| `POST/DELETE /api/shared/:token/chat/:topicId/follow` | shared.js:284, 287 | public | EDIT | Follow or unfollow a topic | — | ALLOW |
| `GET /api/stays/transit/near` | stays.js:168 | session-only | EDIT | Stations near a point; fetches live and stores them if the area was never harvested | One Overpass call | ALLOW |
| `GET /api/trips` | trips.js:209 | session-only | EDIT | Lists trips; looks up the place for up to 3 unplaced trips and saves it | Nominatim (free), ≤3 calls | ALLOW |
| `PUT /api/trips/:id/attendees` | trips.js:710 | session-only | EDIT | Replaces who is on the trip — no household check in loadTrip: reaches any household's trip by id | — | DENY |
| `POST /api/trips/:id/chat/read` | tripChat.js:103 | session-only | EDIT | Mark read | - | ALLOW |
| `PATCH /api/trips/:id/days/:dayId` | trips.js:725 | session-only | EDIT | Changes a day's settings and start/end points — no household check in loadTrip: reaches any household's trip by id | — | DENY |
| `POST /api/trips/:id/days/:dayId/reorder` | trips.js:1961 | session-only | EDIT | Reorders a day's stops — no household check in loadTrip: reaches any household's trip by id | — | DENY |
| `POST /api/trips/:id/days/:dayId/stops` | trips.js:1902 | session-only | EDIT | Adds a stop to a day; logs the search it came from — no household check in loadTrip: reaches any household's trip by id | No routing call | DENY |
| `GET /api/trips/:id/group` | groups.js:412 | session-only | EDIT | GET that inserts checklist items from the trip (syncFromTrip) — groups and trips are not scoped to a household | - | DENY |
| `POST /api/trips/:id/group` | groups.js:427 | session-only | EDIT | Create group; reminders default ON; `copyFromGroupId` copies past participants — trip not scoped to a household | - | DENY |
| `GET /api/trips/:id/share` | tripChat.js:125 | session-only | EDIT | GET that mints the trip's public share token on first view | - | ALLOW |
| `PUT /api/trips/:id/share/household` | tripChat.js:180 | session-only | EDIT | Replace the trip's attendee list | - | ALLOW |
| `PATCH /api/trips/:id/shortlist/:itemId` | trips.js:1879 | session-only | EDIT | Booking status, time, note, order — no household check in loadTrip: reaches any household's trip by id | — | DENY |
| `POST /api/trips/:id/shortlist/reorder` | journey.js:290 | session-only | EDIT | Shortlist order — no household check in loadTrip: reaches any household's trip by id | — | DENY |
| `PATCH /api/trips/:id/stops/:stopId` | trips.js:1942 | session-only | EDIT | Moves or retimes a stop — no household check in loadTrip: reaches any household's trip by id | — | DENY |
| `POST /api/trips/:id/stops/:stopId/visit` | trips.js:1972 | session-only | EDIT | Records "we went": visit, attendees, ledger, atlas — no household check in loadTrip: reaches any household's trip by id | Deduplicated per stop | DENY |
| `GET /api/trips/:id/travel` | tripTravel.js:225 | session-only | EDIT | Getting-there screen; may look up and store airports | Overpass, free | ALLOW |
| `GET /api/trips/:id/travel/flight` | tripTravel.js:303 | session-only | EDIT | Resolves a flight number; stores airports | Free; no paid schedule feed wired (`EPIC_FLIGHT_SCHEDULE_KEY`) | ALLOW |
| `PUT /api/trips/:id/travel/legs/:direction` | tripTravel.js:238 | session-only | EDIT | Saves a leg; recomputes the transfer estimates | Own arithmetic, free | ALLOW |
| `GET /api/trips/:id/travel/terminals` | tripTravel.js:313 | session-only | EDIT | Terminal typeahead; stores what it finds | Overpass, free | ALLOW |
| `POST /api/trips/:id/travel/transfer` | tripTravel.js:489 | session-only | EDIT | Picks or clears a transfer; adds or removes its stop | — | ALLOW |
| `POST /api/trips/:id/travel/transfers/refresh` | tripTravel.js:474 | session-only | EDIT | Recomputes airport-to-hotel estimates | Free | ALLOW |
| `POST /api/visits` | places.js:875 | session-only | EDIT | Records a visit and ratings; queues free research | — | ALLOW |
| `PATCH /api/visits/:id` | places.js:950 | session-only (no household check) | EDIT | Edits a visit's note/date/label — no household check: edits any household's visit | — | DENY |
| `POST /api/voice/household/apply` | voice.js:800 | session-only | EDIT | writes food and likes constraints for members | ≤120 rows | DENY |
| `POST /api/voice/household/who/apply` | voice.js:732 | session-only | EDIT | creates or updates up to 20 members; not logged | household | DENY |
| `PATCH /api/voice/intake/:id` | voice.js:637 | session-only | EDIT | chip edits and answers on an intake | none | ALLOW |
| `POST /api/voice/intake/:id/remember` | voice.js:664 | session-only | EDIT | writes diets and creates child members; not logged | household profile | DENY |

## 9. Reads and previews listed for completeness

6 endpoints whose most serious class is this one. Back-office routes come first, then household-app routes.

| Endpoint | Where | Guard | Classes | What it does | Cost / scale | Agent |
|---|---|---|---|---|---|---|
| `POST /api/admin/desk/collections/preview` | desk.js:335 | view_library | READ | Previews a rule's matches | Free | ALLOW |
| `POST /api/admin/place-index/bars/:sub/effect` | placeIndex.js:3091 | view_library | READ | Previews what a new ready-bar would change | free | ALLOW (preview of PUT /bars/:sub) |
| `GET /api/admin/skills/candidates` | hostSkills.js:733 | manage_skills | READ | One Wikidata search, logged to providerCalls | free, 1 call | ALLOW |
| `GET /api/admin/skills/parents` | hostSkills.js:872 | manage_skills | READ | One Wikidata subclass lookup | free, 1 call | ALLOW |
| `GET /api/keys` | server.js:433 | requireOwner | READ | Says which provider keys are set (vendor prefix and length only, never the value) | free | ALLOW |
| `POST /api/stays/centre` | stays.js:101 | session-only | READ | Pure arithmetic, no writes | Free | ALLOW |

## 10. Loops inside the API process (`server.js`)

No button starts these. They run in every deploy and are gated only by config or database state. An agent cannot press them, but an agent's DENY-class route can feed them work, as the *Fed by* column shows.

| Loop | Where | Cadence | Spends | Writes / bulk | Gate | Fed by |
|---|---|---|---|---|---|---|
| `advanceCensus` → `censusRun.resumeInterrupted` + `advance` | server.js:829, sources/censusRun.js:707, :1094 | 105 s after boot, then every `EPIC_CENSUS_EVERY_MS` (60 s); straight back while tiles remain | Google IDs-only (free, but uses the project quota); exempt from paidGate; runs as `started_session_id` | Census tiles and slices; several hundred thousand requests a run | `census_runs.state='running'`; a new quota day wakes `waiting` runs; `stop_requested`, `max_requests`, `EPIC_CENSUS_DAILY_CAP`, the Google source switch | `/place-index/census/run`, `/census/run/:id/resume`, `/census/edge/run`, `PATCH /api/household` (home change) |
| `trySweeps` → `researchSweep.resume` | server.js:785, sources/researchSweep.js:654 | 60 s, then every 5 min | **Paid Google** (Place Details ×≤2 a place) on the starter's household and session; passes paidGate while that device session is live | Replaces `place_records` | `research_sweeps.state='running'` and stranded; `collect.ceiling_pence`; daily ceiling | `/questions/sweep`, `/questions/reference`, `/questions/sweep/:id/retry` |
| `sweep()` → `resumeCollections` | server.js:627, routes/placeIndex.js:2921 | Hourly | Google refused (no spender); **TripAdvisor spends** on `run.household_id` with no session check | `place_index`, matches, rescore | Runs idle 10 min; `collect.tripadvisor_cap` (default 120), `collect.ceiling_pence`, TA switch | `/place-index/collect` |
| `startScoutLoop` | sources/scoutArea.js:613 | 120 s, then every 15 min | Google sweep refused by paidGate (no spender). **Claude menu reads** (2 a tick) as `firstHousehold()`, session null, **not refused by the Claude gate** | `scout_places`, menus, queues research | `scout_areas.next_sweep_at`, `EPIC_RESWEEP_DAYS`, daily ceiling, household Claude bound | `/scout/areas`, `/scout/counties/:name`, `/scout/menus/retry`, `/scout/menus/causes/:cause/retry`, `/scout/menus/share`, shortlisting a place |
| `startOwnLoop` | sources/own.js:1281 | 60 s, then every 5 min | Free by default (`paid:false`). A paid job queued by a drawer opening runs on the opener's session | `place_records`, facts, expiry | `EPIC_DAY_OUT_TEST`, source switches; no off switch for the loop | `GET /api/places/detail`, `POST /api/places/record` |
| `tryResume` → `harvest.resumeInterrupted` | server.js:776, sources/harvest.js:576 | 60 s, then every 5 min | Free (Wikimedia, Wikidata, venue sites) | Atlas and images over every region still to do | Only runs a restart killed; `EPIC_HARVEST_MAX_REQUESTS` | `/library/harvest` |
| `resumeTransit` | server.js:798, sources/transit.js:228 | 90 s, then every 5 min | Free (Overpass) | Stations until 56 cells are covered | Stops itself | `/api/stays/transit/harvest` |
| `checkGround` | server.js:878, sources/groundCounts.js:550, :597 | 150 s, then every 5 min | Free (Overpass, FSA) | Ground counts for tiles the census has closed | `EPIC_GROUND_EVERY_MS` | census |
| `runBarChecks` (`seedBars` + `checkBars({repair:true})`) | server.js:663, repositories/placeIndex.js:298, :341 | Boot, then daily | Free | **Gives drawers bars and rescores places** | none | — |
| `sweep()` → `settleNew`, `refreshReach`, `expireRentedCoordinates`, session and plan purges | server.js:612 | Hourly | Free | Places and scores up to 5,000 new places, rewrites reach, nulls provider coordinates older than 30 days | Advisory lock (reach) | — |
| `buildIfEmpty` | repositories/placeIndex.js:986 | Once at boot | Free | Builds the whole index | Only when `place_index` is empty | — |
| `refreshRingsDue` | repositories/ringTables.js:259 | Boot, then daily | Free | Recounts rings older than 30 days | none | — |
| `checkPostcodes` | sources/postcodeRefresh.js:72 | Daily tick, monthly check | Free (ONS) | **Deletes and reloads `postcodes`** when ONS publishes | `EPIC_ONSPD_URL`, 6 h DB claim | `/place-index/postcodes/refresh` |
| `deskDaily` | routes/desk.js:375 | Boot, then daily | Free | Raises and retires mapping proposals | none | — |
| `osmDaily` | sources/osmExtract.js:292 | Boot, then daily | Free (Geofabrik) | Bulk load of the OSM extract | **`EPIC_OSM_EXTRACT`**; empty means off | — |
| `ensureTaxonomyReady` | routes/taxonomy.js:85 | Once, 5 s after boot (and on some taxonomy reads) | Free | Decides labels and writes shelf rules signed "Epic" | none | taxonomy GETs |
| `startReminderLoop` | routes/groups.js:983 | 20 s, then every 15 min | Messages through `NOTIFY_WEBHOOK_URL` | Cancels groups under their minimum, settles items, bills people, chases | none (rows written as `no_channel` without a webhook) | group routes |
| `startHostingLoop` | routes/hosting.js:1640 | 20 s, then every 30 min | Postmark / Twilio if configured | Confirms or cancels held bookings on their day | none | bookings |
| `startOpenToLoop` | routes/openTo.js:815 | Boot, then hourly | Postmark / Twilio if configured | Lapses introductions, sends one nudge | none | open-to routes |
| `startChatLoop` | sources/chatNotify.js:117 | 15 s, then every 5 min | Postmark / Twilio | Sends held digests | Skipped when `NODE_ENV=test` | chat routes |

Nothing in this table can be switched off by a flag, except the census (source switch, run state) and the OSM extract (`EPIC_OSM_EXTRACT`). `EPIC_ENRICHMENT` is read only by `sources/vocabulary.js` and `routes/questions.js`, and no loop checks it.

## 11. Scripts

| Script | What it does | Spends | Writes production | Agent |
|---|---|---|---|---|
| `reach-accuracy.mjs` (repo root) | Compares the matrix with Google Routes | **Paid Google Routes by direct `fetch` (line 56), bypassing paidGate**, plus the gated `routeMatrixMinutes` | Yes: `provider_calls` with no household, via `DATABASE_URL` + `GOOGLE_MAPS_API_KEY` | DENY; delete or fence |
| `reach-sample.mjs`, `reach-sample-short.mjs` (root) | Sample pairs and route them | **Paid Google Routes by direct `fetch` (line 37), bypassing paidGate** | Yes: `provider_calls`, `/app/sample.json` | DENY; delete or fence |
| `census-se1.mjs` (root) | SE1 density test through `censusArea` | Google IDs-only (quota) | Yes: census tables | DENY; retire |
| `recensus-truncated.mjs` (root) | Re-censuses slices that were cut off | Google IDs-only (quota) | Yes: census tables | DENY; retire |
| `reach-geometry.mjs` (root) | Distance of places from their cell centres | Free | Reads the DB, writes `/app/offsets.json` | ALLOW |
| `reach-fit.mjs`, `reach-fit2.mjs` (root) | Offline curve fit from JSON | Free | No | ALLOW |
| `apps/api/src/seed.js` (`npm run seed`) | Seeds the founding household. **`--force` deletes all households** | Free | Yes, via `DATABASE_URL` | DENY `--force` against anything but a local DB |
| `apps/api/src/migrate.js` (`npm run migrate`) | Applies migrations | Free | Yes, via `DATABASE_URL` | ALLOW locally and in tests only; production migrates on deploy |
| `apps/api/src/loadPostcodes.js` (`npm run postcodes`) | ONSPD download, then **delete and reload `postcodes`** | Free | Yes (header says to run it through railway ssh) | DENY |
| root `db:reset` | `docker down -v`, migrate, seed | Free | Local Docker, unless `DATABASE_URL` points elsewhere | ALLOW locally only |
| `scripts/brand.mjs`, `scripts/census-resume-hash.mjs` | Brand assets; hashes the resume passphrase at a TTY | Free | No | ALLOW (the hash script is the owner's to run) |

There is no `apps/api/scripts/` directory. The shared tree also holds many untracked root `*.mjs` files (benches, experiments, screenshot drivers) that this worktree does not have. They are not inventoried here. CLAUDE.md keeps them out of the image through `.dockerignore`, but they can still be run with `node` against whatever `DATABASE_URL` and keys are loaded.

## 12. Capabilities today

Seventeen capabilities are defined in `apps/api/src/access.js` `CAPABILITIES`. Seeded roles are in `migrations/034_back_office.sql`, plus later grants in 036, 045 and 102: owner, admin, support, analyst, member. The table shows each capability's route count from `requires('…')` and what a restricted `agent` role should hold.

| Capability | Routes | Agent role | Why |
|---|---|---|---|
| `view_accounts` | 8 | hold | read |
| `view_activity` | 2 | hold | read |
| `view_reporting` | 8 | hold | read; `/demand/search?names=1` spends only with `manage_library`, which the agent will not have |
| `view_financials` | 3 | hold | read (the owner may prefer to withhold money figures) |
| `view_audit` | 1 | hold | read |
| `view_library` | 154 | hold, **after** the four spending GETs under it (`/lookup`, `/lookup/place`, `/shelves/food`, `/scout/model/check`) are moved behind a spend capability or made to refuse agent sessions for every provider | today it spends |
| `view_hosting` | 1 | hold | read (note: `/api/admin/open/checks*` shows passports and selfies under `manage_hosting`) |
| `view_skills` | 8 | hold | read |
| `view_questions` | 7 | hold | read |
| `manage_library` | 135 | **withhold** | the ALLOW rows under it (listed below) need their own capability |
| `manage_questions` | 23 | withhold | every write is a promotion, a harvest, a sweep or a delete |
| `manage_settings` | 16 | withhold | ceiling, provider switch, agent grants, paid bench |
| `manage_accounts` | 5 | withhold | accounts, bounds, invitations, sign-outs, deletion |
| `manage_roles` | 4 | withhold | would let the agent grant itself anything |
| `manage_plans` | 6 | withhold | prices and call bounds |
| `manage_hosting` | 6 | withhold | trust levels, pitch decisions, ID checks |
| `manage_skills` | 14 | withhold | site-wide vocabulary, mass-pausing offers |

**Also outside any capability:** `requireOwner` routes (`/api/keys`, `/api/stays/probe`, `/api/stays/transit/harvest`); `POST /api/accounts/owner`, which has only the admin door; and `PATCH /api/sources/:key`, which needs only a session. The agent role must be `isOwner: false`, and the three session-only or door-only routes above need a capability before it exists.

**What a new capability for the agent would cover.** One capability for single-item, undoable back-office edits would cover these routes, which are the back-office ALLOW and READ-VARIANT rows:
- **ALLOW:**
  - `PATCH /place-index/place`, `POST /score`, `POST /queue/:id/report`;
  - `PUT /desk/places/:ref/facts/:fact`, `POST /filing/subcategories/:key/not-sure`, `POST /taxonomy/not-sure/queue`, `POST /taxonomy/audit/run` (it proposes and changes nothing), `POST /taxonomy/parts`, `POST /filing/rows/:id/heart`;
  - `POST /library/images/:id/links`, `PUT /library/portraits/:type/:id`, `POST /library/attractions/:id/detail`;
  - `PATCH /suite/supplier/:key` (description), `PUT /skills/source`.
- **READ-VARIANT:**
  - `POST /filing/checks/run` with `repair:false`;
  - `POST /desk/mapping/proposals/:id` with `action:'keep'`;
  - the preview for `POST /desk/categories/defaults` (`GET /categories/impact`);
  - `POST /voice/runs` with `plan:false`.

Everything else under `manage_*` stays with a person.

**The credential itself (for when it is built):**
- A separate secret or account per agent, not the passcode.
- An `agent` role with `isOwner: false`.
- Its own test household with a zero call bound, never the founding household.
- `api_sessions.kind = 'agent'` set by the credential, not guessed from the user agent.
- No paid grant unless the owner issues one (G8/G9).

## 13. Human-only config

These are the names only; no value was opened or printed, and `.env` was not read. `apps/api/src/env.js` loads the repo-root `.env` and aliases `ROAM_*` to `EPIC_*`. That means any agent process started in the repo loads every name below.

**Secrets. Agents should not load any of these (G2, G3):**
- `EPIC_PASSCODE` (the owner's door; agents get their own credential)
- `EPIC_CENSUS_RESUME_KEY`, `EPIC_CENSUS_RESUME_KEY_HASH` (G3: they belong in production's config only)
- `DATABASE_URL` (production's)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_WORKSPACE_ID`
- `GOOGLE_MAPS_API_KEY`
- `OPENAI_API_KEY`
- `TRIPADVISOR_API_KEY`
- `LITEAPI_KEY`
- `PREDICTHQ_API_KEY`, `TICKETMASTER_API_KEY`, `SEATGEEK_CLIENT_ID`, `DATATHISTLE_API_KEY`
- `MAPILLARY_TOKEN`
- `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_AUTH_TOKEN`
- `POSTMARK_SERVER_TOKEN`, `POSTMARK_WEBHOOK_TOKEN`, `RESEND_API_KEY`
- `NOTIFY_WEBHOOK_URL`
- `EPIC_FLIGHT_SCHEDULE_KEY`

**Spend bounds, ceilings and switches. Agents may read these names but never set them (H1). They live in Doppler:**
- `EPIC_DAILY_SPEND_CEILING_GBP`
- `EPIC_HOUSEHOLD_MONTHLY_CALL_BOUND`, `EPIC_HOUSEHOLD_MONTHLY_CLAUDE_BOUND`, `EPIC_SESSION_CALL_BOUND`
- `EPIC_CENSUS_DAILY_CAP`, `EPIC_CENSUS_MAX_REQUESTS`, `EPIC_CENSUS_MAX_DEPTH`, `EPIC_CENSUS_EVERY_MS`
- `EPIC_HARVEST_MAX_REQUESTS`
- `EPIC_LOOKUP_TRIPADVISOR_CAP` / `ROAM_LOOKUP_TRIPADVISOR_CAP`, `EPIC_TRIPADVISOR_ENRICH`
- `EPIC_MENU_CHECKS_MONTHLY`
- `EPIC_SCOUT_MONTHLY_RUNS`
- `EPIC_VOICE_MINUTES_MONTHLY`, `EPIC_VOICE_LIVE_SESSIONS_DAILY`, `EPIC_VOICE_MAX_SECONDS`
- `EPIC_MATRIX_MAX`
- `LITEAPI_LIMIT`
- `EPIC_HOST_FEE_PERCENT`
- `EPIC_SOURCES`, `EPIC_ENRICHMENT`, `EPIC_OSM_EXTRACT`, `EPIC_LOCAL_SCOUT`, `EPIC_DAY_OUT_TEST`

**Database settings that act as ceilings.** They are changed by the DENY routes above:
- `app_settings` `collect.ceiling_pence` (`PUT /runs/ceiling`) and `collect.tripadvisor_cap`
- desk settings `budgetGoogle` and `budgetClaude` (`PUT /desk/settings/:key`; display-only today)
- `accounts.monthly_call_bound` and plan `call_bound`
- `api_sessions.paid_grant_until`
- the source switches (`PATCH /api/sources/:key`, `POST /suite/supplier/:key/adapter`)

## 14. Found on the way (outside G2, not fixed)

These are faults the trace turned up. They matter whatever the agent role is, and they were checked against the code, not assumed:
- **Trips, groups, visits and plan sessions are not scoped to the caller's household.**
  - `routes/trips.js` `loadTrip` and `repositories/trips.js` `tripById` / `deleteTrip` are `where id = $1` with no household check. `DELETE /api/trips/:id` deletes any household's trip by id.
  - `routes/groups.js` `loadGroup` has the same gap.
  - So do `PATCH`/`PUT`/`DELETE /api/visits/:id` (`repositories/visits.js:78`) and `livePlanSession`.
  - `tripTravel.js` and `tripChat.js` do check the household.
- **`PATCH /api/sources/:key` switches a provider on or off for the whole estate from any signed-in session.** It has no capability check.
- **`DELETE /api/session?all=1` calls `revokeAllSessions(account_id ?? null)`.** For a session with no account, that revokes every session in the estate.
- **`POST /api/session/request-link` and `POST /api/join/:token/code/again` send a real SMS or email on every call.** They are held only by the general limiter.
- **`POST /api/shared/:token/enter` texts or emails any contact typed by anyone who holds a share link.**
- **Census run caps come from the request body.** `POST /place-index/census/run` passes `dailyCap`, `maxRequests` and `ratePerSec` from the body without an upper clamp. When `EPIC_CENSUS_RESUME_KEY(_HASH)` is unset, the only guard on resume is echoing the run's label, which G6 says is not a permission boundary.

## 15. Counts

437 endpoints inventoried: 217 back office (`/api/admin/*`, `/api/accounts/*`) and 220 household app, public or proxy. An endpoint belonging to several classes is counted once in each of them.

| Class | Endpoints in the class | Listed under it (most serious class) |
|---|---|---|
| Raises a cap / changes a spend or access setting (CAP) | 14 | 14 |
| Spends money or quota (SPENDS) | 89 | 87 |
| Deletes (DELETES) | 57 | 56 |
| Resets, forgets or revokes (RESETS) | 17 | 8 |
| Bulk-applies (BULK) | 111 | 75 |
| Starts, resumes or stops a job (JOB) | 43 | 8 |
| Messages people / accounts / trust / publishing (WRITE-OTHER) | 71 | 46 |
| Single-item edit (EDIT) | 165 | 137 |
| Read or preview only (READ) | 6 | 6 |

Recommendation for the agent role: **DENY 335**, READ-VARIANT 8, ALLOW 94. Most of the ALLOW rows are household-app edits, which are safe only once the agent has its own test household and the trip, group, visit and plan-session scoping in §14 is fixed. The loops (§10: 20 loops) and scripts (§11: 11 rows, 7 of which spend or can write production) are counted separately.
