/**
 * Whether a place is still there to be visited (decision C57, owner, 29 Sep 2026).
 *
 * "A closed place is being listed: Windsor Safari Park (closed 1992, now
 * Legoland Windsor; its own 'What it is' text says so)." It came from the
 * Wikidata harvest, which never asked whether a place had ended, and the
 * visiting rule said yes because Wikipedia still files the article under
 * "Tourist attractions in Berkshire".
 *
 * Every place has an open status — open · temporarily closed · permanently
 * closed · unknown — and `unknown` is a real answer, never a quiet "open".
 * Four readers, each pure, each answering `null` when it cannot speak:
 *
 *   wikidataVerdict   dissolved / closure date / state of use / every instance ended / replaced by
 *   osmVerdict        lifecycle prefixes (disused:, was:, demolished:…), opening_hours=closed, end_date
 *   wikipediaVerdict  past-tense text and the article's own categories — conservative:
 *                     explicit words close, a hunch only flags for review
 *   googleVerdict     business status, read in memory when details are fetched; only
 *                     our derived flag is kept, never Google's words
 *
 * `combine` settles them into one row. A person's word is final; Google's live
 * status is current and outranks the encyclopedias; two sources that disagree
 * are sent to review rather than settled by whichever spoke last.
 *
 * And separately, item 3: a place known only from Wikidata/Wikipedia, with no
 * Google id, no OpenStreetMap match, no website and no census sighting, is
 * *unconfirmed* — nothing current says it exists (`confirmation`). It is
 * marked in the back office and counted, and it is *not* hidden: "Only
 * positive evidence of closure hides a place" (owner, 29 Sep 2026).
 */

export const STATUSES = ['open', 'temporarily_closed', 'permanently_closed', 'unknown'];
export const SOURCES = ['wikidata', 'osm', 'wikipedia', 'listing', 'google', 'person'];
const CLOSED = new Set(['temporarily_closed', 'permanently_closed']);

/** Whether a stored row keeps a place away from families. Nothing hides until it has been applied. */
export function hides(row) {
  if (!row || !row.applied) return false;
  return CLOSED.has(row.status);
}

/** The reason a hidden row is hidden, in the words the report counts by. */
export function hiddenBecause(row) {
  if (CLOSED.has(row?.status)) return row.status;
  if (row?.confirmed === false) return 'unconfirmed';
  return null;
}

const finding = (source, status, reason, evidence, extra = {}) => ({
  source, status, reason, evidence, review: false, successorQid: null, successorName: null, ...extra,
});

// ---------------------------------------------------------------------------
// Wikidata
// ---------------------------------------------------------------------------

/** P5817 "state of use", checked against the live API on 29 Sep 2026. */
export const STATE_OF_USE = {
  Q104664889: 'permanently_closed', // permanently closed
  Q11639308: 'permanently_closed',  // decommissioned
  Q56556915: 'permanently_closed',  // demolished or destroyed
  Q63065035: 'permanently_closed',  // abandoned
  Q30108381: 'permanently_closed',  // cancelled — never opened
  Q56651571: 'temporarily_closed',  // out of service
  Q12377751: 'temporarily_closed',  // under construction — not open yet
  Q811683: 'temporarily_closed',    // proposed building or structure
  Q55570340: 'review',              // closed to the public — a building can be, a garden inside it may not be
  Q55654238: 'open',                // in use
  Q55570821: 'open',                // open to the public
  Q109551035: 'open',               // in partial operation
};

/**
 * Kinds that are a *body*, not a site. "Dissolved" on one of these is the
 * company or the trust ending — the zoo it ran can be under new owners and
 * open — so a closure date on an item that is only an organisation is
 * flagged, never taken as the place shutting.
 */
export const ORGANISATION_KINDS = new Set([
  'Q43229',   // organization
  'Q4830453', // business
  'Q783794',  // company
  'Q6881511', // enterprise
  'Q891723',  // public company
  'Q163740',  // nonprofit organization
  'Q708676',  // charitable organization
  'Q476028',  // association football club
  'Q15911314',// association
  'Q2659904', // government organization
]);

const idOf = (snak) => snak?.datavalue?.value?.id ?? null;
const timeOf = (snak) => snak?.datavalue?.value?.time ?? null;

/** The year (and full date where precise) of a Wikidata time, or null. */
export function wikidataDate(time) {
  const m = /^([+-])(\d{1,4})-(\d{2})-(\d{2})/.exec(String(time ?? ''));
  if (!m || m[1] === '-') return null;
  const [, , y, mo, d] = m;
  return { year: Number(y), iso: `${y.padStart(4, '0')}-${mo === '00' ? '01' : mo}-${d === '00' ? '01' : d}` };
}

