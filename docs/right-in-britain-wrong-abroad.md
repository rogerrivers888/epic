# Things that are right in the UK and wrong abroad

A running list of faults with one shape: a default, fallback or assumption that is
**correct because the UK is the home market**, and silently wrong in any other market.
They share three properties that make them dangerous:

- **Invisible in Britain.** The output looks right here, so nobody notices.
- **Invisible to tests.** Fixtures and unit tests are UK-shaped, so green says nothing.
- **Found by looking, not by trusting green.** Each one below was caught by reading what
  the deployed thing actually produced, or by reasoning about a non-UK market — never by a
  passing suite.

The lesson (owner, 30 Sep 2026, after the second one in a day): **look at the deployed
thing, in a non-UK market, rather than trusting a green suite.** As Epic adds markets, this
class stops being hypothetical — the first launch market (US) is where every one of these
turns from latent to live. When you add a market-sensitive default, add it to this list or
prove it does not belong here.

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
