/**
 * Accuracy: the machine against what families said after visiting (handover
 * 4.9, 6.3; C48). It tests the rules and the sources, not the places.
 *
 * A comparison is a family answer of Yes or No (never "Didn't notice") where
 * the machine had given Yes or No at the time. A person's correction in Facts
 * also counts: it is a person saying the machine was right or wrong.
 *
 * Under 10 answers a figure is "Building", never a percentage (F5). A place
 * has at most one disagreement per day, and one machine answer across its
 * rows.
 */

import { query } from '../db.js';
import { describe, SOURCE_WORD } from './places.js';

export const BUILDING_BELOW = 10;

/** The sources whose answers families check, in the order the screens list them. */
export const MACHINE_SOURCES = ['site', 'osm', 'wikipedia', 'wikidata'];

/** Every comparison, one row each. */
async function comparisons({ since = null } = {}) {
  const args = [];
  let where = `f.answer in ('yes','no') and f.machine_state in ('yes','no')`;
  if (since) { args.push(since); where += ` and f.answered_at >= $${args.length}`; }
  const { rows: fam } = await query(
    `select f.venue_ref, f.attribute_key, f.answer, f.machine_state, f.machine_source as source, f.answered_at as at,
            coalesce(f.subcategory_key, pi.subcategory) as sub
       from family_answers f left join place_index pi on pi.venue_ref = f.venue_ref where ${where}`, args);
  // A person's corrections, compared with what the machine had said at the
  // moment of the correction (fact_corrections freezes it).
  const cargs = [];
  let cwhere = `machine_state in ('yes','no')`;
  if (since) { cargs.push(since); cwhere += ` and at >= $${cargs.length}`; }
  const { rows: corr } = await query(
    `select venue_ref, attribute_key, answer, machine_state, machine_source as source, at, subcategory_key as sub
       from fact_corrections where ${cwhere}`, cargs);
  return [...fam, ...corr].map((r) => ({ ...r, agreed: r.answer === r.machine_state }));
}

/** Figures for a set of comparisons, with the can't-speak state. */
export function figure(list) {
  const answered = list.length;
  const agreed = list.filter((c) => c.agreed).length;
  // One disagreement per place per day.
  const seen = new Set();
  let disagreements = 0;
  for (const c of list.filter((x) => !x.agreed)) {
    const k = `${c.venue_ref}|${new Date(c.at).toISOString().slice(0, 10)}`;
    if (!seen.has(k)) { seen.add(k); disagreements += 1; }
  }
  return {
    answered,
    agreed,
    disagreements,
    accuracy: answered < BUILDING_BELOW ? null : Math.round((agreed / answered) * 100),
    building: answered < BUILDING_BELOW,
  };
}

/** Group comparisons by a key, figures for each, worst first. */
function grouped(list, keyOf) {
  const m = new Map();
  for (const c of list) { const k = keyOf(c); if (k != null) m.set(k, [...(m.get(k) ?? []), c]); }
  return [...m.entries()].map(([k, l]) => ({ key: k, ...figure(l) }))
    .sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101) || b.answered - a.answered);
}

/**
 * The main page: headline (all sources), chart (monthly for 12 months, or
 * daily for 30 days), the source control's figures, and the table by fact or
 * by category, filtered by source.
 */
export async function accuracy({ view = 'fact', source = null, chart = 'monthly' } = {}) {
  const all = await comparisons();
  const [{ rows: attrs }, { rows: subs }] = await Promise.all([
    query('select key, label from place_attributes'),
    query('select s.key, s.label, s.category_key, c.label as category_label from shelf_subcategories s join shelf_categories c on c.key = s.category_key'),
  ]);
  const attrLabel = new Map(attrs.map((a) => [a.key, a.label]));
  const subBy = new Map(subs.map((s) => [s.key, s]));
  const headline = figure(all);

  const now = new Date();
  const series = chart === 'daily'
    ? Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (29 - i));
      const e = new Date(d.getTime() + 86400_000);
      return { at: d, ...figure(all.filter((c) => new Date(c.at) >= d && new Date(c.at) < e)) };
    })
    : Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      const e = new Date(now.getFullYear(), now.getMonth() - (10 - i), 1);
      return { at: d, ...figure(all.filter((c) => new Date(c.at) >= d && new Date(c.at) < e)) };
    });

  const gotSrc = new Map(grouped(all, (c) => c.source ?? null).map((r) => [r.key, r]));
  const bySource = [...MACHINE_SOURCES, ...[...gotSrc.keys()].filter((k) => !MACHINE_SOURCES.includes(k))]
    .map((k) => ({ ...(gotSrc.get(k) ?? { key: k, ...figure([]) }), label: SOURCE_WORD[k] ?? k }));
  const filtered = source ? all.filter((c) => c.source === source) : all;
  const table = view === 'category'
    ? grouped(filtered, (c) => subBy.get(c.sub)?.category_key ?? null).map((r) => ({
      ...r,
      label: subs.find((s) => s.category_key === r.key)?.category_label ?? r.key,
      subcategories: grouped(filtered.filter((c) => subBy.get(c.sub)?.category_key === r.key), (c) => c.sub)
        .map((s) => ({
          ...s,
          label: subBy.get(s.key)?.label ?? s.key,
          // The prototype's second column on a subcategory row: how many facts it was compared on.
          facts: new Set(filtered.filter((c) => c.sub === s.key).map((c) => c.attribute_key)).size,
        })),
    }))
    : grouped(filtered, (c) => c.attribute_key).map((r) => ({
      ...r,
      label: attrLabel.get(r.key) ?? r.key,
      subcategories: new Set(filtered.filter((c) => c.attribute_key === r.key).map((c) => c.sub).filter(Boolean)).size,
    }));
  // Every name the table could show, whatever the view or source: the first
  // column is sized from these once, so it — and the toolbar measured to the
  // table — stays the same width as the view and the source change
  // (prototype `accFactW`, logic.js 3345; audit 28 Sep 2026).
  const names = {
    facts: [...new Set(all.map((c) => attrLabel.get(c.attribute_key) ?? c.attribute_key).filter(Boolean))],
    categories: [...new Set(all.map((c) => subBy.get(c.sub)?.category_label).filter(Boolean))],
    subcategories: [...new Set(all.map((c) => subBy.get(c.sub)?.label).filter(Boolean))],
  };
  return {
    headline,
    series,
    names,
    sources: bySource,
    source,
    sourceCompared: source ? filtered.length : null,
    view,
    table,
  };
}