/** Statements that still stand: not deprecated, preferred where one is preferred. */
function standing(claims, pid) {
  const all = (claims?.[pid] ?? []).filter((c) => c.rank !== 'deprecated' && c.mainsnak?.snaktype !== 'novalue');
  const preferred = all.filter((c) => c.rank === 'preferred');
  return preferred.length ? preferred : all;
}
/**
 * A statement whose end time has come. A P582 still in the future — a
 * museum announced to close next spring — is current today (Codex, 29 Sep
 * 2026); an end time we cannot read says nothing and leaves it current.
 */
const endedBy = (c, today) => (c.qualifiers?.P582 ?? []).some((q) => {
  const d = wikidataDate(timeOf(q));
  return d != null && d.iso <= today;
});

// ---------------------------------------------------------------------------
// heritage (owner, 29 Sep 2026, after the first dry run)
// ---------------------------------------------------------------------------
//
// "Heritage sites (abbeys, priories, castles, forts, ruins, churches,
// monuments): a Wikidata dissolved/closure date never closes them. Close only
// if a current source says the site can't be visited (e.g. demolished with no
// remains, or OSM/website/Google says permanently closed). Dissolution dates
// stay as history, not status." Selby Abbey, Birkenhead Priory and
// Monkwearmouth–Jarrow were closed on their 1536–39 dissolutions.

/** Kinds (P31) that make a place heritage on their own. Read back from Wikidata, 29 Sep 2026. */
export const HERITAGE_KINDS = new Set([
  'Q160742', 'Q4663971', // abbey
  'Q2750108',            // priory
  'Q44613',              // monastery
  'Q23413', 'Q17715832', // castle, castle ruin
  'Q57821', 'Q57831',    // fortification, fortress
  'Q88205', 'Q744099',   // castrum (Roman fort), hillfort
  'Q109607',             // ruins
  'Q16970', 'Q108325', 'Q2977', 'Q56242215', 'Q1129743', // church building, chapel, cathedral, Catholic cathedral, filial church
  'Q1370598', 'Q24398318', // structure of worship, religious building
  'Q4989906',            // monument
  'Q839954', 'Q1081138', // archaeological site, historic site
  'Q570600',             // listed building
  'Q879050', 'Q1802963', 'Q16560', 'Q2087181', // manor house, mansion, palace, historic house museum
  'Q12518',              // tower
  'Q317557', 'Q5116872', // parish church, Church of England parish church (Selby Abbey is one)
  // Industrial and transport heritage (owner, 29 Sep 2026, after the second
  // dry run: Geevor Tin Mine, Bitton station and Hengoed Viaduct closed on a
  // date that is their history). Read back from Wikidata the same day.
  'Q820477', 'Q819426', 'Q1569871', // mine, mining museum, industrial heritage site
  'Q55488',                        // railway station
  'Q12280', 'Q537127', 'Q1210334', 'Q181348', 'Q1068842', // bridge, road bridge, railway bridge, viaduct, footbridge
  'Q44377', 'Q1311958',            // tunnel, railway tunnel
  'Q12284',                        // canal
  'Q39715',                        // lighthouse
  'Q44494', 'Q185187', 'Q38720',   // mill, watermill, windmill
]);
/** The heritage roots of the atlas's own subclass walk (`place_kinds.root_qid`, sources/wikimedia.js ATTRACTION_ROOTS). */
export const HERITAGE_ROOTS = new Set(['Q23413', 'Q16560', 'Q2087181', 'Q1802963', 'Q839954', 'Q4989906', 'Q38720', 'Q16970', 'Q2977', 'Q44613', 'Q4663971', 'Q15135589']);
/** Our own drawers that are heritage. */
export const HERITAGE_SUBCATEGORIES = new Set([
  'castles', 'churches', 'historic-houses', 'ruins', 'monuments', 'monuments-memorials', 'abbeys', 'cathedrals', 'historic',
  'industrial-heritage', 'world-heritage', 'heritage-railways', 'railway-heritage', 'mining-heritage', 'canals', 'mills',
  'bridges', 'lighthouses',
]);
/** A church, as a building people worship in — a separate question (see `heritageOf`). */
export const CHURCH_KINDS = new Set(['Q317557', 'Q5116872', 'Q16970', 'Q108325', 'Q2977', 'Q56242215', 'Q1129743', 'Q1370598', 'Q24398318']);
/** Monastic houses and ruins: their dissolution is history however they are also filed. */
export const MONASTIC_OR_RUIN = new Set(['Q160742', 'Q4663971', 'Q2750108', 'Q44613', 'Q109607', 'Q17715832', 'Q839954', 'Q744099', 'Q88205']);

