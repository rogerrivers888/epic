# Epic

*Seize the day.* A household taste-memory app: it holds who is in the family and what they will and won't eat or do, then answers one question — given where we're going, how long we have, and who is coming, where should we go?

Documents: [requirements](docs/requirements.md) · [technical constraints](docs/technical-constraints.md) · [UX research](docs/ux-research.md).

## Layout

```
apps/api   Node + Postgres JSON API (Express). Binds 0.0.0.0 on $PORT.
apps/web   Expo app with react-native-web. Talks to the API at EXPO_PUBLIC_API_URL.
docs/      Requirements, technical constraints, UX research.
```

The API owns every third-party call (place sources, routing, Claude). No provider key reaches the web bundle.

## Run locally

```bash
cp .env.example .env               # PORT, DATABASE_URL, EXPO_PUBLIC_API_URL
npm install
npm run db:up                      # Postgres 17 in Docker on localhost:5434
npm run migrate && npm run seed    # schema + the founding household
npm run api                        # http://localhost:4000  (GET /health)
npm run web                        # http://localhost:8081  (Expo web)
```

The conversational planner needs an Anthropic key in the API's environment: `ANTHROPIC_API_KEY=sk-ant-…` (put it in `.env`; it is git-ignored). Without it, household, trips and the touch controls work; interpreting what you *say* does not.

Place data comes from two sources behind one interface (`apps/api/src/sources/`): **OpenStreetMap** (Overpass for places, Nominatim for geocoding, Photon for the "where are we going?" typeahead — all the same open data, no key, cacheable with attribution; no reviews, ratings or allergen data) and a local **fixture** set of invented Boston venues used for development. `EPIC_SOURCES` defaults to `fixtures,osm`; Google, Yelp and TripAdvisor slot in behind the same interface once credentials and spend caps exist. Taste vocabulary (dishes, cuisines, experiences, diets, with aliases and fuzzy matching) lives in `apps/api/src/domain/concepts.js`.

## API sketch

| Route | What |
|---|---|
| `GET /health` | liveness + DB |
| `GET/PATCH /api/household`, `…/members`, `…/constraints` | household, members, allergens / dislikes / likes |
| `POST /api/discover` | time-bounded discovery with constraints applied and attribution logged |
| `POST /api/plan/start` | a sentence → intent → one candidate pool → several trip options |
| `POST /api/plan/refine` | "I like this, not that" in words, mapped onto the stops on screen |
| `POST /api/plan/act` | the same changes by touch (no model call) |
| `POST /api/plan/commit` | make an option the active trip |
| `GET/POST /api/trips…` | trips, stops, recalculated time budget |

## Deploying as two services

Each app is its own Railway service in the Railway project (still named `roam`
until the owner renames it in the Railway console — a project name is his to
change, and nothing depends on it), both connected to this repo's `main` branch at the **repo root** (so the root lockfile and workspaces install deterministically). Per-service commands are set with Railpack's documented override variables rather than a root directory, because the CLI cannot set a root directory:

| Service | Variables that define it (non-secret) | Listens on |
|---|---|---|
| `api` | `RAILPACK_START_CMD = npm run migrate -w @epic/api && npm start -w @epic/api` | `0.0.0.0:$PORT` |
| `web` | `RAILPACK_BUILD_CMD = npm run build -w @epic/web` · `RAILPACK_START_CMD = npm start -w @epic/web` · `EXPO_PUBLIC_API_URL = <public URL of api>` | `0.0.0.0:$PORT` |

Postgres is a Railway Postgres service in the same project; the `api` needs its `DATABASE_URL`.

### The address

Epic is at **https://epic.day**, behind Cloudflare (proxied, SSL Full), which
hands on to Railway. One variable says so — `EPIC_APP_URL` — and everything
that has to name the site reads it from `apps/api/src/origins.js`: sign-in
links, the address the crawler publishes in its user agent, the origins a
browser may carry a session from, and where a request on the wrong hostname is
sent. Unset, it falls back to `https://epic.day` rather than to a Railway
hostname: an unset variable should degrade to the right answer, not the old one.
`APP_URL` is read as an alias, but `EPIC_APP_URL` is the documented name because
every other variable here is `EPIC_*`.

