/**
 * Facts: every fact Epic looks for, once each; a fact's page; the places that
 * have it; and the facts that are excluded (handover 4.2, 6.3; README "Facts").
 *
 * "Is Epic looking for this fact?" (subcategory_facts) and "does this place
 * have it?" (place_fact_answers) are different questions and never share a
 * list. The list is read-only; the only writes here are a person's correction
 * of one place's answer, and Put back / Include anyway on an excluded fact.
 */

import { query, withTransaction } from '../db.js';
import { logChange } from './changes.js';
import { settings } from './settings.js';
import { FILED_SQL, STANDARD, wordOf, optionsOf } from './categories.js';
import { describe, SOURCE_WORD } from './places.js';
import { forget as forgetAttributes } from '../repositories/placeAttributes.js';

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const missing = (message) => Object.assign(new Error(message), { status: 404, code: 'not_found' });

const STATUS_WORD = { active: 'Active', gathering: 'Gathering evidence', ignored: 'Ignored' };
const REASON_WORD = {
  on_nearly_every_place: 'On nearly every place',
  an_opinion: 'An opinion',
  a_condition: 'A condition',
  removed_by_a_person: 'Removed by a person',
};

/**
 * Places that have a fact: a person's correction saying yes, or our sources'
 * verified yes that is not hidden. A place counts once even when several
 * subcategories share it.
 */
const HAS_SQL = `
  select venue_ref, attribute_key from place_attribute_values
   where set_by is not null and (yesno is true or from_value is not null or choice is not null)
  union
  select venue_ref, attribute_key from place_fact_answers
   where state = 'yes' and hidden_at is null
     and not exists (select 1 from place_attribute_values v
                      where v.venue_ref = place_fact_answers.venue_ref and v.attribute_key = place_fact_answers.attribute_key
                        and v.set_by is not null and v.yesno is false)`;

/** Every fact, one row each (C46): Fact · Subcategories · Places with it · Status. */
export async function allFacts({ q = null, cat = null, sub = null, status = null } = {}) {
  const [{ rows: attrs }, { rows: uses }, { rows: has }] = await Promise.all([
    query(`select key, label, kind, standard from place_attributes where active order by label`),
    query(`select sf.attribute_key, sf.subcategory_key, sf.status, sf.reason, sf.active_since, s.label as sub_label, s.category_key
             from subcategory_facts sf join shelf_subcategories s on s.key = sf.subcategory_key where s.active`),
    query(`select attribute_key, count(distinct venue_ref)::int n from (${HAS_SQL}) h group by 1`),
  ]);
  const usesBy = new Map();
  for (const u of uses) usesBy.set(u.attribute_key, [...(usesBy.get(u.attribute_key) ?? []), u]);
  const hasBy = new Map(has.map((h) => [h.attribute_key, h.n]));
  const needle = q ? String(q).trim().toLowerCase() : null;

  const rows = [];
  for (const a of attrs) {
    const u = usesBy.get(a.key) ?? [];
    if (!a.standard && !u.length) continue; // looked for nowhere: not a fact Epic looks for
    const active = u.filter((x) => x.status === 'active');
    const gathering = u.filter((x) => x.status === 'gathering');
    const ignored = u.filter((x) => x.status === 'ignored');
    const st = a.standard || active.length ? 'active' : gathering.length ? 'gathering' : 'ignored';
    const isNew = active.some((x) => x.active_since && Date.now() - new Date(x.active_since).getTime() < 30 * 86400_000);
    rows.push({
      fact: a.key,
      label: a.label,
      standard: a.standard,
      subcategories: a.standard ? 'All' : st === 'ignored' && ignored.length === 1 ? ignored[0].sub_label : String(st === 'active' ? active.length : st === 'gathering' ? gathering.length : ignored.length),
      subcategoryCount: a.standard ? null : u.length,
      places: hasBy.get(a.key) ?? 0,
      status: st,
      statusText: st === 'active' ? (isNew ? 'New' : '') : STATUS_WORD[st],
      isNew,
      reason: st === 'ignored' ? (REASON_WORD[ignored[0]?.reason] ?? null) : null,
      cats: [...new Set(u.map((x) => x.category_key))],
      subs: u.map((x) => x.subcategory_key),
    });
  }
  const filtered = rows
    .filter((r) => !needle || r.label.toLowerCase().includes(needle))
    .filter((r) => !cat || r.standard || r.cats.includes(cat))
    .filter((r) => !sub || r.standard || r.subs.includes(sub))
    .filter((r) => !status || r.status === status);
  return {
    counts: {
      facts: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      gathering: rows.filter((r) => r.status === 'gathering').length,
      ignored: rows.filter((r) => r.status === 'ignored').length,
    },
    rows: filtered.map(({ cats, subs, ...r }) => r),
  };
}

