// What the open encyclopedias know about a place: Wikipedia and Wikidata.
//
// This is where an attraction gets a description we are allowed to keep. A
// castle, a museum, a gallery or a park usually has an article; the extract is
// CC BY-SA 4.0, so it may be stored and shown for good provided the article is
// credited and linked, which is why `attribution` travels with the text and is
// never optional. Wikidata's own statements are CC0 — the official website, the
// year it opened, the image — and carry no condition at all.
//
// Restaurants rarely have articles, and that is fine: this returns null and the
// record is built from the map and the venue's own page instead.
//
// Licence note for the owner: CC BY-SA is share-alike on the *text*. Storing an
// extract and showing it with credit is the ordinary use and is what every
// travel app does; it does not put any licence on Epic's own data. Rewriting
// the extract into our own words would remove the condition entirely, and is
// the thing to do if that text is ever wanted without the credit line.

import { FOOD_CATEGORIES as EATING } from '../constants.js';
import { userAgent } from '../origins.js';

const WIKI = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const UA = userAgent('place research');
const TIMEOUT = 8000;

// An article about a building that happens to be near is not an article about
// this restaurant; the point has to be close and the name has to agree.
const MAX_M = 400;

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

/** Articles with coordinates within `radius` metres of a point. */
async function geosearch(lat, lng, radius = MAX_M) {
  const p = new URLSearchParams({
    action: 'query', list: 'geosearch', gscoord: `${lat}|${lng}`, gsradius: String(radius),
    gslimit: '20', format: 'json', origin: '*',
  });
  const data = await get(`${WIKI}?${p}`);
  return (data?.query?.geosearch ?? []).map((g) => ({ title: g.title, pageId: g.pageid, distanceM: Math.round(g.dist) }));
}

/** The article itself: the opening paragraph, its picture, and its Wikidata id. */
async function article(title) {
  const p = new URLSearchParams({
    action: 'query', prop: 'extracts|pageimages|pageprops|info', titles: title,
    exintro: '1', explaintext: '1', exsentences: '4', piprop: 'original', pageprops: 'wikibase_item',
    inprop: 'url', format: 'json', origin: '*', redirects: '1',
  });
  const data = await get(`${WIKI}?${p}`);
  const page = Object.values(data?.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined) return null;
  return {
    title: page.title,
    summary: (page.extract || '').trim() || null,
    url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    imageUrl: page.original?.source ?? null,
    wikidataId: page.pageprops?.wikibase_item ?? null,
  };
}

/** The most of an article's body that is kept. Owned text; the extractor reads it, a page never shows it. */
export const BODY_MAX = 8000;

/**
 * The article's body, beyond the lead.
 *
 * The lead is what a place page shows; the body is what the extractor reads
 * — kept separately, never in its place (owner, 26 Sep 2026: "the chain has
 * been starved for a fortnight on a two-sentence summary"). One more free
 * request, plain text, capped.
 */
async function body(title) {
  const p = new URLSearchParams({ action: 'query', prop: 'extracts', titles: title, explaintext: '1', exlimit: '1', format: 'json', origin: '*', redirects: '1' });
  const data = await get(`${WIKI}?${p}`);
  const page = Object.values(data?.query?.pages ?? {})[0];
  return beyondTheLead(page?.extract);
}

/**
 * The plain-text extract without its lead and without its furniture.
 *
 * The full extract begins with the lead the summary already holds, so keeping
 * it would hand the extractor the same sentences twice (Codex, 26 Sep 2026):
 * the body starts at the first section heading. An article that is all lead
 * has no body.
 */
export function beyondTheLead(extract) {
  const whole = String(extract ?? '');
  const first = whole.search(/(^|\n)\s*==+[^=\n]+==+/);
  if (first < 0) return null;
  const text = whole.slice(first).replace(/\s*==+\s*(See also|References|External links|Notes|Further reading|Bibliography)\s*==+[\s\S]*$/i, '').trim();
  return text ? text.slice(0, BODY_MAX) : null;
}

/**
 * Article subjects an ordinary place is never the same thing as.
 *
 * The matcher paired the town of Woking with an escape room called "Woking",
 * the hill with Horsenden Hill Activity Centre and Kentish Town with its
 * sports centre — and attached each article's facts to the place (owner,
 * 26 Sep 2026). Wikidata says what an article is about (P31); a settlement
 * or an administrative area is refused for any place, and a landform is
 * refused unless the place is the kind of thing a landform is.
 */
export const SETTLEMENT_OR_AREA = new Set([
  'Q486972', // human settlement
  'Q515', 'Q3957', 'Q532', 'Q5084', 'Q1549591', 'Q7930989', 'Q702492', // city, town, village, hamlet, big city, city/town, urban area
  'Q56061', 'Q1115575', 'Q211690', 'Q1187811', 'Q3624078', // administrative territorial entity, civil parish, London borough, metropolitan borough, sovereign state
  'Q179049', 'Q3455524', 'Q1637706', 'Q123705', 'Q188509', 'Q15303838', // district (UK), county, city with millions, neighbourhood, suburb, London district
  'Q1907114', 'Q2983893', 'Q5119', 'Q1093829', 'Q1500350', // metropolitan area, quarter, capital, city (US), township
]);
export const LANDFORM = new Set([
  'Q8502', 'Q54050', 'Q4022', 'Q23397', 'Q39816', 'Q23442', 'Q39594', 'Q2143825', 'Q473972', 'Q4421', 'Q188055', // mountain, hill, river, lake, valley, island, moor, hillside, protected area, forest, common land
]);
const LANDFORM_KIND = /hill|mountain|park|wood|forest|nature|reserve|beach|coast|lake|river|water|garden|trail|common|heath|moor|fell|valley|view|cave|fall|island|outdoor|walk|countryside/i;

