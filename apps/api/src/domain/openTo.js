/**
 * "Just say what you are up for" — the casual half of meetups and mini tours
 * (owner, 13 Sep 2026, `Supporting docs/Groups & events NEW/Casual meet ups`).
 *
 * Every rule that makes this flow acceptable is here, pure and testable,
 * because each one is a promise made on screen:
 *
 *   * **A shared language is a requirement**, never a question. Only fluency
 *     is asked, and "fluent" asked by either side must be met by the other.
 *   * **Age, company and language, and nothing else.** Never ethnicity,
 *     religion or nationality, and never anything about a child.
 *   * **It has to fit both ways.** A preference is a filter on who reaches
 *     you, not a search — so both sides' preferences must admit the other, or
 *     there is no introduction. That is what stops it being used to hunt.
 *   * **A preference we cannot establish never makes a match.** Widening a
 *     filter we cannot check would be a lie told quietly.
 *   * **Family to family only.** A family entry never meets an adult one.
 *   * **The host is asked first**, always, and adds detail for that guest.
 *   * **A verdict is hidden until both are in**, so nobody answers knowing
 *     they have already been accepted, and **a no is silent**.
 *   * **A video is blind until both have recorded**, is for this one decision,
 *     and goes afterwards.
 */

export const AGE_PREFS = ['any', 'similar'];
export const COMPANY = ['anyone', 'women', 'men', 'couples', 'families'];
export const FLUENCY = ['fluent', 'some'];
export const SCOPES = ['standing', 'trip'];
export const KINDS = ['adult', 'family'];
export const STAGES = ['host_asked', 'guest_asked', 'videos', 'both_yes', 'verified', 'chat', 'lapsed', 'ended'];

/** A standing entry is re-asked every three months; nothing expires, it is just asked again. */
export const REVIEW_MONTHS = 3;
/** An unanswered introduction lapses after a week, with one nudge on the way. */
export const LAPSE_DAYS = 7;
/** Twenty seconds, one take. */
export const HELLO_SECONDS = 20;
/** How close two ages must be to count as "a similar age". */
export const SIMILAR_YEARS = 12;
/** How far a visitor may be from where somebody is up for things. */
export const NEAR_MILES = 25;

const norm = (s) => String(s ?? '').trim().toLowerCase();
const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

/**
 * What a household is, for the company rule — derived, never asked twice and
 * never guessed. A household with a child is a family; two or more adults are
 * a couple; one adult is an adult. Epic holds no record of anybody's sex, so
 * "women" and "men" are preferences it cannot establish, and a preference it
 * cannot establish never makes a match (see `companyFits`).
 */
export function partyOf(members = []) {
  const people = list(members);
  if (people.some((m) => m.is_minor || m.isMinor)) return 'families';
  return people.length >= 2 ? 'couples' : 'adults';
}

/**
 * Whether what somebody said about company admits the other party.
 *
 * `anyone` admits everybody and is the default. `families` and `couples` are
 * derivable and so can be honoured. `women` and `men` are not: nothing in Epic
 * records anybody's sex, so neither can be checked, and a filter that cannot
 * be checked must not be treated as met.
 */
export function companyFits(prefs, party) {
  const want = list(prefs).map(norm);
  if (!want.length || want.includes('anyone')) return true;
  return want.includes(norm(party));
}

/** Which of the stated preferences Epic cannot act on, so a screen can say so rather than pretend. */
export function unverifiablePrefs(prefs) {
  return list(prefs).map(norm).filter((p) => p === 'women' || p === 'men');
}

/** Every language the two share, at the level each holds it. */
export function sharedLanguages(a = [], b = []) {
  const mine = list(a).map((l) => ({ name: norm(l.name ?? l), level: norm(l.level ?? 'fluent') }));
  const theirs = list(b).map((l) => ({ name: norm(l.name ?? l), level: norm(l.level ?? 'fluent') }));
  const out = [];
  for (const m of mine) {
    const t = theirs.find((x) => x.name === m.name);
    if (t) out.push({ name: m.name, mine: m.level, theirs: t.level });
  }
  // The one they both speak best first, so a screen naming "the" shared
  // language names the one the conversation would actually happen in.
  return out.sort((x, y) => rank(y) - rank(x));
}
const rank = (l) => (l.mine === 'fluent' ? 1 : 0) + (l.theirs === 'fluent' ? 1 : 0);