/**
 * Whether a place is heritage, and whether it is a church.
 *
 * Heritage from any of: its Wikidata kinds (P31), the root each kind descends
 * from in our subclass walk (P279*), the atlas's own category, our drawer, or
 * a listed-building match. A church is heritage too, but a separate case: an
 * abbey's dissolution in 1539 is history, while a parish church's "date of
 * official closure" can mean it is now somebody's flats — which is not
 * visitable — or a redundant church in the care of a trust — which is. So a
 * church's closure goes to a person unless a current source settles it.
 */
export function heritageOf({ kinds = [], roots = [], category = null, subcategory = null, listed = false } = {}) {
  const k = new Set((kinds ?? []).filter(Boolean));
  const r = new Set((roots ?? []).filter(Boolean));
  // `roots` are the heritage classes each kind descends from (P279*): our own
  // walk's root, or the classes the check looked up.
  const monastic = [...k, ...r].some((q) => MONASTIC_OR_RUIN.has(q));
  const heritage = [...k].some((q) => HERITAGE_KINDS.has(q)) || [...r].some((q) => HERITAGE_ROOTS.has(q) || HERITAGE_KINDS.has(q))
    || category === 'heritage' || HERITAGE_SUBCATEGORIES.has(subcategory) || Boolean(listed);
  const church = !monastic && ([...k, ...r].some((q) => CHURCH_KINDS.has(q)) || subcategory === 'churches');
  return { heritage: heritage || church, church };
}

/** A closure turned into history: kept as evidence, the status left alone. */
const history = (source, reason, evidence, extra = {}) => finding(source, 'unknown', `history: ${reason}`, evidence, { ...extra, history: true });

/**
 * One Wikidata item, as wbgetentities returns it. `today` is an ISO date so a
 * closure announced for next year does not close anything yet. `site` is
 * `heritageOf(…)` for the place: a heritage site's dissolution, closure date
 * or ended kind is history, never status.
 */
