-- Undo, done properly.
--
-- The prototype has an Undo beside every change and the screen had none. The
-- first attempt put it in the browser: remember the word's old answer and send
-- it back. Codex took that apart in three places (15 Sep 2026) and was right
-- every time --
--
--   * the old answer is often *no answer*, and the batch endpoint refuses an
--     item with neither a decision nor a subcategory, so Undo failed silently
--     for every word Approve-all had touched, which is most of them;
--   * deciding a word generic deletes every combination rule naming it, and
--     nothing in the browser has those rules to give back;
--   * the browser cannot know what else the write touched.
--
-- So the change itself writes down what it is about to undo. One row per batch,
-- holding the labels' own rows before they were touched, the rules it deleted
-- and the rules it made. Restoring is putting all three back.
create table if not exists taxonomy_undo (
  id         uuid primary key default gen_random_uuid(),
  made_at    timestamptz not null default now(),
  by         text,
  -- { labels: [{namespace,key,decision,points_at}],
  --   deleted: [<whole shelf_rules rows>],
  --   made: [<rule ids this batch created>] }
  snapshot   jsonb not null,
  undone_at  timestamptz
);

-- Only the last few are ever offered, and an hour is longer than anybody's
-- memory of what they just pressed.
create index if not exists taxonomy_undo_recent_idx on taxonomy_undo (made_at desc) where undone_at is null;
