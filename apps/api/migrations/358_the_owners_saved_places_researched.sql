-- The owner's saved places, researched once, and their pictures reviewed
-- (owner, 2 Oct 2026, "Saved places — photos and enrichment").
--
-- Three tables, none of which holds anything rented:
--
--   saved_place_enrichment  one row per place the owner has added to Places:
--                           where its research has got to, what was found and
--                           on which page, what it cost. Runs once; again only
--                           when the back office asks.
--   venue_site_images       pictures on a venue's own website, kept by address
--                           only — the page, the date, and that there is no
--                           licence. The bytes are the venue's and are not kept.
--   photo_reviews           the owner's verdict on a place's owned pictures,
--                           given beside Google's live ones (back office ›
--                           Photo review). Google's pictures are never stored;
--                           the verdict is ours.

create table if not exists saved_place_enrichment (
  venue_ref       text primary key,
  account_id      uuid,
  household_id    uuid,
  session_id      uuid,
  -- queued → free (the open-source research is running) → claude (the paid
  -- pass is running) → done | failed. `failed` keeps its reason in `error`.
  state           text not null default 'queued'
                  check (state in ('queued', 'free', 'claude', 'done', 'failed')),
  requested_at    timestamptz not null default now(),
  free_done_at    timestamptz,
  claude_done_at  timestamptz,
  last_run_at     timestamptz,
  runs            integer not null default 0,
  -- What the Claude passes have cost, all runs together and the last alone,
  -- in dollars as the ledger records them (provider_calls).
  cost_usd        numeric(10,4) not null default 0,
  last_cost_usd   numeric(10,4),
  -- How many Claude passes were paid for, all runs together, so the average
  -- per pass survives re-runs.
  paid_runs       integer not null default 0,
  -- Field by field: { website: { value, source, sourceUrl, checkedAt }, ... },
  -- facts as { key: { answer, source, sourceUrl, checkedAt } }, and the
  -- pictures each source gave. What the back office draws.
  found           jsonb not null default '{}'::jsonb,
  error           text
);
create index if not exists saved_place_enrichment_state_idx on saved_place_enrichment (state, requested_at);

create table if not exists venue_site_images (
  venue_ref       text not null,
  image_url       text not null,
  page_url        text not null,
  found_how       text,                       -- 'og:image' | 'twitter:image' | 'img'
  found_at        timestamptz not null default now(),
  -- No licence is the starting point and, for now, the only state anything is
  -- in. 'requested' and 'granted' are for the "Get permission" route.
  licence_status  text not null default 'none'
                  check (licence_status in ('none', 'requested', 'granted')),
  primary key (venue_ref, image_url)
);

create table if not exists photo_reviews (
  venue_ref       text primary key,
  verdict         text not null
                  check (verdict in ('owned_fine', 'owned_worse_acceptable', 'owned_not_fit')),
  note            text,
  reviewed_by     uuid,
  reviewed_at     timestamptz not null default now()
);
