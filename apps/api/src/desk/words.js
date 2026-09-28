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
 */
export const PLACE_WORDS = `(
  select venue_ref, 'google:' || found_by as label from place_subcategories where found_by is not null
  union
  select venue_ref, 'google:' || found_by from place_index where found_by is not null
  union
  select pi.venue_ref, 'google:' || t from place_index pi, unnest(pi.google_types) t where pi.google_types is not null
  union
  select venue_ref, label from place_index_labels where label like 'google:%'
)`;
