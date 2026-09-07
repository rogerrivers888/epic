-- Who takes the money is a fact about the thing being paid for, not about the
-- group (owner, 7 Sep 2026: "the only thing that's new there seems to be the
-- 'straight to you' or 'Roam collects', which I should be doing on the event
-- level when I'm creating the event"). The group keeps its own setting as the
-- default a new cost is created with; each cost may then differ.
alter table group_items
  add column if not exists payment_mode text;   -- null = follow the group's
