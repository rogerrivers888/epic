// What everybody else thinks of a place, for a row in Places (owner, 7 Sep
// 2026): "I'm also not seeing any ratings. I think you should show the ratings.
// If I haven't rated it, then you should show the general rating."
//
// The household's own mark comes first and always will — it is ours, it is in
// the database, and it is the only opinion Roam is really about. This is the
// rung below it: the crowd rating, for a place nobody here has scored yet.
//
// It is rented, so it obeys the same bargain as the kinds of place in
// taxonomy.js and the pictures in rentedPhoto.js:
//
//   • Nothing here reaches the database. Held in memory for a week and dropped.
//   • Nothing here reaches a device. `apps/web/src/offline/policy.ts` strips a
//     licensed row's rating before IndexedDB, so a row that shows 4.6 on the
//     network shows only our own mark offline. What we rent, we lose when the
//     signal goes.
//   • It prefers a search already paid for. A place the household searched up
//     in the last twelve hours is still in the pool (cache.js) with its rating
//     on it, so the usual way a row fills costs nothing at all.
//   • Only a licensed reference is ever asked. An OpenStreetMap or Wikidata
//     place has no crowd rating to buy, so it is never looked up.
//
// `rating` and `userRatingCount` are Enterprise fields at the provider, so this
// is deliberately its own narrow call rather than a corner of the full detail:
// a row wants a number, not the hours, the reviews and the price list.

import * as providerCalls from '../repositories/providerCalls.js';
import { googleSource } from './google.js';
import { venueFromKept } from './cache.js';

// A week, like taxonomy.js. A crowd rating moves in the third decimal place
// over a month; re-buying it every twelve hours would be paying for noise.
const TTL_MS = 7 * 24 * 3600_000;
const MAX = 2000;
const kept = new Map();

const fresh = (hit) => hit && Date.now() - hit.at < TTL_MS;

/**
 * The crowd rating already held for this place, or null.
 *
 * A place looked up and found to have no rating is remembered as `{ rating:
 * null }`, which is not the same as null: without that, every read of every
 * list asks the provider again about the same unrated place, all day.
 */
export function ratingKept(venueRef) {
  const hit = kept.get(venueRef);
  return fresh(hit) ? hit.value : null;
}

function remember(venueRef, value) {
  kept.delete(venueRef);
  kept.set(venueRef, { at: Date.now(), value });
  while (kept.size > MAX) kept.delete(kept.keys().next().value);
}

/**
 * True when a row would show no number at all and the provider could give one.
 *
 * `ours` is the important argument and the caller must pass it: a place
 * somebody in the household has scored already says what this household thinks,
 * which is better than what a hundred strangers think, and must never cost a
 * call.
 */
export function needsRating(venueRef, ours) {
  if (ours) return false;
  if (ratingKept(venueRef)) return false;
  return String(venueRef).startsWith('google:');
}

/** Ask what the crowd made of it, as narrowly as the provider sells it. */
export async function ratingFor(venueRef, { householdId = null } = {}) {
  const cached = ratingKept(venueRef);
  if (cached) return cached;

  // A search that ran in the last twelve hours already carried the rating, and
  // asking again for what is in our hands is a billed call for nothing.
  const searched = venueFromKept(venueRef);
  if (searched?.rating != null) {
    const value = { rating: searched.rating, ratingCount: searched.ratingCount ?? null };
    remember(venueRef, value);
    return value;
  }

  const [source, ...rest] = String(venueRef).split(':');
  if (source !== 'google') return null;
  const found = await googleSource.rating(rest.join(':'));
  // Remembered either way — see ratingKept. A place nobody has rated is a fact
  // about that place, and one worth not re-buying every read.
  remember(venueRef, found ?? { rating: null, ratingCount: null });
  await providerCalls.record(householdId, 'google', 'atlas.rating', JSON.stringify({ google: 1 })).catch(() => null);
  return found;
}

/**
 * Fill in the crowd rating for the rows that have no mark of ours, a few at a
 * time.
 *
 * The same shape as fillTaxonomy and fillPhotos: it runs after the response has
 * gone, the web asks again shortly, and the rows fill in. A page of sixty
 * places must not become sixty billed calls the moment somebody opens Places.
 */
export async function fillRatings(householdId, rows, { limit = 8 } = {}) {
  const todo = rows.filter((r) => needsRating(r.venueRef, r.ours)).slice(0, limit);
  for (const r of todo) {
    try { await ratingFor(r.venueRef, { householdId }); } catch { /* the row keeps our mark, or none, until the next look */ }
  }
  return todo.length;
}
