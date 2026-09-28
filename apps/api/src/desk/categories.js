/**
 * Categories: the subcategory list, the bulk bar, and each subcategory's page
 * (handover 4.1, 4.8, 6.2; design README "Categories").
 *
 * Counts come from SQL, not from reading the whole place index into memory,
 * and a place counts once in a subcategory however many words file it there.
 */

import { query, withTransaction } from '../db.js';
import { logChange } from './changes.js';
import { settings } from './settings.js';
import { describe, SOURCE_WORD } from './places.js';
import { countOf } from './location.js';
import { forget as forgetAttributes } from '../repositories/placeAttributes.js';

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const missing = (message) => Object.assign(new Error(message), { status: 404, code: 'not_found' });

/** The ten standard facts, in the order every screen lists them (handover 3). */
export const STANDARD = ['indoor', 'step-free', 'parking', 'toilets', 'booking-required', 'food-on-site', 'dog-friendly', 'suits-ages', 'duration', 'cost-band'];

/** The standard facts as the screens name them (README v2); the stored labels stay as they are. */
export const FACT_WORD = {
  indoor: 'Indoors', 'step-free': 'Step free', parking: 'Parking', toilets: 'Toilets', 'food-on-site': 'Food on site',
  'booking-required': 'Booking required', 'dog-friendly': 'Dog friendly', 'suits-ages': 'Who is it for', duration: 'Duration', 'cost-band': 'Cost band',
};
export const factWord = (key, label) => FACT_WORD[key] ?? label ?? key;

/** Stored cost-band options, and the words the screens use for them. */
export const COST_WORD = { free: 'Free', cheap: 'Cheap', moderate: 'Mid', expensive: 'Dear' };
export const COST_KEY = { Free: 'free', Cheap: 'cheap', Mid: 'moderate', Dear: 'expensive' };

/**
 * A subcategory's own synonyms for the list's search (the prototype's
 * SEARCH_TERMS): "swim" finds the pools and lidos, "relax" the spas.
 */
export const SEARCH_TERMS = {
  pools: 'water swim leisure', lidos: 'water swim outdoor', water: 'water river lake', coast: 'water sea coast beach', spas: 'relax',
};

/**
 * Every place filed in a subcategory, primary or secondary, once each.
 *
 * Primary is `place_index.subcategory`. Secondary is a Google word on the place
 * pointing at another drawer as a non-primary target (migration 266). Only
 * places in Epic count: a place the fence took out is in no subcategory.
 */
export const FILED_SQL = `
  select pi.venue_ref, pi.subcategory as sub, true as is_primary
    from place_index pi
   where pi.subcategory is not null and pi.not_in_epic_at is null
  union
  select pil.venue_ref, t.subcategory_key as sub, false as is_primary
    from place_index_labels pil
    join word_targets t on t.namespace = 'google' and 'google:' || t.word = pil.label and not t.is_primary
    join place_index pi on pi.venue_ref = pil.venue_ref
   where pi.subcategory is not null and pi.not_in_epic_at is null and pi.subcategory <> t.subcategory_key`;

/**
 * Places that have a fact: a person's correction saying yes, or our sources'
 * verified yes that is not hidden and that no person has contradicted.
 */
export const HAS_SQL = `
  select venue_ref, attribute_key from place_attribute_values
   where set_by is not null and (yesno is true or from_value is not null or choice is not null)
  union
  select venue_ref, attribute_key from place_fact_answers
   where state = 'yes' and hidden_at is null
     and not exists (select 1 from place_attribute_values v
                      where v.venue_ref = place_fact_answers.venue_ref and v.attribute_key = place_fact_answers.attribute_key
                        and v.set_by is not null and v.yesno is false)
     -- a person's Don't know: nobody can tell, so our sources' yes is not shown
     and not exists (select 1 from fact_unknowns u
                      where u.venue_ref = place_fact_answers.venue_ref and u.attribute_key = place_fact_answers.attribute_key)`;

/**
 * A fact is Active in a subcategory only when it is confirmed at `addPlaces`
 * places there (README "Statuses"): fewer is Gathering evidence, whatever
 * the stored status says.
 */
export const effective = (status, n, needed, includeAnyway = false) =>
  // A person's "Include anyway" (C41) keeps a fact Active whatever its count
  // (Codex, 28 Sep 2026): that is exactly what the person decided.
  (status === 'active' && !includeAnyway && (n ?? 0) < needed ? 'gathering' : status);

/**
 * Every fact a subcategory looks for (or once looked for), with the places
 * confirmed to have it there and its status as the screens must show it.
 */
export async function factsWithCounts({ sub = null, fact = null, standard = false } = {}) {
  const needed = (await settings()).values.addPlaces ?? 2;
  const { rows } = await query(
    `with f as (select distinct x.venue_ref, x.sub from (${FILED_SQL}) x where ($1::text is null or x.sub = $1)),
          h as (select * from (${HAS_SQL}) z where ($2::text is null or z.attribute_key = $2)),
          c as (select f.sub, h.attribute_key, count(distinct h.venue_ref)::int n from h join f on f.venue_ref = h.venue_ref group by 1, 2)
     select sf.*, a.label, a.standard, s.label as sub_label, s.category_key, sc.label as category_label, coalesce(c.n, 0)::int as places_with
       from subcategory_facts sf
       join place_attributes a on a.key = sf.attribute_key and a.active
       join shelf_subcategories s on s.key = sf.subcategory_key and s.active
       join shelf_categories sc on sc.key = s.category_key
       left join c on c.sub = sf.subcategory_key and c.attribute_key = sf.attribute_key
      where ($1::text is null or sf.subcategory_key = $1) and ($2::text is null or sf.attribute_key = $2)
        and ($3::boolean or not a.standard)`,
    [sub, fact, standard]);
  const month = 30 * 86400_000;
  return rows.map((r) => {
    const status = effective(r.status, r.places_with, needed, r.include_anyway);
    const demoted = r.status === 'active' && status !== 'active';
    return {
      ...r,
      stored: r.status,
      status,
      demoted,
      // Confirmed so far: our own count where the machine had it Active, its
      // counter while it is still gathering.
      confirmed: demoted ? r.places_with : r.verified_places,
      isNew: status === 'active' && Boolean(r.active_since) && Date.now() - new Date(r.active_since).getTime() < month,
      needed,
    };
  });
}

