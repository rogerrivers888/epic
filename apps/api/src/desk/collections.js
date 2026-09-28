/**
 * Collections (renamed from Ideas): the rows families see in Inspire, each a
 * title, a copy line and a rule over facts (handover 4.11, D1–D12; README
 * "Collections").
 *
 * Rule model (README, with two additions the handover's own definitions need):
 *
 *   { cats: [{id, not}], subs: [{id, not}], facts: [{id, not}],
 *     ages: [lo, hi] | null, dur: [lo, hi] | null (hours),
 *     cost: ['Free'|'Cheap'|'Mid'|'Dear'],
 *     ageSpan: bool,      // ages means "from ≤ lo to ≥ hi", not "overlaps"
 *     primaryCat: id }    // the place's primary category must be this one
 *
 * Within cats, subs and facts: any positive matches and no negative matches;
 * different groups must all hold. `ageSpan` is Big kids ("ages from ≤ 12 to
 * ≥ 60, deliberately thin"); `primaryCat` is Sneakily educational
 * ("Educational with Fun as primary").
 *
 * Who sees it is derived, never set (D11): no age condition → Everyone; lower
 * age ≥ 16 → households with an adult; otherwise households with someone in
 * that range. "Not visited by this household" is applied at display time.
 */

import { PLACE_WORDS } from './words.js';
import { query, withTransaction } from '../db.js';
import { logChange } from './changes.js';
import { settings } from './settings.js';
import { COST_WORD } from './categories.js';
import { describe } from './places.js';
import { censusCovered, countOf } from './location.js';
import { ringFor, placesWithin } from '../repositories/reach.js';
import { censusInRing } from '../repositories/censusRing.js';
import { CAP_MINUTES } from '../domain/reach.js';
import { heroesForPlaces } from '../repositories/library.js';

/** A heart this old no longer lifts a collection (the existing desk's rule, say.ts). */
export const FADE_DAYS = 120;

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const missing = (message) => Object.assign(new Error(message), { status: 404, code: 'not_found' });

// ---------------------------------------------------------------------------
// The rule

/** A rule, cleaned: unknown keys dropped, shapes checked. */
export function cleanRule(r) {
  const list = (x) => (Array.isArray(x) ? x : []).map((i) => (typeof i === 'string' ? { id: i, not: false } : { id: String(i?.id ?? ''), not: Boolean(i?.not) })).filter((i) => i.id);
  const range = (x) => (Array.isArray(x) && x.length === 2 && x.every((n) => Number.isFinite(Number(n))) ? [Number(x[0]), Number(x[1])] : null);
  const cost = (Array.isArray(r?.cost) ? r.cost : []).filter((c) => ['Free', 'Cheap', 'Mid', 'Dear'].includes(c));
  return {
    cats: list(r?.cats), subs: list(r?.subs), facts: list(r?.facts),
    ages: range(r?.ages), dur: range(r?.dur), cost,
    ageSpan: Boolean(r?.ageSpan), primaryCat: r?.primaryCat ? String(r.primaryCat) : null,
  };
}

/** Whether a rule says anything at all. */
export const ruleIsEmpty = (r) => !r.cats.length && !r.subs.length && !r.facts.length && !r.ages && !r.dur && !r.cost.length && !r.primaryCat;

/**
 * The old predicate format (browse_rows.predicate) in the new model, so the
 * eighteen rows already written open in the editor with their rule.
 */
export function fromPredicate(p) {
  const out = { cats: [], subs: [], facts: [], ages: null, dur: null, cost: [] };
  const take = (c, not = false) => {
    if (!c) return;
    if (c.not) { take(c.not, !not); return; }
    if (Array.isArray(c.all)) { c.all.forEach((x) => take(x, not)); return; }
    if (Array.isArray(c.any)) { c.any.forEach((x) => take(x, not)); return; }
    if (c.overlaps && c.attribute === 'suits-ages') out.ages = [c.overlaps[0], c.overlaps[1]];
    else if (c.attribute === 'cost-band' && c.choice && COST_WORD[c.choice]) out.cost.push(COST_WORD[c.choice]);
    else if (Array.isArray(c.subcategory)) c.subcategory.forEach((s) => out.subs.push({ id: s, not }));
    else if (Array.isArray(c.category)) c.category.forEach((k) => out.cats.push({ id: k, not }));
    else if (c.attribute && typeof c.yes === 'boolean') {
      if (c.attribute === 'indoor' && c.yes === false) out.facts.push({ id: 'indoor', not: !not });
      else if (c.attribute === 'booking-required' && c.yes === false) out.facts.push({ id: 'booking-required', not: !not });
      else out.facts.push({ id: c.attribute, not: not ? c.yes : !c.yes });
    }
  };
  take(p);
  return cleanRule(out);
}

/**
 * A row still written in the old predicate format, evaluated exactly as it
 * was meant — `all` is and, `any` is or, `not` negates — so an unsaved legacy
 * row counts what it always counted. Converting it to the new model is only
 * for the editor's pills; saving it there writes the new rule (Codex, 28 Sep
 * 2026: flattening changed "Too hot to think" from or to and).
 */
export function matchesPredicate(pred, p) {
  if (!pred || typeof pred !== 'object') return true;
  if (Array.isArray(pred.all)) return pred.all.every((x) => matchesPredicate(x, p));
  if (Array.isArray(pred.any)) return pred.any.some((x) => matchesPredicate(x, p));
  if (pred.not) return !matchesPredicate(pred.not, p);
  if (pred.overlaps && pred.attribute === 'suits-ages') return Boolean(p.ages) && p.ages[0] <= pred.overlaps[1] && p.ages[1] >= pred.overlaps[0];
  if (Array.isArray(pred.subcategory)) return pred.subcategory.some((s) => p.subs.includes(s));
  if (Array.isArray(pred.category)) return pred.category.some((c) => p.cats.includes(c));
  if (pred.attribute && typeof pred.yes === 'boolean') return pred.yes ? p.facts.has(pred.attribute) : p.no?.has(pred.attribute) ?? false;
  // A cost band is a choice ("cheap"): the place's band, in the same words.
  if (pred.attribute === 'cost-band' && pred.choice) return Boolean(p.cost) && p.cost === COST_WORD[pred.choice];
  return false;
}