**Everything answers on one address.** `www.epic.day`, any `*.up.railway.app`
hostname somebody bookmarked, and plain HTTP all 301 to `https://epic.day`.
Cloudflare cannot do this part for the Railway hostnames, because it never sees
them — they are the origin, not the edge — so both services do it themselves
(`apps/web/server.mjs`, and the middleware in `apps/api/src/server.js`).

Three things are deliberately *never* redirected, and each would be an outage if
they were: `/api`, because a client that followed a 301 would arrive somewhere
that may not answer; `/health`, because that is how Railway decides a deployment
is alive and it is asked over plain HTTP on an internal hostname; and anything
on `*.railway.internal` or `localhost`, for the same reason.

**The web service no longer uses `serve`.** It could not do a redirect that
depends on the host, so `apps/web/server.mjs` replaces it — the same static
serving, SPA fallback and `sw.js` cache rules, plus the canonicalisation. A
missing hashed asset 404s rather than falling through to `index.html`, so a
half-deployed bundle says so where it happens.

**Two proxies, not one.** Cloudflare terminates TLS and Railway terminates
again, so `trust proxy` is `2` (`EPIC_TRUSTED_PROXIES` if that ever changes) and
rate limiting counts per caller using Cloudflare's `CF-Connecting-IP`, which is
the one address in the chain a caller cannot forge.

There is no OAuth in Epic — sign-in is a passcode and a magic link — so there
are no callback URLs to move. There was no sitemap or canonical tag before this;
`apps/web/public/sitemap.xml`, `robots.txt` and the `<link rel="canonical">` in
`index.html` are new. The sitemap has one entry because every page is behind a
passcode; `robots.txt` excludes `/join/` and `/order/`, which are unguessable
links people are sent and must never be indexed.

### The rebrand: what is still called Roam

Roam became Epic on 7 September 2026 (`Supporting docs/Rebrand - EPIC`). The code,
the mark, the palette and every word on a screen moved; four things outside the
repo did not, because they are the owner's to change and the code cannot:

1. **The `ROAM_*` variables in Doppler.** The API now asks for `EPIC_*`, but
   `apps/api/src/env.js` aliases any `ROAM_*` variable onto its `EPIC_*` name
   before anything reads one, so **the running deploy keeps working untouched**.
   Rename them in Doppler at your own pace; a key renamed there immediately wins
   over the old one. When none are left, the alias loop in `env.js` can go.
2. **`RAILPACK_START_CMD` and `RAILPACK_BUILD_CMD` on Railway**, which name the
   workspaces. Those are now `@epic/api` and `@epic/web`, so **these three
   variables must be updated by hand before the next deploy will start** — the
   values are in the table above.
3. **The Railway project and service names**, and the `*.up.railway.app`
   hostnames that follow from them. Cosmetic; renaming a service changes its
   public URL, so `EPIC_WEB_URL`, `EPIC_WEB_ORIGIN` and `EXPO_PUBLIC_API_URL`
   have to move with it.
4. **A local `.env` and the local Postgres.** `docker-compose.yml` now makes an
   `epic` database in an `epic-postgres` container on a fresh volume, so a
   machine with an existing `roam-postgres` either starts clean
   (`npm run db:reset`) or renames in place and keeps its data:

   ```bash
   psql "$DATABASE_URL" -c 'alter database roam rename to epic'   # from another db
   psql … -c 'alter role roam rename to epic'
   # then point DATABASE_URL at postgres://epic:…@localhost:5434/epic
   ```

Inside the database, migration `065_epic_rename.sql` does the rest: `roam_score`
becomes `epic_score` on three tables, the image-search functions are rebuilt
under `epic_*` names with their triggers re-pointed, and rows storing `'roam'`
for `payment_mode` / `book_where` become `'epic'`. Sessions survive: the cookie
is now `epic_session` and the old `roam_session` is still read, and the web app
moves its own `roam.*` browser keys and its offline database — outbox included —
on first load (`apps/web/src/rename.ts`, `apps/web/src/offline/store.ts`).

### The door

Every `/api` path needs a session, except six: `/health`, `/robots.txt`, `/api/session`
(signing in), `/api/session/link` and `/api/session/request-link` (magic links, which are how
a session is obtained and so cannot need one), and `/api/join/:token` (a group invite link,
where the unguessable link is itself the credential).

- **Two ways in.** The owner's passcode, `EPIC_PASSCODE`, set in Doppler and never in the
  repo; and a **magic link** for everybody else, issued from Accounts (see below).
