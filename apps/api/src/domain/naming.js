/**
 * Telling two places apart when they are called the same thing.
 *
 * Not every repeated name is a duplicate. A place that straddles two counties
 * is one place filed twice and is collapsed in the query (library.js). Two
 * churches seven kilometres apart, both called the Church of St Michael and All
 * Angels, are two churches — and collapsing them would delete a real one.
 *
 * But on a screen they read identically, which is the same bug from the
 * household's side (owner, 7 Sep 2026: "Should never be in the same view").
 * So the answer is to tell them apart rather than to throw one away.
 *
 * Wikipedia has already solved this. Its article titles are disambiguated for
 * exactly this reason, and the two above are filed as "St Michael and All
 * Angels Church, Sunninghill" and "Warfield Church" — both immediately clear.
 * So a name is only replaced when it collides, and only by something an editor
 * has already thought about.
 */

/** The article title inside a Wikipedia URL, in the words a person would read. */
export function articleTitle(url) {
  if (!url) return null;
  try {
    const m = new URL(url).pathname.match(/\/wiki\/(.+)$/);
    return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : null;
  } catch { return null; }
}

/**
 * Give every place in one answer a name of its own.
 *
 * Leaves a name alone unless something else in the same list shares it, so the
 * ordinary case reads exactly as it did. Where a collision has no article to
 * fall back on, the postcode district is better than two identical rows.
 */
export function distinguish(items, { name = (i) => i.name, url = (i) => i.wikipediaUrl, area = (i) => i.outcode, set = (i, v) => { i.name = v; } } = {}) {
  const seen = new Map();
  for (const item of items) {
    const n = name(item);
    if (!n) continue;
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  for (const item of items) {
    const n = name(item);
    if (!n || (seen.get(n) ?? 0) < 2) continue;
    const title = articleTitle(url(item));
    if (title && title !== n) { set(item, title); continue; }
    const where = area(item);
    if (where) set(item, `${n} (${where})`);
  }
  return items;
}