/**
 * A place, cut down to somewhere you could name in a sentence — or nothing.
 *
 * A household's home is held as whatever they typed ("Fairways, Titlarks Hill,
 * Ascot, SL5 0JD"), and a trip's origin is the same. Nothing in this feature
 * may ever carry that: a home address is never shared, and the guest is told a
 * *town*.
 *
 * The first version of this took the last comma-separated part of whatever was
 * left, which worked on the formats it was tested with and handed back "sl5
 * 0jd" for a lowercase postcode and "12 High Street Windsor SL4 1AA" whole for
 * an address with no commas (Codex, 13 Sep 2026). So it does not salvage any
 * more: a label travels only when what comes out *looks like a place name* —
 * letters, spaces, hyphens and apostrophes, and not a street. Anything else is
 * null, and a screen that is told nothing says nothing. Losing the town is a
 * disappointment; sending the house is the thing this feature exists to
 * prevent.
 *
 * `routes/openTo.js` asks the geocoder for a real locality first and only
 * falls back to this, so the honest answer is usually available anyway.
 */
/** A code, not a place: carries a digit and nothing but digits, letters, spaces and hyphens. */
const POSTCODE = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9 -]*$/;
/**
 * Words that make a part a street rather than a town — and only the ones that
 * are almost never a whole town's name. The first list was much longer and
 * refused St Albans, Burgess Hill, Park City and Road Town, which is no use to
 * anybody (Codex, 13 Sep 2026): "hill", "park", "grove", "st", "place",
 * "square", "way", "court" and "row" are all ordinary in real place names.
 */
