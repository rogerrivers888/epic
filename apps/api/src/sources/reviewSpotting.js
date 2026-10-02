/**
 * Review-spotting (C30, authorised as C61, owner 2 Oct 2026).
 *
 * When a real back-office search fetches a Google place's detail — its reviews
 * and review summary — that text sits in memory for the length of the request.
 * This reads it **there**, for free, and raises **concrete features only**: the
 * physical things, facilities and activities a place has (splash pad, toddler
 * pool, mini race track, trig point, waterfall). Opinions, adjectives and
 * service words (delicious, friendly, staff, great, clean) are filtered out.
 *
 * It stores **only our own derived output**: the feature, the place it was seen
 * at, and the polarity of the mention (asserted / denied / merely asked). Never
 * Google's text — `recordCandidates` keeps no evidence quote for a rented source
 * (`QUOTABLE_SOURCES`), so a Google-raised word lands in the holding pen
 * (`status = 'unresolved'`) and can never be promoted on Google alone: it waits
 * for the owned feature-harvest to quote it, or for a human to approve a new one
 * in the back office. Google may raise a candidate; it may never answer.
 *
 * Why this is allowed when the 21 Sep bulk pass was not (verdict
 * `harvest.google-pass`, migration 251): that pass harvested *every* word and
 * opinions drowned the signal — 41,816 words, nought promotable. This extracts
 * concrete features only and filters the opinions out, which is the whole of the
 * difference. The **paid bulk `googleHarvest` and open-ended n-gram mining stay
 * refused** (C61; see migration 320). Nothing here spends: it never makes a
 * Google call, it reads a detail another request already paid for.
 */

import { query } from '../db.js';
import { candidatesFor, plainKindOf, gateWord, ageWord } from '../domain/questions.js';
import { recordCandidates } from '../repositories/questionSets.js';

/**
 * The review-generic vocabulary that drowned the 21 Sep pass: opinions, service
 * words and the empty words a review is mostly made of. A candidate matching any
 * of these is not a feature and never reaches the pen. `plainKindOf` already
 * catches the opinion/condition words it knows (friendly, clean, busy …); this
 * is the rest — the food-opinion, service and filler vocabulary the owner named
 * (delicious, staff, great) and its near neighbours. Kept deliberately wide: a
 * feature wrongly dropped is raised again the next time the place is searched,
 * but an opinion let through is exactly the noise this exists to stop.
 */
const REVIEW_NOISE = /\b(delicious|tasty|yummy|scrumptious|bland|flavour|flavourful|flavoursome|moreish|staff|service|team|waiter|waitress|waiting staff|server|manager|owner|host|hostess|great|good|nice|lovely|amazing|excellent|superb|outstanding|brilliant|fabulous|fantastic|wonderful|gorgeous|decent|okay|fine|poor|mediocre|average|atmosphere|ambience|ambiance|vibe|vibes|experience|time|times|visit|visited|trip|place|places|spot|venue|gem|hidden gem|recommend|recommended|recommendation|love|loved|enjoy|enjoyed|enjoyable|definitely|absolutely|highly|really|very|just|lovely time|price|prices|pricing|cost|costs|money|value|portion|portions|selection|choice|variety|quality|option|options|range|bit|lot|lots|everything|anything|something|nothing|everyone|everybody|anyone|family|families|kids|children|child|adults|people|folk|customer|customers|guest|guests|day|days|hour|hours|minute|minutes|week|weekend|year|years|morning|afternoon|evening|night|today|yesterday|return|returning|again|back|first|second|last|next|around|area|place to|lovely place)\b/i;

/** Words so short or empty they are never a feature on their own. */
const STOP_SOLO = new Set(['the', 'and', 'for', 'was', 'had', 'are', 'but', 'you', 'our', 'out', 'all', 'one', 'two', 'can', 'get', 'got', 'has', 'his', 'her', 'she', 'him', 'who', 'why', 'how', 'not', 'too', 'very', 'lot', 'bit', 'day']);

/**
 * Generic nouns and sentence fragments that are not a feature *on their own* —
 * checked only for a single-word candidate, so the two-word feature that contains
 * one still stands: solo `room` is dropped, `steam room` is kept; solo `track` is
 * dropped, `race track` is kept. This is what the n-gram pass mostly leaves behind
 * once the opinions are gone — the halves of real features and the empty nouns a
 * review is built from. A real solo feature (sauna, waterfall, flume, playground,
 * pool) is not here and survives.
 */
const GENERIC_SOLO = new Set([
  'room', 'rooms', 'area', 'areas', 'point', 'points', 'walk', 'walks', 'part', 'parts',
  'side', 'sides', 'end', 'ends', 'front', 'back', 'top', 'bottom', 'middle',
  'food', 'foods', 'drink', 'drinks', 'meal', 'meals', 'snack', 'snacks', 'menu', 'coffee', 'tea',
  'thing', 'things', 'way', 'ways', 'stuff', 'spot', 'spots', 'place', 'places', 'time', 'times',
  'kid', 'trip', 'trips', 'view', 'views', 'tour', 'tours', 'walkway',
  'splash', 'steam', 'mini', 'race', 'pad', 'track', 'tracks', 'soft', 'play',
  'water', 'sand', 'grass', 'field', 'ground', 'space', 'room', 'section', 'bit',
]);

/**
 * Does this candidate name a concrete feature — a thing a place *has*?
 *
 * Conservative on purpose (precision over recall): an opinion or condition
 * (`plainKindOf`), a review-generic word (`REVIEW_NOISE`), or a bare scrap is
 * dropped. A gate or age signal is always kept, rare or not — those are decisive
 * for the people who need them (`gateWord`/`ageWord`). Everything else that
 * survives is treated as a candidate feature and goes to the pen, where a human
 * approves the new ones before they become facts.
 */
