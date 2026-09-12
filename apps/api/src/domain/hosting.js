/**
 * Hosts and events: the arithmetic and the rules, with no database in them.
 *
 * Everything here is a pure function over an offer row so that the wizard's
 * panel ("Under 6 and it is called off… You see £108 at 6, £180 at 10"), the
 * guest page ("Needs 6 · 9 are in, 3 places left") and the host dashboard all
 * say the same numbers, and so the rules can be tested without a Postgres.
 *
 * The brief (Events & Hosts v4/v5, 12 Sep 2026) is the source for every
 * constant: three host types that are never ranked, three shapes that change
 * the questions, four venue formats, the trust ladder, the age rules, and the
 * regulated cities where guiding is a licensed profession.
 */

export const HOST_TYPES = ['practitioner', 'local', 'guide'];
export const LOCAL_KINDS = ['family', 'something_you_do', 'night_out', 'neighbourhood'];
export const TRUST_LEVELS = ['verified', 'checked', 'trusted'];
export const SHAPES = ['oneoff', 'series', 'anytime'];
export const OFFER_STATES = ['draft', 'in_review', 'live', 'paused', 'ended'];
export const VENUES = ['their_place', 'your_place', 'out_about', 'online'];
export const PRICE_MODES = ['free', 'same_each', 'by_numbers'];
export const REFUND_RULES = ['24h', '7d', 'none'];
export const AGE_LIMITS = [12, 16, 18];
export const JOIN_MODES = ['whole', 'drop_in', 'both'];
export const DAY_PARTS = ['morning', 'afternoon', 'evening'];
export const REVIEW_CHIPS = ['skill', 'company', 'value'];

/** Guests book alone at 18; hosts are 18. Under-18s only as named party members with an adult. */
export const ADULT_AGE = 18;
/** Both reviews go live together this many days after the experience. */
export const REVIEW_PUBLISH_AFTER_DAYS = 14;
/** How long a held booking waits before the minimum is decided: two days before it runs. */
export const DECIDE_DAYS_BEFORE = 2;
/** Epic's fee is shown before publishing. TBC in the design; held here so one number changes it. */
export const EPIC_FEE_PERCENT = Number(process.env.EPIC_HOST_FEE_PERCENT ?? 0);
/** Checked is required for a Practitioner above this price (brief §8). */
export const CHECKED_ABOVE_PENCE = 100_00;

/**
 * Where guiding is a licensed profession and the wizard shows its one extra
 * question (brief §12). Italy's Law 190/2023, Greece, Andalusia and the rest of
 * Spain's autonomous regimes, France for museums and monuments. The UK is
 * unregulated, which is why we start there.
 */
export const REGULATED_COUNTRIES = { IT: 'Italy', GR: 'Greece', ES: 'Spain', FR: 'France' };
export const isRegulated = (countryCode) => Boolean(countryCode && REGULATED_COUNTRIES[String(countryCode).toUpperCase()]);

/** Words in listing copy that read like heritage commentary, flagged in regulated cities. */
const COMMENTARY = /\b(tour of|guided tour|walking tour|the history of|monument|museum|duomo|colosseum|cathedral|basilica|acropolis|heritage site|archaeolog|forum|palazzo|uffizi|louvre|alhambra)\b/i;
export const readsLikeCommentary = (text) => COMMENTARY.test(String(text ?? ''));

