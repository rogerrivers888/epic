import { query } from '../db.js';
import { googleSource } from './google.js';
import { tripadvisorSource } from './tripadvisor.js';
import { googleSaysPublic } from '../domain/visiting.js';
import * as providerCalls from '../repositories/providerCalls.js';
import { whySourceFailed } from './why.js';

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

/** The match we hold for this place at one provider — Google unless said otherwise (migration 080: one row per pair). */
export async function matchKept(venueRef, source = 'google') {
  const { rows } = await query(
    'select source, source_ref, confidence, missing from provider_matches where venue_ref = $1 and source = $2',
    [venueRef, source]);
  return rows[0] ?? null;
}

/** Every place we have already asked one provider about, matched or missed — so a run never asks twice. */
export async function triedFor(refs, source = 'google') {
  if (!refs?.length) return new Set();
  const { rows } = await query('select venue_ref from provider_matches where source = $2 and venue_ref = any($1)', [refs, source]);
  return new Set(rows.map((r) => r.venue_ref));
}

/** The matches held at one provider for many places, keyed by venue ref. Misses are left out. */
export async function matchesFor(refs, source = 'google') {
  if (!refs?.length) return new Map();
  const { rows } = await query(
    'select venue_ref, source_ref from provider_matches where source = $2 and missing = false and venue_ref = any($1)',
    [refs, source]);
  return new Map(rows.map((r) => [r.venue_ref, r.source_ref]));
}

