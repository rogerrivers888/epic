/**
 * The correctness bench — is what we kept the same as what a rented source
 * says right now?
 *
 * Pure: these take our value and theirs for one master field and answer
 * `agree`, `differ` or `unknown`, with a note the owner can read. `unknown` is
 * an honest third answer, not a failure: two opening-hours strings written in
 * different grammars cannot be judged by a rule, and the screen shows both so
 * the owner can. Nothing here fetches, stores or knows which provider it is
 * talking to.
 */

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const DULL = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'in', 'on', 'restaurant', 'cafe', 'bar', 'pub', 'inn', 'hotel', 'ltd', 'limited']);
const tokens = (s) => fold(s).split(' ').filter((t) => t && !DULL.has(t));
const overlap = (a, b) => {
  const A = new Set(a); const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n += 1;
  return n / Math.min(A.size, B.size);
};
const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^44/, '0').replace(/^0+/, '');
const host = (u) => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return fold(u); } };
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
export const postcodeOf = (s) => { const m = String(s ?? '').match(POSTCODE); return m ? `${m[1]} ${m[2]}`.toUpperCase() : null; };

function metres(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000; const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const missing = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

/** Say a value the way the table prints it. */
export function say(v) {
  if (missing(v)) return null;
  if (typeof v === 'object' && !Array.isArray(v)) {
    if ('lat' in v) return `${Number(v.lat).toFixed(5)}, ${Number(v.lng).toFixed(5)}`;
    return JSON.stringify(v);
  }
  return Array.isArray(v) ? v.join('; ') : String(v);
}

/** The rules, one per master field a rented source can be asked about. */
const RULES = {
  name: (ours, theirs) => {
    const o = tokens(ours); const t = tokens(theirs);
    if (fold(ours) === fold(theirs)) return ['agree', 'same name'];
    const r = overlap(o, t);
    if (r >= 0.6) return ['agree', 'same name, worded differently'];
    return ['differ', 'the names do not match'];
  },
  address: (ours, theirs) => {
    const po = postcodeOf(ours); const pt = postcodeOf(theirs);
    if (po && pt) return po === pt ? ['agree', 'same postcode'] : ['differ', `postcodes differ (${po} vs ${pt})`];
    const r = overlap(tokens(ours), tokens(theirs));
    if (r >= 0.67) return ['agree', 'the addresses share their words'];
    return ['unknown', 'no postcode on both sides to compare'];
  },
  postcode: (ours, theirs) => {
    const po = postcodeOf(ours) ?? fold(ours).toUpperCase(); const pt = postcodeOf(theirs);
    if (!pt) return ['unknown', 'theirs carries no postcode'];
    return po === pt ? ['agree', 'same postcode'] : ['differ', `${po} vs ${pt}`];
  },
  phone: (ours, theirs) => (digits(ours) === digits(theirs) ? ['agree', 'same number'] : ['differ', 'different numbers']),
  website: (ours, theirs) => (host(ours) === host(theirs) ? ['agree', 'same site'] : ['differ', `${host(ours)} vs ${host(theirs)}`]),
  lat_lng: (ours, theirs) => {
    const m = metres(ours, theirs);
    if (m == null) return ['unknown', 'no coordinates on both sides'];
    if (m <= 75) return ['agree', `${m} m apart`];
    if (m <= 250) return ['unknown', `${m} m apart — the same street, possibly a different door`];
    return ['differ', `${m} m apart`];
  },
  hours_regular: (ours, theirs) => {
    // Two grammars: OSM's "Mo-Fr 09:00-17:00" and Google's weekday sentences.
    // A rule can only tell "both say closed on a day" apart; the rest is the
    // owner's to read. So: agree if the days named as closed match, else unknown.
    const closedOurs = new Set([...fold(ours).matchAll(/\b(mo|tu|we|th|fr|sa|su)\b[^;]*?\boff\b/g)].map((m) => m[1]));
    const closedTheirs = new Set((Array.isArray(theirs) ? theirs : [theirs]).map((l) => fold(l)).filter((l) => /closed/.test(l)).map((l) => l.slice(0, 2)));
    if (!closedOurs.size && !closedTheirs.size) return ['unknown', 'both open every day; the hours themselves are for you to compare'];
    const same = closedOurs.size === closedTheirs.size && [...closedOurs].every((d) => closedTheirs.has(d));
    return same ? ['unknown', 'the same days closed; the hours themselves are for you to compare'] : ['differ', 'they disagree on which days it is closed'];
  },
  category: (ours, theirs) => {
    const o = fold(ours); const t = fold(theirs);
    if (!o || !t) return ['unknown', 'no category on one side'];
    if (o === t || o.includes(t) || t.includes(o)) return ['agree', 'same kind of place'];
    return ['unknown', `"${ours}" vs "${theirs}" — different vocabularies`];
  },
  price_range: (ours, theirs) => {
    const pounds = (String(ours).match(/£/g) || []).length;
    const level = Number(theirs);
    if (!pounds || !level) return ['unknown', 'one side has no price band'];
    return Math.abs(pounds - level) <= 1 ? ['agree', 'within a band of each other'] : ['differ', `${'£'.repeat(pounds)} vs level ${level}`];
  },
};

/** The master fields a bench can judge, for the form to offer. */
export const BENCHABLE = Object.keys(RULES);

/**
 * Compare one field. Returns { verdict, note } where verdict is 'agree' |
 * 'differ' | 'unknown' | 'theirs_missing' | 'ours_missing'.
 */
export function judge(field, ours, theirs) {
  if (missing(ours) && missing(theirs)) return { verdict: 'unknown', note: 'neither side has it' };
  if (missing(ours)) return { verdict: 'ours_missing', note: 'we do not hold this; they do' };
  if (missing(theirs)) return { verdict: 'theirs_missing', note: 'we hold this; they do not' };
  const rule = RULES[field];
  if (!rule) return { verdict: 'unknown', note: 'no rule for this field' };
  const [verdict, note] = rule(ours, theirs);
  return { verdict, note };
}

/** Totals for a set of judged rows. */
export function tally(rows) {
  const t = { compared: 0, agreed: 0, differed: 0, unknown: 0, oursMissing: 0, theirsMissing: 0 };
  for (const r of rows) {
    if (r.verdict === 'ours_missing') { t.oursMissing += 1; continue; }
    if (r.verdict === 'theirs_missing') { t.theirsMissing += 1; continue; }
    t.compared += 1;
    if (r.verdict === 'agree') t.agreed += 1;
    else if (r.verdict === 'differ') t.differed += 1;
    else t.unknown += 1;
  }
  return t;
}