/**
 * Whether a legacy predicate converts to the rule model *exactly* — so the
 * editor's pills return the same places as the list's count (audit, 28 Sep
 * 2026). Decided from its shape, not from today's places:
 *
 *   - one clause, or `all` of clauses (an `any` across kinds has no pills);
 *   - at most one positive subcategory list, one positive category list and
 *     one positive yes — several would become "any of" inside their group,
 *     where the predicate meant "all of";
 *   - negatives only as `not` of a subcategory, a category or a yes;
 *   - `yes: false` never: the predicate asks for a recorded no, the rule's
 *     "not" for the absence of a yes, and a place nobody has asked about
 *     answers the two differently;
 *   - at most one age overlap, nothing else.
 */
export function legacyExact(pred) {
  if (!pred || typeof pred !== 'object') return true;
  const list = Array.isArray(pred.all) ? pred.all : [pred];
  const seen = { sub: 0, cat: 0, yes: 0, ages: 0 };
  for (const c of list) {
    if (!c || typeof c !== 'object') return false;
    if (c.not) {
      const n = c.not;
      if (Array.isArray(n.subcategory) || Array.isArray(n.category)) continue;
      if (n.attribute && n.yes === true) continue;
      return false;
    }
    if (Array.isArray(c.subcategory)) { seen.sub += 1; continue; }
    if (Array.isArray(c.category)) { seen.cat += 1; continue; }
    if (c.attribute === 'suits-ages' && Array.isArray(c.overlaps)) { seen.ages += 1; continue; }
    if (c.attribute && c.yes === true) { seen.yes += 1; continue; }
    return false;
  }
  return seen.sub <= 1 && seen.cat <= 1 && seen.yes <= 1 && seen.ages <= 1;
}

/** A legacy predicate in words, for the editor's read-only line and Changes. */
export function legacyWords(pred, names = {}) {
  const sub = (k) => names.subs?.get(k) ?? k;
  const cat = (k) => names.cats?.get(k) ?? k;
  const fact = (k) => names.facts?.get(k) ?? k;
  const say = (c) => {
    if (!c || typeof c !== 'object') return '';
    if (Array.isArray(c.all)) return c.all.map(say).join(' and ');
    if (Array.isArray(c.any)) return `(${c.any.map(say).join(' or ')})`;
    if (c.not) return `not ${say(c.not)}`;
    if (Array.isArray(c.subcategory)) return c.subcategory.map(sub).join(' or ');
    if (Array.isArray(c.category)) return c.category.map(cat).join(' or ');
    if (c.overlaps) return `suits ages ${c.overlaps[0]} to ${c.overlaps[1]}`;
    if (c.attribute && typeof c.yes === 'boolean') return c.yes ? fact(c.attribute) : `${fact(c.attribute)}: no`;
    // The thresholds are the rule: "How much you learn at least 3", never
    // the axis's name alone (audit 2 — a retired axis read as a bare fact).
    if (c.attribute && c.atLeast != null) return `${fact(c.attribute)} at least ${c.atLeast}`;
    if (c.attribute && c.atMost != null) return `${fact(c.attribute)} at most ${c.atMost}`;
    if (c.attribute && c.is != null) return `${fact(c.attribute)} is ${c.is}`;
    if (c.attribute === 'suits-ages' && c.from != null) return `suits ages from ${c.from}`;
    if (c.attribute && c.from != null) return `${fact(c.attribute)} from ${c.from}`;
    if (c.attribute && c.choice) return `${fact(c.attribute)}: ${c.choice}`;
    if (c.attribute) return fact(c.attribute);
    return '';
  };
  return say(pred) || '—';
}

/** Whether a place fits a collection: its new rule, or its legacy predicate exactly. */
export const fits = (c, p) => (c.legacy ? matchesPredicate(c.legacy, p) : matches(c.rule, p));

/** The audience a rule implies (D11), in the words the list uses. */
export function audienceOf(rule) {
  // The README's rule for every collection, `ageSpan` ones too (audit, 28 Sep
  // 2026): no ages → Everyone; lower age ≥ 16 → an adult; otherwise someone
  // in the range. A top of 60 or more reads "60+".
  if (!rule.ages) return { key: 'everyone', label: 'Everyone' };
  const [lo, hi] = rule.ages;
  if (lo >= 16) return { key: 'adult', label: 'Households with an adult' };
  return { key: `ages:${lo}-${hi}`, label: `Households with someone aged ${lo}–${ageTop(hi)}`, lo, hi };
}

/** The top of an age range as it is read: 60 or more is "60+". */
export const ageTop = (hi) => (hi >= 60 ? '60+' : String(hi));

