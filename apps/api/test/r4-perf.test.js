import { test } from 'node:test';
import assert from 'node:assert/strict';

// Round 4 PERF (29 Sep 2026): Overview, Mapping and Billing › Reconcile under
// a second, without changing a number. Held here: the month of the ledger is
// read by index (migration 285) and the filter that lets it is a superset of
// every row the Google readers count; a narrowing's kept and leavers are the
// same as the correlated form they replace; and each fast read is still the
// read Postgres plans from the new indexes.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const billing = await import('../src/desk/billing.js');
const mapping = await import('../src/desk/mapping.js');
const { PLACE_WORDS } = await import('../src/desk/words.js');

test.after(() => pool.end());

const MONTH = '2026-03';
const AT = '2026-03-12 10:00+00';

/** Every shape of row the ledger holds, Google or not. */
const ROWS = [
  ['google', '{"google": 100, "google-essentials": 100}'],
  ['google', '{"google": 1, "google-pro": 1, "pro-details": 1}'],
  ['google', '{"google": 7}'],
  ['google', '{"pro-details": 2}'],
  ['google', '5'],
  ['google', '"6"'],
  ['google-routes', '3'],
  ['routes', '{"google-routes": 1}'],
  ['someone-else', '{"google-photos": 1}'],
  ['wikipedia', '{"wikipedia": 1}'],
  ['osm-overpass', '{"osm-overpass": 1, "ok": 1}'],
  ['anthropic', null],
  ['wikipedia', '4'],
  ['google', '[1, 2]'],
  ['google', 'null'],
];

