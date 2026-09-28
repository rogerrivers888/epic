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
  assert.equal(billing.meterOf('Places API Place Details Enterprise'), 'google-details');
  assert.equal(billing.meterOf('Routes: Compute Routes Essentials'), 'google-routes');
  assert.equal(billing.meterOf('Cloud Storage'), null);
});

test('a billed day is shared across that day’s ledger rows by requests, and both sides are reported', async () => {
  await query(`delete from billing_days where day = '2026-09-20'`);
  await query(`delete from provider_calls where purpose = 'billing-test'`);
  await query(`insert into billing_days (invoice_month, day, service, sku, sku_id, meter, usage, cost, credits, promo, currency)
               values ('2026-09', '2026-09-20', 'Places API', 'Places API Text Search Pro', 'SKU-PRO', 'google-pro', 300, 6.00, -6.00, -6.00, 'GBP'),
                      ('2026-09', '2026-09-20', 'Other', 'Cloud Storage', 'SKU-X', null, 1, 0.10, 0, 0, 'GBP')`);
  // A scalar and a pre-tier row the same month: neither breaks it, the second is reported.
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at)
               values ('google', 'billing-test', '5', 0, '2026-09-20 09:00+01'), ('google', 'billing-test', '{"google": 7}', 0.2, '2026-09-20 09:30+01')`);
  const { rows: [h] } = await query(`insert into households (name) values ('billing test') returning id`);
  await query(`insert into provider_calls (household_id, provider, purpose, units, estimated_cost_usd, created_at)
               values ($1, 'google', 'billing-test', '{"google": 100, "google-pro": 100}', 3.2, '2026-09-20 10:00+01'),
                      (null, 'google', 'billing-test', '{"google": 200, "google-pro": 200}', 6.4, '2026-09-20 11:00+01')`, [h.id]);
  await billing.attribute('2026-09');
  const { rows } = await query(`select household_id is null as nobody, billed_gbp::float g from provider_calls
                                  where purpose = 'billing-test' and jsonb_typeof(units) = 'object' and units ? 'google-pro' order by nobody`);
  assert.deepEqual(rows.map((r) => Math.round(r.g * 100) / 100), [2, 4], 'one third and two thirds of £6');
  const rec = await billing.reconcile('2026-09');
  const d = rec.days.find((x) => x.day === '2026-09-20' && x.meter === 'google-pro');
  assert.equal(d.billedGbp, 6);
  assert.equal(d.ledgerRequests, 300);
  assert.equal(d.noHousehold, 1, 'the unattributed row is named');
  assert.ok(rec.unmapped.some((u) => u.sku === 'Cloud Storage'));
  assert.ok(rec.ledgerOnly.some((l) => l.meter === 'google-legacy' && l.requests === 7), 'a pre-tier row is seen, as google-legacy');
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

test('Place Details tiers map as the ledger names them, and a query not yet finished is waited for', async () => {
  assert.equal(billing.meterOf('Places API Place Details Pro'), 'google-pro');
  assert.equal(billing.meterOf('Places API Place Details Enterprise + Atmosphere'), 'google-details');
  assert.equal(billing.meterOf('Places API Place Details Essentials (IDs Only)'), 'google-essentials');
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GCP_BILLING_SA_JSON = JSON.stringify({ client_email: 'x@y', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  let polls = 0;
  const fake = async (url) => {
    if (String(url).includes('oauth2')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    if (String(url).endsWith('/queries')) return { ok: true, json: async () => ({ jobComplete: false, jobReference: { jobId: 'J', location: 'EU' } }) };
    polls += 1;
    return { ok: true, json: async () => ({ jobComplete: true, jobReference: { jobId: 'J' }, schema: { fields: [{ name: 'a' }] }, rows: [{ f: [{ v: '1' }] }] }) };
  };
  const rows = await exportReader.run('select 1', {}, fake);
  assert.deepEqual(rows, [{ a: '1' }]);
  assert.ok(polls >= 1, 'it waited for the job');
  delete process.env.GCP_BILLING_SA_JSON;
});

test('the billing tile starts from the console figures (277)', async () => {
  const { rows: [s] } = await query(`select value from bo_settings where key = 'billing'`);
  assert.equal(s.value.creditExpires, '2026-12-20');
  assert.equal(s.value.usageGbp, 40.61);
});

test('a billing query that finished with errors is an error, never an empty month', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GCP_BILLING_SA_JSON = JSON.stringify({ client_email: 'x@y', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const fake = async (url) => {
    if (String(url).includes('oauth2')) return { ok: true, json: async () => ({ access_token: 't2', expires_in: 3600 }) };
    if (String(url).endsWith('/queries')) return { ok: true, json: async () => ({ jobComplete: false, jobReference: { jobId: 'J' } }) };
    return { ok: true, json: async () => ({ jobComplete: true, errors: [{ message: 'Resources exceeded' }] }) };
  };
  await assert.rejects(() => exportReader.run('select 1', {}, fake), /Resources exceeded/);
  delete process.env.GCP_BILLING_SA_JSON;
});

test('a warning beside a good billing result is not a failure', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GCP_BILLING_SA_JSON = JSON.stringify({ client_email: 'x@y', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const fake = async (url) => (String(url).includes('oauth2')
    ? { ok: true, json: async () => ({ access_token: 't3', expires_in: 3600 }) }
    : { ok: true, json: async () => ({ jobComplete: true, errors: [{ message: 'a warning', reason: 'warning' }], schema: { fields: [{ name: 'a' }] }, rows: [{ f: [{ v: '2' }] }] }) });
  assert.deepEqual(await exportReader.run('select 2', {}, fake), [{ a: '2' }]);
  delete process.env.GCP_BILLING_SA_JSON;
});

test('late usage on a later invoice is attributed to the day it was used', async () => {
  await query(`delete from billing_days where day = '2026-08-30'`);
  await query(`delete from provider_calls where purpose = 'billing-late'`);
  await query(`insert into billing_days (invoice_month, day, service, sku, sku_id, meter, usage, cost, credits, promo, currency)
               values ('2026-09', '2026-08-30', 'Places API', 'Places API Text Search Pro', 'SKU-PRO', 'google-pro', 10, 1.00, 0, 0, 'GBP')`);
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at)
               values ('google', 'billing-late', '{"google-pro": 10}', 0.3, '2026-08-30 10:00+01')`);
  await billing.attribute('2026-08');
  const { rows: [r] } = await query(`select billed_gbp::float g from provider_calls where purpose = 'billing-late'`);
  assert.equal(r.g, 1);
  await query(`delete from provider_calls where purpose = 'billing-late'`);
  await query(`delete from billing_days where day = '2026-08-30'`);
});

test('the ledger estimate is what Google would bill: nothing inside each SKU’s free monthly allowance', async () => {
  await query(`delete from provider_calls where purpose = 'billing-allow'`);
  // 3,000 Pro requests (free up to 5,000) and 1,200 Enterprise searches (free up to 1,000).
  await query(`insert into provider_calls (provider, purpose, units, estimated_cost_usd, created_at)
               values ('google', 'billing-allow', '{"google": 3000, "google-pro": 3000}', 96, '2026-07-10 10:00+01'),
                      ('google', 'billing-allow', '{"google": 1200, "google-search": 1200}', 48, '2026-07-10 11:00+01')`);
  const est = await billing.googleEstimate('2026-07');
  const pro = est.lines.find((l) => l.key === 'google-pro');
  const search = est.lines.find((l) => l.key === 'google-search');
  assert.equal(pro.billable, 0, 'inside the Pro allowance');
  assert.equal(search.billable, 200, 'only the 200 past the Enterprise allowance');
  assert.ok(est.gbp > 0 && est.gbp < 10, `£${est.gbp.toFixed(2)}, not the £100+ list price`);
  await query(`delete from provider_calls where purpose = 'billing-allow'`);
});