export function wikidataVerdict(entity, { today = new Date().toISOString().slice(0, 10), site = null } = {}) {
  const claims = entity?.claims;
  if (!claims) return null;
  const qid = entity.id ?? null;
  const kinds = standing(claims, 'P31');
  const kindIds = kinds.map((c) => idOf(c.mainsnak)).filter(Boolean);
  const successorQid = standing(claims, 'P1366').map((c) => idOf(c.mainsnak)).find(Boolean) ?? null;

  const closures = [];
  for (const [pid, label] of [['P576', 'dissolved, abolished or demolished'], ['P3999', 'date of official closure']]) {
    for (const c of standing(claims, pid)) {
      const d = wikidataDate(timeOf(c.mainsnak));
      if (d && d.iso <= today) closures.push({ pid, label, year: d.year, iso: d.iso });
    }
  }
  // "Every instance ended": each of its kinds carries an end time, so what it
  // was has stopped being. One kind still current means it was *converted* —
  // a mill that is now a museum is open — and says nothing.
  const ended = (c) => endedBy(c, today);
  const everyKindEnded = kinds.length > 0 && kinds.every(ended);
  if (everyKindEnded) {
    const years = kinds.flatMap((c) => (c.qualifiers?.P582 ?? []).map((q) => wikidataDate(timeOf(q))?.year)).filter(Boolean);
    closures.push({ pid: 'P31/P582', label: 'every kind it was has an end time', year: years.length ? Math.max(...years) : null });
  }
  const reopened = standing(claims, 'P1619').map((c) => wikidataDate(timeOf(c.mainsnak))).filter(Boolean);

  const uses = standing(claims, 'P5817').filter((c) => !ended(c)).map((c) => idOf(c.mainsnak)).filter((id) => id in STATE_OF_USE);
  const use = uses.map((id) => ({ id, says: STATE_OF_USE[id] }));
  const useClosed = use.find((u) => CLOSED.has(u.says));
  const useOpen = use.find((u) => u.says === 'open');
  const useReview = use.find((u) => u.says === 'review');

  const at = qid ? `${qid} ` : '';
  const base = { successorQid };
  const heritage = Boolean(site?.heritage);
  const church = Boolean(site?.church);
  if (heritage && (closures.length || useClosed)) {
    const c = closures[0];
    const evidence = c ? `${at}${c.pid} = ${c.year ?? 'set'}` : `${at}P5817 = ${useClosed.id}`;
    // A church closed *as a church* (P3999, or a closed state of use) may be a
    // house now or a trust's to visit: a person decides, unless a current
    // source does.
    if (church && (useClosed || closures.some((x) => x.pid === 'P3999'))) {
      return finding('wikidata', 'unknown', 'closed as a church — visitable?', evidence, { ...base, review: true });
    }
    if (useOpen) return finding('wikidata', 'open', 'state of use: open', `${at}P5817 = ${useOpen.id}; ${evidence}`, base);
    return history('wikidata', c ? (c.year ? `${c.label} ${c.year}` : c.label) : 'state of use', evidence, base);
  }

  if (closures.length) {
    const c = closures[0];
    const evidence = `${at}${c.pid} = ${c.year ?? 'set'}${successorQid ? `; P1366 = ${successorQid}` : ''}`;
    // Reopened after the closure, or said to be in use now: sources inside one
    // item disagree, and a person settles it.
    if (useOpen || reopened.some((r) => c.iso && r.iso > c.iso)) {
      return finding('wikidata', 'unknown', 'closed once, open again since', `${evidence}; ${useOpen ? `P5817 = ${useOpen.id}` : 'P1619 later'}`, { ...base, review: true });
    }
    if (kindIds.length && kindIds.every((k) => ORGANISATION_KINDS.has(k))) {
      return finding('wikidata', 'unknown', 'the organisation ended, not necessarily the place', evidence, { ...base, review: true });
    }
    return finding('wikidata', 'permanently_closed', c.year ? `${c.label} ${c.year}` : c.label, evidence, base);
  }
  if (useClosed) {
    return finding('wikidata', useClosed.says, `state of use: ${useClosed.says === 'permanently_closed' ? 'closed' : 'not open'}`, `${at}P5817 = ${useClosed.id}`, base);
  }
  if (useReview) return finding('wikidata', 'unknown', 'closed to the public', `${at}P5817 = ${useReview.id}`, { ...base, review: true });
  // Replaced by, and nothing else: a renamed place that is still open carries
  // it too, so on its own it names the successor and asks a person.
  if (successorQid) return finding('wikidata', 'unknown', 'replaced by another item', `${at}P1366 = ${successorQid}`, { ...base, review: true });
  if (useOpen) return finding('wikidata', 'open', 'state of use: open', `${at}P5817 = ${useOpen.id}`, base);
  // The item's own one-line description (CC0), last: "former British
  // amusement park" is Camelot, which carries no closure date at all. Defunct,
  // demolished or closed says so; "former" is a hunch — Bodmin Jail is a
  // "former prison" you can visit — and only asks a person.
  const said = String(entity.descriptions?.en?.value ?? entity.descriptions?.en ?? '').trim();
  if (heritage && /^(defunct|demolished|closed|disused|abandoned|former)\b/i.test(said)) {
    // Demolished might mean nothing left; anything else is history.
    return /^demolished\b/i.test(said)
      ? finding('wikidata', 'unknown', 'described as demolished — anything left?', `${at}description: ${said.slice(0, 120)}`, { ...base, review: true })
      : history('wikidata', `described as ${said.split(/\s+/)[0].toLowerCase()}`, `${at}description: ${said.slice(0, 120)}`, base);
  }
  if (/^(defunct|demolished|closed|disused|abandoned)\b/i.test(said)) {
    return finding('wikidata', 'permanently_closed', `described as ${said.split(/\s+/)[0].toLowerCase()}`, `${at}description: ${said.slice(0, 120)}`, base);
  }
  if (/^former\b/i.test(said) && !/\bnow\b/i.test(said)) {
    return finding('wikidata', 'unknown', 'described as former', `${at}description: ${said.slice(0, 120)}`, { ...base, review: true });
  }
  return null;
}

// ---------------------------------------------------------------------------
// OpenStreetMap
// ---------------------------------------------------------------------------

/** The keys that say what a place is *for* now. */
export const MAIN_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'historic', 'craft', 'office', 'club', 'sport', 'attraction', 'healthcare', 'man_made', 'natural', 'waterway', 'landuse', 'boundary', 'railway', 'aeroway', 'place', 'building:use'];
const LIFECYCLE = /^(disused|was|demolished|abandoned|razed|removed|destroyed|dismantled):(.+)$/;
const EMPTY = new Set(['no', 'vacant', 'disused', 'abandoned', 'closed']);

/**
 * Whether an element *is* the place — a building or an attraction — rather
 * than a route, an area or a boundary it sits in. A lifecycle tag on a walking
 * route or a landuse polygon says nothing about the museum inside it (owner,
 * 29 Sep 2026: "Keep disused:/demolished: tags only when the object itself is
 * the building").
 */
const OBJECT_KEYS = ['building', 'amenity', 'shop', 'tourism', 'leisure', 'historic', 'craft', 'office', 'attraction', 'club', 'healthcare', 'man_made'];
const AREA_OR_ROUTE = ['route', 'boundary', 'landuse', 'highway', 'natural', 'place', 'waterway', 'railway', 'aeroway', 'power'];
export function isObjectItself(tags) {
  if (!tags || typeof tags !== 'object') return false;
  if (['route', 'route_master', 'boundary', 'network'].includes(String(tags.type ?? ''))) return false;
  if (AREA_OR_ROUTE.some((k) => tags[k] != null)) return false;
  return Object.keys(tags).some((k) => OBJECT_KEYS.includes(k) || (LIFECYCLE.test(k) && OBJECT_KEYS.includes(k.replace(LIFECYCLE, '$2'))));
}

