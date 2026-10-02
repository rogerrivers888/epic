/**
 * Four ways to host (Epic hosting v7, signed off 2 Oct 2026). Pure rules, no IO.
 *
 * "Supporting docs/Host/Host v3": RULINGS.md overrides the README wherever the
 * two differ, and the prototype's `SEQ` is the step order. Three choices are
 * made independently and never derived from one another — the lane (how often
 * it runs), who can come (private or public, asked last) and the money (free,
 * same each, depends on numbers; Weekly has its own price step).
 *
 * Every charge, threshold, refund window and notice period here is a config
 * placeholder (`hostingConfig`), never a literal in a rule: the owner sets them
 * and the defaults are the RULINGS' own placeholders.
 */

export const LANES = ['oneoff', 'weekly', 'course', 'onrequest'];
/** The old three shapes, kept in step for the readers that only know them. */
export const SHAPE_OF = { oneoff: 'oneoff', weekly: 'series', course: 'series', onrequest: 'anytime' };

/**
 * The step order, per lane — the prototype's `SEQ`, verbatim. The progress
 * counter is always derived from this list and never written down anywhere
 * else. Course is nine steps, as signed off.
 */
export const SEQ = {
  oneoff: ['what', 'when', 'order', 'cohosts', 'where', 'rsvp', 'price', 'who'],
  weekly: ['what', 'weekly', 'where', 'wprice', 'who'],
  course: ['what', 'run', 'outcome', 'sessions', 'cohosts', 'where', 'staydrop', 'price', 'who'],
  onrequest: ['what', 'why', 'avail', 'where', 'price', 'who'],
};
export const isStep = (lane, step) => Boolean(SEQ[lane]?.includes(step));

/** What Say it prompts for, lane by lane (the prototype's `prompts`). */
export const PROMPTS = {
  oneoff: ['What it is and who it’s for', 'When it starts and ends', 'Where it is', 'What happens on the day', 'Who you’re inviting'],
  weekly: ['What it is', 'Which day and time', 'Where it is', 'Who it’s for and how many', 'What it costs'],
  course: ['What it is and who it’s for', 'How many weeks, and when', 'What they’ll be able to do', 'Where it is', 'How many places, and the price'],
  onrequest: ['What you’ll do with people', 'Why you', 'When you’re free', 'Where it happens', 'How long, and the price'],
};

export const VENUE_KINDS = ['out_about', 'your_place', 'their_place', 'online'];
export const PRICE_MODES = ['free', 'same_each', 'by_numbers'];
export const REFUND_POLICIES = ['flexible', 'moderate', 'strict'];
export const DIET_TICKS = ['vegetarian', 'vegan', 'gluten_free', 'nut_allergy', 'dairy_free', 'halal'];
export const KID_NEEDS = ['high_chair', 'cot', 'quiet_room'];

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

/**
 * The placeholders. RULINGS: "£10 and 3% are config placeholders"; the public
 * share's thresholds "live in config"; refund terms are "placeholder terms, in
 * config"; notice and bookings a week are editable with defaults.
 *
 * `EPIC_HOSTING_CONFIG` (JSON) overrides any of them, key by key, so a change
 * of price is a setting and not a deploy of new rules.
 */