/** Place counts per subcategory, whole estate or within a set of refs. */
async function placeCounts(refs = null) {
  const args = [];
  let where = '';
  if (refs) { args.push([...refs]); where = 'where f.venue_ref = any($1)'; }
  const { rows } = await query(
    `select f.sub, count(distinct f.venue_ref)::int n from (${FILED_SQL}) f ${where} group by f.sub`, args);
  return new Map(rows.map((r) => [r.sub, r.n]));
}

/** Distinct places across the whole estate or the ring (a place counts once). */
async function distinctPlaces(refs = null) {
  const args = [];
  let where = '';
  if (refs) { args.push([...refs]); where = 'where f.venue_ref = any($1)'; }
  const { rows: [r] } = await query(`select count(distinct f.venue_ref)::int n from (${FILED_SQL}) f ${where}`, args);
  return r.n;
}

/**
 * Related subcategories (A14): derived from places filed in both, plus links
 * a person added. Derived pairs need at least two shared places, so one
 * oddly-filed place does not relate two drawers.
 */
async function relatedPairs() {
  const [{ rows: derived }, { rows: linked }] = await Promise.all([
    query(`with f as (${FILED_SQL})
           select a.sub as a, b.sub as b, count(*)::int n
             from f a join f b on a.venue_ref = b.venue_ref and a.sub < b.sub
            group by 1, 2 having count(*) >= 2`),
    query('select a, b, added_by, added_at from subcategory_links'),
  ]);
  const out = new Map();
  const add = (x, y, why) => {
    const list = out.get(x) ?? [];
    if (!list.some((r) => r.key === y)) list.push({ key: y, why });
    out.set(x, list);
  };
  for (const r of linked) { add(r.a, r.b, 'linked'); add(r.b, r.a, 'linked'); }
  for (const r of derived) { add(r.a, r.b, 'shared'); add(r.b, r.a, 'shared'); }
  return out;
}

/** Live and new facts per subcategory, as the screens count them (standard facts are not counted here). */
async function factCounts() {
  const out = new Map();
  for (const f of await factsWithCounts()) {
    const r = out.get(f.subcategory_key) ?? { live: 0, fresh: 0 };
    if (f.status === 'active') r.live += 1;
    if (f.isNew) r.fresh += 1;
    out.set(f.subcategory_key, r);
  }
  return out;
}

/** Does a subcategory's name, category or synonyms match what was typed? */
export const matches = (needle, s) => !needle
  || s.label.toLowerCase().includes(needle)
  || String(s.category_label ?? s.categoryLabel ?? '').toLowerCase().includes(needle)
  || String(SEARCH_TERMS[s.key] ?? '').includes(needle);

/**
 * The subcategory list. `loc` is a resolved location filter (location.js) or
 * null for the whole estate. The header's PLACES stays the estate's total
 * (the prototype); the column shows what is within reach.
 */
export async function subcategoryList({ cat = null, q = null, loc = null } = {}) {
  const refs = loc && !loc.unknown ? loc.refs : null;
  const [{ rows: subs }, counts, facts, related, total, within, flagged] = await Promise.all([
    query(`select s.key, s.label, s.category_key, c.label as category_label
             from shelf_subcategories s join shelf_categories c on c.key = s.category_key
            where s.active and c.active order by c.position, s.position, s.label`),
    placeCounts(refs),
    factCounts(),
    relatedPairs(),
    distinctPlaces(null),
    refs ? distinctPlaces(refs) : Promise.resolve(null),
    contradictedDefaults(),
  ]);
  const labelOf = new Map(subs.map((s) => [s.key, s.label]));
  const flags = new Map();
  for (const f of flagged) flags.set(f.sub, (flags.get(f.sub) ?? 0) + 1);
  const needle = q ? String(q).trim().toLowerCase() : null;
  // Within reach, a count may be a floor ("at least") or unable to speak at
  // all (location.js): null is drawn "—", never a 0 that means "not covered".
  const reach = (n, key, category) => {
    if (!refs) return { n, atLeast: false, speaks: true };
    const a = countOf(n, loc, { category: key });
    const b = countOf(n, loc, { category });
    return { n: a.n, atLeast: a.atLeast || b.atLeast, speaks: a.speaks };
  };
  const rows = subs
    .filter((s) => !cat || s.category_key === cat)
    .filter((s) => matches(needle, s))
    .map((s) => ({
      key: s.key,
      label: s.label,
      category: s.category_key,
      categoryLabel: s.category_label,
      ...(() => { const r = reach(counts.get(s.key) ?? 0, s.key, s.category_key); return { places: r.n, atLeast: r.atLeast, speaks: r.speaks }; })(),
      facts: facts.get(s.key)?.live ?? 0,
      // Person-set defaults most of its confirmed places contradict (C49):
      // `?sort=review` puts these first.
      contradicted: flags.get(s.key) ?? 0,
      terms: SEARCH_TERMS[s.key] ?? null,
      related: (related.get(s.key) ?? []).filter((r) => labelOf.has(r.key)).map((r) => ({ key: r.key, label: labelOf.get(r.key), why: r.why })),
    }));
  // The bulk bar's facts and their value pills, from the same vocabularies a
  // subcategory page's Change offers (README "Value vocabularies").
  const cfg = (await settings()).values;
  const { rows: attrs } = await query('select key, label, kind, options from place_attributes where key = any($1) and active', [STANDARD]);
  const attrOf = new Map(attrs.map((a) => [a.key, a]));
  const defaultFacts = STANDARD.filter((k) => attrOf.has(k)).map((k) => ({
    key: k, label: factWord(k, attrOf.get(k).label), options: optionsOf(attrOf.get(k), cfg).map(({ key, label }) => ({ key, label })),
  }));
  const factsTotal = [...facts.values()].reduce((n, f) => n + f.live, 0);
  const newFacts = [...facts.values()].reduce((n, f) => n + f.fresh, 0);
  return {
    counts: { subcategories: subs.length, places: total, within: refs ? countOf(within, loc).n : null, facts: factsTotal, newFacts },
    rows,
    defaultFacts,
    atLeast: refs ? countOf(within, loc).atLeast : false,
  };
}

