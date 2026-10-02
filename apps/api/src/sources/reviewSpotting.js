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
 * A concrete feature is admitted by a POSITIVE signal, not by surviving a deny
 * list (Codex, 2 Oct 2026): the 21 Sep pass let every unknown word through, so
 * `fun`, `spacious`, `awesome` would land as "features". Here a candidate is a
 * feature only if it names one — a facility noun — and carries no opinion word.
 *
 * `FEATURE_SOLO` are the nouns that are a feature on their own (sauna, waterfall,
 * playground). `FEATURE_HEADS` are the head nouns a feature phrase ends in (the
 * `pad` of "splash pad", the `track` of "mini race track", the `room` of "steam
 * room") — broader, because the *modifier* is where a new feature's novelty lives
 * (splash, toddler, gruffalo) while the head is an ordinary facility word. A new
 * feature is still found: a new modifier on a known head. One whose head noun we
 * did not anticipate is missed rather than guessed at — precision over recall, and
 * the list grows as real ones turn up.
 */
const FEATURE_SOLO = new Set([
  'pool', 'lido', 'sauna', 'spa', 'jacuzzi', 'steamroom', 'playground', 'playpark', 'maze',
  'labyrinth', 'aquarium', 'zoo', 'farm', 'museum', 'gallery', 'planetarium', 'cinema', 'theatre',
  'arena', 'waterfall', 'fountain', 'lake', 'pond', 'reservoir', 'beach', 'cove', 'cave', 'cavern',
  'grotto', 'quarry', 'castle', 'fort', 'abbey', 'cathedral', 'chapel', 'lighthouse', 'windmill',
  'bridge', 'pier', 'jetty', 'harbour', 'trampoline', 'carousel', 'rollercoaster', 'flume', 'slide',
  'zipline', 'zipwire', 'arcade', 'bowling', 'minigolf', 'skatepark', 'splashpad', 'archery',
  'climbing', 'abseiling', 'kayaking', 'canoeing', 'campsite', 'glamping', 'picnic', 'bbq', 'cafe',
  'restaurant', 'bar', 'bistro', 'brasserie', 'pub', 'tearoom', 'conservatory', 'greenhouse',
  'orchard', 'meadow', 'woodland', 'forest', 'wetland', 'boardwalk', 'viewpoint', 'lookout', 'summit',
  'pavilion', 'bandstand', 'gazebo', 'paddock', 'stables', 'kennels', 'treehouse', 'dungeon',
  'funfair', 'fairground', 'helterskelter', 'carpark', 'toilets', 'roundabout', 'seesaw', 'swings',
  'sandpit', 'trail', 'track', 'ridge', 'waterpark', 'splashpark', 'adventure', 'fernery', 'rockery',
]);

/**
 * The head noun a feature phrase ends in. Includes the generic-but-valid heads
 * (`area`, `zone`, `room`, `point`, `course`) that are not a feature alone but are
 * the head of one in context — "picnic area", "soft play zone", "steam room",
 * "trig point", "assault course". Solo use of those is rejected (they are not in
 * `FEATURE_SOLO`); only a real modifier in front makes them a feature.
 */
const FEATURE_HEADS = new Set([
  ...FEATURE_SOLO,
  'pad', 'course', 'pitch', 'court', 'rink', 'wall', 'range', 'lane', 'lanes', 'alley', 'area',
  'zone', 'centre', 'center', 'hall', 'room', 'field', 'green', 'point', 'pit', 'bay', 'deck',
  'terrace', 'ride', 'rides', 'park', 'garden', 'gardens', 'house', 'barn', 'shed', 'hut', 'cabin',
  'lodge', 'tent', 'kiosk', 'stall', 'station', 'gym', 'studio', 'show', 'display', 'exhibition',
  'enclosure', 'sanctuary', 'reserve', 'walk', 'cruise', 'tour', 'workshop', 'frame', 'swing',
  'climber', 'net', 'nets', 'tunnel', 'tower', 'chute', 'rapids', 'wall', 'golf', 'karting', 'karts',
  'disco', 'party', 'cafe', 'kitchen', 'parlour', 'den', 'corner', 'yard', 'barn', 'play', 'pool',
  'slide', 'bridge', 'pond', 'lake', 'trail', 'path', 'maze', 'fountain', 'wheel', 'coaster',
]);

/**
 * Opinion, service and empty review words — rejected wherever they appear in a
 * phrase, so a real feature head with an opinion in front of it ("lovely garden",
 * "friendly staff") is not admitted. `plainKindOf` already knows the opinion and
 * condition words it was built with; this adds the food-opinion, service and
 * generic review vocabulary (delicious, staff, great) the owner named.
 */
const OPINION = new Set([
  'delicious', 'tasty', 'yummy', 'scrumptious', 'bland', 'moreish', 'staff', 'service', 'team',
  'waiter', 'waitress', 'server', 'manager', 'owner', 'host', 'hostess', 'great', 'good', 'nice',
  'lovely', 'amazing', 'excellent', 'superb', 'outstanding', 'brilliant', 'fabulous', 'fantastic',
  'wonderful', 'gorgeous', 'decent', 'okay', 'poor', 'mediocre', 'average', 'atmosphere', 'ambience',
  'ambiance', 'vibe', 'vibes', 'experience', 'gem', 'fun', 'interesting', 'spacious', 'awesome',
  'cosy', 'cozy', 'pretty', 'cute', 'beautiful', 'stunning', 'incredible', 'magical', 'magnificent',
  'impressive', 'exceptional', 'fresh', 'authentic', 'huge', 'massive', 'tiny', 'big', 'large',
  'small', 'spotless', 'pristine', 'dated', 'tired', 'shabby', 'cramped', 'modern', 'contemporary',
  'traditional', 'rustic', 'charming', 'quaint', 'delightful', 'memorable', 'enjoyable', 'relaxing',
  'peaceful', 'tranquil', 'vibrant', 'lively', 'friendly', 'welcoming', 'helpful', 'worth', 'value',
  'recommend', 'recommended', 'love', 'loved', 'enjoy', 'enjoyed', 'perfect', 'happy', 'disappointing',
]);

const isOpinionWord = (word) => OPINION.has(word) || Boolean(plainKindOf(word));

/**
 * Does this candidate name a concrete feature — a thing a place *has*?
 *
 * Positive signal, precision over recall: no opinion word anywhere in the phrase,
 * and a facility noun where it counts — a `FEATURE_SOLO` word on its own, a
 * `FEATURE_HEADS` word at the end of a phrase, or a gate/age signal (step-free,
 * baby changing) which is decisive for the people who need it. Everything else is
 * dropped; a feature with an unanticipated head is missed, not guessed at.
 */
export function looksLikeFeature(norm) {
  const w = String(norm ?? '').trim().toLowerCase();
  if (w.length < 3) return false;
  const words = w.split(/\s+/).filter(Boolean);
  // An opinion anywhere disqualifies — "lovely garden", "friendly staff".
  if (words.some(isOpinionWord)) return false;
  // Gate and age signals are features that matter at any frequency.
  if (gateWord(w) || ageWord(w)) return true;
  if (words.length === 1) return FEATURE_SOLO.has(w);
  return FEATURE_HEADS.has(words[words.length - 1]);
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

  const run = client ? (t, p) => client.query(t, p) : query;
  const known = await knownFeatureKeys(client);
  const entries = [];
  const report = [];
  for (const [norm, e] of features) {
    // One sighting per (feature, place), idempotent: searching the same place
    // again updates its polarity and does not count the place twice.
    await run(
      `insert into review_sightings (subcategory, norm, venue_ref, asserts, denies, asks)
         values ($1, $2, $3, $4, $5, $6)
       on conflict (subcategory, norm, venue_ref) do update
         set asserts = greatest(review_sightings.asserts, excluded.asserts),
             denies  = greatest(review_sightings.denies,  excluded.denies),
             asks    = greatest(review_sightings.asks,    excluded.asks),
             last_seen = now()`,
      [subcategory, norm, venueRef, e.asserts, e.denies, e.asks]);
    entries.push({
      norm, raw: e.raw, rawForms: [e.raw],
      sources: ['google'],            // rented: no evidence quote is kept (QUOTABLE_SOURCES)
      examples: [venueRef],           // the place → feature link; cleared on promote/ignore
      kind: 'feature',                // a candidate feature; still unpromotable without an owned quote
      placesSeen: 1,
      asserts: e.asserts, denies: e.denies, asks: e.asks,
    });
    report.push({ norm, known: known.has(norm) });
  }
  // Maintain the pen candidate (status, kind, the examples sample, the quote
  // gate) through the normal door …
  await recordCandidates(subcategory, entries, { placesTotal: 1, client });
  // … then set its counts to the honest aggregate over the sightings: the number
  // of distinct places, and the polarity summed across them. recordCandidates
  // merges with greatest(), which cannot accumulate one place at a time, so the
  // true totals are written here (Codex, 2 Oct 2026). Only the pen rows — a
  // promoted or ignored word is left as it was decided.
  const norms = [...features.keys()];
  await run(
    `update harvest_candidates c set
       places_seen = agg.places,
       places_total = agg.places,
       asserts = agg.asserts, denies = agg.denies, asks = agg.asks
     from (
       select norm,
              count(distinct venue_ref) as places,
              sum(asserts) as asserts, sum(denies) as denies, sum(asks) as asks
         from review_sightings where subcategory = $1 and norm = any($2)
         group by norm
     ) agg
     where c.subcategory = $1 and c.norm = agg.norm and c.status in ('new', 'unresolved')`,
    [subcategory, norms]);

  // Report accurate place counts for each feature (for the research stream / tests).
  const { rows: counts } = await run(
    'select norm, places_seen, asserts, denies, asks from harvest_candidates where subcategory = $1 and norm = any($2)',
    [subcategory, norms]);
  const byNorm = Object.fromEntries(counts.map((r) => [r.norm, r]));
  for (const r of report) {
    const c = byNorm[r.norm] ?? {};
    r.places = c.places_seen ?? 1; r.asserts = c.asserts ?? 0; r.denies = c.denies ?? 0; r.asks = c.asks ?? 0;
  }
  return { subcategory, queued: entries.length, filtered, known: report.filter((r) => r.known).length, features: report };
}

/** Never let spotting break or slow the search that fed it (C30 is advisory only). */
export function spotInBackground(args) {
  return Promise.resolve().then(() => spotFromDetail(args)).catch(() => null);
}
