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
 * refused** (C61; see migration 322). Nothing here spends: it never makes a
 * Google call, it reads a detail another request already paid for.
 */

import { query, withTransaction } from '../db.js';
import { candidatesFor, plainKindOf, gateWord, ageWord, normalise } from '../domain/questions.js';
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
  // A gate or age signal is a feature when it names a facility — "baby changing",
  // "step free access", "soft play", "wheelchair access". A bare age word on its
  // own ("toddler", "family", "baby" from "our toddlers loved it") is not a
  // facility and must not ride in on the signal alone (Codex, 2 Oct 2026), so the
  // shortcut needs a second word.
  if ((gateWord(w) || ageWord(w)) && words.length > 1) return true;
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
  // Through the same normaliser a spotted word goes through — a fact named "Water
  // slides" is known to the spotted norm "water slide" (Codex, 2 Oct 2026).
  for (const r of rows) {
    keys.add(normalise(r.key));
    keys.add(normalise(r.label));
  }
  // A wording deliberately aliased onto an active fact is known too — otherwise a
  // spotted synonym reads as new and offers Approve, though approveFeature would
  // only reuse the aliased fact (Codex, 2 Oct 2026). The alias norm is stored in
  // our normalised form, so it matches a spotting norm directly.
  const { rows: aliases } = await run(
    'select a.norm from attribute_aliases a join place_attributes p on p.key = a.target_key and p.active');
  for (const r of aliases) keys.add(String(r.norm).trim().toLowerCase());
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
  const empty = (filtered = 0) => ({ subcategory: null, queued: 0, filtered, known: 0, features: [] });
  if (!venueRef || !detail) return empty();
  const raisedAll = candidatesFor({
    texts: [
      ...(detail.reviewSummary ? [{ source: 'google', text: String(detail.reviewSummary) }] : []),
      ...(detail.aiSummary ? [{ source: 'google', text: String(detail.aiSummary) }] : []),
      ...((Array.isArray(detail.reviews) ? detail.reviews : []).map((r) => ({ source: 'google', text: typeof r === 'string' ? r : (r?.text?.text ?? r?.text ?? r?.originalText?.text ?? null) })).filter((t) => t.text)),
    ],
  });
  const features = new Map([...raisedAll].filter(([norm]) => looksLikeFeature(norm)));
  const filtered = raisedAll.size - features.size;
  // Counts only — what was raised, what the filter dropped, what was queued — so the
  // owner's report can say how many opinions and fragments were filtered out beside
  // the features kept. Never any of the text (migration 367).
  const tally = (run, { tombstoned = 0, queued = 0 } = {}) => run(
    'insert into review_spotting_tallies (venue_ref, raised, filtered, tombstoned, queued) values ($1, $2, $3, $4, $5)',
    [venueRef, raisedAll.size, filtered, tombstoned, queued]);
  if (!features.size) {
    // Every pass is a row, a pass that raised nothing included — the tally counts
    // passes and places, and an empty one is still a place read (Codex, 2 Oct 2026).
    await tally((t, p) => (client ? client.query(t, p) : query(t, p)));
    return empty(filtered);
  }

  // The tombstone read and the sighting/candidate writes run in one transaction,
  // serialized per-norm against ignoreFeature by a transaction-scoped advisory lock
  // (Codex, 2 Oct 2026). Without it, ignoreFeature could commit its tombstone
  // between our read and our writes, and a fresh sighting would reopen a word that
  // was permanently ignored. ignoreFeature/approveFeature take the same lock.
  const work = async (tx) => {
    const run = (t, p) => tx.query(t, p);
    // Sorted, so two concurrent spots acquire overlapping locks in the same order
    // and cannot deadlock; held until commit.
    const locked = [...features.keys()].sort();
    for (const n of locked) await run('select pg_advisory_xact_lock(hashtext($1)::bigint)', [`feature:${n}`]);
    // Ignoring a feature in the review queue is for good, across every drawer (C30/C61,
    // "Ignoring a word is permanent"). The scope is recorded explicitly in
    // `feature_tombstones` — written only by `ignoreFeature`, the norm-level decision,
    // never by the per-subcategory `ignoreCandidate`. Drop any tombstoned norm before
    // anything is written, so a fresh drawer can never reopen an ignored feature.
    const { rows: tombstoned } = await run('select norm from feature_tombstones where norm = any($1)', [locked]);
    for (const t of tombstoned) features.delete(t.norm);
    if (!features.size) { await tally(run, { tombstoned: tombstoned.length }); return empty(filtered); }

    const subcategory = await subcategoryOf(venueRef, tx);
    if (!subcategory) { await tally(run, { tombstoned: tombstoned.length }); return empty(filtered); }

    const known = await knownFeatureKeys(tx);
    const entries = [];
    const norms = [...features.keys()];
    for (const [norm, e] of features) {
      // One sighting per (feature, place), idempotent: searching the same place
      // again updates its polarity and does not count the place twice. The honest
      // "how many places" is a count(distinct venue_ref) over these rows, read below.
      await run(
        `insert into review_sightings (norm, venue_ref, raw, asserts, denies, asks)
           values ($1, $2, $3, $4, $5, $6)
         on conflict (norm, venue_ref) do update
           set asserts = excluded.asserts, denies = excluded.denies, asks = excluded.asks,
               raw = excluded.raw, last_seen = now()`,
        [norm, venueRef, e.raw, e.asserts, e.denies, e.asks]);
      entries.push({
        norm, raw: e.raw, rawForms: [e.raw],
        sources: ['google'],            // rented: no evidence quote is kept (QUOTABLE_SOURCES)
        examples: [venueRef],           // the place → feature link; cleared on promote/ignore
        kind: 'feature',                // a candidate feature; still unpromotable without an owned quote
        placesSeen: 1,
        asserts: e.asserts, denies: e.denies, asks: e.asks,
      });
    }
    // The candidate itself lives in the pen through the normal door, so the existing
    // ignore/promote machinery covers it. recordCandidates merges a repeat with
    // greatest(), which is safe — it never overwrites a count another source (the
    // feature harvest) put there; the per-place totals are NOT written to the shared
    // candidate, they are read from review_sightings (Codex, 2 Oct 2026).
    const recorded = await recordCandidates(subcategory, entries, { placesTotal: 1, client: tx });
    // Queued = rows that reached the queue (inserted, or updated while undecided).
    // A word this drawer ignored, or one already promoted, is refused by the write and
    // must not be counted as queued (Codex, 2 Oct 2026).
    const queued = recorded?.touched ?? 0;

    // The accurate count per feature, for the report and the review queue: distinct
    // places, in the place's CURRENT drawer, ignoring any since deleted — derived by
    // joining place_index, never from a stored subcategory (Codex, 2 Oct 2026).
    const { rows: counts } = await run(
      `select s.norm,
              count(distinct s.venue_ref) as places,
              sum(s.asserts) as asserts, sum(s.denies) as denies, sum(s.asks) as asks
         from review_sightings s
         join place_index p on p.venue_ref = s.venue_ref
        where s.norm = any($1) and p.subcategory = $2
        group by s.norm`,
      [norms, subcategory]);
    const byNorm = Object.fromEntries(counts.map((r) => [r.norm, r]));
    const report = norms.map((norm) => {
      const c = byNorm[norm] ?? {};
      return { norm, known: known.has(norm), places: Number(c.places ?? 1), asserts: Number(c.asserts ?? 0), denies: Number(c.denies ?? 0), asks: Number(c.asks ?? 0) };
    });
    await tally(run, { tombstoned: tombstoned.length, queued });
    return { subcategory, queued, filtered, known: report.filter((r) => r.known).length, features: report };
  };

  return client ? work(client) : withTransaction(work);
}