// ---------------------------------------------------------------------------
// Values: what a default or an answer says, in the screens' vocabularies.

/** A stored value, in the words a screen shows (bands from settings). */
export function wordOf(attr, v, cfg) {
  if (!v) return null;
  if (attr.kind === 'yesno') return v.yesno == null ? null : (v.yesno ? 'Yes' : 'No');
  if (attr.key === 'cost-band') return COST_WORD[v.choice] ?? v.choice ?? null;
  if (attr.key === 'suits-ages') {
    if (v.from == null && v.to == null) return null;
    if ((v.from ?? 0) <= 0 && (v.to ?? 99) >= 99) return 'All ages';
    const bands = (cfg.ageBands ?? []).filter((b) => b.from <= (v.to ?? 99) && b.to >= (v.from ?? 0));
    return bands.length ? bands.map((b) => b.label).join(' · ') : `${v.from ?? 0}–${v.to ?? 99}`;
  }
  if (attr.key === 'duration') {
    const mid = v.to ?? v.from;
    if (mid == null) return null;
    const band = (cfg.durationBands ?? []).find((b) => mid >= b.from && mid <= b.to);
    return band?.label ?? `${mid} min`;
  }
  if (attr.kind === 'oneof') return v.choice ?? null;
  if (attr.kind === 'range') return `${v.from ?? ''}–${v.to ?? ''}`;
  return null;
}

/** The age bands a stored range covers (every band for All ages). */
function ageBandsOf(v, cfg) {
  if (!v || (v.from == null && v.to == null)) return null;
  return new Set((cfg.ageBands ?? []).filter((b) => b.from <= (v.to ?? 99) && b.to >= (v.from ?? 0)).map((b) => b.key));
}

/**
 * Does a place's confirmed value agree with a default? Both are mapped into
 * the screens' bands first (README "Stored place values must be mapped into
 * these bands before comparing"): 45 minutes and 50 minutes are both "Under
 * 1 hour". For ages, a default agrees with a place that suits every band the
 * default names — a place for 2–12 agrees with "Young children 5–8".
 */
export function agrees(attr, place, def, cfg) {
  if (attr.key === 'suits-ages') {
    const p = ageBandsOf(place, cfg); const d = ageBandsOf(def, cfg);
    if (!p || !d) return false;
    return [...d].every((k) => p.has(k));
  }
  const a = wordOf(attr, place, cfg); const b = wordOf(attr, def, cfg);
  return a != null && a === b;
}

/** The pills a default offers for a fact (README "Value vocabularies"). */
export function optionsOf(attr, cfg) {
  if (attr.kind === 'yesno') return [{ key: 'yes', label: 'Yes', value: { yesno: true } }, { key: 'no', label: 'No', value: { yesno: false } }];
  if (attr.key === 'cost-band') return Object.entries(COST_WORD).map(([k, w]) => ({ key: k, label: w, value: { choice: k } }));
  if (attr.key === 'suits-ages') {
    return [
      ...(cfg.ageBands ?? []).map((b) => ({ key: b.key, label: b.label, value: { from: b.from, to: b.to } })),
      { key: 'all', label: 'All ages', value: { from: 0, to: 99 } },
    ];
  }
  if (attr.key === 'duration') return (cfg.durationBands ?? []).map((b) => ({ key: b.key, label: b.label, value: { from: b.from, to: b.to } }));
  if (attr.kind === 'oneof') return (attr.options ?? []).map((o) => ({ key: o, label: o, value: { choice: o } }));
  return [];
}

/**
 * The pills a place's own answer offers (the drill-down's Edit): a default's
 * values, and for yes/no and cost "Don't know" as well (the prototype's
 * stdValues) — a person saying nobody can tell.
 */
export const DONT_KNOW = { key: 'dont_know', label: 'Don’t know', value: null };
export function answerOptionsOf(attr, cfg) {
  const base = optionsOf(attr, cfg);
  return attr.kind === 'yesno' || attr.key === 'cost-band' ? [...base, DONT_KNOW] : base;
}

const valueOfRow = (r) => (r ? { yesno: r.yesno, from: r.from_value, to: r.to_value, choice: r.choice } : null);

/**
 * Confirmed values of standard facts at the places filed in subcategories:
 * a place's own answer (a person's correction first, then our sources'
 * verified answer). A default is not a confirmation; it is what is being
 * checked. With `sub`, every standard fact there; without, the facts that
 * carry a person-set default anywhere. Keyed `sub|fact`.
 */
