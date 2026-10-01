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
import { saveAnswer } from '../repositories/questionSets.js';

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
  if (admission && admission.free === true) return { state: 'answered', choice: 'free' };
  return { state: 'asked_nothing_found' };
}

/**
 * Write a place's admission as its owned `cost-band` answer, from source `site`.
 * Idempotent per (venue_ref, question, source). Returns the answer written, or null if
 * the cost-band question is not registered.
 */
export async function recordAdmissionAnswer(venueRef, admission, { sourceUrl = null } = {}) {
  const questionId = await costBandQuestionId();
  if (!questionId) return null;
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
