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
  const [attrs, defs, brings, carries] = await Promise.all([
    query('select * from place_attributes order by position, label'),
    query('select * from shelf_subcategory_attributes'),
    query('select * from attribute_brings'),
    query('select * from taxonomy_label_carries'),
  ]);
  const bySub = new Map();
  for (const d of defs.rows) {
    const v = valueOf(d);
    if (!v) continue;
    const m = bySub.get(d.subcategory_key) ?? new Map();
    m.set(d.attribute_key, v);
    bySub.set(d.subcategory_key, m);
  }
  // What each label brings, and as what (migration 114).
  const broughtBy = new Map();
  for (const r of brings.rows) {
    const v = valueOf(r);
    if (!v) continue;
    broughtBy.set(r.attribute_key, [...(broughtBy.get(r.attribute_key) ?? []), { key: r.brings_key, value: v }]);
  }
  const list = attrs.rows.map((a) => ({ ...a, brings: broughtBy.get(a.key) ?? [] }));
  // What a provider's word says besides where it sends a place (migration 123).
  // The owner, 14 Sep 2026: "I see a fine dining restaurant, but no label for
  // fine dining. It's just mapped to food and drinks, restaurants." The drawer
  // was right and everything else the word said was going on the floor.
  const carriedBy = new Map();
  for (const r of carries.rows) {
    const v = valueOf(r);
    if (!v) continue;
    const label = `${r.namespace}:${r.key}`;
    carriedBy.set(label, [...(carriedBy.get(label) ?? []), { key: r.attribute_key, value: v }]);
  }
  cache = { list, byKey: new Map(list.map((a) => [a.key, a])), bySubcategory: bySub, carriedBy };
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
              + (select count(*) from place_attribute_values where attribute_key = $1)
              + (select count(*) from attribute_brings where brings_key = $1)
              -- And what provider words carry, which is 128 values on Cuisine
              -- alone: changing the kind under them would leave every one of
              -- them the wrong shape (Codex, 14 Sep 2026).
              + (select count(*) from taxonomy_label_carries where attribute_key = $1) as n`, [k]);
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
 * What one of our labels brings with it, and as what. A null value forgets it.
 *
 * The owner, 14 Sep 2026: "let us add labels that are always added when one
 * label is added." Both sides are ours, and it is stored the way a drawer's
 * default is, because it is the same kind of statement.
 */
export async function setBrings(attributeKey, bringsKey, value) {
  if (!attributeKey || !bringsKey) throw bad('Which label, and what does it bring?');
  if (attributeKey === bringsKey) throw bad('A label cannot bring itself.');
  if (value == null) {
    await query('delete from attribute_brings where attribute_key = $1 and brings_key = $2', [attributeKey, bringsKey]);
    forget();
    return null;
  }
  const { rows } = await query(
    `insert into attribute_brings (attribute_key, brings_key, yesno, from_value, to_value, choice)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (attribute_key, brings_key) do update
        set yesno = excluded.yesno, from_value = excluded.from_value,
            to_value = excluded.to_value, choice = excluded.choice
     returning *`,
    [attributeKey, bringsKey, value.yesno ?? null, value.from ?? null, value.to ?? null, value.choice ?? null]);
  forget();
  return valueOf(rows[0]);
}

/**
 * What a provider's word carries besides where it sends a place.
 *
 * The owner, 14 Sep 2026: "I see a fine dining restaurant, but no label for
 * fine dining." `points_at` says where a word sends a place; this says what
 * else it tells us, and the two are set independently — italian_restaurant
 * still sends a place to Restaurants and now also says Italian.
 */
export async function setCarries(label, attributeKey, value) {
  const [namespace, ...rest] = String(label ?? '').split(':');
  const key = rest.join(':');
  if (!namespace || !key || !attributeKey) throw bad('Which word, and which label?');
  if (value == null) {
    await query('delete from taxonomy_label_carries where namespace = $1 and key = $2 and attribute_key = $3',
      [namespace, key, attributeKey]);
    forget();
    return null;
  }
  await mustFit(attributeKey, value);
  const { rows } = await query(
    `insert into taxonomy_label_carries (namespace, key, attribute_key, yesno, from_value, to_value, choice)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (namespace, key, attribute_key) do update
        set yesno = excluded.yesno, from_value = excluded.from_value,
            to_value = excluded.to_value, choice = excluded.choice
     returning *`,
    [namespace, key, attributeKey, value.yesno ?? null, value.from ?? null, value.to ?? null, value.choice ?? null]);
  forget();
  return valueOf(rows[0]);
}

/** Every word that carries a secondary label, for the words list. */
export async function carriedByWord() {
  const { rows } = await query('select * from taxonomy_label_carries');
  const out = new Map();
  for (const r of rows) {
    const v = valueOf(r);
    if (!v) continue;
    const label = `${r.namespace}:${r.key}`;
    out.set(label, [...(out.get(label) ?? []), { key: r.attribute_key, value: v }]);
  }
  return out;
}

/**
 * The default for a whole drawer. A value of null clears it back to "nothing
 * said", which is not the same as "no": a castle is neither indoors nor out.
 */
/**
 * A value has to be the shape its label is.
 *
 * Nothing checked this, so a control offering Yes and No against a range wrote
 * `{yesno:true}` into a row meant to hold two numbers, and everything
 * downstream read a range with no bounds (the audit, 15 Sep 2026). The database
 * triggers do this for a brought value; a drawer's default and a place's own
 * answer had no equivalent.
 */
export async function mustFit(attributeKey, value) {
  const { byKey } = await attributes();
  const a = byKey.get(attributeKey);
  if (!a) throw bad(`${attributeKey} is not one of our secondary labels.`);
  const has = (k) => value?.[k] != null;
  if (a.kind === 'yesno' && !has('yesno')) throw bad(`${a.label} is a yes or no.`);
  if (a.kind === 'range' && !has('from') && !has('to')) throw bad(`${a.label} is a range \u2014 it needs a number at one end at least.`);
  if (a.kind === 'oneof') {
    if (!has('choice')) throw bad(`${a.label} is one of a list.`);
    if (!(a.options ?? []).includes(value.choice)) throw bad(`${value.choice} is not one of ${a.label}'s choices.`);
  }
  if (a.kind !== 'yesno' && has('yesno')) throw bad(`${a.label} is not a yes or no.`);
  if (a.kind !== 'range' && (has('from') || has('to'))) throw bad(`${a.label} is not a range.`);
  if (a.kind !== 'oneof' && has('choice')) throw bad(`${a.label} is not one of a list.`);
  if (a.kind === 'range' && has('from') && has('to') && Number(value.from) > Number(value.to)) {
    throw bad(`${a.label} runs from the smaller number to the larger one.`);
  }
}

