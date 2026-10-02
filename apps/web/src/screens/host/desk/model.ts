/**
 * The Host tab for hosts who already host (hosting v4, E1–E13): what the
 * server sends (apps/api/src/routes/hostDesk.js), typed once.
 */

import type { HostLane } from '../../../routes';

export type DeskState = 'busy' | 'private_free' | 'private_paid' | 'quiet';
export type Chip = 'on' | 'waiting' | 'request' | 'changed' | 'in_review' | 'draft' | 'finished' | 'called_off' | 'cohost';

export type SessionCard = {
  offerId: string; sessionId: string | null; title: string | null; lane: HostLane;
  date: string | null; time: string | null; booked: number; max: number | null; min: number | null; underMin: boolean;
  chip: Chip; chipWords: string;
};

export type Standing = { words: string | null; level?: 'good' | 'risk' | 'review'; reason?: string };
export type LadderProgress = { rate: number; ratedEvents: number; avg: number | null; next: { pct: number; ratedEvents: number; avgAtLeast: number; eventsToGo: number; avgOk: boolean } | null } | null;

export type DeskHome =
  | { home: '4e' }
  | {
    home: 'desk'; state: DeskState;
    host: { id: string; name: string; photo: string | null };
    tiles: { messages: number; todo: number; atRisk: number; reviews: { avg: number | null; count: number; newReviews: number; newTips: number } };
    nextUp: { first: SessionCard; more: SessionCard[] } | null;
    draft: { offerId: string; title: string | null; lane: HostLane; step: number; of: number; words: string } | null;
    party: { offerId: string; title: string | null; photo: string | null; date: string; time: string | null; coming: number; cantCome: number; noReply: number } | null;
    earnings: { month: string; pence: number; changePct: number | null; prevMonth: string; bars: { month: string; pence: number }[]; goalPence: number | null; due: { pence: number; on: string } | null; bookedAheadPence: number } | null;
    status:
      | { private?: undefined; feePct: number | null; intro: boolean; line: string | null; progress: LadderProgress; rating: number | null; standing: Standing }
      | { private: true; eventPence: number | null; proPence: number | null; paymentFeePct: number | null; rating: number | null; standing: Standing };
  };

export type TodoItem = { kind: string; title: string; line: string; due: string | null; asked?: string | null; now: boolean; red: boolean; offerId: string | null; ref: string | null };
export type DeskTodo = { today: TodoItem[]; week: TodoItem[]; soon: TodoItem[] };

export type AtRisk = {
  atRisk: { offerId: string; sessionId: string; title: string | null; lane: HostLane; booked: number; min: number; max?: number | null; decidesOn: string; refundPence: number; bookings: number; byNumbers: boolean; line: string }[];
  calledOff: { offerId: string; title: string | null; on: string; booked?: number; max?: number | null; refunds: { household: string; heads: number; pence: number; state: string }[]; totalPence: number }[];
};

export type EventRow = {
  id: string; title: string | null; lane: HostLane; visibility: string; photo: string | null; group: 'live' | 'helping' | 'drafts' | 'finished';
  next: { date: string; time: string | null; booked: number; max: number | null } | null; endedOn: string | null; came: number | null;
  draft: { step: number; of: number; words: string } | null; chip: Chip; chipWords: string; owner?: string;
};
export type DeskEvents = { live: EventRow[]; helping: EventRow[]; drafts: EventRow[]; finished: EventRow[] };

export type Guest = {
  bookingId: string; name: string; heads: number;
  children: { name: string | null; age: number | null; ageFromDob: number | null; needs: string[]; parentPhone: string | null }[];
  answers: Record<string, unknown>; phone: string | null; status: string; present: boolean | null;
};
export type DeskEvent = {
  event: {
    id: string; title: string | null; lane: HostLane; state: string; visibility: string; parents: 'stay' | 'drop_off' | null; photo: string | null;
    priceMode: string | null; minCount: number | null; maxCount: number | null; waitlistOn: boolean;
    date: { date: string; time: string | null } | null; booked: number; decidesBy: string | null; chip: Chip; link: string; lowerMinimum: boolean;
  };
  view: { guests: boolean; messages: boolean; money: boolean; dates: boolean; edit: boolean; owner: boolean; ownerName?: string | null };
  sessions: { id: string; n: number | null; date: string; time: string | null; booked: number; max: number | null; state: string; finished: boolean; changed: boolean }[];
  sessionId: string | null;
  guests: Guest[] | null;
  waitlist: { on: boolean; people: { position: number; household: string; party: number; offered: boolean; expiresAt: string | null }[] } | null;
  money: null | { private?: true; eventFee?: string; booked: number; fee: number; refunds: number; host: number; youGetPence?: number; payouts?: { pence: number; on: string; state: string }[] };
};

