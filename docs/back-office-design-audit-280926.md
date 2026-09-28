# Back office: design audit, 28 Sep 2026

This is an independent audit of the rebuilt back office, commit 49457e6, against the owner's designs. The owner's ask was: "confirm that the designs that you've delivered, or the screens that you've delivered, exactly match the designs that I've provided. They should be identical."

**Answer: they are not identical.** Every screen has differences. Most of the drawing is close: the layout, the type scale and most of the copy match the prototype. But there are real faults:
- one crash;
- two proposals that cannot be accepted;
- a Mobile frame that does not scroll;
- several numbers that contradict the rules in the design;
- a How it works page that does not use the prototype's layout.

## Contents

- Global chrome
- Overview
- Categories
- Facts: All facts, fact page, drill-down, Excluded facts
- Facts: Verification and Accuracy
- Mapping
- Collections and See as a household
- Fact automations
- Changes
- How it works
- Cross-cutting findings

For each area there is a verdict, then a numbered list of discrepancies. After that come the additions, the deliberate deviations (checked against owner rules), what could not be checked, and the screenshots.

## The spec used

- README v2: `Supporting docs/Back office/Categories & Collections - 280926/Categories & Collections design/README.md`. It wins on layout and copy.
- The prototype, `Epic Labelling prototype.dc.html`:
  - run at http://localhost:8765/proto.html;
  - template: `/tmp/proto/template.html`, cited as "T:<line>";
  - logic: `/tmp/proto/logic.js`, cited as "L:<line>".
- Screens that README v2 removed were out of scope.

## How the audit was done

- Seven auditors each took a group of screens. Each screenshotted the prototype and the build side by side, in Web (1440×1000) and in the Mobile 390px frame, and compared computed styles and copy word for word.
- The build ran at http://localhost:8083 against the throwaway `bo_view` database. Rows were seeded to reach states; the seeds are listed at the end.
- No source file was edited and there were no git writes.

**The build moved during the audit.** The worktree advanced to b2f0468, with uncommitted edits across `apps/api/src/desk/*` and migrations 269 and 270.
- The Metro bundle on :8083 was still serving 49457e6's web code; auditor F checked the served bundle.
- The API on :4002 may have picked up some server edits. Where a finding may already be fixed in b2f0468, it is marked "(check b2f0468)".
- File:line citations are against 49457e6.

Severity key:
- **M (Material):** a missing or wrong element, wrong copy, or wrong behaviour.
- **m (Minor):** a nuance of spacing, size or colour.

---

## 1. Verdicts per screen

| Screen / state | Verdict |
|---|---|
| Global chrome: left rail | **Material** |
| Global chrome: top tabs, Runs link, toast and Undo | Minor |
| Global chrome: breadcrumb | Minor |
| Global chrome: Mobile frame | **Material** (the frame does not scroll vertically) |
| Overview (Web) | Minor |
| Overview (Mobile) | **Material** (a line overflows the frame) |
| Runs (from Overview) | Roughly matches (no start or stop buttons) |
| Categories: list, header, toolbar, sort, ticks | Minor |
| Categories: bulk bar | **Material** |
| Categories: location filter (shared with Collections) | **Material** |
| Categories: subcategory page, Defaults | **Material** |
| Categories: subcategory page, Facts | **Material** |
| Categories: fact at a subcategory (places, Edit) | **Material** (Edit crashes) |
| Categories: New facts | Minor |
| Facts: sub-tab strip | Minor |
| Facts: All facts | **Material** (status and count logic) |
| Facts: fact page, ordinary fact | **Material** |
| Facts: fact page, standard facts | Minor |
| Facts: drill-down | **Material** |
| Facts: Excluded facts | **Material** (Put back and Undo behaviour) |
| Verification: never run | Matches |
| Verification: running, stalled, charts, toggle, amber | Minor |
| Verification: Sources table | **Material** |
| Verification: drill-downs | Minor |
| Accuracy: main, by Fact | Minor |
| Accuracy: by Category, or with a source selected | **Material** (the toolbar breaks) |
| Accuracy: fact health view and disagreements | Matches (minor density) |
| Mapping: header, counts, view control, Filter and Sort | Minor |
| Mapping: In Epic | Minor |
| Mapping: picker | **Material** ("Make primary" cannot be clicked) |
| Mapping: "…" menu and Exclude confirm | Matches |
| Mapping: Needs a decision | **Material** |
| Mapping: Not in Epic | Matches |
| Mapping: Decided | Minor |
| Mapping: Mobile | **Material** (the picker is unusable) |
| Collections: list layout | Minor |
| Collections: list data (set, rules, copy lines, audience) | **Material** |
| Collections: editor | **Material** on behaviour, Minor on layout |
| Collections: place drawer | Minor |
| Collections: See as a household | **Material** |
| Collections: Mobile | Matches, apart from the frame-scroll fault in the chrome row |
| Fact automations | **Material** (header counts missing; the rest matches word for word) |
| Changes | **Material** |
| How it works: layout and chrome | **Material** |
| How it works: content against the v2 document | **Material** (four sections rewritten) |
| How it works: links from desk tabs | **Material** (three screens lost their link) |
| How it works: Mobile | Matches |

---

## 2. Discrepancies

### Global chrome

1. **Rail items and groups · M.**
   - Design (README Global chrome; T:17-33): the first group has no heading and holds "Overview · Accounts · Households · Activity · Reporting".
   - Build: a **REPORTING** heading over Overview · Money · Subscriptions · Customers · Suppliers · Behaviour. Accounts, Households, Activity and Reporting are absent.
   - This rail predates 49457e6, but the design names it and it does not match.
   - `apps/web/src/admin/AdminApp.tsx:113-126`.
2. **Rail "Overview" goes to a different screen · M.**
   - Prototype: it opens the desk Overview and is lit there (L:929).
   - Build: it goes to `/admin/reporting`, the reporting suite's overview. On `?tab=overview` nothing in the rail is lit.
   - `AdminApp.tsx:113, 235`.