/**
 * The open map's word. `end_date` is not read at all: the V&A carries
 * `end_date=1862` for something that is not the museum, and a date on an
 * element is too often about something else (owner, 29 Sep 2026: "Drop
 * OpenStreetMap end_date as a closure signal"). `opening_hours=closed` is a
 * question for a person, not a closure.
 */
export function osmVerdict(tags) {
  if (!tags || typeof tags !== 'object') return null;
  const current = MAIN_KEYS.filter((k) => tags[k] && !EMPTY.has(String(tags[k]).toLowerCase()));
  const lifecycle = Object.keys(tags).filter((k) => LIFECYCLE.test(k) && MAIN_KEYS.concat(['building']).includes(k.replace(LIFECYCLE, '$2')));
  const successorName = tags.replaced_by ? String(tags.replaced_by) : null;
  const extra = { successorName };
  const itself = isObjectItself(tags);

  if (itself) {
    for (const flag of ['demolished', 'razed', 'destroyed', 'removed']) {
      if (tags[flag] === 'yes') return finding('osm', 'permanently_closed', flag, `${flag}=yes`, extra);
    }
    const vacant = MAIN_KEYS.find((k) => ['vacant', 'disused', 'closed'].includes(String(tags[k] ?? '').toLowerCase()));
    if (vacant && !current.length) return finding('osm', 'permanently_closed', `${vacant} is ${tags[vacant]}`, `${vacant}=${tags[vacant]}`, extra);
    // disused=yes beside a main tag says *that* use has stopped.
    for (const flag of ['disused', 'abandoned']) {
      if (tags[flag] === 'yes') return finding('osm', 'permanently_closed', flag, `${flag}=yes${current[0] ? ` on ${current[0]}=${tags[current[0]]}` : ''}`, extra);
    }
    // A lifecycle prefix with nothing current: the only use it had has ended.
    // With a current main tag it was *converted* — disused:shop on a building
    // that is now a café is a café — and is open.
    if (lifecycle.length && !current.length) {
      return finding('osm', 'permanently_closed', `${lifecycle[0].split(':')[0]} ${tags[lifecycle[0]]}`, `${lifecycle[0]}=${tags[lifecycle[0]]}`, extra);
    }
  }
  const hours = String(tags.opening_hours ?? '').trim().toLowerCase();
  if (hours === 'closed' || hours === 'off') return finding('osm', 'unknown', 'opening hours say closed', `opening_hours=${tags.opening_hours}`, { ...extra, review: true });
  if (current.length) return finding('osm', 'open', 'mapped as in use', `${current[0]}=${tags[current[0]]}`, extra);
  return successorName ? finding('osm', 'unknown', null, null, extra) : null;
}

// ---------------------------------------------------------------------------
// Wikipedia (and any other owned prose: a listing, a venue's own page)
// ---------------------------------------------------------------------------

const norm = (s) => String(s ?? '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'in', 'on', '&']);
const tokens = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w));

/** The text's sentences, cut on a full stop followed by a capital or the end. */
export function sentences(text) {
  return String(text ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"“(])/).map((s) => s.trim()).filter(Boolean);
}

/** Whether the words before the verb are this place: its name, "it", or "the park". */
const GENERIC_HEADS = 'park|zoo|museum|attraction|centre|center|venue|site|gallery|theatre|theater|cinema|pub|inn|restaurant|garden|gardens|aquarium|farm|railway|pier|pool|lido|rink|club|hotel|shop|store|house|castle|abbey|church|chapel|mill|stadium|ground|circuit|track|arena|hall|building|resort|safari park|theme park|amusement park|leisure centre|visitor centre';
export function subjectIsPlace(subject, name) {
  const s = norm(subject);
  if (!s) return false;
  if (/^(it|this|they)$/.test(s)) return true;
  if (new RegExp(`^the (?:[a-z']+ ){0,2}(?:${GENERIC_HEADS})$`).test(s)) return true;
  const want = tokens(name);
  const got = tokens(subject);
  if (!want.length || !got.length || got.length > want.length + 3) return false;
  const hit = want.filter((w) => got.includes(w)).length;
  return hit / want.length >= 0.6;
}

const YEAR = '(1[5-9]\\d\\d|20\\d\\d)';
const CLOSED_VERB = new RegExp(`^(.{1,80}?)\\s+(?:was |were |has |had |has been |had been )?(?:finally |eventually |later |subsequently )?(?:permanently |officially )?(closed|shut|demolished|razed|pulled down|ceased trading|ceased operating|ceased operations)\\b([^.]*)`, 'i');
const PAST_SUBJECT = /^(.{1,80}?)\s+(?:was|were)\s+(?:a|an|the|one of)\s/i;
const STILL = /\b(?:is|are|remains|remain|still|continues|continue|today|now (?:a|an|the|open|operates|run))\b/i;
const REOPENED = /\b(re-?opened|reopening|was restored and opened|now open|opened again)\b/i;
const SITE_NOW = /\b(?:converted into the site of|(?:has since been |was later |was subsequently )?(?:converted into|converted to|replaced by|redeveloped (?:as|into)|demolished to make way for|became|renamed)|the site (?:is|was) now(?: occupied by| home to| part of)?|now the site of|site (?:is )?now occupied by|site is now|(?:is|was) now)\s+(?:the site of\s+)?(?:the\s+)?([A-Z][\w'’&-]*(?:\s+(?:[A-Z][\w'’&-]*|of|the|and|&|on|upon))*)/;
const UNTIL = new RegExp(`\\buntil\\s+(?:its closure in\\s+|the\\s+)?${YEAR}\\b`, 'i');

