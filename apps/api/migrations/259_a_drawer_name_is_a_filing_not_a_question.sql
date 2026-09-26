-- A drawer name is a filing, not a question (C24); and one word was already
-- asked everywhere.
--
-- The owner, 26 Sep 2026, approving the alias plan across the 87 promotable
-- words: "the nine drawer-name words become also_in secondary filings" — a
-- place that has a lake is *also in* Water; it is not answering yes to a
-- question about lakes. So a candidate can now be decided as a **filing**: a
-- fourth kind, with the drawer it files under, sitting resolved beside the
-- conditions and opinions. It is a decision about the word, kept where the
-- word is; the place-level filing itself is enrichment's to make when it
-- reads a place, and is not made here.
--
-- "Dining area" (pubs-bars, 3 of 20) is `food-on-site` said another way, and
-- food-on-site is asked of everything. So the wording becomes an alias of the
-- global label — the resolver then meets "dining area" and answers
-- food-on-site — and the candidate is recorded as promoted to that question
-- rather than left in a drawer with no sheet.

alter table harvest_candidates drop constraint if exists harvest_candidates_kind_check;
alter table harvest_candidates
  add constraint harvest_candidates_kind_check
  check (kind in ('feature', 'condition', 'opinion', 'unclear', 'filing'));

alter table harvest_candidates
  add column if not exists files_under text references shelf_subcategories (key) on delete set null;

comment on column harvest_candidates.files_under is
  'For kind = filing: the drawer this word files a place under (C24). A decision about the word; the place-level filing is made at enrichment.';

insert into attribute_aliases (norm, target_key, raw)
values ('dining area', 'food-on-site', 'Dining area')
on conflict (norm) do nothing;

update harvest_candidates c
   set status = 'promoted',
       question_id = (select id from questions where attribute_key = 'food-on-site' and scope = 'global' limit 1),
       decided_by = 'the owner', decided_at = now(), examples = '{}'
 where c.norm = 'dining area' and c.subcategory = 'pubs-bars' and c.status = 'new';
