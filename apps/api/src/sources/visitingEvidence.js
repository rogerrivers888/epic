/**
 * What the open sources know about whether you can go somewhere.
 *
 * Two sources, both free, both keyless, both ours to keep — OpenStreetMap under
 * ODbL and Wikipedia under CC BY-SA. Neither is asked about a place twice: what
 * comes back is stored on the attraction and the verdict is worked out from the
 * stored copy, so re-judging after the rule learns something costs nothing.
 *
 * **The join is the Wikidata id.** Only 27 of 500 published attractions carry
 * an OpenStreetMap reference, but every one carries a Wikidata id, and OSM
 * features tag themselves `wikidata=Q…`. Asked that way, 79% of the places the
 * rule could not settle turned out to have an OSM feature — and of those, two
 * thirds carry something public and a handful are explicitly a dwelling.
 *
 * Nothing here touches a paid API, so it can be run over the whole atlas
 * without asking anybody's permission or spending anybody's money.
 */

import { overpassQuery } from './overpass.js';

/** Only the tags that bear on whether the public may enter. Everything else is somebody else's data to keep. */
const KEEP = ['access', 'building', 'tourism', 'leisure', 'natural', 'historic', 'amenity',
  'boundary', 'landuse', 'opening_hours', 'fee', 'operator', 'shop', 'aeroway', 'wikidata'];

const thin = (tags) => {
  const out = {};
  for (const k of KEEP) if (tags[k] != null) out[k] = String(tags[k]).slice(0, 120);
  return out;
};

/**
 * The OSM tags for a batch of Wikidata ids.
 *
 * Batched because Overpass is a shared, donated service and one query for
 * eighty places is a great deal kinder than eighty queries. Returns a Map of
 * id → merged tags; a place can be several features (Bagshot Park is a building
 * and a wood) and the merge keeps whatever any of them says.
 */
export async function osmForWikidata(ids, { timeoutMs = 120_000 } = {}) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();
  const body = `[out:json][timeout:${Math.round(timeoutMs / 1000)}];`
    + `(${wanted.map((q) => `nwr["wikidata"="${q}"];`).join('')});out tags;`;
  const answer = await overpassQuery(body, { timeoutMs });
  const out = new Map();
  for (const el of answer?.elements ?? []) {
    const tags = el.tags ?? {};
    const q = tags.wikidata;
    if (!q) continue;
    // A dwelling among the features is the fact that matters, so a later
    // feature must not quietly erase an earlier `building=house`.
    const merged = out.get(q) ?? {};
    for (const [k, v] of Object.entries(thin(tags))) if (merged[k] == null) merged[k] = v;
    out.set(q, merged);
  }
  return out;
}

/**
 * The categories on an English Wikipedia article.
 *
 * Fifty titles a request, which is the API's own limit for an anonymous
 * caller. Hidden categories are left out — they are maintenance bookkeeping
 * ("Articles with unsourced statements") and never say anything about a place.
 */
export async function wikipediaCategories(titles, { userAgent = 'Epic/0.1 (+https://epic.day)' } = {}) {
  const wanted = [...new Set(titles.filter(Boolean))].slice(0, 50);
  if (!wanted.length) return new Map();
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('prop', 'categories');
  url.searchParams.set('cllimit', 'max');
  url.searchParams.set('clshow', '!hidden');
  url.searchParams.set('format', 'json');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('titles', wanted.join('|'));

  const res = await fetch(url, { headers: { 'user-agent': userAgent } });
  if (!res.ok) throw Object.assign(new Error(`wikipedia ${res.status}`), { status: res.status });
  const body = await res.json();

  // A redirect means the title we asked for is not the title that answered, and
  // the caller only knows the one it asked for.
  const back = new Map();
  for (const r of body?.query?.redirects ?? []) back.set(r.to, r.from);
  for (const n of body?.query?.normalized ?? []) back.set(n.to, n.from);

  const out = new Map();
  for (const page of Object.values(body?.query?.pages ?? {})) {
    if (page.missing != null) continue;
    const cats = (page.categories ?? []).map((c) => String(c.title).replace(/^Category:/, ''));
    out.set(page.title, cats);
    const asked = back.get(page.title);
    if (asked) out.set(asked, cats);
  }
  return out;
}

/** The article title inside a Wikipedia URL, which is what the API wants. */
export const titleFromUrl = (url) => {
  if (!url) return null;
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\/wiki\/(.+)$/);
    return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : null;
  } catch { return null; }
};
