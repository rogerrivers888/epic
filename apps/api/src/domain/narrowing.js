/**
 * Notability narrowing for churches, landmarks and monuments — PROPOSE ONLY.
 *
 * Owner, 1 Oct 2026: in a 20→30 min drive ring from SL5 0JD, Culture went
 * 78 → 1,005, of which 435 were churches and ~450 landmarks/monuments, against
 * only 33 museums. "Ordinary places of worship, statues, memorials and plaques
 * must not count in 'museums and galleries' or as things to do." His test for
 * what stays: a church is kept only when notable — a cathedral, abbey or
 * minster; or it has a Wikipedia article; or it has visitor facilities /
 * opening hours; or it is Grade I or II* listed, a scheduled monument or a
 * World Heritage Site. The same test for landmarks and monuments. Everything
 * else is "not surfaced" — kept in the data and the back
 * office, left out of family surfacing and the Culture ring counts.
 *
 * This module is the predicate only. It is **pure**: it reads a `signals`
 * object that the repository assembles from what we already hold, and never
 * touches a database or a provider. Nothing here changes filing, hides a place,
 * or writes a surfacing; it measures. Applying the rule is a separate step the
 * owner approves first (H1).
 *
 * Every signal is drawn only from data we own or may freely read (CLAUDE.md,
 * the data policy): an owned name (place_records / the atlas), Google's own type
 * words and OSM's labels (classifications, not content), the open map's tags
 * from our own copy, an encyclopedia link, and the Historic England listing.
 * No rented name, rating, review or photo is read, and no live call is made.
 *
 * **The can't-speak rule (CLAUDE.md).** A verdict names the evidence it is drawn
 * from and withholds itself when that evidence is too thin — `null` and a
 * reason, never a number that happens to be nought. The Grade I signal is the
 * one that can be unavailable: the Historic England list is loaded on our own
 * disk by a weekly loader (migration 308, C59), and until a load has arrived
 * whole there is nothing to test against. When that is so, a place with no
 * *other* notable signal is **not** dropped — it would be wrong to assert "not
 * notable" when a Grade I listing we cannot see would keep it — it is returned
 * as `cant-speak`, counted apart from the drops, with the reason on it.
 */

/** The owner's three church-kind words, as he named them. */
export const KIND_WORDS = ['cathedral', 'abbey', 'minster'];

/**
 * Priory and friary are monasteries by another name and a fair candidate, but
 * the owner kept his list to three words. So they are admitted only when a type
 * clearly says monastery, and the verdict is flagged `candidate` so the choice
 * is visible rather than smuggled in.
 */
export const CANDIDATE_KIND_WORDS = ['priory', 'friary'];

/** Google's own type words for a place of worship (domain/googleSuggest.js). */
const WORSHIP_GOOGLE = new Set([
  'church', 'place_of_worship', 'hindu_temple', 'mosque', 'synagogue',
  'buddhist_temple', 'shinto_shrine',
]);

/** OSM `building=` values that are a place of worship or a monastery. */
const WORSHIP_OSM_BUILDING = new Set([
  'church', 'cathedral', 'chapel', 'monastery', 'abbey', 'basilica', 'minster',
]);

/** OSM values that mean a monastic house, for the priory/friary candidate. */
const MONASTERY = new Set(['monastery', 'abbey']);

const lower = (x) => String(x ?? '').toLowerCase();
const words = (name) => lower(name)
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .split(' ')
  .filter(Boolean);

/**
 * The kind word only when it is the last word of the name — "Westminster
 * Abbey", "York Minster", "Truro Cathedral". This is what keeps "Abbey Road
 * Studios", "Minster Court" and "Cathedral Quarter" out: the word is there, but
 * it is not what the place *is*.
 */
export function lastWordKind(name) {
  const w = words(name);
  const last = w[w.length - 1];
  return KIND_WORDS.includes(last) ? last : null;
}

/** The kind word anywhere in the name, as a whole word. */
export function containsKindWord(name) {
  const w = new Set(words(name));
  return KIND_WORDS.find((k) => w.has(k)) ?? null;
}

