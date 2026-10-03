/**
 * Four ways to host (hosting v7, signed off 2 Oct 2026) — what every v7 screen
 * shares: the lanes' words and colours, the step order and titles, the
 * categories behind "What is it?", and the date arithmetic the screens show
 * live (the server lays the sessions down with the same rules, in
 * apps/api/src/domain/lanes.js; the two are pinned by the same test cases).
 *
 * Source: "Supporting docs/Host/Host v3" — RULINGS.md over the README, and the
 * prototype's LANES, SEQ and SHORT for everything RULINGS does not change.
 */

import { CREAM, DEEP_GREEN, INACTIVE, INK, INK_HOVER, LANE_BAR_ON_DARK, LANE_BAR_ON_LIGHT, LANE_CHIP_ON_DARK, LANE_SUB_ON_GREEN, LANE_SUB_ON_INK, LIME_TINT } from '../../../theme';
import type { HostLane } from '../../../routes';

export type { HostLane };
export const LANE_ORDER: HostLane[] = ['oneoff', 'weekly', 'course', 'onrequest'];

export type StepKey =
  | 'what' | 'when' | 'order' | 'cohosts' | 'where' | 'rsvp' | 'price' | 'who'
  | 'weekly' | 'wprice' | 'run' | 'outcome' | 'sessions' | 'staydrop' | 'why' | 'avail';

/** The prototype's SEQ — the step order, and each step's title. */
export const SEQ: Record<HostLane, [StepKey, string][]> = {
  oneoff: [['what', 'What is it?'], ['when', 'When is it?'], ['order', 'What’s happening?'], ['cohosts', 'Any other hosts?'], ['where', 'Where is it?'], ['rsvp', 'What should guests tell you?'], ['price', 'Is it free?'], ['who', 'Who can come?']],
  weekly: [['what', 'What is it?'], ['weekly', 'When does it run?'], ['where', 'Where does it happen?'], ['wprice', 'What does it cost?'], ['who', 'Who can come?']],
  course: [['what', 'What is it?'], ['run', 'When does it run?'], ['outcome', 'What will they be able to do by the end?'], ['sessions', 'Session plan'], ['cohosts', 'Who runs it?'], ['where', 'Where does it happen?'], ['staydrop', 'Do parents stay?'], ['price', 'What does it cost?'], ['who', 'Who can come?']],
  onrequest: [['what', 'What will you do with people?'], ['why', 'Why you, for this one?'], ['avail', 'When are you free?'], ['where', 'Where does it happen?'], ['price', 'What does it cost?'], ['who', 'Who can come?']],
};
export const stepsOf = (lane: HostLane) => SEQ[lane].map(([k]) => k);
export const titleOf = (lane: HostLane, step: StepKey) => SEQ[lane].find(([k]) => k === step)?.[1] ?? '';

/** The prototype's SHORT: what the Next button names. */
export const SHORT: Record<StepKey, string> = {
  what: 'What is it', when: 'When', order: 'Running order', cohosts: 'Other hosts', where: 'Where', rsvp: 'Guest questions', price: 'Price', who: 'Who can come',
  weekly: 'Every week', wprice: 'Price', run: 'The run', outcome: 'By the end', sessions: 'Session plan', staydrop: 'Stay or drop off', why: 'Why you', avail: 'When you’re free',
};

export type LaneLook = {
  tag: string; bg: string; fg: string; sub: string; lo: string; chip: string;
  short: string; title: string; line: string; eg: string[]; rows: [string, string];
  placeholder: string; cats: Record<string, string[]>; prompts: string[];
};

