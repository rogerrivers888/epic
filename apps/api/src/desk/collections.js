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

import { query, withTransaction } from '../db.js';
import { logChange } from './changes.js';
import { settings } from './settings.js';
import { COST_WORD } from './categories.js';
import { describe } from './places.js';

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
    else if (Array.isArray(c.subcategory)) c.subcategory.forEach((s) => out.subs.push({ id: s, not }));
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
  return false;
}

/** Whether a place fits a collection: its new rule, or its legacy predicate exactly. */
export const fits = (c, p) => (c.legacy ? matchesPredicate(c.legacy, p) : matches(c.rule, p));

/** The audience a rule implies (D11), in the words the list uses. */
export function audienceOf(rule) {
  if (!rule.ages) return { key: 'everyone', label: 'Everyone' };
  const [lo, hi] = rule.ages;
  if (rule.ageSpan) return { key: 'everyone', label: 'Everyone' };
  if (lo >= 16) return { key: 'adult', label: 'Households with an adult' };
  return { key: `ages:${lo}-${hi}`, label: `Households with someone aged ${lo}–${hi >= 99 ? '99' : hi}`, lo, hi };
}

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
  const [{ rows: filed }, { rows: subs }, { rows: also }, { rows: own }, { rows: verified }, { rows: defaults }] = await Promise.all([
    query(`select pi.venue_ref, pi.subcategory as sub, true as primary_ from place_index pi
            where pi.subcategory is not null and pi.not_in_epic_at is null
           union
           select pil.venue_ref, t.subcategory_key, false from place_index_labels pil
             join word_targets t on 'google:' || t.word = pil.label and not t.is_primary
             join place_index pi on pi.venue_ref = pil.venue_ref
            where pi.subcategory is not null and pi.not_in_epic_at is null and pi.subcategory <> t.subcategory_key`),
    query('select key, category_key from shelf_subcategories where active'),
    query('select subcategory_key, category_key from shelf_subcategory_categories'),
    query('select venue_ref, attribute_key, yesno, from_value, to_value, choice from place_attribute_values where set_by is not null'),
    query(`select venue_ref, attribute_key, state, yesno, from_value, to_value, choice from place_fact_answers where state in ('yes','no') and hidden_at is null`),
    query(`select subcategory_key, attribute_key, yesno, from_value, to_value, choice from shelf_subcategory_attributes where origin = 'person' or settled`),
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
  return { key: r.key, title: r.title, copy: r.copy, active: r.active, grouping: r.grouping, rule, legacy, audience: audienceOf(rule) };
}

/** The list: Collection · Places (or within reach) · Shown to · Shown · Opened · Hearted. */
export async function collectionList({ loc = null } = {}) {
  const [{ rows }, idx, eng] = await Promise.all([
    query('select * from browse_rows order by position, title'),
    placeIndex(),
    engagement(),
  ]);
  const refs = loc && !loc.unknown ? loc.refs : null;
  const pool = refs ? idx.places.filter((p) => refs.has(p.ref)) : idx.places;
  const list = rows.map((r) => {
    const c = toCollection(r);
    const e = eng.by.get(r.key);
    return {
      ...c,
      places: !c.legacy && ruleIsEmpty(c.rule) ? 0 : pool.filter((p) => fits(c, p)).length,
      shown: eng.speaks ? (e?.shown ?? 0) : null,
      opened: eng.speaks ? (e?.opened ?? 0) : null,
      hearted: eng.speaks ? (eng.hearts.get(r.key) ?? 0) : null,
    };
  });
  return { rows: list, count: list.length, engagementSpeaks: eng.speaks, atLeast: Boolean(loc?.capped) };
}

/**
 * What a rule would return: a count and example places spread across the
 * subcategories in it — two each, one each once there are five or more, up to
 * ten (README).
 */
export async function preview({ rule: raw, loc = null }) {
  const rule = cleanRule(raw);
  if (ruleIsEmpty(rule)) return { count: 0, examples: [] };
  const idx = await placeIndex();
  const refs = loc && !loc.unknown ? loc.refs : null;
  const hits = (refs ? idx.places.filter((p) => refs.has(p.ref)) : idx.places).filter((p) => matches(rule, p));
  const bySub = new Map();
  for (const p of hits) bySub.set(p.primarySub, [...(bySub.get(p.primarySub) ?? []), p]);
  const each = bySub.size >= 5 ? 1 : 2;
  const described = await describe(hits.slice(0, 2000).map((p) => p.ref));
  const picked = [];
  for (const [sub, list] of bySub) {
    const named = list.filter((p) => described.get(p.ref)?.name);
    for (const p of named.slice(0, each)) picked.push({ ref: p.ref, sub, name: described.get(p.ref).name, town: described.get(p.ref).town });
    if (picked.length >= 10) break;
  }
  const { rows: subs } = await query('select key, label from shelf_subcategories where key = any($1)', [[...bySub.keys()]]);
  const label = new Map(subs.map((s) => [s.key, s.label]));
  return { count: hits.length, examples: picked.slice(0, 10).map((x) => ({ ...x, subLabel: label.get(x.sub) ?? x.sub })) };
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
    collections: p ? rows_.map(toCollection).filter((c) => (c.legacy || !ruleIsEmpty(c.rule)) && fits(c, p)).map((c) => ({ key: c.key, title: c.title })) : [],
  };
}

