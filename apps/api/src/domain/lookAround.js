/**
 * Whether Epic should look around a town live, at a provider's expense, when
 * the home screen is asked about it.
 *
 * The owner, 12 Sep 2026, on searching Bristol before the sweep had reached
 * it: "when I set my location to Bristol, you should be calling the Google API
 * and checking locations from Bristol. It should work either way." So the
 * sweep stays the first answer wherever it has been, and where it has not been
 * the look-around fills in — through the search cache, so the second look at
 * the same town costs nothing.
 *
 * "Has not been" is judged in the town, not across the whole reach: the food
 * pool is gathered from sixty kilometres around, and a swept Bath must not
 * make Bristol look covered.
 *
 * **Bristol had a third cause, found on 20 September 2026, and it was not in
 * this file.** Two were fixed on the day: `from` was never sent, so every
 * travel time was measured from Ascot, and the look-around did not run in a
 * town the sweep had not reached. The third was the arithmetic. Measured
 * against Google Routes on 473 sector pairs, `estimateTravelMinutes` overstated
 * three driving journeys in four — by 16 minutes on an hour-and-a-half run —
 * and every list in the app is fenced on that number, so an honest catchment
 * was being trimmed before anything in this file was consulted. "Within an
 * hour" was emptier than the road says it is. Recalibrated in
 * `domain/travel.js`; the same fault, and the same fix, as Crystal Palace on
 * 6 September.
 */
export function needsLookAround(sweptFood, withinKm) {
  return !(sweptFood ?? []).some((f) => f?.km != null && f.km <= withinKm);
}

/**
 * What the look-around did, for the screen to say in plain words: nothing was
 * asked; it was asked and answered; or it was asked and a source refused
 * (out of allowance, most often) — in which case "there is nowhere to eat"
 * would be untrue and the screen needs to know not to say it.
 */
export function lookAroundOutcome({ ran, why, degraded }) {
  if (!ran) return { live: false, why: null, failed: false };
  const failed = (degraded ?? []).some((d) => d && !d.slow);
  return { live: true, why, failed };
}
