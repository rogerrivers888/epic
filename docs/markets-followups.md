# Markets — follow-ups raised by the place-page batch (30 Sep 2026)

Three pieces were surfaced by increment 4 (the place page: cost scale, Google Maps
attribution, description credit) and deliberately left out of it. Each is written up
here to be decided and built on its own, not as a side effect of the place page.

## 1. Per-place country — the data-policy question (decide before building)

**What.** The cost scale reads a place's currency and money bands from its *market*,
which is chosen by country. Country in this system is an **area-level** fact: a trip's
destination, the searched area, the atlas city. No *place* carries its own country. So
the drawer is given the area's country, which is correct for every single-area context
— and wrong only when one search spans a national border. Codex's worked example: an
Inspire search ring on the Northern Ireland side returns venues in the Republic, and
those are costed in GBP instead of EUR.

**Why it was held.** Giving each place its own country means either reverse-geocoding
every result (a call per place, and against "prefer search over detail") or storing a
country per place. The data policy (V1 law) keeps a place's `lat`/`lng` for **30 days**
and stores no other location fact. A per-place country that outlives the coordinates it
was derived from is a new stored location fact, and that is the policy question — it
cannot be answered inside an attribution fix.

**Where to look first.** The obvious candidates, both of which already run at a moment
we are allowed to know where a place is:

- **The census / `place_index`.** A place is first written with the area (outcode,
  slice) that found it. The *area* has a country. If the index recorded the country of
  the slice alongside the place — a fact about the *area we searched*, not new precision
  about the place — that is arguably within policy (it is no finer than the outcode we
  already keep) and is permanent, which per-place country needs to be.
- **The first display search.** Coordinates and Google types are written the first time
  a place is returned to a household (data policy). The country could be written then,
  from the same reverse-geocode the coordinates imply — but it must then survive the
  30-day coordinate expiry to be useful, which is exactly the question.

**The decision to take:** may a place keep a country code past the 30-day coordinate
window, and if so, is it the *area's* country (cheap, permanent, coarse — a place near a
border could be filed to the wrong side) or the *place's own* (needs a geocode, finer,
and is the new stored fact the policy guards)? Recommendation to open with: the area's
country from the census, because it stores nothing the outcode does not already imply.

**Until then** the drawer uses the area country and fails safe: a cross-border result
reads the search area's currency, never crashes, and a place with no usable Google price
level still reads "not known yet".

## 2. Should Google's editorial summary be shown as a description? (held commit)

**What changed, and what was held.** `sources/google.js` fills `venue.summary` from
Google's `editorialSummary`, and the drawer has always rendered it as the place's
description. The data policy reads rented text (review and editorial summaries) **in
memory for vocabulary only** and does not display it, so showing it is arguably a
pre-existing policy fault — one the new description credit exposed, because the credit
has no source to name for Google prose. A commit that **suppressed** it (showing the
owned summary — Wikipedia, the venue's page, the atlas — or nothing) was built and then
**held out of the place-page batch** at the owner's instruction: it is a visible change
to what customers see, it was not asked for, and the description-display decision should
be the owner's, made on its own.

**What a place shows today (unchanged by the batch):** the detail's summary if it has
one (which is Google's editorial for a Google place), else the card's.

**What the held change would do:** where a Google editorial used to show, the place would
show its **owned** summary if it has one, and **no description** if it does not.

**The blast radius is not measurable from stored data.** Google's editorial summary is
never stored (fetched on open, shown in memory, discarded), so there is no record of
which places had one. The exact "goes blank" count would need a paid detail call per
place. From the model: atlas/OSM places are unaffected; only a Google-sourced place with
an editorial **and** no owned summary goes blank; Google writes editorials for a small
minority (notable places), which nearly all also carry a Wikipedia article we hold as an
owned summary; and the description already *preferred* Google's over the owned one, so for
many places the change is an improvement (the place shows its own, correctly credited)
rather than a loss.

**The decision to take:** do we suppress Google's editorial as the data policy implies,
accepting that a Google-only place with no owned prose shows no description — or do we
keep showing it, and if so, with what attribution? The suppression is ready in this
file's history (the `notGoogle`-per-source form of `shownSummary` in `VenueDrawer.tsx`);
re-enabling it is reverting the hold.

## 3. Provenance and country need threading through every drawer caller (a note)

The place-page review ran **nineteen** times, and almost every pass found the same two
fields missing on one more surface: a merged place's per-field **`provenance`** (so a
place matched across OpenStreetMap and Google reads its Google price/rating as Google's,
not as its OSM identity), and the place's **country** (for the cost currency and bands).

They are now threaded through every path: on the server, search, detail,
`/api/trips/:id/along`, the options pool (`richFields`), the Inspire builders, and the
Inspire headline (`bestNameMatch`); on the client, every `BrowseItem` converter
(`asDrawerItem`, `asItem`, `alongToItem`, `cardToItem`, `openDetail`) carries provenance,
and all nine `VenueDrawer` callers pass a country.

**The lesson for the next feature:** any new screen that opens a `VenueDrawer`, and any
new server payload that builds a `BrowseItem`, has to carry `provenance` and be given a
country, or the cost and attribution silently fall back (to "not known yet", and to the
home market). This is ad-hoc across ~a dozen sites today. The next feature that adds a
drawer surface will hit it again; a single shared `toBrowseItem` serializer (server) and
a required `country` on the drawer's own resolution would close it for good.
