/**
 * A place's admission, read from its own page, written as the owned cost-band answer
 * (owner, 1 Oct 2026; parks admission). "Free entry" on a venue's own page is about
 * as reliable as owned text gets, and it is exactly what Google has no price level
 * for — of 80 SL5 places, 0 returned Free. So the venue page's admission becomes the
 * owned `cost-band` answer the drawer's cost row prefers over Google (B11).
 *
 * The extractor already exists: `sources/site.js` `admissionFrom` returns
 * `{ free, adult, child, family, concession, note }` with its qualified-free guard,
 * and `own.js` reads it on every claimed-place research. This maps that to one of the
 * `cost-band` label's four choices (migration 246: free · cheap · moderate ·
 * expensive) and stores it through the question-sets answer store — the first real
 * writer of `place_answers`. A free entry is `free`; a priced one is banded against
 * the place's own market's money bands; a page we read that said nothing bandable is
 * `asked_nothing_found`, a real answer and not the absence of one.
 */

import { query } from '../db.js';
import { saveAnswer } from '../repositories/questionSets.js';
import { bandIndexForPrice, COST_CHOICES } from '../domain/costBand.js';

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
 * The minor units in an admission price string. `admissionFrom` keeps prices as
 * written — "£32.00", "14.50" — so the first number is the amount; a range written
 * "£14.50 online, £16.50" takes the first (the lower, as shown). Null when there is
 * no number to read.
 */
export function admissionMinor(priceStr) {
  if (priceStr == null) return null;
  const m = String(priceStr).replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/);
  if (!m) return null;
  const major = Number(m[0]);
  if (!Number.isFinite(major) || major < 0) return null;
  return Math.round(major * 100);
}

/**
 * An admission object (from `admissionFrom`) as a cost-band answer. Free is `free`;
 * a priced adult entry is banded against the market's own money bands; anything else
 * — a page with no admission, or a charge we could not put in a band — is
 * `asked_nothing_found` (we read the page and could not establish it), never a guess.
 */
export function admissionToAnswer(admission, bands) {
  if (!admission) return { state: 'asked_nothing_found' };
  if (admission.free === true) return { state: 'answered', choice: 'free' };
  const minor = admissionMinor(admission.adult);
  if (minor != null && Array.isArray(bands) && bands.length) {
    const index = bandIndexForPrice(minor, bands);
    if (index != null) return { state: 'answered', choice: COST_CHOICES[index] };
  }
  return { state: 'asked_nothing_found' };
}

/**
 * Write a place's admission as its owned `cost-band` answer, from source `site`. The
 * band is read against the place's own country's market (its country comes from the
 * owned postcode now — Option C), falling back to GB. Idempotent per
 * (venue_ref, question, source). Returns the answer written, or null if the cost-band
 * question is not registered.
 */
export async function recordAdmissionAnswer(venueRef, admission, { sourceUrl = null } = {}) {
  const questionId = await costBandQuestionId();
  if (!questionId) return null;
  const { rows: [pi] } = await query('select country_code from place_index where venue_ref = $1', [venueRef]);
  const code = String(pi?.country_code || 'GB').toUpperCase();
  const { rows: [m] } = await query('select cost_bands from markets where code = $1', [code]);
  const bands = Array.isArray(m?.cost_bands) ? m.cost_bands : null;
  const answer = admissionToAnswer(admission, bands);
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