3. **Rail "Runs" goes to a second, different Runs screen · M.**
   - Prototype: the rail's Runs is the same screen as the corner link, and it is lit there (L:929).
   - Build: `/admin/runs` is a different screen, and on `?tab=runs` the rail lights nothing.
   - `AdminApp.tsx:162, 235`.
4. **The Mobile frame does not scroll vertically · M.** Found independently by auditors A and D.
   - The 390px frame is `overflow:hidden`; the desk content is 1,450–2,800px tall against 844.
   - Nothing between them scrolls: the content View has no vertical ScrollView (`AdminApp.tsx:367`, `<View style={styles.content}><SpendAlarm />{body}</View>`).
   - The Verification Sources table and the Accuracy table could be reached only by forcing `overflow:auto` in the DOM. Mouse-wheel tests in headless Chrome did nothing; touch on a real device was not tried.
5. **Corner "Runs" link colour · m.** The prototype draws it `#cfcac7` always (T:48). The build turns it lime on the Runs page (`Desk.tsx:200`).
6. **Breadcrumb styling · m.** Found by auditors A, B and C.
   - Prototype: earlier crumbs 600 weight in `#9a9492` with no underline; the last crumb 800 (L:1831-1833).
   - Build: earlier crumbs 500 weight with a 1px `#46413f` underline; the last crumb 700.
   - `Desk.tsx:138-142`.
7. **Mobile tab strip · m.** The lit tab is not scrolled into view (on Fact automations or Changes the strip shows Overview–Mapping). "Runs" drops to its own line, leaving a gap of about 70px before the strip. `Desk.tsx:190-193`.

### Overview

8. **Mobile overflow · M.** "2 bulk settings contradicted by their places" does not wrap. It runs past the frame (scrollWidth 465 against 390), so the page scrolls sideways, which breaks the back-office phone rule. `Overview.tsx:143-150`.
9. **Bulk-setting link target · m.** The prototype opens Categories sorted by review, descending (L:1956 `go('subs',{subSort:'review'…})`). The build opens plain `?tab=categories`. `Overview.tsx:108-109`.
10. **Growth sparkline · m.** The prototype draws 7 points. The build draws 6 weekly points while saying "in 6 weeks". In `bo_view` it reads "+108,721 in 6 weeks", the whole estate, because first-seen dates are all recent. `api/src/desk/overview.js:131-150`.
11. **The "contradicted" count is inflated · M (knock-on of item 20).** The Overview's "N bulk settings contradicted by their places" reads the same comparison of raw values rather than bands.

### Categories

12. **Fact at a subcategory: Edit crashes the screen · M.**
    - Clicking Edit on any row shows "Epic stopped working" (`TypeError … 'map'`).
    - The screen reads `r.options` on each row (`categories/FactAtSub.tsx:138,147`), but the API sends `options` once for the whole list and only `current` per row (`api/src/desk/facts.js:240, 274`). Confirmed in source.
    - No place's answer can be corrected from this screen.
13. **Review on a flagged default opens the wrong view · M.**
    - README: "Review opens the inspect view."
    - Build: it opens `sub+fact`, the "Found at N places" page, which lists only places that say Yes (`SubPage.tsx:188`).
    - On climbing › Indoors, flagged "3 of 4 confirmed places say otherwise", it showed 1 place and none of the 3 that disagree.
14. **The bulk bar covers the reach dropdown · M.** With a row ticked, the bulk bar (`zIndex 32`, `Categories.tsx:416`) draws over the location filter's dropdown (`zIndex 30`, `Categories.tsx:181`). The Car / Public transport tabs and "5 min" are hidden, on desktop and on Mobile.
15. **Bulk bar on Mobile: value pills run off the frame · M.** The pill bar does not wrap (`categories/shared.tsx:68`, used at `Categories.tsx:431`). Pills from "Older children…" onwards sit beyond 390px, and scrolling one into view shifts the whole frame sideways.
16. **Two conflicting sets of "Who is it for" bands · M (README contradicts itself; owner to rule).**
    - README's Subcategory page and the prototype give "0–3 · 4–10 · 11–15 · 16+ · All ages".
    - The build offers "Babies under 2 · Toddlers 2–4 · Young children 5–8 · Older children 9–12 · Teens 13–17 · Adults 18+ · All ages" in both the bulk bar and Change. That follows README's All facts definition.
    - Knock-on: Change in the 130px column stacks seven pills and the row grows to about 200px (`SubPage.tsx:171-175`). The bulk bar wraps "Clear" to a second line.
17. **Bulk Set is logged as N entries · m.**
    - Prototype: one Changes entry, "Default set · Dog friendly on 4 subcategories · A, B, C, D" (L:1341).
    - Build: one entry per subcategory, each repeating the batch-wide Why ("Applies to 2382 places…"), which is not true of each subcategory alone.
    - `api/src/desk/categories.js:401-406`.