/** A fact's page: the subcategories using it, or its definition if standard. */
export async function factPage(key) {
  const cfg = (await settings()).values;
  const { rows: [a] } = await query('select key, label, kind, options, standard, access, age, dietary, definition from place_attributes where key = $1', [key]);
  if (!a) throw missing(`${key} is not one of our facts.`);
  const { rows: [{ n: places }] } = await query(`select count(distinct venue_ref)::int n from (${HAS_SQL}) h where attribute_key = $1`, [key]);
  if (a.standard) {
    return { fact: a.key, label: a.label, standard: true, places, definition: definitionOf(a, cfg) };
  }
  const [{ rows: subs }, { rows: [{ n: conflicts }] }] = await Promise.all([
    query(`select sf.subcategory_key, sf.status, sf.reason, s.label, c.label as category_label,
                  (select count(distinct h.venue_ref)::int from (${HAS_SQL}) h
                    where h.attribute_key = sf.attribute_key
                      and h.venue_ref in (select venue_ref from (${FILED_SQL}) f where f.sub = sf.subcategory_key)) as places
             from subcategory_facts sf join shelf_subcategories s on s.key = sf.subcategory_key
             join shelf_categories c on c.key = s.category_key
            where sf.attribute_key = $1 and s.active order by s.label`, [key]),
    query(`select count(*)::int n from place_fact_answers where attribute_key = $1 and state = 'conflict'`, [key]),
  ]);
  const active = subs.filter((s) => s.status === 'active');
  const st = active.length ? 'active' : subs.some((s) => s.status === 'gathering') ? 'gathering' : 'ignored';
  return {
    fact: a.key,
    label: a.label,
    standard: false,
    status: st,
    statusText: STATUS_WORD[st],
    places,
    subcategories: subs.filter((s) => s.status !== 'ignored').map((s) => ({
      key: s.subcategory_key, label: s.label, category: s.category_label, places: s.places, status: s.status,
    })),
    conflicts,
    conflictLine: conflicts ? `${conflicts} place${conflicts === 1 ? '' : 's'} where our sources disagree — families will be asked` : null,
  };
}

/** A standard fact's definition: its shape and, where it has them, its bands. */
export function definitionOf(a, cfg) {
  if (a.kind === 'yesno') return { shape: 'Yes or no' };
  if (a.key === 'suits-ages') return { shape: 'Who it’s for', bands: (cfg.ageBands ?? []).map((b) => b.label) };
  if (a.key === 'duration') return { shape: 'How long', bands: (cfg.durationBands ?? []).map((b) => b.label) };
  if (a.key === 'cost-band') {
    const sym = { GBP: '£', EUR: '€' };
    return {
      shape: 'Cost per person',
      byCountry: Object.entries(cfg.costBands ?? {}).map(([country, v]) => ({
        country,
        currency: v.currency,
        bands: v.bands.map((b) => (b.to === 0 ? b.label
          : b.under != null ? `${b.label} under ${sym[v.currency] ?? ''}${b.under}`
            : b.over != null ? `${b.label} over ${sym[v.currency] ?? ''}${b.over}`
              : `${b.label} ${sym[v.currency] ?? ''}${b.from}–${b.to}`)),
      })),
    };
  }
  return { shape: a.kind };
}

/**
 * The drill-down: only places that have the fact. Place · Area · How we know ·
 * Edit, with country, county and postcode filters and a search; footer "Looked
 * for at N places · found at M".
 */
