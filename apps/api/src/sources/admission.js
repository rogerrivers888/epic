/**
 * Admission as the owned cost-band answer (sources/admission.js; owner, 1 Oct 2026,
 * parks admission). The venue's own page is a source we may read and keep, so "free
 * entry" read from it is written as the owned `cost-band` answer the drawer's cost row
 * prefers over Google (B11). Free entry is the whole point — it is exactly what Google
 * has no price level for: of 80 SL5 places, 0 returned Free, and a park's own page
 * saying "free" is about as reliable as owned text gets.
 *
 * ONLY the free case is stored, deliberately (Codex). "Free" is market-agnostic and
 * permanent: it needs no country, no money bands, and never goes stale when a band's
 * thresholds move. Banding a *price* at write time is the opposite — it would fix a
 * choice against one market's thresholds and the place's country at that instant, and
 * be wrong the moment either changed. A priced entry we read is therefore recorded as
 * `asked_nothing_found` (we looked, could not establish the band) and the cost row
 * falls back to Google's price level, which already covers places that charge. Storing
 * a price for read-time banding would need a numeric answer shape the `cost-band`
 * `oneof` label does not have — a later piece of work if priced owned admission is
 * ever wanted.
 *
 * The extractor already exists: `sources/site.js` `admissionFrom` returns
 * `{ free, adult, … }` with its qualified-free guard, and `own.js` reads it on every
 * claimed-place research. This maps the free flag to the `cost-band` label's `free`
 * choice (migration 246) and stores it through the question-sets answer store — the
 * first real writer of `place_answers`.
 */

import { query } from '../db.js';
import { saveAnswer, markDisagreement } from '../repositories/questionSets.js';
import { postcodeSaysGb } from '../repositories/placeIndex.js';

let costBandQuestion; // the global cost-band question id, resolved once

/** The id of the global cost-band question (migration 246), or null if it is gone. */
async function costBandQuestionId() {
  if (costBandQuestion !== undefined) return costBandQuestion;
  const { rows } = await query(
    `select id from questions where attribute_key = 'cost-band' and scope = 'global' order by id limit 1`);
  costBandQuestion = rows[0]?.id ?? null;
  return costBandQuestion;
}

/**
 * An admission object (from `admissionFrom`) as a cost-band answer. Free entry is the
 * `free` choice; anything else — a page with no admission, or one that charges (banded
 * only at read time, from Google, not here) — is `asked_nothing_found`: a real answer,
 * "we read the page and it did not establish a free entry", never a guess.
 */
export function admissionToAnswer(admission) {
  // Free only when nothing on the page says anybody pays: a printed adult, child,
  // family or concession price beside a "free" means somebody pays at the gate, and a
  // wrong Free is worse than no answer — a family arrives expecting not to (owner,
  // 1 Oct 2026; Codex). The extractor applies the same rule; this holds it here too.
  const paid = admission && (admission.adult || admission.child || admission.family || admission.concession);
  if (admission && admission.free === true && !paid) return { state: 'answered', choice: 'free' };
  return { state: 'asked_nothing_found' };
}

/**
 * Write a place's admission as its owned `cost-band` answer, from source `site`.
 * Idempotent per (venue_ref, question, source). Returns the answer written, or null if
 * the cost-band question is not registered.
 */
export async function recordAdmissionAnswer(venueRef, admission, { sourceUrl = null, postcode = null } = {}) {
  const questionId = await costBandQuestionId();
  if (!questionId) return null;
  // The extractor recognises only £ prices, so it can tell free from paid only in GB:
  // elsewhere a €/$ charge goes undetected and "free … on some days" would be stored as
  // an unconditional Free over a paid venue (Codex). Restrict the writer to GB, the one
  // currency it validates — a market-expansion item (docs/markets.md §3.3): the owned
  // route stays GB-only until the extractor learns € and $.
  //
  // GB must be KNOWN, not assumed: an unknown country is skipped like a foreign one
  // (Codex). A postcode decides it by the one rule every settle uses (markets step 6,
  // POSTCODE_SAYS_GB): a full postcode in the ONS list is GB even over a stale stamp
  // — Codex asked for that four times, and it is safe now an Eircode can never match —
  // while an outcode alone only fills a missing country, never overrides one.
  const { rows: [pi] } = await query(
    `select pi.country_code, r.postcode from place_index pi
       left join place_records r on r.venue_ref = pi.venue_ref where pi.venue_ref = $1`, [venueRef]);
  const stamped = pi?.country_code ? String(pi.country_code).toUpperCase() : null;
  const country = stamped === 'GB'
    || await postcodeSaysGb(postcode, stamped) || await postcodeSaysGb(pi?.postcode, stamped)
    ? 'GB' : stamped;
  if (country !== 'GB') {
    // A venue outside GB, or not yet known to be in it — clear any site answer written
    // before (Codex), so the cost row stops serving a band from a currency the extractor
    // cannot validate. ownedCostBand then falls back to Google.
    await query(`delete from place_answers where venue_ref = $1 and question_id = $2 and source = 'site'`, [venueRef, questionId]);
    // With the site row gone, an answer it disagreed with is no longer contested —
    // recompute the flags so ownedCostBand does not keep ignoring it (Codex).
    await markDisagreement(venueRef, questionId);
    return null;
  }
  const answer = admissionToAnswer(admission);
  await saveAnswer({
    venueRef,
    questionId,
    source: 'site',
    state: answer.state,
    value: answer.choice ? { choice: answer.choice } : null,
    sourceUrl,
  });
  return answer;
}
