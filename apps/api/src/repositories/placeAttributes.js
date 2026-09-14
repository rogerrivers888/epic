/**
 * Attributes: what a place is like, and when it suits you.
 *
 * The owner, 14 Sep 2026: "there's a very big difference between what a
 * 5-year-old can do and what a 12-year-old can do. I feel like we need the
 * ability to create these attributes."
 *
 * Two of these existed already as columns on `shelf_subcategories` — `indoor`
 * and `for_kids` — which meant a new one cost a migration. The list is open now
 * (migration 105): he names an attribute, picks its kind, and the controls
 * follow. A subcategory carries the default for every place in it, and a place
 * overrides it where it differs, which is the same narrowest-wins reading the
 * rest of the taxonomy uses.
 */

import { query } from '../db.js';

const TTL_MS = 5000;
let cache = null;
let cachedAt = 0;
export const forget = () => { cache = null; };

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** One value, in the shape the kind decides. Null everywhere means "nothing said". */
const valueOf = (row) => {
  if (!row) return null;
  if (row.yesno != null) return { yesno: row.yesno };
  if (row.from_value != null || row.to_value != null) return { from: row.from_value, to: row.to_value };
  if (row.choice != null) return { choice: row.choice };
  return null;
};

/** The vocabulary and every default, in one read. */
export async function attributes() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const [attrs, defs] = await Promise.all([
    query('select * from place_attributes order by position, label'),
    query('select * from shelf_subcategory_attributes'),
  ]);
  const bySub = new Map();
  for (const d of defs.rows) {
    const v = valueOf(d);
    if (!v) continue;
    const m = bySub.get(d.subcategory_key) ?? new Map();
    m.set(d.attribute_key, v);
    bySub.set(d.subcategory_key, m);
  }
  cache = { list: attrs.rows, byKey: new Map(attrs.rows.map((a) => [a.key, a])), bySubcategory: bySub };
  cachedAt = Date.now();
  return cache;
}

/** Name one, or change it. The key never moves once it exists, so renaming is free. */
export async function saveAttribute({ key, label, kind, blurb, options, rangeMin, rangeMax, unit, position, active }) {
  const k = key ? slug(key) : slug(label);
  if (!k) throw bad('An attribute needs a name.');
  // Our labels are one vocabulary, so a secondary label may not take the name
  // of a primary one. Two rows answering to `epic:water-park` would make a rule
  // written against it mean whichever the database happened to return first
  // (Codex, 14 Sep 2026).
  const { rows: clash } = await query('select label from shelf_subcategories where key = $1', [k]);
  if (clash[0]) throw bad(`${clash[0].label} is already one of our labels. Pick another name.`);
  if (kind && !['yesno', 'range', 'oneof'].includes(kind)) throw bad(`${kind} is not a kind of attribute.`);
  // Changing the kind would leave every value already set in the old shape — a
  // yes/no answer under an attribute that now wants a range. Refuse rather than
  // hand a screen data its controls cannot draw (Codex, 14 Sep 2026).
  if (kind) {
    const { rows: was } = await query('select kind from place_attributes where key = $1', [k]);
    if (was[0] && was[0].kind !== kind) {
      const { rows: used } = await query(
        `select (select count(*) from shelf_subcategory_attributes where attribute_key = $1)
              + (select count(*) from place_attribute_values where attribute_key = $1) as n`, [k]);
      if (Number(used[0]?.n ?? 0) > 0) {
        throw bad(`${k} is already set on ${used[0].n} of them as ${was[0].kind}. Clear those first, or make a new attribute.`);
      }
    }
  }
  const { rows } = await query(
    `insert into place_attributes (key, label, kind, blurb, options, range_min, range_max, unit, position, active)
     values ($1, $2, coalesce($3, 'yesno'), $4, coalesce($5::text[], '{}'), $6, $7, $8, coalesce($9, 100), coalesce($10, true))
     on conflict (key) do update
        set label      = coalesce($11, place_attributes.label),
            kind       = coalesce($3, place_attributes.kind),
            blurb      = coalesce($4, place_attributes.blurb),
            options    = coalesce($5::text[], place_attributes.options),
            range_min  = coalesce($6, place_attributes.range_min),
            range_max  = coalesce($7, place_attributes.range_max),
            unit       = coalesce($8, place_attributes.unit),
            position   = coalesce($9, place_attributes.position),
            active     = coalesce($10, place_attributes.active),
            updated_at = now()
     returning *`,
    // The label is `$2` on insert and `$11` on update: binding the key as the
    // label would rename "Kid friendly" to "kid-friendly" the first time
    // anything else about it changed (Codex, 14 Sep 2026).
    [k, label ?? k, kind ?? null, blurb ?? null, options ?? null, rangeMin ?? null, rangeMax ?? null, unit ?? null,
     position ?? null, active == null ? null : Boolean(active), label ?? null]);
  forget();
  return rows[0];
}