async function confirmedValues({ sub = null } = {}) {
  const d = sub
    ? 'select $2::text as sub, unnest($1::text[]) as fact'
    : `select subcategory_key as sub, attribute_key as fact from shelf_subcategory_attributes
        where attribute_key = any($1) and (origin = 'person' or settled)`;
  const { rows } = await query(
    `with d as (${d}),
          f as (select distinct x.venue_ref, x.sub from (${FILED_SQL}) x where x.sub in (select sub from d))
     select d.sub, d.fact, f.venue_ref,
            v.set_by, v.yesno as p_yesno, v.from_value as p_from, v.to_value as p_to, v.choice as p_choice,
            a.state, a.source, a.yesno as a_yesno, a.from_value as a_from, a.to_value as a_to, a.choice as a_choice
       from d join f on f.sub = d.sub
       left join place_attribute_values v on v.venue_ref = f.venue_ref and v.attribute_key = d.fact and v.set_by is not null
       left join place_fact_answers a on a.venue_ref = f.venue_ref and a.attribute_key = d.fact
            and a.state in ('yes', 'no') and a.hidden_at is null and not exists (select 1 from fact_unknowns u where u.venue_ref = a.venue_ref and u.attribute_key = a.attribute_key)
      where v.set_by is not null or a.state is not null`,
    sub ? [STANDARD, sub] : [STANDARD]);
  const out = new Map();
  for (const r of rows) {
    const k = `${r.sub}|${r.fact}`;
    const value = r.set_by
      ? { yesno: r.p_yesno, from: r.p_from, to: r.p_to, choice: r.p_choice }
      : r.state === 'no' && r.a_yesno == null ? { yesno: false } : { yesno: r.a_yesno, from: r.a_from, to: r.a_to, choice: r.a_choice };
    const list = out.get(k) ?? [];
    list.push({ ref: r.venue_ref, value, person: Boolean(r.set_by), source: r.set_by ? 'person' : r.source });
    out.set(k, list);
  }
  return out;
}

/** The C49 rule: at least three confirmed, more than half disagree. */
const isContradicted = (confirmed, agree) => confirmed >= 3 && (confirmed - agree) * 2 > confirmed;

/**
 * Person-set defaults most of their confirmed places contradict (C49), with
 * values compared in bands. Overview's NEEDS YOU and the list's
 * `?sort=review` read this.
 */
export async function contradictedDefaults() {
  const cfg = (await settings()).values;
  const [{ rows: defs }, { rows: attrs }, confirmed] = await Promise.all([
    query(`select * from shelf_subcategory_attributes where attribute_key = any($1) and (origin = 'person' or settled)`, [STANDARD]),
    query('select key, label, kind, options from place_attributes where key = any($1)', [STANDARD]),
    confirmedValues(),
  ]);
  const attrOf = new Map(attrs.map((a) => [a.key, a]));
  const out = [];
  for (const d of defs) {
    const attr = attrOf.get(d.attribute_key);
    if (!attr) continue;
    const list = confirmed.get(`${d.subcategory_key}|${d.attribute_key}`) ?? [];
    const agree = list.filter((c) => agrees(attr, c.value, valueOfRow(d), cfg)).length;
    if (isContradicted(list.length, agree)) out.push({ sub: d.subcategory_key, fact: d.attribute_key, confirmed: list.length, disagree: list.length - agree });
  }
  return out;
}

/**
 * One subcategory's page: its defaults, its facts, and the places filed here
 * as a secondary.
 */