export async function factPlaces(key, { sub = null, country = null, county = null, postcode = null, q = null, limit = 500 } = {}) {
  const cfg = (await settings()).values;
  const { rows: [a] } = await query('select key, label, kind, options, standard from place_attributes where key = $1', [key]);
  if (!a) throw missing(`${key} is not one of our facts.`);
  const args = [key];
  let subClause = '';
  if (sub) { args.push(sub); subClause = `and h.venue_ref in (select venue_ref from (${FILED_SQL}) f where f.sub = $${args.length})`; }
  const { rows } = await query(
    `select h.venue_ref,
            v.set_by, v.yesno as p_yesno, v.from_value as p_from, v.to_value as p_to, v.choice as p_choice,
            x.source, x.yesno, x.from_value, x.to_value, x.choice
       from (select distinct venue_ref, attribute_key from (${HAS_SQL}) z) h
       left join place_attribute_values v on v.venue_ref = h.venue_ref and v.attribute_key = h.attribute_key and v.set_by is not null
       left join place_fact_answers x on x.venue_ref = h.venue_ref and x.attribute_key = h.attribute_key
      where h.attribute_key = $1 ${subClause}`, args);
  const described = await describe(rows.map((r) => r.venue_ref));
  const needle = q ? String(q).trim().toLowerCase() : null;
  const pc = postcode ? String(postcode).trim().toUpperCase().replace(/\s+/g, '') : null;
  const out = rows.map((r) => {
    const d = described.get(r.venue_ref) ?? {};
    const value = r.set_by ? { yesno: r.p_yesno, from: r.p_from, to: r.p_to, choice: r.p_choice } : { yesno: r.yesno, from: r.from_value, to: r.to_value, choice: r.choice };
    return {
      ref: r.venue_ref,
      name: d.name,
      area: d.area,
      county: d.county,
      country: d.country,
      countryCode: d.countryCode,
      postcode: d.postcode,
      how: r.set_by ? SOURCE_WORD.person : SOURCE_WORD[r.source] ?? null,
      answer: a.kind === 'yesno' ? null : wordOf(a, value, cfg),
      options: optionsOf(a, cfg),
    };
  })
    .filter((r) => !country || r.countryCode === country || r.country === country)
    .filter((r) => !county || r.county === county)
    .filter((r) => !pc || String(r.postcode ?? '').toUpperCase().replace(/\s+/g, '').startsWith(pc))
    .filter((r) => !needle || String(r.name ?? '').toLowerCase().includes(needle))
    .sort((x, y) => String(x.name ?? '~').localeCompare(String(y.name ?? '~')));

  // Looked for: places in the subcategories that look for it (every filed
  // place for a standard fact), within the same subcategory filter.
  const lookedArgs = [];
  const conds = [];
  let join = '';
  if (!a.standard) {
    lookedArgs.push(key);
    join = `join subcategory_facts sf on sf.subcategory_key = f.sub and sf.attribute_key = $${lookedArgs.length} and sf.status = 'active'`;
  }
  if (sub) { lookedArgs.push(sub); conds.push(`f.sub = $${lookedArgs.length}`); }
  const lookedSql = `select count(distinct f.venue_ref)::int n from (${FILED_SQL}) f ${join} ${conds.length ? `where ${conds.join(' and ')}` : ''}`;
  const { rows: [{ n: lookedFor }] } = await query(lookedSql, lookedArgs);
  return {
    fact: a.key,
    label: a.label,
    kind: a.kind,
    rows: out.slice(0, limit),
    total: out.length,
    lookedFor,
    foundAt: out.length,
    counties: [...new Set(out.map((r) => r.county).filter(Boolean))].sort(),
    countries: [...new Set(out.map((r) => r.country).filter(Boolean))].sort(),
  };
}

/**
 * A person's correction of one place's answer: kept for good, logged, and
 * counted in accuracy (handover 6.3). Never overwritten by the machine.
 */
