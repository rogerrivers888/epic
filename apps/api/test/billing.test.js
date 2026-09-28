import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const billing = await import('../src/desk/billing.js');
const exportReader = await import('../src/sources/billingExport.js');
test.after(() => pool.end());

test('Google SKUs map to our meters, and an unknown one is left unmapped', () => {
  assert.equal(billing.meterOf('Places API Text Search Pro'), 'google-pro');
  assert.equal(billing.meterOf('Places API Text Search Enterprise + Atmosphere'), 'google-search');
  assert.equal(billing.meterOf('Places API Text Search Essentials (IDs Only)'), 'google-essentials');
  assert.equal(billing.meterOf('Places API Place Details Pro'), 'google-details');
  assert.equal(billing.meterOf('Routes: Compute Routes Essentials'), 'google-routes');
  assert.equal(billing.meterOf('Cloud Storage'), null);
});

test('a billed day is shared across that day’s ledger rows by requests, and both sides are reported', async () => {
  await query(`delete from billing_days where day = '2026-09-20'`);
  await query(`delete from provider_calls where purpose = 'billing-test'`);
  await query(`insert into billing_days (day, service, sku, sku_id, meter, usage, cost, credits, promo, currency)
               values ('2026-09-20', 'Places API', 'Places API Text Search Pro', 'SKU-PRO', 'google-pro', 300, 6.00, -6.00, -6.00, 'GBP'),
                      ('2026-09-20', 'Other', 'Cloud Storage', 'SKU-X', null, 1, 0.10, 0, 0, 'GBP')`);
  const { rows: [h] } = await query(`insert into households (name) values ('billing test') returning id`);
  await query(`insert into provider_calls (household_id, provider, purpose, units, estimated_cost_usd, created_at)
               values ($1, 'google', 'billing-test', '{"google": 100, "google-pro": 100}', 3.2, '2026-09-20 10:00+01'),
                      (null, 'google', 'billing-test', '{"google": 200, "google-pro": 200}', 6.4, '2026-09-20 11:00+01')`, [h.id]);
  await billing.attribute('2026-09');
  const { rows } = await query(`select household_id is null as nobody, billed_gbp::float g from provider_calls where purpose = 'billing-test' order by nobody`);
  assert.deepEqual(rows.map((r) => Math.round(r.g * 100) / 100), [2, 4], 'one third and two thirds of £6');
  const rec = await billing.reconcile('2026-09');
  const d = rec.days.find((x) => x.day === '2026-09-20' && x.meter === 'google-pro');
  assert.equal(d.billedGbp, 6);
  assert.equal(d.ledgerRequests, 300);
  assert.equal(d.noHousehold, 1, 'the unattributed row is named');
  assert.ok(rec.unmapped.some((u) => u.sku === 'Cloud Storage'));
  await query(`delete from provider_calls where purpose = 'billing-test'`);
  await query(`delete from billing_days where day = '2026-09-20'`);
});

test('with no key the export cannot speak, and says why rather than nought', async () => {
  const saved = process.env.GCP_BILLING_SA_JSON; delete process.env.GCP_BILLING_SA_JSON;
  const out = await exportReader.monthBySkuDay('2026-09');
  assert.equal(out.speaks, false);
  assert.match(out.why, /GCP_BILLING_SA_JSON/);
  if (saved) process.env.GCP_BILLING_SA_JSON = saved;
});

test('the open-map regions are a setting, only the two extracts, and the environment overrides it', async () => {
  const settings = await import('../src/desk/settings.js');
  assert.deepEqual(settings.validate('osmRegions', ['great-britain', 'ireland-and-northern-ireland']), ['great-britain', 'ireland-and-northern-ireland']);
  assert.throws(() => settings.validate('osmRegions', ['france']));
  await settings.setSetting('osmRegions', ['ireland-and-northern-ireland'], { who: 'test' });
  const osm = await import('../src/sources/osmExtract.js');
  const saved = process.env.EPIC_OSM_EXTRACT;
  delete process.env.EPIC_OSM_EXTRACT;
  assert.deepEqual(await osm.regionsOn(), ['ireland-and-northern-ireland']);
  process.env.EPIC_OSM_EXTRACT = 'great-britain';
  assert.deepEqual(await osm.regionsOn(), ['great-britain']);
  if (saved === undefined) delete process.env.EPIC_OSM_EXTRACT; else process.env.EPIC_OSM_EXTRACT = saved;
  await settings.setSetting('osmRegions', [], { who: 'test' });
});
