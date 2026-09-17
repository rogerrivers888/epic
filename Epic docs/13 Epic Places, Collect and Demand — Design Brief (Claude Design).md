# Epic — Places, Collect and Demand: design brief

**For:** Claude Design
**Date:** 17 September 2026 (v1)
**Builds on:** the back-office design language set on 12 September 2026 — `Categories.tsx` is the reference screen, and §10 below is the law. Reuse the Epic pack v1: lime, ink, cream, Archivo only, square corners, 2px rules, no shadows, no red except allergens, overruns and the Plan screen's Stop.
**The build brief behind it:** *12 Epic Places, Collect and Demand — Build Brief (Codex)*. That document holds the tables and the behaviour inventory; this one holds the screens. Where they disagree, ask.

## 1. The problem, in one paragraph

Epic's back office has five screens about places — Coverage, Places, Atlas, The sweep and Lookup — and the owner's reaction on seeing them together was that they feel "very crossovery… it feels like, from one screen, I may be able to do all of this, but just putting different lenses on this". He is right, and the cause is structural: each screen was built on top of a different database table rather than around a different question, so the atlas cannot see the sweep, neither can see anything Google knows, and the one screen that can see everything (Lookup) writes nothing down and re-asks the world on every click. The result is that the single most important question in this business — **what data do we actually have, where are the holes, and do the holes matter?** — cannot be answered anywhere. "It doesn't matter how good the app looks if the data we provide is not good."

## 2. What he asked for, in his words

> "I would like to be able to select a country, and then select a county, a city, or a
> postcode. If it's a county, I don't need a distance or a radius, but if it's a city or
> town, I could say within a 30-minute drive or whatever… Once I've set my criteria and
> we have the area that we need to consider, then I should be able to see these sorts of
> places as well… What I'm interested in is the number of places we know about: how many
> are owned, and how many we have just called Google, so we know that those places exist,
> but we don't own the data for them."

And, restating it on 17 September: **"to be able to search for any given location and see
everything — the locations, the activities, the categories, what we have, what we don't
have."**

That sentence is the requirement. Everything below is what has to be answerable from it.

## 3. How many screens is yours to decide

There is an analysis worth having in front of you, but **the screen count and what sits
on each screen is Claude Design's call, not this brief's.** He has said so explicitly.

The analysis: the five screens that exist today — Coverage, Places, Atlas, The sweep and
Lookup — were each built on a different database table rather than around a different
question, which is why they overlap. Underneath them there are three distinct **verbs**,
and they have genuinely different rhythms:

| The question | Rhythm |
|---|---|
| What do we have here, how good is it, what's missing? | Free, instant, read-only, used constantly |
| Go and get more | Spends money, runs for hours, has state, needs a higher permission |
| What did people ask for, and did it work? | Read-only, but about people rather than places |

Two things are settled and are not yours to reopen:

- **Atlas and the sweep dissolve** — they stop being destinations of their own. Their
  behaviour must survive somewhere; §2 of the build brief is the inventory and it is a
  contract.
- **Data › Sources and Data › Categories stay where they are.** They are the *definition*
  layer — which provider offers which field, which words map to which category — and are
  edited rarely.

Everything else — how many screens, what they are called, what lives on each, whether
"go and get more" is a screen or a drawer — is yours. Working titles used below are
**Places**, **Collect** and **Demand** purely so the rest of this document can refer to
something.

## 4. The spine: one grammar, drilled all the way down

This is the single most important thing to design, and everything else hangs off it. **One screen, one row shape, one set of numbers, at every depth.** The owner described it as wanting something "similar to what we have in Places" — the household app's country → county → town drill-down — and he is right that it is the same idea.

```
a country                    →  a county            (no radius: a county is a shape)
                             →  a town or postcode  (+ "within 30 minutes by car")
   → a category  →  a subcategory  →  a label  →  one place  →  one provider's raw record
```

Every level, without exception, prints **the same five numbers**:

> **known · owned · identified only · ready · data score**

