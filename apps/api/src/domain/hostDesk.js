/**
 * The Host tab for hosts who already host (hosting v4, existing hosts E1–E13).
 * Pure: no IO. The routes (routes/hostDesk.js) read the rows; these decide
 * what they mean.
 */

import { SEQ } from './lanes.js';

/**
 * Which of the four homes a host gets (README "Four host states"):
 *
 *   quiet          nothing on: no session ahead and no On request offer live
 *   private_free   everything they run is private and free — no money but tips
 *   private_paid   everything private, something paid through Epic
 *   busy           anything public
 *
 * A host with no event and no draft is not here at all: they get Host home 4e.
 */
export function hostState({ offers = [], upcomingSessions = 0 }) {
  const out = offers.filter((o) => o.state !== 'draft');
  const liveOnRequest = out.some((o) => o.lane === 'onrequest' && o.state === 'live');
  if (!upcomingSessions && !liveOnRequest) return 'quiet';
  if (out.some((o) => o.visibility === 'public')) return 'busy';
  const paid = out.some((o) => o.price_mode && o.price_mode !== 'free' && (o.money ?? 'epic') === 'epic');
  return paid ? 'private_paid' : 'private_free';
}

/** Where a draft was left, as "Step 4 of 8". Null when the step is not one of its lane's. */
export function draftProgress(offer) {
  const seq = SEQ[offer.lane];
  if (!seq) return null;
  const i = seq.indexOf(offer.draft_step);
  const step = i < 0 ? 1 : i + 1;
  return { step, of: seq.length, words: `Step ${step} of ${seq.length}` };
}

/**
 * A session's status chip (README E1): On ✓ · Waiting on numbers · Request ·
 * Changed · In review · Draft · Finished · Called off.
 */
export function sessionChip({ offer, session, booked = 0, now = new Date(), endsAt = null }) {
  if (offer.state === 'draft') return 'draft';
  if (offer.state === 'in_review' || offer.state === 'approved') return 'in_review';
  if (session?.state === 'called_off') return 'called_off';
  if (session?.state === 'cancelled') return 'called_off';
  if (endsAt && new Date(endsAt) <= now) return 'finished';
  if (offer.lane === 'onrequest') return 'request';
  if (session?.changed_from) return 'changed';
  const min = Number(session?.min_count ?? offer.min_count ?? 0);
  if (min && booked < min && session?.decided_outcome !== 'on') return 'waiting';
  return 'on';
}

export const CHIP_WORDS = Object.freeze({
  on: 'On', waiting: 'Waiting on numbers', request: 'Request', changed: 'Changed', in_review: 'In review',
  draft: 'Draft', finished: 'Finished', called_off: 'Called off', cohost: 'Co-host',
});

/**
 * To do, most urgent first, in three groups (README E5): Today · This week ·
 * Soon. An item is `{ kind, title, line, due (Date|null), blocking }`; one
 * with no date (a draft) is Soon, and one that blocks money sorts first.
 */
export function groupTodo(items, now = new Date(), tz = 'Europe/London') {
  const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = day(now);
  const weekOut = new Date(now.getTime() + 7 * 86_400_000);
  const groups = { today: [], week: [], soon: [] };
  for (const it of items) {
    const due = it.due ? new Date(it.due) : null;
    const g = it.now || (due && day(due) <= today) ? 'today' : due && due <= weekOut ? 'week' : 'soon';
    groups[g].push({ ...it, red: g === 'today' || Boolean(it.blocking) });
  }
  const order = (a, b) => (b.blocking ? 1 : 0) - (a.blocking ? 1 : 0) || (a.due ? new Date(a.due).getTime() : Infinity) - (b.due ? new Date(b.due).getTime() : Infinity);
  for (const k of Object.keys(groups)) groups[k].sort(order);
  return groups;
}