/**
 * "the site is now Legoland Windsor", "converted into X", "became X", "now X"
 * → the name X. A lower-case "a museum" is a new use, not a successor.
 */
export function successorFromText(text) {
  const m = SITE_NOW.exec(String(text ?? ''));
  if (!m) return null;
  return m[1].replace(/\s+(?:of|the|and|&|on|upon)$/i, '').replace(/[.,;]+$/, '').trim() || null;
}

/**
 * Past-tense prose, conservatively.
 *
 * Closes only on explicit words about *this* place: "closed in 1992", "closed
 * permanently", "was demolished in", "was a … until 1992", or "X was a …" beside
 * "the site is now Y". "It was a great day" and "Windsor Castle was built…"
 * do not start with the place being something it no longer is, and say
 * nothing. "X was a …" on its own, or "is a former …", is a hunch: flagged for
 * review, never closed. "Formerly a church, now a house" is a place that still
 * stands and says nothing either.
 */
export function wikipediaVerdict({ text, name, categories = [], source = 'wikipedia', site = null } = {}) {
  const cats = (categories ?? []).map(String);
  const all = sentences(text);
  const successorName = successorFromText(text);
  const extra = { successorName };
  const reopened = REOPENED.test(String(text ?? ''));
  if (site?.heritage) return heritageText({ text, name, cats, all, source, extra, church: Boolean(site.church) });

  // The article's own filing. A category about the place itself ceasing —
  // "Defunct tourist attractions", "Demolished buildings", "Zoos
  // disestablished in the 2020s" — can close. One naming a *former use* —
  // "Defunct rugby league venues", "Defunct greyhound racing venues",
  // "Former churches" — cannot: Deepdale and Vicarage Road are stadiums that
  // no longer hold rugby league or greyhounds, and are open (owner, 29 Sep
  // 2026). Those only ask a person.
  const formerUse = cats.find(categoryIsFormerUse);
  const defunct = cats.find((c) => !categoryIsFormerUse(c) && (/^(Defunct|Demolished|Destroyed)\b/i.test(c) || /\b(demolished|closed|disestablished) in (?:the )?\d{4}s?\b/i.test(c) && !/establishments/i.test(c) && !/^\d{4} disestablishments/i.test(c)));
  const disestablished = cats.find((c) => /^\d{4} disestablishments\b/i.test(c));
  const former = formerUse;

  if (all.length) {
    for (const s of all.slice(0, 4)) {
      const m = CLOSED_VERB.exec(s);
      if (!m || !subjectIsPlace(m[1], name)) continue;
      // "closed to the public on Mondays", "closed for the winter": not the end.
      if (/\b(on|for the) (mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|winter|season|refurbishment|renovation|restoration)\b/i.test(m[3])) continue;
      const year = new RegExp(`\\b${YEAR}\\b`).exec(m[3])?.[1] ?? null;
      const evidence = s.slice(0, 280);
      if (reopened) return finding(source, 'unknown', 'closed once, reopened since', evidence, { ...extra, review: true });
      return finding(source, 'permanently_closed', `${m[2].toLowerCase()}${year ? ` ${year}` : ''}`, evidence, extra);
    }
    const first = all[0];
    const past = PAST_SUBJECT.exec(first);
    const pastIsPlace = past && subjectIsPlace(past[1], name) && !STILL.test(first.slice(past[0].length));
    if (pastIsPlace && !reopened) {
      const until = UNTIL.exec(first);
      if (until) return finding(source, 'permanently_closed', `until ${until[1]}`, first.slice(0, 280), extra);
      if (successorName) return finding(source, 'permanently_closed', `now ${successorName}`, first.slice(0, 280), extra);
      if (defunct || disestablished) {
        return finding(source, 'permanently_closed', 'was, and filed as ended', `${first.slice(0, 200)} [${defunct ?? disestablished}]`, extra);
      }
      return finding(source, 'unknown', 'written in the past tense', first.slice(0, 280), { ...extra, review: true });
    }
    const formerly = /^(.{1,80}?)\s+is\s+a\s+former\s/i.exec(first);
    if (formerly && subjectIsPlace(formerly[1], name) && !/,?\s+now\s/i.test(first)) {
      return finding(source, 'unknown', 'a former something', first.slice(0, 280), { ...extra, review: true });
    }
  }
  if (defunct && !reopened) return finding(source, 'permanently_closed', 'filed as ended', `category: ${defunct}`, extra);
  if (former) return finding(source, 'unknown', 'filed under a former use', `category: ${former}`, { ...extra, review: true });
  if (disestablished) return finding(source, 'unknown', 'filed as ended, text does not say', `category: ${disestablished}`, { ...extra, review: true });
  return null;
}

