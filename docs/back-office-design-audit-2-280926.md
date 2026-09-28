# Back office: design audit, second pass (28 Sep 2026)

This audit was independent and only reported: no source file was edited and no git command was run. I split the work across six area auditors, each working to the same brief (`/tmp/bo-audit2/BRIEF.md`). Their full area reports are in `/tmp/bo-audit2/{CH,CAT,FAC,MAP,COL,HOW}-report.txt`, and every screenshot is at `/tmp/bo-audit2/<AREA>-*.png`.

**Spec.** README v2, which wins on layout and copy. After that, the prototype (`/tmp/proto/template.html`, `/tmp/proto/logic.js`), the handover and the decisions register.

**Build.** Worktree `epic-wt-backoffice` at commit **f6c2a0e**, with web on :8083, API on :4002 and the throwaway database `bo_view`. Each auditor checked that the served bundle was **not stale**: every fix-pass item was visible on screen.

## Read first: three caveats

1. **The tree moved during the audit.** By 15:30, about 45 files in the worktree had changed since f6c2a0e. Nothing is committed, and there are new migrations `272_…` and `273_…`. Some comments in the changed code cite this audit's own findings, for example "second audit CH.1" and "second audit CH.10", so another session is already acting on it. Two things follow from that:
   - Every finding below describes the f6c2a0e build **as it was served during the audit**. The file:line references are to that source and may have shifted.
   - The new edits have **not been audited**. The Collections auditor also saw Expo hot-reload the page twice mid-test, so a few late screenshots may show partly-edited code. Those were rechecked in single runs.
2. **The shared session was rate-limited.** The Collections location-filter loop (COL.1) made the one shared API session return 429 for about 4 minutes, around 12:47 and again later. While the 429s lasted, the shell drew "That is not a page you can open" (X.1). Screenshots flagged "taken during 429" are marked in the area reports and are not used as evidence.
3. **The test data is thin and was disturbed mid-run.** `bo_view` holds no place labels and almost no census, so the audit checked how the screen draws when it can't give a count, not real reach counts. The background own-research worker also cleared seeded place names and postcodes at 12:44, and the Facts auditor restored them.

## Verdict per screen

