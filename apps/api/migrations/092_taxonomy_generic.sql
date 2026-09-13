-- A fifth answer for a provider's word: it is a label, not a subcategory.
--
-- The owner, 13 Sep 2026: "it's just a label called 'tourist attraction', and
-- maybe we should adopt it as a label as opposed to a category. Where we
-- recognise that a Google category is simply a generic label that catches
-- multiple subcategories that span multiple different categories in Epic, we
-- should just create a label for the category and instead surface all the
-- subcategories and map those accordingly."
--
-- `establishment` and `point_of_interest` are on every place Google knows;
-- `tourist_attraction` is on a third of them, beside museum, castle or pier.
-- None of them says what a place is, so none of them can decide where it
-- lands. 'generic' records that the word is understood and carries nothing:
-- the place's own specific words decide. The row stays active, because the
-- label is real and still worth counting — it is only never a mapping.

alter table taxonomy_labels drop constraint if exists taxonomy_labels_decision_check;
alter table taxonomy_labels add constraint taxonomy_labels_decision_check
  check (decision is null or decision in ('aside', 'nearby', 'travel', 'generic'));

-- The other half of his ask: "surface all the subcategories and map those
-- accordingly". For a word marked generic, this counts the specific words of
-- the same source seen on the same place, so the screen can list what a
-- generic word actually catches and offer each one a mapping. Only pairs
-- where one side is generic are kept, so the table stays small.
create table if not exists taxonomy_label_pairs (
  label      text not null,
  other      text not null,
  seen_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (label, other)
);
create index if not exists taxonomy_label_pairs_label on taxonomy_label_pairs (label, seen_count desc);