/**
 * A Wikipedia category that names a use the place once had, not the place
 * ceasing: "Defunct … venues / grounds / tracks / circuits", "Former …".
 */
export function categoryIsFormerUse(c) {
  const t = String(c ?? '');
  return /^Former\b/i.test(t) || /^Defunct\b.*\b(venues|grounds|tracks|circuits|stadiums|courses|arenas|rinks)\b/i.test(t);
}

const NO_REMAINS = /\b(?:no (?:visible )?(?:remains?|trace)|nothing (?:now )?(?:remains|survives|is left)|no longer (?:survives|exists|stands)|was (?:completely|entirely) (?:demolished|destroyed)|(?:demolished|destroyed) (?:completely|entirely))\b/i;
const PRIVATE_NOW = /\b(?:converted (?:into|to) (?:\w+ ){0,3}(?:flats|apartments|houses|homes|dwellings|offices|a (?:private )?(?:house|home|residence|dwelling))|now (?:a )?(?:private (?:house|home|residence)|flats|apartments|offices|a house|a home|residential))\b/i;

/**
 * A heritage site's prose (owner, 29 Sep 2026). Closes only on a current
 * signal — "demolished … no remains". A church converted to flats or a house,
 * or one that "closed", is a question for a person. Everything else — "the
 * priory was dissolved in 1536", "X was a Cistercian abbey" — is history.
 */
function heritageText({ text, name, cats, all, source, extra, church }) {
  const t = String(text ?? '');
  const demolished = all.slice(0, 6).find((s) => /\b(?:demolished|destroyed|razed|pulled down)\b/i.test(s));
  if (demolished && NO_REMAINS.test(t)) return finding(source, 'permanently_closed', 'demolished, nothing remains', demolished.slice(0, 280), extra);
  const privateNow = all.find((s) => PRIVATE_NOW.test(s));
  if (privateNow) return finding(source, 'unknown', 'now private — visitable?', privateNow.slice(0, 280), { ...extra, review: true });
  const closedSentence = all.slice(0, 4).find((s) => { const m = CLOSED_VERB.exec(s); return m && subjectIsPlace(m[1], name); });
  if (church && closedSentence && !REOPENED.test(t)) return finding(source, 'unknown', 'closed as a church — visitable?', closedSentence.slice(0, 280), { ...extra, review: true });
  if (cats.some((c) => /^(Demolished|Destroyed)\b/i.test(c))) return finding(source, 'unknown', 'filed as demolished — anything left?', `category: ${cats.find((c) => /^(Demolished|Destroyed)\b/i.test(c))}`, { ...extra, review: true });
  const past = closedSentence ?? all.slice(0, 1).find((s) => { const m = PAST_SUBJECT.exec(s); return m && subjectIsPlace(m[1], name); });
  const filed = cats.find((c) => /^(Defunct|Former)\b|^\d{4} disestablishments\b/i.test(c));
  if (past || filed) return history(source, past ? 'written in the past tense' : 'filed as ended', past ? past.slice(0, 280) : `category: ${filed}`, extra);
  return extra.successorName ? finding(source, 'unknown', null, null, extra) : null;
}

// ---------------------------------------------------------------------------
// Google, in memory
// ---------------------------------------------------------------------------

/**
 * Google's business status, read in memory when details are fetched anyway.
 * The value is theirs and is dropped here: what is kept is our flag and the
 * fact that it came from Google's status — never their text.
 */
