import { query } from '../db.js';
import { googleSource } from './google.js';
import * as providerCalls from '../repositories/providerCalls.js';

/**
 * Which place at a provider is the place in our atlas.
 *
 * The atlas knows a place as `wikidata:Q123` or `osm:node/456`; Google knows the
 * same place as `ChIJ…`. Nothing joined the two, so an attraction opened from
 * Inspire could never show a rating or a review however many Google had. The
 * owner asked for them outright (7 Sep 2026: "for activities, get the reviews
 * always from Google"), and this is the join.
 *
 * Only the identifier is stored. The rating, the review text and the author are
 * rented and stay rented — fetched at display time, held in memory for a few
 * hours, never written to a table and never sent to a device. Google's own
 * terms are the same shape: the place id may be kept indefinitely, the content
 * may not be kept at all.
 *
 * **The wrong match is the thing to be afraid of.** A castle wearing a
 * restaurant's reviews is worse than a castle with none, so a candidate has to
 * clear two independent tests — the name has to be recognisably the same name,
 * and the coordinates have to be close enough that it cannot be a different
 * place of the same name in the next county. A search that clears neither is
 * remembered as a miss, so it is not bought again on the next open.
 */

/** Two names, stripped of the things that differ without meaning: 'The', '&', punctuation. */
export const key = (s) => String(s || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\b(the|a|an|at|of|nr|near)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/** How alike two names are, 0–1, on the words they are made of. */
export function likeness(a, b) {
  const A = new Set(key(a).split(' ').filter(Boolean));
  const B = new Set(key(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  // Against the shorter of the two, so "Windsor Castle" still matches
  // "Windsor Castle, Home Park" rather than being punished for its extra words.
  return shared / Math.min(A.size, B.size);
}

export const metresBetween = (a, b) => {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

/**
 * Close enough to be the same place.
 *
 * Generous, because the two sources pin a large site differently — Google puts
 * Windsor Great Park at its car park and Wikidata at its centroid, a kilometre
 * apart — but not so generous that the next village is in range.
 */
export const NEAR_ENOUGH_M = 1200;
export const SURE_ENOUGH = 0.6;

/** Would this candidate be accepted as the same place? The guard, on its own. */
export const isMatch = (name, point, candidate) =>
  likeness(name, candidate.name) >= SURE_ENOUGH && metresBetween(point, candidate) <= NEAR_ENOUGH_M;

export async function matchKept(venueRef) {
  const { rows } = await query(
    'select source, source_ref, confidence, missing from provider_matches where venue_ref = $1',
    [venueRef]);
  return rows[0] ?? null;
}

async function remember(venueRef, match) {
  await query(
    `insert into provider_matches (venue_ref, source, source_ref, confidence, matched_on, metres, missing)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (venue_ref) do update set
       source = excluded.source, source_ref = excluded.source_ref, confidence = excluded.confidence,
       matched_on = excluded.matched_on, metres = excluded.metres, missing = excluded.missing,
       matched_at = now()`,
    [venueRef, match.source ?? 'google', match.sourceRef ?? '', match.confidence ?? 0,
      match.matchedOn ?? null, match.metres ?? null, Boolean(match.missing)]);
}

/**
 * The provider's id for this place, finding it once if we have not already.
 *
 * Returns null when there is no confident match — including when we have looked
 * before and failed, which is remembered so the same empty search is not bought
 * again every time somebody opens the place.
 */
export async function googleRefFor({ venueRef, name, lat, lng, householdId = null }) {
  if (!venueRef || !name || lat == null || lng == null) return null;
  // Already a provider's own place: nothing to match.
  if (String(venueRef).startsWith('google:')) return String(venueRef).slice('google:'.length);

  const kept = await matchKept(venueRef);
  if (kept) return kept.missing ? null : kept.source_ref;
  if (!googleSource.enabled()) return null;

  const found = await googleSource.search({
    center: { lat, lng }, radiusKm: 3, query: name, limit: 8,
  }).catch(() => []);
  await providerCalls.record(householdId, 'google', 'atlas.match', JSON.stringify({ google: 1 })).catch(() => null);

  let best = null;
  for (const v of found) {
    if (v.lat == null || v.lng == null) continue;
    const m = metresBetween({ lat, lng }, v);
    const like = likeness(name, v.name);
    if (like < SURE_ENOUGH || m > NEAR_ENOUGH_M) continue;
    // Nearer wins between two that both read as the same name.
    if (!best || like > best.like || (like === best.like && m < best.m)) best = { v, like, m };
  }

  if (!best) { await remember(venueRef, { missing: true, matchedOn: name }); return null; }
  const id = String(best.v.sourcePlaceId ?? '');
  if (!id) { await remember(venueRef, { missing: true, matchedOn: name }); return null; }
  await remember(venueRef, { sourceRef: id, confidence: Number(best.like.toFixed(2)), matchedOn: name, metres: best.m });
  return id;
}

/**
 * What the crowd made of a place, and what a few of them wrote.
 *
 * Held in memory for six hours and nowhere else. Long enough that scrolling
 * back into a place is free, short enough that a rating is never badly stale,
 * and — because it is memory — gone at the next deploy rather than sitting in a
 * table it is not allowed to sit in.
 */
const kept = new Map();
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX = 400;

export async function reviewsFor({ venueRef, name, lat, lng, householdId = null }) {
  const hit = kept.get(venueRef);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const id = await googleRefFor({ venueRef, name, lat, lng, householdId });
  if (!id) {
    const value = { rating: null, ratingCount: null, reviews: [], attribution: null, matched: false };
    kept.set(venueRef, { at: Date.now(), value });
    return value;
  }

  const v = await googleSource.get(id).catch(() => null);
  await providerCalls.record(householdId, 'google', 'atlas.reviews', JSON.stringify({ google: 1 })).catch(() => null);
  const value = {
    rating: v?.rating ?? null,
    ratingCount: v?.ratingCount ?? null,
    reviews: v?.reviews ?? [],
    // Showing a provider's reviews carries their credit; it is a condition of
    // being allowed to show them, not a courtesy.
    attribution: v ? (googleSource.attribution?.text ?? 'Powered by Google') : null,
    matched: Boolean(v),
  };
  kept.set(venueRef, { at: Date.now(), value });
  while (kept.size > MAX) kept.delete(kept.keys().next().value);
  return value;
}

/**
 * Ratings for a list of places, for the cards and rows that draw them.
 *
 * The handoff's dark card reads "20 min drive · ★ 4.5 (3.2k)", which means a
 * rating for every place on screen and not just the one somebody opened. The
 * owner asked for it outright (7 Sep 2026: "move Google to once per place we
 * show… I do not want to compromise on data"), so nothing here rations it.
 *
 * What it does do is buy the cheap thing. A card wants a number and a count,
 * and `googleSource.rating` asks for exactly those three fields — the full
 * detail that the click-through uses carries hours, photos and five reviews and
 * is billed accordingly. Asking for that to print one number would be paying
 * enterprise rates for a star.
 *
 * The rest is the same bargain as everywhere else here: the match is stored for
 * good, so a place costs two calls the first time it is ever seen, one when the
 * six-hour memory has lapsed, and nothing in between. Only the match is
 * written down — the number itself is rented.
 *
 * The household's monthly ceiling is the real guard, and it is the owner's to
 * set. There is deliberately no second, hidden cap in here: a screen that
 * quietly showed half its ratings would be worse than one that showed none.
 */
export async function ratingsFor(refs, { householdId = null, places = new Map() } = {}) {
  const out = {};
  for (const ref of refs) {
    const hit = kept.get(ref);
    if (hit && Date.now() - hit.at < TTL_MS) {
      if (hit.value.rating != null) out[ref] = { rating: hit.value.rating, ratingCount: hit.value.ratingCount };
      continue;
    }
    const p = places.get(ref);
    if (!p?.name || p.lat == null || p.lng == null) continue;
    const id = await googleRefFor({ venueRef: ref, name: p.name, lat: p.lat, lng: p.lng, householdId }).catch(() => null);
    if (!id) continue;
    const got = await googleSource.rating(id).catch(() => null);
    await providerCalls.record(householdId, 'google', 'atlas.rating', JSON.stringify({ google: 1 })).catch(() => null);
    if (!got) continue;
    // Remembered under the same key the click-through reads, so opening a place
    // whose star is already on screen does not buy the number twice.
    const prev = kept.get(ref)?.value;
    kept.set(ref, { at: Date.now(), value: { ...(prev ?? { reviews: [], attribution: null, matched: true }), rating: got.rating, ratingCount: got.ratingCount } });
    if (got.rating != null) out[ref] = { rating: got.rating, ratingCount: got.ratingCount };
  }
  while (kept.size > MAX) kept.delete(kept.keys().next().value);
  return out;
}