async function remember(venueRef, match) {
  await query(
    `insert into provider_matches (venue_ref, source, source_ref, confidence, matched_on, metres, missing)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (venue_ref, source) do update set
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
/**
 * `strict` makes a provider failure a thrown error rather than a null: the
 * back office's compare wants to say "Google could not be reached" and not
 * "Google has no such place". Either way a failure is never remembered as a
 * miss — a search that timed out has not looked, so the next open must be
 * allowed to (Codex, 12 Sep 2026).
 */
export async function googleRefFor(args) {
  return (await googleMatchFor(args))?.id ?? null;
}

/**
 * The match, with what the search said about the place at the moment it was
 * found: the rating and the count. Those two figures are rented — the caller
 * bands them or holds them in memory, and nothing here writes them down. A
 * match already held comes back without them, because the search that saw
 * them is long gone.
 */
export async function googleMatchFor({ venueRef, name, lat, lng, householdId = null, strict = false }) {
  if (!venueRef || !name || lat == null || lng == null) return null;
  // Already a provider's own place: nothing to match.
  if (String(venueRef).startsWith('google:')) return { id: String(venueRef).slice('google:'.length), rating: null, ratingCount: null, held: true };

  const kept = await matchKept(venueRef);
  if (kept) return kept.missing ? null : { id: kept.source_ref, rating: null, ratingCount: null, held: true };
  if (!googleSource.enabled()) return null;

  let failure = null;
  const found = await googleSource.search({
    center: { lat, lng }, radiusKm: 3, query: name, limit: 8,
  }).catch((err) => { failure = Object.assign(err instanceof Error ? err : new Error(String(err)), { provider: 'google' }); return []; });
  await providerCalls.record(householdId, 'google', 'atlas.match', JSON.stringify({ google: 1 })).catch(() => null);
  if (failure) {
    if (strict) throw failure;
    return null;
  }

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
  return { id, rating: best.v.rating ?? null, ratingCount: best.v.ratingCount ?? null, held: false };
}

/**
 * The same join at Tripadvisor: one name search, the same two guards, only
 * the identifier remembered. Every location Terra returns is billed, so the
 * caller passes a meter and watches it (routes/lookup.js keeps to the owner's
 * cap). A failure is thrown, tagged, and never remembered as a miss.
 */
export async function tripadvisorMatchFor({ venueRef, name, lat, lng, category = 'attraction', locality = null, meter = null }) {
  if (!venueRef || !name || lat == null || lng == null) return null;
  if (String(venueRef).startsWith('tripadvisor:')) return { id: String(venueRef).slice('tripadvisor:'.length), held: true };
  const kept = await matchKept(venueRef, 'tripadvisor');
  if (kept) return kept.missing ? null : { id: kept.source_ref, rating: null, ratingCount: null, held: true };
  if (!tripadvisorSource.enabled()) return null;
  let hit;
  try {
    hit = await tripadvisorSource.match({ name, lat, lng, category }, { locality, meter });
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { provider: 'tripadvisor' });
  }
  if (!hit) { await remember(venueRef, { source: 'tripadvisor', missing: true, matchedOn: name }); return null; }
  await remember(venueRef, { source: 'tripadvisor', sourceRef: hit.sourcePlaceId, confidence: Number(likeness(name, hit.name).toFixed(2)), matchedOn: name, metres: metresBetween({ lat, lng }, hit) });
  return { id: hit.sourcePlaceId, rating: hit.rating ?? null, ratingCount: hit.ratingCount ?? null, held: false };
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
/**
 * Note that a place is somewhere the public goes, when Google has just said so.
 *
 * The owner, 7 Sep 2026: "I don't feel like there's a big deal with just
 * checking the Google data to see whether it's a private residence or not…"
 *
 * Two things this deliberately does not do. It never writes what Google said —
 * no name, no rating, no hours, and not the type list either; only our own
 * one-word conclusion, tagged `google` so every row it touched can be found and
 * dropped in one statement if the position ever changes. And it never concludes
 * that somewhere *is* private: Google has no type for a house, so its silence
 * about a place is mostly a fact about Google. Silence leaves the verdict
 * unestablished, and an unestablished place is not shown anyway — which gets
 * the outcome asked for without putting words in anybody's mouth.
 *
 * It only ever fills a gap. Anything a person settled, or that the open sources
 * already answered, is left exactly as it was.
 */
async function noteGoogleVisiting(venueRef, got) {
  const said = googleSaysPublic(got);
  if (!said) return;
  const m = String(venueRef || '').match(/^(wikidata|osm):(.+)$/);
  if (!m) return;
  const [, kind, id] = m;
  await query(
    `update attractions
        set visiting = 'yes', visiting_because = $2, visiting_by = 'google', visiting_at = now()
      where ${kind === 'wikidata' ? 'wikidata_id' : 'osm_ref'} = $1
        and visiting is null
        and (visiting_by is null or visiting_by in ('rule', 'kinds', 'summary', 'osm', 'wikipedia', 'google'))`,
    [id, said]).catch(() => null);
}

export async function ratingsFor(refs, { householdId = null, places = new Map() } = {}) {
  const out = {};
  /**
   * Why the answer is short, when it is short for a reason.
   *
   * Every square now draws a rating slot, and a slot that says "No ratings
   * yet" under a hundred places when the truth is that today's allowance is
   * spent has told the household something false about those places. So a
   * refusal travels back as one plain sentence — never the provider's own text
   * (why.js) — and the screen holds its lines blank instead of asserting.
   */
  let sourceError = null;
  for (const ref of refs) {
    const hit = kept.get(ref);
    if (hit && Date.now() - hit.at < TTL_MS) {
      if (hit.value.rating != null) out[ref] = { rating: hit.value.rating, ratingCount: hit.value.ratingCount };
      continue;
    }
    // Once the source has refused there is nothing to be had from asking about
    // the other twenty-three, and — the part that matters — a place must never
    // be written down as unmatchable on the strength of an exhausted quota.
    if (sourceError) break;
    const p = places.get(ref);
    if (!p?.name || p.lat == null || p.lng == null) continue;
    let id = null;
    try {
      id = await googleRefFor({ venueRef: ref, name: p.name, lat: p.lat, lng: p.lng, householdId });
    } catch (err) { sourceError = whySourceFailed('google', err); break; }
    if (!id) continue;
    let got = null;
    try {
      got = await googleSource.rating(id);
    } catch (err) { sourceError = whySourceFailed('google', err); }
    await providerCalls.record(householdId, 'google', 'atlas.rating', JSON.stringify({ google: 1 })).catch(() => null);
    if (sourceError) break;
    if (!got) continue;
    // Asked and answered on a call we were making anyway.
    await noteGoogleVisiting(ref, got);
    // Remembered under the same key the click-through reads, so opening a place
    // whose star is already on screen does not buy the number twice.
    const prev = kept.get(ref)?.value;
    kept.set(ref, { at: Date.now(), value: { ...(prev ?? { reviews: [], attribution: null, matched: true }), rating: got.rating, ratingCount: got.ratingCount } });
    if (got.rating != null) out[ref] = { rating: got.rating, ratingCount: got.ratingCount };
  }
  while (kept.size > MAX) kept.delete(kept.keys().next().value);
  return { ratings: out, sourceError };
}
