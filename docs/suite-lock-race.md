# The suite lock: a suspected race, observed 2 Oct 2026

**Status: open, unowned until claimed.** Written up on the owner's word (2 Oct 2026): "it
stalls whoever is pushing… write it up in docs/ with what you observed so it has an owner,
and if it bites again during step 6, stop and fix it then rather than working around it."

The lock is `apps/api/test/helpers/suiteLock.mjs`: one full suite on the machine at a time,
a JSON file `{pid, at}` at `<main checkout>/.epic-suite.lock`, taken with
`writeFileSync(…, { flag: 'wx' })`, waited on by polling every 5 s, stolen when the holder
is dead or the lock is older than 20 minutes. `npm test` (`runSuite.mjs`) and so the pre-push
hook both go through it.

## What was observed (fact)

Around 07:11–07:35 local on 2 Oct 2026, while a push of parks admission sat in its pre-push
hook:

- Two `node test/helpers/runSuite.mjs` processes ran at **~96% CPU each for 19+ minutes**:
  pid 95967 in `/tmp/epic-wt-closedtab/apps/api` and pid 96298 in `/tmp/epic-wt-nc/apps/api`
  (the latter with `--test-name-pattern=…`). **Neither had a child** (`pgrep -P` empty) — so
  neither was running tests; both were still inside `holdSuiteLock`. Their `npm` parents
  were alive at 0% CPU.
- Eight more `runSuite.mjs` waiters from five worktrees sat at 0% CPU, as designed.
- At the time the lock file named pid 2678, taken 30 seconds earlier.
- The parks push's hook waited over thirty minutes and was cut off by the session's
  background time limit; the push had to be redone. A normal full suite takes ~2½ minutes.

## What is suspected (not proven)

1. **A waiter can delete a live lock.** `take()` creates the file and then writes it; between
   the two the file exists and is empty. A waiter that reads it in that window gets `null`
   from `read()`, takes `!held` to mean "nobody is behind it", and `unlinkSync`s it — the new
   holder's lock. Another waiter then takes the lock and **two suites run at once**, which is
   the exact condition the lock exists to prevent (31 unrelated red files on 21 Sep).
2. **A holder can delete somebody else's lock.** `drop()` unlinks whatever is at the path on
   exit. If a holder's lock was deleted under it (1) and another session took the lock, the
   first holder's exit deletes the second's — and the race widens.
3. **The 96% CPU is not explained.** Every loop iteration that finds a live holder sleeps 5 s;
   only the steal path (`!held || stale || dead`) `continue`s without sleeping. A tight loop
   needs that path to keep firing — e.g. two waiters repeatedly unlinking and re-taking each
   other's empty files. Not reproduced; the processes were not sampled before they ended.

## Suggested fix (for whoever claims it)

- Make taking atomic with content: write `{pid, at}` to a temp file, then `fs.linkSync(tmp,
  LOCK)` (fails if LOCK exists) — the lock never exists empty.
- Treat an unreadable lock as held, judged by its mtime, never as absent.
- `drop()` unlinks only if the file still names its own pid.
- Sleep on every iteration that did not take the lock, including after a steal.
- A test that runs two `holdSuiteLock` callers against one temp path and asserts they never
  overlap.

If it bites again during markets step 6, step 6 stops and this gets fixed then (owner).