export const DEFAULT_CONFIG = Object.freeze({
  currency: 'GBP',
  privateEventPence: 1000,                 // "This event £10"
  proMonthlyPence: 1299,                   // Epic's Pro subscription, £12.99 a month
  privateCollectPct: 3,                    // paid through Epic: 3% of what is collected, card fees included
  // Public, paid: Epic's share is earned by rating, not by how many events.
  publicShare: [
    { pct: 20 },
    { pct: 15, ratedEvents: 5, avgAtLeast: 4.5 },
    { pct: 10, ratedEvents: 10, avgAtLeast: 4.8 },
  ],
  refunds: {
    flexible: { fullHoursBefore: 24 },
    moderate: { fullHoursBefore: 120 },
    strict: { partHoursBefore: 168, partPct: 50 },
  },
  decidesDaysBefore: 7,                     // default decides-by: a week before the first session
  weeklyDecidesHoursBefore: 24,             // each weekly session decides a day before
  onRequest: { noticeHours: 48, perWeek: 3, respondHours: 24, lengths: [60, 90, 120, 180] },
  reviewHours: 48,
  hostMinAge: 18,
  adultAge: 18,
  oneoffMaxDays: 4,
  courseSessions: { min: 2, max: 20 },
  weeklyHorizonWeeks: 12,                   // weekly sessions laid out ahead
  videoSeconds: { min: 30, max: 60, hello: 10 },
  epicVideoPhotos: { min: 3, max: 6 },
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const merge = (base, over) => {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
};

/** The config in force: the defaults, with `EPIC_HOSTING_CONFIG` laid over them. A malformed override is ignored, never half-applied. */
export function hostingConfig(env = process.env) {
  const raw = env?.EPIC_HOSTING_CONFIG;
  if (!raw) return DEFAULT_CONFIG;
  try { return merge(DEFAULT_CONFIG, JSON.parse(raw)); } catch { return DEFAULT_CONFIG; }
}

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

export const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const at = (iso) => new Date(`${ymd(iso)}T12:00:00Z`);
export const plusDays = (iso, n) => { const d = at(iso); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
export const dow = (iso) => at(iso).getUTCDay();   // 0 Sunday … 6 Saturday
const hm = (t) => (t ? String(t).slice(0, 5) : null);
const minutesOf = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const timeOf = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const addMinutes = (t, n) => { const m = minutesOf(t); return m == null || n == null ? null : timeOf(m + n); };
/** The day a session ends on when it runs past midnight, else null (Codex, 2 Oct 2026). */
const endsOnFor = (day, t, n) => { const m = minutesOf(t); if (m == null || !n) return null; const over = Math.floor((m + Number(n)) / 1440); return over > 0 ? plusDays(day, over) : null; };

/**
 * A date and a wall-clock time where the host is (UK by default) as an instant.
 * 19:00 on a summer evening in London is 18:00 UTC; appending Z would be an hour out.
 */
export function localInstant(day, time = '00:00', tz = 'Europe/London') {
  const [y, m, d] = ymd(day).split('-').map(Number);
  const [hh, mm] = String(time ?? '00:00').slice(0, 5).split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(guess - (shown - guess));
}

/** Bank holidays as a set of 'YYYY-MM-DD', with their names. */
export const holidaySet = (list) => new Map((list ?? []).map((h) => [ymd(h.date), h.title ?? 'Bank holiday']));

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

/**
 * Course: `sessions` dates, one a week on the first session's weekday,
 * skipping bank holidays (when excluded) and the host's own dates. An excluded
 * date pushes the run back a week, so the number of sessions is what was
 * promised. Returns the dates and what was skipped, with why.
 */
export function courseRun(offer, holidays = new Map(), cfg = DEFAULT_CONFIG) {
  const first = ymd(offer.first_date ?? offer.firstDate);
  const n = Math.min(cfg.courseSessions.max, Math.max(cfg.courseSessions.min, Number(offer.sessions) || 0));
  if (!first || !n) return { dates: [], skipped: [] };
  const own = new Set((offer.skipped_dates ?? offer.skippedDates ?? []).map(ymd));
  const bank = (offer.exclude_bank_holidays ?? offer.excludeBankHolidays) !== false;
  const dates = []; const skipped = [];
  let d = first; let guard = 0;
  while (dates.length < n && guard++ < 120) {
    if (bank && holidays.has(d)) skipped.push({ date: d, why: 'bank', name: holidays.get(d) });
    else if (own.has(d)) skipped.push({ date: d, why: 'host' });
    else dates.push(d);
    d = plusDays(d, 7);
  }
  return { dates, skipped };
}

/**
 * Weekly: every chosen weekday from the start, for the horizon ahead, skipping
 * bank holidays (when excluded) and the host's own dates. Ongoing — the guest
 * booking brief extends the run as it rolls.
 */
export function weeklyRun(offer, holidays = new Map(), { weeks = DEFAULT_CONFIG.weeklyHorizonWeeks, from = null } = {}) {
  // Ongoing: the window rolls — it starts at the first session, or at \`from\` (today) once
  // that has passed, so a class never runs out of dates (Codex, 2 Oct 2026).
  const first = ymd(offer.first_date ?? offer.firstDate);
  const start = first && from && ymd(from) > first ? ymd(from) : first;
  const days = new Set((offer.weekdays ?? []).map(Number));
  if (!start || !days.size) return { dates: [], skipped: [] };
  const own = new Set((offer.skipped_dates ?? offer.skippedDates ?? []).map(ymd));
  const bank = (offer.exclude_bank_holidays ?? offer.excludeBankHolidays) !== false;
  const dates = []; const skipped = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const d = plusDays(start, i);
    if (!days.has(dow(d))) continue;
    if (bank && holidays.has(d)) skipped.push({ date: d, why: 'bank', name: holidays.get(d) });
    else if (own.has(d)) skipped.push({ date: d, why: 'host' });
    else dates.push(d);
  }
  return { dates, skipped };
}

/** One-off: one row a day — a single date, or day 1 … day N over several. */
export function oneoffDays(offer, cfg = DEFAULT_CONFIG) {
  const start = ymd(offer.starts_on ?? offer.startsOn);
  if (!start) return [];
  if (!(offer.multi_day ?? offer.multiDay)) return [start];
  const end = ymd(offer.ends_on ?? offer.endsOn) ?? start;
  const out = [];
  for (let d = start; d <= end && out.length < cfg.oneoffMaxDays; d = plusDays(d, 1)) out.push(d);
  return out;
}

/**
 * The sessions an offer lays down when it is published: what `offer_sessions`
 * holds. On request lays down none — a row is made when a booking is accepted.
 */
export function sessionsFor(offer, holidays = new Map(), cfg = DEFAULT_CONFIG) {
  const lane = offer.lane;
  const len = Number(offer.duration_min ?? offer.durationMin) || null;
  const start = hm(offer.starts_at ?? offer.startsAt);
  if (lane === 'oneoff') {
    const days = oneoffDays(offer, cfg);
    const multi = days.length > 1;
    const endsAt = hm(offer.ends_at ?? offer.endsAt);
    return days.map((d, i) => ({ n: i + 1, onDate: d, startsAt: i === 0 ? start : null, endsAt: i === days.length - 1 ? endsAt : null, endsOn: null, topic: null, multi }));
  }
  if (lane === 'course') {
    // By session number: a plan with session 2 left blank keeps session 3's topic on session 3 (Codex, 2 Oct 2026).
    const topics = new Map((offer.weeks ?? []).filter((w) => w?.title).map((w, i) => [Number(w.n) || i + 1, w.title]));
    return courseRun(offer, holidays, cfg).dates.map((d, i) => ({ n: i + 1, onDate: d, startsAt: start, endsAt: addMinutes(start, len), endsOn: endsOnFor(d, start, len), topic: topics.get(i + 1) ?? null }));
  }
  if (lane === 'weekly') {
    // The rows laid down start from today once the first date has passed (Codex, 2 Oct 2026).
    return weeklyRun(offer, holidays, { weeks: cfg.weeklyHorizonWeeks, from: new Date() }).dates.map((d) => ({ n: null, onDate: d, startsAt: start, endsAt: addMinutes(start, len), endsOn: endsOnFor(d, start, len), topic: null }));
  }
  return [];
}

/** The first session's date, whatever the lane; null when there is none yet. */
export function firstSessionDate(offer, holidays = new Map(), cfg = DEFAULT_CONFIG) {
  if (offer.lane === 'onrequest') return null;
  return sessionsFor(offer, holidays, cfg)[0]?.onDate ?? null;
}

// ---------------------------------------------------------------------------
// who can come: ages and the children's path
// ---------------------------------------------------------------------------

/** "Anyone" is no range at all. */
export const isAnyone = (offer) => (offer.age_min ?? offer.ageMin) == null && (offer.age_max ?? offer.ageMax) == null;

/**
 * The children's path is set by the upper age only — no category rule, no
 * separate tick. One-off, Weekly and On request ask "Parents stay or drop off"
 * on Who can come when the upper age is under 18. Course keeps its own step 7
 * and never repeats the question on Who can come. Anyone is no children's
 * path: parents are assumed present.
 */
export function asksParentsOnWho(offer, cfg = DEFAULT_CONFIG) {
  if (offer.lane === 'course') return false;
  const max = offer.age_max ?? offer.ageMax;
  return max != null && Number(max) < cfg.adultAge;
}

/** Children are dropped off: the Course's step 7, or the sub-question on Who can come. */
export function dropsOff(offer, cfg = DEFAULT_CONFIG) {
  if ((offer.parents ?? null) !== 'drop_off') return false;
  // An adults' event has no children to drop off, whatever an old answer says (owner, 2 Oct 2026:
  // "the default should be adults, so the checks don't kick in unless they select Anyone").
  if (adultOnly(offer, cfg)) return false;
  return offer.lane === 'course' || asksParentsOnWho(offer, cfg);
}

/** Checked (DBS, insurance, two references) is needed when children are dropped off at a public event. A private event never needs it. */
export const needsChecked = (offer, cfg = DEFAULT_CONFIG) => offer.visibility === 'public' && dropsOff(offer, cfg);

/** Adult-only events: the guest ticks that they are 18 or over (the guest brief). */
export const adultOnly = (offer, cfg = DEFAULT_CONFIG) => Number(offer.age_min ?? offer.ageMin ?? 0) >= cfg.adultAge;

// ---------------------------------------------------------------------------
// money
// ---------------------------------------------------------------------------

/** Whether guests pay at all. Weekly has its own step: paid when either price is set. */
export function isPaid(offer) {
  if (offer.lane === 'weekly') return Boolean((offer.drop_in_pence ?? offer.dropInPence) || (offer.book_ahead_pence ?? offer.bookAheadPence));
  return (offer.price_mode ?? offer.priceMode ?? 'free') !== 'free';
}

/**
 * Whether the money goes through Epic. Public and paid is Epic-collects only;
 * a private host may be paid directly (cash or transfer), in which case Epic
 * takes nothing from it and needs neither payouts nor tax details.
 */
export function paidThroughEpic(offer) {
  if (!isPaid(offer)) return false;
  if (offer.visibility === 'public') return true;
  return (offer.money ?? 'epic') !== 'direct';
}

/** Has a minimum, and so decides by a date. */
export const hasMinimum = (offer) => Number(offer.min_count ?? offer.minCount ?? 0) > 0;

/**
 * Decides by: when there is a minimum. Default is `decidesDaysBefore` days
 * before the first session; the host can set their own. Weekly decides each
 * session on its own (`weeklyDecidesHoursBefore`) and On request has none.
 */
export function decidesOn(offer, holidays = new Map(), cfg = DEFAULT_CONFIG) {
  if (!hasMinimum(offer) || offer.lane === 'weekly' || offer.lane === 'onrequest') return null;
  const own = ymd(offer.decides_on ?? offer.decidesOn);
  if (own) return own;
  const first = firstSessionDate(offer, holidays, cfg);
  return first ? plusDays(first, -cfg.decidesDaysBefore) : null;
}

/**
 * Epic's share of a public, paid event, from the host's rating — never from
 * how many events. Walks the ladder and keeps the lowest rung the host's rated
 * events and average both clear.
 */
export function publicSharePct(rating = { ratedEvents: 0, avg: null }, cfg = DEFAULT_CONFIG) {
  let pct = cfg.publicShare[0].pct;
  for (const rung of cfg.publicShare.slice(1)) {
    if ((rating.ratedEvents ?? 0) >= rung.ratedEvents && (rating.avg ?? 0) >= rung.avgAtLeast) pct = rung.pct;
  }
  return pct;
}

/**
 * What Epic takes, in words and numbers, for the publish checklist.
 * Private: the £10 or Pro, plus 3% of what is collected through Epic.
 * Public and paid: the rated share. Free public: nothing.
 */
export function chargesFor(offer, { rating, isPro = false } = {}, cfg = DEFAULT_CONFIG) {
  const paid = isPaid(offer);
  if (offer.visibility === 'public') {
    if (!paid) return { kind: 'public_free', sharePct: 0, words: 'Free to list' };
    const pct = publicSharePct(rating, cfg);
    return { kind: 'public_paid', sharePct: pct, words: `Epic’s share · ${pct}%` };
  }
  const collectPct = paidThroughEpic(offer) ? cfg.privateCollectPct : 0;
  return {
    kind: 'private', sharePct: collectPct, eventPence: cfg.privateEventPence, proMonthlyPence: cfg.proMonthlyPence, isPro,
    words: isPro ? 'Included in Pro' : `£${(cfg.privateEventPence / 100).toFixed(cfg.privateEventPence % 100 ? 2 : 0)} for this event`,
  };
}

/**
 * The refund a guest gets when they cancel `hoursBefore` the window's start.
 * Windows count from the first session (Course, One-off) or from each booked
 * session (Weekly book ahead, On request) — the caller says which. If the host
 * cancels, or the event is called off, it is always a full refund.
 */
export function refundPct(policy, hoursBefore, { hostCancelled = false, calledOff = false } = {}, cfg = DEFAULT_CONFIG) {
  if (hostCancelled || calledOff) return 100;
  const t = cfg.refunds[policy];
  if (!t) return 100;
  if (t.fullHoursBefore != null) return hoursBefore >= t.fullHoursBefore ? 100 : 0;
  if (t.partHoursBefore != null) return hoursBefore >= t.partHoursBefore ? t.partPct : 0;
  return 0;
}

/** The terms in words, as the guest page and the Price step show them. */
export function refundWords(policy, cfg = DEFAULT_CONFIG) {
  const t = cfg.refunds[policy];
  if (!t) return null;
  const span = (h) => (h % 24 === 0 && h >= 48 ? `${h / 24} days` : `${h}h`);
  if (t.fullHoursBefore != null) return `Full refund up to ${span(t.fullHoursBefore)} before`;
  return `${t.partPct}% up to ${span(t.partHoursBefore)} before, none after`;
}

/** Depends on numbers: what each person pays at a given number of people. Rounded up to the penny so the total is always covered. */
export const perPersonAt = (totalPence, people) => (totalPence > 0 && people > 0 ? Math.ceil(totalPence / people) : null);

// ---------------------------------------------------------------------------
// on request
// ---------------------------------------------------------------------------

/**
 * The start times a guest can pick on a day: hourly starts inside that day's
 * ranges, each leaving room for the session length before the range ends.
 * Slots come from the session length plus the hour ranges (RULINGS).
 */
export function slotsFor(freeHours, weekday, lengthMin) {
  const ranges = freeHours?.[String(weekday)] ?? freeHours?.[weekday] ?? [];
  const len = Number(lengthMin) || 60;
  const out = [];
  for (const [from, to] of ranges) {
    const a = minutesOf(from); const b = minutesOf(to);
    if (a == null || b == null || b <= a) continue;
    for (let s = a; s + len <= b; s += 60) out.push(timeOf(s));
  }
  return [...new Set(out)].sort();
}

/** Whether a day is bookable: a free weekday, outside the notice period. */
export function bookableDay(iso, freeHours, { now = new Date(), noticeHours = DEFAULT_CONFIG.onRequest.noticeHours } = {}) {
  const ranges = freeHours?.[String(dow(iso))] ?? [];
  if (!ranges.length) return false;
  const endOfDay = new Date(`${ymd(iso)}T23:59:59Z`).getTime();
  return endOfDay - now.getTime() >= noticeHours * 3600_000;
}

// ---------------------------------------------------------------------------
// what is still to fill in
// ---------------------------------------------------------------------------

const has = (v) => v != null && String(v).trim() !== '';

/**
 * Whether a step has what it needs, for the draft rows and the publish check.
 * `true` filled · `false` still to do · `null` optional (nothing to fill).
 */
export function stepFilled(offer, step, cfg = DEFAULT_CONFIG) {
  switch (step) {
    case 'what': return has(offer.what_label ?? offer.whatLabel) && has(offer.title);
    case 'when': {
      // A date, a start and an end ("Until"); on one day the end comes after the start.
      const multi = offer.multi_day ?? offer.multiDay;
      const from = hm(offer.starts_at ?? offer.startsAt); const to = hm(offer.ends_at ?? offer.endsAt);
      if (!has(offer.starts_on ?? offer.startsOn) || !from || !to) return false;
      return multi ? has(offer.ends_on ?? offer.endsOn) : to > from;
    }
    case 'order': return null;
    case 'cohosts': return null;
    case 'rsvp': return null;
    case 'weekly': return (offer.weekdays ?? []).length > 0 && has(offer.first_date ?? offer.firstDate) && has(offer.starts_at ?? offer.startsAt) && Number(offer.duration_min ?? offer.durationMin) > 0;
    case 'run': return has(offer.first_date ?? offer.firstDate) && has(offer.starts_at ?? offer.startsAt) && Number(offer.sessions) > 0 && Number(offer.duration_min ?? offer.durationMin) > 0;
    case 'outcome': return has(offer.outcome);
    case 'sessions': return null;
    case 'staydrop': return has(offer.parents);
    case 'why': return has(offer.why_you ?? offer.whyYou);
    case 'avail': {
      // At least one session that fits inside the hours given — never a live offer nobody can book (Codex, 2 Oct 2026).
      const hours = offer.free_hours ?? offer.freeHours ?? {}; const lengths = (offer.session_lengths ?? offer.sessionLengths ?? []).map(Number).filter((n) => n > 0);
      if (!lengths.length) return false;
      const shortest = Math.min(...lengths);
      return [0, 1, 2, 3, 4, 5, 6].some((d) => slotsFor(hours, d, shortest).length > 0);
    }
    case 'where': {
      const v = offer.venue;
      if (!v) return false;
      if (v === 'online') return (offer.online_mode ?? offer.onlineMode) === 'epic' || has(offer.online_link ?? offer.onlineLink);
      // Stored from the guest's side, as the rest of Epic reads it: `your_place` is at the guest's — the host travels.
      if (v === 'your_place') return has(offer.venue_area ?? offer.venueArea) && Number(offer.travel_radius_min ?? offer.travelRadiusMin) > 0;
      return has(offer.venue_label ?? offer.venueLabel) || has(offer.venue_area ?? offer.venueArea);
    }
    case 'price': {
      const mode = offer.price_mode ?? offer.priceMode;
      if (!PRICE_MODES.includes(mode)) return false;
      if (Number(offer.max_count ?? offer.maxCount ?? 0) <= 0 && offer.lane !== 'onrequest') return false;
      if (mode === 'same_each' && !(offer.price_pence ?? offer.pricePence)) return false;
      if (mode === 'by_numbers' && !((offer.total_pence ?? offer.totalPence) && hasMinimum(offer))) return false;
      if (mode !== 'free' && !REFUND_POLICIES.includes(offer.refund_policy ?? offer.refundPolicy)) return false;
      // A host's own decides-by must still come before the first session, even after the dates moved.
      const own = ymd(offer.decides_on ?? offer.decidesOn);
      const start = offer.lane === 'oneoff' ? ymd(offer.starts_on ?? offer.startsOn) : offer.lane === 'course' ? ymd(offer.first_date ?? offer.firstDate) : null;
      if (own && start && own >= start) return false;
      return true;
    }
    case 'wprice': {
      if (Number(offer.max_count ?? offer.maxCount ?? 0) <= 0) return false;
      if (isPaid(offer) && !REFUND_POLICIES.includes(offer.refund_policy ?? offer.refundPolicy)) return false;
      return true;
    }
    case 'who': {
      if (!(offer.who_chosen ?? offer.whoChosen) || !['invite', 'public'].includes(offer.visibility)) return false;
      if (asksParentsOnWho(offer, cfg) && !has(offer.parents)) return false;
      return true;
    }
    default: return null;
  }
}

/** The steps of this offer's lane that are still to do, in order. */
export function missingSteps(offer, cfg = DEFAULT_CONFIG) {
  return (SEQ[offer.lane] ?? []).filter((s) => stepFilled(offer, s, cfg) === false);
}

/** Field-level blockers in the host's words, for an offer with a lane (what the old `publishBlockers` answers for the old shapes). */
const STEP_WORDS = {
  what: 'Say what it is and give it a title.', when: 'Pick the date and the time.', weekly: 'Pick the day, the time, how long and when it starts.',
  run: 'Pick the first session, the time, how long and how many sessions.', outcome: 'Say what they’ll be able to do by the end.',
  staydrop: 'Say whether parents stay or drop off.', why: 'Say why you, for this one.', avail: 'Say when you’re free and how long a session is.',
  where: 'Say where it happens.', price: 'Finish the price: the numbers, and the refund policy if it’s paid.',
  wprice: 'Finish the price: the numbers each week, and the refund policy if it’s paid.', who: 'Say who can come.',
};
export const laneGaps = (offer, cfg = DEFAULT_CONFIG) => missingSteps(offer, cfg).map((s) => STEP_WORDS[s] ?? 'Finish the set-up.');

// ---------------------------------------------------------------------------
// the publish checklist
// ---------------------------------------------------------------------------

/**
 * The checklist, and what each item blocks (RULINGS › "what blocks what"):
 *
 *   Private — before the invites send: email, phone, host profile (with date
 *   of birth), payouts if paid through Epic. The video is optional. Tax
 *   details are needed before the first payout, not before sending.
 *
 *   Public — to send for review: email, phone, profile, Verified, the offer
 *   video, payouts if paid. Before it goes live: Checked (public with drop
 *   off only). Before the first payout: tax details.
 *
 * `blocks`: 'send' (the button) · 'live' (going live after review) · 'payout'
 * (the first payout) · null (optional, or information). `done` is a fact read
 * from the host, the account and the offer — never a tick the client sets.
 */
export function checklist(offer, { host, account } = {}, cfg = DEFAULT_CONFIG) {
  const pub = offer.visibility === 'public';
  const epic = paidThroughEpic(offer);
  const profileDone = Boolean(host?.name?.trim() && host?.photo_id && host?.date_of_birth && ageOn(host.date_of_birth) >= cfg.hostMinAge);
  const items = [];
  const push = (key, blocks, done, extra = {}) => items.push({ key, blocks, done: Boolean(done), ...extra });
  push('email', 'send', has(account?.email));
  push('phone', 'send', has(account?.mobile));
  push('profile', 'send', profileDone);
  if (pub) push('verified', 'send', host?.identity_state === 'verified');
  // The host makes their own video (owner, 2 Oct 2026: "They need to make their own video").
  push('video', pub ? 'send' : null, Boolean(offer.video_id), { optional: !pub });
  if (needsChecked(offer, cfg)) push('checked', 'live', host?.checked_state === 'passed', { submitted: host?.checked_state === 'submitted' });
  if (epic) push('payouts', 'send', host?.payouts_state === 'ready', { pending: host?.payouts_state === 'pending' });
  if (epic) push('tax', 'payout', has(host?.tax_reference));
  if (pub) push('review', null, false, { info: true });
  return items;
}

/** What stands between the host and the button: the unfinished items that block sending. */
export const sendBlockers = (items) => items.filter((i) => i.blocks === 'send' && !i.done).map((i) => i.key);

/** Whole years old on a day. */
export function ageOn(dob, on = new Date()) {
  if (!dob) return null;
  const b = at(dob); const n = on instanceof Date ? on : at(on);
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a -= 1;
  return a;
}

/**
 * The button on the checklist, and what pressing it does.
 * Private: "Pay £10 · send the invites", "Join Pro · send the invites", or
 * "Send the invites" for an existing Pro subscriber (or nothing to pay).
 * Public: "Carry on · Verified" until the identity check is done, then "Send for review".
 */
export function publishAction(offer, items, { isPro = false } = {}, cfg = DEFAULT_CONFIG) {
  if (offer.visibility === 'public') {
    const verified = items.find((i) => i.key === 'verified');
    if (verified && !verified.done) return { key: 'verify', label: 'Carry on · Verified' };
    return { key: 'review', label: 'Send for review' };
  }
  if (isPro || offer.private_fee_state === 'paid') return { key: 'send', label: 'Send the invites' };
  if ((offer.private_plan ?? 'event') === 'pro') return { key: 'pro', label: 'Join Pro · send the invites' };
  const pounds = cfg.privateEventPence / 100;
  return { key: 'pay', label: `Pay £${pounds % 1 ? pounds.toFixed(2) : pounds} · send the invites` };
}

/** The checklist items in the host's words, for a refusal. */
export const CHECK_WORDS = {
  email: 'Add your email.', phone: 'Add your mobile number.', profile: 'Finish your host profile — your name, a photo and your date of birth.',
  verified: 'Verify your identity.', video: 'Add the offer video.', checked: 'Get Checked — DBS, insurance and two references.',
  payouts: 'Set up payouts.', tax: 'Add your tax details.',
};

/**
 * Everything that stops a lane offer being public — what the old
 * `publishBlockers` answers for the old shapes. The steps still to do, then
 * the checklist items that block sending or going live. Email and phone are
 * the account's and are checked where the account is read (the publish call);
 * here they are taken as given, so an edit to a live offer is judged on what
 * the edit can change.
 */
export function laneBlockers(offer, host, cfg = DEFAULT_CONFIG, holidays = new Map()) {
  const items = checklist(offer, { host, account: { email: 'given', mobile: 'given' } }, cfg);
  // A one-off or a course whose first date has gone cannot go out — at sending, or at approval
  // after a review that ran past it (Codex, 2 Oct 2026). A weekly class rolls on.
  // A course's first *actual* session: a skipped first date pushes it on (Codex, 2 Oct 2026).
  const first = offer.lane === 'oneoff' ? ymd(offer.starts_on ?? offer.startsOn) : offer.lane === 'course' ? (courseRun(offer, holidays, cfg).dates[0] ?? ymd(offer.first_date ?? offer.firstDate)) : null;
  const past = first && first < ymd(new Date()) ? ['That date has gone. Pick a new one.'] : [];
  return [...past, ...laneGaps(offer, cfg), ...items.filter((i) => (i.blocks === 'send' || i.blocks === 'live') && !i.done).map((i) => CHECK_WORDS[i.key])];
}