/**
 * The default for a whole drawer. A value of null clears it back to "nothing
 * said", which is not the same as "no": a castle is neither indoors nor out.
 */
export async function setDefault(subcategoryKey, attributeKey, value) {
  if (!subcategoryKey || !attributeKey) throw bad('Which drawer, and which attribute?');
  if (value == null) {
    await query('delete from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2',
      [subcategoryKey, attributeKey]);
    forget();
    return null;
  }
  const { rows } = await query(
    `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno, from_value, to_value, choice)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (subcategory_key, attribute_key) do update
        set yesno = excluded.yesno, from_value = excluded.from_value,
            to_value = excluded.to_value, choice = excluded.choice, updated_at = now()
     returning *`,
    [subcategoryKey, attributeKey, value.yesno ?? null, value.from ?? null, value.to ?? null, value.choice ?? null]);
  forget();
  return valueOf(rows[0]);
}

/**
 * What one place says for itself.
 *
 * `reason` is not decoration: the owner asked to "train AI as to why that is,
 * so it can make suggestions in future or do it to other similar activities",
 * and these are the examples that get shown back to it.
 */
export async function setValue(venueRef, attributeKey, value, { reason = null, by = null } = {}) {
  if (!venueRef || !attributeKey) throw bad('Which place, and which attribute?');
  // An empty object says nothing, and saying nothing is clearing it.
  const empty = value != null && value.yesno == null && value.from == null && value.to == null && value.choice == null;
  if (value == null || empty) {
    await query('delete from place_attribute_values where venue_ref = $1 and attribute_key = $2', [venueRef, attributeKey]);
    return null;
  }
  const { rows } = await query(
    `insert into place_attribute_values (venue_ref, attribute_key, yesno, from_value, to_value, choice, reason, set_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (venue_ref, attribute_key) do update
        set yesno = excluded.yesno, from_value = excluded.from_value, to_value = excluded.to_value,
            choice = excluded.choice, reason = excluded.reason, set_by = excluded.set_by, updated_at = now()
     returning *`,
    [venueRef, attributeKey, value.yesno ?? null, value.from ?? null, value.to ?? null, value.choice ?? null, reason, by]);
  return rows[0];
}

/**
 * What several places have been told about themselves, in one read. The search
 * path resolves a whole page of results, so it must not be a query per place.
 */
export async function valuesForMany(refs) {
  const list = [...new Set((refs ?? []).filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const { rows } = await query('select * from place_attribute_values where venue_ref = any($1::text[])', [list]);
  const out = new Map();
  for (const r of rows) {
    // A row with nothing in it is nothing said, not an override. Left in, it
    // would silence the drawer's answer (Codex, 14 Sep 2026).
    const v = valueOf(r);
    if (!v) continue;
    const m = out.get(r.venue_ref) ?? new Map();
    m.set(r.attribute_key, { ...v, reason: r.reason, setBy: r.set_by });
    out.set(r.venue_ref, m);
  }
  return out;
}

/** Everything one place has been told about itself. */
export async function valuesFor(venueRef) {
  const { rows } = await query('select * from place_attribute_values where venue_ref = $1', [venueRef]);
  return new Map(rows.map((r) => [r.attribute_key, valueOf(r) ? { ...valueOf(r), reason: r.reason, setBy: r.set_by } : null])
    .filter(([, v]) => v));
}

/**
 * What a place is, attribute by attribute: what it says for itself, else what
 * its drawer says, else nothing. `from` says which of the two answered, so a
 * screen can show what was inherited beside what was changed.
 */
export function resolveFor({ subcategory }, own, vocab) {
  const out = {};
  const drawer = (subcategory && vocab?.bySubcategory?.get(subcategory)) || new Map();
  for (const a of vocab?.list ?? []) {
    if (!a.active) continue;
    const mine = own?.get(a.key) ?? null;
    const theirs = drawer.get(a.key) ?? null;
    const value = mine ?? theirs;
    if (!value) continue;
    // `setAt`, not `from`: a range's own lower bound is called `from`, and
    // naming the provenance the same thing silently ate it.
    out[a.key] = { ...value, setAt: mine ? 'place' : 'subcategory' };
  }
  return out;
}

/** The corrections he has made, newest first — the examples a model is shown. */
export async function corrections(limit = 200) {
  const { rows } = await query(
    `select v.*, a.label as attribute_label, a.kind
       from place_attribute_values v join place_attributes a on a.key = v.attribute_key
      where v.reason is not null and v.reason <> ''
      order by v.updated_at desc limit $1`, [Math.min(500, Math.max(1, limit))]);
  return rows;
}
