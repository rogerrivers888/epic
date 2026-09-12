/**
 * The label vocabulary: which words each source uses, and how often each has
 * been seen on a real place.
 *
 * Two halves. The words the code already knows — every map in the source
 * modules, Google's published type list, the closed experience vocabulary —
 * are written in once per process by `ensureKnown`, so the table can never
 * drift from the code that reads those words. Everything else arrives by being
 * seen: `observe` counts the labels on every search result that comes back,
 * batched, so a Google type nobody wrote down still shows up on the screen the
 * first time a real place carries it.
 *
 * Wikidata is deliberately not copied in. `place_kinds` already is that
 * vocabulary — the Q-number, its English name, and a seen-count kept by the
 * harvest — so `list()` reads the two tables as one.
 */

import { query } from '../db.js';

let known = false;

/** Write the code's own vocabulary in, once. Idempotent; a rename in code renames the row. */
export async function ensureKnown(entries) {
  if (known || !entries?.length) return;
  const namespaces = []; const keys = []; const labels = []; const notes = [];
  for (const e of entries) {
    namespaces.push(e.namespace); keys.push(e.key); labels.push(e.label ?? null); notes.push(e.note ?? null);
  }
  await query(
    `insert into taxonomy_labels (namespace, key, label, note, seeded)
     select u.namespace, u.key, u.label, u.note, true
       from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as u(namespace, key, label, note)
     on conflict (namespace, key) do update
        set label = coalesce(excluded.label, taxonomy_labels.label),
            note = coalesce(excluded.note, taxonomy_labels.note),
            seeded = true,
            updated_at = now()`,
    [namespaces, keys, labels, notes]);
  known = true;
}

// ---------------------------------------------------------------------------
// seeing labels on real places
// ---------------------------------------------------------------------------

const pending = new Map();
let timer = null;
const FLUSH_MS = 20_000;
const FLUSH_AT = 400;

async function flush() {
  timer = null;
  if (!pending.size) return;
  const batch = [...pending.entries()];
  pending.clear();
  const namespaces = []; const keys = []; const counts = [];
  for (const [label, n] of batch) {
    const i = label.indexOf(':');
    if (i <= 0) continue;
    namespaces.push(label.slice(0, i)); keys.push(label.slice(i + 1)); counts.push(n);
  }
  if (!keys.length) return;
  try {
    await query(
      `insert into taxonomy_labels (namespace, key, seen_count)
       select u.namespace, u.key, u.n
         from unnest($1::text[], $2::text[], $3::int[]) as u(namespace, key, n)
       on conflict (namespace, key) do update
          set seen_count = taxonomy_labels.seen_count + excluded.seen_count,
              updated_at = now()`,
      [namespaces, keys, counts]);
  } catch {
    // A count is a count; losing a batch is not worth failing a search over.
  }
}

/**
 * Count these labels as seen once each. Wikidata types are not counted here
 * — the harvest keeps `place_kinds.seen_count` itself.
 */
export function observe(labels) {
  for (const l of labels ?? []) {
    if (!l || l.startsWith('wikidata:')) continue;
    pending.set(l, (pending.get(l) ?? 0) + 1);
  }
  if (pending.size >= FLUSH_AT) void flush();
  else if (!timer) { timer = setTimeout(() => void flush(), FLUSH_MS); timer.unref?.(); }
}

/** For a test, or a shutdown: write what is waiting. */
export const flushNow = () => flush();

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/**
 * The vocabulary, one namespace or all of them, in one shape whichever table
 * a row came from. `seenOnly` keeps the eight thousand Wikidata types that no
 * atlas place has ever carried off a list somebody has to scroll.
 */
export async function list({ namespace = null, q = null, seenOnly = false, limit = 500, offset = 0 } = {}) {
  const args = [];
  const where = [];
  if (namespace) { args.push(namespace); where.push(`namespace = $${args.length}`); }
  if (q) { args.push(`%${q}%`); where.push(`(key ilike $${args.length} or label ilike $${args.length})`); }
  if (seenOnly) where.push('seen_count > 0');
  args.push(Math.min(20000, Math.max(1, limit)));
  const lim = args.length;
  args.push(Math.max(0, offset));
  const off = args.length;
  const { rows } = await query(
    `with all_labels as (
       select namespace, key, label, note, seen_count, active, seeded, decision from taxonomy_labels
       union all
       select 'wikidata', qid, label, category, seen_count, admit, true, null from place_kinds
     )
     select * from all_labels
     ${where.length ? `where ${where.join(' and ')}` : ''}
     -- Fully ordered, so a page taken by offset neither repeats nor skips a row (Codex, 12 Sep 2026).
     order by seen_count desc, coalesce(label, key), namespace, key
     limit $${lim} offset $${off}`, args);
  return rows;
}