/** Never let spotting break or slow the search that fed it (C30 is advisory only). */
export function spotInBackground(args) {
  return Promise.resolve().then(() => spotFromDetail(args)).catch(() => null);
}

/**
 * The review queue: every feature review-spotting has raised and nobody has yet
 * decided, with how many places mention it and an example of the drawer it was
 * seen in — the list the owner approves or ignores (C30/C61). Each place count is
 * a `count(distinct venue_ref)` over `review_sightings`, joined to `place_index`
 * so a deleted place is gone and a reclassified one counts in its current drawer.
 * A decided feature has no sightings (they are dropped on approve/ignore), so it
 * falls out of the queue by itself. `known` marks a feature already in our fact
 * list — shown as a verification suggestion rather than something new to approve.
 */
export async function reviewQueue({ limit = 200, subcategory = null } = {}) {
  const known = await knownFeatureKeys();
  // The word must still be awaiting a decision somewhere (a promoted or
  // review-queue-ignored word has no undecided candidate left, and an ignored one is
  // tombstoned so it is never re-spotted). The exists is global, not tied to the
  // sighting's drawer, so a place reclassified after it was spotted still counts in
  // its new drawer (Codex, 2 Oct 2026). A sighting is dropped only from a drawer that
  // explicitly ignored the word per-subcategory (ignoreCandidate) — that drawer said
  // "never ask here", so its places must not count or be asked.
  const where = queueWhere(subcategory ? '$2' : null);
  const params = subcategory ? [limit, subcategory] : [limit];
  const { rows } = await query(
    `select s.norm,
            min(s.raw) as raw,
            count(distinct s.venue_ref) as places,
            min(p.subcategory) as example_subcategory,
            sum(s.asserts) as asserts, sum(s.denies) as denies, sum(s.asks) as asks,
            max(s.last_seen) as last_seen
       from review_sightings s
       join place_index p on p.venue_ref = s.venue_ref
       ${where}
      group by s.norm
      order by count(distinct s.venue_ref) desc, s.norm
      limit $1`,
    params);
  return rows.map((r) => ({
    norm: r.norm,
    raw: r.raw ?? r.norm,
    places: Number(r.places),
    exampleSubcategory: r.example_subcategory,
    asserts: Number(r.asserts), denies: Number(r.denies), asks: Number(r.asks),
    mostlyAgainst: (Number(r.denies) + Number(r.asks)) > Number(r.asserts),
    known: known.has(r.norm),
    lastSeen: r.last_seen,
  }));
}

