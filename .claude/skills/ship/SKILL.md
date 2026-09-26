---
name: ship
description: Take a finished batch through the full hand-over — suite, Codex review, act on every finding, then push and check the deployed site. Use when work is built and ready to be called done, or when the owner says "ship it", "review and deploy", or asks for the Codex pass.
---

# Ship

The hand-over sequence for Epic. The order is not interchangeable (CLAUDE.md, owner,
21 Sep 2026): **main is green after the final commit — re-run, not remembered — then
Codex, then checked on the deployed site.** A green suite from ten minutes ago is not
evidence, and a clean review is not a green suite.

Codex runs on the Epic account. `.claude/settings.local.json` sets `CODEX_HOME` to
`~/.codex-epic`, so plain `codex` in this repo is already the right account. If that
file is missing (a fresh clone — it is gitignored), prefix every codex command with
`CODEX_HOME=$HOME/.codex-epic` and tell the owner it needs restoring.

## 1. Fix the range first

Work out what is being handed over and say it out loud before running anything:

```
git log --oneline origin/main..HEAD   # in the worktree: exactly your commits
git status --short
```

- A **migration and the tests that depend on it are committed together, never
  separately.** An uncommitted migration is invisible to every other session on this
  machine. If `git status` shows one, stop and commit it with its tests before going on.
- **Commit and push only from a worktree off `origin/main`, never from the shared
  index** (owner, 26 Sep 2026; CLAUDE.md has the commands). A check followed by a
  separate commit races every other session: on 26 Sep a `git diff --cached` showing
  only this session's files was followed, a test run later, by a commit that also
  carried another session's staged migration. So pin one base (`BASE=$(git rev-parse
  origin/main)` after fetching — another session's fetch moves the ref), cut `git diff
  --binary $BASE -- <your files>` to your hunks, apply it in `git worktree add --detach
  /tmp/epic-wt-<name> $BASE`, and run every step below **there**. Never `git
  add`, `git commit`, amend or push `main` in the shared tree.
- **Every edit, review fixes included, is made in the shared tree first** and carried to
  the worktree as a patch against the worktree's `HEAD`. The shared tree is the copy that
  outlives the worktree; a fix made only in the worktree is reverted by the next patch.
  A file new in the batch is untracked in the shared tree, so it is copied across, never diffed —
  the diff would delete it.

## 2. The suite, after the final commit

```
cd apps/api && npm test --silent
```

Run it **after** the last commit of the batch, not before. `npm test` takes the suite
lock, so a concurrent session's run makes this wait rather than fight over the database.
If it fails, fix it — do not proceed to Codex. A review of a broken batch wastes the
money and tells you nothing you needed.

## 3. Codex

```
codex exec review --base origin/main
```

Use `--commit <sha>` for one commit or `--uncommitted` for work not yet committed.
This is a blocking call: it reads the diff and returns its findings on stdout. There is
no queue, no webhook and nothing to poll.

## 4. Report every finding, and what was done about each

The owner's standing instruction (4 Sep 2026): *"make sure everything is reviewed by
Codex"*. Reporting means **every** finding, including the ones not acted on and why —
a finding silently dropped is the one that bites.

For each: fix it, or say plainly why it is being left. If anything is fixed, **go back
to step 2** — the suite has to be green after the *last* commit, which is now a
different commit.

Codex reviews the diff; it does not prove main. It is the pass that catches what
neither the tests nor the deployed site would.

## 5. Push

From the worktree: `git push origin HEAD:main && cd <repo> && git worktree remove --force /tmp/epic-wt-<name>`
— removed **only once the push has succeeded**: until then the reviewed commit lives nowhere else.
If the push is refused because `main` moved, `git fetch && git rebase origin/main` in the worktree and go back to step 2 —
but only if the rebase is clean. If it stops on a conflict, `git rebase --abort`: resolve it in the shared tree,
which is where every edit lives, then cut the patch again against the new `origin/main` in a fresh worktree.
The `pre-push` hook runs the whole suite again and blocks the push if anything fails.
**Never `--no-verify`** — it is the only thing between a broken commit and four other
sessions pulling it.

**Push without asking when the suite is green and Codex raised nothing actionable**
(owner, 21 Sep 2026, choosing "push automatically when clean" over stopping for
approval). This supersedes the older "approve first" rule for this path only: his
approval still comes before the work is built, not before a clean batch ships.

Stop and report instead of pushing if any of these is true:

- the suite is not green, or was last run before the final commit;
- Codex raised a finding that is being left unfixed — a finding you have decided not
  to act on is exactly the thing he has to see before it ships;
- the batch touches a migration, a secret, a provider key, a spend cap or a billing
  control. Those are his by standing rule, whatever the review said;
- `codex exec review` itself failed to run. A review that did not happen is not a
  clean review, and must never be reported as one.

When it does push, still report the range, the suite result and every finding with its
disposition — shipping unattended is not the same as shipping silently.

## 6. The deployed site

A push to `main` deploys to Railway. Done is not done until it has been opened on the
real site with his real data — full `https://` links, never `file://` or `localhost`,
and both views where a screen changed (the shell's Web/Mobile toggle at ≥900px).

## Reporting back

Lead with his ask. Then: done / partial / not done per item, every Codex finding and
what happened to it, and full links to what was checked.
