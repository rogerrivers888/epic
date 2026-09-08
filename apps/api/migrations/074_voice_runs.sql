-- The voice experiment's ledger: one row per utterance run through the ways of
-- hearing it (owner's brief, 8 Sep 2026: "build record-then-send, realtime and
-- streamed-file behind a switch, and compare them on the same utterances").
--
-- **What is kept, and what deliberately is not.** The transcripts — the
-- household's own words, which are theirs to keep — the time each mode took,
-- the word error rate against the sentence they were reading, how far the
-- live captions and the full recording disagreed, and whether that
-- disagreement changed the extracted plan. **Never the audio.** A recording is
-- sent to the provider and forgotten in the same request (Requirements C7, and
-- Technical Constraints §15 L8 on bystander audio); nothing about this table
-- gives it anywhere to land.

create table if not exists voice_runs (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid references households(id) on delete cascade,
  session_id      text,

  -- Which sentence from the lab's list, or null for free speech.
  utterance_id    text,
  -- What they were asked to read, verbatim, so a run can be judged later.
  reference       text,
  -- The language the run was made in, if set or detected.
  language        text,
  -- Which mode the app was set to at the time — the one a household would
  -- have been using — as against the lab, which always runs every mode.
  mode            text,

  -- Per mode: { transcript, ms, model, error }. Keys: live, batch, stream.
  results         jsonb not null default '{}',
  -- Per mode: word error rate against the reference, when there was one.
  accuracy        jsonb not null default '{}',
  -- How far the captions were from the recording: WER of live against batch.
  live_vs_batch   real,

  -- Stage two, per mode: the extracted intent from that mode's transcript.
  plans           jsonb not null default '{}',
  -- Whether the disagreement between live and batch changed the plan, and where.
  plan_changed    boolean,
  plan_diff       jsonb not null default '[]',

  -- What the household changed the transcript to before planning, if they did.
  edited          text,
  -- The browser and its recording container, because Safari and Chrome are
  -- two different microphones.
  device          text,
  ran_by          text,
  created_at      timestamptz not null default now()
);
create index if not exists voice_runs_created_idx on voice_runs (created_at desc);
create index if not exists voice_runs_household_idx on voice_runs (household_id, created_at desc);