/** How big each namespace is, and how much of it has actually been seen. */
export async function counts() {
  const { rows } = await query(
    `with all_labels as (
       select namespace, seen_count from taxonomy_labels
       union all
       select 'wikidata', seen_count from place_kinds
     )
     select namespace, count(*)::int as total, count(*) filter (where seen_count > 0)::int as seen
       from all_labels group by namespace`);
  return new Map(rows.map((r) => [r.namespace, { total: r.total, seen: r.seen }]));
}

/** One label's row, from whichever table holds it. */
export async function one(namespace, key) {
  if (namespace === 'wikidata') {
    const { rows } = await query(
      `select 'wikidata' as namespace, qid as key, label, category as note, seen_count, admit as active, true as seeded
         from place_kinds where qid = $1`, [key]);
    return rows[0] ?? null;
  }
  const { rows } = await query('select * from taxonomy_labels where namespace = $1 and key = $2', [namespace, key]);
  return rows[0] ?? null;
}

/** Give a label its English name, or switch it off. Wikidata's names come from "Name the types". */
export async function save({ namespace, key, label, note, active, decision }) {
  // A decision is one of three: 'aside' (not a day out; active goes false),
  // 'nearby' (useful beside one), or 'none' to clear it. Left out, it keeps.
  // The two fields stay in step both ways: a decision sets `active`, and an
  // explicit `active` clears or sets an aside decision (Codex, 13 Sep 2026).
  const d = decision === undefined ? null : decision === null || decision === 'none' ? 'none' : String(decision);
  const a = active == null ? null : Boolean(active);
  if (namespace === 'wikidata') {
    // A Wikidata type has one switch, `admit`; a decision is the same switch.
    const admit = d === 'aside' ? false : d === 'nearby' || d === 'none' ? true : a;
    const { rows } = await query(
      `update place_kinds set label = coalesce($2, label), admit = coalesce($3, admit), updated_at = now()
        where qid = $1 returning 'wikidata' as namespace, qid as key, label, category as note, seen_count, admit as active`,
      [key, label ?? null, admit]);
    return rows[0] ?? null;
  }
  const { rows } = await query(
    `insert into taxonomy_labels (namespace, key, label, note, active, decision)
     values ($1, $2, $3, $4,
             case when $6::text = 'aside' then false when $6::text is not null and $6 <> 'none' then true else coalesce($5, true) end,
             case when $6::text is null or $6 = 'none' then (case when $5 = false then 'aside' else null end) else $6 end)
     on conflict (namespace, key) do update
        set label = coalesce($3, taxonomy_labels.label),
            note = coalesce($4, taxonomy_labels.note),
            active = case when $6::text = 'aside' then false when $6::text is not null then true else coalesce($5, taxonomy_labels.active) end,
            decision = case
              when $6::text is not null then (case when $6 = 'none' then null else $6 end)
              when $5 = false then 'aside'
              when $5 = true and taxonomy_labels.decision = 'aside' then null
              else taxonomy_labels.decision end,
            updated_at = now()
     returning *`,
    [namespace, key, label ?? null, note ?? null, a, d]);
  return rows[0];
}

/** Google's words nobody has decided about: no decision, still active, and no rule naming them. */
export async function undecidedGoogle() {
  const { rows } = await query(
    `select l.key, l.note from taxonomy_labels l
      where l.namespace = 'google' and l.decision is null and l.active
        and not exists (select 1 from shelf_rules r where r.scope = 'labels' and r.subject = 'google:' || l.key)`);
  return rows;
}

/** Decide many at once, as the sure decisions are applied. */
export async function decideMany(items) {
  if (!items.length) return 0;
  const { rowCount } = await query(
    `update taxonomy_labels l
        set decision = c.decision, active = (c.decision <> 'aside'), updated_at = now()
       from (select unnest($1::text[]) as key, unnest($2::text[]) as decision) c
      where l.namespace = 'google' and l.key = c.key and l.decision is null`,
    [items.map((i) => i.key), items.map((i) => i.decision)]);
  return rowCount;
}