/**
 * A row's health view: By source and By subcategory side by side (By fact
 * when the row is a category's subcategory). `kind` is fact | category |
 * subcategory.
 */
export async function health({ kind, key, source = null }) {
  const all = await comparisons();
  const { rows: subs } = await query('select key, label, category_key from shelf_subcategories');
  const { rows: attrs } = await query('select key, label from place_attributes');
  const subBy = new Map(subs.map((s) => [s.key, s]));
  const attrLabel = new Map(attrs.map((a) => [a.key, a.label]));
  const mine = all.filter((c) => (kind === 'fact' ? c.attribute_key === key
    : kind === 'category' ? subBy.get(c.sub)?.category_key === key
      : c.sub === key));
  const scoped = source ? mine.filter((c) => c.source === source) : mine;
  const head = figure(scoped);
  const { rows: cats } = await query('select key, label from shelf_categories');
  const label = kind === 'fact' ? attrLabel.get(key) ?? key
    : kind === 'category' ? cats.find((c) => c.key === key)?.label ?? key
      : subBy.get(key)?.label ?? key;
  // Every machine source has a row, compared or not, so a source nobody has
  // checked reads "Building" rather than being missing from the table.
  const got = new Map(grouped(mine, (c) => c.source ?? null).map((r) => [r.key, r]));
  const bySource = [...MACHINE_SOURCES, ...[...got.keys()].filter((k) => !MACHINE_SOURCES.includes(k))]
    .map((k) => ({ ...(got.get(k) ?? { key: k, ...figure([]) }), label: SOURCE_WORD[k] ?? k }));
  return {
    kind, key, label,
    headline: head,
    subcategoryCount: new Set(scoped.map((c) => c.sub).filter(Boolean)).size,
    factCount: new Set(scoped.map((c) => c.attribute_key).filter(Boolean)).size,
    bySource,
    second: kind === 'subcategory'
      ? { by: 'fact', rows: grouped(scoped, (c) => c.attribute_key).map((r) => ({ ...r, label: attrLabel.get(r.key) ?? r.key })) }
      : { by: 'subcategory', rows: grouped(scoped, (c) => c.sub).map((r) => ({ ...r, label: subBy.get(r.key)?.label ?? r.key })) },
  };
}

/**
 * A source's disagreements, place by place: Place · Subcategory · Source said
 * · Families said · Date. One per place per day.
 */
export async function disagreements({ kind, key, source, q = null }) {
  const all = await comparisons();
  const { rows: subs } = await query('select key, label, category_key from shelf_subcategories');
  const { rows: attrs } = await query('select key, label from place_attributes');
  const attrLabel = new Map(attrs.map((a) => [a.key, a.label]));
  const subBy = new Map(subs.map((s) => [s.key, s]));
  const list = all.filter((c) => !c.agreed && c.source === source && (kind === 'fact' ? c.attribute_key === key
    : kind === 'category' ? subBy.get(c.sub)?.category_key === key : c.sub === key));
  const seen = new Set();
  const once = list.filter((c) => { const k = `${c.venue_ref}|${new Date(c.at).toISOString().slice(0, 10)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const d = await describe(once.map((c) => c.venue_ref));
  const needle = q ? String(q).trim().toLowerCase() : null;
  const WORD = { yes: 'Yes', no: 'No' };
  return {
    source,
    label: SOURCE_WORD[source] ?? source,
    rows: once.map((c) => ({
      ref: c.venue_ref, place: d.get(c.venue_ref)?.name ?? null, subcategory: subBy.get(c.sub)?.label ?? null,
      fact: attrLabel.get(c.attribute_key) ?? c.attribute_key,
      sourceSaid: WORD[c.machine_state], familiesSaid: WORD[c.answer], date: c.at,
    })).filter((r) => !needle || String(r.place ?? '').toLowerCase().includes(needle))
      .sort((a, b) => new Date(b.date) - new Date(a.date)),
  };
}
