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
import { forget as forgetAttributes } from '../repositories/placeAttributes.js';

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const missing = (message) => Object.assign(new Error(message), { status: 404, code: 'not_found' });

/** The ten standard facts, in the order every screen lists them (handover 3). */
export const STANDARD = ['indoor', 'step-free', 'parking', 'toilets', 'booking-required', 'food-on-site', 'dog-friendly', 'suits-ages', 'duration', 'cost-band'];

/** Stored cost-band options, and the words the screens use for them. */
export const COST_WORD = { free: 'Free', cheap: 'Cheap', moderate: 'Mid', expensive: 'Dear' };
export const COST_KEY = { Free: 'free', Cheap: 'cheap', Mid: 'moderate', Dear: 'expensive' };

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

/** Live and new facts per subcategory (standard facts are not counted here). */
async function factCounts() {
  const { rows } = await query(
    `select subcategory_key as sub, count(*) filter (where status = 'active')::int live,
            count(*) filter (where status = 'active' and active_since > now() - interval '30 days')::int fresh
       from subcategory_facts sf join place_attributes a on a.key = sf.attribute_key and a.active and not a.standard
      group by 1`);
  return new Map(rows.map((r) => [r.sub, r]));
}

/**
 * The subcategory list. `loc` is a resolved location filter (location.js) or
 * null for the whole estate.
 */
