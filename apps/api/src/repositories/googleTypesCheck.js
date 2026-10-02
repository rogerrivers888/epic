/**
 * The item 6 after-check: did clearing Google's stored types do what it said?
 *
 * Owner, 2 Oct 2026: "Add a read-only admin endpoint that runs exactly your
 * after-grid check (fixed query, no parameters, returns counts only)". The
 * owner does not run SQL by hand, and an agent may read production but never
 * write it, so the check lives here as one fixed statement both can ask for.
 *
 * Ten counts, numbered as the dry run and after-grid numbered them
 * (item6-google-types-dryrun.sql). After migration 320: rows 1, 2, 3, 4 and 6
 * are nought, row 5 equals row 7, and rows 8, 9 and 10 — our own vocabulary
 * and rules — are what they were. Counts only: no place, no word, no id.
 */

import { query } from '../db.js';

// Row 5 is always row 6 plus row 7: a place_words row either has an owned
// source behind it (found_by on either table, or a google: label) or it has
// only the rented google_types column.
const CHECK_SQL = `
  select
    (select count(*) from place_index where google_types is not null)::int as r1,
    (select count(distinct venue_ref) from place_index where google_types is not null)::int as r2,
    (select count(*) from place_index_labels where label like 'google:%')::int as r3,
    (select count(*) from place_index
      where google_types is not null and cardinality(google_types) > 0)::int as r4,
    (select count(*) from place_words)::int as r5,
    (select count(*) from place_words pw
      where not exists (select 1 from place_subcategories s
                         where s.venue_ref = pw.venue_ref and 'google:' || s.found_by = pw.label)
        and not exists (select 1 from place_index pi
                         where pi.venue_ref = pw.venue_ref and 'google:' || pi.found_by = pw.label)
        and not exists (select 1 from place_index_labels l
                         where l.venue_ref = pw.venue_ref and l.label = pw.label))::int as r6,
    (select count(*) from place_words pw
      where exists (select 1 from place_subcategories s
                     where s.venue_ref = pw.venue_ref and 'google:' || s.found_by = pw.label)
         or exists (select 1 from place_index pi
                     where pi.venue_ref = pw.venue_ref and 'google:' || pi.found_by = pw.label)
         or exists (select 1 from place_index_labels l
                     where l.venue_ref = pw.venue_ref and l.label = pw.label))::int as r7,
    (select count(*) from taxonomy_labels where namespace = 'google')::int as r8,
    (select count(*) from taxonomy_label_carries where namespace = 'google')::int as r9,
    (select count(*) from shelf_rules where labels::text like '%google:%')::int as r10`;

const METRICS = [
  'place_index rows with google_types',
  'distinct places with google_types',
  'legacy google:% rows in place_index_labels',
  'places feeding back-office Audit flags',
  'place_words rows now',
  'place_words rows backed ONLY by google_types',
  'place_words rows backed by found_by + labels',
  'taxonomy_labels google words (kept)',
  'taxonomy_label_carries google (kept)',
  'shelf_rules carrying google: labels (kept)',
];

/** The after-grid, as rows 1–10: `{ row, metric, count }`. */
export async function googleTypesCheck() {
  const { rows: [r] } = await query(CHECK_SQL);
  return METRICS.map((metric, i) => ({ row: i + 1, metric, count: r[`r${i + 1}`] }));
}
