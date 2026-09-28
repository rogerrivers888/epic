/**
 * Which Google words each place carries, as one derived table of
 * (venue_ref, label = 'google:<word>') — read wherever the desk asks which
 * words bring a place: Mapping's counts, secondary filing, narrowings,
 * collections and the fact pipeline.
 *
 * Three sources, the same the taxonomy audit reads: the census word that
 * found the place (`found_by`, on place_subcategories and place_index), the
 * place's Google types, and any Google label the index holds. Production's
 * `place_index_labels` holds no Google words, so reading only that made every
 * word bring nought and every secondary filing vanish (found on the live
 * site, 28 Sep 2026).
 *
 * Kept as the table `place_words` (migration 281), exact on every write by
 * triggers on the three sources, because working the union out on each read
 * cost a quarter of a second locally and seconds on production, several
 * times a page (round 3, 29 Sep 2026).
 */
export const PLACE_WORDS = `(select venue_ref, label from place_words)`;

/**
 * The same union worked out from the sources, as it was read before migration
 * 281 kept it as a table. `place_words` is held equal to this by triggers on
 * the three sources; the tests compare the two.
 */
export const PLACE_WORDS_WORKED_OUT = `(
  select venue_ref, 'google:' || found_by as label from place_subcategories where found_by is not null
  union
  select venue_ref, 'google:' || found_by from place_index where found_by is not null
  union
  select pi.venue_ref, 'google:' || t from place_index pi, unnest(pi.google_types) t where pi.google_types is not null
  union
  select venue_ref, label from place_index_labels where label like 'google:%'
)`;
