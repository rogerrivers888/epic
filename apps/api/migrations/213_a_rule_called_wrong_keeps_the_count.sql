-- "This rule has been called wrong 41 times."
--
-- The owner, 20 Sep 2026, on retiring the What-the-rules-did door and moving
-- the correction onto the row: "One thing to keep from the old tab: the
-- aggregate. 'This rule has been called wrong 41 times' is the single most
-- useful number in the system, and it needs to live somewhere — that's the
-- Rules screen's override column, so make sure the row action feeds it."
--
-- A table rather than a counter on `shelf_rules`, for the reason 2ce422a gives:
-- no number we cannot show the places behind. The count is the rows.
create table if not exists rule_overrides (
  id            uuid primary key default gen_random_uuid(),
  -- The rule that was deciding this place before somebody disagreed. Null when
  -- nothing was: a place sitting where its atlas category put it has no rule to
  -- blame, and that is worth counting separately rather than not at all.
  rule_id       uuid references shelf_rules(id) on delete set null,
  rule_scope    text,
  rule_subject  text,
  venue_ref     text not null,
  venue_label   text,
  from_category    text,
  from_subcategory text,
  to_category      text,
  to_subcategory   text,
  reason        text,
  at            timestamptz not null default now(),
  by            text
);

create index if not exists rule_overrides_rule on rule_overrides (rule_id, at desc);
create index if not exists rule_overrides_ref on rule_overrides (venue_ref);

comment on table rule_overrides is
  'Every time a person moved a place out of where a rule put it. The Rules screen counts these.';
