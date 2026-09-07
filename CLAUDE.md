# Epic — working agreements for agents

Read `docs/requirements.md` (governing) and `docs/technical-constraints.md` before changing behaviour. `docs/ux-research.md` explains why screens look the way they do.

## Constraints that come from the owner, not the docs

- **Prior instructions must be quoted, not asserted.** If you believe the owner set a constraint earlier, quote the exact message before acting on it. If you cannot find it, say so and ask; do not work around a rule you cannot cite.
- **Secrets come from Doppler at runtime.** Never in the repo, never in `.env.example`, never set directly as platform (Railway) variables. Local development reads a git-ignored `.env`; everything deployed is injected by the Doppler → Railway integration, which the owner configures by hand.
- **Anything that holds a secret, spends money, or sets a billing cap is the owner's to do.** Creating or renaming services, domains and non-secret configuration is fine for an agent when asked; adding provider keys, enabling paid sources, and provider-side spend caps are not.
- Provider trials that expire on a clock (Yelp, TravelTime) are enabled only against a defined comparison, never "to see" — Technical Constraints §11.

## Architecture rules that are easy to break by accident

- The web bundle never holds a provider key. All third-party calls go through `apps/api` (Technical Constraints §13.7). `EXPO_PUBLIC_*` values are inlined at build time and are public by definition.
- Licensed place content is rented: store identifiers and household-generated annotations only. `trip_stops.venue_name` is a fixtures-only exception and must become fetch-at-display when a licensed source is enabled.
- **Rented and owned are two different layers, and code must not mix them.** A household act — shortlist, save, special, visited — claims a place, and `sources/own.js` then researches it from OpenStreetMap, the venue's own published page and the open encyclopedias, all of which we may keep for good. That research lands in `place_records` (Technical Constraints §13.10). A provider's name, hours, reviews, photos or rating never lands there, is never written to `household_places.venue` for a licensed ref, and never reaches a device. When a drawer needs a fact that survives the signal going, it comes from the owned record — not from a cached copy of somebody else's.
- **A device may hold less than the server may.** Every API answer passes `apps/web/src/offline/policy.ts` before it is written to IndexedDB, and an endpoint not named there is not saved. Add new endpoints to that file deliberately; never make the fallback "save it unless it looks licensed".
- Every outbound provider call is attributed to a household and session in `provider_calls`; new integrations must log there before they are enabled.
- Allergens exclude; dislikes rank. They never share a control, a colour, or a code path.
- **The brand is the Epic pack v1** (`Supporting docs/Rebrand - EPIC`, September 2026), and it retires the Roam guidelines entirely (owner, 7 Sep 2026). Lime `#C8F542` is the brand and is used big and flat — the header, the primary action, and the moment something is selected. Ink `#201E1D` is every letter and every rule; cream `#FFFDF9` is the reading ground. Lime tint and moss are UI only. Square corners throughout, 2px ink rules, no shadows. **Never cream or white type on lime** (1.25:1); lime type only ever sits on ink. Archivo is the whole type system — there is no second face, and Caveat is gone. Every colour comes from `apps/web/src/theme.ts`; never a hex in a screen.
- **Roam red is retired, with one exception the owner kept**: allergen and overrun warnings stay red, because they mean danger rather than brand (7 Sep 2026). The loved heart is ink now. Nothing else in the app is red.
- **The mark is drawn, not a file.** `apps/web/src/components/Wordmark.tsx` — "Epic" in Archivo 800 at −0.06em with the pin as the dot of a dotless ı. The pin never sits beside the word, is never recoloured, and below 24px the wordmark becomes the pin alone. `docs/brand/README.txt` is the reference; the strapline is "Seize the day".
- Voice is interpreted against a closed set that is visible on screen, and every voice action has a tap equivalent that produces the same state change.
- While the household is speaking, the screen shows only the live transcript (`Listening` component): suggestions and everything else collapse, listening continues until they tap Done, and nothing is sent before then. Use `useSpeech` (continuous, accumulating) for every mic; never send on the first pause. Exception (owner, 3 Sep 2026, Plan screen): the criteria rows stay in view and fill as the words arrive (`/api/plan/preview`), with a small live box and one red Stop; the rest of the rule holds. That Stop is the third thing allowed to be red, beside allergens and overruns — it is an urgent action, not brand colour.
- Options are composed from one retrieved pool; adding an option must not add a provider call.
- **Every page has an address, and the address is what decides what is drawn** (owner, 5 Sep 2026: "Every page of our site needs a unique URL… 2 layers in, I should be able to share a URL with someone, and they should be able to get to the exact point that I was on"). `src/routes.ts` is the only place a URL is spelled; `src/router.tsx` is the only thing that reads or writes the address bar. A new screen or a new layer inside one is not done until it has a route in `routes.ts` and a case in `test/routes.test.ts`. The path is the page (`/trips/<id>/day/<dayId>`); the query is how that page is set (`?kind=eat`, `?place=<ref>`), and only what differs from the default is written down. A move pushes, a filter replaces. Never read or write `window.location` or `window.history` from a screen. Technical Constraints §13.14.

## Web and mobile are one layout system (owner, 3 Sep 2026)

The owner reviews every screen in both views on the deployed site: the shell (`apps/web/App.tsx`) carries a Web / Mobile toggle on any window 900px or wider, and "Mobile" draws the whole app inside a 390px phone frame. New screens and components must follow the structure that makes that work:

- **Never read the window directly.** Use `useViewport()` from `apps/web/src/hooks/useViewport.tsx` for width and height, not `useWindowDimensions`, `Dimensions` or `window.innerWidth`. The frame tells screens they are 390px wide through that hook; anything reading the window ignores the toggle and shows the desktop layout inside the phone.
- **Every screen has a phone layout and a wide layout**, decided from that width (breakpoints in use: 680 for the date picker, 900 for the shell, household and drawer, 1000 for Places and Trips). Design both before calling a screen done, and check both with the toggle on the Railway deployment, not only on a desktop window.
- **Anything that portals out of the tree (a `Modal`) must pin itself to the frame.** Read `framed` and `origin` from `useViewport()` and position the sheet at that origin with the frame's size, as `VenueDrawer` does; otherwise it covers the whole browser window.
- **Keep one tree shape across layouts.** A screen that returns two different trees for wide and narrow loses its state when the owner flips the toggle. Branch on style and on which children render, not on the whole return.
- **Icons come from one set.** `apps/web/src/components/Icon.tsx` wraps Lucide (`lucide-react-native`); use `<Icon name=…>`, `<CategoryIcon>`, `<IconText>` and `<Rating>`, or the `icon` prop on `Chip` and `Button`. Never an emoji or a symbol character (★ ♥ ✕ ✓ 🎙 📍 …) as an icon; the owner called that embarrassing (3 Sep 2026). Add a name to the set rather than importing a glyph in a screen.
- **Content must fit 390px.** Rows wrap, chips shrink (`Chip` already wraps long labels), and nothing is allowed to overflow the frame horizontally.

## Running

See `README.md`. Postgres is on `localhost:5434` locally because 5432/5433 are used by other projects on the owner's machine.

The rebrand left four things outside the repo still called Roam — the `ROAM_*`
variables in Doppler (aliased for now by `apps/api/src/env.js`), the Railpack
commands on Railway, the Railway project and service names, and a local `.env`.
README › "The rebrand: what is still called Roam" says what each one needs.
