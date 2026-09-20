-- A key is the words it is made of, and one convention was being missed.
--
-- Our own facts are written three ways at once: `step_free` in an OSM tag,
-- `wheelchair:toilet` in another, and `stepFree` in the JSON `sources/own.js`
-- composes into `place_records.accessibility`. The sweep split the first two
-- and ate the third, so it raised `stepfree` and `wheelchairtoilet` as new
-- words — with six places asserting each of them, so migration 210's
-- all-polarity-nought test could not catch them.
--
-- That is the one duplicate the alias table exists to prevent: `step-free` is
-- already one of our labels and already a global question asked of every
-- place. A promoted `stepfree` would have been a second question asking the
-- same thing, answered from the same tag, shown twice on the same drawer.
--
-- The extractor is fixed (`keyWords` in `sources/vocabulary.js`). This clears
-- what it raised before the fix, and the test is exact rather than a guess:
-- a word with no space in it whose letters are one of our labels with the
-- spaces taken out cannot have come from anything a person wrote.
--
-- Anything decided is left alone, as 210 left it: ignored stays ignored, and
-- a promoted word is a question somebody made on purpose.
delete from harvest_candidates c
 where c.status in ('new', 'unresolved')
   and c.norm not like '% %'
   and exists (
     select 1 from attribute_aliases a
      where a.norm like '% %'
        and replace(a.norm, ' ', '') = c.norm
   );

-- The same glue, against the sweep's own vocabulary rather than ours: where a
-- later sweep has raised `wheelchair toilet` for the same subcategory, the
-- spaceless `wheelchairtoilet` beside it is the older extractor's artefact and
-- says nothing the spaced one does not.
delete from harvest_candidates c
 where c.status in ('new', 'unresolved')
   and c.norm not like '% %'
   and exists (
     select 1 from harvest_candidates other
      where other.subcategory = c.subcategory
        and other.norm like '% %'
        and replace(other.norm, ' ', '') = c.norm
   );
