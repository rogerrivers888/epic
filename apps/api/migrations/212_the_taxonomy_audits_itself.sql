-- The taxonomy audits itself, and a person signs the audit off.
--
-- The brief, 20 Sep 2026 ("Epic — Taxonomy audit and cleanup"): "Do not fix
-- this by hand, and do not ask a human to review 485 rows. Build the audit: the
-- machine examines every mapping against evidence it already holds, proposes
-- changes with reasons, groups them so like decisions are made together, and a
-- human signs off in bulk."
--
-- Two tables and a memory. A **run** is one pass of the signals. A **proposal**
-- is one suggested change with the evidence behind it. And a **refusal** is
-- remembered against the flag and the subject, because "rejected proposals do
-- not return" and a signal that re-raises what somebody has already said no to
-- is worse than no signal.
create table if not exists taxonomy_audits (
  id           uuid primary key default gen_random_uuid(),
  ran_at       timestamptz not null default now(),
  ran_by       text,
  -- What the run could see. A signal that had no evidence must say so rather
  -- than quietly emitting nothing, or a thin week reads as a clean taxonomy.
  evidence     jsonb not null default '{}'::jsonb,
  applied_at   timestamptz,
  applied_by   text,
  -- Everything the apply changed, enough to put it all back. "A whole applied
  -- audit must be undoable as a single action for at least seven days."
  snapshot     jsonb,
  undone_at    timestamptz
);

create table if not exists taxonomy_proposals (
  id           uuid primary key default gen_random_uuid(),
  audit_id     uuid not null references taxonomy_audits(id) on delete cascade,
  -- nobody_goes | not_visitable | singleton | mixed | orphan | primary_mismatch
  -- | agreed  (section 4 of the brief, already signed off)
  flag         text not null,
  -- What the proposal is about: a provider word, or one of our subcategories.
  subject_kind text not null check (subject_kind in ('word', 'subcategory')),
  subject      text not null,
  subject_label text,
  -- exclude | repoint | fold | split | create | rename | retire | fill | carry
  action       text not null,
  now_value    text,
  proposed     text,
  -- Plain words, and the numbers they came from. "A flag without its evidence
  -- is not reviewable."
  because      text not null,
  numbers      jsonb not null default '{}'::jsonb,
  -- How many places this one proposal moves, for the running total on screen.
  moves        integer not null default 0,
  state        text not null default 'open' check (state in ('open', 'accepted', 'rejected', 'applied')),
  decided_at   timestamptz,
  decided_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists taxonomy_proposals_audit on taxonomy_proposals (audit_id, flag, state);
-- One proposal per subject per flag in a run: a signal that fires twice for the
-- same word is one suggestion, not two.
create unique index if not exists taxonomy_proposals_one
  on taxonomy_proposals (audit_id, flag, subject_kind, subject);

create table if not exists taxonomy_refusals (
  flag         text not null,
  subject_kind text not null,
  subject      text not null,
  proposed     text,
  refused_at   timestamptz not null default now(),
  refused_by   text,
  primary key (flag, subject_kind, subject)
);

comment on table taxonomy_refusals is
  'What a person has already said no to. The signals read this and stay quiet.';