/** Each lane: its block colour and what sits on it, and its words. */
export const LANES: Record<HostLane, LaneLook> = {
  oneoff: {
    tag: 'One-off', bg: INK, fg: CREAM, sub: LANE_SUB_ON_INK, lo: LANE_BAR_ON_DARK, chip: LANE_CHIP_ON_DARK,
    short: 'A private or\npublic event', title: 'A private or\npublic event.', line: 'A wedding for your guests, or a class open to all. Set the date; people RSVP or book.',
    eg: ['Birthday party', 'Wedding', 'Quiz night', 'Craft fair'], rows: ['Birthday party · Wedding', 'Quiz night · Craft fair'],
    placeholder: 'A birthday party, a quiz night…',
    cats: {
      Celebrations: ['Birthday party', 'Wedding', 'Anniversary', 'Engagement party', 'Baby shower', 'Christening', 'Leaving do', 'Reunion'],
      'Social nights': ['Quiz night', 'Dinner party', 'Games night', 'BBQ'],
      'Markets and fairs': ['Craft fair', 'Car boot', 'Bake sale', 'Open day'],
      'Talks and tasters': ['Taster class', 'Talk', 'Workshop', 'Screening'],
      Outdoors: ['Guided walk', 'Picnic', 'Treasure hunt'],
    },
    prompts: ['What it is and who it’s for', 'When it starts and ends', 'Where it is', 'What happens on the day', 'Who you’re inviting'],
  },
  weekly: {
    tag: 'Weekly', bg: DEEP_GREEN, fg: CREAM, sub: LANE_SUB_ON_GREEN, lo: LANE_BAR_ON_DARK, chip: LANE_CHIP_ON_DARK,
    short: 'Same time,\nevery week', title: 'Same time,\nevery week.', line: 'A club or class that keeps going. People come every week or drop in when they can.',
    eg: ['Book club', 'Five-a-side', 'Running club', 'Yoga class'], rows: ['Book club · Five-a-side', 'Running club · Yoga class'],
    placeholder: 'A book club, a yoga class…',
    cats: {
      Fitness: ['Yoga class', 'Pilates', 'Bootcamp', 'Running club', 'Spin'],
      Sport: ['Five-a-side', 'Netball', 'Tennis', 'Swimming'],
      Clubs: ['Book club', 'Chess club', 'Knitting circle', 'Choir'],
      'Kids and families': ['Toddler group', 'Scouts', 'Homework club'],
      'Arts and crafts': ['Pottery', 'Life drawing', 'Drama'],
    },
    prompts: ['What it is', 'Which day and time', 'Where it is', 'Who it’s for and how many', 'What it costs'],
  },
  course: {
    tag: 'Course', bg: LIME_TINT, fg: INK, sub: INK_HOVER, lo: LANE_BAR_ON_LIGHT, chip: CREAM,
    short: 'A set number\nof weeks', title: 'A set number\nof weeks.', line: 'Six weeks or a whole term. People sign up for the full run; you plan each session.',
    eg: ['Swimming lessons', 'Couch to 5K', 'Cooking classes', 'Homeschool'], rows: ['Swimming lessons · Couch to 5K', 'Cooking classes · Homeschool'],
    placeholder: 'Swimming lessons, a cooking course…',
    cats: {
      'Sport and fitness': ['Swimming lessons', 'Couch to 5K', 'Tennis', 'Martial arts', 'Gymnastics'],
      'Food and cooking': ['Cooking classes', 'Baking', 'Sourdough'],
      'Arts and crafts': ['Pottery course', 'Life drawing', 'Sewing'],
      Languages: ['Spanish', 'French', 'Italian'],
      Homeschool: ['Science', 'Maths', 'Forest school'],
    },
    prompts: ['What it is and who it’s for', 'How many weeks, and when', 'What they’ll be able to do', 'Where it is', 'How many places, and the price'],
  },
  onrequest: {
    tag: 'On request', bg: INACTIVE, fg: INK, sub: INK_HOVER, lo: LANE_BAR_ON_LIGHT, chip: CREAM,
    short: 'Your time, when\nthey want it', title: 'Your time, when\nthey want it.', line: 'No fixed date. Say when you’re free and people book you: a tour, a lesson, a day out.',
    eg: ['Walking tour', 'Cooking lesson', 'Personal trainer', 'Photo shoot'], rows: ['Walking tour · Cooking lesson', 'Personal trainer · Photo shoot'],
    placeholder: 'A walking tour, a cooking lesson…',
    cats: {
      Tours: ['Walking tour', 'Food tour', 'History tour'],
      Lessons: ['Cooking lesson', 'Music lesson', 'Language lesson', 'Art lesson', 'Driving practice', 'Tutoring', 'Sewing lesson'],
      Fitness: ['Personal trainer', 'Yoga one-to-one'],
      Creative: ['Photo shoot', 'Portrait drawing'],
      'Advice and help': ['Garden advice', 'Tech help'],
    },
    prompts: ['What you’ll do with people', 'Why you', 'When you’re free', 'Where it happens', 'How long, and the price'],
  },
};

/** The hero line on Host home, its four phrases lit on hover (4e). */
export const HERO_SEGMENTS: [string, number | null][] = [['A one-off', 0], [', ', null], ['something weekly', 1], [', ', null], ['a course', 2], [', or ', null], ['time people book', 3], ['.', null]];