async function seedLedger() {
  await query(`delete from provider_calls where purpose = 'r4-perf'`);
  for (const [provider, units] of ROWS) {
    await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at)
                 values ($1, 'r4-perf', $2::jsonb, 0.01, $3)`, [provider, units, AT]);
  }
}

test('the Google filter is true of every row the Google readers count, and false of the free rows', async () => {
  await seedLedger();
  // The readers exactly as they were before the filter was added: the filter
  // stripped out, so this is the old SQL, and its rows are what must pass.
  const unfiltered = (sql) => sql.replaceAll('provider_call_bills_google(p.units, p.provider)\n     and ', '');
  assert.notEqual(unfiltered(billing.LEDGER_METERS), billing.LEDGER_METERS, 'the filter is in the ledger read');
  const { rows: counted } = await query(
    `select distinct x.id from (${unfiltered(billing.LEDGER_METERS)}) x join provider_calls p on p.id = x.id where p.purpose = 'r4-perf'`, [MONTH]);
  const { rows: details } = await query(
    `select p.id from provider_calls p where p.purpose = 'r4-perf' and jsonb_typeof(p.units) = 'object' and (p.units->>'pro-details') ~ '^[0-9.]+$'`);
  const need = new Set([...counted, ...details].map((r) => r.id));
  assert.ok(need.size >= 9, `the fixture reaches both branches (${need.size})`);
  const { rows } = await query(
    `select id, provider, units::text u, provider_call_bills_google(units, provider) g from provider_calls where purpose = 'r4-perf'`);
  for (const r of rows) {
    if (need.has(r.id)) assert.equal(r.g, true, `${r.provider} ${r.u} is counted, so the filter must keep it`);
  }
  const free = rows.filter((r) => ['wikipedia', 'osm-overpass', 'anthropic'].includes(r.provider));
  assert.ok(free.every((r) => r.g === false), 'free-source and Claude rows are left out of the index');

  // And the readers answer the same with the filter as without it.
  const sum = async (sql) => (await query(
    `select meter, sum(n)::float n from (${sql}) x join provider_calls p on p.id = x.id where p.purpose = 'r4-perf' group by 1 order by 1`, [MONTH])).rows;
  assert.deepEqual(await sum(billing.LEDGER_METERS), await sum(unfiltered(billing.LEDGER_METERS)));
  const pro = async (sql) => (await query(sql, [MONTH])).rows[0].n;
  assert.equal(await pro(billing.PRO_DETAILS), await pro(unfiltered(billing.PRO_DETAILS)));
  await query(`delete from provider_calls where purpose = 'r4-perf'`);
});

/** The plan Postgres makes for a query, as text, with sequential scans priced out. */
async function planOf(sql, args) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local enable_seqscan = off');
    const { rows } = await c.query(`explain ${sql}`, args);
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  } finally {
    await c.query('rollback');
    c.release();
  }
}

test('the month of Google rows and of Claude rows can each be read from its own index', async () => {
  const google = await planOf(`select meter, sum(n) from (${billing.LEDGER_METERS}) x where month = $1 group by 1`, [MONTH]);
  assert.match(google, /provider_calls_google_month_idx/);
  assert.match(await planOf(billing.PRO_DETAILS, [MONTH]), /provider_calls_google_month_idx/);
  const claude = await planOf(`select count(*) from provider_calls p where provider ~* 'anthropic|claude'
    and p.created_at >= (($1::text || '-01')::date::timestamp at time zone 'Europe/London')`, [MONTH]);
  assert.match(claude, /provider_calls_claude_month_idx/);
  // Overview's own form: case-sensitive, and still able to use it.
  const tile = await planOf(`select sum(estimated_cost_usd) from provider_calls
    where created_at >= now() - interval '1 month' and provider ~* 'anthropic|claude' and provider ~ 'anthropic|claude'`, []);
  assert.match(tile, /provider_calls_claude_month_idx/);
});

// ---------------------------------------------------------------------------
// Mapping: a narrowing's counts, set against the correlated form they replace.

/** The narrowing's counts as they were read before round 4, one correlated lookup per place. */
async function narrowedTheOldWay(word, condition) {
  const cond = mapping.NARROWING_SQL[condition];
  const { rows: [r] } = await query(`
    select count(distinct pil.venue_ref) filter (where ${cond})::int as kept,
           count(distinct pil.venue_ref) filter (where not ${cond} and not exists (
             select 1 from ${PLACE_WORDS} o join taxonomy_labels l on l.namespace = 'google' and 'google:' || l.key = o.label
              where o.venue_ref = pil.venue_ref and o.label <> pil.label and l.active
                and (l.points_at is not null or l.decision = 'generic'
                     or exists (select 1 from word_targets t where t.namespace = l.namespace and t.word = l.key)
                     or (l.decision is null and exists (select 1 from shelf_rules r where r.scope = 'labels' and r.subcategory is not null
                                                          and r.labels = array[l.namespace || ':' || l.key])))))::int as leave
      from ${PLACE_WORDS} pil where pil.label = $1`, [`google:${word}`]);
  return { kept: r.kept, leave: r.leave };
}

test('a narrowing keeps and loses exactly the places it did before, whatever carries them', async () => {
  await query(`insert into shelf_categories (key, label, position) values ('culture', 'Culture', 2) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('culture', 'r4-landmarks', 'Landmarks', 1), ('culture', 'r4-other', 'Other', 2)
               on conflict (key) do update set active = true`);
  // The narrowed word, and one of every kind of other word a place can carry:
  // pointed, targeted only, a fact only, ruled only, out of Epic, inactive.
  await query(`delete from word_targets where word like 'r4_%'`);
  await query(`delete from shelf_rules where scope = 'labels' and subject like 'google:r4_%'`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, decision, active) values
               ('google', 'r4_church', 'church', 'r4-landmarks', null, true),
               ('google', 'r4_pointed', 'pointed', 'r4-other', null, true),
               ('google', 'r4_targeted', 'targeted', null, null, true),
               ('google', 'r4_generic', 'generic', null, 'generic', true),
               ('google', 'r4_ruled', 'ruled', null, null, true),
               ('google', 'r4_aside', 'aside', null, 'aside', true),
               ('google', 'r4_asleep', 'asleep', 'r4-other', null, false)
               on conflict (namespace, key) do update set points_at = excluded.points_at, decision = excluded.decision, active = excluded.active`);
  await query(`insert into word_targets (namespace, word, subcategory_key, is_primary) values ('google', 'r4_targeted', 'r4-other', true)`);
  await query(`insert into shelf_rules (scope, subject, labels, weights, subcategory, reason, taught_by, seeded)
               values ('labels', 'google:r4_ruled', array['google:r4_ruled'], '{}'::jsonb, 'r4-other', 'r4', 'r4', false)
               on conflict (scope, subject) do update set labels = excluded.labels, subcategory = excluded.subcategory`);
  const others = ['r4_pointed', 'r4_targeted', 'r4_generic', 'r4_ruled', 'r4_aside', 'r4_asleep', null];
  const refs = [];
  await query(`delete from place_index where venue_ref like 'r4:%'`);
  for (let i = 0; i < 28; i++) {
    const ref = `r4:${i}`;
    refs.push(ref);
    await query(`insert into place_index (venue_ref, subcategory) values ($1, 'r4-landmarks')`, [ref]);
    await query(`insert into place_index_labels (venue_ref, label) values ($1, 'google:r4_church')`, [ref]);
    const other = others[i % others.length];
    if (other) await query(`insert into place_index_labels (venue_ref, label) values ($1, $2)`, [ref, `google:${other}`]);
    // Every fourth qualifies by our own record.
    if (i % 4 === 0) {
      await query(`insert into place_records (venue_ref, wikidata_id) values ($1, 'Q4') on conflict (venue_ref) do update set wikidata_id = 'Q4'`, [ref]);
    }
  }
  const before = await narrowedTheOldWay('r4_church', 'encyclopedia_or_listing');
  const after = await mapping.narrowCounts('r4_church', 'encyclopedia_or_listing');
  assert.deepEqual(after, before);
  assert.equal(after.kept, 7);
  // Of the 21 that do not qualify, those carried by an in-Epic word stay;
  // the ones carried by nothing, by an out-of-Epic word or an inactive one leave.
  assert.ok(after.leave > 0 && after.leave < 21, `some leave and some stay (${after.leave})`);
  assert.deepEqual(await mapping.narrowCounts('r4_nobody', 'encyclopedia_or_listing'), { kept: 0, leave: 0 });

  // Mapping's own read carries the same counts on the proposal.
  await query(`delete from word_proposals where word = 'r4_church'`);
  await query(`insert into word_proposals (word, grp, action, change_to) values
               ('r4_church', 'narrow', 'narrow', '{"text": "Landmarks — only churches with an entry", "condition": "encyclopedia_or_listing", "subcategory": "r4-landmarks"}'::jsonb)`);
  const state = await mapping.mappingState();
  const row = state.needs.find((r) => r.word === 'r4_church');
  assert.equal(row.proposal.affected, before.leave);
  assert.match(row.proposal.changeTo, new RegExp(`\\(${before.kept}\\) · the other ${before.leave} leave Epic`));

  await query(`delete from word_proposals where word = 'r4_church'`);
  await query(`delete from place_index where venue_ref like 'r4:%'`);
  await query(`delete from place_records where venue_ref like 'r4:%'`);
});