const COST_SIGN = { Free: 'Free', Cheap: '£', Mid: '££', Dear: '£££' };

/**
 * A place's facts as the drawer lists them (prototype: name, value): every
 * standard fact with Yes, No or Don't know — "Don't know" is a real answer
 * here, never a No — then every other fact the place has a yes for.
 */
export function factLines(p, attrs) {
  const out = [];
  for (const a of attrs) {
    if (a.key === 'suits-ages') {
      if (a.standard || p.ages) out.push({ name: a.label, value: p.ages ? `${p.ages[0]}–${p.ages[1] >= 99 ? '99' : p.ages[1]}` : null });
    } else if (a.key === 'duration') {
      if (a.standard || p.hours != null) out.push({ name: a.label, value: p.hours == null ? null : `${p.hours} hour${p.hours === 1 ? '' : 's'}` });
    } else if (a.key === 'cost-band') {
      if (a.standard || p.cost) out.push({ name: a.label, value: p.cost ? COST_SIGN[p.cost] ?? p.cost : null });
    } else if (a.kind === 'yesno') {
      const v = p.facts.has(a.key) ? 'Yes' : p.no?.has(a.key) ? 'No' : null;
      if (a.standard || v === 'Yes') out.push({ name: a.label, value: v });
    }
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
  const { count } = await preview({ rule });
  if (!count) throw bad('Nothing matches that rule yet.');
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
      const change = await logChange({ client: c, who, area: 'Collections', what: `Collection added · ${t}`, before: '—', after: ruleWords(rule), subjectType: 'collection', subjectId: k, undo: { kind: 'collection', key: k, was: null } });
      return { key: k, created: true, change };
    }
    await c.query(
      `update browse_rows set title = $2, copy = $3, rule = $4::jsonb, active = true, updated_by = $5, updated_at = now() where key = $1`,
      [k, t, cp, JSON.stringify(rule), who]);
    const was = { title: row.title, copy: row.copy, rule: row.rule, predicate: row.predicate, active: row.active };
    const changes = [];
    if (row.title !== t) changes.push(['title', row.title, t]);
    if ((row.copy ?? '') !== cp) changes.push(['copy', row.copy || '—', cp || '—']);
    const oldRule = row.rule ? cleanRule(row.rule) : fromPredicate(row.predicate);
    if (JSON.stringify(oldRule) !== JSON.stringify(rule)) changes.push(['rule', ruleWords(oldRule), ruleWords(rule)]);
    if (!row.active) changes.push(['shown', 'switched off', 'live']);
    // One save is one change, so its Undo puts back everything the save did
    // and nothing else (Codex, 28 Sep 2026).
    let change = null;
    if (changes.length) {
      change = await logChange({
        client: c, who, area: 'Collections',
        what: `Collection ${changes.map(([f]) => f).join(', ')} · ${t}`,
        before: changes.map(([f, b]) => `${f}: ${b}`).join(' · '),
        after: changes.map(([f, , a]) => `${f}: ${a}`).join(' · '),
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

/** A rule in words, for the Changes log. */
export function ruleWords(r) {
  const part = (label, items) => (items.length ? `${label}: ${items.map((i) => (i.not ? `not ${i.id}` : i.id)).join(' or ')}` : null);
  return [
    part('Category', r.cats), part('Subcategory', r.subs), part('Fact', r.facts),
    r.primaryCat ? `Primary: ${r.primaryCat}` : null,
    r.ages ? `Ages ${r.ageSpan ? 'from ≤' : ''}${r.ages[0]} to ${r.ageSpan ? '≥' : ''}${r.ages[1]}` : null,
    r.dur ? `Duration ${r.dur[0]}–${r.dur[1]} hours` : null,
    r.cost.length ? `Cost ${r.cost.join(' or ')}` : null,
  ].filter(Boolean).join(' · ') || '—';
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
export async function asHousehold({ householdId, loc = null }) {
  const cfg = (await settings()).values;
  const [{ rows: [h] }, { rows: members }, { rows }, idx, { rows: hearts }] = await Promise.all([
    query('select id, name, home_label, home_lat, home_lng, max_travel_minutes from households where id = $1', [householdId]),
    query('select id, name, birth_year, birth_date, is_minor from members where household_id = $1 order by created_at', [householdId]),
    query('select * from browse_rows where active order by position, title'),
    placeIndex(),
    query('select row_key, member_id, hearted_at from browse_row_hearts where household_id = $1 order by hearted_at desc', [householdId]),
  ]);
  if (!h) throw missing('No such household.');
  const year = new Date().getFullYear();
  // An age we do not know is null, never a guess drawn as a fact: a member
  // with no birth year counts as a child (is_minor) or an adult for the
  // audience test only, and the screen says "age not given".
  const known = members.map((m) => (m.birth_date ? year - new Date(m.birth_date).getFullYear() : m.birth_year ? year - m.birth_year : null));
  const ages = members.map((m, i) => known[i] ?? (m.is_minor ? 8 : 35));
  const refs = loc && !loc.unknown ? loc.refs : null;
  const pool = refs ? idx.places.filter((p) => refs.has(p.ref)) : idx.places;
  // Hearts fade (D7): a heart older than FADE_DAYS no longer lifts a row.
  const fresh = hearts.filter((x) => Date.now() - new Date(x.hearted_at).getTime() < FADE_DAYS * 86400_000);
  const hearted = new Map(fresh.map((x) => [x.row_key, x.hearted_at]));
  const firstHits = new Map();
  const out = rows.map((r) => {
    const c = toCollection(r);
    const hits = !c.legacy && ruleIsEmpty(c.rule) ? [] : pool.filter((p) => fits(c, p));
    const n = hits.length;
    firstHits.set(c.key, hits.slice(0, 3));
    const a = c.audience;
    // Named `suits`, not `fits`: a local `fits` here shadowed the rule test
    // above and threw before it was assigned.
    const suits = a.key === 'everyone' ? true : a.key === 'adult' ? ages.some((x) => x >= 16) : ages.some((x) => x >= a.lo && x <= a.hi);
    let why = null;
    if (!suits) why = `Nobody here is ${a.key === 'adult' ? 'an adult' : `aged ${a.lo}–${a.hi}`}`;
    else if (n < cfg.collectionMinPlaces) why = `Too thin here · ${n} place${n === 1 ? '' : 's'}`;
    return { key: c.key, title: c.title, copy: c.copy, places: n, audience: a.label, hearted: hearted.has(c.key), shown: !why, why };
  });
  // Three places a shown collection would put on its shelf, named from our
  // own record only; a place with no name we may print is left off.
  const shelfRefs = out.filter((c) => c.shown).flatMap((c) => firstHits.get(c.key).map((p) => p.ref));
  const [named, { rows: subLabels }] = await Promise.all([
    describe(shelfRefs),
    query('select key, label from shelf_subcategories'),
  ]);
  const subLabel = new Map(subLabels.map((x) => [x.key, x.label]));
  for (const c of out) {
    c.shelf = c.shown
      ? firstHits.get(c.key).filter((p) => named.get(p.ref)?.name).map((p) => ({ ref: p.ref, name: named.get(p.ref).name, kind: subLabel.get(p.primarySub) ?? null }))
      : [];
  }
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
  return {
    household: { id: h.id, name: h.name, home: h.home_label, ages },
    members: members.map((m, i) => ({ id: m.id, name: m.name, age: known[i], adult: ages[i] >= 16 })),
    // Every heart, fading ones included and marked, so the screen can say why
    // an old heart no longer lifts its collection.
    hearts: hearts.map((x) => {
      const days = Math.max(0, Math.floor((Date.now() - new Date(x.hearted_at).getTime()) / 86400_000));
      return { key: x.row_key, title: title.get(x.row_key) ?? x.row_key, member: memberName.get(x.member_id) ?? null, heartedAt: x.hearted_at, days, fading: days >= FADE_DAYS };
    }),
    fadeDays: FADE_DAYS,
    shown: order,
    hidden: out.filter((c) => !c.shown),
  };
}
