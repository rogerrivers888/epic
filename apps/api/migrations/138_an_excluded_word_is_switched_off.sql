-- An excluded word is switched off, the way the other 187 are.
--
-- Marking a word `aside` and leaving it active is the same decision written two
-- ways: 187 of the 198 excluded Google words already carry active = false, and
-- 137 left garden_center in the other group (Codex, 17 Sep 2026).
--
-- Nothing about what lands where changes -- `aside` already kept every one of
-- these out. What changes is that the counts on screen agree with each other.
update taxonomy_labels
   set active = false, updated_at = now()
 where namespace = 'google' and decision = 'aside' and active;