/** A candidate word (priory/friary) anywhere in the name, as a whole word. */
export function containsCandidateWord(name) {
  const w = new Set(words(name));
  return CANDIDATE_KIND_WORDS.find((k) => w.has(k)) ?? null;
}

const labelSet = (signals) => new Set((signals.labels ?? []).map(lower));
const typeSet = (signals) => new Set((signals.googleTypes ?? []).map(lower));

/** Whether what we hold says this is a place of worship at all. */
export function worshipKind(signals) {
  const types = typeSet(signals);
  for (const t of types) if (WORSHIP_GOOGLE.has(t)) return true;
  const labels = labelSet(signals);
  if (labels.has('osm:amenity=place_of_worship')) return true;
  for (const l of labels) {
    if (l.startsWith('osm:building=') && WORSHIP_OSM_BUILDING.has(l.slice('osm:building='.length))) return true;
  }
  const t = signals.osmTags ?? {};
  if (lower(t.amenity) === 'place_of_worship') return true;
  if (WORSHIP_OSM_BUILDING.has(lower(t.building))) return true;
  if (['church', 'monastery', 'abbey', 'chapel'].includes(lower(t.historic))) return true;
  return false;
}

/** Whether a type (not a name) says this is a monastic house. */
export function monasteryKind(signals) {
  const t = signals.osmTags ?? {};
  if (MONASTERY.has(lower(t.building))) return true;
  if (MONASTERY.has(lower(t.historic))) return true;
  const labels = labelSet(signals);
  if (labels.has('osm:building=monastery') || labels.has('osm:building=abbey')) return true;
  if (labels.has('osm:historic=monastery') || labels.has('osm:historic=abbey')) return true;
  return false;
}

/**
 * The cathedral / abbey / minster test, by type where a type says it and by
 * name where the name does — and never by a name that only borrows the word.
 * Returns `{ word, via, candidate? }` or null.
 */
export function cathedralAbbeyMinster(signals) {
  const t = signals.osmTags ?? {};
  const building = lower(t.building);
  const labels = labelSet(signals);

  // By type first: an OSM `building=cathedral` is unambiguous.
  if (building === 'cathedral' || labels.has('osm:building=cathedral')) {
    return { word: 'cathedral', via: 'OSM building=cathedral' };
  }
  if (building === 'minster' || labels.has('osm:building=minster')) {
    return { word: 'minster', via: 'OSM building=minster' };
  }
  // An abbey is one of the owner's three words — a direct keep. A monastery is
  // not: it is the priory/friary territory, so `building=monastery` on its own
  // keeps nothing, and only lends the "monastery type" the candidate path below
  // needs when the name actually says priory or friary (owner kept the list to
  // three words). Folding the two together auto-kept every monastery and left
  // the candidate logic unreachable (Codex).
  if (building === 'abbey' || labels.has('osm:building=abbey')) {
    return { word: 'abbey', via: 'OSM building=abbey' };
  }

  // By name: the word as the last word of the name is what the place is.
  const last = lastWordKind(signals.name);
  if (last) return { word: last, via: 'name' };

  // The word mid-name is trusted only alongside a worship type, so
  // "Abbey Church of St Alban" is kept but "Abbey Road Studios" is not.
  const contained = containsKindWord(signals.name);
  if (contained && worshipKind(signals)) return { word: contained, via: 'name + place-of-worship type' };

  // Priory / friary: only with a monastery type, and flagged as a candidate.
  const cand = containsCandidateWord(signals.name);
  if (cand && monasteryKind(signals)) return { word: cand, via: 'name + monastery type', candidate: true };

  return null;
}

/**
 * The visitor-facilities / opening-hours signals, from the venue's own page and
 * the open map's tags. Returns the list of facts that fired (possibly empty).
 */