/** Whether a place fits a rule. */
export function matches(rule, p) {
  const group = (items, has) => {
    if (!items.length) return true;
    const pos = items.filter((i) => !i.not);
    const neg = items.filter((i) => i.not);
    if (neg.some((i) => has(i.id))) return false;
    return !pos.length || pos.some((i) => has(i.id));
  };
  if (!group(rule.cats, (id) => p.cats.includes(id))) return false;
  if (!group(rule.subs, (id) => p.subs.includes(id))) return false;
  if (!group(rule.facts, (id) => p.facts.has(id))) return false;
  if (rule.primaryCat && p.primaryCat !== rule.primaryCat) return false;
  if (rule.ages) {
    if (!p.ages) return false;
    const [lo, hi] = rule.ages;
    if (rule.ageSpan ? !(p.ages[0] <= lo && p.ages[1] >= hi) : !(p.ages[0] <= hi && p.ages[1] >= lo)) return false;
  }
  if (rule.dur) {
    if (p.hours == null) return false;
    if (p.hours < rule.dur[0] || p.hours > rule.dur[1]) return false;
  }
  if (rule.cost.length) {
    if (!p.cost || !rule.cost.includes(p.cost)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// What each filed place has, cached: one pass, every collection reads it.

let cache = null;
let cachedAt = 0;
const TTL_MS = 60_000;
export const forget = () => { cache = null; };

/**
 * Every place in Epic with its subcategories, categories and facts. A fact
 * is the place's own answer (a person's, then our sources' verified yes);
 * where it has none, a person-set default for its subcategory stands (C49).
 */
export async function placeIndex() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const [{ rows: filed }, { rows: subs }, { rows: also }, { rows: own }, { rows: verified }, { rows: defaults }, { rows: unknowns }] = await Promise.all([
    query(`select pi.venue_ref, pi.subcategory as sub, true as primary_ from place_index pi
            where pi.subcategory is not null and pi.not_in_epic_at is null
           union
           select pil.venue_ref, t.subcategory_key, false from ${PLACE_WORDS} pil
             join word_targets t on 'google:' || t.word = pil.label and not t.is_primary
             join place_index pi on pi.venue_ref = pil.venue_ref
            where pi.subcategory is not null and pi.not_in_epic_at is null and pi.subcategory <> t.subcategory_key
           -- In a fixed order, so a shelf names the same places from one
           -- request to the next (a union comes back in any order).
           order by 1, 3 desc`),
    query('select key, category_key from shelf_subcategories where active'),
    query('select subcategory_key, category_key from shelf_subcategory_categories'),
    query('select venue_ref, attribute_key, yesno, from_value, to_value, choice from place_attribute_values where set_by is not null'),
    query(`select venue_ref, attribute_key, state, yesno, from_value, to_value, choice from place_fact_answers a where state in ('yes','no') and hidden_at is null and not exists (select 1 from fact_unknowns u where u.venue_ref = a.venue_ref and u.attribute_key = a.attribute_key)`),
    query(`select subcategory_key, attribute_key, yesno, from_value, to_value, choice from shelf_subcategory_attributes where origin = 'person' or settled`),
    query('select venue_ref, attribute_key from fact_unknowns'),
  ]);
  const catOf = new Map(subs.map((s) => [s.key, s.category_key]));
  const alsoIn = new Map();
  for (const a of also) alsoIn.set(a.subcategory_key, [...(alsoIn.get(a.subcategory_key) ?? []), a.category_key]);
  const places = new Map();
  for (const f of filed) {
    if (!catOf.has(f.sub)) continue;
    const p = places.get(f.venue_ref) ?? { ref: f.venue_ref, primarySub: null, primaryCat: null, subs: [], cats: [], answers: new Map() };
    if (f.primary_) { p.primarySub = f.sub; p.primaryCat = catOf.get(f.sub); }
    if (!p.subs.includes(f.sub)) p.subs.push(f.sub);
    for (const c of [catOf.get(f.sub), ...(alsoIn.get(f.sub) ?? [])]) if (c && !p.cats.includes(c)) p.cats.push(c);
    places.set(f.venue_ref, p);
  }
  const defaultBy = new Map();
  const defaultsOfSub = new Map();
  for (const d of defaults) {
    defaultBy.set(`${d.subcategory_key}|${d.attribute_key}`, d);
    defaultsOfSub.set(d.subcategory_key, [...(defaultsOfSub.get(d.subcategory_key) ?? []), d]);
  }
  for (const v of verified) places.get(v.venue_ref)?.answers.set(v.attribute_key, v.state === 'no' && v.yesno == null ? { ...v, yesno: false } : v);
  // A person's Don't know is an answer too — nobody can tell — so no default
  // stands in for it and the place neither has nor lacks the fact (Codex).
  for (const u of unknowns) places.get(u.venue_ref)?.answers.set(u.attribute_key, { unknown: true, yesno: null, from_value: null, to_value: null, choice: null });
  for (const v of own) places.get(v.venue_ref)?.answers.set(v.attribute_key, v); // a person's answer wins
  for (const p of places.values()) {
    const get = (k) => p.answers.get(k) ?? (p.primarySub ? defaultBy.get(`${p.primarySub}|${k}`) : null) ?? null;
    p.facts = new Set();
    p.no = new Set();
    for (const [k, v] of p.answers) { if (v.yesno === true) p.facts.add(k); else if (v.yesno === false) p.no.add(k); }
    for (const d of defaultsOfSub.get(p.primarySub) ?? []) if (d.yesno === false && !p.answers.has(d.attribute_key)) p.no.add(d.attribute_key);
    for (const d of defaultsOfSub.get(p.primarySub) ?? []) if (d.yesno === true && !p.answers.has(d.attribute_key)) p.facts.add(d.attribute_key);
    const ages = get('suits-ages');
    p.ages = ages && (ages.from_value != null || ages.to_value != null) ? [ages.from_value ?? 0, ages.to_value ?? 99] : null;
    const dur = get('duration');
    const mins = dur ? (dur.to_value ?? dur.from_value) : null;
    p.hours = mins == null ? null : Math.round((mins / 60) * 10) / 10;
    // The range as the drawer reads it ("2–3 hours"), from the same answer.
    const h = (m) => (m == null ? null : Math.round((m / 60) * 10) / 10);
    p.durRange = dur && (dur.from_value != null || dur.to_value != null) ? [h(dur.from_value), h(dur.to_value)] : null;
    const cost = get('cost-band');
    p.cost = cost?.choice ? COST_WORD[cost.choice] ?? null : null;
    delete p.answers;
  }
  cache = { places: [...places.values()], catOf };
  cachedAt = Date.now();
  return cache;
}

// ---------------------------------------------------------------------------
// Reading

/** Whether engagement can speak: fewer than two households have any events. */
async function engagement() {
  const [{ rows: [h] }, { rows }, { rows: hearts }] = await Promise.all([
    query('select count(distinct household_id)::int n from collection_events where household_id is not null'),
    query(`select collection_key, count(*) filter (where kind = 'shown')::int shown,
                  count(*) filter (where kind = 'opened')::int opened from collection_events group by 1`),
    query('select row_key, count(*)::int n from browse_row_hearts group by 1'),
  ]);
  const speaks = (h?.n ?? 0) >= 2;
  return {
    speaks,
    by: new Map(rows.map((r) => [r.collection_key, r])),
    hearts: new Map(hearts.map((r) => [r.row_key, r.n])),
  };
}

/** A stored row as a collection. */
function toCollection(r) {
  const legacy = !r.rule && r.predicate && Object.keys(r.predicate).length ? r.predicate : null;
  const rule = r.rule ? cleanRule(r.rule) : fromPredicate(r.predicate);
  // `legacyExact`: the pills return what the predicate returns, so the editor
  // may show them; otherwise it shows the old rule read-only until re-saved.
  return { key: r.key, title: r.title, copy: r.copy, active: r.active, grouping: r.grouping, rule, legacy, legacyExact: legacy ? legacyExact(legacy) : true, audience: audienceOf(rule) };
}

/** Labels for categories, subcategories and facts, to say a rule in names. */
async function ruleNames(run = query) {
  const [{ rows: c }, { rows: s }, { rows: f }] = await Promise.all([
    run('select key, label from shelf_categories'),
    run('select key, label from shelf_subcategories'),
    run('select key, label from place_attributes'),
  ]);
  return { cats: new Map(c.map((x) => [x.key, x.label])), subs: new Map(s.map((x) => [x.key, x.label])), facts: new Map(f.map((x) => [x.key, x.label])) };
}

/** The list: Collection · Places (or within reach) · Shown to · Shown · Opened · Hearted. */
export async function collectionList({ loc = null } = {}) {
  const [{ rows }, idx, eng, names] = await Promise.all([
    // A retired collection (275: its meaning needed a graded axis) is kept
    // with why, and listed nowhere.
    query('select * from browse_rows where retired_at is null order by position, title'),
    placeIndex(),
    engagement(),
    ruleNames(),
  ]);
  const refs = loc && !loc.unknown ? loc.refs : null;
  const pool = refs ? idx.places.filter((p) => refs.has(p.ref)) : idx.places;
  const list = rows.map((r) => {
    const c = toCollection(r);
    const e = eng.by.get(r.key);
    // Within a location, the count says what it can: null where the filter
    // cannot speak (drawn "—"), a floor where it is one (drawn "N+").
    const raw = !c.legacy && ruleIsEmpty(c.rule) ? 0 : pool.filter((p) => fits(c, p)).length;
    const said = refs ? countOf(raw, loc) : { n: raw, atLeast: false };
    return {
      ...c,
      legacyText: c.legacy && !c.legacyExact ? legacyWords(c.legacy, names) : null,
      places: said.n,
      placesAtLeast: said.atLeast,
      shown: eng.speaks ? (e?.shown ?? 0) : null,
      opened: eng.speaks ? (e?.opened ?? 0) : null,
      hearted: eng.speaks ? (eng.hearts.get(r.key) ?? 0) : null,
    };
  });
  return { rows: list, count: list.length, engagementSpeaks: eng.speaks, atLeast: list.some((r) => r.placesAtLeast) };
}

/** How many of a subcategory's places the example search looks through. */
const NAME_SEARCH = 5000;

/**
 * The first `limit` of `refs`, in order, that have a name in our own record
 * or the atlas — each test an index lookup (place_records' key,
 * attractions.venue_ref, and the atlas-ref expression index).
 */
async function namedAmong(refs, limit) {
  if (!refs.length || limit <= 0) return [];
  const { rows } = await query(
    `select r.ref from unnest($1::text[]) with ordinality as r(ref, ord)
      where exists (select 1 from place_records pr where pr.venue_ref = r.ref and pr.name is not null)
         or exists (select 1 from attractions x where x.venue_ref = r.ref)
         or exists (select 1 from attractions x where 'atlas:' || x.id::text = r.ref)
      order by r.ord limit $2`, [refs, limit]);
  return rows.map((r) => r.ref);
}

/**
 * What a rule would return: a count and example places spread across the
 * subcategories in it — two each, one each once there are five or more, up to
 * ten (README).
 */
export async function preview({ rule: raw, loc = null, examples = true }) {
  const rule = cleanRule(raw);
  if (ruleIsEmpty(rule)) return { count: 0, anywhere: 0, examples: [] };
  const idx = await placeIndex();
  const refs = loc && !loc.unknown ? loc.refs : null;
  const everywhere = idx.places.filter((p) => matches(rule, p));
  const hits = refs ? everywhere.filter((p) => refs.has(p.ref)) : everywhere;
  // Pushed, not spread: a copy per place made a big drawer quadratic.
  const bySub = new Map();
  for (const p of hits) { const l = bySub.get(p.primarySub); if (l) l.push(p); else bySub.set(p.primarySub, [p]); }
  if (!examples) {
    const said = refs ? countOf(hits.length, loc) : { n: hits.length, atLeast: false };
    return { count: said.n, atLeast: said.atLeast, anywhere: everywhere.length, examples: [] };
  }
  const each = bySub.size >= 5 ? 1 : 2;
  // Names are found with one indexed question per subcategory — which of
  // its places (the first NAME_SEARCH of them) have a name we hold — and only
  // the few picked are described. The old way described every place a batch
  // at a time until enough were named, which on a big nameless drawer held
  // the count back for seconds (audit 2, 28 Sep 2026).
  const picked = [];
  for (const [sub, list] of bySub) {
    if (picked.length >= 10) break;
    const named = await namedAmong(list.slice(0, NAME_SEARCH).map((p) => p.ref), each);
    if (!named.length) continue;
    const described = await describe(named);
    for (const ref of named) {
      const d = described.get(ref);
      if (d?.name) picked.push({ ref, sub, name: d.name, town: d.town ?? null });
    }
  }
  const { rows: subs } = await query('select key, label from shelf_subcategories where key = any($1)', [[...bySub.keys()]]);
  const label = new Map(subs.map((s) => [s.key, s.label]));
  // `anywhere` is the whole estate's count, which is what Save is judged on
  // (the server's rule): a rule that returns nothing near one town may still
  // be a collection.
  const said = refs ? countOf(hits.length, loc) : { n: hits.length, atLeast: false };
  return { count: said.n, atLeast: said.atLeast, anywhere: everywhere.length, examples: picked.slice(0, 10).map((x) => ({ ...x, subLabel: label.get(x.sub) ?? x.sub })) };
}

/**
 * The side drawer for a place: photo, name, subcategory · town, its sentence,
 * its facts, and the collections it appears in. Owned facts only.
 */
export async function placeCard(ref) {
  const [idx, d, { rows: rows_ }, { rows: attrs }] = await Promise.all([
    placeIndex(), describe([ref]), query('select * from browse_rows'), query('select key, label, kind, standard from place_attributes where active order by position, label'),
  ]);
  const p = idx.places.find((x) => x.ref === ref);
  const info = d.get(ref) ?? {};
  if (!p && !info.name) throw missing('Not a place we hold.');
  const label = new Map(attrs.map((a) => [a.key, a.label]));
  const { rows: [sub] } = p?.primarySub ? await query('select label from shelf_subcategories where key = $1', [p.primarySub]) : { rows: [] };
  return {
    ref,
    name: info.name ?? null,
    image: info.image ?? null,
    sub: sub?.label ?? null,
    town: info.town ?? null,
    sentence: info.sentence ?? null,
    facts: p ? factLines(p, attrs) : [],
    // At most eight, as the prototype's drawer (audit 2).
    collections: p ? rows_.map(toCollection).filter((c) => (c.legacy || !ruleIsEmpty(c.rule)) && fits(c, p)).slice(0, 8).map((c) => ({ key: c.key, title: c.title })) : [],
  };
}

const COST_SIGN = { Free: 'Free', Cheap: '£', Mid: '££', Dear: '£££' };

/**
 * A place's facts as the drawer lists them (prototype: name, value): every
 * standard fact with Yes, No or Don't know — "Don't know" is a real answer
 * here, never a No — then every other fact the place has a yes for.
 */
/**
 * The drawer's standard facts, in the prototype's order and under its names
 * (logic.js STD): the six yes-or-nos, then Who is it for, Duration, Cost band.
 */
export const DRAWER_FACTS = [
  ['indoor', 'Indoors'], ['step-free', 'Step free'], ['parking', 'Parking'], ['toilets', 'Toilets'],
  ['booking-required', 'Booking required'], ['food-on-site', 'Food on site'],
  ['suits-ages', 'Who is it for'], ['duration', 'Duration'], ['cost-band', 'Cost band'],
];

const hoursText = (x) => String(x).replace(/\.0$/, '');

export function factLines(p, attrs) {
  const out = [];
  for (const [key, name] of DRAWER_FACTS) {
    let value = null;
    if (key === 'suits-ages') {
      value = p.ages ? (p.ages[1] >= 99 ? `${p.ages[0]}+` : `${p.ages[0]}–${p.ages[1]}`) : null;
    } else if (key === 'duration') {
      const r = p.durRange;
      if (r) {
        const [lo, hi] = [r[0] ?? r[1], r[1] ?? r[0]];
        const band = lo === hi ? hoursText(lo) : `${hoursText(lo)}–${hoursText(hi)}`;
        value = `${band} ${band === '1' ? 'hour' : 'hours'}`;
      }
    } else if (key === 'cost-band') {
      value = p.cost ? COST_SIGN[p.cost] ?? p.cost : null;
    } else {
      value = p.facts.has(key) ? 'Yes' : p.no?.has(key) ? 'No' : null;
    }
    out.push({ name, value });
  }
  // Then every other fact the place has a yes for.
  const std = new Set(DRAWER_FACTS.map(([k]) => k));
  for (const a of attrs) {
    if (std.has(a.key) || a.kind !== 'yesno') continue;
    if (p.facts.has(a.key)) out.push({ name: a.label, value: 'Yes' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writing

const slug = (text) => String(text || '').toLowerCase().trim().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/**
 * Save a collection, new or existing. Save needs a title, a rule and at least
 * one matching place (README). Each changed field is a change in the log.
 */
export async function saveCollection({ key = null, title, copy = '', rule: raw, who }) {
  const t = String(title ?? '').trim();
  const cp = String(copy ?? '').trim();
  const rule = cleanRule(raw);
  if (!t) throw bad('A collection needs a title.');
  if (ruleIsEmpty(rule)) throw bad('A collection needs a rule.');
  // Judged on the whole estate, whatever the location filter on the screen.
  const { count } = await preview({ rule, examples: false });
  if (!count) throw bad('Nothing matches that rule yet.');
  const names = await ruleNames();
  const out = await withTransaction(async (c) => {
    let row = null;
    if (key) {
      ({ rows: [row] } = await c.query('select * from browse_rows where key = $1 for update', [key]));
      if (!row) throw missing('No such collection.');
    }
    const k = key ?? (await uniqueKey(c, slug(t) || 'collection'));
    if (!row) {
      // Live on save: a collection's audience and thinness decide who sees it
      // (D7, D11); there is no separate switch (Codex, 28 Sep 2026).
      await c.query(
        `insert into browse_rows (key, grouping, title, copy, predicate, rule, position, active, seeded, updated_by)
         values ($1, 'custom', $2, $3, '{}'::jsonb, $4::jsonb, 1000, true, false, $5)`, [k, t, cp, JSON.stringify(rule), who]);
      const change = await logChange({ client: c, who, area: 'Collections', what: `Collection added · ${t}`, before: '—', after: ruleWords(rule, names), subjectType: 'collection', subjectId: k, undo: { kind: 'collection', key: k, was: null } });
      return { key: k, created: true, change };
    }
    await c.query(
      `update browse_rows set title = $2, copy = $3, rule = $4::jsonb, active = true, updated_by = $5, updated_at = now() where key = $1`,
      [k, t, cp, JSON.stringify(rule), who]);
    const was = { title: row.title, copy: row.copy, rule: row.rule, predicate: row.predicate, active: row.active };
    const changes = [];
    const legacy = !row.rule && row.predicate && Object.keys(row.predicate).length ? row.predicate : null;
    const oldRule = row.rule ? cleanRule(row.rule) : fromPredicate(row.predicate);
    const ruleChanged = legacy ? true : JSON.stringify(oldRule) !== JSON.stringify(rule);
    if (row.title !== t) changes.push('title');
    if ((row.copy ?? '') !== cp) changes.push('copy');
    if (ruleChanged) changes.push('rule');
    if (!row.active) changes.push('shown');
    // One save is one change, so its Undo puts back everything the save did
    // and nothing else (Codex, 28 Sep 2026). It reads as the prototype's:
    // "Collection edited · <title>", the rule said in names before and after
    // (logic.js 2247), with a title or copy change named beside it.
    let change = null;
    if (changes.length) {
      const was_ = legacy ? legacyWords(legacy, names) : ruleWords(oldRule, names);
      const before = [row.title !== t ? `Title: ${row.title}` : null, (row.copy ?? '') !== cp ? `Copy: ${row.copy || '—'}` : null, was_, !row.active ? 'switched off' : null].filter(Boolean).join(' · ');
      const after = [row.title !== t ? `Title: ${t}` : null, (row.copy ?? '') !== cp ? `Copy: ${cp || '—'}` : null, ruleWords(rule, names), !row.active ? 'live' : null].filter(Boolean).join(' · ');
      change = await logChange({
        client: c, who, area: 'Collections',
        what: `Collection edited · ${t}`,
        before, after,
        subjectType: 'collection', subjectId: k, undo: { kind: 'collection', key: k, was },
      });
    }
    // The change's id is what the toast's Undo sends (`POST /undo/:id`).
    return { key: k, created: false, changed: changes.length, change };
  });
  forget();
  return out;
}

async function uniqueKey(c, base) {
  for (let i = 0; i < 50; i++) {
    const k = i ? `${base}-${i + 1}` : base;
    const { rows } = await c.query('select 1 from browse_rows where key = $1', [k]);
    if (!rows.length) return k;
  }
  throw bad('Could not find a free key for that title.');
}

/**
 * A rule in words, for the Changes log — the prototype's `ruleWords`
 * (logic.js 2155): names, not keys; "or" inside a group, "not" for the
 * negatives, "· and" between groups.
 */
export function ruleWords(r, names = {}) {
  const nm = (items, map) => {
    const name = (id) => map?.get(id) ?? id;
    const yes = items.filter((x) => !x.not).map((x) => name(x.id));
    const no = items.filter((x) => x.not).map((x) => name(x.id));
    return [yes.length ? yes.join(' or ') : null, no.length ? `not ${no.join(' or ')}` : null].filter(Boolean);
  };
  const parts = [
    ...nm(r.cats, names.cats), ...nm(r.subs, names.subs), ...nm(r.facts, names.facts),
    r.primaryCat ? `with ${names.cats?.get(r.primaryCat) ?? r.primaryCat} as its primary` : null,
    r.ages ? `suits ages ${r.ageSpan ? 'from ' : ''}${r.ages[0]} to ${ageTop(r.ages[1])}` : null,
    r.dur ? (r.dur[0] <= 0 ? `up to ${r.dur[1]} hours` : `${r.dur[0]} to ${r.dur[1]} hours`) : null,
    r.cost.length ? r.cost.join(' or ') : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · and ') : 'Every place';
}

/** Undo a collection change: the row goes back to what it was (or away if new). */
export async function undoCollection({ change, who }) {
  const { key, was } = change.undo;
  await withTransaction(async (c) => {
    if (!was) await c.query('delete from browse_rows where key = $1 and not seeded', [key]);
    else await c.query('update browse_rows set title = $2, copy = $3, rule = $4::jsonb, active = $5, updated_at = now() where key = $1', [key, was.title, was.copy, was.rule ? JSON.stringify(was.rule) : null, was.active ?? true]);
    await c.query('update bo_changes set undone_at = now(), undone_by = $2 where id = $1', [change.id, who]);
  });
  forget();
}

// ---------------------------------------------------------------------------
// See as a household

/**
 * The collections a household would see in Inspire, in order, after audience,
 * thinness and hearts are applied (D7, D11):
 *
 *   - audience: a collection with an age condition is shown only where someone
 *     in the household fits it; "lower age ≥ 16" needs an adult;
 *   - thinness: hidden when fewer than `collectionMinPlaces` places match
 *     within the household's reach (its home and travel minutes);
 *   - hearts: hearted collections rise to the top, never an empty hearted
 *     collection, and two or three unhearted ones always stay in view.
 *
 * Returns every collection with why it is shown or not, so the screen can say.
 */
/**
 * A household's own reach — its home and its travel minutes, by car — as the
 * location filter's shape (`refs`, `speaks`, `atLeast` …), so `countOf` reads
 * it the same way. Null where the household has no home we can place: then
 * nothing can be judged near it (audit 2, 28 Sep 2026: "near you" and
 * WAITING were read against the desk's own filter, not the household).
 */
export async function householdReach(h) {
  const hasPoint = h?.home_lat != null && h?.home_lng != null;
  if (!h || (!hasPoint && !String(h.home_label ?? '').trim())) return null;
  const asked = Number(h.max_travel_minutes) > 0 ? Number(h.max_travel_minutes) : 30;
  const minutes = Math.min(asked, CAP_MINUTES);
  const ring = await ringFor(hasPoint
    ? { lat: Number(h.home_lat), lng: Number(h.home_lng), label: h.home_label ?? null, minutes, mode: 'driving' }
    : { where: h.home_label, minutes, mode: 'driving' }).catch(() => null);
  if (!ring) return null;
  const [placed, within, covered] = await Promise.all([
    censusInRing({ cells: ring.band ?? ring.cells, outcodes: ring.outcodes }).catch(() => null),
    placesWithin(ring.cell, { minutes, mode: 'driving', edge: 0 }).catch(() => []),
    censusCovered(ring.outcodes ?? []),
  ]);
  const outcodes = (ring.outcodes ?? []).map((o) => String(o).toUpperCase());
  const uncovered = outcodes.filter((o) => !covered.has(o));
  const unresolved = Object.values(placed?.unresolved ?? {}).reduce((n, v) => n + Number(v || 0), 0);
  const unplaceable = Number(placed?.unplaceable ?? 0);
  const speaks = Boolean(placed) && outcodes.length > 0 && uncovered.length < outcodes.length;
  return {
    label: ring.label ?? h.home_label ?? null, minutes: asked, mode: 'car',
    capped: asked > CAP_MINUTES,
    refs: new Set([...Object.values(placed?.refs ?? {}).flat(), ...within.map((p) => p.venue_ref)]),
    speaks, uncovered, unresolved, unplaceable,
    atLeast: asked > CAP_MINUTES || !speaks || uncovered.length > 0 || unresolved > 0 || unplaceable > 0,
  };
}

/** How many places a family's shelf carries (the desk's own list still names three). */
export const SHELF = 8;

/** The row that takes its reader's name (handover D6): "A day to yourself, Sarah". */
const PERSONAL = new Set(['dayyourself']);

/** A member's age from what we hold, or null; never a guess drawn as a fact. */
const ageOf = (m, year = new Date().getFullYear()) =>
  (m.birth_date ? year - new Date(m.birth_date).getFullYear() : m.birth_year ? year - m.birth_year : null);

/**
 * Everything a household's collections are judged from, read once. The one
 * path both the family's Inspire (`familyCollections`) and the desk's "See as
 * a household" (`asHousehold`) go through, so the preview is what a family
 * gets (collections-for-families, 28 Sep 2026).
 *
 * `hearts`, where given, stands in for the household's stored hearts — the
 * desk preview's own taps, which are never written — as `{ key, member, days }`.
 * `reachFor` is the household's reach; tests hand in a fixed one.
 */
async function judge(householdId, { hearts: given = null, reachFor = householdReach } = {}) {
  const cfg = (await settings()).values;
  const [{ rows: [h] }, { rows: members }, { rows }, idx, { rows: stored }] = await Promise.all([
    query('select id, name, home_label, home_lat, home_lng, max_travel_minutes from households where id = $1', [householdId]),
    query('select id, name, birth_year, birth_date, is_minor from members where household_id = $1 order by created_at', [householdId]),
    query('select * from browse_rows order by position, title'),
    placeIndex(),
    query('select row_key, member_id, hearted_at from browse_row_hearts where household_id = $1 order by hearted_at desc', [householdId]),
  ]);
  if (!h) throw missing('No such household.');
  const mine = new Set(members.map((m) => m.id));
  const hearts = given
    ? given.filter((x) => x && x.key).map((x) => ({
      row_key: String(x.key),
      member_id: x.member && mine.has(String(x.member)) ? String(x.member) : null,
      hearted_at: new Date(Date.now() - Math.max(0, Number(x.days) || 0) * 86400_000),
    }))
    : stored;
  // An age we do not know is null, never a guess drawn as a fact: a member
  // with no birth year counts as a child (is_minor) or an adult for the
  // audience test only, and the screen says "age not given".
  const known = members.map((m) => ageOf(m));
  const ages = members.map((m, i) => known[i] ?? (m.is_minor ? 8 : 35));
  const reach = await reachFor(h);
  const min = cfg.collectionMinPlaces;
  const judged = rows.filter((r) => r.active).map((r) => {
    const c = toCollection(r);
    const all = !c.legacy && ruleIsEmpty(c.rule) ? [] : idx.places.filter((p) => fits(c, p));
    // Within the household's own reach; with no reach, nothing is near and
    // the count cannot speak (null, never a nought).
    const hits = reach ? all.filter((p) => reach.refs.has(p.ref)) : [];
    const said = reach ? countOf(hits.length, reach) : { n: null, atLeast: false };
    const a = c.audience;
    // Named `suits`, not `fits`: a local `fits` here shadowed the rule test
    // above and threw before it was assigned.
    const suits = a.key === 'everyone' ? true : a.key === 'adult' ? ages.some((x) => x >= 16) : ages.some((x) => x >= a.lo && x <= a.hi);
    // Thin only where the count can say so: an exact number under the
    // minimum, never a floor or a count we could not make.
    const thin = said.n != null && !said.atLeast && said.n < min;
    let why = null;
    if (!suits) why = `Nobody here is ${a.key === 'adult' ? 'an adult' : `aged ${a.lo}–${a.hi}`}`;
    else if (thin) why = `Too thin here · ${said.n} place${said.n === 1 ? '' : 's'}`;
    // The shelf is from what is near; with no home, the desk's list still
    // names places from anywhere (the family's never does: see below).
    return { c, row: r, pool: reach ? hits : all, near: hits, places: said.n, placesAtLeast: said.atLeast, suits, thin, why };
  });
  // Up to SHELF places each row would put on its shelf, named from our own
  // record only (place_records, the atlas); a place with no name we may print
  // is left off. The names are looked for past the first few (audit 2): the
  // first with a name we hold among the first NAME_SEARCH, by index.
  const byRef = new Map(idx.places.map((p) => [p.ref, p]));
  const shelfOf = new Map();
  for (const j of judged) shelfOf.set(j.c.key, await namedAmong(j.pool.slice(0, NAME_SEARCH).map((p) => p.ref), SHELF));
  const refs = [...new Set([...shelfOf.values()].flat())];
  const [named, { rows: subLabels }, pictures] = await Promise.all([
    describe(refs),
    query('select key, label from shelf_subcategories'),
    heroesForPlaces(refs),
  ]);
  const subLabel = new Map(subLabels.map((x) => [x.key, x.label]));
  for (const j of judged) {
    j.shelf = shelfOf.get(j.c.key).filter((ref) => named.get(ref)?.name)
      .map((ref) => ({ ref, name: named.get(ref).name, kind: subLabel.get(byRef.get(ref)?.primarySub) ?? null, image: ownedPicture(pictures.get(ref)) }));
  }
  return { cfg, h, members, known, ages, rows, hearts, reach, judged, min };
}

/**
 * A picture from our own library (image_assets, approved), in the shape the
 * app's cards read (routes/inspire.js `ownedImage`). Never a provider's photo.
 */
const ownedPicture = (row) => (row ? {
  id: row.id, source: row.source, lqip: row.lqip, credit: row.credit_line,
  licence: row.licence, licenceUrl: row.licence_url, sourceUrl: row.source_page_url,
  creditRequired: row.attribution_required,
} : null);

/**
 * The collections a family sees, as the prototype's household phone draws
 * them (logic.js `rowVals` / `phoneRow`, 28 Sep 2026; README v2 Collections;
 * handover 4.11, D6–D11):
 *
 *   - audience (D11): a row with an age condition only where somebody in the
 *     household fits it; "lower age ≥ 16" needs an adult;
 *   - the viewer: whose list this is. A heart belongs to a person, and the
 *     first heart asks who (`ask`). Once known, the hearts that lift a row are
 *     theirs; before, the household's. A personalised row takes an adult
 *     viewer's name, and is never shown to a child who is looking (D6);
 *   - hearts fade (D7): one older than FADE_DAYS no longer lifts its row;
 *   - thinness: a row with fewer than `collectionMinPlaces` places within the
 *     household's own reach is not shown. A hearted one is never shown empty:
 *     it waits ("Nothing near you this week"), in the list only;
 *   - an unhearted row is shown only where hearting it would put something on
 *     its shelf — a place near, with a name we hold.
 *
 * Two orders, as the prototype has two phones:
 *
 *   `inspire`  hearted rows first, with one unhearted row after the second
 *              and three more after them, so discovery does not stop;
 *   `list`     every row the household can see, in library order (the
 *              "Rows" phone), waiting rows marked.
 *
 * With no home we can place nothing is near, and that is said (`reach: null`,
 * no rows) rather than drawn as a list of empty rows.
 *
 * Owned content only: names from our own record, pictures from our own
 * library, the drawer's label from our taxonomy. No provider is asked.
 */
export async function familyCollections({ householdId, viewer = null, hearts = null, reachFor = householdReach } = {}) {
  const s = await judge(householdId, { hearts, reachFor });
  return familyFrom(s, viewer);
}

function familyFrom(s, viewerId) {
  const { members, known, ages, reach, judged, min } = s;
  const people = members.map((m, i) => ({ id: m.id, name: m.name, age: known[i], adult: ages[i] >= 16 }));
  const viewer = people.find((m) => m.id === viewerId) ?? null;
  const fresh = s.hearts.filter((x) => Date.now() - new Date(x.hearted_at).getTime() < FADE_DAYS * 86400_000);
  // Before anybody has said whose list this is, the household's hearts show;
  // after, the viewer's own.
  const hearted = new Set(fresh.filter((x) => !viewer || x.member_id === viewer.id).map((x) => x.row_key));
  const base = {
    // Asked on the first heart, once; never where the account is somebody's own.
    whose: viewer ? { id: viewer.id, name: viewer.name, adult: viewer.adult } : null,
    ask: !viewer,
    // For "Whose list is this?": a child's age beside their name, as the prototype.
    members: people.map((m) => ({ id: m.id, name: m.name, age: m.adult ? null : m.age, adult: m.adult })),
    minPlaces: min,
    fadeDays: FADE_DAYS,
    reach: reach ? { label: reach.label, minutes: reach.minutes, speaks: reach.speaks, atLeast: reach.atLeast } : null,
  };
  if (!reach) return { ...base, inspire: [], list: [] };
  const list = [];
  for (const j of judged) {
    if (!j.suits) continue;
    const personal = PERSONAL.has(j.c.key);
    if (personal && viewer && !viewer.adult) continue;
    const isHearted = hearted.has(j.c.key);
    // Never an empty hearted row: under the minimum, or with nothing near we
    // can name, it waits. An unhearted one in that state is not shown.
    const waiting = isHearted && (j.thin || !j.shelf.length);
    if (!isHearted && (j.thin || !j.shelf.length)) continue;
    list.push({
      key: j.c.key,
      title: personal && viewer?.adult ? `${j.c.title}, ${viewer.name}` : j.c.title,
      copy: j.c.copy || null,
      places: j.places,
      placesAtLeast: j.placesAtLeast,
      hearted: isHearted,
      waiting,
      shelf: waiting ? [] : j.shelf,
    });
  }
  const top = list.filter((r) => r.hearted && !r.waiting);
  const rest = list.filter((r) => !r.hearted);
  const inspire = top.length >= 2
    ? [top[0], top[1], ...rest.slice(0, 1), ...top.slice(2), ...rest.slice(1, 4)]
    : [...top, ...rest.slice(0, 3)];
  return { ...base, inspire, list };
}

/**
 * Heart a collection for a household, or take the heart back. A heart belongs
 * to a person (migration 225): hearting with nobody named is not a heart to
 * drop, it is the first-heart question, refused as `whose_list` so the app
 * asks it. Taking a heart back with nobody named takes the household's.
 */
export async function heartCollection({ householdId, key, on, memberId = null }) {
  const { rows: [row] } = await query('select key from browse_rows where key = $1 and active', [String(key)]);
  if (!row) throw missing('No such collection.');
  if (memberId) {
    const { rows: [m] } = await query('select id from members where id = $1 and household_id = $2', [memberId, householdId]);
    if (!m) throw bad('That is not somebody in this household.');
  }
  if (!on) {
    if (memberId) await query('delete from browse_row_hearts where row_key = $1 and member_id = $2', [row.key, memberId]);
    else await query('delete from browse_row_hearts where row_key = $1 and household_id = $2', [row.key, householdId]);
    return { key: row.key, hearted: false };
  }
  if (!memberId) throw Object.assign(new Error('Whose list is this?'), { status: 409, code: 'whose_list' });
  await query(
    `insert into browse_row_hearts (row_key, household_id, member_id) values ($1, $2, $3)
     on conflict (row_key, member_id) do update set hearted_at = now()`, [row.key, householdId, memberId]);
  return { key: row.key, hearted: true };
}

// The desk's location filter is not asked (the route may still send it): a
// household sees what is within its own reach, whatever the desk shows.
/**
 * See as a household: the desk's view of one household, read through the
 * same `judge` as the family's own endpoint. `inspire` and `list` are exactly
 * what `GET /api/collections` would send that household with these hearts,
 * seen as `seenAs`; the rest is the desk's (every row, why each is hidden,
 * every heart with its age).
 */
export async function asHousehold({ householdId, seenAs = null, hearts: given = null, reachFor = householdReach }) {
  const s = await judge(householdId, { hearts: given, reachFor });
  const { cfg, h, members, known, ages, rows, hearts, reach, judged } = s;
  // Hearts fade (D7): a heart older than FADE_DAYS no longer lifts a row.
  const fresh = hearts.filter((x) => Date.now() - new Date(x.hearted_at).getTime() < FADE_DAYS * 86400_000);
  const hearted = new Map(fresh.map((x) => [x.row_key, x.hearted_at]));
  const heartedBy = new Map(fresh.map((x) => [x.row_key, x.member_id]));
  const out = judged.map((j) => ({
    key: j.c.key, title: j.c.title, copy: j.c.copy, places: j.places, placesAtLeast: j.placesAtLeast,
    audience: j.c.audience.label, hearted: hearted.has(j.c.key), shown: !j.why, why: j.why,
    // The desk's phone names three (prototype `phoneRow`).
    shelf: j.shelf.slice(0, 3).map(({ ref, name, kind }) => ({ ref, name, kind })),
  }));
  const outBy = new Map(out.map((c) => [c.key, c]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const title = new Map(rows.map((r) => [r.key, r.title]));
  const shown = out.filter((c) => c.shown);
  const heartedShown = shown.filter((c) => c.hearted);
  const rest = shown.filter((c) => !c.hearted);
  // Hearted collections rise to the top, but two unhearted ones always stay in
  // view near it: up to three hearted, then two unhearted, then the rest.
  const order = heartedShown.length
    ? [...heartedShown.slice(0, 3), ...rest.slice(0, 2), ...heartedShown.slice(3), ...rest.slice(2)]
    : rest;
  const family = familyFrom(s, seenAs);
  return {
    // The phone's rows: every collection in library order, live or not, with
    // what the preview needs to draw it in each of its five states. The
    // preview's hearts and "whose list" are the screen's own and are never
    // written (audit decision, 28 Sep 2026).
    rows: rows.map((r) => {
      const c = outBy.get(r.key);
      return {
        key: r.key, title: r.title, copy: r.copy, live: r.active,
        // A personalised row (handover D6): "A day to yourself, Sarah".
        person: PERSONAL.has(r.key),
        places: c ? c.places : null,
        placesAtLeast: c ? c.placesAtLeast : false,
        audience: c ? c.audience : audienceOf(toCollection(r).rule).label,
        hearted: hearted.has(r.key), heartedBy: heartedBy.get(r.key) ?? null,
        shelf: c ? c.shelf : [],
      };
    }),
    // What the family's own endpoint sends, from the same reading.
    inspire: family.inspire,
    list: family.list,
    whose: family.whose,
    minPlaces: cfg.collectionMinPlaces,
    household: { id: h.id, name: h.name, home: h.home_label, ages },
    // What "near you" means for this household, or null where it has no
    // home we can place (the screen says so).
    reach: reach ? { label: reach.label, minutes: reach.minutes, speaks: reach.speaks, atLeast: reach.atLeast } : null,
    members: members.map((m, i) => ({ id: m.id, name: m.name, age: known[i], adult: ages[i] >= 16 })),
    // Every heart, fading ones included and marked, so the screen can say why
    // an old heart no longer lifts its collection.
    hearts: hearts.map((x) => {
      const days = Math.max(0, Math.floor((Date.now() - new Date(x.hearted_at).getTime()) / 86400_000));
      return { key: x.row_key, title: title.get(x.row_key) ?? x.row_key, member: memberName.get(x.member_id) ?? null, memberId: x.member_id ?? null, heartedAt: x.hearted_at, days, fading: days >= FADE_DAYS };
    }),
    fadeDays: FADE_DAYS,
    shown: order,
    hidden: out.filter((c) => !c.shown),
  };
}