- **known** — places we have ever seen here, from any source.
- **owned** — we hold our own research on it and it survives every provider going dark.
- **identified only** — *"we have just called Google, so we know that those places exist, but we don't own the data for them."* His words, and the number he most wants.
- **ready** — enough data to describe this place properly to a household (§6).
- **data score** — the average, 0–100.

Design that stat line once and repeat it everywhere. A country and a subcategory must read identically, because the whole value of the screen is that a person learns to read it once.

**Everything is an address.** `/admin/places?where=windsor&within=30&by=drive&lens=category&cat=outdoors&sub=soft-play&place=<ref>`. One level on screen at a time with a breadcrumb back, as Lookup already does. A work queue is a URL somebody can be sent — that rule came from the owner and holds here.

## 5. The lenses

The level is *where you are*; the lens is *how the rows are cut*. Same numbers, different rows. Design the lens switch as a quiet text control, not a tab bar — it must not compete with the level.

- **Coverage** — what's missing. Inherits today's six-fact grid, but see §6.
- **Category** — the ladder. **Critical: this list is drawn from the taxonomy, not from the data.** All eight categories and all ~51 subcategories appear, including the ones with nothing in them, because *soft play, Berkshire, blank* is the finding. "I should be able to see not just categories we have data for, but categories that we don't." Same for labels. A blank cell, never a zero — but the row must exist.
- **Source** — which providers have seen these places, and which places only one provider has ever seen. Inherits Lookup's category × source matrix.
- **Quality** — the data score spread, what's stale, and the not-owned list ranked by how much it matters (reviews × rating², top 20%).
- **Demand** — Demand's numbers, in place. *This is the lens that makes the screen strategic rather than administrative:* it ranks the gaps by what people actually searched for, so effort goes where the searches failed rather than into whichever county is alphabetically first.

Searching a ring is now **instant and free** — the engineering precomputes travel times between every postcode sector in Britain, so "within 30 minutes" is a lookup rather than a calculation. Design as though radius controls cost nothing, because they will not.

## 6. The ready bar — design this as a composer

The owner asked for this to be designed rather than specified: *"whether we have sufficient data to meet our required user needs to be able to describe the place properly."*

Today Coverage measures six facts — picture, description, hours, website, menu, shelf — against every place equally. That is wrong and it quietly poisons every number on the screen: **a restaurant is not ready without a menu, and a playground will never have one and is being marked down for it forever.** So "ready" has to mean *ready for what this place is*.

Design a small screen where the bar is **composed, not coded**: a row per category, a tick per fact, and — this is the part that matters — **the effect shown before it is saved.** "Under this bar, 34% of soft plays in Berkshire are ready. Under the current one, 71%." That is the same honesty as the existing teach-in-place category editor, which tells you how far a change travels ("every amusement park: 45 places, 34 counties") before you commit it. Weights as well as ticks, if you can make weights legible without a spreadsheet — if you cannot, ticks alone are better than an unreadable dial.

## 7. Collect

Every way of getting more data, in one list: the atlas harvest, the postcode sweep, menu reads and retries, Ask Google for ratings, Ask Tripadvisor, Curate, and the two benches. Each run shows **what it costs, what its cap is, where it got to, and what failed and why.**

Three things to preserve from what exists:

- **A run is launched from an area you are already standing in.** From Places, having found that Bristol has eleven soft plays and none of them owned, the run is right there. Collect is where you watch it and where its history lives, not where you have to go to start it.
- **Caps and spend are stated before the button, not after.** Tripadvisor is capped at 120 locations a month; Google details cost around 2.5p each. The owner types what he is willing to spend and nothing spends more.
- **Our failures are never mixed with theirs.** On the first real menu run, 132 of 341 failures were Epic's own bugs, and in free text they read exactly like restaurants with broken websites. The failure report groups by coded cause and keeps "ours" its own row. Design that distinction so it cannot be skimmed past.

## 8. Demand — and the rating workings

### 8a. Three numbers, not one conversion rate

Today, a household searches and the search itself is thrown away the instant the answer is sent. Demand starts recording it. But the temptation is to build a conversion funnel, and a single conversion rate would hide the only thing worth knowing — *which* kind of failure it was:

