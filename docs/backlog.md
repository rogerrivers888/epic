# Backlog

Tracked follow-ups to pick up in a deliberate pass, so they are not lost between sessions.

## Doc triage — data policy (`Supporting docs/Data policy/epic-data-policy.html`)

Codex surfaced these inconsistencies in the policy essay while version-controlling it (1 Oct 2026). The owner's three + five named corrections are done; these remain for one editorial pass:

1. **Inspire load vs "nothing bought for a category nobody opens"** (~line 150). The "Inspire opens" table row says one paid display search runs per category at open (all ten, 32p), but the following paragraph says "Nothing is bought for a category nobody opens." Decide which is true and make both agree.
2. **Free-allowance search math** (~line 162). "Google's free allowance … roughly 100 fresh ten-category searches at £0" — re-check the arithmetic against the per-search request counts and the 1,000/month thresholds.
3. **Browser photo-cache exception in the implementation block** (~lines 206-209, the pasted `## Data policy` spec). The spec's Caches line says "photos 1 h" but does not carry the 1 Oct decision that rented photo bytes are cached 10 h in the browser (a separate layer from the server's 1 h). Add the exception there too, since that block is meant to be pasted into CLAUDE.md.
4. **"Every census entry is showable"** (~lines 252-254). Reconcile with the rule that names, ratings and photos are rented at display and bought only for what is shown.
5. **Back-office "Show another 10" paging** (~lines 290-292). "Show another 10 = next page" buys a page (20) when only 10 more are needed; consume the remaining first-page results before paging.
