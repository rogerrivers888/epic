-- The purge of stored provider names is written down (owner, 1–2 Oct 2026:
-- "Clear all stored provider-ref labels … logged"; "file the purge as an
-- Approval card … for me to click"; "no stored provider names anywhere").
--
-- One row per run: who ran it (the owner, through the approval he clicked),
-- what the quote said when the card was filed, and what each store actually
-- held and gave up. The names themselves are never written here — only counts.
create table if not exists stored_name_purges (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  by           text,
  expected     integer,                 -- the total the approval card quoted
  cleared      integer not null,        -- the total actually cleared
  by_store     jsonb not null,          -- { "visits.venue_label": 2, … }
  note         text
);
create index if not exists stored_name_purges_at_idx on stored_name_purges (at desc);