export async function subcategoryPage(key) {
  const cfg = (await settings()).values;
  const [{ rows: [sub] }, { rows: attrs }, { rows: defaults }, facts, { rows: secondary }, { rows: secondList }, related, confirmed, everyFact] = await Promise.all([
    query(`select s.key, s.label, s.category_key, c.label as category_label, s.active
             from shelf_subcategories s join shelf_categories c on c.key = s.category_key where s.key = $1`, [key]),
    query(`select key, label, kind, options, standard, access, age from place_attributes where active`),
    query(`select * from shelf_subcategory_attributes where subcategory_key = $1`, [key]),
    factsWithCounts({ sub: key }),
    query(`select count(distinct f.venue_ref)::int n,
                  count(distinct f.venue_ref) filter (where not f.is_primary)::int secondary
             from (${FILED_SQL}) f where f.sub = $1`, [key]),
    // The places filed here as a second subcategory, named with their primary
    // (the prototype: "· Dinton Pastures (primary: Lakes & rivers)").
    query(`select distinct f.venue_ref, s.label as primary_label
             from (${FILED_SQL}) f join place_index pi on pi.venue_ref = f.venue_ref
             join shelf_subcategories s on s.key = pi.subcategory
            where f.sub = $1 and not f.is_primary
            order by s.label, f.venue_ref limit 60`, [key]),
    relatedPairs(),
    confirmedValues({ sub: key }),
    factsWithCounts(),
  ]);
  if (!sub) throw missing(`${key} is not one of our subcategories.`);
  const byKey = new Map(attrs.map((a) => [a.key, a]));
  const defaultBy = new Map(defaults.map((d) => [d.attribute_key, d]));

  const defaultRows = [];
  for (const k of STANDARD) {
    const attr = byKey.get(k);
    if (!attr) continue;
    const d = defaultBy.get(k);
    const value = valueOfRow(d);
    const list = d ? confirmed.get(`${key}|${k}`) ?? [] : [];
    const agree = list.filter((c) => agrees(attr, c.value, value, cfg)).length;
    const person = d?.origin === 'person' || (d && d.settled);
    const said = d ? wordOf(attr, value, cfg) : null;
    // Amber (C49): a person-set default most confirmed places contradict — at
    // least three confirmed, more than half of them disagree, in bands.
    const contradicted = Boolean(person && isContradicted(list.length, agree));
    const places = (m) => `${m} ${m === 1 ? 'place' : 'places'}`;
    defaultRows.push({
      fact: k,
      label: factWord(k, attr.label),
      value: said,
      setBy: !d ? null : person ? (d.set_by ?? 'A person') : 'Machine',
      setAt: d ? (d.set_at ?? d.updated_at) : null,
      origin: !d ? null : person ? 'person' : 'machine',
      basis: !d || said == null ? 'The places disagree, so each answers for itself'
        : person ? (list.length ? `${agree} of ${list.length} confirmed places agree` : 'No confirmed places yet')
          : list.length ? `Proposed from ${places(list.length)} · private until accepted`
            : 'No confirmed places yet · private until accepted',
      contradicted,
      contradiction: contradicted ? `${list.length - agree} of ${list.length} confirmed places say otherwise` : null,
      options: optionsOf(attr, cfg),
    });
  }

  const factRows = facts.map((f) => ({
    fact: f.attribute_key,
    label: f.label,
    status: f.status,
    demoted: f.demoted,
    reason: f.reason,
    isNew: f.isNew,
    placesWith: f.places_with,
    verifiedPlaces: f.confirmed,
    firstSeen: f.first_seen,
    removedBy: f.removed_by,
  })).sort((a, b) => a.label.localeCompare(b.label));

  // Copy facts from another subcategory: the others with Active facts, and how many.
  const liveBy = new Map();
  for (const f of everyFact) {
    if (f.status !== 'active' || f.subcategory_key === key) continue;
    const r = liveBy.get(f.subcategory_key) ?? { key: f.subcategory_key, label: f.sub_label, n: 0 };
    r.n += 1;
    liveBy.set(f.subcategory_key, r);
  }

  const named = await describe(secondList.map((r) => r.venue_ref));
  const { rows: labels } = await query('select key, label from shelf_subcategories where active');
  const labelOf = new Map(labels.map((l) => [l.key, l.label]));
  return {
    key: sub.key,
    label: sub.label,
    category: sub.category_key,
    categoryLabel: sub.category_label,
    defaults: defaultRows,
    facts: factRows,
    places: secondary[0]?.n ?? 0,
    secondaryPlaces: secondary[0]?.secondary ?? 0,
    // Only places we may name (owned records and the atlas); the rest are counted.
    secondaryList: secondList.map((r) => ({ ref: r.venue_ref, name: named.get(r.venue_ref)?.name ?? null, primary: r.primary_label }))
      .filter((r) => r.name).slice(0, 12),
    // Header counts: facts looked for here, and those that became Active in
    // the last 30 days (the prototype's LOOKING FOR and NEW · 30 DAYS) — both
    // as the statuses read, so a fact confirmed at one place is not counted.
    live: factRows.filter((f) => f.status === 'active').length,
    fresh: factRows.filter((f) => f.isNew).length,
    // A fact is Active at this many confirmed places (the `addPlaces` setting):
    // "Confirmed at 1 of 2 places needed".
    needed: cfg.addPlaces ?? null,
    related: (related.get(key) ?? []).filter((r) => labelOf.has(r.key)).map((r) => ({ key: r.key, label: labelOf.get(r.key), why: r.why })),
    copyFrom: [...liveBy.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/**
 * Review on a flagged default (README: "Review opens the inspect view"): the
 * places here with a confirmed answer for the fact, each answer beside the
 * default, the ones that disagree first.
 */
export async function reviewDefault({ sub, fact }) {
  const cfg = (await settings()).values;
  const [{ rows: [s] }, { rows: [attr] }, { rows: [d] }, confirmed] = await Promise.all([
    query(`select s.key, s.label, c.label as category_label from shelf_subcategories s join shelf_categories c on c.key = s.category_key where s.key = $1`, [sub]),
    query('select key, label, kind, options from place_attributes where key = $1', [fact]),
    query('select * from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2', [sub, fact]),
    confirmedValues({ sub }),
  ]);
  if (!s) throw missing(`${sub} is not one of our subcategories.`);
  if (!attr || !STANDARD.includes(fact)) throw missing(`${fact} is not one of our standard facts.`);
  const def = valueOfRow(d);
  const list = confirmed.get(`${sub}|${fact}`) ?? [];
  const named = await describe(list.map((c) => c.ref));
  const rows = list.map((c) => {
    const p = named.get(c.ref) ?? {};
    return {
      ref: c.ref,
      name: p.name ?? null,
      area: p.area ?? null,
      answer: wordOf(attr, c.value, cfg),
      agrees: d ? agrees(attr, c.value, def, cfg) : null,
      how: c.person ? SOURCE_WORD.person : SOURCE_WORD[c.source] ?? null,
    };
  }).sort((a, b) => Number(a.agrees) - Number(b.agrees) || String(a.name ?? '~').localeCompare(String(b.name ?? '~')));
  const agree = rows.filter((r) => r.agrees).length;
  return {
    sub, subLabel: s.label, categoryLabel: s.category_label,
    fact, label: factWord(fact, attr.label),
    value: d ? wordOf(attr, def, cfg) : null,
    confirmed: rows.length,
    agree,
    disagree: rows.length - agree,
    rows,
  };
}

/**
 * New facts (the header's NEW FACTS drill): every fact the machine made Active
 * in a subcategory in the last 30 days — and still Active by the screens'
 * rule — newest first, with what it rests on: "Mentioned at 9 places ·
 * confirmed on 4 by our own sources · found on 31% of places". Mentioned
 * counts every place anything said it at: our sources' evidence either way,
 * a household search's suggestion, and every confirmation — so it is never
 * fewer than confirmed. A share over no places is not a number: null.
 */
export async function newFacts() {
  const fresh = (await factsWithCounts()).filter((f) => f.isNew);
  if (!fresh.length) return { total: 0, rows: [] };
  const subs = [...new Set(fresh.map((f) => f.subcategory_key))];
  const { rows: counts } = await query(
    `with f as (select distinct x.venue_ref, x.sub from (${FILED_SQL}) x where x.sub = any($1)),
          p as (select sub, count(*)::int n from f group by 1),
          m as (
            select e.venue_ref, e.attribute_key from place_fact_evidence e where e.says in ('yes', 'no')
            union
            select s.venue_ref, a.key from fact_suggestions s join place_attributes a on lower(a.label) = lower(s.feature)
            union
            select venue_ref, attribute_key from (${HAS_SQL}) h)
     select f.sub, m.attribute_key, count(distinct f.venue_ref)::int mentioned
       from f join m on m.venue_ref = f.venue_ref
      where m.attribute_key = any($2)
      group by 1, 2
     union all
     select p.sub, null, p.n from p`,
    [subs, [...new Set(fresh.map((f) => f.attribute_key))]]);
  const placesBy = new Map(counts.filter((c) => c.attribute_key == null).map((c) => [c.sub, c.mentioned]));
  const mentionedBy = new Map(counts.filter((c) => c.attribute_key != null).map((c) => [`${c.sub}|${c.attribute_key}`, c.mentioned]));
  const rows = fresh
    .sort((a, b) => new Date(b.active_since) - new Date(a.active_since) || a.sub_label.localeCompare(b.sub_label) || a.label.localeCompare(b.label))
    .map((r) => {
      const places = placesBy.get(r.subcategory_key) ?? 0;
      const confirmed = r.places_with;
      const share = places ? confirmed / places : null;
      return {
        sub: r.subcategory_key,
        subLabel: r.sub_label,
        fact: r.attribute_key,
        label: r.label,
        activeSince: r.active_since,
        places,
        mentioned: Math.max(mentionedBy.get(`${r.subcategory_key}|${r.attribute_key}`) ?? 0, confirmed),
        confirmed,
        pct: share == null ? null : Math.round(share * 100),
        // Never a rounded 0% for a fact that is there: "<1%".
        pctText: share == null ? null : share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`,
      };
    });
  return { total: rows.length, rows };
}

// ---------------------------------------------------------------------------
// Writing defaults (C49): a person-set default is an answer from Epic, public
// for every place without its own answer; a place-level answer still wins.

async function attributeOf(c, key) {
  const { rows: [a] } = await c.query('select key, label, kind, options from place_attributes where key = $1 and active', [key]);
  if (!a) throw bad(`${key} is not one of our facts.`);
  if (!STANDARD.includes(key)) throw bad(`${a.label} is not a standard fact; defaults are standard facts only.`);
  return a;
}

/** Cleaned value for a fact, from an option key the screens send. */
function valueFor(attr, optionKey, cfg) {
  const o = optionsOf(attr, cfg).find((x) => x.key === optionKey);
  if (!o) throw bad(`${optionKey} is not a value ${factWord(attr.key, attr.label)} takes.`);
  return o;
}

async function writeDefault(c, sub, attr, value, who) {
  await c.query(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno, from_value, to_value, choice, settled, origin, set_by, set_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, true, 'person', $7, now(), now())
     on conflict (subcategory_key, attribute_key) do update set yesno = excluded.yesno, from_value = excluded.from_value,
       to_value = excluded.to_value, choice = excluded.choice, settled = true, origin = 'person',
       set_by = excluded.set_by, set_at = now(), updated_at = now()`,
    [sub, attr.key, value.yesno ?? null, value.from ?? null, value.to ?? null, value.choice ?? null, who]);
}

/**
 * How many places a default would reach and how many keep their own answer
 * (README: "Applies to 212 places without their own answer · 9 keep their
 * own"). A place's own answer is a person's correction or a verified answer.
 */
export async function bulkImpact({ subs, fact }) {
  const list = [...new Set((subs ?? []).map(String))];
  if (!list.length) return { applies: 0, keep: 0 };
  const { rows: [r] } = await query(
    `with f as (select distinct venue_ref from (${FILED_SQL}) x where x.sub = any($1))
     select count(*)::int total,
            count(*) filter (where exists (select 1 from place_attribute_values v where v.venue_ref = f.venue_ref and v.attribute_key = $2 and v.set_by is not null)
                               or exists (select 1 from place_fact_answers a where a.venue_ref = f.venue_ref and a.attribute_key = $2 and a.state in ('yes','no') and a.hidden_at is null)
                               -- a person's Don't know is that place's own answer too
                               or exists (select 1 from fact_unknowns u where u.venue_ref = f.venue_ref and u.attribute_key = $2))::int own
       from f`, [list, fact]);
  return { applies: r.total - r.own, keep: r.own };
}

const wasOf = (row) => (row ? { ...valueOfRow(row), settled: row.settled, origin: row.origin, set_by: row.set_by } : null);

/**
 * Set one default by a person, or several at once from the bulk bar. The bulk
 * bar's Set is one decision and is logged once (the prototype: "Default set ·
 * Parking on 4 subcategories · A, B, C, D", with the Why), and one Undo puts
 * every subcategory back as it was.
 */
export async function setDefaults({ subs, fact, option, who, why = null }) {
  const list = [...new Set((subs ?? []).map(String))];
  if (!list.length) throw bad('Tick at least one subcategory.');
  const cfg = (await settings()).values;
  const impact = list.length > 1 ? await bulkImpact({ subs: list, fact }) : null;
  const out = await withTransaction(async (c) => {
    const attr = await attributeOf(c, fact);
    const o = valueFor(attr, option, cfg);
    const name = factWord(attr.key, attr.label);
    const items = [];
    const names = [];
    const befores = new Set();
    for (const sub of list) {
      const { rows: [s] } = await c.query('select key, label from shelf_subcategories where key = $1 and active', [sub]);
      if (!s) throw bad(`${sub} is not one of our subcategories.`);
      const { rows: [was] } = await c.query(
        'select * from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2 for update', [sub, fact]);
      befores.add(was ? wordOf(attr, valueOfRow(was), cfg) ?? '—' : '—');
      await writeDefault(c, sub, attr, o.value, who);
      items.push({ sub, fact, was: wasOf(was) });
      names.push(s.label);
    }
    if (list.length === 1) {
      const change = await logChange({
        client: c, who, area: 'Defaults', what: `${names[0]} · ${name}`, before: [...befores][0], after: o.label, why,
        subjectType: 'default', subjectId: `${list[0]}|${fact}`,
        undo: { kind: 'default', ...items[0] },
      });
      return { changes: [change], impact };
    }
    const change = await logChange({
      client: c, who, area: 'Defaults',
      what: `Default set · ${name} on ${list.length} subcategories · ${names.join(', ')}`,
      before: befores.size === 1 ? [...befores][0] : 'Mixed', after: o.label,
      why: why ?? `Applies to ${impact.applies} places without their own answer · ${impact.keep} keep their own`,
      subjectType: 'default_bulk', subjectId: `${fact}|${[...list].sort().join(',')}`,
      undo: { kind: 'default', items },
    });
    return { changes: [change], impact };
  });
  forgetAttributes();
  return out;
}

/** Accept the machine's proposed default: it becomes a person's, as it stands. */
export async function acceptDefault({ sub, fact, who }) {
  const cfg = (await settings()).values;
  const out = await withTransaction(async (c) => {
    const attr = await attributeOf(c, fact);
    const { rows: [d] } = await c.query(
      'select * from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2 for update', [sub, fact]);
    if (!d) throw bad('There is no proposed default to accept.');
    if (d.origin === 'person') throw bad('That default is already a person\'s.');
    await c.query(
      `update shelf_subcategory_attributes set settled = true, origin = 'person', set_by = $3, set_at = now(), updated_at = now()
        where subcategory_key = $1 and attribute_key = $2`, [sub, fact, who]);
    const { rows: [s] } = await c.query('select label from shelf_subcategories where key = $1', [sub]);
    return logChange({
      client: c, who, area: 'Defaults', what: `${s?.label ?? sub} · ${factWord(attr.key, attr.label)}`,
      before: `${wordOf(attr, valueOfRow(d), cfg)} (proposed)`, after: `${wordOf(attr, valueOfRow(d), cfg)} (accepted)`,
      why: 'Accepted the machine\'s proposal', subjectType: 'default', subjectId: `${sub}|${fact}`,
      undo: { kind: 'default', sub, fact, was: wasOf(d) },
    });
  });
  forgetAttributes();
  return out;
}

/**
 * Put a default back exactly as it was (the toast's Undo): one subcategory,
 * or every one a bulk Set touched. Refused while a later change to any of
 * them stands, so an Undo never writes an old value over a newer decision.
 */
export async function undoDefault({ change, who }) {
  const items = change.undo.items ?? [{ sub: change.undo.sub, fact: change.undo.fact, was: change.undo.was }];
  await withTransaction(async (c) => {
    for (const { sub, fact } of items) {
      const { rows: [newer] } = await c.query(
        `select id from bo_changes
          where undone_at is null and id <> $1 and at > (select at from bo_changes where id = $1)
            and ((subject_type = 'default' and subject_id = $2)
              or (subject_type = 'default_bulk' and split_part(subject_id, '|', 1) = $3
                  and $4 = any(string_to_array(split_part(subject_id, '|', 2), ','))))
          limit 1`,
        [change.id, `${sub}|${fact}`, fact, sub]);
      if (newer) throw bad('A later change to the same default stands; undo that one first.');
    }
    for (const { sub, fact, was } of items) {
      if (!was) {
        await c.query('delete from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2', [sub, fact]);
      } else {
        await c.query(
          `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno, from_value, to_value, choice, settled, origin, set_by, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           on conflict (subcategory_key, attribute_key) do update set yesno = excluded.yesno, from_value = excluded.from_value,
             to_value = excluded.to_value, choice = excluded.choice, settled = excluded.settled, origin = excluded.origin,
             set_by = excluded.set_by, updated_at = now()`,
          [sub, fact, was.yesno ?? null, was.from ?? null, was.to ?? null, was.choice ?? null, Boolean(was.settled), was.origin ?? 'machine', was.set_by ?? null]);
      }
    }
    await c.query('update bo_changes set undone_at = now(), undone_by = $2 where id = $1', [change.id, who]);
  });
  forgetAttributes();
}

// ---------------------------------------------------------------------------
// Facts on a subcategory, and related links.

const STATE_WORD = { active: 'Live', gathering: 'Gathering evidence', ignored: 'Ignored' };

/** A fact's row as it stands, everything an Undo needs to put it back. */
const snapshot = (f) => ({
  status: f.status, reason: f.reason, removed_by: f.removed_by ?? null,
  removed_at: f.removed_at ?? null, active_since: f.active_since ?? null, include_anyway: Boolean(f.include_anyway),
});

/** Stop looking for a fact here. A removed fact is never re-added (C35). */
export async function removeFact({ sub, fact, who }) {
  return withTransaction(async (c) => {
    const { rows: [f] } = await c.query(
      `select sf.*, a.label, s.label as sub_label from subcategory_facts sf
         join place_attributes a on a.key = sf.attribute_key join shelf_subcategories s on s.key = sf.subcategory_key
        where sf.subcategory_key = $1 and sf.attribute_key = $2 for update of sf`, [sub, fact]);
    if (!f) throw bad('That fact is not looked for here.');
    await c.query(
      `update subcategory_facts set status = 'ignored', reason = 'removed_by_a_person', removed_by = $3, removed_at = now(), updated_at = now()
        where subcategory_key = $1 and attribute_key = $2`, [sub, fact, who]);
    return logChange({
      client: c, who, area: 'Facts', what: `Fact removed · ${f.label} · ${f.sub_label}`,
      before: STATE_WORD[f.status] ?? 'Live', after: 'Removed',
      subjectType: 'subcategory_fact', subjectId: `${sub}|${fact}`,
      undo: { kind: 'subcategory_fact', sub, fact, was: snapshot(f) },
    });
  });
}

/**
 * Put a fact back (Excluded facts): Put back for facts a person removed,
 * Include anyway for facts ignored as being on nearly every place (C41).
 * Put back takes the person's removal away and the fact stands where its
 * places put it — Active if confirmed at enough places, otherwise Gathering
 * evidence — never Active by fiat. Include anyway is a person's decision to
 * look for it regardless, and is Active.
 */
export async function restoreFact({ sub, fact, who, mode }) {
  const needed = (await settings()).values.addPlaces ?? 2;
  const [{ places_with: confirmed = 0 } = {}] = await factsWithCounts({ sub, fact, standard: true });
  return withTransaction(async (c) => {
    const { rows: [f] } = await c.query(
      `select sf.*, a.label, s.label as sub_label from subcategory_facts sf
         join place_attributes a on a.key = sf.attribute_key join shelf_subcategories s on s.key = sf.subcategory_key
        where sf.subcategory_key = $1 and sf.attribute_key = $2 for update of sf`, [sub, fact]);
    if (!f || f.status !== 'ignored') throw bad('That fact is not excluded here.');
    if (mode === 'put_back' && f.reason !== 'removed_by_a_person') throw bad('Only a fact a person removed can be put back.');
    if (mode === 'include_anyway' && f.reason !== 'on_nearly_every_place') throw bad('Only a fact ignored for being on nearly every place can be included anyway.');
    const status = mode === 'include_anyway' || confirmed >= needed ? 'active' : 'gathering';
    await c.query(
      `update subcategory_facts set status = $3, reason = null, removed_by = null, removed_at = null,
         include_anyway = $4, active_since = case when $3 = 'active' then coalesce(active_since, now()) else active_since end, updated_at = now()
        where subcategory_key = $1 and attribute_key = $2`, [sub, fact, status, mode === 'include_anyway']);
    return logChange({
      client: c, who, area: 'Facts', what: `${mode === 'put_back' ? 'Fact put back' : 'Fact included anyway'} · ${f.label} · ${f.sub_label}`,
      before: mode === 'put_back' ? 'Removed' : 'Ignored', after: STATE_WORD[status],
      subjectType: 'subcategory_fact', subjectId: `${sub}|${fact}`,
      undo: { kind: 'subcategory_fact', sub, fact, was: snapshot(f) },
    });
  });
}

/**
 * Undo a fact status change: the row goes back exactly as it was, including
 * who removed it and when. `items` (Copy facts) undoes several at once; a
 * fact that was not there before is taken off again if it is still only
 * gathering evidence.
 */
export async function undoFact({ change, who }) {
  const items = change.undo.items ?? [{ sub: change.undo.sub, fact: change.undo.fact, was: change.undo.was }];
  await withTransaction(async (c) => {
    for (const { sub, fact, was } of items) {
      if (!was) {
        await c.query(`delete from subcategory_facts where subcategory_key = $1 and attribute_key = $2 and status = 'gathering'`, [sub, fact]);
        continue;
      }
      const full = 'removed_at' in was;
      await c.query(
        `update subcategory_facts set status = $3, reason = $4,
           removed_by = case when $5 then $6 else null end,
           removed_at = case when $5 then $7::timestamptz else null end,
           active_since = case when $5 then $8::timestamptz else active_since end,
           include_anyway = case when $5 then $9 else include_anyway end,
           updated_at = now()
          where subcategory_key = $1 and attribute_key = $2`,
        [sub, fact, was.status, was.reason, full, was.removed_by ?? null, was.removed_at ?? null, was.active_since ?? null, Boolean(was.include_anyway)]);
    }
    await c.query('update bo_changes set undone_at = now(), undone_by = $2 where id = $1', [change.id, who]);
  });
}

/**
 * Copy facts from another subcategory (the prototype's "Copy facts from
 * another subcategory"): every fact Active there that this one has never
 * looked for arrives here as Gathering evidence — it still has to be
 * confirmed at this subcategory's own places. A fact removed here stays
 * removed (C35). Logged once, with one Undo.
 */
export async function copyFacts({ to, from, who }) {
  if (to === from) throw bad('Pick another subcategory to copy from.');
  const live = (await factsWithCounts({ sub: from })).filter((f) => f.status === 'active');
  return withTransaction(async (c) => {
    const { rows: labels } = await c.query('select key, label from shelf_subcategories where key = any($1) and active', [[to, from]]);
    const name = new Map(labels.map((l) => [l.key, l.label]));
    if (!name.has(to) || !name.has(from)) throw bad('Both must be subcategories we hold.');
    const added = [];
    for (const f of live) {
      const { rowCount } = await c.query(
        `insert into subcategory_facts (subcategory_key, attribute_key, status, first_seen, verified_places, updated_at)
         values ($1, $2, 'gathering', now(), 0, now()) on conflict do nothing`, [to, f.attribute_key]);
      if (rowCount) added.push(f);
    }
    if (!added.length) throw bad(`${name.get(to)} already looks for every fact ${name.get(from)} has.`);
    const change = await logChange({
      client: c, who, area: 'Facts',
      what: `Facts copied · ${name.get(from)} → ${name.get(to)} · ${added.map((f) => f.label).join(', ')}`,
      before: '—', after: `${added.length} ${added.length === 1 ? 'fact' : 'facts'} · Gathering evidence`,
      subjectType: 'subcategory_fact_copy', subjectId: `${to}|${from}`,
      undo: { kind: 'subcategory_fact', items: added.map((f) => ({ sub: to, fact: f.attribute_key, was: null })) },
    });
    return { ...change, copied: added.length, from: name.get(from), to: name.get(to) };
  });
}

/** Link two subcategories by hand (Related). */
export async function link({ a, b, who, on = true }) {
  if (a === b) throw bad('A subcategory is not related to itself.');
  const [x, y] = [a, b].sort();
  return withTransaction(async (c) => {
    const { rows: labels } = await c.query('select key, label from shelf_subcategories where key = any($1) and active', [[x, y]]);
    if (labels.length !== 2) throw bad('Both must be subcategories we hold.');
    const name = new Map(labels.map((l) => [l.key, l.label]));
    if (on) {
      await c.query('insert into subcategory_links (a, b, added_by) values ($1, $2, $3) on conflict do nothing', [x, y, who]);
    } else {
      await c.query('delete from subcategory_links where a = $1 and b = $2', [x, y]);
    }
    return logChange({
      client: c, who, area: 'Subcategories', what: `Related · ${name.get(a)} ↔ ${name.get(b)}`,
      before: on ? '—' : 'linked', after: on ? 'linked' : '—', subjectType: 'link', subjectId: `${x}|${y}`,
      undo: { kind: 'link', a: x, b: y, on: !on },
    });
  });
}