export function looksLikeFeature(norm) {
  const w = String(norm ?? '').trim().toLowerCase();
  if (w.length < 3) return false;
  if (gateWord(w) || ageWord(w)) return true;
  if (plainKindOf(w)) return false;            // opinion or condition
  if (REVIEW_NOISE.test(w)) return false;      // review-generic / service / opinion
  const words = w.split(/\s+/).filter(Boolean);
  // A single word is held to a higher bar: most of what the n-gram pass leaves
  // after the opinions are gone is the halves of real features and empty nouns.
  // A real solo feature (sauna, waterfall, playground) is in neither set.
  if (words.length === 1 && (STOP_SOLO.has(w) || GENERIC_SOLO.has(w))) return false;
  return true;
}

/**
 * The concrete features in one place's Google detail, with polarity — pure, so
 * it is unit-tested directly. `detail` is what `googleSource.get` returns:
 * `reviews` (array of `{ text }` or strings) and `reviewSummary` / `aiSummary`
 * (strings). Returns a Map keyed by normalised feature.
 */
export function spotFeatures(detail = {}) {
  const texts = [];
  if (detail?.reviewSummary) texts.push({ source: 'google', text: String(detail.reviewSummary) });
  if (detail?.aiSummary) texts.push({ source: 'google', text: String(detail.aiSummary) });
  for (const r of Array.isArray(detail?.reviews) ? detail.reviews : []) {
    const text = typeof r === 'string' ? r : (r?.text?.text ?? r?.text ?? r?.originalText?.text ?? null);
    if (text) texts.push({ source: 'google', text: String(text) });
  }
  const raised = candidatesFor({ texts });
  const features = new Map();
  for (const [norm, entry] of raised) if (looksLikeFeature(norm)) features.set(norm, entry);
  return features;
}

/** The subcategory a place is filed under, or null — the drawer a candidate is raised in. */
async function subcategoryOf(venueRef, client = null) {
  const run = client ? (t, p) => client.query(t, p) : query;
  const { rows: [row] } = await run('select subcategory from place_index where venue_ref = $1', [venueRef]);
  return row?.subcategory ?? null;
}

/** Normalised keys of the features already in our fact list (`place_attributes`). */
async function knownFeatureKeys(client = null) {
  const run = client ? (t, p) => client.query(t, p) : query;
  const { rows } = await run("select key, label from place_attributes where active");
  const keys = new Set();
  for (const r of rows) {
    keys.add(String(r.key).replace(/[_-]+/g, ' ').trim().toLowerCase());
    keys.add(String(r.label).trim().toLowerCase());
  }
  return keys;
}

/**
 * Spot a place's Google detail and queue what it raises. Fire-and-forget: it
 * never throws to its caller and never blocks the search that fed it — a search
 * must not fail or slow because spotting hit a snag.
 *
 * Returns a small report of what it did (for the research stream and for tests):
 * `{ subcategory, queued, filtered, known, features: [{ norm, asserts, denies, asks, known }] }`.
 * `queued` are the features written to the pen; `filtered` is how many raised
 * phrases were dropped as opinions/noise; `known` are features already in our
 * fact list (suggestions for owned verification) versus new ones (the review
 * queue). Nothing from Google's text is returned or stored.
 */
export async function spotFromDetail({ venueRef, detail, client = null } = {}) {
  if (!venueRef || !detail) return { subcategory: null, queued: 0, filtered: 0, known: 0, features: [] };
  const raisedAll = candidatesFor({
    texts: [
      ...(detail.reviewSummary ? [{ source: 'google', text: String(detail.reviewSummary) }] : []),
      ...(detail.aiSummary ? [{ source: 'google', text: String(detail.aiSummary) }] : []),
      ...((Array.isArray(detail.reviews) ? detail.reviews : []).map((r) => ({ source: 'google', text: typeof r === 'string' ? r : (r?.text?.text ?? r?.text ?? r?.originalText?.text ?? null) })).filter((t) => t.text)),
    ],
  });
  const features = new Map([...raisedAll].filter(([norm]) => looksLikeFeature(norm)));
  const filtered = raisedAll.size - features.size;
  if (!features.size) return { subcategory: null, queued: 0, filtered, known: 0, features: [] };

  const subcategory = await subcategoryOf(venueRef, client);
  if (!subcategory) return { subcategory: null, queued: 0, filtered, known: 0, features: [] };

  const known = await knownFeatureKeys(client);
  const entries = [];
  const report = [];
  for (const [norm, e] of features) {
    const isKnown = known.has(norm);
    entries.push({
      norm, raw: e.raw, rawForms: [e.raw],
      sources: ['google'],            // rented: no evidence quote is kept (QUOTABLE_SOURCES)
      examples: [venueRef],           // the place → feature link; cleared on promote/ignore
      kind: 'feature',                // a candidate feature; still unpromotable without an owned quote
      placesSeen: 1,
      asserts: e.asserts, denies: e.denies, asks: e.asks,
    });
    report.push({ norm, asserts: e.asserts, denies: e.denies, asks: e.asks, known: isKnown });
  }
  await recordCandidates(subcategory, entries, { placesTotal: 1, client });
  const knownCount = report.filter((r) => r.known).length;
  return { subcategory, queued: entries.length, filtered, known: knownCount, features: report };
}

/** Never let spotting break or slow the search that fed it (C30 is advisory only). */
export function spotInBackground(args) {
  return Promise.resolve().then(() => spotFromDetail(args)).catch(() => null);
}
