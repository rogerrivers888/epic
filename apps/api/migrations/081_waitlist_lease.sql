-- A send in progress holds a short lease (Codex, 12 Sep 2026). Telling a
-- guest on a group's waiting list that a place has come up used to write
-- `told_at` before the message went, so a process that died mid-send silenced
-- that guest for good; and marking it after the send let two places opening at
-- once tell them twice. `claimed_at` is the lease: taken before the send, let
-- go if it fails, and ignored after ten minutes. Only a delivered send writes
-- `told_at`. A separate file, because 079 has already been applied elsewhere
-- and the runner records files, not columns.
alter table group_waitlist add column if not exists claimed_at timestamptz;