18. **Location filter prints a confident "0" · M (can't-speak rule).**
    - `resolveLocation` counts only the places the ring placed inside; places whose position is unresolved are dropped (`api/src/desk/location.js:81-101`).
    - Sunningdale, SL5 and RG1 therefore show "0 within reach" in every row, in Categories and in Collections.
    - `bo_view` has no place coordinates, so the true figure is unknowable here. The screen should say it cannot speak rather than print nought.
19. **Location filter: the public-transport "approx" flag is never shown · m.** The API returns `approx: true`; `LocationFilter` ignores it (`kit.tsx:545-613`).
20. **The contradiction flag compares raw values, not bands · M.**
    - README: "Stored place values must be mapped into these bands before comparing."
    - `same()` compares from/to exactly (`api/src/desk/categories.js:183-184, 243-247`).
    - Test: riding-stables Duration was set to 2–3 hours by a person, and three places answered 150, 160 and 170 minutes. The build shows the amber "3 of 3 confirmed places say otherwise · Review", a false flag.
21. **A fact confirmed at fewer than 2 places still shows as Active · M.** Found independently by auditors B and C.
    - README Statuses: "A fact confirmed at fewer is Gathering evidence, whatever else is true." The prototype demotes it (L:1093, L:1505).
    - The build prints the stored status (`api/src/desk/categories.js:264-274`; `api/src/desk/facts.js:64, 121`), and `pipeline.js:433` never moves an Active row back.
    - Example: Speed wall (1 of 2 places) shows "Active · New". It is counted in the Facts column, NEW · 30 DAYS and New facts, and it shows blank Status in All facts.
22. **Machine proposal from zero places: wrong copy · M.**
    - Build: "Proposed from its places · private until accepted". There is also no singular form, so one place would read "1 places" (`api/src/desk/categories.js:257`).
    - Prototype: "Proposed from 1 place".
23. **Unset default basis: wrong copy · M.**
    - Build: "No default · each place answers for itself" (`SubPage.tsx:184`).
    - Prototype: "The places disagree, so each answers for itself" (L:1369).
24. **Subcategory page: "Copy facts from another subcategory" missing · M against the prototype (T:229).** README v2 does not mention it, so the owner should confirm whether it was meant to go.
25. **Secondary-filing line drops the place names · m.** The prototype lists "· Dinton Pastures (primary: Lakes & rivers) · …" (L:1353). The build shows only the count (`SubPage.tsx:131-135`).
26. **Fact at a subcategory: the quotes and the right-hand column are missing · m against the prototype.** The prototype has "WHAT PEOPLE SAY ABOUT THE …" and a VERIFICATION / "N in the queue" / RECENT OUTCOMES column (T:257-307). README v2's drill-down does not list them.
27. **Edit choices for yes/no facts · m.** Yes · No only; the prototype also offers "Don't know" (L:1416; `api/src/desk/categories.js:169` `optionsOf`).
28. **New facts · m.**
    - The "What we have" column is a fixed 420px and wraps (`NewFacts.tsx:58`).
    - "found on 0% of places" is a rounded nought (`api/src/desk/categories.js:334`).
    - "Mentioned at 0 places · confirmed on 3" contradicts itself.
29. **List: Places not clickable · m.** In the prototype the Places cell and the PLACES header open the geography view (L:1312, 1348).
30. **List: sort ties not broken by name · m.** The prototype breaks ties by name (L:1127-1131); `sortRows` does not (`kit.tsx:368`). Sort directions are otherwise correct: Places ascending first; Facts and Related descending first; text columns ascending.
31. **List: search ignores synonyms · m.** The prototype also matches `SEARCH_TERMS`.
32. **List: the Related × is allowed only on links a person made · m.** The prototype allows removing any related pair (`Categories.tsx:270`).
33. **Header PLACES count follows the location filter · m.** The prototype keeps the estate total.
34. **Unknown place · m.** The prototype zeroes the counts and switches the header to "Within reach". The build keeps the whole-estate counts. The copy matches.
35. **Type and colour nuances · m.**
    - Category dropdown label: 13px/700 against 13.5px/600 (`kit.tsx:245`).
    - Selected dropdown and reach options: lime at 700 against white at 800.
    - Car / Public transport tabs: 700/500 against 800/600.
    - Unticked checkbox border: `#46413F` against `#6B6664` (`kit.tsx:317`).
    - The column-header tip has a dotted underline.
    - Vertical rhythm is 10–22px tighter (title to toolbar 29px against 51px).
36. **Duration band wording · m.** README: "1–2 · 2–3". Build and prototype: "1–2 hours · 2–3 hours".

### Facts: All facts, fact page, drill-down, Excluded facts

37. **"Places with it" counts places outside the subcategories that look for the fact · M.**
    - README: "a place counted once even if several subcategories share it". The count is meant to be of places in the subcategories that use the fact.
    - Example: Flumes is looked for only in Lidos, where 1 place has it. All facts says 2, and the drill-down lists a riding-stables place.
    - `HAS_SQL` is not limited to those subcategories (`api/src/desk/facts.js:34-42, 50, 105, 210`).
38. **Put back always makes the fact Active · M.**
    - A Gathering-evidence fact that is removed and put back returns as Active and "New".
    - The prototype deletes the override, so the fact returns to its real state.
    - `api/src/desk/categories.js:495` (`restoreFact` sets `status='active'`).
39. **Undoing a Put back forgets who removed it · M.** The row then reads "Removed by a person" with no name or date, which breaks "every human decision keeps its reason, who made it and when". `api/src/desk/categories.js` `undoFact` (~509-512).
40. **Standard facts claim places were checked when they were not · M (can't-speak rule).**
    - Duration reads "Asked at 108,729 places · answered at 8"; Parking reads "Looked for at 108,729 places". That is every place filed, not places asked.
    - Standard facts with no answers show "0" places in All facts (Booking required, Dog friendly, Toilets).
    - `api/src/desk/facts.js:105, 251-260`.
41. **The conflict line survives a person's answer · M.** After a conflicting place was set to Yes by hand, the page still reads "1 place where our sources disagree — families will be asked". `api/src/desk/facts.js:118`.
42. **The drill-down's filters and search are not in the address · M (owner rule "every page has an address").** They are local state (`facts/AllFacts.tsx:290-294`). All facts itself writes `q`, `cat`, `sub` and `state` correctly.
43. **The Subcategories column sorts ascending on first click · M (README Interactions: "other numbers default descending").** `facts/AllFacts.tsx:82`. The prototype also sorts ascending here, but README wins.
44. **The ages fact is named "Suits ages" · M.**
    - README: "Who it's for"; prototype: "Who is it for". The build takes the `place_attributes` label.
    - The build also lists a tenth standard fact, "Dog friendly", which the prototype's standard list does not have (the README's bulk-bar list does).
45. **Ignored facts never show their reason in All facts or on the fact page · M.** README: "Ignored — with the reason: On nearly every place · An opinion · A condition · Removed by a person." The API returns `reason`, but only Excluded facts shows it (`facts/AllFacts.tsx:139`). The prototype has the same gap.
46. **The drill-down lacks the prototype's quotes and right-hand column · M against the prototype (T:284-299).** README v2 does not list them, so this needs the owner's decision (same as item 26).
47. **A Gathering-evidence fact shows its count ("1") · m.** The prototype shows "—" unless the fact was demoted from Active (L:1505).
48. **How we know · m.**
    - The build shows one source per place; the prototype combines them ("OpenStreetMap · Venue website").
    - A person's answer reads "A person"; the prototype says "Set by a person" (`api/src/desk/places.js` SOURCE_WORD).
49. **Area · m.** README: "county, country". The build writes "Berkshire, United Kingdom", where the prototype has "Berkshire, England". A place with no county shows only "Ireland" or "United Kingdom".
50. **Standard-fact drill-down adds a third crumb, "Places with it" · m.** The prototype stops at "Facts / Duration".
51. **Wording written to Changes · m.**
    - Build: "Place corrected · <place> · <fact>". Prototype: "Answer corrected · <fact> · <place>".
    - Remove and Put back log "Active→Removed" and "Ignored→Active"; the prototype logs "Live→Removed" and "Removed→Live".
52. **Excluded facts: clicking a subcategory drops the Ignored filter · m.** The prototype sets `statusFilter:'ignored'` (`facts/Excluded.tsx:57`).
53. **Density, stickiness and hover titles · m.**
    - Line height is `normal` where the prototype inherits 1.55: rows 43px against 46, headers 37 against 42, tab strip 38 against 40, search 35 against 37.
    - Table headers are not sticky; the prototype's are `position:sticky` (T:412, 591; `kit.tsx:383`).
    - A truncated Subcategories cell has no hover title (T:417).
    - Edit pills are spaced 4px apart against 10px.
54. **Mobile: the sub-tab strip wraps · m.** "Excluded facts" and the (i) drop to a second row with a dangling left border (`facts/shared.tsx:105`).

### Facts: Verification and Accuracy

55. **Sources table numbers do not match the drill-downs they open · M.**
    - The table counts from `place_fact_evidence`; the drill-down reads `fact_checks` (`api/src/desk/verification.js:124-126` against `:171-181`).
    - Seeded result: Venue websites Checked 35, drill 28 items. Answered 23, drill 22. Families Checked 0, drill 6. (check b2f0468: its message says "a Sources number opens onto its own records".)
56. **A silent Families source reads Healthy · M.**
    - README: "A source that checked nothing while others were active is Failing."
    - The build exempts Families (`verification.js:145-146`). With Families at 0 checked it showed a lime "Healthy". (b2f0468's message says "families alone never fail a source", which is a deliberate deviation from the README that the owner needs to confirm.)
57. **"Failing %" comes from the wrong data · M.**
    - It is taken from all of that provider's 7-day `provider_calls`, including calls made for other purposes, not from verification checks.
    - Venue-website fetches are never logged there (`sources/catalogue.js:604` `calls: []`), so that row can only ever show "—" or be Failing by silence.
    - Wikipedia with 0 checked showed a red "0%" beside "Failing".
    - `verification.js:127-140`.
58. **The Dropped sub-line undercounts at the start of a month · M (behaviour).** "N this week · M the week before" counts only rows since the 1st of the month, so for the first 13 days it misses last month's drops. The amber rule reads that count. `verification.js:53, 72-76`.
59. **Accuracy toolbar breaks when the table is narrow · M.**
    - README: "one toolbar at the table's width … View by Fact · Category on the right".
    - The build sizes the toolbar and first column from the labels on show (`facts/Accuracy.tsx:100, 159`); the prototype sizes them from fact names only (L:3345-3346).
    - With a source picked, or in Category view, "View by" wraps to a second line on the left, and expanded subcategory names wrap.
    - Screenshots: D-b-acc-wikidata.png and D-b-acc-cat.png, against D-p-acc-cat.png.
60. **Sources column headers · m (copy question).** The build follows the template ("Checked · 7 days", "Failing"). README prose says "Checked (7 days)" and "Failing %".
61. **Verification drill: filters not in the address · m.** Country, county and feature are `useState` (`facts/Verification.tsx:268-270`).
62. **Accuracy chart · m.**
    - A lone measured month between gaps is a 3px dot.
    - A 30-day view where every day is under 10 answers is a blank plot, with the reason only on hover.
    - The "Today" label runs 4px past the plot.
    - `facts/Chart.tsx:104-106`.
63. **Density and headers · m.** Rows are about 38px against 42–44px, drill filter boxes 34px against 40px, and headers are not sticky (T:506, 713; `kit.tsx:383, 429-436`).
64. **Mobile: the Source segmented control wraps with stray left borders · m.** `facts/Accuracy.tsx:162`.

### Mapping

65. **Picker: "Make primary" cannot be clicked with a mouse · M.**
    - It shows only while the pointer is in the row's 14px right padding and disappears over the name or over the link itself.
    - A click where it was unticks the row instead. This happened during the audit and was logged as "museum · Art galleries removed".
    - `Picker.tsx:223-243`.
66. **Needs a decision: heritage_railway cannot be accepted · M.**
    - README: "heritage_railway → suggest Fun › Heritage railways (new subcategory)".
    - The seed has no `newSub` (`api/src/desk/proposals.js:33`, confirmed in source), so Repoint returns 400, "heritage-railways is not one of our subcategories" (`api/src/desk/mapping.js:422`).
    - "Change to" also drops "(new subcategory)".
67. **Needs a decision: church cannot be accepted · M.** Repoint returns 400, "landmarks-you-can-see is not one of our subcategories". `refreshProposals` raises proposals without checking the target subcategory exists (`proposals.js:90-103`).
68. **Keep on an unpointed word does not leave the view · M.**
    - README: "Once decided, the row leaves this view and the count drops."
    - After Keep, building_complex moved into "No suggestion — choose where it goes" and the count stayed the same. `mapping.js:186`.
69. **Places affected goes stale and counts the wrong thing · M.**
    - It is stored when the proposal is raised: planetarium shows 0 though the word brings in 2. Only narrowings are recounted.
    - For Repoint it stores "brings in", not "places that would actually … move" as README requires.
    - `proposals.js:102`, `mapping.js:235`.
70. **Mobile: the picker is unusable · M.** It is drawn inside the table's sideways-scrolling box. Tapping Points at after scrolling right opens the picker off-screen to the left. `Mapping.tsx:567-570`, `kit.tsx:459-474`. Screenshot: E-b-m-picker.png.
71. **Error toasts look like success · m.** The 400 messages show in the same lime toast (`Mapping.tsx:150`).
72. **Picker: the create-subcategory panel differs · m.**
    - The build adds a name box and an "in {Category}" line.
    - "Fold into instead" offers three drawers from the current category and adds a tick; the prototype offers three Culture drawers and repoints.
    - `Picker.tsx:270-285`.
73. **Picker opens on the primary's category · m.** The prototype always opens on Fun (`Picker.tsx:156`).
74. **In Epic: the opened word jumps to the top even when already listed · m.** `Mapping.tsx:251-255`.
75. **"Ever opened" sorts ascending first · m.** README: "other numbers default descending" (`Mapping.tsx:82, 480`).
76. **"Everything · N words" counts the current view · m.** The prototype counts every word not excluded (`Mapping.tsx:281`).
77. **Column widths · m.**
    - Not in Epic "Decided by": 150 against 110.
    - Decided "Why": fixed 360 against minmax(240, 420).
    - Needs "Change to": fixed 380 against minmax(260, 560).
    - `Mapping.tsx:472` and nearby.
78. **Decided: Undo only on each word's newest entry · m.** The prototype shows it on every entry (`mapping.js:585-591`; deliberate server logic).
79. **Filter, Sort and the picker's tab are not in the address · m (owner address rule).**
80. **Heights · m.** Rows 45px against 50, chips 22 against 27, picker tabs 36 against 42, "Create a new subcategory" 14 against 20.
81. **Title apostrophe · m.** ’ against '.

### Collections and See as a household

82. **Wrong set of collections · M.**
    - The design has 41 (L:430-474); the build has 40.
    - Missing: "Ten minutes away", "Worth the drive", "Costs nothing", "Cheap and cheerful".
    - Extra: "Something fun", "No rush", "Made by hand".
    - Titles use straight apostrophes.
    - Source: data in migrations 225 and 266.
83. **37 of 40 collections have no copy line · M.** The prototype gives every row one.
84. **The handover's rules were never written into the rows · M.**
    - The prototype's `ROW_RULES` (L:475-483) are not in the build. About 25 rows keep predicates over the dropped axes, so they count 0 and open in the editor with no pills.
    - "Households with an adult" never appears in the list (the prototype shows it for "Just the two of you" and "A day to yourself").
    - `api/src/desk/collections.js:58-75`. (check b2f0468: migration 270 is "the collections carry the handover's rules".)
85. **The editor's count disagrees with the list, and saving rewrites the row · M.**
    - "Too hot to think": list 25,440, editor "Returns nothing".
    - "Dry, and they can run": list 0, editor 23,116.
    - "Still light at nine": list 0, editor 85,613.
    - `api/src/desk/collections.js:58-75` against `84-97`.
86. **Examples go missing · M.** `preview()` looks for names only among the first 2,000 matching places (`collections.js:269`). With six subcategories, only 4 examples showed. When nothing is named, the panel shows a bare count with no reason.
87. **Save is blocked while a location is set · M.** The client wants at least one place *within reach*, which is always 0 here (item 18); the server checks the whole estate. `Collections.tsx:258` against `collections.js:345`.
88. **Changes shows internal keys · M.**
    - Build: "— → Subcategory: historic-houses", "Subcategory: climbing or ropes … · Ages 0 to 3".
    - Prototype: "Collection edited · <title>", with the rule in names (L:2247, 2252).
    - `api/src/desk/collections.js:402-411`.
89. **Empty pill groups are hidden completely · M or m (ambiguous).**
    - README: "Empty groups show nothing."
    - The prototype always draws the CATEGORY / SUB-CATEGORY / FACT kickers and leaves them empty (T:1296-1301).
    - The build draws neither kicker nor pills (`Collections.tsx:319`). The owner should say which reading he meant.
90. **See as a household: hearted rows always come first · M.** "The list" and "Inspire" therefore look the same; the prototype mixes hearted and unhearted in Inspire (L:2349-2355). `collections.js:496-498`, `Collections.tsx:548`.
91. **See as a household: shelves on the wrong rows · M.** The build shows shelves in Inspire only, including on unhearted rows. The prototype shows them on hearted, live, non-waiting rows in every state (L:2514; `Collections.tsx:624`).
92. **See as a household: row sub-lines missing · M.** Missing: "Nothing near you this week — it comes back when there is" and "N places near you" (`Collections.tsx:618`).
93. **See as a household: "Named rows" does nothing · M.** There is no "A day to yourself, Sarah" personalisation; "Seen as" changes only the header.
94. **See as a household: hearts cannot be changed · M.**
    - Heart icons are not clickable and there is no unheart link.
    - None of the toasts: "… hearted", "Hearts now attributed to X", "Seen as X".
    - `Collections.tsx:620-672`.
95. **See as a household: the five states are not in the address · M (owner rule).** The URL stays at `view=household`.
96. **Every layer replaces the history entry instead of pushing · M (owner rule "a move pushes").** From See as a household or an open editor, Back skips the Collections list and lands on Overview. The router's `setQuery` defaults to replace; the desk's `go` passes no push option.
97. **Location filter not in the address in the running build · M.** `?where=Ascot&reach=60` opens with an empty box. (check b2f0468: fixed in source, `kit.tsx:517-545`, but not served.)
98. **Age label · m.** An upper age of 99 shows as "99"; the prototype shows "60+" once the top is 60 or more (L:2169). An `ageSpan` rule is labelled "Everyone" (`collections.js:103-105`).
99. **Clicking the open row closes the editor · m.** The prototype reopens it (`Collections.tsx:204`).
100. **Drawer facts · m.**
     - Order follows `place_attributes.position`, not the prototype's fixed list.
     - The age row is "Suits ages", not "Who is it for".
     - Duration shows "N hours", not "2–3 hours".
     - `collections.js:313-328`.
101. **Density and colours · m.**
     - Line height `normal`: rows 54px against 64, buttons 34 against 40.
     - Selected row `#1f1d1c` against `#232120` (L:2194).
     - Phone surround `#141212` against `#0d0c0c`.
     - The "Collections" crumb is underlined.
102. **The phone preview filters rows by audience and minimum places · m.** The prototype shows every live row. This fits handover decision D11.

### Fact automations

103. **Header counts missing · M against the prototype.**
     - The prototype has VERIFIED · CONFLICTS · DON'T KNOW · BACKLOG, each with a hover card and a link to its drill-down (T:357-362, L:1216-1224).
     - The build has none (`Automations.tsx:146-149`).
     - README v2 does not list them for this screen, and README Housekeeping still speaks of "Verification's Conflicts number", which the build shows nowhere (auditor D found a `conflicts` count in the API that is never drawn). The owner needs to rule.
104. **The "HOW EPIC GROWS ITS KNOWLEDGE" box is missing · m.** It is in the prototype (T:365-368). This is probably a deliberate omission under the no-info-box and no-prose rules, but the code does not say so.

Everything else on this screen matches the prototype word for word: the intro line, all 13 sentences across the five steps, the four info notes and the Housekeeping line.

### Changes

105. **The page scrolls sideways at 1440 · M.**
     - Columns are fixed at 120/150/140/380/360; the prototype's Who is 100 and "What changed" is `flex:1`.
     - Document scrollWidth is 1462 on a 1440 window, and Before → After is clipped.
     - `Changes.tsx:32-38`.
106. **Collections rows show raw keys · M.** Same as item 88.
107. **Mapping "Keep" row · M.**
     - Build: "Exclude → Kept — proposal declined" (the proposal's text as Before), then the same words again as the Why.
     - Prototype: `pointsLabel(before) → pointsLabel(after)`, with Why "Kept — proposal declined" (L:751, 2876).
     - `api/src/desk/mapping.js:508`.
108. **Search scope · m.** The prototype searches what, before, after, who and area (L:1606). The build searches what, before, after and why, but not who or area (`api/src/desk/changes.js:55-58`).
109. **Person filter order · m.** By count, not alphabetical (`changes.js:66`).

### How it works

110. **Page frame · M.**
     - Prototype (T:1507-1522): the desk's top tabs stay; a "Business mechanics" document tab (15px/800, lime rule) sits above; a 230px sticky jump list on the left holds the eleven numbered titles (active 800 with a lime left rule).
     - Build: a separate rail screen with no desk tabs and no document tab. The section list is an inline row of short links under the intro, and a page title (31px) with a prose line is added.
     - `screens/HowItWorks.tsx:216-222, 1250-1253`.
111. **Three desk screens lost their link into the page · M.**
     - In the prototype, the (i) on the Categories list (T:100) and on the subcategory page (T:220) links to section 2, and the one on Mapping (T:1131) links to section 3.
     - In the build these are hover text only: `Categories.tsx:160`, `categories/SubPage.tsx:114`, `Mapping.tsx:293`.
     - Only the Facts sub-tab strip links in (to section 5, correctly).
     - `HowIcon.tsx` is unused by the desk.
112. **Four sections rewritten against the v2 document · M.**
     - §1: Fact sheets → The fact pipeline; Ideas → Collections; "ages" → "who it's for" (`:233-244`).
     - §4: the diagram and paragraph are rewritten, and a "What an answer can be" table is added (`:299-324`).
     - §5: Set check → Subcategory check; the standard-check example is changed; a "What the bands mean" block is added (`:329-343`).
     - §7: the four-box harvest diagram is replaced by the five pipeline steps, and "Once approved, the check is asked of every place its fact sheet covers…" is dropped (`:367-388`).
     - §11: the table is re-rowed ("Fact sheets" goes from Proposed to Replaced; Collections Built; the pipeline row added); the corpus row loses "159 tokens" and "2,382 facts"; the column widths change (`:454-465`).
     - Most of this is the requested update for Collections and the pipeline. But §4, §5 and the corpus figures in §11 go beyond the rename and should be read by the owner.
113. **Content added to six more sections · m.** §2 gains a primary/secondary paragraph; §3 gains "How a word is decided"; §6 gains five bullets; §8 gains four bullets and three paragraphs; §9 gains a paragraph; §10 gains "Every count carries its scope". The opening rename note grows to two paragraphs.
114. **"waiting" where README says "Backlog" · M.** README: "The word is 'Backlog' everywhere — never 'Waiting'." The page says "waiting to be checked" twice (`HowItWorks.tsx:322, 384`). README Housekeeping says "dropped"; the page says "deleted".
115. **"disagreement" used for a default its places contradict · m.** README reserves "disagreement" for the machine against families (`:356, 361`).
116. **Pipeline numbers are hard-coded · M.** 1 mention, 2 reviews, 1 source, 2 places, 90%, 12/6/6 months, 1 question, 2/2 families, 30 days, 5%/15% and 10 answers are typed into the page (`:374-388, 416`), not read from Fact automations. When `spotMentions` was changed in `bo_view`, the page still said "1 mention".
117. **Counts disagree with the live desk · m.** "72 subcategories" against 51 on Categories; "41 collections" against 40 (`:242, 463`).
118. **Stale reference · m.** Part two's decision log points to "back office › Shelves" and uses "shelves"/"moods" wording (`:899-903`); there is no Shelves screen.
119. **The old `?at=defaults` anchor lands on §4 · m.** The prototype sends Defaults to §6 (`routes.ts:311`).
120. **Section titles differ from the prototype's list · m.** Examples: "7. How a fact gets born" against "7. How a check gets born"; longer titles for §5 and §8 (`:164-176`).
121. **Surface colours · m.** The page uses the app's palette (ground `#151413`, text `#F3F1EC`, muted `#A8A4A2`) and moss link rules, not the desk tokens and lime (`:1322-1363`).
122. **The handover's "disputed before" rule is missing from §7 · m.**

### Cross-cutting findings

123. **Glyph characters used as icons · M (owner rule, not applied).** CLAUDE.md: "Never an emoji or a symbol character (★ ♥ ✕ ✓ …) as an icon." The build still uses:
     - "×" as a remove icon: `Mapping.tsx:329`, `Collections.tsx:331`, and the location chip at `kit.tsx:626`;
     - "↑"/"↓" as the sort mark: `kit.tsx:409`, and in the Mapping Sort button label at `Mapping.tsx:323`;
     - "←" in the drill-down back link: `facts/shared.tsx:135`.
124. **The sorted column's arrow is lime; the prototype draws it in the header colour · m.** `kit.tsx:411`.
125. **Line height and table density are tighter everywhere · m.** RN `normal` against the prototype's inherited 1.55: rows are 3–10px shorter across all tables. Headers are never sticky.
126. **Sort ties are not broken by name anywhere · m.** `kit.tsx` `sortRows`.
127. **Background research overwrote seeded place names in `bo_view` · environment note, not design.** Auditors C and F both saw their seeded `place_records` names and postcodes set to null by a background research pass (`enrich_state='partial'`). It is worth checking whether that pass can also null real records.

---

## 3. Additions: in the build, not in the designs

**Chrome**
- A Dark/Light switch in the rail and the phone header.
- The SpendAlarm banner above the tab strip. It appeared once seeded spend passed 80% of the daily ceiling and pushes the chrome down.

**Overview**
- A red Sources state, "Venue website, Wikipedia failing".
- Grey can't-speak tiles: Sources "Not asked yet", Accuracy "Building · N family answers so far".

**Changes**
- An "Undone N min ago by …" line.
- Extra "Undo · …" rows.
- A "The newest N of M" footer.

**Runs**
- A Runs / Decision log switch.

**Categories**
- A "Related subcategories" line.
- "Counting the places it reaches" in the bulk bar.
- "+" (at least) counts when 120 minutes is capped at 90.
- A "showing the first N" note.
- "today" as an Added value.

**Facts**
- "Include anyway" on Excluded facts (handover C41).
- Undo on the Remove, Edit and Put back toasts.
- The places number opens the drill-down for every fact.
- A "The first N of M" line on capped lists.

**Verification and Accuracy**
- Stalled requires a non-empty backlog, and the banner names the real hours.
- Health-view sub-tables are sorted worst first.
- Staff corrections are counted inside "family answers".
- Hover on a thin month reads "Building · N answers · Month".

**Mapping**
- A name box and an "in {Category}" line in create-subcategory.
- "Nothing called that."
- "The newest N of M" on Decided.
- A tip on the Ever opened header.
- On a phone, "Make primary" shows on tap.

**Collections**
- A "NOT SHOWN HERE · N" list with reasons.
- A Household dropdown.
- Empty-state lines.
- Save labels "Counting…", "Saving…", "Returns nothing", "Give it a title", "Add a rule".
- A permission toast.
- A red error line.

**How it works**
- Part two: a routing banner, "What we owe", seven decision-log panels, and "Keeping this page honest".
- A moss rule marking the section a link landed on.

## 4. Deliberate deviations, verified as following an owner rule

- **Numbers typed into a box, never − / +.**
  - Fact automations: Enter or blur commits, the value is clamped, and it shows lime 14/800 in a 1px `#46413f` well.
  - Collections: Ages and Duration boxes.
- **Undo on Fact automations settings.** The toast reads "Rule changed · 1 → 3 · Undo" and lasts about 4.4–4.5s (measured 4,435ms). The change is restored on Undo, persists on reload, and is logged in Changes. The prototype has no Undo here; README asks for it.
- **Lucide icons** for info, chevrons, ticks, plus, "…", tags, hearts, the editor and drawer ×, and the How it works arrows. Exceptions are in item 123.
- **Square corners and Archivo only** everywhere checked.
- **Brand lime `#C8F542`** instead of the README's `oklch(0.90 0.20 125)` (≈ `#C0F447`), per CLAUDE.md brand rule. Amber `#FCB442` and red `#FF6A65` are the README's oklch values converted exactly.
- **Can't-speak states:**
  - "Building" under 10 answers everywhere, including the source control (the prototype prints a number);
  - "—" for Families Failing %;
  - "Never run" with nothing below it;
  - "—" for engagement until real households;
  - Ever opened "—" with a reason.
  - Exceptions are items 18, 40 and 57.
- **Tables compact and left-aligned** (README table rule) where the prototype centres or right-aligns numbers.
- **The (i) shows its text on hover** (README), rather than jumping to How it works. This is why items 111 lose their links: the README and the prototype pull in different directions here.
- **Addresses:**
  - Categories: `q`, `cat`, `view=new`, `sub`, `state`, `fact`.
  - Facts: `ftab`, `fact`, `places`, `sub`.
  - Verification and Accuracy: `period`, `view`, `src`, `by`, `chart`, `kind`, `key`.
  - Mapping: `view`, `word`, `kind`, `q`.
  - Collections: `collection`, `place`.
  - How it works: `?at=`, and old spellings (`?tab=ideas`) are rewritten.
  - Exceptions are items 42, 61, 79, 95, 96 and 97.
- **Setting defaults `recheckAccess` = 6 months and `verifySources` = 1** differ from README and the prototype. Both are owner decisions (C35, C51) in "Epic - Back office handover.md" §12. The 90% ignore threshold and the Free · Cheap · Mid · Dear cost band also follow the handover.
- **Runs has no start or stop buttons.** The prototype's "Run the sweep", "Run the harvest", "Validate them" and "Stop it" are gone, per README's "no buttons that start jobs".
- **Rail lighting follows README over the prototype:** Categories is lit on its list and subcategory pages; nothing is lit on Facts, Mapping, Collections, Changes or Fact automations. The prototype lit Categories on Verification.
- **Mapping drops the Flags filter and sort options,** consistent with "No Flags column". The Excluded box in How it works is dashed grey, not red (red is kept for danger).
- **Mobile tables scroll sideways in their own box** on every screen checked. Exceptions are items 8, 15, 70 and 105.

## 5. Could not check, and why

- **Real reach numbers:** `bo_view` has no place coordinates and about 78 census rows, so every within-reach count is 0 (item 18). No isochrones.
- **"Nothing needs you.", "Stalled" and Sources amber on Overview:** not reached (the mapping queue is never empty); checked in code only.
- **Backlog amber:** the seeded history always fell over the period; the rule was checked in code and is identical to the prototype.
- **Mobile scrolling by touch on a real device:** the frame-scroll failure (item 4) rests on DOM measurement and a headless wheel.
- **The prototype's own How page:** its frame loads `how-it-works/business-mechanics.html`, which returns 404. The v2 document was injected into that frame for the comparison.
- **Real "Ever opened" and engagement numbers:** no events are recorded.
- **Creating a new subcategory end to end from the Mapping picker:** skipped to avoid disturbing the Categories auditors.
- **The Accept path for the tourist_attraction "Stop filing" proposal:** no proposal is raised for it in `bo_view`.
- **Real account names:** every write is attributed to "the owner (passcode)".
- **b2f0468 and the uncommitted worktree edits:** these arrived during the audit and were not audited. Items 55, 56, 84 and 97 may be fixed there, and should be re-checked once the bundle is rebuilt.
- **Light mode.**
- **One console 401 on every build screen:** not traced.
- **Account for counts:** other auditors were seeding `bo_view` in parallel, so absolute counts drifted during the audit.

**Seeds added to `bo_view`.** These are additions only, tagged where possible:
- Auditor A: `provider_calls` rows (removed again); a play ↔ theme-parks link; a Parking=Yes bulk default on play and theme-parks; collection "A-audit castles".
- Auditor B: `b-*` place_attributes; subcategory_facts and answers; a machine Parking proposal on climbing; a Duration default on riding-stables set by "Sarah K".
- Auditor C: `c-audit:*` places, facts and answers.
- Auditor D: 71 `fact_suggestions`, about 110 `fact_checks`, `place_fact_evidence`, 200 `provider_calls` ("D-audit seed"), 4 households, 80 `family_answers`.
- Auditor E: 237 `word_targets` backfilled from `points_at`, about 360 `place_index_labels`, and 6 Google words ("E-audit seed"). It also ran `refreshProposals()` once.
  - Why the backfill was needed: at 11:15 something rewrote `points_at` on 478 words without touching `word_targets`, which moved 236 mapped words into Needs a decision.
  - The older routes that still write `points_at` alone (`routes/taxonomy.js:1629/1724`, `taxonomyAudit.js`, `taxonomyLabels.js:316`) are a live risk to the Mapping views.
- Auditor F: 18 place names, 3 `place_attribute_values`, household "F-audit family", collection `f-audit-climb-and-ropes`.

## 6. Key screenshots (in `/tmp/bo-audit/`)

| What | Prototype | Build |
|---|---|---|
| Overview | `p-initial.png`, `A-p-overview.png` | `b-overview.png`, `A-b-overview.png`, `A-b-overview-amber.png`, `A-b-overview-red.png`; Mobile `A-b-m-overview*.png` |
| Breadcrumb | `A-p-crumb.png` | `A-b-crumb.png` |
| Fact automations | `A-p-automations.png` | `A-b-automations.png`, `A-b-auto-toast.png`, `A-b-m-automations.png` |
| Changes | `A-p-changes.png` | `A-b-changes.png`, `A-b-changes-filtered.png`, `A-b-m-changes.png` |
| Categories list | `B-proto-list.png` | `B-build-list.png` |
| Bulk bar | `B-proto-bulk4.png` | `B-build-bulk4.png`, `B-build-reach-over-bulk.png`, `B-build-m-bulk.png` |
| Location filter | `B-proto-loc-transit.png` | `B-build-loc-transit.png`, `F-b-loc.png`, `F-b-loc-unknown.png` |
| Subcategory page | `B-proto-subpage.png` | `B-build-subpage.png`, `B-build-sp-change.png`, `B-build-review.png` |
| Edit crash | — | `B-build-fact-edit.png` |
| All facts | `C-p-allfacts.png` | `C-b-allfacts.png`, `C-b-tip.png` |
| Fact page and standard facts | `C-p-factpage-wave.png`, `C-p-std-*.png` | `C-b-fact-*.png` |
| Drill-down | `C-p-drill-wave.png` | `C-b-drill-wave-lidos.png` |
| Excluded facts | `C-p-excluded.png` | `C-b-excluded.png`, `C-b-putback-toast.png` |
| Verification | `D-p-verif-{never,stalled,running,hover,24h}.png` | `D-b-verif-{never,stalled,running,hover,24h}.png` |
| Accuracy | `D-p-acc.png`, `D-p-acc-wikidata.png`, `D-p-acc-cat.png` | `D-b-acc.png`, `D-b-acc-wikidata.png`, `D-b-acc-cat.png`, `D-b-acc-30d.png` |
| Health view | `D-p-health-src.png` | `D-b-health-src.png` |
| Mobile frame not scrolling | — | `D-b-verif-mobile*.png`, `D-b-acc-mobile*.png` |
| Mapping In Epic | `E-p-inepic.png` | `E-b-inepic.png` |
| Picker | `E-p-picker.png` | `E-b-picker.png`, `E-b-picker-hover.png`, `E-b-m-picker.png` |
| Needs a decision | `E-p-needs.png` | `E-b-needs.png`, `E-b-needs-heritage.png` |
| Decided | `E-p-decided.png` | `E-b-decided.png` |
| Collections list | `F-p-list.png` | `F-b-list.png` |
| Collections editor | `F-p-new-empty.png`, `F-p-edit-gethigh.png` | `F-b-new-empty.png`, `F-b-edit-water.png`, `F-b-new-not.png` |
| Place drawer | `F-p-drawer.png` | `F-b-drawer.png`, `F-b-m-drawer.png` |
| See as a household | `F-p-house-*.png` | `F-b-house-*.png` |
| How it works | `G-p-how-v2injected.png` | `G-b-how-top.png`, `G-b-at-*.png`, `G-b-mobile-*.png` |
