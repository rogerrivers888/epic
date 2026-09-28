-- The Google words each place carries, kept as a table (owner, round 3, 29 Sep
-- 2026: "the tabs take a long time to load").
--
-- desk/words.js PLACE_WORDS was a four-way union worked out on every read —
-- the census word that found the place on place_subcategories and on
-- place_index, each of place_index.google_types, and any google: label in
-- place_index_labels — sorted and de-duplicated across the whole index. The
-- desk reads it on Mapping, Categories, Facts, Collections and Overview, and
-- more than once a page: about a quarter of a second each time on the dev
-- database, and several seconds on production's, where surfaced places carry
-- their Google types.
--
-- The table holds exactly what the union returns, and is kept exact on every
-- write by statement-level triggers on the three sources: for each place a
-- statement touched, its rows are deleted and worked out again from the
-- sources. Nothing is cached and nothing has an age: a read sees what the
-- union would have returned in the same transaction. Only identifiers are
-- held — a place's ref and a Google type or census word, which the census
-- already keeps (CLAUDE.md, data policy).

-- No foreign key to place_index: a census statement rewriting forty thousand
-- places' types would check each of 150,000 rows against it one by one (four
-- of the five seconds such a statement took). Every row is written only where
-- the place is in place_index, and a place leaving it takes its words with it
-- (the delete trigger below).
create table place_words (
  venue_ref text not null,
  label     text not null,
  primary key (venue_ref, label)
);
create index place_words_label_idx on place_words (label);