/**
 * "Under the title", suggested for the chosen category and marked Suggested
 * until the host edits it. Epic's own neutral words — never an example host's.
 */
export const SUGGESTED_LINE: Record<string, string> = {
  Celebrations: 'Food, drinks and good company to mark the day.',
  'Social nights': 'An evening in good company. Come as you are.',
  'Markets and fairs': 'Stalls, makers and something for everyone.',
  'Talks and tasters': 'A short, friendly introduction. No experience needed.',
  Outdoors: 'Out in the fresh air together. Wear good shoes.',
  Fitness: 'An hour to move, at your own pace. All levels.',
  Sport: 'A friendly game every week. All abilities welcome.',
  Clubs: 'The same friendly faces, every week.',
  'Kids and families': 'A weekly session for children and the grown-ups who bring them.',
  'Arts and crafts': 'Make something with your hands. Materials provided.',
  'Sport and fitness': 'Week by week, from first steps to doing it on their own.',
  'Food and cooking': 'Cook it from scratch, then eat what you make.',
  Languages: 'Week by week, from hello to holding a conversation.',
  Homeschool: 'A term of learning together, one subject at a time.',
  Tours: 'A walk with someone who knows the place well.',
  Lessons: 'One to one, at your pace, with someone who loves it.',
  Creative: 'Time with someone who’s made it their craft.',
  'Advice and help': 'An hour with someone who knows, on what you need.',
};

// ---------------------------------------------------------------------------
// the offer, as the set-up reads it (GET /api/host/lanes/offers/:id)
// ---------------------------------------------------------------------------

export type GuestQuestions = {
  plusOne?: { on: boolean };
  diet?: { on: boolean; ticks: string[] };
  kids?: { on: boolean; askAges: boolean; askNeeds: boolean; mostPerFamily: number };
  bring?: { on: boolean; items: { id: string; name: string; qty: number }[] };
  stay?: { on: boolean; nights: string[]; places: { id: string; name: string; note: string | null }[] };
};
export type Cohost = { id?: string; name: string; role: 'cohost' | 'helper'; accountId?: string | null; contactId?: string | null; canEdit: boolean; canMessage: boolean; shownOnPage: boolean; withPhoto: boolean; seesGuests: boolean };
export type CheckItem = { key: 'email' | 'phone' | 'profile' | 'verified' | 'video' | 'checked' | 'payouts' | 'tax' | 'review' | 'fee_card'; blocks: 'send' | 'live' | 'payout' | null; done: boolean; optional?: boolean; info?: boolean; pending?: boolean; submitted?: boolean; t: string; s: string };

