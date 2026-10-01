-- Approve-and-run (G11, owner 1 Oct 2026): approving a request runs exactly the
-- recorded action under the owner's elevated identity, and keeps the result.
--
-- The payload is fixed at filing — the agent cannot edit it after — so what the
-- owner approves is what runs. The result (status and a short message) is kept
-- so the owner sees what happened; a failed run is left re-approvable.
alter table approvals add column if not exists payload jsonb;   -- the exact body to replay
alter table approvals add column if not exists result jsonb;    -- { status, ok, message }
alter table approvals add column if not exists ran_at timestamptz;
alter table approvals drop constraint if exists approvals_state_check;
alter table approvals add constraint approvals_state_check
  check (state in ('pending', 'approved', 'running', 'done', 'declined', 'failed', 'unknown', 'consumed', 'expired'));

-- Legacy requests filed before approve-and-run have no stored payload, so they
-- cannot be replayed faithfully — expire them; they are refiled if still wanted.
update approvals set state = 'expired' where state in ('pending', 'approved', 'running');
