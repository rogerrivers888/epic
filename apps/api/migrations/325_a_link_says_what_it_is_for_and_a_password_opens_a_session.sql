-- Email + password sign-in (Website & Registration L1–L4, 1 Oct 2026).
--
-- Two small things the password door needs from tables that already exist.
--
-- 1. `sign_in_links.purpose` — what a link is for. The handoff gives the table two
--    new kinds of link: an *invite* (a new staff member, seven days, opens L4 to
--    set a password) and a *reset* (asked for from L2, thirty minutes, opens L4
--    in reset mode). Both are redeemed only at `POST /api/auth/credentials`,
--    which sets a password as it spends them; neither may be redeemed as an
--    ordinary magic link, which would sign somebody in without ever setting the
--    password the link was sent to set. So the row has to say which it is.
--    Null is everything that already exists — a legacy magic link (owner, self,
--    household) or a Google handoff code — so no live link changes meaning.
--
-- 2. `api_sessions.auth_method` gains 'password'. The check is dropped and
--    re-added with the whole list, as 313 defined it, plus the new method; a
--    password is a personal sign-in (access.js) and the session must be able to
--    say so.

alter table sign_in_links add column if not exists purpose text;
alter table sign_in_links drop constraint if exists sign_in_links_purpose_check;
alter table sign_in_links add constraint sign_in_links_purpose_check
  check (purpose is null or purpose in ('invite', 'reset'));

-- "Making a new link of either kind cancels the older unused links of the same
-- kind for that account" is a lookup by account and purpose among the unused.
create index if not exists sign_in_links_account_purpose_live_idx
  on sign_in_links (account_id, purpose) where used_at is null and purpose is not null;

alter table api_sessions drop constraint if exists api_sessions_auth_method_check;
alter table api_sessions add constraint api_sessions_auth_method_check
  check (auth_method in ('passcode', 'link', 'google', 'service', 'invite', 'password'));