-- Work out the words of these places again from the sources. A place no
-- longer in place_index has none (a cascade from its delete into a source
-- table fires that table's trigger after the index row is gone).
create function place_words_refresh(refs text[]) returns void
language plpgsql as $$
begin
  if refs is null or cardinality(refs) = 0 then return; end if;
  -- Only what changed is written: the words these places should have now,
  -- less what they already have, in; what they have and should not, out.
  -- Each source is joined to the list on its own key rather than asked
  -- `= any(refs)`: a census statement can touch forty thousand places.
  with want as materialized (
    select w.venue_ref, w.label from (
      select s.venue_ref, 'google:' || s.found_by as label
        from unnest(refs) r(venue_ref) join place_subcategories s on s.venue_ref = r.venue_ref where s.found_by is not null
      union
      select pi.venue_ref, 'google:' || pi.found_by
        from unnest(refs) r(venue_ref) join place_index pi on pi.venue_ref = r.venue_ref where pi.found_by is not null
      union
      select pi.venue_ref, 'google:' || t
        from unnest(refs) r(venue_ref) join place_index pi on pi.venue_ref = r.venue_ref, unnest(pi.google_types) t
       where pi.google_types is not null
      union
      select l.venue_ref, l.label
        from unnest(refs) r(venue_ref) join place_index_labels l on l.venue_ref = r.venue_ref where l.label like 'google:%'
    ) w
    where exists (select 1 from place_index p where p.venue_ref = w.venue_ref)
  ),
  gone as (
    delete from place_words w using unnest(refs) r(venue_ref)
     where w.venue_ref = r.venue_ref
       and not exists (select 1 from want where want.venue_ref = w.venue_ref and want.label = w.label)
  )
  insert into place_words (venue_ref, label)
  select venue_ref, label from want
   where not exists (select 1 from place_words w where w.venue_ref = want.venue_ref and w.label = want.label)
  on conflict do nothing;
end $$;

-- place_index: a new place with a word, or a place whose census word or Google
-- types changed. The census touches last_seen on thousands of rows a run;
-- those are compared and skipped.
create function place_words_on_index_insert() returns trigger language plpgsql as $$
begin
  perform place_words_refresh(array(
    select venue_ref from new_rows where found_by is not null or google_types is not null));
  return null;
end $$;
create function place_words_on_index_update() returns trigger language plpgsql as $$
begin
  perform place_words_refresh(array(
    select n.venue_ref from new_rows n
     where not exists (select 1 from old_rows o
                        where o.venue_ref = n.venue_ref
                          and o.found_by is not distinct from n.found_by
                          and o.google_types is not distinct from n.google_types)
    union
    select o.venue_ref from old_rows o
     where not exists (select 1 from new_rows n where n.venue_ref = o.venue_ref)));
  return null;
end $$;
create trigger place_words_index_insert after insert on place_index
  referencing new table as new_rows for each statement execute function place_words_on_index_insert();
create trigger place_words_index_update after update on place_index
  referencing old table as old_rows new table as new_rows for each statement execute function place_words_on_index_update();
create function place_words_on_index_delete() returns trigger language plpgsql as $$
begin
  delete from place_words w using old_rows o where w.venue_ref = o.venue_ref;
  return null;
end $$;
create trigger place_words_index_delete after delete on place_index
  referencing old table as old_rows for each statement execute function place_words_on_index_delete();

-- place_subcategories: any row with a census word, arriving, changing or going.
create function place_words_on_subs_insert() returns trigger language plpgsql as $$
begin
  perform place_words_refresh(array(select distinct venue_ref from new_rows where found_by is not null));
  return null;
end $$;
create function place_words_on_subs_update() returns trigger language plpgsql as $$
begin
  perform place_words_refresh(array(
    select venue_ref from new_rows where found_by is not null
    union select venue_ref from old_rows where found_by is not null));
  return null;
end $$;
create function place_words_on_subs_delete() returns trigger language plpgsql as $$
begin
  perform place_words_refresh(array(select distinct venue_ref from old_rows where found_by is not null));
  return null;
end $$;
create trigger place_words_subs_insert after insert on place_subcategories
  referencing new table as new_rows for each statement execute function place_words_on_subs_insert();
create trigger place_words_subs_update after update on place_subcategories
  referencing old table as old_rows new table as new_rows for each statement execute function place_words_on_subs_update();
create trigger place_words_subs_delete after delete on place_subcategories
  referencing old table as old_rows for each statement execute function place_words_on_subs_delete();

-- place_index_labels: only its google: labels are words.
create function place_words_on_labels_insert() returns trigger language plpgsql as $$
begin
  perform place_words_refresh(array(select distinct venue_ref from new_rows where label like 'google:%'));
  return null;
end $$;
create function place_words_on_labels_update() returns trigger language plpgsql as $$
begin
  perform place_words_refresh(array(
    select venue_ref from new_rows where label like 'google:%'
    union select venue_ref from old_rows where label like 'google:%'));
  return null;
end $$;
create function place_words_on_labels_delete() returns trigger language plpgsql as $$
begin
  perform place_words_refresh(array(select distinct venue_ref from old_rows where label like 'google:%'));
  return null;
end $$;
create trigger place_words_labels_insert after insert on place_index_labels
  referencing new table as new_rows for each statement execute function place_words_on_labels_insert();
create trigger place_words_labels_update after update on place_index_labels
  referencing old table as old_rows new table as new_rows for each statement execute function place_words_on_labels_update();
create trigger place_words_labels_delete after delete on place_index_labels
  referencing old table as old_rows for each statement execute function place_words_on_labels_delete();

-- A truncate of a source leaves nothing to compare row by row: start again.
create function place_words_rebuild() returns trigger language plpgsql as $$
begin
  delete from place_words;
  insert into place_words (venue_ref, label)
  select venue_ref, label from (
    select venue_ref, 'google:' || found_by as label from place_subcategories where found_by is not null
    union
    select venue_ref, 'google:' || found_by from place_index where found_by is not null
    union
    select pi.venue_ref, 'google:' || t from place_index pi, unnest(pi.google_types) t where pi.google_types is not null
    union
    select venue_ref, label from place_index_labels where label like 'google:%'
  ) w
  where exists (select 1 from place_index p where p.venue_ref = w.venue_ref);
  return null;
end $$;
create trigger place_words_subs_truncate after truncate on place_subcategories
  for each statement execute function place_words_rebuild();
create trigger place_words_labels_truncate after truncate on place_index_labels
  for each statement execute function place_words_rebuild();
create trigger place_words_index_truncate after truncate on place_index
  for each statement execute function place_words_rebuild();

-- And fill it once, from what is there now.
insert into place_words (venue_ref, label)
select venue_ref, label from (
  select venue_ref, 'google:' || found_by as label from place_subcategories where found_by is not null
  union
  select venue_ref, 'google:' || found_by from place_index where found_by is not null
  union
  select pi.venue_ref, 'google:' || t from place_index pi, unnest(pi.google_types) t where pi.google_types is not null
  union
  select venue_ref, label from place_index_labels where label like 'google:%'
) w
where exists (select 1 from place_index p where p.venue_ref = w.venue_ref)
on conflict do nothing;

analyze place_words;
