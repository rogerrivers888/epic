/**
 * The Host tab's dates, as plain logic with no React Native in it, so the
 * tests can read it directly (hostTabKit re-exports all of it).
 */

import type { OwnOffer } from '../../api';

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** The session dates a series runs on — computed by the server (publicOffer.dates), never re-derived here. */
const seriesDatesOf = (offer: OwnOffer): string[] => (Array.isArray(offer.dates) ? offer.dates : []);

/** The calendar date one of this offer's bookings sits on. */
export const dateOf = (offer: OwnOffer, occ: string | null): string | null =>
  offer.shape === 'oneoff' ? offer.startsOn
    : offer.shape === 'series' ? (occ && occ !== 'whole' ? occ.slice(0, 10) : offer.firstDate)
      : occ ? occ.slice(0, 10) : null;

export type DateGroup = { on: string | null; heads: number; bookings: number; pence: number };

/**
 * This offer's place-holding bookings, folded by the date they run on. A
 * waitlisted request holds no place and earns nothing, so it is outside the
 * fold entirely — otherwise an over-capacity waitlist inflates the booked
 * count, the guests and the money (Codex; /host/money keeps the same rule).
 * A whole-series booking sits on EVERY remaining session, exactly as the
 * server holds it active through the run, so it stays in Upcoming after the
 * first session rather than vanishing (Codex).
 */
export function offerDateGroups(offer: OwnOffer): DateGroup[] {
  const live = offer.bookings.filter((b) => b.state !== 'cancelled' && b.state !== 'waitlisted');
  const by = new Map<string, DateGroup>();
  // A live or paused offer's dates still to come are rows even with nobody
  // booked yet — otherwise a new one-off or series shows "Nothing booked yet"
  // with no row to open (Codex, 2 Oct 2026). Only dates to come: a past date
  // nobody booked was never hosted, and Past counts hosted dates.
  if (offer.state === 'live' || offer.state === 'paused') {
    const today = todayIso();
    const scheduled = offer.shape === 'oneoff' ? [offer.startsOn] : offer.shape === 'series' ? seriesDatesOf(offer) : [];
    for (const on of scheduled) if (on && on >= today) by.set(on, { on, heads: 0, bookings: 0, pence: 0 });
  }
  const fold = (on: string | null, b: OwnOffer['bookings'][number], countMoney: boolean) => {
    const key = on ?? 'tbd';
    const g = by.get(key) ?? { on, heads: 0, bookings: 0, pence: 0 };
    g.heads += b.heads;
    g.bookings += 1;
    // A whole-run booking's money is one sum for the run; count it once (on the
    // first session) rather than once per session.
    if (countMoney) g.pence += b.paymentStatus !== 'refunded' ? b.amountPence : 0;
    by.set(key, g);
  };
  for (const b of live) {
    if (offer.shape === 'series' && b.occurrence === 'whole') {
      const dates = seriesDatesOf(offer);
      if (dates.length) { dates.forEach((on, i) => fold(on, b, i === 0)); continue; }
    }
    fold(dateOf(offer, b.occurrence), b, true);
  }
  return [...by.values()].sort((a, z) => (a.on ?? '').localeCompare(z.on ?? ''));
}