/**
 * Which sightings belong in the queue — one definition, shared by the page and
 * the counts so the two can never disagree. `subParam` is the placeholder for a
 * subcategory filter, or null for the whole queue.
 */
function queueWhere(subParam) {
  // Undecided means no decision at all — a filed word is 'unresolved' but decided.
  const undecided = "exists (select 1 from harvest_candidates c where c.norm = s.norm and c.sources ? 'google' and c.status in ('new', 'unresolved') and c.decided_at is null)";
  const notIgnoredHere = "not exists (select 1 from harvest_candidates ci where ci.norm = s.norm and ci.subcategory = p.subcategory and ci.status = 'ignored')";
  return subParam
    ? `where p.subcategory = ${subParam} and ${undecided} and ${notIgnoredHere}`
    : `where ${undecided} and ${notIgnoredHere}`;
}

/**
 * How many features are waiting — new to approve and already facts — over the
 * WHOLE queue, not the page `reviewQueue` returns. A count read off a capped page
 * understates the queue once it passes the limit (Codex, 2 Oct 2026).
 */
export async function reviewQueueCounts({ subcategory = null } = {}) {
  const known = await knownFeatureKeys();
  const { rows } = await query(
    `select distinct s.norm
       from review_sightings s
       join place_index p on p.venue_ref = s.venue_ref
       ${queueWhere(subcategory ? '$1' : null)}`,
    subcategory ? [subcategory] : []);
  const knownCount = rows.filter((r) => known.has(r.norm)).length;
  return { newCount: rows.length - knownCount, knownCount };
}

/**
 * What review-spotting has done since it started counting (migration 367): how many
 * passes over how many places, how many phrases the reviews raised, how many the
 * concrete-feature filter dropped (opinions, service words, fragments), how many it
 * found already ignored for good, and how many it queued. Counts only. Passes before
 * the tallies existed are not in it — `since` says where the count begins, and a
 * count with no passes behind it is null rather than a nought (CLAUDE.md, can't speak).
 */
export async function spottingTally() {
  const { rows: [t] } = await query(
    `select count(*)::int as spots, count(distinct venue_ref)::int as places,
            coalesce(sum(raised), 0)::int as raised, coalesce(sum(filtered), 0)::int as filtered,
            coalesce(sum(tombstoned), 0)::int as tombstoned, coalesce(sum(queued), 0)::int as queued,
            min(spotted_at) as since, max(spotted_at) as latest
       from review_spotting_tallies`);
  if (!t.spots) return { spots: 0, places: 0, raised: null, filtered: null, tombstoned: null, queued: null, since: null, latest: null };
  return t;
}
