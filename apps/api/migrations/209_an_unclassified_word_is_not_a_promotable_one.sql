-- An unclassified word is not a promotable one.
--
-- Migration 208 gave every candidate a `kind`, defaulting to `unclear`, and a
-- `status` of `unresolved` for the holding pen. It could not give the rows
-- that already existed both: they kept the `status = 'new'` they were written
-- with before there was such a thing as a kind.
--
-- So four and a half thousand words that nothing has ever classified were
-- sitting in the promotable list — the exact list the holding pen exists to
-- keep short — while `/candidates/pen` reported one word waiting. The screen
-- would have shown a human every fragment of every encyclopedia article to
-- decide by hand, which is the failure the brief's §5.2 is written to prevent.
--
-- `new` means *a feature, waiting for a person*. Nothing else may sit there.
update harvest_candidates
   set status = 'unresolved'
 where status = 'new' and kind <> 'feature';