| Screen | Verdict |
|---|---|
| Global chrome (tabs, toast + Undo, crumbs, history) | Minor differences |
| Overview | Minor differences |
| Categories: subcategory list | Minor differences |
| Categories: bulk bar | **Material differences** (CAT.1) |
| Categories: location filter | Matches |
| Categories: subcategory page (Defaults, Facts, Copy facts) | Minor differences |
| Categories: Review / inspect view | Matches |
| Categories: New facts | Matches |
| Categories: a fact at a subcategory + Edit | Matches |
| Facts: All facts | Minor differences |
| Facts: fact page, incl. standard definitions | Minor differences |
| Facts: places drill-down | **Material differences** (FAC.2) |
| Facts: Verification, all states | Minor differences (plus FAC.1, which runs across the Facts screens) |
| Facts: Accuracy + health view | **Material differences** (FAC.1, FAC.3) |
| Facts: Excluded facts | Matches |
| Mapping: In Epic | Minor differences |
| Mapping: picker | Minor differences |
| Mapping: "…" menu + confirm | Matches |
| Mapping: Needs a decision | Matches |
| Mapping: Not in Epic | Matches (README columns win over the prototype's extra two) |
| Mapping: Decided + Undo | Matches |
| Collections: list | Minor differences |
| Collections: editor | **Material differences** (COL.1, COL.5, COL.6) |
| Collections: place drawer | Matches (cosmetic only) |
| Collections: Changes entries | Matches |
| Collections: See as a household | **Material differences** (COL.2, COL.8) |
| Collections: data written by migration 270 | **Material differences** (COL.3, COL.4) |
| Fact automations | Layout matches; **one material bug** (CH.1) |
| Changes | Matches (cosmetic only) |
| Runs | Minor differences; **one material can't-speak fault** (CH.2) |
| How it works (both document tabs, jump list, anchors, live numbers) | Minor differences |
| Mobile frame (390) overall | Minor differences |

## Remaining discrepancies

Each entry gives the screen · state · design · build · severity · build file:line, where file:line is as served at f6c2a0e.

### Chrome, Overview, Fact automations, Changes, Runs

- **CH.1** · Fact automations · typing letters into a setting box.
  - Design: a typed box saves only a number (typed boxes are an owner rule; the prototype cannot produce an invalid value).
  - Build: "abc" → 0 → clamped to the minimum → **saved**. familiesWrong went 2 → 1 with the toast "Rule changed · 2 → 1". The auditor undid it.
  - **Material** · `apps/web/src/admin/desk/Automations.tsx:283-286`
- **CH.2** · Runs · nothing has run.
  - Design: the owner's can't-speak rule.
  - Build: says "The queue held level last week" over "0 fact sheets · 0 words raised". "Nothing raised and nothing decided" is in lime, and Saturation is blank with no reason.
  - **Material** · `apps/api/src/domain/runFunnel.js:118-125`, `apps/web/src/admin/filing/Runs.tsx:107`
- **CH.3** · Overview · Health › Verification with an empty backlog.
  - Design: README l.74, "Running · last checked 4 min ago" / "Stalled …".
  - Build: green "Running · last checked 2 hours ago". A stall is only declared when the backlog is above 0, so the green is shown with no proof the verifier is alive.
  - Minor · `apps/api/src/desk/verification.js:25-28`, `overview.js:78-82`
- **CH.4** · Overview · Spend tile and "Recent runs and spend →".
  - Design: README l.77-80, each linking to its page.
  - Build: both go to Runs, which shows no monthly spend.
  - Minor · `Overview.tsx:113,221`, `RunsScreen.tsx`
- **CH.5** · Changes · search.
  - Design: plain substring (logic.js 1605-1606).
  - Build: `%` and `_` are passed to ILIKE unescaped, so each matches every row.
  - Minor · `apps/api/src/desk/changes.js:51`
- **CH.6** · Changes · the entry for a setting change.
  - Design: README principle 2, every decision keeps its reason, who and when.
  - Build: the "What changed" text is taken from the client's request body.
  - Minor · `apps/api/src/routes/desk.js:118`, `settings.js:167`
- **CH.7** · Collections list · sort.
  - Design: common.md, "sorts are part of the address".
  - Build: the sort is held in local state.
  - Minor · `Collections.tsx:110`
- **CH.8** · Mobile 390 · Fact automations and Changes.
  - Design: owner rule, content fits 390.
  - Build: the steps table sits inside Wide min 900, so every setting box is off-frame. Changes shows only When/Who/Area on the phone.
  - Minor · `Automations.tsx:208,251`, `kit.tsx:494-503`
- **CH.9** · Mobile tab strip.
  - Design: A.2, the lit tab scrolls into view.
  - Build: once, "Fact automations" was left off-strip. It was fine on a repeat, so this is intermittent.
  - Minor · `Desk.tsx:185-190`
- **CH.10** · Chrome at 1440×900.
  - Design: one page scroll.
  - Build: the rail is taller than the window, so the window scrolls as well as the desk and a blank band shows under the desk.
  - Minor · AdminApp rail, `Desk.tsx:126`
- **CH.11** · Overview · COLLECTIONS tile that can speak but has an empty list.
  - Design: template, "—" plus the reason "Appears once there are real households".
  - Build: a bare "—".
  - Cosmetic · `Overview.tsx:183-188`
- **CH.12** · Changes rows.
  - Design: `align-items: baseline`, Who menu 180 wide.
  - Build: flex-start, Who menu 240.
  - Cosmetic · `Changes.tsx:97,108`
- **CH.13** · Verification drill reached from Automations › CONFLICTS.
  - Design: logic.js 1815 crumb, "Facts / Conflict".
  - Build: the crumb ends "Facts / Verification" under the page title "Conflicts".
  - Minor · facts/Verification

### Categories

- **CAT.1** · Bulk bar · reopening the fact dropdown after choosing a value (Web and Mobile).
  - Design: a dropdown draws over what is below it (template 118).
  - Build: the bar's own "Applies to N places…" row and the Set button draw over the list. At 1440 "Indoors" cannot be clicked; on Mobile "Food on site" is covered the same way.
  - **Material** · `Categories.tsx:461` (no zIndex) vs `:487`
- **CAT.2** · List · the Related "×", and the "+" in the adder, are text glyphs, not Icon.
  - Design: owner rule.
  - Minor · `Categories.tsx:315,358`
- **CAT.3** · List · sort has no name tie-break.
  - Design: logic.js 1126-1130 `|| a.name.localeCompare(b.name)`.
  - Minor · `Categories.tsx:148`
- **CAT.4** · Subcategory page · Defaults · an unset default reads "The places disagree, so each answers for itself" even with 0 confirmed places.
  - Design: logic.js 1369 uses it only when the places are Mixed; can't-speak rule.
  - Minor · `apps/api/src/desk/categories.js:439`, `SubPage.tsx:215`
- **CAT.5** · Changes wording for single-default writes.
  - Design: logic.js 1363 "Default · <label> · <sub>"; 1374 "Default accepted · …", Proposed → value; 1341 for a bulk Set on one row.
  - Build: "<sub> · <fact>", "(proposed)" → "(accepted)", and a one-row bulk Set takes the single path.
  - Minor · `categories.js:672-673,707`
- **CAT.6** · Copy facts · offers subcategories that have nothing new to copy; clicking one gives an error toast.
  - Minor · `categories.js:463-469,495`
- **CAT.7** · Commentary copy.
  - Design: README, "No commentary captions in the UI".
  - Build: the Review subtitle "· the default, and what each confirmed place says", and the empty Copy panel's sentence.
  - Cosmetic · `Review.tsx:45`, `SubPage.tsx:249`
- **CAT.8** · Mobile 390 · the Defaults table has no phone layout. It scrolls sideways, so Set by, Basis, Review and Change are off-screen, and the Change pills open off-screen.
  - Minor · `kit.tsx:494-509` (Table HScroll)
- **CAT.9** · A fact at a subcategory · a place with no name shows its raw `google:` reference, where Review says "A place we cannot name".
  - Minor · `facts/AllFacts.tsx:399,413`
- **CAT.10** · Spacing.
  - Design: default-option pill gap 4px (template 234).
  - Build: 6px; "Don't know" wraps in the 150px Edit cell.
  - Cosmetic · `SubPage.tsx:201`

### Facts

- **FAC.1** · All Facts screens · a reload fails or is still loading.
  - Design: README l.140, "never an empty page that looks fine"; can't-speak.
  - Build: the last data stays drawn with no error. Accuracy drew monthly dots under "Last 30 days" labels. Returning to the same address never fetched again.
  - **Material** · `facts/shared.tsx:36-54` (catch :49); LoadLine shown only with no data at `AllFacts.tsx:144,363`, `Accuracy.tsx:147`, `Verification.tsx:119,126`, `Excluded.tsx:50`
- **FAC.2** · Places drill-down · Duration, Who is it for and Cost band at 1440.
  - Design: How we know is flexible (template 272-279).
  - Build: fixed columns come to about 914px in about 812px, so the table runs under the Verification column; row 1's "Edit" sits over "None yet."
  - **Material** · `AllFacts.tsx:356-360,392-393`
- **FAC.3** · Accuracy · after an Edit is undone.
  - Design: handover 6.3, Undo puts the place back exactly.
  - Build: the `fact_corrections` row is not deleted, so Accuracy still counts the undone correction as a disagreement. The evidence row `r2fac:p2` is left in bo_view.
  - **Material** · `apps/api/src/desk/facts.js:443` (insert at :424)
- **FAC.4** · Drill · Edit on a yes/no fact: "Don't know" wraps and the row grows; the prototype's pills stay on one line (template 276).
  - Minor · `AllFacts.tsx:403`
- **FAC.5** · Chart hover on the last point: the 240px tip is not clamped, so the next card paints over it.
  - Minor · `facts/Chart.tsx:155`
- **FAC.6** · Verification Sources · Wikipedia is Failing (correct), but its Failing-column tooltip says "nothing fetched, so nothing can fail".
  - Minor · `apps/api/src/desk/verification.js:168-171` vs `:182`
- **FAC.7** · Accuracy with no family answers: the first column falls to its minimum, so "View by" wraps at 1440. A.15 is only partly fixed.
  - Minor · `Accuracy.tsx:115-117,178`
- **FAC.8** · Accuracy · a 28-character fact name makes the table overhang the rule by about 13px, and the toolbar no longer lines up with it. The prototype's formula does the same.
  - Cosmetic · `Accuracy.tsx:126,178`
- **FAC.9** · Accuracy health view · the disagreements search and the open category rows are local state, not in the address.
  - Minor · `Accuracy.tsx:90,289`
- **FAC.10** · Verification Sources on Mobile: Status, the column meant to prompt action, is behind a sideways scroll.
  - Minor · `Verification.tsx:230-238`
- **FAC.11** · All facts rows are 42px against the prototype's 46 (11px 8px padding), so A.19 is only partly met. The 200px vs 150px columns are deliberate.
  - Cosmetic · `AllFacts.tsx:95-97,148`
- **FAC.12** · Standard definitions read "Under 1 hour" where the prototype has "Under an hour"; the band tables are fixed width.
  - Cosmetic · `apps/api/src/desk/facts.js:204-217`
- **FAC.13** · Fact page · the subcategories table is fixed width where the prototype stretches it. This follows README's compact-table rule.
  - Cosmetic · `AllFacts.tsx:265-268`
- **FAC.14** · Verification drill · an unnamed place shows its raw reference.
  - Minor · `Verification.tsx:318`

### Mapping

- **MAP.1** · Sort button label uses the text arrows ↓ / ↑ (owner rule: Icon only).
  - Minor · `Mapping.tsx:364`
- **MAP.2** · Picker rows are 29px (categories 42) against the prototype's 35 (53); the Text has no line height.
  - Cosmetic · `Picker.tsx:221-223,245-250`
- **MAP.3** · Picker on a phone browser.
  - Design: README l.179, "Make primary" on hover.
  - Build: the `!web` gate covers native only, so a phone browser depends on emulated hover, and the hint still says "hover".
  - Minor · `Picker.tsx:211,239-259`
- **MAP.4** · Picker placeholder is cut to "Search every subcategory an" in the 390 frame.
  - Cosmetic · `Picker.tsx:194`
- **MAP.5** · Undo of an accepted heritage_railway proposal.
  - Design: README, "Undo restores before and reopens the proposal".
  - Build: the Fun › Heritage railways drawer it created stays active, and the reopened proposal still says "(new subcategory)".
  - Minor · `apps/api/src/desk/mapping.js:565,617-647`, `proposals.js:71`
- **MAP.6** · Data · `stable` points nowhere, but an older labels rule `google:stable → riding-stables` still files its places. Migration 269 syncs points_at ↔ word_targets only.
  - Minor · `mapping.js:195-198`, migration 269
- **MAP.7** · Data model · "Primary: always exactly one" (README l.179) is not enforced by the database: a word can have targets and no primary.
  - Minor · migration 269
- **MAP.8** · Error line · the style is red as fixed, but a network failure reads the raw "Failed to fetch". C.7 is only partly fixed.
  - Minor · `Mapping.tsx:187,428` (kit `saidOf`)

### Collections

- **COL.1** · List and editor · with any location set, the list refetches about 20 times a second. This trips the API's 429 limit (900 per 5 min) for every client.
  - Cause: `loc` is a new object each render, and `useMemo` keys on it.
  - **Material** · `Collections.tsx:112-121`, `kit.tsx:572-587`
- **COL.2** · See as a household · any state change wipes the hearts made in the preview. Each state click refetches because of the same unstable `loc`, and each fetch resets the hearts from the database, so Inspire mixing (logic.js 2349-2355) and the Waiting row never show the tester's hearts.
  - **Material** · `Collections.tsx:598-609`
- **COL.3** · Migration 270 · 19 handover rows it gave a rule stay `active=false`, including A day to yourself, Big kids, Sneakily educational and Still light at nine.
  - Design: logic.js 2335/2468, "Every row is live".
  - Build: The list leaves them out; Named rows draws three of five as "NOT READY YET"; the desk list shows switched-off rows with no marker.
  - **Material**, and possibly the owner's call · migration 270 (leaves `active` alone deliberately); `Collections.tsx:210-236`
- **COL.4** · Migration 270 · "not" is used for a recorded No.
  - Design: handover, Outdoors = indoors **No**; No booking required = booking **No**.
  - Build: 270 wrote `{indoor, not:true}` and `{booking-required, not:true}`, which means "no yes recorded". Still light at nine counts 107,060 places. Cheap and cheerful's predicate (recorded No) and its rule (no yes) disagree, so the desk count and what a household sees can differ; `collections.js:108-110` says they are not equivalent.
  - **Material** · migration 270, rows cheapcheerful, stilllight and quiet
- **COL.5** · Editor · parts of two rules can't be seen.
  - Sneakily educational: `primaryCat 'fun'` narrows the count but shows no pill and cannot be cleared.
  - Big kids: `ageSpan` makes "12 to 60" mean "≤12 to ≥60" while the boxes look like an overlap.
  - **Material** · `Collections.tsx:76,349-373`
- **COL.6** · Editor · the preview for "not Adrenaline" (113,798 places) took 9.4s: nameless places are described 200 at a time, one batch after another. Meanwhile the count and examples show the previous rule.
  - **Material** · `apps/api/src/desk/collections.js:359-371`, `Collections.tsx:400-404`
- **COL.7** · See as a household · shelves look for names only in the first 12 matches, the same fault C.18 fixed for the preview. On the water's shelf is empty although it holds named places, and an empty shelf draws nothing.
  - Minor · `collections.js:629,636`, `Collections.tsx:717`
- **COL.8** · See as a household · "N places near you" and WAITING are judged on the desk filter (the whole estate), not on the household's reach.
  - Minor, bordering material · `collections.js:577-578` vs `601-602`
- **COL.9** · See as a household · fading hearts are never listed.
  - Design: logic.js 2476, "hearted 5 months ago · fading".
  - Minor · `Collections.tsx:604-605,780-784`
- **COL.10** · Migration 270 · older predicates that still worked were left, and they differ from ROW_RULES.
  - beachoff = indoor AND not coast; the handover says "Indoors, or outdoors and not the coast".
  - dog, toohot and gethigh also differ.
  - The grouping labels keep straight apostrophes.
  - Minor · migration 270
- **COL.11** · Editor · the older-form sentence for retired axes drops the thresholds ("How much you learn and How much planning").
  - Minor · `collections.js:147-148`
- **COL.12** · List row height 62.5px against the prototype's 64.5, so C.26 is only partly met.
  - Cosmetic · `Collections.tsx:216`
- **COL.13** · Open row while hovered: the hover colour #1f1d1c paints over the picked #232120.
  - Cosmetic · `Collections.tsx:215-216`, `kit.tsx:467`
- **COL.14** · Drawer IN COLLECTIONS is not capped; the prototype caps it at 8 (logic.js 1916).
  - Cosmetic · `collections.js:404`
- **COL.15** · Waiting row with nothing waiting: the build says "No hearted row is waiting here."; the prototype falls back to the dog row.
  - Cosmetic · `Collections.tsx:631-633,753`
- **COL.16** (lead) · Editor · empty groups.
  - Design: **README l.216, "Empty groups show nothing."**
  - Build: the CATEGORY / SUB-CATEGORY / FACT labels show with no pills, because fix item C.25 followed the prototype (template 1296-1301). README wins on layout, so C.25 was fixed the wrong way.
  - Minor · `Collections.tsx` (editor pill groups)

### How it works

- **HOW.1** · Opening "The decisions behind the rest of Epic" keeps the previous scroll position, so it landed mid-log with the tabs out of view.
  - Minor · `HowItWorks.tsx:1386`
- **HOW.2** · Mobile doc tabs · the second tab is cut to "The decisions behind t" with no scroll cue.
  - Cosmetic · `HowItWorks.tsx:583`
- **HOW.3** · Mobile jump row is not sticky and does not follow the section being read.
  - Cosmetic · `HowItWorks.tsx:616-618`
- **HOW.4** · Section 3's word total is `inEpic + needs + notInEpic` and leaves out `keptAsIs`, so it undercounts once a Keep happens.
  - Minor · `HowItWorks.tsx:84-85`, `apps/api/src/desk/mapping.js:198,211`
- **HOW.5** · The document is on a dark ground; the prototype uses a light `#f6f7f4` iframe (template 1519). D.1 asked for desk colours, so this is recorded only as a difference.
  - Cosmetic · `HowItWorks.tsx:634`
- **HOW.6** · Section 5 uses the verb "disagree" in a test question. This is not the word "disagreement", so D.6 holds.
  - Cosmetic · `HowItWorks.tsx:428`

### Across the app

- **X.1** · Shell · while the API returns 429, the back office draws "That is not a page you can open — The back office needs an account with the admin door". An unknown access state is read as "no access", which breaks the can't-speak rule.
  - Minor · `apps/web/App.tsx:336-338`

**Counts: 68 discrepancies.**

| Severity | Count | Items |
|---|---|---|
| Material | 12 | CH.1, CH.2, CAT.1, FAC.1, FAC.2, FAC.3, COL.1–COL.6 |
| Minor (incl. COL.8, minor bordering material) | 38 | |
| Cosmetic | 18 | |

## First-audit items confirmed fixed

Evidence for each is in the area reports.

- **A (chrome, Overview, Changes, Automations, Runs, Verification, Accuracy):** A.1, A.2, A.3, A.4, A.5, A.7 (header counts restored, hover cards, drill to `ftab=verification&view=…`), A.8, A.9, A.10 (DECISION applied: the rail keeps the real Overview/Reporting/Runs), A.11, A.12 (DECISION applied: Families "—" plus "no family answers this week"), A.13, A.14, A.16, A.17, A.18.
- **Kit items** (common.md): sort chevron Icon in the header colour, sticky THead, 10px 8px rows at 1.55 line height, selected dropdown option #f2efec/800, unticked Tick #6B6664, location chip × as Icon.
- **History:** a move pushes and a filter replaces. Confirmed with browser Back on Categories, Facts, Mapping, Collections and Changes.
- **B (Categories / Facts):**
  - B.1, B.2, B.3, B.4, B.8, B.9, B.10, B.11, B.12 (DECISION applied: no "What people say"), B.13, B.14, B.15, B.17, B.19, B.20, B.21, B.22.
  - DECISIONs applied: B.6 (six bands + All ages, not stacked), B.16 (no geography view), B.18 (× only on person-made links).
  - B.23–B.39 all confirmed.
- **C (Mapping / Collections):**
  - C.1 (a real mouse click on Make primary), C.2, C.3, C.4, C.5, C.6, C.9, C.10, C.11, C.12, C.13, C.14, C.15 (drift 0 rows either way; 269 and 271 applied), C.28.
  - DECISION applied: C.8 (the picker opens on the primary's category).
  - Collections: C.17, C.18, C.19 (API/code; the UI click was blocked by COL.1), C.20, C.21, C.22, C.23, C.26 (colour), C.27.
  - C.24, preview-only: no heart endpoint is called and `browse_row_hearts` was unchanged.
- **D (How it works):** D.1 (DECISION: Part two is the second tab), D.2 (DECISION: "7. How a fact gets born"), D.3, D.4 (proved live by changing three settings and restoring them), D.5, D.6, D.7, D.8, D.9, D.10.

## Items not fixed, or fixed wrongly

| Item | Status | Why | See |
|---|---|---|---|
| A.6 | Partly fixed | Search does not escape `%` / `_` | CH.5 |
| common.md "sorts in the address" | Not fixed | Collections sort is still local | CH.7 |
| A.15 | Partly fixed | "View by" wraps when there are no family answers | FAC.7 |
| A.19 | Partly fixed | All facts rows 42px vs 46 | FAC.11 |
| B.5 | Partly wrong | The "places disagree" copy also shows with 0 confirmed | CAT.4 |
| B.7 | Fixed, but… | Same stacking fault remains inside the bulk bar | CAT.1 |
| C.7 | Partly fixed | Red style, but raw "Failed to fetch" wording | MAP.8 |
| C.16 | Partly fixed | Rows stay off; "not" is not a recorded No; older predicates left | COL.3, COL.4, COL.10 |
| C.24 | Partly fixed | Preview hearts wiped; shelves limited to the first 12; Waiting judged estate-wide. Audience filtering (D11) not applied on the phone list, as the fix list allowed | COL.2, COL.7, COL.8 |
| C.25 | Fixed the wrong way | Follows the prototype against README l.216 | COL.16 |
| C.26 | Partly fixed | Row height 62.5 vs 64.5 | COL.12 |

## Additions not in the design

**Owner-ruled deviations, verified as applied:**
- Typed boxes, no steppers.
- Lucide icons, apart from the leftovers in CAT.2 and MAP.1.
- Square corners and Archivo.
- The six age bands.
- The real rail screens.
- No "What people say".
- "Include anyway" on Excluded facts (and it keeps a fact Active below the bar).
- See as a household is preview-only.
- No "How Epic grows its knowledge" box on Fact automations.

**Needs a decision.** How it works has a "How Epic grows its knowledge" callout in section 7 (`HowItWorks.tsx:459-462`). The brief says that box "stays out", and A.7 applied the rule only to Fact automations. Whether it applies to the document is for the owner or lead.

**Other additions:**
- **Changes:**
  - An undone change gets its own "Undo · …" row and an "Undone <when> by <who>" line.
  - A capped footer: "The newest N of M…".
  - Collection entries read "Title: … · …".
- **Overview:** grey "can't speak" tone and wording on the Health tiles.
- **Categories:**
  - A "Related subcategories" line on the subcategory page.
  - Dotted underlines on headers that have tooltips.
  - The public-transport note.
  - Floors drawn as "N+" (the owner's "41+" rule).
  - The build's own inspect table for Review; the prototype's goes to the retired "train" screen.
- **Facts:**
  - A non-standard fact's "Places with it" opens a fact-wide drill.
  - "Building" chips.
  - A "—" with (i) in the Failing column.
  - Excluded's Why names who and when.
  - "The first N of M" on a capped drill.
- **Mapping:**
  - keptAsIs words, in no view but openable from Decided.
  - Decided "The newest N of M" line.
  - Filter states "Answered", "Kept as a fact" and "Nobody ever opened one".
  - The can't-speak tip on Ever opened.
- **Collections:**
  - The build-only rows Something fun and No rush (off, retired-axis predicates, 0 places) and Made by hand (live, no copy, 0 places — the phone shows "0 places near you").
  - Never done that before (off, older "How new" rule).
  - `ageSpan` and `primaryCat` in the rule model.
  - The "Written in the older form" line.
  - The Household dropdown.
  - "No household has an account yet."
- **How it works:**
  - A lime rule on the section a link landed on.
  - A can't-speak line if the settings fail to load.
  - On the decisions tab: the routing banner, "What we owe" and "Keeping this page honest".

## What could not be checked

- **Real reach counts**, including the "N+" floor on screen and the 120-minute cap's reason: `bo_view` has no census for the rings tested, so only "—" drew. The floor was read from code (`Categories.tsx:291`).
- **Overview:** the Spend tile in amber or red, and Collections lists with real engagement.
- **Runs** with real runs: there are none in bo_view.
- **Verification:** the Stalled banner (other auditors' recent checks kept it Running), and Dropped across a month boundary. Both were read from code only.
- **Collections:** Save clicked in the UI with a location filter, which the refetch loop blocked; the path was checked by code and API.
- **Mapping:**
  - The "Not places people visit" and "Stop filing by this word" proposal groups: no seed words for them in bo_view.
  - A real server 500.
  - Make primary by touch on a real device; emulation only.
- **Mobile:** a full below-the-fold pass on Facts, Mapping and Collections; the first screen and one scroll each were checked. The prototype has no 390 layout, so Mobile was judged against the owner's layout rules alone.
- **How it works:** the prototype's document iframe (`how-it-works/business-mechanics.html`) returns 404 on :8765. The document was compared against `Supporting docs/Categories/Epic - How It Works.html` instead.
- **The uncommitted edits made after f6c2a0e** (caveat 1): not audited.

## Test data left in bo_view

- Rows are tagged "R2-audit" (Facts rows use refs `r2fac:` and keys `r2fac-`).
- The heritage_railway word and its open proposal were kept on purpose.
- Account `r2-audit-col@example.invalid` on Founding household.
- Collection `r2-audit-thrills`.
- One `fact_corrections` row, left as evidence for FAC.3.
- Every setting the auditors changed was restored.
- Seeds: `/tmp/bo-audit2/CAT-seed.sql` and `/tmp/bo-audit2/FAC-seed.sql`.
