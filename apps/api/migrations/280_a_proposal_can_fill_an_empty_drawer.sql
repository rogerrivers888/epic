-- A proposal can point a word at an empty drawer.
--
-- Round 3, 29 Sep 2026: Afternoon tea and Breweries, wineries & distilleries
-- read nought because no Google word pointed at them. The words that fit
-- (tea_house, brewery, brewpub) already file somewhere else — Cafés, Pubs &
-- bars — so the proposal is neither "fold into a bigger subcategory" nor a
-- narrowing: it fills an empty drawer, keeping where the word files today as
-- a secondary. Needs a decision shows it under its own heading, which needs
-- the group allowed here. Additive: every group already stored stays valid.
alter table word_proposals drop constraint if exists word_proposals_grp_check;
alter table word_proposals add constraint word_proposals_grp_check
  check (grp in ('not_places','fold','narrow','stop_filing','no_suggestion','fill'));