- Which household a request is about is decided by the account behind its session, in
  `apps/api/src/context.js` — an async-local store that `currentHousehold()` reads. A session
  with no account is the passcode, which is the owner on the founding household, exactly as
  before accounts existed.
- The passcode is exchanged once for a token that lasts 90 days; only a hash of that token is
  stored (`api_sessions`). Settings › Account lists the devices signed in and can sign out one
  or all of them.
- A cookie is also set, and is accepted for exactly two GETs that cannot carry a header — a
  photograph in an `<img>`, and the shortlist search stream. **Writes never accept the
  cookie**, which is what keeps another site from being able to act as the family.
- Sign-in attempts are limited to 10 per 15 minutes per caller; provider-spending paths to
  120 per 5 minutes; everything else to 900 per 5 minutes (`apps/api/src/limits.js`).

**Deployed with no passcode set, the API serves nothing to anybody it does not already
know** — every `/api` request answers 503 `auth_not_configured`, and `/health` reports
`"auth": "not-configured"`. That is deliberate: the alternative is quietly serving the
household to the internet, which is what this replaced. An account holder with a live session
is somebody it knows and keeps working, so taking the shared passcode away does not lock
every other household out of its own Epic.

### Accounts

An account belongs to one household. Nothing is shared between households: their places,
people, trips and ratings are reachable only through a session belonging to an account on that
household, and every provider call is billed against it (`provider_calls`).

Two different acts create an account, and confusing them is the mistake to avoid:

- **Giving Epic to somebody else** — the Accounts tab in the back office. They get a household
  of their own, empty, and see nothing of anybody else's.
- **Inviting somebody you live with** — the Household tab (below). They get a way in to the
  household they are already in, and see all of it.

- **Accounts** (owner-only tab, and `/api/accounts`) lists everybody with Epic, how long they
  have been here, when they were last in, how many times they have signed in, and what their
  searching has cost this month and in total. The owner adds a person by e-mail; Epic makes
  them a household of their own and issues a single-use link that expires in a week.
- **Sending needs a key.** With `RESEND_API_KEY` and `EPIC_MAIL_FROM` set, Epic e-mails the
  link. Without them it still makes the link and shows it on the screen to be copied and sent
  by hand — nothing is silently dropped. Adding those keys is the owner's, in Doppler.
- **Every household draws on the same provider allowances**, because a Google or Tripadvisor
  free tier is per provider account, not per household. So each account carries its own
  monthly ceiling on provider calls (`accounts.monthly_call_bound`, editable per person on the
  Accounts screen). Somebody new starts at a quarter of `EPIC_HOUSEHOLD_MONTHLY_CALL_BOUND`.
  Epic declining to spend is not a spend cap: the cap at the provider is still the owner's to
  set in their console.
- **Suspending** an account signs its devices out and refuses new links; its data is untouched.
  **Removing** an account takes its way in; removing it *with* its household deletes everything
  that household saved, and says so before it does.
- The admin routes answer **404** to anybody who is not the owner, not 403: a customer has no
  business learning that they exist.

### Inviting your own household

On the **Household** tab, each adult has a *Epic on their own phone* panel: a mobile number, an
e-mail address, and a button for each. Epic mints one single-use link that expires in a week and
sends it however you asked — one link even when it goes out both ways, because the first tap
spends it.

- **They become a full peer.** The same trips, the same saved places, everybody's tastes and
  allergies. No read-only mode: a household is shared, so everybody in it is equal (owner,
  6 Sep 2026). They do not get the back office — `/api/accounts` answers them 404.
