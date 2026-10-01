-- Credentials on an account: a password, a Google identity, or both.
--
-- Website & Registration handoff (L1–L4, signed off 1 Oct 2026) and Decisions
-- J11: one log-in for customers and staff — "Log in with Google", or email +
-- password. Until this, the only way in besides the founding passcode was a
-- single-use link (033 `sign_in_links`). This adds the two things an account can
-- now carry so it can sign itself in directly.
--
--  - `password_hash`  — an argon2id/bcrypt hash, never the password and never
--    reversible. Nullable: an account can have Google only, or (before anyone
--    sets one) neither. It is a secret and is deliberately NOT in the repository
--    `COLUMNS` list, so it is never selected into an API answer by accident.
--  - `google_sub`     — Google's stable subject id for the person (the `sub`
--    claim of a verified ID token). Unique, because one Google identity maps to
--    at most one Epic account. Nullable, and NULLs do not collide: a unique
--    index in Postgres permits many NULLs, so every account without Google is
--    fine. Matching is `google_sub` first, then a verified Google email equal to
--    `accounts.email`; on that first email match the `sub` is written here, and
--    from then on the match is by id (routes/authGoogle.js).
--  - `password_set_at` — when the password was last set, for the account page
--    and so a reset can be told from a first-time set.
--
-- Staff-only is enforced in code, not here (J11): a Google sign-in opens a
-- session only for an account whose role opens the admin door (034), exactly the
-- check `accessFor` already makes. Nothing about who may sign in is a column.

alter table accounts
  add column if not exists password_hash   text,
  add column if not exists google_sub      text,
  add column if not exists password_set_at timestamptz;

-- One Google identity, one account. A plain unique index (not a constraint) so
-- the many accounts with a null `google_sub` do not collide — Postgres treats
-- NULLs as distinct in a unique index.
create unique index if not exists accounts_google_sub_key on accounts (google_sub);
