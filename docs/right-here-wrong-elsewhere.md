# Right here, wrong elsewhere

A running list of faults with one shape: a default, fallback or assumption that is
**correct in the context we happen to be standing in — Britain, this month, the home
market — and silently wrong the moment that context changes.** It began as "right in
the UK, wrong abroad", but the class is bigger than geography (owner, 1 Oct 2026, after
the third in two days): *wrong abroad*, *wrong next month*, *wrong in another market* are
the same bug — a case that never happens where you are standing. They share three
properties that make them dangerous:

- **Invisible from here.** The output looks right in our context, so nobody notices.
- **Invisible to tests.** Fixtures and unit tests are shaped like our context — the UK,
  the current month, the home market — so green says nothing.
- **Found by looking, not by trusting green.** Each one below was caught by reading what
  the deployed thing actually produced, or by reasoning about another place or time — never
  by a passing suite.

The lesson (owner, 30 Sep–1 Oct 2026): **look at the deployed thing, in a context that is
not the one you are standing in** — another market, another month — rather than trusting a
green suite. As Epic adds markets these turn from latent to live; a month boundary needs no
new market at all — it arrives on its own. When you add a context-sensitive default, add it
to this list or prove it does not belong here.

**Worth a sweep (owner, 1 Oct 2026, not now):** three in two days suggests there are more.
At some point, sweep for date-sensitive and month-boundary assumptions the way provenance
and country were swept — anything keyed on "this month", "today", a rollover, an expiry, or
a single timezone.

## The list

### 1. The timezone / currency "named only abroad" fallback
A place's timezone and currency default to the **household's own** when the code is not
told the place's. At home that is always right (the place is in your market); abroad it is
wrong (a French place read in pounds, a place's hours in the wrong zone). The markets design
makes this explicit — currency, timezone and country are **named only abroad** *because* the
home-market default is wrong abroad — but the default still leaks in wherever a caller does
not pass the place's own market. Today's instance: the near-home browse planners (Inspire,
Plan's pool and route) were costing places in the household's home currency until each was
given the searched area's country; the residual — a place has no country of its own, only
the area does — is written up in [`markets-followups.md`](./markets-followups.md) §1, because
a cross-border search ring still costs on the wrong side of the border.

### 2. The `$$` cost-definition escape (30 Sep 2026, commit `e6b871eb`)
The place page's cost definition ("$$ means $15–40 a person") was built with chained
`String.replace`. In a JavaScript replacement string **`$$` is the escape for a single
`$`**, so `'{band}'.replace('{band}', '$$')` produced `"$"` — the live US market read **"In
United States, $ means $15–40"**, one dollar sign, not two. **£ and € markets were
completely unaffected**, which is exactly why the UK and Ireland read correctly and nothing
looked wrong here. No test caught it; it was found by reading the live endpoint's output
during the deployment check. Fixed with a `fillDefinition` helper (`domain/costBand.js`)
that fills tokens by split/join, which treats a currency sign as a literal; tested with
`$$`/`$$$`. A JavaScript escape sequence silently eating a dollar sign is invisible in
Britain and wrong in the first market we launch next — the argument for this whole file.

### 3. The Spend tile on the first of the month (1 Oct 2026, commit `ca1bb149`)
The back-office Spend tile reads the billing snapshot (`cfg.billing`). On the first of a
month that snapshot still covers the **previous** month, so `billingTile` returned
`google.spent = null` and `tone = 'none'` until the billing export caught up. Right on
every day but the first — and the first is when it broke: `typeof null === 'object'` and a
tone outside green/amber/red failed two tests, turning the whole suite red and blocking
**every session's** pre-push. It was found the moment the date rolled to 1 October, not by
the suite the day before. Fixed (`desk/overview.js`): "no billing yet this month" is **£0
spent so far — a known figure, not an unknown**, so this month reads £0, the tone is judged
on that £0, and the title says the export is not in yet while still showing last month's
figure for context. This is the first entry that is a *time* boundary rather than a *place*
one — the reason the file is no longer named for geography.

### 4. The closed-check test's frozen "today" (2 Oct 2026, commit `bba64d0f`)
`test/c57-closed.test.js` pins the closed-check's `today` to `2026-09-29` but recorded a
family's visit at `current_date - 2` — the real calendar. On every day up to 1 October the
visit fell on or before the pinned "today" and the review settled "a family went"; from
**2 October** the visit was *after* the pinned "today", `familyVerdict` rightly refused it as
a visit in the future, and two tests failed on every run — on bare `origin/main` as well as on
every branch, so every session's pre-push was blocked from midnight. Found by capturing a
failure instead of calling it a flake (owner, 2 Oct 2026: "a flake that appears twice is not
a flake"); it reproduced three runs out of three. Fixed by making both the visit and the
review date offsets from the test's own `TODAY`, so the fixture no longer ages. The shape:
**a test that mixes a frozen clock with the real one is right on the day it is written and
wrong on a later one** — wrong at a time rather than a place. When a test pins a date, every
date in its fixtures is derived from that pin, never from `now()` or `current_date`.