- **A profile under thirteen has no sign-in**, and the panel says so instead of offering one
  (Epic 1 C8: a minor's profile is managed by a consenting adult).
- **Sending needs a key, and the screen says which.** `TWILIO_ACCOUNT_SID` /
  `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` for texts, `RESEND_API_KEY` / `EPIC_MAIL_FROM` for
  e-mail. With neither, Epic still makes the link and shows it to be copied and sent by hand —
  nothing is silently dropped. Adding them is the owner's, in Doppler.
- **A Twilio trial is enough for your own household, with two caveats.** It texts only numbers
  added under *Verified Caller IDs* (five of them), and only within the country the account
  signed up in; every message is prefixed *"Sent from your Twilio trial account -"*. Both go
  when the account is upgraded. Epic turns Twilio's refusals into what to do about them —
  error 21608 becomes "add it under Verified Caller IDs, or upgrade" rather than a code.
- **Taking a sign-in away is not removing a person.** *Remove their sign-in* deletes the account
  and signs their devices out; the profile, the tastes and every rating stay. Removing the
  *person* does take their sign-in with them (`accounts.member_id` cascades), so a deleted
  profile can never leave a live way in behind it.
- **A number or an address signs one person into one Epic.** Both are unique across the estate,
  and a mobile is normalised before it is stored, so `07700 900123` and `+44 7700 900123` are
  the same person rather than two.
- Somebody who changes phone gets back in themselves with `POST /api/session/request-link`,
  which takes either an address or a mobile and answers identically whether or not it knows it.

### Where variables live

**Secrets come from Doppler at runtime** — never in the repo and never set directly as Railway variables (see `CLAUDE.md`). If the Doppler → Railway sync is configured to manage *all* variables on a service, the non-secret entries above must be mirrored in Doppler too, or the sync will remove them.

**api**

| Variable | Required | Notes |
|---|---|---|
| `PORT` | set by the platform | |
| `DATABASE_URL` | yes | Postgres connection string (Doppler) |
| `EPIC_PASSCODE` | **yes, deployed** | The household's passcode (Doppler, owner-set). **Without it the deployed API answers 503 to every `/api` request and serves nothing** — see "The door" above. Locally, unset falls back to `epic-dev`. |
| `RESEND_API_KEY` | optional | Mail sender (Doppler, owner-set) used for account invitations and sign-in links. Unset, Epic still makes the link and the Accounts screen shows it to be sent by hand. |
| `EPIC_MAIL_FROM` | with the above | The address invitations come from, on a domain verified with the sender, e.g. `Epic <hello@example.com>`. Non-secret, but a sender is not configured until both this and the key are set. |
| `TWILIO_ACCOUNT_SID` | optional | Twilio **Account** SID — the `AC…` string under Account Info (Doppler, owner-set). It is the URL every request is sent to, not merely a username, so an `SK…` API key here produces a 404; Epic checks the shape and says so. With the two below, Household-tab invitations go out by text. Unset, Epic still makes the link and the screen shows it to be sent by hand. |
| `TWILIO_AUTH_TOKEN` | with the above | The secret to sign with: the account's Auth Token, or an API key's secret when `TWILIO_API_KEY_SID` is set. Doppler only. |
| `TWILIO_FROM` | with the above | The number texts come from, or a messaging service SID (`MG…`), which is what Twilio wants for UK traffic. Non-secret, but no text sender exists until all three are set. |
| `TWILIO_API_KEY_SID` | optional | An API key (`SK…`) to sign as, instead of the account itself — revocable without changing the account's token. The account SID above is still required: a key signs a request, it does not address one. |
| `EPIC_APP_URL` | **yes** | `https://epic.day` — the one address Epic answers on. Non-secret. Sign-in links, the crawler's user agent, the CORS allowlist and every redirect are built from it. Unset, it defaults to `https://epic.day`; set it anyway, so moving the domain is one variable rather than a deploy. `APP_URL` is accepted as an alias. |
| `EPIC_WEB_URL` | optional | Overrides `EPIC_APP_URL` for sign-in links only. Now that the app and the site are the same address there is no reason to set it; it exists for the case where they are not. |
| `EPIC_TRUSTED_PROXIES` | optional | How many proxies sit in front of this process, for `req.ip` and rate limiting. Default 2 (Cloudflare, then Railway). Only change it if the chain in front changes. |
| `EPIC_HOUSEHOLD_MONTHLY_CALL_BOUND` | optional | Provider calls a household may make in a calendar month before Epic stops searching for it (default 3000). Per-account ceilings on the Accounts screen override it; a new account starts at a quarter of it. |
| `EPIC_WEB_ORIGIN` | recommended | Comma-separated list of origins the web app is served from, e.g. `https://epic.day, https://www.epic.day`. Non-secret. Restricts which sites may open a session-carrying request; unset, any origin is answered and the passcode is the only guard. `EPIC_APP_URL` and its `www.` are **always** allowed whatever this says — an allowlist that can be emptied by forgetting a variable is a way to take the app down with a config change. |
| `ANTHROPIC_API_KEY` | yes | conversational planner (Doppler) |
| `ANTHROPIC_WORKSPACE_ID` | if the key is identity-linked | The Anthropic workspace the key acts in (`wrkspc_…`). Console-issued keys that are linked to a person require it; a legacy workspace key does not. |
| `RAILPACK_START_CMD` | yes | see table above (non-secret) |
| `GOOGLE_MAPS_API_KEY` | recommended | Google Places API (New) + Routes API: ratings, reviews, photos, hours, family flags, dish-search evidence, **real travel times**. Restrict the key to those APIs; set a budget and per-API quota in Cloud Console. Switches on automatically. |
| `TRIPADVISOR_API_KEY` | optional | Tripadvisor Terra Content API, Discover plan (`X-API-Key`): ratings, 3 reviews + 5 photos per place, strong for attractions outside the US. Billed per location ID returned, first 1,000 free once, then from $0.015; set a daily budget in the Terra dashboard. `EPIC_TRIPADVISOR_PAGE` (default 10, max 20) caps IDs per nearby call. Live once the key exists, but **opt-in**: it only runs when a search's `sources` set names it (the Sources row on a search form, or a trip's saved sources). With other sources it looks venues up by name and adds ratings (`EPIC_TRIPADVISOR_ENRICH` lookups, default 8); on its own it takes one bounding-box page, which is a testing view. |
| `TICKETMASTER_API_KEY` | optional | Ticketmaster Discovery v2: real timed events inside an outing window. Free. Switches on automatically. |
| `SEATGEEK_CLIENT_ID` | optional | SeatGeek Platform API: ticketed events (US-strongest, London partly). Free client id from https://seatgeek.com/account/develop. Switches on automatically. |
| `PREDICTHQ_API_KEY` | optional | PredictHQ Events API: ranked events worldwide incl. *community* events (fairs, markets, parades). 14-day trial then a Free plan; paid plans are the owner's call. Bearer key from https://control.predicthq.com. Switches on automatically. |
| `DATATHISTLE_API_KEY` | optional | Data Thistle (The List): UK live-events data down to village fairs and library sessions. Free tier: 1,000 requests a month per account (one request per events search); paid plans above that. Bearer token from https://api.datathistle.com/account — tokens expire after 30 days and must be refreshed. Switches on automatically. |
| `MAPILLARY_TOKEN` | optional | Mapillary street-level imagery, for the shopfront rung of the picture ladder (`sources/placePicture.js`). Free, does not bill, and no paid tier to fall into: a client token from https://www.mapillary.com/dashboard/developers. Without it that rung falls back to KartaView, which is keyless but has far too little coverage to carry it — 0–11 frames per 100m in London, Windsor and Bath. Switches on automatically; the back office reports it at `GET /api/admin/library/pictures`. |
| `LITEAPI_KEY` | optional | Nuitée Connect (LiteAPI, `X-API-Key`): live hotel rates and availability for the **Stay tab** — the only thing that ever asks for it. Two requests per look: `GET /data/hotels` for the beds on the patch of map (held 6 h) and `POST /hotels/rates` for what they cost on the trip's nights (held 10 min). Free to search — LiteAPI earns a commission on a booking, and Epic takes no booking. A `sand_…` key answers with invented hotels at invented prices and the Stay tab says so on screen; a `prod_…` key is real inventory. Never a place-search source: it is not in `EPIC_SOURCES` and never runs inside a browse. Switches on automatically, and can be switched off in Settings › Providers. |
| `LITEAPI_CURRENCY` / `LITEAPI_NATIONALITY` | no | what the household pays in and travels on, both of which change the quoted price. Default `GBP` and `GB`. |
| `LITEAPI_TIMEOUT_S` / `LITEAPI_LIMIT` | no | how long LiteAPI may take on a live rates request (4–10, default 8) and how many beds a look considers (default 100). |
| — | — | **Is a key actually here?** `GET /api/keys` (owner only, 404 to anybody else) reports, for every key the API expects: whether it is set, how long it is, and whether it arrived wrapped in quotes, padded with whitespace, or still holding Railway's unresolved `${{ … }}` reference syntax. It also reports `DOPPLER_PROJECT` / `DOPPLER_CONFIG`, which is how to tell *which* Doppler config Railway pulled into *this* service — the integration is configured per service, so a config synced to `web` never reaches `api`. **No value, or part of one, is ever returned.** |
| **Stations, tube, trams** | — | Held in `transit_stops`, not fetched per search. `POST /api/stays/transit/harvest` (owner only) fills or refreshes a region — the default is the whole UK, about 3,500 stops across ~56 cells with a pause between each; `{"cellDeg":1.5,"refresh":true}` to re-cut or force a re-fetch. `GET /api/stays/transit` reports what is held and which cells are covered. The API also continues an unfinished harvest in four-minute slices while it is up, so it completes on its own. Every cell is idempotent and recorded separately: an interrupted run is finished by running it again, and a cell no Overpass mirror will answer stays uncovered so a live lookup fills it in when somebody searches there. Four kinds are stored — `rail`, `subway`, `tram`, `light_rail` — and a stay search takes `stationKinds=rail,tram` to narrow them. |
| `EPIC_HARVEST_RESUME_DELAY_MS` | optional | How long after boot the API picks up an atlas harvest a restart interrupted (default 60000). The whole UK is four or five hours of work living inside a web server that gets restarted for every deploy, so it resumes itself rather than waiting for somebody to notice — but not *at* boot, because a job that starts with the process is a job implicated in every failure to start. Set it higher to delay, or very high to leave resuming to the Atlas screen's own buttons. |
| `EPIC_LOCAL_SCOUT` | optional | `on` lets the **local scout** run: Claude searches and reads the council what's-on page, local paper and venue sites for the outing's place and date and returns confirmed events with source links. Uses the Anthropic key (web search ≈ $0.01 per search + tokens, ≤ 6 searches per call, results cached in memory 6 h per place+date). Off by default because it spends money. |
| `EPIC_SCOUT_MONTHLY_RUNS` | no | the scout's own cap: runs per household per month (default 60 ≈ $40). Past it the scout pauses and plans carry on without it; the Anthropic workspace spend limit stays the hard stop. |
| `sources` (request) | — | every search endpoint takes `sources=osm,google,…`: the exact set for that search; omitted = every live source except opt-in ones. Trips can save a set (`PATCH /api/trips/:id { sources }`) that their shortlist searches and plans use. |
| `EPIC_SOURCES` | no | comma-separated enabled place sources; default `fixtures,osm,google,tripadvisor,ticketmaster,seatgeek,predicthq,datathistle,scout` (each licensed source is only live when its key exists) |
| `EPIC_OVERPASS_URLS` / `EPIC_NOMINATIM_URL` | no | override the OpenStreetMap endpoints (e.g. a self-hosted mirror). **Planet-wide instances only** — a regional extract answers 200, fast, and empty for everywhere else, which no health check can tell from a real result. `overpass.osm.ch` is Switzerland only and cost an afternoon proving it. |
| `EPIC_OVERPASS_TIMEOUT_MS` / `EPIC_STAYS_OPEN_DEADLINE_MS` | no | how long one mirror gets on an interactive path (default 12000), and how long the Stay tab waits for the open map before drawing the list without it (default 10000). |
| `EPIC_LEARN_THRESHOLD` | no | rating events before a learned preference counts; default 3 |
| `EPIC_SESSION_CALL_BOUND` / `EPIC_HOUSEHOLD_MONTHLY_CALL_BOUND` | no | spend containment bounds; defaults 40 / 3000 |
| `EPIC_MERGE_THRESHOLD` | no | entity-resolution confidence; default 0.75 |

**web**

| Variable | Required | Notes |
|---|---|---|
| `PORT` | set by the platform | |
| `RAILPACK_BUILD_CMD`, `RAILPACK_START_CMD` | yes | see table above (non-secret) |
| `EXPO_PUBLIC_API_URL` | yes, **at build time** | Public URL of the `api` service. `EXPO_PUBLIC_*` values are inlined into the bundle by `expo export`; setting it only at runtime has no effect, and it must never hold a secret. **This is the one address that does not become `https://epic.day` automatically** — it depends on where the API is actually reachable. If Cloudflare routes `epic.day/api` to the `api` service, set it to `https://epic.day`; if the API has its own subdomain, set that; if it is still on its Railway hostname, leave it, because the redirect middleware deliberately lets `/api` through untouched so it keeps answering either way. |
| `EPIC_APP_URL` | yes | The same value as on `api`: `https://epic.day`. `apps/web/server.mjs` reads it to decide which host is the canonical one. |

Provider keys for place, routing, event and speech sources are added to `api` (via Doppler) as each source is enabled (Technical Constraints §11), never to `web`.
