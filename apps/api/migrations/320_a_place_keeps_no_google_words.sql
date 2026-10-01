-- Google's words for what a place is are rented content and are no longer
-- stored (owner, 1 Oct 2026, item 6). The display path re-derives the
-- subcategory from the 12h working set, and nothing household-facing read this
-- column; `noteMany` no longer writes it (repositories/placeIndex.js). This
-- migration clears what earlier display searches left behind.
--
-- The desk's `place_words` table (migration 281) is a union of found_by,
-- google_types and google: labels, kept exact by triggers. Nulling google_types
-- below fires the place_index update trigger, which recomputes place_words with
-- the now-empty google_types branch — so Mapping, secondary filing, collections
-- and categories drop the rented words in step, and from here on google_types is
-- always null so that branch contributes nothing. No need to redefine the
-- place_words functions, and nothing reads the stored types for a household.
--
-- Dry run on production, 1 Oct 2026: 458 rows / 458 distinct places carried
-- google_types; 0 legacy google:% rows in place_index_labels. The place_words
-- before/after drop is reported by item6-google-types-dryrun.sql.
--
-- Kept, deliberately NOT touched: our own derived vocabulary and rules —
-- taxonomy_labels, shelf_rules, taxonomy_label_carries, word_targets — and the
-- google_types column itself (its back-office readers handle null). The audit's
-- co-occurrence is rebuilt from found_by; primary-mismatch is retired (it needed
-- Google's primary type); the heritage narrowing takes its place-of-worship type
-- signal from found_by.
--
-- The migration runner wraps each file in its own transaction, so no begin/commit here.

-- What the Mapping loses is written down before it goes (owner, 1 Oct 2026:
-- "report the per-word breakdown yourself as part of the push (word and count
-- only, no place IDs)"). An agent has no production read, so the one actor that
-- sees the data at the moment of the clear — this migration — keeps the record:
-- each word whose place_words rows were backed only by google_types, and how
-- many places it loses. Word and count only. Read it any time with
--   select evidence from data_verdicts where key = 'index.google-types-cleared';
insert into data_verdicts (key, question, verdict, evidence, scope, method, decided_by)
select
  'index.google-types-cleared',
  'What did the Mapping lose when the rented google_types column was cleared? (item 6)',
  'cleared',
  jsonb_build_object(
    'rows_nulled', (select count(*) from place_index where google_types is not null),
    'place_words_before', (select count(*) from place_words),
    'vanishing_total', (select count(*) from place_words pw
       where not exists (select 1 from place_subcategories s
                          where s.venue_ref = pw.venue_ref and 'google:' || s.found_by = pw.label)
         and not exists (select 1 from place_index pi
                          where pi.venue_ref = pw.venue_ref and 'google:' || pi.found_by = pw.label)
         and not exists (select 1 from place_index_labels l
                          where l.venue_ref = pw.venue_ref and l.label = pw.label)),
    'vanishing_by_word', coalesce((
       select jsonb_agg(jsonb_build_object('word', w.word, 'places', w.n) order by w.n desc, w.word)
         from (
           select substr(pw.label, 8) as word, count(*) as n
             from place_words pw
            where not exists (select 1 from place_subcategories s
                               where s.venue_ref = pw.venue_ref and 'google:' || s.found_by = pw.label)
              and not exists (select 1 from place_index pi
                               where pi.venue_ref = pw.venue_ref and 'google:' || pi.found_by = pw.label)
              and not exists (select 1 from place_index_labels l
                               where l.venue_ref = pw.venue_ref and l.label = pw.label)
            group by 1) w), '[]'::jsonb)),
  'place_index',
  'the vanish test of item6-google-types-dryrun.sql, run at apply time by this migration',
  'migration 320'
on conflict (key) do nothing;

update place_index set google_types = null where google_types is not null;

delete from place_index_labels where label like 'google:%';