export function refused(classes = [], category = null) {
  if (classes.some((c) => SETTLEMENT_OR_AREA.has(c))) return 'a settlement or an area';
  if (classes.some((c) => LANDFORM.has(c)) && !LANDFORM_KIND.test(String(category ?? ''))) return 'a landform';
  return null;
}

/** What Wikidata says several entities are (P31), fifty a request. */
export async function classesOf(qids) {
  const out = {};
  const ids = [...new Set(qids.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const p = new URLSearchParams({ action: 'wbgetentities', ids: chunk.join('|'), props: 'claims', format: 'json', origin: '*' });
    const data = await get(`${WIKIDATA}?${p}`);
    for (const id of chunk) {
      const claims = data?.entities?.[id]?.claims ?? {};
      out[id] = (claims.P31 ?? []).map((c) => c?.mainsnak?.datavalue?.value?.id).filter(Boolean);
    }
  }
  return out;
}

/** The statements worth keeping from a Wikidata entity: all CC0. */
async function entity(qid) {
  const p = new URLSearchParams({ action: 'wbgetentities', ids: qid, props: 'claims', format: 'json', origin: '*' });
  const data = await get(`${WIKIDATA}?${p}`);
  // An item that is not there is not an item with no classes (Codex, 26 Sep 2026).
  if (!data?.entities?.[qid]?.claims) throw new Error(`wikidata: no entity ${qid}`);
  const claims = data.entities[qid].claims;
  const first = (prop) => claims[prop]?.[0]?.mainsnak?.datavalue?.value ?? null;
  const inception = first('P571');
  return {
    classes: (claims.P31 ?? []).map((c) => c?.mainsnak?.datavalue?.value?.id).filter(Boolean),
    officialWebsite: typeof first('P856') === 'string' ? first('P856') : null,
    // "+1894-01-01T00:00:00Z" — the year is the part worth showing.
    openedYear: inception?.time ? Number(String(inception.time).slice(1, 5)) || null : null,
    commonsImage: typeof first('P18') === 'string' ? first('P18') : null,
  };
}

/**
 * What the encyclopedias have on this place.
 *
 * Returns `{ summary, url, title, imageUrl, wikidataId, officialWebsite,
 * openedYear, attribution, distanceM, confidence }` or null. Two requests when
 * there is an article, three when it also has a Wikidata entity; all free, all
 * keepable.
 */
export async function encyclopediaFor({ name, lat, lng, locality = null, address = null, category = null, drawer = null } = {}) {
  if (lat == null || lng == null || !String(name || '').trim()) return null;
  const { nameScore, placeWords } = await import('./openMatch.js');
  // The village's name is in half the articles written about the village, so it
  // is not evidence that this article is about this place: "Sunningdale Bistro
  // Bar" was given Sunningdale railway station's article (found 6 Sep 2026).
  // The same list the open map is matched against (openMatch.js).
  const dull = placeWords(locality, address);

  const near = await geosearch(lat, lng);
  if (!near.length) return null;
  let best = null;
  for (const cand of near) {
    // Wikipedia disambiguates in brackets — "Roman Baths (Bath)" is the Roman Baths.
    const bare = cand.title.replace(/\s*\([^)]*\)\s*$/, '');
    const n = Math.max(nameScore(name, cand.title, dull), nameScore(name, bare, dull));
    // Somewhere you eat is rarely in an encyclopedia, and the article next door
    // usually is: "Sunningdale Bistro Bar" is most of "Sunningdale railway
    // station" once the village is taken out of both. So a restaurant has to
    // match an article's whole title, not most of it — which The Ivy and Rules,
    // the ones that really do have articles, still do.
    if (n < (EATING.has(String(category ?? '').toLowerCase()) ? 0.95 : 0.7)) continue;
    const confidence = Number(Math.min(1, n * (1 - cand.distanceM / (MAX_M * 4))).toFixed(2));
    if (!best || confidence > best.confidence) best = { ...cand, confidence };
  }
  if (!best) return null;

  const page = await article(best.title);
  if (!page?.summary) return null;

  let facts = { classes: [], officialWebsite: null, openedYear: null, commonsImage: null };
  // With no answer from Wikidata there is nothing to refuse on, and an article
  // that cannot be checked is not stored on the strength of its title: the
  // match is left for the next pass rather than taken, and an article with no
  // item at all is not taken either (Codex, 26 Sep 2026). Nearly every article
  // has one, so that costs almost nothing.
  if (!page.wikidataId) return null;
  try { facts = await entity(page.wikidataId); } catch { return null; }
  // An article about the town, the hill or the borough is not an article
  // about the place, however well the name scores.
  // The drawer is asked beside the category, never joined to it: the food
  // threshold above reads the category whole (Codex, 26 Sep 2026).
  if (refused(facts.classes, [category, drawer].filter(Boolean).join(' ') || null)) return null;
  const text = await body(best.title).catch(() => null);

  return {
    ...page,
    ...facts,
    body: text,
    // Wikipedia disambiguates in the title — "Roman Baths (Bath)", "Dishoom
    // (restaurant)" — which is right for an encyclopedia and wrong for the name
    // of somewhere you are going. The full title still travels, because that is
    // what the attribution has to credit.
    displayTitle: page.title.replace(/\s*\([^)]*\)\s*$/, '').trim() || page.title,
    distanceM: best.distanceM,
    confidence: best.confidence,
    // The condition on the text, in the words that have to appear on screen.
    attribution: `Wikipedia — “${page.title}”, CC BY-SA 4.0`,
    attributionUrl: page.url,
  };
}