const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const dateAt = (iso) => new Date(`${ymd(iso)}T12:00:00Z`);
const plusDays = (iso, n) => { const d = dateAt(iso); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

/**
 * A series' session dates: `sessions` of them, one a week from `first_date`,
 * skipping the dates the host tapped out (half term). Skipped dates are made
 * up at the end so the run is still the number of sessions promised.
 */
export function seriesDates(offer) {
  if (!offer.first_date || !offer.sessions) return [];
  const skipped = new Set((offer.skipped_dates ?? []).map(ymd));
  const out = [];
  let d = ymd(offer.first_date);
  let guard = 0;
  while (out.length < offer.sessions && guard++ < 200) {
    if (!skipped.has(d)) out.push(d);
    d = plusDays(d, 7);
  }
  return out;
}

/**
 * The next few slots an anytime offer can be booked into: the host's days and
 * parts of the day, laid over the coming fortnight. A simple pattern, not a
 * calendar build-out (brief §6).
 */
const PART_TIMES = { morning: ['09:00', '10:00', '11:00'], afternoon: ['13:00', '14:00', '15:00', '16:00'], evening: ['18:00', '19:00', '20:00'] };
export function anytimeSlots(offer, { from = new Date(), days = 14, taken = new Set() } = {}) {
  const a = offer.availability ?? {};
  const wanted = new Set((a.days ?? []).map(Number));
  const parts = (a.parts ?? []).filter((p) => PART_TIMES[p]);
  if (!wanted.size || !parts.length) return [];
  const out = [];
  const start = new Date(from);
  start.setUTCHours(12, 0, 0, 0);
  for (let i = 1; i <= days; i++) {
    const d = new Date(start); d.setUTCDate(d.getUTCDate() + i);
    if (!wanted.has(d.getUTCDay())) continue;
    const day = ymd(d);
    const times = parts.flatMap((p) => PART_TIMES[p]).filter((t) => !taken.has(`${day}T${t}`));
    if (times.length) out.push({ date: day, times });
  }
  return out;
}

/** The dates a one-off, a series or a slot happen on, so "past" and "next" mean one thing. */
export function occurrenceDate(offer, occurrence) {
  if (offer.shape === 'oneoff') return ymd(offer.starts_on);
  if (offer.shape === 'series') return occurrence && occurrence !== 'whole' ? ymd(occurrence) : ymd(offer.first_date);
  return occurrence ? ymd(occurrence.slice(0, 10)) : null;
}

/** When a series ends, for "Past" and for the review publish date of a whole-run booking. */
export function lastDate(offer, occurrence) {
  if (offer.shape === 'series' && (!occurrence || occurrence === 'whole')) {
    const dates = seriesDates(offer);
    return dates[dates.length - 1] ?? ymd(offer.first_date);
  }
  return occurrenceDate(offer, occurrence);
}

/**
 * What a booking costs, worked out here and never taken from the browser.
 *
 *   free         nothing
 *   same_each    price × heads (per person) or price (per household)
 *   by_numbers   the total ÷ the expected number until it is certain; the
 *                page shows the likely figure and the ceiling (÷ minimum)
 *
 * Drop-in on a series is its own price per session. All-in: Epic's fee is
 * inside the number shown, never bolted on at the end (brief §3.5).
 */
export function priceFor(offer, { heads = 1, occurrence = null, headsNow = 0 } = {}) {
  const shares = offer.per === 'household' ? 1 : Math.max(1, heads);
  if (offer.shape === 'series' && occurrence && occurrence !== 'whole' && offer.drop_in_pence != null) {
    return { pence: offer.drop_in_pence * shares, each: offer.drop_in_pence, ceilingPence: null, likelyPence: null, mode: 'drop_in' };
  }
  if (offer.price_mode === 'free' || (!offer.price_pence && !offer.total_pence)) return { pence: 0, each: 0, ceilingPence: null, likelyPence: null, mode: 'free' };
  if (offer.price_mode === 'same_each') return { pence: (offer.price_pence ?? 0) * shares, each: offer.price_pence ?? 0, ceilingPence: null, likelyPence: null, mode: 'same_each' };
  // Depends on numbers.
  const total = offer.total_pence ?? 0;
  const divisor = Math.max(1, headsNow || offer.expected_count || offer.min_count || 1);
  const likely = Math.ceil(total / Math.max(1, offer.expected_count || divisor));
  const ceiling = Math.ceil(total / Math.max(1, offer.min_count || 1));
  return { pence: likely * shares, each: likely, ceilingPence: ceiling * shares, likelyPence: likely * shares, mode: 'by_numbers' };
}

/** "You see £108 at 6, £180 at 10 — before Epic's fee." */
export function takingsAt(offer, n) {
  if (!n) return null;
  if (offer.price_mode === 'same_each' && offer.price_pence) return offer.price_pence * n;
  if (offer.price_mode === 'by_numbers' && offer.total_pence) return offer.total_pence;
  return 0;
}

/** The fee, and what the host would keep, for the publish step. */
export function payoutOf(pence) {
  const fee = Math.round((pence * EPIC_FEE_PERCENT) / 100);
  return { fee, net: pence - fee, percent: EPIC_FEE_PERCENT };
}

/**
 * Where an offer stands against its three numbers: how many are in, whether
 * the minimum is met, how many places are left, and whether it is full. Heads
 * are counted from bookings that are not cancelled; a waitlisted booking is
 * not in.
 */
export function standing(offer, bookings, occurrence = null) {
  const live = bookings.filter((b) => b.state !== 'cancelled');
  const onDate = (d) => live.filter((b) => b.occurrence === d || (offer.shape === 'series' && b.occurrence === 'whole'));
  /**
   * A whole-run booking sits in every session, so its room is the fullest
   * session's room: a series that allows drop-ins can have a Thursday that is
   * full while the run as a whole is not (Codex, 12 Sep 2026).
   */
  const relevant = offer.shape === 'series' && (occurrence == null || occurrence === 'whole')
    ? seriesDates(offer).map(onDate).sort((a, b) => heads(b) - heads(a))[0] ?? live.filter((b) => b.occurrence === 'whole')
    : live.filter((b) => occurrence == null || b.occurrence === occurrence || (offer.shape === 'series' && b.occurrence === 'whole'));
  const inNow = heads(relevant);
  const bookingsIn = relevant.filter((b) => b.state !== 'waitlisted').length;
  const min = offer.min_count ?? 0;
  const max = offer.max_count ?? null;
  return {
    heads: inNow,
    bookings: bookingsIn,
    minimum: min || null,
    expected: offer.expected_count ?? null,
    maximum: max,
    needs: min ? Math.max(0, min - inNow) : 0,
    minimumMet: !min || inNow >= min,
    placesLeft: max ? Math.max(0, max - inNow) : null,
    full: Boolean(max && inNow >= max),
  };
}

const heads = (rows) => rows.filter((b) => b.state !== 'waitlisted').reduce((n, b) => n + b.heads, 0);

/** The day a held booking is decided on: two days before it runs, never in the past. */
export function decideBy(offer, occurrence) {
  const on = occurrenceDate(offer, occurrence);
  if (!on) return null;
  const d = plusDays(on, -DECIDE_DAYS_BEFORE);
  const today = ymd(new Date());
  return d < today ? on : d;
}

/** Both reviews publish on the same day, a fortnight after the experience. */
export const reviewPublishOn = (offer, occurrence) => {
  const last = lastDate(offer, occurrence);
  return last ? plusDays(last, REVIEW_PUBLISH_AFTER_DAYS) : plusDays(ymd(new Date()), REVIEW_PUBLISH_AFTER_DAYS);
};

/**
 * The age gate, stated plainly. Given the offer's limit and a party, which of
 * them cannot come, and whether an attending adult is in the party.
 */
export function ageGate(offer, party) {
  const limit = offer.age_limit ?? null;
  const blocked = limit ? party.filter((p) => p.age != null && p.age < limit || (p.age == null && p.child)) : [];
  const adults = party.filter((p) => p.age == null ? !p.child : p.age >= ADULT_AGE);
  return {
    limit,
    blocked,
    hasAdult: adults.length > 0,
    // Anything with children present, or a Local · Family host, needs an adult in the party.
    needsAdult: party.some((p) => p.child || (p.age != null && p.age < ADULT_AGE)),
  };
}

/**
 * What stops an offer being published, in the host's words. Empty means it can
 * go. The rules come from the brief: a Practitioner above £100, anything at
 * their place and anything involving children need Checked; a night out is
 * 18+ with a minimum party; a regulated city needs its answer.
 */
export function publishBlockers(offer, host) {
  const out = [];
  if (!offer.title?.trim()) out.push('Give it a title.');
  if (!offer.description?.trim() && offer.shape !== 'anytime') out.push('Say what happens.');
  if (offer.shape === 'anytime' && !offer.why_you?.trim()) out.push('Say why you, for this one.');
  if (offer.shape === 'oneoff' && !offer.starts_on) out.push('Pick the date.');
  if (offer.shape === 'series' && (!offer.first_date || !offer.sessions)) out.push('Say when the series starts and how many sessions it runs.');
  if (offer.shape === 'anytime' && !(offer.availability?.days?.length && offer.availability?.parts?.length)) out.push('Say when you are free.');
  if (offer.price_mode === 'same_each' && !offer.price_pence) out.push('Say what it costs each, or make it free.');
  if (offer.price_mode === 'by_numbers' && !offer.total_pence) out.push('Say what the whole thing costs.');
  if (offer.price_mode !== 'free' && host.payout_status !== 'connected') out.push('Connect payouts before charging — you can publish a free one now.');
  if (offer.venue === 'their_place' && host.trust === 'verified') out.push('Hosting at your place needs the Checked level. Ask for it from your profile.');
  if (host.type === 'practitioner' && (offer.price_pence ?? 0) > CHECKED_ABOVE_PENCE && host.trust === 'verified') out.push('A Practitioner offer above £100 needs the Checked level.');
  if (host.type === 'local' && host.local_kind === 'family' && host.trust === 'verified') out.push('Family hosting needs the Checked level.');
  if (host.type === 'local' && host.local_kind === 'night_out') {
    if (offer.age_limit !== 18) out.push('A night out is over-18s only.');
    if (!offer.min_count || offer.min_count < 3) out.push('A night out needs a minimum party of three, so it is never one guest and one host.');
  }
  if (isRegulated(offer.venue_country) && !offer.regulated_answer) out.push(`Hosting in ${REGULATED_COUNTRIES[offer.venue_country.toUpperCase()]} asks one more question.`);
  if (offer.regulated_answer === 'licensed' && !offer.licence_number) out.push('Give the licence number.');
  if (isRegulated(offer.venue_country) && offer.regulated_answer === 'no_commentary' && readsLikeCommentary(`${offer.title} ${offer.description}`)) {
    out.push('Your listing reads like a guided tour of a monument or museum. "A morning cooking together" is fine; "A tour of the Duomo" is not.');
  }
  return out;
}

/**
 * The pitch checklist a reviewer reads (brief §8, H2): what you will actually
 * do, what they go home with, who it suits, who it does not, photo quality.
 * Derived from the words so the host sees the same list before they submit.
 */
export function pitchChecklist(offer) {
  const text = `${offer.description ?? ''} ${offer.why_you ?? ''} ${offer.includes ?? ''} ${offer.outcome ?? ''}`.toLowerCase();
  const has = (re) => re.test(text);
  return {
    what: (offer.description ?? offer.why_you ?? '').trim().length >= 40 ? 'clear' : 'missing',
    home: has(/\b(go home with|take home|take away|leave with|you will (know|be able|have)|by the end|walk away)\b/) || offer.outcome ? 'clear' : 'missing',
    suits: has(/\b(suits?|for anyone|for families|for people who|good with|beginners|whatever your level|all levels|kids|children)\b/) ? 'clear' : 'missing',
    notSuits: has(/\b(not for|isn'?t for|no good for|if you want .* this is not|skip this if|unless)\b/) ? 'clear' : 'missing',
    photos: (offer.photo_ids ?? []).length >= 1 ? 'clear' : 'missing',
  };
}

/** A 30–60 second clip is what the prompt script asks for. */
export const VIDEO_MIN_S = 10;
export const VIDEO_MAX_S = 90;
export const MEDIA_MAX_BYTES = 40 * 1024 * 1024;
export const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

/** The passions a guest can pick from (F2), and the words an offer's category may be. */
export const PASSIONS = [
  'painting', 'cooking', 'baking', 'with-kids', 'running', 'climbing', 'sea-swimming', 'foraging', 'records',
  'yoga', 'skateboarding', 'cycling', 'photography', 'wine', 'coffee', 'pottery', 'music', 'history', 'food', 'business', 'ai', 'night-out',
];
export const passionLabel = (key) => ({ 'with-kids': 'With kids', 'sea-swimming': 'Sea swimming', ai: 'AI', 'night-out': 'Night out' }[key]
  ?? key.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));

export { ymd, plusDays };
