-- Which place at a provider is the place in our atlas.
--
-- The atlas identifies a place by Wikidata or OpenStreetMap, because those are
-- open, permanent and ours to keep. A provider identifies the same place by its
-- own id, and until now nothing joined the two — so an attraction opened from
-- Inspire could never show a rating or a review, however many the provider had
-- (owner, 7 Sep 2026: "for activities, get the reviews always from Google").
--
-- What may be stored here is the *identifier* and nothing else. Google's terms
-- allow a place id to be kept indefinitely and allow nothing else to be kept at
-- all; the rating, the review text and the author are rented and stay rented,
-- fetched at display time and held only in memory (Technical Constraints §4).
-- The single fact recorded here is "these two names are the same place", which
-- is ours to have worked out.
--
-- It exists so the match is made once rather than on every open. A resolution
-- is two billable calls — a text search to find it, then the detail — and after
-- this it is one, for as long as the place exists.

create table if not exists provider_matches (
  -- The atlas's own identifier: 'wikidata:Q123', 'osm:node/456'.
  venue_ref     text primary key,
  -- The provider and its id for the same place: 'google', 'ChIJ…'.
  source        text not null,
  source_ref    text not null,
  -- How sure we were, 0–1, and what it was matched on. Kept so a bad match can
  -- be found and cleared rather than argued about: a wrong id here would put
  -- another restaurant's reviews on a castle.
  confidence    real not null default 0,
  matched_on    text,
  -- How far the provider's coordinates were from ours, in metres. The other
  -- half of the guard: two places can share a name a county apart.
  metres        integer,
  matched_at    timestamptz not null default now(),
  -- A search that found nothing is a fact worth keeping too, or every open of
  -- an unmatched place buys the same empty search again.
  missing       boolean not null default false
);

create index if not exists provider_matches_source_idx on provider_matches (source, source_ref);