export function googleVerdict(businessStatus) {
  switch (String(businessStatus ?? '').toUpperCase()) {
    case 'OPERATIONAL': return finding('google', 'open', 'open by Google\'s status', 'Google business status');
    case 'CLOSED_TEMPORARILY': return finding('google', 'temporarily_closed', 'temporarily closed by Google\'s status', 'Google business status');
    case 'CLOSED_PERMANENTLY': return finding('google', 'permanently_closed', 'permanently closed by Google\'s status', 'Google business status');
    default: return null; // unspecified or absent: cannot speak
  }
}

// ---------------------------------------------------------------------------
// settling the findings into one status
// ---------------------------------------------------------------------------

const AUTHORITY = { person: 0, google: 1, wikidata: 2, osm: 3, listing: 4, wikipedia: 5 };
const byAuthority = (a, b) => (AUTHORITY[a.source] ?? 9) - (AUTHORITY[b.source] ?? 9);

/**
 * One status from several findings.
 *
 *   - a person's word is final;
 *   - Google's live status is today's and outranks every encyclopedia;
 *   - otherwise a closure from any source closes — unless another source says,
 *     positively, that it is in use: then the two go to review;
 *   - a hunch (review) with nothing firmer stays unknown and flagged;
 *   - positive evidence of use is open; nothing at all is unknown.
 */
export function combine(findings) {
  const list = (findings ?? []).filter(Boolean).sort(byAuthority);
  const successorQid = list.map((f) => f.successorQid).find(Boolean) ?? null;
  const successorName = list.map((f) => f.successorName).find(Boolean) ?? null;
  const out = (f, over = {}) => ({
    status: f.status, reason: f.reason, source: f.source, evidence: f.evidence, review: !!f.review,
    successorQid, successorName, ...over,
  });
  if (!list.length) return { status: 'unknown', reason: null, source: null, evidence: null, review: false, successorQid, successorName };
  const person = list.find((f) => f.source === 'person');
  if (person) return out(person);
  const google = list.find((f) => f.source === 'google');
  if (google) return out(google);
  const closed = list.filter((f) => !f.review && CLOSED.has(f.status));
  const open = list.filter((f) => !f.review && f.status === 'open');
  if (closed.length) {
    const against = open.find((o) => !closed.some((c) => c.source === o.source));
    if (against) {
      return out(closed[0], { status: 'unknown', review: true, reason: 'sources disagree', evidence: `${closed[0].source}: ${closed[0].evidence} | ${against.source}: ${against.evidence}` });
    }
    const perm = closed.find((c) => c.status === 'permanently_closed') ?? closed[0];
    return out(perm);
  }
  const hunch = list.find((f) => f.review);
  if (hunch) return out(hunch, { status: 'unknown' });
  if (open.length) return out(open[0]);
  // History only: kept as evidence, status unknown (owner, 29 Sep 2026).
  const past = list.find((f) => f.history);
  if (past) return out(past, { status: 'unknown', history: true });
  const said = list.find((f) => f.reason);
  return said ? out(said, { status: 'unknown' }) : { ...out(list[0], { status: 'unknown' }), reason: null, source: null, evidence: null };
}

// ---------------------------------------------------------------------------
// item 3: confirmed by something current
// ---------------------------------------------------------------------------

/**
 * Something current says it exists: a Google id, an OpenStreetMap match, a
 * website of its own, or a census sighting. The first one found is named.
 * An atlas row known only to Wikidata/Wikipedia has none and is unconfirmed.
 */
/**
 * The OpenStreetMap element Wikidata links the item to: P402 relation, P11693
 * node, P10689 way (ids checked against the live API, 29 Sep 2026). The
 * property travels as `how` so the record says which one confirmed it.
 */
export function wikidataOsmRef(entity) {
  for (const [pid, type] of [['P402', 'relation'], ['P10689', 'way'], ['P11693', 'node']]) {
    const v = standing(entity?.claims, pid).map((c) => c.mainsnak?.datavalue?.value).find((x) => /^\d+$/.test(String(x ?? '')));
    if (v) return { ref: `${type}/${v}`, how: `wikidata_${pid.toLowerCase()}` };
  }
  return null;
}

/** The item's official website (P856), where it has one. */
export function wikidataWebsite(entity) {
  return standing(entity?.claims, 'P856').map((c) => c.mainsnak?.datavalue?.value).find((x) => /^https?:\/\//i.test(String(x ?? ''))) ?? null;
}

export function confirmation({ ref = null, googleId = false, osmRef = null, website = null, censused = false } = {}) {
  const head = String(ref ?? '').split(':')[0];
  if (googleId || head === 'google') return { confirmed: true, by: 'google' };
  if (osmRef || head === 'osm') return { confirmed: true, by: 'osm' };
  if (website && /^https?:\/\//i.test(String(website))) return { confirmed: true, by: 'website' };
  if (censused) return { confirmed: true, by: 'census' };
  return { confirmed: false, by: null };
}
