-- A third answer for a provider's word: "useful nearby".
--
-- The owner, 13 Sep 2026: "parking is actually something we might want to
-- show in the app… you might want to ask where to park, and free parking is
-- also a really useful thing." So a Google subcategory is not only "one of
-- ours" or "not a day out": it can be a thing worth knowing about beside a
-- day out — a car park, a station, a loo — without being one.
--
-- `decision` records the two decisions that are not a rule: 'aside' (not a
-- day out) and 'nearby' (useful beside one). `active` keeps meaning what it
-- did — false is aside — so nothing reading it changes.

alter table taxonomy_labels add column if not exists decision text
  check (decision is null or decision in ('aside', 'nearby'));
update taxonomy_labels set decision = 'aside' where active = false and decision is null;