export type LaneOffer = {
  id: string; lane: HostLane; state: 'draft' | 'in_review' | 'approved' | 'live' | 'paused' | 'ended'; visibility: 'invite' | 'public' | null; money: 'free' | 'direct' | 'epic';
  draftStep: string | null; draftSource: string | null; steps: StepKey[]; missing: StepKey[];
  whatCategory: string | null; whatLabel: string | null; title: string | null; line: string | null; lineSuggested: boolean;
  photos: { id: string; url: string }[];
  startsOn: string | null; startsAt: string | null; endsAt: string | null; multiDay: boolean; endsOn: string | null;
  runningOrder: { day: number; time: string | null; title: string; detail?: string | null }[];
  cohosts: Cohost[];
  venue: 'out_about' | 'your_place' | 'their_place' | 'online' | null; venueLabel: string | null; venueArea: string | null; venueRef: string | null; venueNotes: string | null;
  travelRadiusMin: number | null; travelChargePence: number | null; onlineMode: 'epic' | 'own' | null; onlineLink: string | null; timeZone: string | null;
  guestQuestions: GuestQuestions;
  weekdays: number[]; firstDate: string | null; durationMin: number | null; sessions: number | null; excludeBankHolidays: boolean; skippedDates: string[];
  run: { dates: string[]; skipped: { date: string; why: 'bank' | 'host'; name?: string }[] } | null;
  outcome: string | null; topics: { n: number; title: string }[]; parents: 'stay' | 'drop_off' | null; whyYou: string | null;
  freeHours: Record<string, [string, string][]>; sessionLengths: number[]; noticeHours: number; perWeekMax: number;
  priceMode: 'free' | 'same_each' | 'by_numbers' | null; pricePence: number | null; childPence: number | null; totalPence: number | null; per: 'person' | 'booking' | 'household' | null;
  minCount: number | null; maxCount: number | null;
  dropInPence: number | null; bookAheadPence: number | null; dropInGroupPct: number | null; dropInGroupMin: number | null; bookAheadGroupPct: number | null; bookAheadGroupMin: number | null;
  decidesOn: string | null; decidesOnDefault: string | null; refundPolicy: 'flexible' | 'moderate' | 'strict' | null; refundWords: string | null;
  // Hosting v4: the waiting list (default off), the address kept back until booked, Choose dates' blocks.
  waitlistOn: boolean; addressHidden: boolean; chosenDates: { dates: string[] }[];
  ageMin: number | null; ageMax: number | null; asksParents: boolean; needsChecked: boolean;
  privatePlan: 'event' | 'pro'; privateFeeState: 'unpaid' | 'pending' | 'paid' | 'included' | 'not_needed';
  video: { id: string | null; url: string | null; madeBy: 'self' | 'epic' | null; coverS: number | null; onProfile: boolean; photoIds: string[]; helloId: string | null; seconds: number | null; helloSeconds: number | null };
  invites: { id: string; name: string; contact: string | null; contactKind: string | null; heads: number; rsvp: string | null; rsvpHeads?: number | null; sentAt: string | null }[];
  inviteUrl: string; pageUrl: string;
  sessionRows: {
    id: string; n: number | null; onDate: string; startsAt: string | null; endsAt?: string | null; topic: string | null; state: string;
    booked?: number; decidesAt?: string | null; decided?: 'on' | 'called_off' | null; changedFrom?: { date: string | null; time: string | null } | null; late?: boolean;
  }[];
  checklist: CheckItem[]; blockers: string[]; action: { key: 'verify' | 'review' | 'send' | 'pro' | 'pay'; label: string };
  charges: { kind: 'private' | 'public_free' | 'public_paid'; sharePct: number; words: string; eventPence?: number; proMonthlyPence?: number; isPro?: boolean };
  paid: boolean; throughEpic: boolean;
};

/** What a step sends: any subset of the offer's own fields, plus the lists that are saved whole. */
export type LanePatch = Partial<Omit<LaneOffer, 'cohosts' | 'topics'>> & { cohosts?: Cohost[]; topics?: { n: number; title: string }[]; photoIds?: string[]; draftStep?: string | null };

export type LaneConfig = {
  privateEventPence: number; proMonthlyPence: number; privateCollectPct: number;
  publicShare: { pct: number; ratedEvents?: number; avgAtLeast?: number }[];
  refunds: { key: 'flexible' | 'moderate' | 'strict'; words: string }[];
  decidesDaysBefore: number; weeklyDecidesHoursBefore: number;
  onRequest: { noticeHours: number; perWeek: number; respondHours: number; lengths: number[] };
  reviewHours: number; hostMinAge: number; adultAge: number; oneoffMaxDays: number; courseSessions: { min: number; max: number };
  videoSeconds: { min: number; max: number; hello: number }; epicVideoPhotos: { min: number; max: number };
  diet: string[]; bankHolidays: { date: string; title: string }[];
  stripe: { ready: boolean; mode: 'test' | 'live' | null; note: string | null }; listening: boolean;
  /** The ID the check takes: a passport, and a UK licence only while the owner's setting allows it (L7). */
  identityDocuments?: ('passport' | 'driving_licence')[];
};
export type HostSheet = {
  name: string | null; line: string | null; photo: string | null; photoId?: string | null; dateOfBirth: string | null;
  identity: 'none' | 'pending' | 'verified' | 'failed'; payouts: 'none' | 'pending' | 'ready'; checked: 'none' | 'submitted' | 'passed' | 'failed';
  tax: string | null; referees?: { name: string; email: string }[]; dbs?: string | null; insurance?: boolean;
  email: string | null; mobile: string | null;
};
export type LaneHome = {
  config: LaneConfig; isPro: boolean; host: HostSheet;
  drafts: { id: string; lane: HostLane; title: string | null; whatLabel: string | null; step: string | null; updatedAt: string; missing: number }[];
};

// ---------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------

