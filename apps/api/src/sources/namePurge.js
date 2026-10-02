/**
 * The purge of stored provider names (owner, 1–2 Oct 2026).
 *
 * "Clear all stored provider-ref labels (household_places.label,
 * trip_stops.venue_name, trip_shortlist.venue_label, visits.venue_label),
 * logged, once the resolver is live so nothing goes nameless." Then: "Add all
 * five extra stores to the purge … no stored provider names anywhere", and
 * "file the purge as an Approval card (plain English, with counts) for me to
 * click."
 *
 * The stores are the same as the stop-storing trigger's (migration 341), so
 * what the purge clears is exactly what the trigger now refuses on the way in.
 * A row is cleared only when its reference is a licensed provider's
 * (epic_ref_true_source): a household's own pin, an open reference and a host's
 * own words are never touched, nor is household_places.nickname. A column that
 * may not be empty takes the reference itself (the "unnamed" convention); any
 * other is emptied.
 *
 * quote() counts, and changes nothing; it is what the approval card says.
 * run() clears every store in one transaction and writes one log row with the
 * counts — never a name.
 */

import { query, pool } from '../db.js';
import { tokeniseJson, refsInJson, rentedRefs } from './displayNames.js';

const RENTED = (ref) => `coalesce(epic_ref_true_source(${ref}), '') = any(epic_rented_sources())`;

/** Every column that keeps a name beside a place reference, as migration 341 lists them. */
export const STORES = [
  // A checklist item is cleared only when it is known to be a copy of the
  // trip's own names ('trip' — written so from now on, and judged on the
  // evidence for the items already there by migration 341). An organiser's
  // own words ('own') are never touched (Codex, 2 Oct 2026).
  { table: 'group_items', col: 'label', ref: 'venue_ref', mode: 'ref', said: 'group checklist items',
    only: `label_from = 'trip'` },
  { table: 'household_places', col: 'label', ref: 'venue_ref', mode: 'ref', said: 'saved places' },
  // A provider's snapshot of a saved or shortlisted place, kept before the rule.
  { table: 'household_places', col: 'venue', ref: 'venue_ref', mode: 'null', said: 'saved-place snapshots' },
  { table: 'trip_shortlist', col: 'venue', ref: 'venue_ref', mode: 'null', said: 'shortlist snapshots' },
  { table: 'trip_stops', col: 'venue_name', ref: 'venue_ref', mode: 'ref', said: 'trip stops' },
  { table: 'trip_shortlist', col: 'venue_label', ref: 'venue_ref', mode: 'ref', said: 'shortlist rows' },
  { table: 'visits', col: 'venue_label', ref: 'venue_ref', mode: 'ref', said: 'visits' },
  { table: 'trip_messages', col: 'venue_label', ref: 'venue_ref', mode: 'null', said: 'trip messages' },
  // A host's own words ('host') are never touched. A label with no record of
  // whose it is came from the wizard, the only writer of a provider reference,
  // which sends the picked place's own text with it — a provider's.
  { table: 'host_offers', col: 'venue_label', ref: 'venue_ref', mode: 'null', said: 'host offers',
    only: `venue_label_from is distinct from 'host'` },
  { table: 'orders', col: 'venue_label', ref: 'venue_ref', mode: 'null', said: 'orders' },
  { table: 'menus', col: 'venue_label', ref: 'venue_ref', mode: 'null', said: 'menus' },
  { table: 'place_menus', col: 'venue_label', ref: 'venue_ref', mode: 'null', said: 'place menus' },
  { table: 'rule_overrides', col: 'venue_label', ref: 'venue_ref', mode: 'null', said: 'shelf-teaching log rows' },
  { table: 'content_queue', col: 'place_label', ref: 'venue_ref', mode: 'null', said: 'content-queue rows' },
];

const keyOf = (s) => `${s.table}.${s.col}`;
const heldWhere = (s) => `${s.mode === 'ref'
  ? `${s.ref} is not null and ${s.col} is distinct from ${s.ref} and ${RENTED(s.ref)}`
  : `${s.ref} is not null and ${s.col} is not null and ${RENTED(s.ref)}`}${s.only ? ` and ${s.only}` : ''}`;