| What happened | What it means | Who fixes it |
|---|---|---|
| Searched, **shown nothing** | A coverage hole | Collect — go and get that area |
| Shown things, **clicked nothing** | We showed the wrong things | Categories and the label rules |
| Clicked, **added nothing to a trip** | The place itself was too thin to convince | That place's data score |

Three different owners, three different fixes. Design the area and category views around these three, side by side, never rolled into one percentage.

### 8b. The replay

One search, opened: exactly what that household typed, and exactly what came back — *"they saw 5 fun activities, 2 adrenaline activities, and 1 relaxing activity… of those 8, they only clicked on 2, and these are the ones they clicked on."* Design it as the result grid they actually saw, in the order they saw it, with the clicked ones marked and the ignored ones plain. A single screen that answers "was that a data problem or did they just not fancy it?"

One constraint to design around: names for places we do not own have to be re-fetched, and that costs a fraction of a penny. So **replay is a deliberate action with its cost said on it**, never something a list does forty times on load.

### 8c. Show the calculation

The owner, on ratings: *"I thought we were going to be taking all the providers' stars and come up with our own rating, which we can retain. I should be able to then run an order of how that's calculated, even if that means hitting the same APIs again to recalculate it. Show me the calculation logic."*

That is exactly what the code does and there has never been a screen for it. **Design the workings view.** For one place: what went in (the crowd as one of four words, how many have spoken as one of four words, the accolades, how much of a real place we own — a menu read, a named cuisine, a website, hours), what each was worth, the arithmetic, and the two numbers out — our score, and the same score with the licensed input removed, which is the one that proves the ranking survives Google going dark. Plus a **Recalculate** button that says what it will cost before it spends.

The reason this screen matters beyond curiosity: it is the only way to argue with the ranking. Design it so a person who disagrees with a place's score can see, in one glance, which input they disagree with.

**A provider's raw star rating is never written down.** It is banded into one of four
words at the moment of the call and the figure is discarded; that is a licence rule and
it is not negotiable, and it is why the sweep's column says "top" or "high" rather than
4.6. Whether a figure may appear *transiently* on a back-office screen — as it does today
on Lookup's not-owned list, which he asked for — is a narrower question and is still his;
assume it may, design so that nothing breaks if it may not.

## 9. Household-made content: filtering and approval

Owner, 17 September 2026: "We're definitely going to need a means to be able to filter
user-generated content and probably approve them, like photographs, etc., and also
reviews."

This is the other half of the data problem and it has no screen at all today. Everything
Epic holds that a *household* made — photographs of places, reviews and visit ratings,
dish notes, host offers and host reviews, meet-up entries, chat topics and replies —
needs one way to be looked through and acted on. Some of it already exists and is
unreviewed (household photographs land on signed links; the atlas has an Uploads queue
nobody has used because nothing has been submitted yet). Some of it is about to exist in
volume.

Design it as **one queue with a filter, not a queue per kind.** The person doing this
work is asking "what has come in since Tuesday, and is any of it a problem?", not "let
me go and look at the photograph screen". So:

- **Filter by kind** (photo · review · rating · note · offer · profile · message),
  **by state** (waiting · approved · rejected · reported), **by where** (the same
  location control as everywhere else — this is content about places, so it belongs to
  a county and a town), **by who**, and **by age**.
- **Approve, reject, or reject-and-tell-them**, with the reason a short closed list
  rather than free text, so the reasons can be counted and the common one designed out.
- **Batch where it is safe and never where it isn't.** Approving forty holiday snaps of
  a beach is a batch action; rejecting somebody's review is not.
- **Reported content jumps the queue** and is visually distinct from the ordinary
  backlog — it is a different job with a different clock.
- **Show what it will look like**, not a thumbnail in a grid: a photograph is being
  approved to sit at the top of a place drawer, so show it there.
- **The reviewer's own trail matters** — who approved what, when. It already has a home
  in Audit; the queue should not reinvent it.

Two design constraints that come from the architecture:

