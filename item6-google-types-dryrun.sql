-- Item 6 dry run — READ ONLY (SELECT only, no writes, no temp tables).
-- Paste into Railway › Postgres › Query — ONE GRID PER PASTE: the Query tab
-- executes a single statement, so pasting both together ran Grid 1 and silently
-- skipped Grid 2 (observed 1 Oct 2026; the like 'google:%' filter was fine —
-- Grid 1's equality checks matched 453,255 prefixed labels on the same run).
-- Migration 320 also records Grid 2's vanish breakdown (word and count only) in
-- data_verdicts under 'index.google-types-cleared' at the moment it clears.
--
-- The real back-office Mapping (desk/mapping.js) reads the `place_words` table
-- (migration 281): rows are found_by UNION google_types UNION google: labels.
-- Stopping storage of google_types drops that part of every count. This measures
-- it. The found_by part and our own vocabulary/rules are kept — each "KEPT" row
-- below is the query that proves it.

-- Grid 1 — what clears, the place_words before/after, and what is kept.
select 1 as ord, 'place_index rows with google_types  (NULLed)' as metric,
       (select count(*) from place_index where google_types is not null)::text as value
union all select 2, 'distinct places with google_types',
       (select count(distinct venue_ref) from place_index where google_types is not null)::text
union all select 3, 'legacy google:% rows in place_index_labels  (DELETED)',
       (select count(*) from place_index_labels where label like 'google:%')::text
union all select 4, 'places feeding back-office Audit flags  (lose that input)',
       (select count(*) from place_index where google_types is not null and cardinality(google_types) > 0)::text
union all select 5, 'place_words rows TODAY  (Mapping, before)',
       (select count(*) from place_words)::text
union all select 6, 'place_words rows backed ONLY by google_types  (VANISH)',
       (select count(*) from place_words pw
         where not exists (select 1 from place_subcategories s
                            where s.venue_ref = pw.venue_ref and 'google:' || s.found_by = pw.label)
           and not exists (select 1 from place_index pi
                            where pi.venue_ref = pw.venue_ref and 'google:' || pi.found_by = pw.label)
           and not exists (select 1 from place_index_labels l
                            where l.venue_ref = pw.venue_ref and l.label = pw.label))::text
union all select 7, 'place_words rows AFTER  (found_by + labels, Mapping after)',
       (select count(*) from place_words pw
         where exists (select 1 from place_subcategories s
                        where s.venue_ref = pw.venue_ref and 'google:' || s.found_by = pw.label)
            or exists (select 1 from place_index pi
                        where pi.venue_ref = pw.venue_ref and 'google:' || pi.found_by = pw.label)
            or exists (select 1 from place_index_labels l
                        where l.venue_ref = pw.venue_ref and l.label = pw.label))::text
union all select 8, 'taxonomy_labels google words  (KEPT, not touched)',
       (select count(*) from taxonomy_labels where namespace = 'google')::text
union all select 9, 'taxonomy_label_carries google  (KEPT, not touched)',
       (select count(*) from taxonomy_label_carries where namespace = 'google')::text
union all select 10, 'shelf_rules carrying google: labels  (KEPT, not touched)',
       (select count(*) from shelf_rules where labels::text like '%google:%')::text
order by ord;

-- Grid 2 — the 25 Mapping words that lose the most places: today, after, drop.
select substr(pw.label, 8) as word,
       count(*) as places_today,
       count(*) filter (
         where exists (select 1 from place_subcategories s
                        where s.venue_ref = pw.venue_ref and 'google:' || s.found_by = pw.label)
            or exists (select 1 from place_index pi
                        where pi.venue_ref = pw.venue_ref and 'google:' || pi.found_by = pw.label)
       ) as places_after,
       count(*) - count(*) filter (
         where exists (select 1 from place_subcategories s
                        where s.venue_ref = pw.venue_ref and 'google:' || s.found_by = pw.label)
            or exists (select 1 from place_index pi
                        where pi.venue_ref = pw.venue_ref and 'google:' || pi.found_by = pw.label)
       ) as drop
  from place_words pw where pw.label like 'google:%'
 group by pw.label order by drop desc limit 25;
