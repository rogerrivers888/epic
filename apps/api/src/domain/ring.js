/**
 * A ring, as the app now searches it.
 *
 * The owner, 20 Sep 2026: "The app reads the census index and the reachability
 * ring… locationRestriction set to the ring's bounding box, results filtered to
 * outcodes inside the ring."
 *
 * Inspire used to turn "thirty minutes" into a straight-line radius — minutes
 * times 0.8, as kilometres — and search a circle. A circle is not a drive: a
 * place twenty-five minutes up the motorway sat outside it and a field eight
 * miles across country sat inside. The reachability matrix already knows which
 * postcode sectors are within thirty minutes of which, worked out once, and
 * this turns that set into the two things a search needs: a box to fence the
 * provider with, and the outcodes to hold the answer to afterwards.
 *
 * The box is always bigger than the ring — a rectangle round an irregular
 * shape has to be — so the fence is the box and the *test* is the outcode. A
 * place Google returns from the corner of the box is dropped unless the cell it
 * stands in is one of the ring's own.
 */

/** The outward code a cell belongs to: `sector:SL5 0` is SL5. */
export const outcodeOfCell = (cell) => {
  const said = String(cell ?? '');
  const sector = said.startsWith('sector:') ? said.slice('sector:'.length) : said;
  const head = sector.split(/\s+/)[0]?.trim();
  return head ? head.toUpperCase() : null;
};

/**
 * The smallest rectangle that holds every cell in the ring, with a margin.
 *
 * The margin is the same edge allowance the matrix itself is read with: a cell
 * is a point at the middle of a sector, and a place near the sector's edge is
 * still in it. Half a kilometre of slack costs nothing — the outcode test
 * below throws away anything that is genuinely outside — and without it the
 * places at the rim of the ring are fenced out of the search that is supposed
 * to find them.
 */
export function boxAround(cells, { marginKm = 2 } = {}) {
  const points = (cells ?? []).filter((c) => c.lat != null && c.lng != null);
  if (!points.length) return null;
  const lats = points.map((c) => Number(c.lat));
  const lngs = points.map((c) => Number(c.lng));
  const mid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = marginKm / 111.32;
  const dLng = marginKm / (111.32 * Math.cos((mid * Math.PI) / 180) || 1);
  return {
    minLat: Math.min(...lats) - dLat,
    maxLat: Math.max(...lats) + dLat,
    minLng: Math.min(...lngs) - dLng,
    maxLng: Math.max(...lngs) + dLng,
  };
}

/** How wide the box is, in kilometres, so a screen can say what it searched. */
export const boxKm = (box) => (box
  ? {
    across: Number(((box.maxLng - box.minLng) * 111.32 * Math.cos(((box.minLat + box.maxLat) / 2) * Math.PI / 180)).toFixed(1)),
    down: Number(((box.maxLat - box.minLat) * 111.32).toFixed(1)),
  }
  : null);