1. **A household's photograph of a place is ours to keep; a provider's is not.** The
   queue only ever shows household-made content and owned pictures. If it ever shows a
   Google photo, something is wrong upstream.
2. **A rejection has to be explainable to the person who submitted it.** Design the
   message they get at the same time as the button, on the same artboard.

Worth proposing, if you think it holds: the same queue is where **flagged data quality**
lands — a place whose hours three sources disagree about, a name that changed, a venue
that four households in a row dismissed. It is the same act (a human looks and decides)
and the same rhythm, and it would mean one place where somebody's judgement is applied
to the data rather than two.

## 10. The laws of this back office

Set by the owner on 12 September and not up for renegotiation:

- **No boxes.** No tiles, panels, pills-as-containers or outlined chips. "If it's got a big black box around it, it's wrong." Hairline rows, `lineSoft` at 1px, 8px corners on controls.
- **Legend first.** "If you don't tell me what things mean, then your UI is completely useless." Every screen says what its words mean before it says its numbers.
- **Blank, never zero.** An empty cell reads as nothing to see; a grid of zeros reads as noise.
- **Drill down; never a huge scroll.** Pick from a control, open one level at a time, breadcrumb back.
- **No prose.** The screen tells the story; detail goes behind an info icon. Never a paragraph on a UI.
- **All controls one height (40).** Dropdowns from the admin kit, the chevron its own target, search boxes a fixed width and never spanning the screen.
- **Shade is a hint, never the information.** Tints of the one lime, and every cell prints its own number, so the table reads the same to somebody who cannot tell the shades apart.
- **Both layouts.** Every screen is reviewed in the Web/Mobile toggle on the deployed site. Nothing overflows 390px. A back office on a phone is somebody checking one number on a train, so decide what that one number is for each screen rather than shrinking the desktop view.
- **Icons from the Lucide set only.** Never an emoji or a symbol character.

## 11. What to avoid

- **A dashboard.** Nobody makes a decision from a wall of tiles. Every number on these screens is a doorway to the rows behind it, or it should not be there.
- **A single health score for an area.** It will be quoted in meetings and it will be meaningless. The five numbers are the summary.
- **Charts where a sorted list would do.** The question is almost always "which ones" rather than "how many", and a list answers it and is clickable.
- **Merging Collect into Places.** It spends money and takes hours; it needs its own place to be watched from.
- **Making the empty categories hard to find.** They are the point. If the soft-play row with nothing in it is below the fold, the screen has failed.
- **Red.** Retired everywhere but allergens and overruns. A coverage hole is not a danger.

## 12. Artboards asked for

1. Places — country level, five numbers, counties beneath.
2. Places — county level, the category lens with the empty categories visible.
3. Places — town + "within 30 minutes", the same shape.
4. Places — the source lens (provider × category matrix) and the "only one source has seen these" cut.
5. Places — the quality lens: score spread, what's stale, what's worth owning next.
6. Places — one place: ours beside Google's beside Tripadvisor's, then the raw records.
7. The rating workings view (§8c), with Recalculate.
8. The ready-bar composer (§6), showing the effect before saving.
9. Collect — the run list with costs, caps and state.
10. Collect — one run's failures, grouped by cause, ours separated from theirs.
11. Demand — an area's three numbers, by category.
12. Demand — one search replayed.
13. The moderation queue (§9) — filtered, with one photograph and one review open.
14. The rejection message a household receives, beside the button that sends it.
15. The phone view of whichever two screens matter most on a phone. Your call which two; say why.

## 13. Three things that exist and that he had not seen

`/admin/library` has seven section tabs, and three of them have never been opened:
**Can you visit?** (whether an attraction can actually be visited), **Reading** (sources
on the left as fetched, the filled-in form on the right, and every read field carrying
the sentence it came from — a field with no sentence is a judgement and is marked as
one; Approve makes it a worked example, Correct becomes a lesson) and **Uploads** (the
household-photograph queue, empty because nothing has been submitted). All three carry
behaviour that must survive. **Where they end up is your call** — Reading in particular
may belong with the moderation work in §9 rather than with the atlas, since both are a
person looking at something and deciding.
