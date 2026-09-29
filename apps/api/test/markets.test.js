/**
 * A place belongs to a market (migration 300; Epic — Markets: build brief §4/§5).
 *
 * Committed with the migration it needs, as the working agreement requires: an
 * uncommitted migration is invisible to every other session's test database.
 *
 * What is pinned here is the shape a later mistake would quietly break: that GB
 * is soft launch and not live, that blocked markets are never rows, that wording
 * follows the household (the column is `default_wording_locale`, a seed and
 * nothing else), and that money, time and the ledger's language now sit beside
 * the amounts, times and calls they qualify.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';
import { BLOCKED_MARKETS, isBlockedMarket, MARKET_STATUSES } from '../src/domain/markets.js';

const { query, pool } = await testDatabase();
test.after(() => pool.end());

const marketBy = async (code) => {
  const { rows } = await query('select * from markets where code = $1', [code]);
  return rows[0] ?? null;
};

const columnExists = async (table, column) => {
  const { rows } = await query(
    `select 1 from information_schema.columns where table_name = $1 and column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
};

test('GB is the soft launch, in pounds and miles — not live (owner, 29 Sep 2026)', async () => {
  const gb = await marketBy('GB');
  assert.equal(gb.status, 'soft', 'GB seeds as soft launch, superseding the design mock that showed it live');
  assert.equal(gb.currency, 'GBP');
  assert.equal(gb.distance_unit, 'miles');
  assert.equal(gb.mid_level_name, 'County');
  assert.equal(gb.default_wording_locale, 'en-GB');
  assert.equal(gb.default_timezone, 'Europe/London', 'the market carries the timezone a place falls back to');
});

test('US and IE are groundwork; the US carries its own units and mid-level', async () => {
  const us = await marketBy('US');
  assert.equal(us.status, 'groundwork');
  assert.equal(us.currency, 'USD');
  assert.equal(us.temp_unit, 'F');
  assert.equal(us.mid_level_name, 'State');
  assert.equal(us.default_wording_locale, 'en-US');
  assert.equal(us.default_timezone, 'America/New_York', 'a market default, only a fallback across six US zones');
  assert.equal(us.area_code.searchBy, 'zip');

  const ie = await marketBy('IE');
  assert.equal(ie.status, 'groundwork');
  assert.equal(ie.currency, 'EUR');
});

test('area-code patterns are anchored both ends, so trailing junk is not a postcode', async () => {
  for (const [code, yes, no] of [
    ['GB', ['SL5', 'SL5 9PT', 'EC1A 1BB'], ['SL5 nonsense', 'not a postcode', '']],
    ['US', ['43215'], ['43215-1234', '4321', 'ABCDE']],
    ['IE', ['D02 AF30', 'D02AF30'], ['D02 AF30 extra', 'Dublin']],
  ]) {
    const { pattern } = (await marketBy(code)).area_code;
    const re = new RegExp(pattern);
    for (const s of yes) assert.ok(re.test(s), `${code} pattern accepts "${s}"`);
    for (const s of no) assert.ok(!re.test(s), `${code} pattern rejects "${s}"`);
  }
});

test('the British-holiday countries are seeded groundwork, Spain among them', async () => {
  const { rows } = await query(
    `select code from markets where status = 'groundwork' order by code`);
  const codes = rows.map((r) => r.code);
  for (const expected of ['US', 'IE', 'PT', 'ES', 'FR', 'IT', 'GR', 'NL', 'TR', 'HR', 'CY', 'MT', 'AT', 'AE']) {
    assert.ok(codes.includes(expected), `${expected} is seeded as a groundwork market`);
  }
});

test('cost bands: GB/US/IE set; Portugal and Greece need their own; other eurozone borrow Ireland', async () => {
  for (const code of ['GB', 'US', 'IE']) {
    const m = await marketBy(code);
    assert.ok(Array.isArray(m.cost_bands) && m.cost_bands.length === 4, `${code} has four seeded bands`);
    // Free is exactly 0; paid bands are half-open [min, max) and never overlap,
    // so every price lands in exactly one. Each carries its attribution.
    const [free, ...paid] = m.cost_bands;
    assert.deepEqual([free.min, free.max], [0, 0], `${code} Free is exactly 0`);
    let edge = paid[0].min;
    for (const b of paid) {
      assert.equal(b.min, edge, `${code} band ${b.symbol} begins where the last ended`);
      assert.ok(b.max === null || b.max > b.min, `${code} band ${b.symbol} is a real interval`);
      assert.ok(b.set_by && b.at, `${code} band ${b.symbol} records who set it and when`);
      edge = b.max;
    }
    assert.equal(edge, null, `${code} the dearest band is unbounded above`);
  }
  // Owner: Portugal and Greece do not inherit Ireland's — left null until set.
  assert.equal((await marketBy('PT')).cost_bands, null, 'Portugal needs its own euro bands');
  assert.equal((await marketBy('GR')).cost_bands, null, 'Greece needs its own euro bands');
  // Other eurozone groundwork may use Ireland's as a placeholder.
  assert.ok(Array.isArray((await marketBy('ES')).cost_bands), 'Spain borrows the euro placeholder bands');
  // Turkey and the UAE have no currency to borrow from.
  assert.equal((await marketBy('TR')).cost_bands, null, 'Turkey has no euro bands to borrow');
  assert.equal((await marketBy('AE')).cost_bands, null, 'the UAE has no euro bands to borrow');
});

test('blocked markets are never rows, and the status column forbids the value', async () => {
  const { rows } = await query(`select count(*)::int n from markets where status = 'blocked'`);
  assert.equal(rows[0].n, 0, 'no blocked market is a row — the list is a code constant');
  // Vietnam and the other prohibited territories are absent from the table.
  for (const code of ['VN', 'CN', 'CU', 'IR', 'KP', 'SY']) {
    assert.equal(await marketBy(code), null, `${code} is blocked and must not be a market row`);
  }
  await assert.rejects(
    () => query(`insert into markets (code, name, status, currency) values ('ZZ', 'Nowhere', 'blocked', 'GBP')`),
    /markets_status_check|violates check constraint/,
    "status = 'blocked' is refused by the check constraint",
  );
});

test('the blocked-territory constant is Google\'s nine, Vietnam included', async () => {
  const names = BLOCKED_MARKETS.map((m) => m.name);
  for (const n of ['China', 'Cuba', 'Iran', 'North Korea', 'Syria', 'Vietnam', 'Crimea', 'Donetsk', 'Luhansk']) {
    assert.ok(names.includes(n), `${n} is on the blocked list`);
  }
  assert.ok(isBlockedMarket('VN'), 'Vietnam is blocked');
  assert.ok(isBlockedMarket('vn'), 'the test is case-insensitive');
  assert.ok(!isBlockedMarket('GB'), 'Britain is not blocked');
  assert.ok(!isBlockedMarket(null), 'a missing code is not blocked by this test');
  assert.ok(!MARKET_STATUSES.includes('blocked'), 'blocked is never a market status');
});

test('wording follows the household: the column is default_wording_locale, not wording_locale', async () => {
  assert.ok(await columnExists('markets', 'default_wording_locale'),
    'the seed-only column is named to say it only seeds a household');
  assert.ok(!(await columnExists('markets', 'wording_locale')),
    'a bare wording_locale would invite reading the language off the market of the place');
});

test('money, time and the ledger language now sit beside what they qualify', async () => {
  assert.ok(await columnExists('area_counts', 'country_code'), 'a count knows its market');
  assert.ok(await columnExists('host_offers', 'currency'), 'a host price carries its currency');
  assert.ok(await columnExists('host_offers', 'timezone'), 'an offer holds its own timezone');
  assert.ok(await columnExists('place_records', 'timezone'), 'a place holds its own timezone');
  for (const col of ['language_code', 'region_code', 'field_mask']) {
    assert.ok(await columnExists('provider_calls', col), `the ledger records ${col}`);
  }
});

test('the sources list uses the provenance vocabulary the rest of the system speaks', async () => {
  const ids = (await marketBy('GB')).sources.map((s) => s.id);
  assert.ok(ids.includes('site'), "the venue's own page is 'site', as in own.js and verification.js");
  assert.ok(!ids.includes('venue'), "not a bespoke 'venue' id nothing else knows");
});
