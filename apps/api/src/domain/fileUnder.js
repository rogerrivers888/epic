/**
 * Which of the household's locations a new place files under.
 *
 * Owner, 12 Sep 2026: "It should just automatically add it to whichever
 * locations are stored that are closest to it. If I'm in London and I have a
 * London location, it should add it in there. If I don't have a London
 * location, it should create one."
 *
 * The map's own answer for a point is a locality — "London", "Elmbridge",
 * "Bath and North East Somerset" — and left alone it makes a new row in the
 * atlas every time the council's name for a district differs from the last
 * one, which is how one household came to hold both "Bath" and "Bath and
 * North East Somerset". So the rule is: the map's locality where the household
 * already has it; otherwise the nearest location they already have, if the
 * point is close enough to plausibly be *in* it; otherwise the map's word,
 * which becomes a new location.
 *
 * Pure, so test/fileUnder.test.js can hold it to those three sentences.
 */

/** How far a point may be from a location's centre and still be filed there. */
export const SNAP_KM = 12;

const rad = (d) => (d * Math.PI) / 180;
export function kmBetween(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * @param reverse  what the map said about the point: { country, countryCode, locality }
 * @param cities   the household's locations: [{ country, countryCode, locality, lat, lng }]
 * @param point    { lat, lng } or null
 * @returns        { country, countryCode, locality, how } — `how` is 'known' (the map's
 *                 locality is one they hold), 'nearest' (snapped to one they hold),
 *                 'new' (the map's word, a location they did not have) or 'unknown'.
 */
export function fileUnder(reverse, cities, point) {
  const code = reverse?.countryCode ?? null;
  const here = (cities ?? []).filter((c) => c.countryCode && c.locality && same(c.countryCode, code));
  if (!code) return { country: null, countryCode: null, locality: null, how: 'unknown' };
  const known = reverse.locality ? here.find((c) => same(c.locality, reverse.locality)) : null;
  if (known) return { country: reverse.country ?? known.country ?? null, countryCode: code, locality: known.locality, how: 'known' };
  if (point && point.lat != null && point.lng != null) {
    const withCentre = here.filter((c) => c.lat != null && c.lng != null);
    let best = null;
    for (const c of withCentre) {
      const km = kmBetween(point, { lat: Number(c.lat), lng: Number(c.lng) });
      if (km <= SNAP_KM && (!best || km < best.km)) best = { c, km };
    }
    if (best) return { country: reverse.country ?? best.c.country ?? null, countryCode: code, locality: best.c.locality, how: 'nearest', km: Math.round(best.km * 10) / 10 };
  }
  return { country: reverse.country ?? null, countryCode: code, locality: reverse.locality ?? null, how: reverse.locality ? 'new' : 'unknown' };
}
