-- One more seed read too literally.
--
-- A bar and grill is a pub that does food. It is not a steakhouse, and saying
-- so put every one of them under a filter they would never answer (Codex,
-- 14 Sep 2026). The word encodes the bar and the grill; it does not encode
-- what is on the grill.
delete from taxonomy_label_carries
 where namespace = 'google' and attribute_key = 'dining' and key = 'bar_and_grill';