const STREETY = /\b(street|road|lane|avenue|drive|crescent|terrace|mews|cul-de-sac|flat|apartment|apt|suite|po box)\b/i;
/** What a town may be made of: letters, spaces, hyphens, apostrophes, full stops. No digits. */
const PLACEY = /^[\p{L}][\p{L} .'’-]*$/u;

/**
 * `trusted` is a locality the map gave us — a structured city/town/village
 * field, not something anybody typed — so it needs the postcode and digit
 * guard but not the street test. Running the street test over it was how the
 * geocoder, the good source, lost St Albans (Codex, 13 Sep 2026).
 */
export function townOf(label, { trusted = false } = {}) {
  const parts = String(label ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !POSTCODE.test(p));
  const candidate = kept.length ? kept[kept.length - 1] : null;
  if (!candidate) return null;
  // It has to read as a place on its own. An address with no commas arrives
  // here as one long part and fails, which is the point.
  if (!PLACEY.test(candidate)) return null;
  if (!trusted && STREETY.test(candidate)) return null;
  return candidate;
}

/** The language the two share, at the level each holds it, or null. */
export function sharedLanguage(a = [], b = []) {
  return sharedLanguages(a, b)[0] ?? null;
}

/**
 * The language an introduction is actually in: the one `fits()` accepted, so a
 * screen never names a language the match was not made on.
 */
export function languageFor(host, guest) {
  const shared = sharedLanguages(host?.languages, guest?.languages);
  return shared.find((l) => fluencyOk(host?.pref_fluency, l.theirs) && fluencyOk(guest?.pref_fluency, l.mine)) ?? shared[0] ?? null;
}

/** Somebody asking for fluent gets fluent; somebody happy with some gets either. */
const fluencyOk = (asked, held) => (norm(asked) === 'fluent' ? norm(held) === 'fluent' : true);

/** Two ages are similar when they are within a dozen years. Unknown is not similar. */
export function similarAge(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= SIMILAR_YEARS;
}

const R = 3958.8;
const rad = (d) => (d * Math.PI) / 180;
export function milesBetween(a, b) {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The things both said, in the words the person who is local used. */
export function sharedInterests(a = [], b = []) {
  const theirs = new Set(list(b).map(norm));
  return list(a).filter((i) => theirs.has(norm(i)));
}

/**
 * Whether these two should be introduced, and why — or the first reason they
 * should not, so the back office can say what the pool is doing.
 *
 * `host` is the local, standing entry; `guest` is the visitor's, trip-bound.
 * Each carries `{ entry, party, age, near: { lat, lng } }`.
 */
export function fits(host, guest) {
  const h = host?.entry, g = guest?.entry;
  const no = (reason) => ({ ok: false, reason, interests: [] });
  if (!h || !g) return no('nothing to match');
  if (h.household_id === g.household_id) return no('the same household');
  if (h.state !== 'active' || g.state !== 'active') return no('not live');
  if (h.scope !== 'standing' || g.scope !== 'trip') return no('a local and a visitor, not two of either');
  // Family to family only — an adult entry never meets a family one.
  if (h.kind !== g.kind) return no('family meets family only');

  const interests = sharedInterests(h.interests, g.interests);
  if (!interests.length) return no('nothing in common');

  // Any language that satisfies both sides will do: being refused because of
  // the order of an array is not a rule anybody agreed to (Codex, 13 Sep 2026).
  const shared = sharedLanguages(h.languages, g.languages);
  if (!shared.length) return no('no shared language');
  const lang = shared.find((l) => fluencyOk(h.pref_fluency, l.theirs) && fluencyOk(g.pref_fluency, l.mine));
  if (!lang) return no('neither language is spoken well enough for what was asked');

  // Age, both ways, and only when it can be established.
  if (h.pref_age === 'similar' && !similarAge(host.age, guest.age)) return no('not a similar age, or an age we do not know');
  if (g.pref_age === 'similar' && !similarAge(host.age, guest.age)) return no('not a similar age, or an age we do not know');

  // Company, both ways.
  if (!companyFits(h.pref_company, guest.party)) return no('the host asked for different company');
  if (!companyFits(g.pref_company, host.party)) return no('the guest asked for different company');

  // Near enough to actually meet.
  const miles = milesBetween(host.near, guest.near);
  const reach = Number(h.where_miles) || NEAR_MILES;
  if (miles != null && miles > reach) return no('too far apart');

  return { ok: true, reason: null, interests, language: lang };
}

/**
 * What one side may be told about a verdict.
 *
 * Nothing, until both have answered — neither of us answers knowing we have
 * already been accepted. And a no is silent: the other side is never told they
 * were turned down, so a refusal reads as "it lapsed", never as "they said no".
 */
export function verdictFor(match, side) {
  const mine = side === 'host' ? match.host_video_yes : match.guest_video_yes;
  const theirs = side === 'host' ? match.guest_video_yes : match.host_video_yes;
  if (mine == null || theirs == null) return { mine: mine ?? null, theirs: null, settled: false };
  // Both are in. Only a pair of yeses is ever reported as an outcome.
  return { mine, theirs: mine === true && theirs === true ? true : null, settled: true, introduced: mine === true && theirs === true };
}

/** Whose video this side may watch: your own always, theirs only once yours exists. */
export function videoVisible(match, side) {
  const mine = side === 'host' ? match.host_video_id : match.guest_video_id;
  const theirs = side === 'host' ? match.guest_video_id : match.host_video_id;
  return { mine: mine ?? null, theirs: mine && theirs ? theirs : null, waiting: Boolean(mine && !theirs) };
}

/**
 * The next stage after an answer. Each step can end silently: a no at any
 * point ends the match without telling the other side anything.
 */
export function nextStage(match, { hostVerdict, guestVerdict, hostVideo, guestVideo, hostVideoYes, guestVideoYes, hostVerified, guestVerified } = {}) {
  const m = { ...match };
  if (hostVerdict) m.host_verdict = hostVerdict;
  if (guestVerdict) m.guest_verdict = guestVerdict;
  if (hostVideo) m.host_video_id = hostVideo;
  if (guestVideo) m.guest_video_id = guestVideo;
  if (hostVideoYes != null) m.host_video_yes = hostVideoYes;
  if (guestVideoYes != null) m.guest_video_yes = guestVideoYes;
  if (hostVerified) m.host_verified_at = hostVerified;
  if (guestVerified) m.guest_verified_at = guestVerified;

  if (m.host_verdict === 'no' || m.guest_verdict === 'no') return 'ended';
  if (m.host_video_yes === false || m.guest_video_yes === false) return 'ended';
  if (m.host_verdict !== 'yes') return 'host_asked';
  if (m.guest_verdict !== 'yes') return 'guest_asked';
  // The videos are deleted the moment they have done their job, so their ids
  // are gone by the time the ID checks clear. Once both answers are in, the
  // swap is behind us and the absence of a video is the point, not a step
  // still to do.
  const swapDone = m.host_video_yes != null && m.guest_video_yes != null;
  if (!swapDone || (!m.videos_deleted_at && (!m.host_video_id || !m.guest_video_id))) return 'videos';
  if (m.host_video_yes !== true || m.guest_video_yes !== true) return 'ended';
  if (!m.host_verified_at || !m.guest_verified_at) return m.stage === 'verified' || m.stage === 'chat' ? m.stage : 'both_yes';
  return 'chat';
}

/** Whether this match is waiting on this side to do something. */
export function waitingOn(match) {
  switch (match.stage) {
    case 'host_asked': return 'host';
    case 'guest_asked': return 'guest';
    case 'videos': return !match.host_video_id ? 'host' : !match.guest_video_id ? 'guest' : match.host_video_yes == null ? 'host' : match.guest_video_yes == null ? 'guest' : null;
    case 'both_yes': return !match.host_verified_at ? 'host' : !match.guest_verified_at ? 'guest' : null;
    default: return null;
  }
}

/** One nudge, halfway; then it lapses and neither hears any more about it. */
export function nudgeDue(match, now = new Date()) {
  if (!['host_asked', 'guest_asked', 'videos'].includes(match.stage)) return false;
  if (match.nudged_at) return false;
  const lapses = new Date(match.lapses_at).getTime();
  const made = new Date(match.created_at).getTime();
  return now.getTime() >= made + (lapses - made) / 2;
}

export function hasLapsed(match, now = new Date()) {
  return ['host_asked', 'guest_asked', 'videos'].includes(match.stage) && now.getTime() >= new Date(match.lapses_at).getTime();
}

/** When a standing entry is asked again, and when a trip one clears. */
export function livesUntil({ scope, tripEnd }, now = new Date()) {
  if (scope === 'trip') return { reviewDueAt: null, expiresAt: tripEnd ? new Date(`${String(tripEnd).slice(0, 10)}T23:59:59Z`) : null };
  const review = new Date(now);
  review.setMonth(review.getMonth() + REVIEW_MONTHS);
  return { reviewDueAt: review, expiresAt: null };
}

/**
 * What the guest is told, and no more: no surname, no photograph, no contact.
 * A first name, a town, the shared things, and how well they speak the shared
 * language — which is the one thing that decides whether a walk works.
 */
export function introductionOf({ match, host, hostName, language }) {
  const first = String(hostName ?? '').trim().split(/\s+/)[0] || 'Somebody';
  // A town, never an address: whatever the household typed as home, this is
  // the most anybody on the other side is ever told.
  const town = townOf(host?.where_label);
  return {
    name: first,
    town,
    interests: match.interests ?? [],
    where: match.host_where ?? null,
    note: match.host_note ?? null,
    language: language ? { name: language.name, level: language.mine } : null,
  };
}

/** The schema the listener fills in from what somebody said (sources/openai.js `extract`). */
export const HEARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['interests', 'level', 'when', 'languages'],
  properties: {
    interests: { type: 'array', items: { type: 'string' }, description: 'The things they would do with other people, each two or three words: "Chess club", "Beach walks".' },
    level: { type: 'array', items: { type: 'string' }, description: 'How it goes, if they said: "Relaxed", "Not teaching", "Happy on my own too". Empty if they did not say.' },
    when: { type: 'array', items: { type: 'string' }, description: 'Roughly when, if they said: "Weekends", "Evenings". Empty if they did not say.' },
    languages: { type: 'array', items: { type: 'string' }, description: 'Any language they mentioned speaking. Empty if they did not mention one.' },
  },
};

export const HEARD_SYSTEM = [
  'You are reading what somebody said they are up for doing with other people.',
  'Answer with the things themselves, in their own words, two or three words each, sentence case.',
  'Never invent a date, a price, a place, a venue or a number of people — they were not asked for any of those.',
  'Never record anything about a person: no age, no sex, no nationality, no religion, no children.',
].join(' ');
