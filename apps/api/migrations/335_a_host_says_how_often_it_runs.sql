-- The host page asks how often a host's thing runs, not what it is (Website ›
-- "New hosting screen 021026", signed off 2 Oct 2026): One-off · Weekly ·
-- Course · On request. The waitlist's `host_kind` takes the new four. The old
-- four stay allowed so a row written before today is never made invalid — a
-- follow-on, not an edit of 324 (CLAUDE.md: never edit a migration that has run).
alter table interest_signups drop constraint if exists interest_signups_host_kind_check;
alter table interest_signups add constraint interest_signups_host_kind_check
  check (host_kind in ('one-off', 'weekly', 'course', 'on-request', 'activity', 'class', 'homeschool'));
