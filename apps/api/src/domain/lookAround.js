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