export async function correct({ ref, fact, option, why = null, who }) {
  const cfg = (await settings()).values;
  const out = await withTransaction(async (c) => {
    const { rows: [a] } = await c.query('select key, label, kind, options from place_attributes where key = $1 and active', [fact]);
    if (!a) throw bad(`${fact} is not one of our facts.`);
    const o = optionsOf(a, cfg).find((x) => x.key === option);
    if (!o) throw bad(`${option} is not a value ${a.label} takes.`);
    const { rows: [was] } = await c.query('select * from place_attribute_values where venue_ref = $1 and attribute_key = $2', [ref, fact]);
    const { rows: [machine] } = await c.query('select state, source, yesno, from_value, to_value, choice from place_fact_answers where venue_ref = $1 and attribute_key = $2', [ref, fact]);
    await c.query(
      `insert into place_attribute_values (venue_ref, attribute_key, yesno, from_value, to_value, choice, reason, set_by, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())
       on conflict (venue_ref, attribute_key) do update set yesno = excluded.yesno, from_value = excluded.from_value,
         to_value = excluded.to_value, choice = excluded.choice, reason = excluded.reason, set_by = excluded.set_by, updated_at = now()`,
      [ref, fact, o.value.yesno ?? null, o.value.from ?? null, o.value.to ?? null, o.value.choice ?? null, why ?? 'Corrected in Facts', who]);
    const d = (await describe([ref])).get(ref);
    const before = was?.set_by ? wordOf(a, { yesno: was.yesno, from: was.from_value, to: was.to_value, choice: was.choice }, cfg)
      : machine ? (machine.state === 'yes' || machine.state === 'no' ? wordOf(a, { yesno: machine.yesno, from: machine.from_value, to: machine.to_value, choice: machine.choice }, cfg) ?? (machine.state === 'no' ? 'No' : 'Yes') : 'Don’t know') : 'Don’t know';
    return logChange({
      client: c, who, area: 'Facts', what: `Place corrected · ${d?.name ?? ref} · ${a.label}`,
      before, after: o.label, why, subjectType: 'place_fact', subjectId: `${ref}|${fact}`,
      undo: { kind: 'correction', ref, fact, was: was ? { yesno: was.yesno, from: was.from_value, to: was.to_value, choice: was.choice, reason: was.reason, set_by: was.set_by } : null },
    });
  });
  forgetAttributes();
  return out;
}

/** Undo a correction: the place goes back to exactly what it held. */
export async function undoCorrection({ change, who }) {
  const { ref, fact, was } = change.undo;
  await withTransaction(async (c) => {
    if (!was) await c.query('delete from place_attribute_values where venue_ref = $1 and attribute_key = $2', [ref, fact]);
    else {
      await c.query(
        `update place_attribute_values set yesno = $3, from_value = $4, to_value = $5, choice = $6, reason = $7, set_by = $8, updated_at = now()
          where venue_ref = $1 and attribute_key = $2`,
        [ref, fact, was.yesno, was.from, was.to, was.choice, was.reason, was.set_by]);
    }
    await c.query('update bo_changes set undone_at = now(), undone_by = $2 where id = $1', [change.id, who]);
  });
  forgetAttributes();
}

/** Excluded facts: Feature · Subcategory · Why, with what can put each back. */
export async function excludedFacts() {
  const { rows } = await query(
    `select sf.subcategory_key, sf.attribute_key, sf.reason, sf.removed_by, sf.removed_at, a.label, s.label as sub_label
       from subcategory_facts sf join place_attributes a on a.key = sf.attribute_key
       join shelf_subcategories s on s.key = sf.subcategory_key
      where sf.status = 'ignored' and s.active order by a.label, s.label`);
  return rows.map((r) => ({
    fact: r.attribute_key,
    label: r.label,
    sub: r.subcategory_key,
    subLabel: r.sub_label,
    why: REASON_WORD[r.reason] ?? 'Ignored',
    action: r.reason === 'removed_by_a_person' ? 'put_back' : r.reason === 'on_nearly_every_place' ? 'include_anyway' : null,
    removedBy: r.removed_by,
    removedAt: r.removed_at,
  }));
}

export { STANDARD };