// A chat topic's tag label is only a fallback for when its anchor has gone.
// About a provider's stop it is that provider's name; about a day it reads
// "Sat 4 · <the first stop>", built from the same names — both are cleared,
// and the screen redraws them from the trip (routes/chat.js tagOf).
// A day's label is cleared only when it holds a provider's stop name — the
// name a stop on that day still keeps, so the topics go before the stops do
// (Codex, 2 Oct 2026). A day named from our own words keeps its fallback.
const CHAT = {
  key: 'chat_topics.tag_label', said: 'chat topic labels',
  where: `tag_label is not null and (
    (tag_kind = 'stop' and tag_ref is not null and ${RENTED('tag_ref')})
    or (tag_kind = 'day' and exists (select 1 from trip_stops ts
          where ts.day_id::text = chat_topics.tag_ref and ${RENTED('ts.venue_ref')}
            and ts.venue_name is distinct from ts.venue_ref and position(ts.venue_name in chat_topics.tag_label) > 0)))`,
};

// A plan session's saved search results, options and replies (migration 343,
// plansHolding below). The place ids stay; names come back from the resolver.
const PLAN = { key: 'plan_sessions.state', said: 'saved plan sessions' };

/**
 * The plan sessions still holding a provider's name: beside its reference
 * (migration 343 would empty it), or copied into words — a title, a reply —
 * which tokeniseJson puts back as the reference. Each with the state to write;
 * writing it goes through the trigger, which empties the rest.
 */
async function plansHolding(client) {
  const { rows } = await client.query(
    `select id, state, state is distinct from epic_strip_rented_names(state) as stripped from plan_sessions`);
  // Every session's references checked in one batch, not a query a session
  // (Codex, 2 Oct 2026).
  const all = new Set();
  for (const r of rows) for (const ref of refsInJson(r.state)) all.add(ref);
  const rented = await rentedRefs([...all]);
  const out = [];
  for (const r of rows) {
    const kept = await tokeniseJson(r.state, { rented });
    if (r.stripped || JSON.stringify(kept) !== JSON.stringify(r.state)) out.push({ id: r.id, kept });
  }
  return out;
}

/** What each store holds that the purge would clear. Changes nothing. */
export async function quote(client = { query }) {
  const byStore = {};
  for (const s of STORES) {
    const { rows: [r] } = await client.query(`select count(*)::int as n from ${s.table} where ${heldWhere(s)}`);
    byStore[keyOf(s)] = r.n;
  }
  const { rows: [c] } = await client.query(`select count(*)::int as n from chat_topics where ${CHAT.where}`);
  byStore[CHAT.key] = c.n;
  byStore[PLAN.key] = (await plansHolding(client)).length;
  const total = Object.values(byStore).reduce((a, b) => a + b, 0);
  return { total, byStore, said: Object.fromEntries([...STORES.map((s) => [keyOf(s), s.said]), [CHAT.key, CHAT.said], [PLAN.key, PLAN.said]]) };
}

/** The purge: every store cleared in one transaction, one log row with the counts. */
export async function run({ by = null, expected = null } = {}) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const byStore = {};
    // The topics first, while the stops still hold the names a day's label is judged by.
    const { rowCount } = await c.query(`update chat_topics set tag_label = null where ${CHAT.where}`);
    byStore[CHAT.key] = rowCount;
    for (const s of STORES) {
      const set = s.mode === 'ref' ? `${s.col} = ${s.ref}` : `${s.col} = null`;
      const { rowCount: n } = await c.query(`update ${s.table} set ${set} where ${heldWhere(s)}`);
      byStore[keyOf(s)] = n;
    }
    const plans = await plansHolding(c);
    for (const p of plans) await c.query('update plan_sessions set state = $2 where id = $1', [p.id, JSON.stringify(p.kept)]);
    byStore[PLAN.key] = plans.length;
    const cleared = Object.values(byStore).reduce((a, b) => a + b, 0);
    // Nothing is left behind: the same question asked again must answer nought.
    const after = await quote(c);
    if (after.total !== 0) throw new Error(`the purge left ${after.total} stored provider names behind`);
    const { rows: [log] } = await c.query(
      `insert into stored_name_purges (by, expected, cleared, by_store) values ($1, $2, $3, $4) returning *`,
      [by, Number.isSafeInteger(expected) ? expected : null, cleared, JSON.stringify(byStore)]);
    await c.query('commit');
    return { cleared, expected: log.expected, byStore, logId: log.id, at: log.at };
  } catch (err) {
    await c.query('rollback').catch(() => null);
    throw err;
  } finally { c.release(); }
}

/** The purges so far, newest first. */
export async function history(limit = 10) {
  const { rows } = await query('select * from stored_name_purges order by at desc limit $1', [limit]);
  return rows;
}
