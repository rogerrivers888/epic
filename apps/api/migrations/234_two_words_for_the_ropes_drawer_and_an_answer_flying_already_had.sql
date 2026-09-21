-- Two words for High ropes & zip lines, and the answer Flying already had.
--
-- Migration 233 worked the five empty drawers against OpenStreetMap and closed
-- three of them. It left Flying & skydiving and High ropes & zip lines with
-- nothing, on the stated grounds that "no vocabulary we hold has a word for
-- them". That is right about zip lines and wrong about the drawer: we hold two
-- words for it, and both were sitting unanswered in the not-sure queue.
--
--   · `google:adventure_sports_center` is a real Table A type, in the
--     Entertainment and Recreation group, and askable — it is not in
--     `NOT_ASKABLE`. In Britain it is overwhelmingly the aerial-adventure kind
--     of place: Go Ape and its imitators.
--   · `osm:leisure=adventure_park` is the open map's word for the same thing,
--     and we already hold it.
--
-- Neither brings in a single place today. That is the whole reason this has to
-- land before the census rather than after it: the census slices Text Search
-- per Google type per drawer, reading `shelf_rules`, so a drawer with no type
-- generates no query and comes back nought — and nought is indistinguishable
-- from "there are none in the south of England". Mapped afterwards, every
-- place the census found would have to be found again.
--
-- `adventure_sports_center` is the broader of the two and is worth watching.
-- An adventure sports centre can be a climbing wall or a watersports lake as
-- easily as a ropes course, so this may want narrowing once the census has run
-- and there is something to look at. It is mapped rather than left out because
-- an empty drawer is a mapping gap that hides, and a slightly wide one is a
-- mapping gap that shows — on the Mapping screen, as places nobody opens.
--
-- Climbing & bouldering, Rowing/paddling/sailing and Water skiing &
-- wakeboarding get nothing here and want nothing: Google's Table A has no word
-- for any of them, checked against the published list. They are filled by 233's
-- OSM tags and asked about by the census's own word-questions, which fence a
-- real type with the words that narrow it.

insert into shelf_rules (scope, subject, subject_label, subcategory, labels, weights, taught_by, reason)
values
  ('labels', 'google:adventure_sports_center', 'Adventure sports center', 'ropes',
   array['google:adventure_sports_center'], '{}'::jsonb, 'Epic',
   'Google''s nearest word for an aerial adventure course. Broad — watch what it brings.'),
  ('labels', 'osm:leisure=adventure_park', 'Adventure park', 'ropes',
   array['osm:leisure=adventure_park'], '{}'::jsonb, 'Epic',
   'The open map''s word for the same thing, and the narrower of the two.')
    on conflict (scope, subject) do update
       set subcategory = excluded.subcategory, labels = excluded.labels, updated_at = now();

-- The label has to agree with the rule, or the Mapping screen says one thing
-- while the taxonomy does another.
update taxonomy_labels
   set points_at = 'ropes', decision = null
 where namespace = 'google' and key = 'adventure_sports_center';

update taxonomy_labels
   set points_at = 'ropes', decision = null
 where namespace = 'osm' and key = 'leisure=adventure_park';

-- Flying & skydiving already had three words and did not know it.
--
-- `airstrip`, `heliport` and `aircraft_rental_service` carry `labels` rules
-- filing places into Flying & skydiving, and at the same time their labels were
-- answered `aside` — Not in Epic. Both are true in the tables and they cannot
-- both be true on a screen: Mapping reads the answer and would have shown three
-- words as excluded while places went on arriving in the drawer behind them.
--
-- The rules are the older and the more considered of the two, so the answer
-- follows the rules rather than the other way about. Nothing is unexcluded that
-- was not already filing.
update taxonomy_labels
   set points_at = 'flying', decision = null
 where namespace = 'google'
   and key in ('airstrip', 'heliport', 'aircraft_rental_service')
   and exists (
     select 1 from shelf_rules r
      where r.subcategory = 'flying' and r.scope = 'labels'
        and ('google:' || taxonomy_labels.key) = any(r.labels));
