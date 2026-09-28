-- Accuracy compares a person's correction with what the machine had said at
-- the moment of the correction, not with whatever it says later (Codex on
-- 6124383, 28 Sep 2026). Its own migration, never an edit to 266, which has
-- already run wherever it has been applied (Codex on 4b1dc43).

-- A person's correction of one place's answer in Facts, with the machine's
-- answer and source as they stood at that moment, so accuracy measures what
-- the machine had said, not whatever it says later (Codex, 28 Sep 2026).
create table if not exists fact_corrections (
  id              uuid primary key default gen_random_uuid(),
  venue_ref       text not null,
  attribute_key   text not null references place_attributes(key) on delete cascade,
  answer          text not null check (answer in ('yes','no')),
  machine_state   text check (machine_state is null or machine_state in ('yes','no','conflict','dont_know')),
  machine_source  text,
  subcategory_key text,
  who             text not null,
  at              timestamptz not null default now()
);
create index if not exists fact_corrections_fact on fact_corrections (attribute_key, at desc);
