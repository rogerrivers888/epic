/**
 * The band, and the one rule about it.
 *
 * **If a household asks for thirty minutes, nothing over thirty minutes appears
 * on screen — in any list, on any card, ever. Not one** (owner, 20 Sep 2026,
 * making it permanent).
 *
 * That is not the same as the ring. The ring is a *finder*: it reads the
 * reachability matrix ten minutes past the band on purpose, because the
 * estimator's error and a place's offset from its sector's centre have a
 * combined p95 of 9.5 minutes, and hiding a place that is genuinely inside the
 * band is the worse harm (`domain/reach.js`). The allowance belongs to the
 * finder and must never reach the household.
 *
 * So everything the finder offers passes through here before anybody sees it,
 * measured from the point the card prints from and with the same estimator the
 * card prints, so the screen cannot contradict itself. One module, one
 * function: the fence was implemented twice before and the second copy went on
 * using the finder's ring after the first was corrected.
 */

import { estimateTravelMinutes } from './travel.js';

/**
 * How long this journey is, in the number the card will print.
 *
 * Exported so a caller cannot measure one way and print another: a card that
 * says "31 min drive" inside a thirty-minute band is the screen arguing with
 * itself, and that is what happens when two places compute the same journey.
 */
export const minutesTo = (from, place, mode = 'driving') => (
  from && place && place.lat != null && place.lng != null
    ? estimateTravelMinutes(from, place, mode)
    : null
);

/**
 * Whether this place may be shown to somebody who asked for `minutes`.
 *
 * A place we cannot measure is a place we cannot show. There is no benefit of
 * the doubt here: the doubt is exactly how a forty-minute spa in Chiswick
 * reached a thirty-minute screen.
 */
export function withinBand(place, { from, minutes, mode = 'driving' } = {}) {
  if (!Number.isFinite(minutes)) return false;
  const mins = minutesTo(from, place, mode);
  return mins != null && mins <= minutes;
}

/** The same rule over a list, which is how every screen uses it. */
export const fenceToBand = (places, opts) => (places ?? []).filter((p) => withinBand(p, opts));
