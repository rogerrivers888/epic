-- A spoken request, read into facts (voice intake handoff, 8 Sep 2026).
--
-- One row per time somebody told Epic what they wanted: the facts stage two
-- read out of the words, the chips they tapped to correct them, the answers to
-- the one or two questions that were asked, and where it led (a trip, or a
-- results page). The household never proof-reads a transcript, so no
-- transcript is kept here — and no audio anywhere, ever.
--
-- A row is what makes the fact card and the results chip row addressable
-- (/say/<id>, /inspire?intake=<id>): a link shared two layers in opens the
-- same facts, which is the rule for every page (Technical Constraints §13.14).

create table if not exists voice_intakes (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  session_id    text,
  -- Which door: first (Option C/B), returning (Option R), inspire (the ask row).
  flow          text not null default 'first',
  -- How the words arrived: said, steps (the wizard), typed.
  mode          text not null default 'said',
  language      text,
  facts         jsonb not null default '{}',
  -- Taps on chips: slot → value, written over the facts.
  overrides     jsonb not null default '{}',
  -- Answers to gap questions: slot → value, or null for "skipped".
  answers       jsonb not null default '{}',
  -- The words as understood, in one line, for the results title (R5b).
  asked         text,
  trip_id       uuid references trips(id) on delete set null,
  harvested_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists voice_intakes_household_idx on voice_intakes (household_id, created_at desc);

-- How the household usually travels on a day out (set-up step 2, "Usually by").
-- The range beside it already exists as max_travel_minutes.
alter table households add column if not exists travel_mode text;