export type Payout = { id: string; title: string | null; pence: number; tipsPence: number; on: string; state: string; holdReason: string | null };
export type DeskEarnings = {
  month: string; pence: number; bookingsPence: number; tipsPence: number; changePct: number | null;
  bars: { month: string; pence: number }[];
  byEvent: { offerId: string; title: string | null; sessions: number; bookings: number; tipsPence: number; pence: number; sheet: { collectedPence: number; feePence: number; refundsPence: number; tipsPence: number; paidToYouPence: number } }[];
  bookedAhead: { pence: number; possiblePence: number | null };
  goal: { pence: number; soFarPence: number } | null;
  payouts: { next: Payout | null; due: Payout[]; held: Payout[]; paid: Payout[]; failed: Payout[]; stripe: { ready: boolean; accountId: string | null } };
  statements: { period: string; kind: 'month' | 'year'; csv: string; dac7?: boolean }[];
};

export type DeskFees = {
  ratePct: number | null; why: string;
  ladder: { pct: number; ratedEvents: number | null; avgAtLeast: number | null; words: string; current: boolean }[];
  progress: { ratedEvents: number; of: number; avg: number | null; avgNeeded: number } | null;
  movesBack: { avgUnder: number; backTo: number; words: string } | null;
  bookings: { title: string | null; household: string; reason: string; reasonWords: string; ratePct: number | null; feePence: number | null; words: string }[];
  link: { url: string; ratePct: number | null };
  privateOnly: boolean;
  private: { eventPence: number | null; proPence: number | null; paymentFeePct: number | null };
};

export type Review = { id: string; kind: 'review' | 'tip'; who: string; stars: number | null; tipPence: number | null; title: string | null; on: string; text: string | null; reply: string | null; reported: boolean; byProxy: boolean };
export type DeskReviews = {
  avg: number | null; count: number; tips: { count: number; pence: number };
  stars: { stars: number; count: number }[];
  overTime: { months: { month: string; avg: number | null; count: number }[]; ratingLine: string | null };
  mentions: { label: string; count: number }[];
  reviews: Review[]; needsReply: number;
};

export type DeskInsights = {
  events: { offerId: string; title: string | null; views: number; bookings: number; conversionPct: number | null; sources: { search: number; link: number; invites: number } }[];
  repeat: { pct: number | null; came: number; of: number; reason?: string };
  sellsOutFastest: { title: string | null; days: number } | null;
};

export type AutoMessage = { kind: string; title: string; when: string; on: boolean; body: string };
export type Cohost = { id: string; name: string; guests: boolean; messages: boolean; money: boolean; accepted: boolean; events: { offerId: string; title: string | null; rowId: string }[] };
export type DeskProfile = {
  host: { id: string; name: string; place: string | null; photo: string | null; responseMinutes: number | null; responseWords: string | null };
  videos: { kind: string; url: string | null }[];
  ratings: { avg: number | null; count: number; tips: { count: number; pence: number }; standing: Standing };
  checks: { identity: { state: string; on: string | null }; checked: { state: string; level: string | null; on: string | null; renewBy: string | null }; insurance: { expires: string | null } };
  settings: {
    payouts: { ready: boolean; tax: string | null };
    cohosts: Cohost[];
    notifications: Record<string, boolean>; goalPence: number | null;
    paused: boolean; stopped: boolean; canStop: boolean; outstanding: { bookings: number; payouts: number };
  };
  autoMessages: AutoMessage[];
  quickReplies: { id: string; body: string }[];
};

export const LANE_TAG: Record<HostLane, string> = { oneoff: 'One-off', weekly: 'Weekly', course: 'Course', onrequest: 'On request' };


// Dates the way the design writes them — "Sat 3 Oct", "27 Sep" — not the browser's "Sept".
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const partsOf = (ymd: string) => { const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`); return { dow: DOW[d.getUTCDay()], day: d.getUTCDate(), mon: d.getUTCMonth(), year: d.getUTCFullYear() }; };
/** "Sat 3 Oct" from 'YYYY-MM-DD'. */
export const dayWords = (ymd: string | null | undefined) => { if (!ymd) return '—'; const p = partsOf(ymd); return `${p.dow} ${p.day} ${MON[p.mon]}`; };
/** "3 Oct" from 'YYYY-MM-DD' (or an ISO instant, read in UK time). */
export const shortDate = (ymd: string | null | undefined) => { if (!ymd) return '—'; const p = partsOf(ymd.length > 10 ? ukDay(ymd) : ymd); return `${p.day} ${MON[p.mon]}`; };
/** "3 Oct 2026". */
export const fullDate = (ymd: string | null | undefined) => { if (!ymd) return '—'; const p = partsOf(ymd); return `${p.day} ${MON[p.mon]} ${p.year}`; };
/** The UK calendar day of an instant. */
export const ukDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
/** "October" (or "Oct") from 'YYYY-MM'. */
export const monthWords = (ym: string, short = false) => { const m = Number(ym.slice(5, 7)) - 1; return short ? MON[m] : MONTH[m]; };
/** "£1,240" or "£642.60". */
export const gbp = (p: number | null | undefined) => {
  const n = Number(p ?? 0) / 100;
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
