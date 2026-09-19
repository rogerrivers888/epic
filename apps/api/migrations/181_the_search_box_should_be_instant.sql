-- The area and place search box, which took sixteen seconds.
--
-- The owner, 19 Sep 2026: "when I search for SL5, it's very, very slow to bring
-- up the search box… about 40 seconds later, it brought up this view. Why is it
-- taking so long? It should be absolutely instant."
--
-- Two faults, and this is the half that belongs in the database. Every name
-- source is matched with `ilike '%…%'`, which no ordinary index can serve, so
-- each keystroke was a sequential scan of `place_index` joined to three name
-- tables. A common prefix hit the row limit early and felt fine; a rare one —
-- "sunn", "sl5" — had to read everything before it could say how little there
-- was. The rarer the word, the longer the wait, which is exactly backwards.
--
-- Trigram indexes are what make a substring match indexable. Guarded like
-- migration 102: `pg_trgm` needs rights an ordinary role may not have on a
-- managed database, and a search that is merely slow must never be the reason a
-- deploy fails. Without the extension every one of these is skipped and the
-- query still answers — the other half of the fix, which is the query's shape,
-- stands on its own.
do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm not available; the place search will scan instead';
end;
$$;

do $$
begin
  create index if not exists place_records_name_trgm_idx on place_records using gin (name gin_trgm_ops);
  create index if not exists attractions_name_trgm_idx   on attractions   using gin (name gin_trgm_ops);
  create index if not exists scout_places_name_trgm_idx  on scout_places  using gin (name gin_trgm_ops);
  create index if not exists localities_name_trgm_idx    on localities    using gin (name gin_trgm_ops);
  create index if not exists localities_slug_trgm_idx    on localities    using gin (slug gin_trgm_ops);
exception when others then
  raise notice 'trigram indexes not created; the place search will scan instead';
end;
$$;

-- The join `attractions` was reached through — `a.venue_ref = pi.venue_ref or
-- 'atlas:' || a.id::text = pi.venue_ref` — cannot use an index on either side,
-- so it was a nested loop over the whole index however the names were matched.
-- The query no longer joins that way; this is for the half of the atlas that is
-- keyed by its own id.
create index if not exists attractions_venue_ref_idx on attractions (venue_ref) where venue_ref is not null;