export async function subcategoryList({ cat = null, q = null, loc = null } = {}) {
  const refs = loc && !loc.unknown ? loc.refs : null;
  const [{ rows: subs }, counts, facts, related, total] = await Promise.all([
    query(`select s.key, s.label, s.category_key, c.label as category_label
             from shelf_subcategories s join shelf_categories c on c.key = s.category_key
            where s.active and c.active order by c.position, s.position, s.label`),
    placeCounts(refs),
    factCounts(),
    relatedPairs(),
    distinctPlaces(refs),
  ]);
  const labelOf = new Map(subs.map((s) => [s.key, s.label]));
  const needle = q ? String(q).trim().toLowerCase() : null;
  const rows = subs
    .filter((s) => !cat || s.category_key === cat)
    .filter((s) => !needle || s.label.toLowerCase().includes(needle) || s.category_label.toLowerCase().includes(needle))
    .map((s) => ({
      key: s.key,
      label: s.label,
      category: s.category_key,
      categoryLabel: s.category_label,
      places: counts.get(s.key) ?? 0,
      facts: facts.get(s.key)?.live ?? 0,
      related: (related.get(s.key) ?? []).filter((r) => labelOf.has(r.key)).map((r) => ({ key: r.key, label: labelOf.get(r.key), why: r.why })),
    }));
  const factsTotal = [...facts.values()].reduce((n, f) => n + f.live, 0);
  const newFacts = [...facts.values()].reduce((n, f) => n + f.fresh, 0);
  return {
    counts: { subcategories: subs.length, places: total, facts: factsTotal, newFacts },
    rows,
    atLeast: Boolean(loc?.capped),
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

const valueOfRow = (r) => (r ? { yesno: r.yesno, from: r.from_value, to: r.to_value, choice: r.choice } : null);
const same = (a, b) => JSON.stringify([a?.yesno ?? null, a?.from ?? null, a?.to ?? null, a?.choice ?? null])
  === JSON.stringify([b?.yesno ?? null, b?.from ?? null, b?.to ?? null, b?.choice ?? null]);

/**
 * Confirmed values of a fact at the places in a subcategory: a place's own
 * answer (a person's correction first, then our sources' verified answer).
 * A default is not a confirmation; it is what is being checked.
 */
async function confirmedIn(sub, attributeKey) {
  const { rows } = await query(
    `with f as (${FILED_SQL})
     select f.venue_ref,
            v.yesno as p_yesno, v.from_value as p_from, v.to_value as p_to, v.choice as p_choice, v.set_by,
            a.state, a.yesno as a_yesno, a.from_value as a_from, a.to_value as a_to, a.choice as a_choice
       from (select distinct venue_ref from f where sub = $1) f
       left join place_attribute_values v on v.venue_ref = f.venue_ref and v.attribute_key = $2 and v.set_by is not null
       left join place_fact_answers a on a.venue_ref = f.venue_ref and a.attribute_key = $2
            and a.state in ('yes', 'no') and a.hidden_at is null`,
    [sub, attributeKey]);
  const out = [];
  for (const r of rows) {
    if (r.set_by) out.push({ ref: r.venue_ref, value: { yesno: r.p_yesno, from: r.p_from, to: r.p_to, choice: r.p_choice } });
    else if (r.state) out.push({ ref: r.venue_ref, value: r.state === 'no' && r.a_yesno == null ? { yesno: false } : { yesno: r.a_yesno, from: r.a_from, to: r.a_to, choice: r.a_choice } });
  }
  return { places: rows.length, confirmed: out };
}

/**
 * One subcategory's page: its defaults, its facts, and the places filed here
 * as a secondary.
 */
export async function subcategoryPage(key) {
  const cfg = (await settings()).values;
  const [{ rows: [sub] }, { rows: attrs }, { rows: defaults }, { rows: facts }, { rows: secondary }, related] = await Promise.all([
    query(`select s.key, s.label, s.category_key, c.label as category_label, s.active
             from shelf_subcategories s join shelf_categories c on c.key = s.category_key where s.key = $1`, [key]),
    query(`select key, label, kind, options, standard, access, age from place_attributes where active`),
    query(`select * from shelf_subcategory_attributes where subcategory_key = $1`, [key]),
    query(`select sf.*, a.label, a.standard,
                  (select count(distinct x.venue_ref)::int from place_fact_answers x
                    where x.attribute_key = sf.attribute_key and x.state = 'yes' and x.hidden_at is null
                      and x.venue_ref in (select venue_ref from (${FILED_SQL}) f where f.sub = sf.subcategory_key)) as places_with
             from subcategory_facts sf join place_attributes a on a.key = sf.attribute_key
            where sf.subcategory_key = $1 and a.active order by a.label`, [key]),
    query(`select count(distinct f.venue_ref)::int n from (${FILED_SQL}) f where f.sub = $1 and not f.is_primary`, [key]),
    relatedPairs(),
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
    const { confirmed } = d ? await confirmedIn(key, k) : { confirmed: [] };
    const agree = confirmed.filter((c) => same(c.value, value)).length;
    const person = d?.origin === 'person' || (d && d.settled);
    // Amber (C49): a person-set default most confirmed places contradict — at
    // least three confirmed, more than half of them disagree.
    const contradicted = Boolean(person && confirmed.length >= 3 && (confirmed.length - agree) * 2 > confirmed.length);
    defaultRows.push({
      fact: k,
      label: attr.label,
      value: d ? wordOf(attr, value, cfg) : null,
      setBy: !d ? null : person ? (d.set_by ?? 'A person') : 'Machine',
      setAt: d ? (d.set_at ?? d.updated_at) : null,
      origin: !d ? null : person ? 'person' : 'machine',
      basis: !d ? null
        : person ? (confirmed.length ? `${agree} of ${confirmed.length} confirmed places agree` : 'No confirmed places yet')
          : `Proposed from ${confirmed.length || 'its'} places · private until accepted`,
      contradicted,
      contradiction: contradicted ? `${confirmed.length - agree} of ${confirmed.length} confirmed places say otherwise` : null,
      options: optionsOf(attr, cfg),
    });
  }

  const factRows = facts.filter((f) => !f.standard).map((f) => ({
    fact: f.attribute_key,
    label: f.label,
    status: f.status,
    reason: f.reason,
    isNew: f.status === 'active' && f.active_since && (Date.now() - new Date(f.active_since).getTime()) < 30 * 86400_000,
    placesWith: f.places_with,
    verifiedPlaces: f.verified_places,
    firstSeen: f.first_seen,
    removedBy: f.removed_by,
  }));

  const { rows: labels } = await query('select key, label from shelf_subcategories where active');
  const labelOf = new Map(labels.map((l) => [l.key, l.label]));
  return {
    key: sub.key,
    label: sub.label,
    category: sub.category_key,
    categoryLabel: sub.category_label,
    defaults: defaultRows,
    facts: factRows,
    secondaryPlaces: secondary[0]?.n ?? 0,
    related: (related.get(key) ?? []).filter((r) => labelOf.has(r.key)).map((r) => ({ key: r.key, label: labelOf.get(r.key), why: r.why })),
  };
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
  if (!o) throw bad(`${optionKey} is not a value ${attr.label} takes.`);
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
                               or exists (select 1 from place_fact_answers a where a.venue_ref = f.venue_ref and a.attribute_key = $2 and a.state in ('yes','no') and a.hidden_at is null))::int own
       from f`, [list, fact]);
  return { applies: r.total - r.own, keep: r.own };
}

/** Set one default by a person, or several at once from the bulk bar. */
export async function setDefaults({ subs, fact, option, who, why = null }) {
  const list = [...new Set((subs ?? []).map(String))];
  if (!list.length) throw bad('Tick at least one subcategory.');
  const cfg = (await settings()).values;
  const impact = list.length > 1 ? await bulkImpact({ subs: list, fact }) : null;
  const out = await withTransaction(async (c) => {
    const attr = await attributeOf(c, fact);
    const o = valueFor(attr, option, cfg);
    const changes = [];
    for (const sub of list) {
      const { rows: [s] } = await c.query('select key, label from shelf_subcategories where key = $1 and active', [sub]);
      if (!s) throw bad(`${sub} is not one of our subcategories.`);
      const { rows: [was] } = await c.query(
        'select * from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2', [sub, fact]);
      const before = was ? wordOf(attr, valueOfRow(was), cfg) : '—';
      await writeDefault(c, sub, attr, o.value, who);
      changes.push(await logChange({
        client: c, who, area: 'Defaults', what: `${s.label} · ${attr.label}`, before, after: o.label,
        why: why ?? (impact ? `Applies to ${impact.applies} places without their own answer · ${impact.keep} keep their own` : null),
        subjectType: 'default', subjectId: `${sub}|${fact}`,
        undo: { kind: 'default', sub, fact, was: was ? { ...valueOfRow(was), settled: was.settled, origin: was.origin, set_by: was.set_by } : null },
      }));
    }
    return { changes, impact };
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
      client: c, who, area: 'Defaults', what: `${s?.label ?? sub} · ${attr.label}`,
      before: `${wordOf(attr, valueOfRow(d), cfg)} (proposed)`, after: `${wordOf(attr, valueOfRow(d), cfg)} (accepted)`,
      why: 'Accepted the machine\'s proposal', subjectType: 'default', subjectId: `${sub}|${fact}`,
      undo: { kind: 'default', sub, fact, was: { ...valueOfRow(d), settled: d.settled, origin: d.origin, set_by: d.set_by } },
    });
  });
  forgetAttributes();
  return out;
}

/** Put a default back exactly as it was (the toast's Undo). */
export async function undoDefault({ change, who }) {
  const { sub, fact, was } = change.undo;
  await withTransaction(async (c) => {
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
    await c.query('update bo_changes set undone_at = now(), undone_by = $2 where id = $1', [change.id, who]);
  });
  forgetAttributes();
}

// ---------------------------------------------------------------------------
// Facts on a subcategory, and related links.

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
      before: f.status === 'active' ? 'Active' : f.status === 'gathering' ? 'Gathering evidence' : 'Ignored', after: 'Removed',
      subjectType: 'subcategory_fact', subjectId: `${sub}|${fact}`,
      undo: { kind: 'subcategory_fact', sub, fact, was: { status: f.status, reason: f.reason } },
    });
  });
}

/**
 * Put a fact back (Excluded facts): Put back for facts a person removed,
 * Include anyway for facts ignored as being on nearly every place (C41).
 */
export async function restoreFact({ sub, fact, who, mode }) {
  return withTransaction(async (c) => {
    const { rows: [f] } = await c.query(
      `select sf.*, a.label, s.label as sub_label from subcategory_facts sf
         join place_attributes a on a.key = sf.attribute_key join shelf_subcategories s on s.key = sf.subcategory_key
        where sf.subcategory_key = $1 and sf.attribute_key = $2 for update of sf`, [sub, fact]);
    if (!f || f.status !== 'ignored') throw bad('That fact is not excluded here.');
    if (mode === 'put_back' && f.reason !== 'removed_by_a_person') throw bad('Only a fact a person removed can be put back.');
    if (mode === 'include_anyway' && f.reason !== 'on_nearly_every_place') throw bad('Only a fact ignored for being on nearly every place can be included anyway.');
    await c.query(
      `update subcategory_facts set status = 'active', reason = null, removed_by = null, removed_at = null,
         include_anyway = $3, active_since = coalesce(active_since, now()), updated_at = now()
        where subcategory_key = $1 and attribute_key = $2`, [sub, fact, mode === 'include_anyway']);
    return logChange({
      client: c, who, area: 'Facts', what: `${mode === 'put_back' ? 'Fact put back' : 'Fact included anyway'} · ${f.label} · ${f.sub_label}`,
      before: 'Ignored', after: 'Active', subjectType: 'subcategory_fact', subjectId: `${sub}|${fact}`,
      undo: { kind: 'subcategory_fact', sub, fact, was: { status: f.status, reason: f.reason } },
    });
  });
}

/** Undo a fact status change. */
export async function undoFact({ change, who }) {
  const { sub, fact, was } = change.undo;
  await withTransaction(async (c) => {
    await c.query(
      `update subcategory_facts set status = $3, reason = $4, removed_by = null, removed_at = null, updated_at = now()
        where subcategory_key = $1 and attribute_key = $2`, [sub, fact, was.status, was.reason]);
    await c.query('update bo_changes set undone_at = now(), undone_by = $2 where id = $1', [change.id, who]);
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