export function visitorFacilities(signals) {
  const out = [];
  const t = signals.osmTags ?? {};
  // A negative or sentinel value is not a facility: wheelchair=no says access is
  // absent, opening_hours=closed/off is not a schedule, fee=no is not a fee
  // (Codex). Treat only real values as evidence.
  const neg = (v) => ['', 'no', 'none', 'false', '0', 'off', 'closed'].includes(String(v ?? '').trim().toLowerCase());
  if (signals.openingHours || (t.opening_hours && !neg(t.opening_hours))) out.push('opening hours');
  if (signals.website || (t.website && !neg(t.website)) || (t['contact:website'] && !neg(t['contact:website']))) out.push('a website');
  if (t.tourism && !neg(t.tourism)) out.push(`OSM tourism=${t.tourism}`);
  if (t.fee != null && !neg(t.fee)) out.push('an admission fee tag');
  if (t.wheelchair && !neg(t.wheelchair)) out.push('a wheelchair-access tag');
  return [...new Set(out)];
}

/**
 * The heritage verdict for one place, or null when the Historic England list is
 * not loaded (can't-speak on this one signal). The designations the owner named
 * as keeping a place — "Grade I or II* listed, scheduled monument" — plus a
 * World Heritage Site count (owner, 1 Oct 2026: Grade II* is now a keep). Plain
 * Grade II is reported by the gatherer as a near-miss but is not notability here.
 */
export function heritageNotable(signals) {
  if (signals.heritageAvailable === false) return null;
  const h = signals.heritage;
  if (!h) return false;
  if (h.gradeI) return 'Grade I listed';
  if (h.grade2star) return 'Grade II* listed';
  if (h.scheduled) return 'a scheduled monument';
  if (h.worldHeritage) return 'a World Heritage Site';
  return false;
}

/**
 * The surfacing bar's own words for a place that is not surfaced. The owner
 * (item 4, 1 Oct 2026): state the true cause — there is no listing match, no
 * article and no facilities held — and never "listing data is not loaded", which
 * is false (the Historic England list shipped with migration 308). For surfacing
 * there is no can't-tell: this one reason covers every not-surfaced place.
 */
export const NOT_SURFACED_REASON =
  'no notable evidence held — no listing match, article or facilities';

/**
 * The predicate. Given what we hold on a place, is it notable enough to surface?
 *
 * Returns `{ status, notable, signals, reason }` where:
 *   status 'kept'       at least one notable signal fired;
 *          'dropped'    none did, and every signal (including Grade I) could be
 *                       read — so "not notable" is a real answer;
 *          'cant-speak' none did, but the Historic England list is not loaded,
 *                       so a Grade I listing cannot be ruled out. `notable` is
 *                       null and the reason says why (never a false drop).
 */
export function notable(signals = {}) {
  const hits = [];

  const kind = cathedralAbbeyMinster(signals);
  if (kind) hits.push(`${kind.candidate ? 'likely ' : ''}${kind.word} (${kind.via})`);

  if (signals.hasWikipedia) hits.push('has an encyclopedia article');

  hits.push(...visitorFacilities(signals));

  const heritageAvailable = signals.heritageAvailable !== false;
  const her = heritageNotable(signals);
  if (her) hits.push(her);

  const isNotable = hits.length > 0;
  const status = isNotable ? 'kept' : heritageAvailable ? 'dropped' : 'cant-speak';

  return {
    status,
    notable: status === 'cant-speak' ? null : isNotable,
    signals: hits,
    reason: status === 'kept'
      ? hits.join('; ')
      : status === 'dropped'
        ? 'no cathedral/abbey/minster, no encyclopedia article, no visitor facilities we hold, and not Grade I or II* listed, scheduled or World Heritage'
        // Can't-speak is a FACTS verdict (CLAUDE.md), not the surfacing bar: the
        // Historic England list cannot be checked here — the place is outside
        // England, or the list has not loaded in this environment — so a Grade I
        // or II* listing cannot be ruled out. (For surfacing this still reads as
        // "not surfaced"; see NOT_SURFACED_REASON.)
        : 'no notable signal in what we hold, and the Historic England listing cannot be checked here — a Grade I or II* listing cannot be ruled out',
  };
}