/** Month keys 'YYYY-MM', the last `n` ending with `month`. */
export function lastMonths(month, n = 6) {
  const [y, m] = month.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/**
 * The change on last month, as a whole percentage. Null when last month was
 * nothing — "up ∞%" is not a number anybody can use.
 */
export function changePct(now, before) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

/**
 * A host's standing (README E13, back office escalation). The thresholds are
 * the owner's to set (`rating_escalation`, handover §7); until they are, the
 * standing can't speak and says so rather than calling everyone Good.
 */
export function standingOf({ thresholds, avg, ratedEvents, lateChanges90d = 0, openComplaints = 0 }) {
  if (!thresholds || typeof thresholds !== 'object') return { words: null, reason: 'Standing thresholds are not set yet' };
  const t = thresholds;
  if (openComplaints && t.complaintsUnderReview != null && openComplaints >= t.complaintsUnderReview) return { words: 'Under review', level: 'review' };
  if (avg != null && ratedEvents >= (t.minRated ?? 0) && t.avgBelowAtRisk != null && avg < t.avgBelowAtRisk) return { words: 'At risk', level: 'risk' };
  if (t.lateChangesAtRisk != null && lateChanges90d >= t.lateChangesAtRisk) return { words: 'At risk', level: 'risk' };
  return { words: 'Good', level: 'good' };
}

/** Typical time to a host's first reply: the median, in minutes. Null with fewer than three replies to go on. */
export function responseMinutes(gapsMinutes) {
  const g = (gapsMinutes ?? []).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (g.length < 3) return null;
  const mid = Math.floor(g.length / 2);
  return Math.round(g.length % 2 ? g[mid] : (g[mid - 1] + g[mid]) / 2);
}

export function responseWords(mins) {
  if (mins == null) return null;
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `${Math.round(h / 24)} days`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * What moves a host back down the ladder: the average falling under the step
 * they are on. Null on the first step (there is nowhere back to).
 */
export function movesBack(ladder, ratePct) {
  if (!Array.isArray(ladder)) return null;
  const i = ladder.findIndex((s) => s.pct === ratePct);
  if (i <= 0) return null;
  return { avgUnder: ladder[i].avgAtLeast, backTo: ladder[i - 1].pct, words: `Average under ${ladder[i].avgAtLeast} · back to ${ladder[i - 1].pct}%` };
}

/** "8 of 10 rated events to 10%" — or the average still to reach. */
export function ladderLine(progress) {
  if (!progress?.next) return null;
  const n = progress.next;
  if (n.eventsToGo > 0) return `${n.eventsToGo} more rated ${n.eventsToGo === 1 ? 'event' : 'events'} to ${n.pct}%`;
  if (!n.avgOk) return `An average of ${n.avgAtLeast} to reach ${n.pct}%`;
  return null;
}

/** A guest's phone number is the host's from booking until the session finishes; then it is hidden (README E8). */
export const phoneVisible = ({ sessionEndsAt, now = new Date() }) => Boolean(sessionEndsAt) && new Date(sessionEndsAt) > now;

/** A booking's payment, in the Guests tab's words. */
export function paymentWords(b) {
  switch (b.payment_state) {
    case 'charged': return 'Paid';
    case 'partially_refunded': return 'Part refunded';
    case 'refunded': return 'Refunded';
    case 'held': return 'Card held';
    case 'released': return 'Released';
    default: return b.state === 'pending' ? 'No reply' : 'Coming';
  }
}

/**
 * What a co-host may see on an event (README E7): the switches the host set.
 * The owner of the event sees everything.
 */
export function cohostView(row) {
  if (!row) return { guests: true, messages: true, money: true, dates: true, edit: true, owner: true };
  return { guests: Boolean(row.sees_guests), messages: Boolean(row.can_message), money: Boolean(row.can_see_money), dates: false, edit: false, owner: false };
}

/** Pence as "£1,240" or "£642.60". */
export function gbpWords(p) {
  const n = Number(p ?? 0) / 100;
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Thu 8 Oct" from 'YYYY-MM-DD', as the design writes it. */
export function dayWords(ymd) {
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
/** "September" from 'YYYY-MM'. */
export const monthName = (ym) => MONTH[Number(String(ym).slice(5, 7)) - 1];