export async function setDefault(subcategoryKey, attributeKey, value) {
  if (!subcategoryKey || !attributeKey) throw bad('Which drawer, and which attribute?');
  if (value == null) {
    await query('delete from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2',
      [subcategoryKey, attributeKey]);
    forget();
    return null;
  }
  await mustFit(attributeKey, value);
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
/**
 * @param client  A transaction to write inside, where several labels are one
 *   answer and have to land together or not at all (Codex, 16 Sep 2026).
 */
export async function setValue(venueRef, attributeKey, value, { reason = null, by = null, client = null } = {}) {
  const run = client ? (t, a) => client.query(t, a) : query;
  if (!venueRef || !attributeKey) throw bad('Which place, and which attribute?');
  // An empty object says nothing, and saying nothing is clearing it.
  const empty = value != null && value.yesno == null && value.from == null && value.to == null && value.choice == null;
  if (value == null || empty) {
    await run('delete from place_attribute_values where venue_ref = $1 and attribute_key = $2', [venueRef, attributeKey]);
    return null;
  }
  await mustFit(attributeKey, value);
  const { rows } = await run(
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
export function resolveFor({ subcategory, words = [], alsoTrue = null }, own, vocab) {
  const out = {};
  const drawer = (subcategory && vocab?.bySubcategory?.get(subcategory)) || new Map();
  // What this place's own provider words say. A word is more specific than the
  // drawer's default -- every restaurant is not Italian -- and less specific
  // than something set on the place by hand, so it sits between them.
  const fromWords = new Map();
  for (const w of words) {
    for (const c of vocab?.carriedBy?.get(w) ?? []) if (!fromWords.has(c.key)) fromWords.set(c.key, c.value);
  }
  // Epic's own derived fields say the same thing for a place that came from the
  // sweep. A swept place keeps no provider words -- licensed content is rented,
  // and Google's type list is Google's -- so the cuisine the sweep worked out
  // for itself is what answers here (Codex, 14 Sep 2026: otherwise a stored
  // place typed fine dining never gets the label in a swept area, which is
  // every area that matters). Same standing as a word: below a hand-set value.
  for (const [k, v] of Object.entries(alsoTrue ?? {})) {
    if (!v || fromWords.has(k)) continue;
    const a = vocab?.byKey?.get(k);
    if (!a?.active) continue;
    // A one-of value has to be on its own list, or a filter would offer a
    // choice nothing can ever match.
    if (a.kind === 'oneof' && !(a.options ?? []).includes(v.choice)) continue;
    fromWords.set(k, v);
  }
  for (const a of vocab?.list ?? []) {
    if (!a.active) continue;
    const mine = own?.get(a.key) ?? null;
    const said = fromWords.get(a.key) ?? null;
    const theirs = drawer.get(a.key) ?? null;
    const value = mine ?? said ?? theirs;
    if (!value) continue;
    // `setAt`, not `from`: a range's own lower bound is called `from`, and
    // naming the provenance the same thing silently ate it.
    out[a.key] = { ...value, setAt: mine ? 'place' : said ? 'word' : 'subcategory' };
  }
  // What the labels it already has bring with them (owner, 14 Sep 2026: "let us
  // add labels that are always added when one label is added"). Marked so a
  // screen can draw it in lime and never confuse it with something somebody
  // chose. Anything already said stands: what comes along never overwrites.
  const byKey = new Map((vocab?.list ?? []).map((a) => [a.key, a]));
  const seen = new Set(Object.keys(out));
  // Only a label the place actually has brings anything: "not a splash pad"
  // must not hand out free (Codex, 14 Sep 2026).
  const says = (v) => v && v.yesno !== false;
  const queue = Object.keys(out).filter((k) => says(out[k]));
  while (queue.length) {
    const from = byKey.get(queue.shift());
    for (const b of from?.brings ?? []) {
      if (seen.has(b.key)) continue;
      const brought = byKey.get(b.key);
      if (!brought?.active) continue;
      seen.add(b.key);
      // It arrives as the value it is brought as, which is how a range can be
      // brought at all: splash pad brings suits ages 0 to 7, not a bare yes.
      out[b.key] = { ...b.value, setAt: 'came', came: from.key };
      if (says(b.value)) queue.push(b.key);
    }
  }
  return out;
}

/**
 * How many places carry each secondary label, said on a place rather than
 * inherited (the handoff, BO7a).
 *
 * Deliberately not merged with "set by default in". Two columns, two units:
 * coverage is 45 of 59 subcategories, and this is a count of places. Where a
 * label is only ever a drawer default, what we know about it is coverage and
 * the place count is nothing — drawn as an em dash rather than a nought, which
 * would claim we had looked and found none.
 */
export async function placeCounts() {
  const { rows } = await query(
    `select attribute_key, count(distinct venue_ref)::int as n
       from place_attribute_values group by attribute_key`);
  return Object.fromEntries(rows.map((r) => [r.attribute_key, r.n]));
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
