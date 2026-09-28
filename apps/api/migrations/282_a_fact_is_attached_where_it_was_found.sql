-- A fact is attached to a subcategory only where it was found (owner, round
-- 3, 29 Sep 2026; C33).
--
-- Migration 266 copied every question set's questions into
-- subcategory_facts as Active links — "what the sets asked is what each
-- drawer already looks for". None of those links was ever confirmed at a
-- single place: on production all 452 links of the 59 non-standard facts had
-- nought places with the fact (GET /api/admin/desk/facts/<key>, 29 Sep 2026),
-- which put Ancient woodland on Beaches & coast and eighteen-hole courses in
-- eight drawers. The screens hid it two different ways: Categories counted
-- only Active links (0 everywhere), Facts counted every link (3–11 each).
--
-- So, never editing 266:
--   1. A link a person asked for is marked (`added_by`), so the machine never
--      detaches it — Copy facts writes it from now on. Nothing before this
--      migration was a person's: Copy facts copies only Active links, and no
--      link had the places to be Active.
--   2. Every machine link with no confirmed place is detached. It is kept
--      whole in subcategory_facts_detached with when and why, so the record
--      of what the old sheets asked is not lost. The facts themselves stay in
--      place_attributes as vocabulary: spot and verify still look for them,
--      and pipeline.add() attaches one where our sources confirm it.
--   3. A link that stays is judged on the count the screens show: Active only
--      at addPlaces (2) or more confirmed places, else Gathering evidence.
--      A person's removal and Include anyway stand, and so does a verdict
--      that the word is an opinion or a condition.
--
-- "Confirmed" is the rule of categories.js CONFIRMED_SQL, written out here as
-- it stands today: the places in Epic filed in the subcategory, primary
-- (place_index.subcategory) or secondary (a Google word the place carries
-- pointing at it as a non-primary target), that have the fact — a person's
-- yes, or our sources' verified yes not hidden, not contradicted by a person
-- and not under a person's Don't know.

alter table subcategory_facts add column if not exists added_by text;

create table if not exists subcategory_facts_detached (
  subcategory_key text not null,
  attribute_key   text not null,
  status          text not null,
  reason          text,
  first_seen      timestamptz,
  active_since    timestamptz,
  verified_places integer,
  detached_at     timestamptz not null default now(),
  why             text not null,
  primary key (subcategory_key, attribute_key, detached_at)
);

create temporary table confirmed_282 on commit drop as
with words as (
  select venue_ref, 'google:' || found_by as label from place_subcategories where found_by is not null
  union
  select venue_ref, 'google:' || found_by from place_index where found_by is not null
  union
  select pi.venue_ref, 'google:' || t from place_index pi, unnest(pi.google_types) t where pi.google_types is not null
  union
  select venue_ref, label from place_index_labels where label like 'google:%'
),
filed as (
  select pi.venue_ref, pi.subcategory as sub
    from place_index pi
   where pi.subcategory is not null and pi.not_in_epic_at is null
  union
  select w.venue_ref, t.subcategory_key
    from words w
    join word_targets t on t.namespace = 'google' and 'google:' || t.word = w.label and not t.is_primary
    join place_index pi on pi.venue_ref = w.venue_ref
   where pi.subcategory is not null and pi.not_in_epic_at is null and pi.subcategory <> t.subcategory_key
),
has as (
  select venue_ref, attribute_key from place_attribute_values
   where set_by is not null and (yesno is true or from_value is not null or choice is not null)
  union
  select venue_ref, attribute_key from place_fact_answers x
   where state = 'yes' and hidden_at is null
     and not exists (select 1 from place_attribute_values v
                      where v.venue_ref = x.venue_ref and v.attribute_key = x.attribute_key
                        and v.set_by is not null and v.yesno is false)
     and not exists (select 1 from fact_unknowns u
                      where u.venue_ref = x.venue_ref and u.attribute_key = x.attribute_key)
)
select f.sub, h.attribute_key, count(distinct h.venue_ref)::int n
  from has h join filed f on f.venue_ref = h.venue_ref
 group by 1, 2;

with gone as (
  delete from subcategory_facts sf
   where sf.status in ('active', 'gathering')
     and not sf.include_anyway
     and sf.added_by is null
     and not exists (select 1 from confirmed_282 c
                      where c.sub = sf.subcategory_key and c.attribute_key = sf.attribute_key and c.n > 0)
  returning sf.*
)
insert into subcategory_facts_detached (subcategory_key, attribute_key, status, reason, first_seen, active_since, verified_places, why)
select subcategory_key, attribute_key, status, reason, first_seen, active_since, verified_places,
       'No confirmed place in the subcategory (migration 282: carried over from the question sets by 266, never found there)'
  from gone;

-- What stays is judged on the count the screens show.
update subcategory_facts sf
   set status = case when c.n >= coalesce((select (value #>> '{}')::int from bo_settings where key = 'addPlaces'), 2)
                     then 'active' else 'gathering' end,
       active_since = case when c.n >= coalesce((select (value #>> '{}')::int from bo_settings where key = 'addPlaces'), 2)
                           then coalesce(sf.active_since, now()) else sf.active_since end,
       verified_places = c.n,
       updated_at = now()
  from confirmed_282 c
 where c.sub = sf.subcategory_key and c.attribute_key = sf.attribute_key
   and sf.status in ('active', 'gathering')
   and not sf.include_anyway;
