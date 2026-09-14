-- Three of the seeds were the word read too literally.
--
-- A beer garden in Britain is not German cuisine, a brewpub is not British
-- cuisine, and a steakhouse is a way of eating rather than a nationality — it
-- already carries the dining style Steakhouse, which is the true part. Found by
-- reading the seeded mappings back on production rather than by testing them.
delete from taxonomy_label_carries
 where namespace = 'google'
   and attribute_key = 'cuisine'
   and key in ('beer_garden', 'brewpub', 'steak_house');