export const DIET_WORDS: Record<string, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', gluten_free: 'Gluten-free', nut_allergy: 'Nut allergy', dairy_free: 'Dairy-free', halal: 'Halal' };
export const NEED_WORDS: Record<string, string> = { high_chair: 'High chair', cot: 'Cot', quiet_room: 'Quiet room' };
export const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
/** Monday-first index (the screens) ↔ 0 Sunday … 6 Saturday (the data). */
export const monFirstToDow = (i: number) => (i + 1) % 7;
export const dowToMonFirst = (d: number) => (d + 6) % 7;
export const DAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** £35, £10.50, — */
export function gbp(pence: number | null | undefined): string {
  if (pence == null || !Number.isFinite(pence) || pence <= 0) return '—';
  const p = pence / 100;
  return `£${p % 1 ? p.toFixed(2) : String(p)}`;
}
/** A typed price ("35", "£10.50") → pence, or null. */
export function pence(typed: string): number | null {
  const n = Number(String(typed).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
/** Pence → what the box shows while editing. */
export const poundsText = (p: number | null | undefined) => (p == null || p <= 0 ? '' : String(p / 100 % 1 ? (p / 100).toFixed(2) : p / 100));

/** 45 → "45 min", 60 → "1 hr", 90 → "1 hr 30", 120 → "2 hrs". */
export function lengthWords(min: number | null | undefined): string {
  if (!min) return '';
  const h = Math.floor(min / 60); const m = min % 60;
  if (!h) return `${m} min`;
  return `${h} hr${h > 1 && !m ? 's' : ''}${m ? ` ${m}` : ''}`;
}
/** "45", "45 min", "1 hr", "1h30", "1.5 hours", "90" → minutes. */
export function parseLength(typed: string): number | null {
  const s = String(typed).toLowerCase().trim();
  if (!s) return null;
  const hm = /^(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\s*(\d+)?/.exec(s);
  if (hm) return Math.round(Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0));
  const m = /^(\d+)/.exec(s);
  return m ? Number(m[1]) : null;
}
/** "9" → 09:00, "930" → 09:30, "19:5" → 19:05, else null. */
export function parseTime(typed: string): string | null {
  const s = String(typed).replace(/[^\d:]/g, '');
  let h: number; let m: number;
  if (s.includes(':')) { const [a, b] = s.split(':'); h = Number(a); m = Number(b || 0); }
  else if (s.length <= 2) { h = Number(s); m = 0; }
  else { h = Number(s.slice(0, s.length - 2)); m = Number(s.slice(-2)); }
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59 || s === '') return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// dates (UTC noon arithmetic, as the server's)
// ---------------------------------------------------------------------------

export const at = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const plusDays = (d: string, n: number) => { const x = at(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
export const dowOf = (d: string) => at(d).getUTCDay();
export const todayIso = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "Sat 13 Jun" */
export const dayWords = (d: string | null | undefined) => (d ? `${DAY_SHORT[dowOf(d)]} ${at(d).getUTCDate()} ${MONTHS[at(d).getUTCMonth()]}` : '');
/** "13 Jun" */
export const dateShort = (d: string | null | undefined) => (d ? `${at(d).getUTCDate()} ${MONTHS[at(d).getUTCMonth()]}` : '');

/** Course: the run, skipping excluded dates and pushed back to keep its number. */
export function courseRun(o: { firstDate: string | null; sessions: number | null; skippedDates: string[]; excludeBankHolidays: boolean }, holidays: Map<string, string>) {
  const dates: string[] = []; const skipped: { date: string; why: 'bank' | 'host'; name?: string }[] = [];
  if (!o.firstDate || !o.sessions) return { dates, skipped };
  const own = new Set(o.skippedDates);
  let d = o.firstDate; let guard = 0;
  while (dates.length < o.sessions && guard++ < 120) {
    if (o.excludeBankHolidays && holidays.has(d)) skipped.push({ date: d, why: 'bank', name: holidays.get(d) });
    else if (own.has(d)) skipped.push({ date: d, why: 'host' });
    else dates.push(d);
    d = plusDays(d, 7);
  }
  return { dates, skipped };
}

/** Weekly: every chosen day from the start, for `weeks` ahead. */
export function weeklyRun(o: { firstDate: string | null; weekdays: number[]; skippedDates: string[]; excludeBankHolidays: boolean }, holidays: Map<string, string>, weeks = 12) {
  const dates: string[] = []; const skipped: { date: string; why: 'bank' | 'host'; name?: string }[] = [];
  if (!o.firstDate || !o.weekdays.length) return { dates, skipped };
  const days = new Set(o.weekdays); const own = new Set(o.skippedDates);
  for (let i = 0; i < weeks * 7; i += 1) {
    const d = plusDays(o.firstDate, i);
    if (!days.has(dowOf(d))) continue;
    if (o.excludeBankHolidays && holidays.has(d)) skipped.push({ date: d, why: 'bank', name: holidays.get(d) });
    else if (own.has(d)) skipped.push({ date: d, why: 'host' });
    else dates.push(d);
  }
  return { dates, skipped };
}

/** On request: hourly starts inside a day's ranges, leaving room for the session. */
export function slotsFor(freeHours: Record<string, [string, string][]>, dow: number, lengthMin: number) {
  const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const out: string[] = [];
  for (const [f, t] of freeHours[String(dow)] ?? []) {
    for (let s = mins(f); s + lengthMin <= mins(t); s += 60) out.push(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
  }
  return [...new Set(out)].sort();
}

/** The draft rows ("Here's your draft"): what was filled in, and which step each links to. */
export function draftRows(o: LaneOffer): { k: string; v: string | null; step: StepKey }[] {
  const when = o.lane === 'oneoff' ? (o.startsOn ? `${dayWords(o.startsOn)}${o.startsAt ? ` · ${o.startsAt}${o.endsAt ? `–${o.endsAt}` : ''}` : ''}` : null)
    : o.lane === 'weekly' ? (o.weekdays.length ? `${o.weekdays.map((d) => DAY_PLURAL[d]).join(', ')}${o.startsAt ? ` · ${o.startsAt}` : ''}` : null)
      : o.lane === 'course' ? (o.firstDate ? `${o.sessions ?? ''} ${DAY_PLURAL[dowOf(o.firstDate)]} from ${dayWords(o.firstDate)}`.trim() : null) : null;
  const where = o.venueLabel ?? o.venueArea ?? (o.venue === 'online' ? 'Online' : null);
  const price = o.lane === 'weekly' ? (o.dropInPence || o.bookAheadPence ? [o.dropInPence ? `Drop in ${gbp(o.dropInPence)}` : '', o.bookAheadPence ? `Book ahead ${gbp(o.bookAheadPence)}` : ''].filter(Boolean).join(' · ') : null)
    : o.priceMode === 'same_each' && o.pricePence ? `${gbp(o.pricePence)} each` : o.priceMode === 'by_numbers' && o.totalPence ? `${gbp(o.totalPence)} split` : null;
  const whatStep: StepKey = 'what';
  const rows: { k: string; v: string | null; step: StepKey }[] = [
    { k: 'What it is', v: o.whatLabel, step: whatStep },
    { k: 'Title', v: o.title, step: whatStep },
  ];
  if (o.lane === 'onrequest') rows.push({ k: 'Why you', v: o.whyYou, step: 'why' }, { k: 'When you’re free', v: Object.keys(o.freeHours).length ? Object.keys(o.freeHours).map((d) => DAY_SHORT[Number(d)]).join(', ') : null, step: 'avail' });
  else rows.push({ k: 'When', v: when, step: o.lane === 'oneoff' ? 'when' : o.lane === 'weekly' ? 'weekly' : 'run' });
  rows.push({ k: 'Where', v: where, step: 'where' });
  if (o.lane === 'oneoff') rows.push({ k: 'Running order', v: o.runningOrder.length ? `${o.runningOrder.length} item${o.runningOrder.length > 1 ? 's' : ''}` : null, step: 'order' });
  if (o.lane === 'course') rows.push({ k: 'By the end', v: o.outcome, step: 'outcome' });
  rows.push({ k: 'Who’s coming', v: o.maxCount ? `Up to ${o.maxCount}` : null, step: 'who' });
  rows.push({ k: 'Price', v: o.priceMode === 'free' && o.lane !== 'weekly' && o.draftStep ? 'Free' : price, step: o.lane === 'weekly' ? 'wprice' : 'price' });
  return rows;
}

/** Bank holidays as a date → name map, for the runs drawn live. */
export const holidayMap = (list: { date: string; title: string }[]) => new Map(list.map((h) => [h.date, h.title]));

/** Under 18 at the top of the range, outside Course: "Parents stay or drop off" is asked on Who can come. */
export const asksParentsOnWho = (o: Pick<LaneOffer, 'lane' | 'ageMax'>, adultAge = 18) => o.lane !== 'course' && o.ageMax != null && o.ageMax < adultAge;
