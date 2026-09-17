-- One queue over everything a household made.
--
-- Owner, 17 Sep 2026: "We're definitely going to need a means to be able to
-- filter user-generated content and probably approve them, like photographs,
-- etc., and also reviews."
--
-- One queue with a filter, not a queue per kind — the same act each time:
-- somebody looks and decides. Forty beach photographs can be approved together;
-- **a person's review is never rejected in a batch.** Reported content jumps the
-- queue, because it is on a different clock. Flagged data quality is in here
-- too — the hours three sources disagree about is the same act.
--
-- Two rules from the architecture, stated so they cannot be got wrong:
--   1. The queue only ever holds household-made content and pictures we own. A
--      provider's photograph must never appear in it, and if one does something
--      is wrong upstream.
--   2. The reviewer's trail goes to `admin_audit`, which already exists, rather
--      than to a table of its own.
--
-- The rejection reason is a closed list (domain/contentQueue.js) so the common
-- one can be counted and designed out, and the message the household receives is
-- written next to the button that sends it — held here so what was actually sent
-- can be read back.

create table if not exists content_queue (
  id            uuid primary key default gen_random_uuid(),
  -- photo | review | rating | note | offer | message | data
  kind          text not null,
  -- Where the thing itself lives, so nothing is copied into the queue.
  subject_type  text not null,              -- image | rating | visit | dish_note | host_review | chat_topic | chat_reply | open_entry | place
  subject_id    text not null,
  household_id  uuid references households(id) on delete cascade,
  account_id    uuid references accounts(id) on delete set null,
  maker_label   text,                       -- what to print: "The Hartleys", "M. Osei"
  venue_ref     text,
  place_label   text,
  area_slug     text,
  -- waiting | approved | rejected
  state         text not null default 'waiting',
  -- Reported is a flag rather than a state: a thing can be reported while it is
  -- still waiting, and it has to jump the queue without losing where it was.
  reported      boolean not null default false,
  reported_at   timestamptz,
  reported_by   uuid references accounts(id) on delete set null,
  report_reason text,
  reason        text,                       -- the closed-list key, on a rejection
  message       text,                       -- what was actually sent to the household
  told          boolean not null default false,
  decided_by    text,
  decided_at    timestamptz,
  made_at       timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (subject_type, subject_id)
);
create index if not exists content_queue_state_idx    on content_queue (state, reported desc, made_at);
create index if not exists content_queue_kind_idx     on content_queue (kind, state);
create index if not exists content_queue_area_idx     on content_queue (area_slug, state);
create index if not exists content_queue_ref_idx      on content_queue (venue_ref);
create index if not exists content_queue_reported_idx on content_queue (reported) where reported;

-- How often each closed-list reason is used, so the common one can be designed
-- out rather than argued about. Read straight off `content_queue`, but kept here
-- as a rolling count so the queue can be pruned without losing the lesson.
create table if not exists rejection_counts (
  kind    text not null,
  reason  text not null,
  used    integer not null default 0,
  last_at timestamptz,
  primary key (kind, reason)
);
