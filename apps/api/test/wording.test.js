/**
 * A household reads in its own words (migration 302; Markets brief §7 / step 3).
 *
 * Committed with the migration it needs, as the working agreement requires.
 *
 * The test that matters is the last one: wording follows the household's own
 * locale and never the market of the place being displayed. It is written to
 * fail if `resolve` ever grows a way to key on a place or its market.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase, aHousehold } from './helpers/db.js';
import { pickWording, hasDrifted, DEFAULT_LOCALE } from '../src/domain/wording.js';

const { query, pool } = await testDatabase();
test.after(() => pool.end());

// Imported after testDatabase() so db.js binds to the test database, not the
// dev one (the repository pulls db.js; a static import would initialise the
// pool against DATABASE_URL before the harness repoints it — the ringTables
// pattern).
const { resolve, localeOfHousehold, defaultLocaleForMarket, subcategoryApplicable } =
  await import('../src/repositories/wording.js');
const { updateHousehold } = await import('../src/repositories/households.js');
const { rememberHomeCountry } = await import('../src/repositories/visits.js');

const seedKey = (namespace, key, en_gb, en_us = null, machine = true) => query(
  `insert into market_wording (namespace, key, en_gb, en_us, machine_allowed) values ($1,$2,$3,$4,$5)
     on conflict (namespace, key) do update set en_gb = excluded.en_gb, en_us = excluded.en_us`,
  [namespace, key, en_gb, en_us, machine]);

test('pickWording: en-US when held, en-GB for a shared key (not a miss), a miss only when there is no row', () => {
  assert.deepEqual(pickWording({ en_gb: 'Car park', en_us: 'Parking lot' }, 'en-US'),
    { text: 'Parking lot', miss: false, rendered: 'en-US' });
  // Shared key (blank en-US) is "same", the normal state — not a miss.
  assert.deepEqual(pickWording({ en_gb: 'Car park', en_us: null }, 'en-US'),
    { text: 'Car park', miss: false, rendered: 'en-GB' });
  assert.deepEqual(pickWording({ en_gb: 'Car park', en_us: 'Parking lot' }, 'en-GB'),
    { text: 'Car park', miss: false, rendered: 'en-GB' });
  // No row at all is the real miss — nothing to fall back to.
  assert.deepEqual(pickWording(null, 'en-US'), { text: null, miss: true, rendered: 'en-GB' });
  assert.deepEqual(pickWording(null, 'en-GB'), { text: null, miss: true, rendered: 'en-GB' });
  // An empty en-GB is missing too — it must not render blank.
  assert.deepEqual(pickWording({ en_gb: '', en_us: null }, 'en-GB'), { text: null, miss: true, rendered: 'en-GB' });
  // An empty en-US is "not written" — falls through to en-GB, no miss.
  assert.deepEqual(pickWording({ en_gb: 'Lift', en_us: '' }, 'en-US'), { text: 'Lift', miss: false, rendered: 'en-GB' });
});

test('resolve returns the right variant and never a key or a blank', async () => {
  await seedKey('interface', 'nav.places', 'Places');                    // same in both
  await seedKey('places', 'facts.carpark', 'Car park', 'Parking lot');   // differs
  assert.equal(await resolve('places', 'facts.carpark', { locale: 'en-US' }), 'Parking lot');
  assert.equal(await resolve('places', 'facts.carpark', { locale: 'en-GB' }), 'Car park');
  // Same in both: en-US falls through to en-GB, and that is not a miss because
  // there is nothing missing — the row simply has no separate American form.
  assert.equal(await resolve('interface', 'nav.places', { locale: 'en-US' }), 'Places');
});

test('a genuinely absent key logs a miss; intentionally-shared wording never does (register 6, and Codex)', async () => {
  // A key with a row but no separate American form is "same" — the normal state.
  // Resolving it in en-US must NOT log a miss, or the log fills with every
  // shared string on every view.
  await seedKey('interface', 'shared.trips', 'Trips', null);
  await query(`delete from wording_misses`);
  assert.equal(await resolve('interface', 'shared.trips', { locale: 'en-US' }), 'Trips');
  const { rows: shared } = await query(`select 1 from wording_misses where key='shared.trips'`);
  assert.equal(shared.length, 0, 'a shared key is not a miss');

  // A key with no row at all is the real gap — logged, in whatever locale.
  await resolve('interface', 'never.registered', { locale: 'en-US' });
  await resolve('interface', 'never.registered', { locale: 'en-US' });
  const { rows } = await query(
    `select seen from wording_misses where namespace='interface' and key='never.registered' and locale='en-US'`);
  assert.equal(rows.length, 1, 'the absent key is logged once');
  assert.equal(rows[0].seen, 2, 'a repeat increments rather than duplicates');
  // An absent key renders the caller's en-GB default, never blank or the key.
  assert.equal(await resolve('interface', 'never.registered', { locale: 'en-US', fallback: 'Registered', logMiss: false }), 'Registered');
});

test('resolve registers a wired key from its en-GB fallback, once, without clobbering a curated American form', async () => {
  await query(`delete from market_wording where namespace='places' and key='cost.unknown'`);
  await query(`delete from wording_misses where namespace='places' and key='cost.unknown'`);
  // Wiring resolve() with the en-GB literal registers the key — the same act.
  assert.equal(await resolve('places', 'cost.unknown', { locale: 'en-GB', fallback: 'Not known yet' }), 'Not known yet');
  const { rows: reg } = await query(
    `select en_gb, en_us, machine_allowed from market_wording where namespace='places' and key='cost.unknown'`);
  assert.equal(reg.length, 1, 'the key now has a row the wording desk can offer for curation');
  assert.equal(reg[0].en_gb, 'Not known yet');
  assert.equal(reg[0].en_us, null, 'blank American form means "same" until someone writes it — not a miss');
  assert.equal(reg[0].machine_allowed, true, 'a places key may carry a machine draft');
  // A registered key is no longer a logged miss, in either locale.
  assert.equal(await resolve('places', 'cost.unknown', { locale: 'en-US', fallback: 'Not known yet' }), 'Not known yet');
  const { rows: miss } = await query(`select 1 from wording_misses where namespace='places' and key='cost.unknown'`);
  assert.equal(miss.length, 0, 'a registered key is not a miss');
  // Registration is idempotent: a later resolve must not overwrite a curated
  // American form (on conflict do nothing), nor the en-GB.
  await query(`update market_wording set en_us='Cost unknown' where namespace='places' and key='cost.unknown'`);
  assert.equal(await resolve('places', 'cost.unknown', { locale: 'en-US', fallback: 'Not known yet' }), 'Cost unknown',
    'the curated American form stands; register did not clobber it');
});

test('a key referenced with no fallback has nothing to register and stays a miss', async () => {
  await query(`delete from market_wording where namespace='places' and key='cost.nofallback'`);
  await query(`delete from wording_misses where namespace='places' and key='cost.nofallback'`);
  await resolve('places', 'cost.nofallback', { locale: 'en-US' });
  const { rows: reg } = await query(`select 1 from market_wording where namespace='places' and key='cost.nofallback'`);
  assert.equal(reg.length, 0, 'no en-GB literal to seed the NOT NULL column, so no row is registered');
  const { rows: miss } = await query(`select 1 from wording_misses where namespace='places' and key='cost.nofallback'`);
  assert.equal(miss.length, 1, 'it is the "referenced but never added" gap, and stays a logged miss');
});

test('collection copy is handwritten only — the constraint refuses a machine draft', async () => {
  await assert.rejects(
    () => query(`insert into market_wording (namespace, key, en_gb, machine_allowed) values ('collection','row.rain','It is raining again', true)`),
    /market_wording_collection_is_handwritten|check constraint/,
    'a collection row may not allow the machine');
  await assert.rejects(
    () => query(`insert into market_wording (namespace, key, en_gb, machine_allowed, suggestion) values ('collection','row.rain2','x', false, 'a machine line')`),
    /market_wording_collection_is_handwritten|check constraint/,
    'a collection row may not carry a suggestion');
  // Handwritten, no suggestion: allowed.
  await query(`insert into market_wording (namespace, key, en_gb, machine_allowed) values ('collection','row.ok','A real line', false)`);
  const { rows } = await query(`select 1 from market_wording where namespace='collection' and key='row.ok'`);
  assert.equal(rows.length, 1);
});

test('a market seeds a household locale; unknown markets fall back to en-GB', async () => {
  assert.equal(await defaultLocaleForMarket('US'), 'en-US');
  assert.equal(await defaultLocaleForMarket('GB'), 'en-GB');
  assert.equal(await defaultLocaleForMarket('ZZ'), 'en-GB');
  assert.equal(await defaultLocaleForMarket(null), 'en-GB');
});

test('a household that sets its home in a market is seeded that market\'s locale', async () => {
  const usHome = (await aHousehold(query)).household;
  await updateHousehold(usHome.id, { homeLat: 40.71, homeLng: -74.0, homeCountryCode: 'US', homeCountry: 'United States' });
  assert.equal(await localeOfHousehold(usHome.id), 'en-US', 'a new US household reads American English, not the en-GB default');

  const gbHome = (await aHousehold(query)).household;
  await updateHousehold(gbHome.id, { homeLat: 51.5, homeLng: -0.1, homeCountryCode: 'GB', homeCountry: 'United Kingdom' });
  assert.equal(await localeOfHousehold(gbHome.id), 'en-GB');

  // An update that does not set a home (no coordinates) leaves the locale alone.
  await updateHousehold(usHome.id, { name: 'Renamed' });
  assert.equal(await localeOfHousehold(usHome.id), 'en-US', 'a non-home edit does not touch the locale');

  // A LATER move does not overwrite an established locale: a British family that
  // relocates to the US keeps British English (Codex — seed only on the first
  // home). The country moves; the locale does not.
  await updateHousehold(gbHome.id, { homeLat: 40.71, homeLng: -74.0, homeCountryCode: 'US', homeCountry: 'United States' });
  const { rows: moved } = await query('select home_country_code, wording_locale from households where id = $1', [gbHome.id]);
  assert.equal(moved[0].home_country_code, 'US', 'the home country follows the move');
  assert.equal(moved[0].wording_locale, 'en-GB', 'the established locale does not');

  // The other path a country is first learned — recovered from a visit — seeds
  // the locale too, first time only (Codex).
  const recovered = (await aHousehold(query)).household;
  await rememberHomeCountry(recovered.id, 'US', 'United States');
  assert.equal(await localeOfHousehold(recovered.id), 'en-US', 'a country recovered from a visit seeds the locale');
});

test('the not-applicable status: absent means yes, a false row means not offered here', async () => {
  assert.equal(await subcategoryApplicable('US', 'soft-play'), true, 'no row means applicable');
  await query(`insert into market_subcategories (market_code, subcategory, applicable) values ('US','soft-play', false)
               on conflict (market_code, subcategory) do update set applicable = excluded.applicable`);
  assert.equal(await subcategoryApplicable('US', 'soft-play'), false, 'a false row means not applicable here');
});

test('WORDING FOLLOWS THE HOUSEHOLD, NEVER THE PLACE\'S MARKET (register 1)', async () => {
  await seedKey('places', 'facts.carpark', 'Car park', 'Parking lot');
  const gb = (await aHousehold(query)).household;
  const us = (await aHousehold(query)).household;
  await query('update households set wording_locale = $2 where id = $1', [gb.id, 'en-GB']);
  await query('update households set wording_locale = $2 where id = $1', [us.id, 'en-US']);

  // The American household reads American wording for a place in the GB market;
  // the British household reads British wording for a place in the US market.
  // The place's market is not an input to resolve at all.
  const usWord = await resolve('places', 'facts.carpark', { locale: await localeOfHousehold(us.id) });
  const gbWord = await resolve('places', 'facts.carpark', { locale: await localeOfHousehold(gb.id) });
  assert.equal(usWord, 'Parking lot', 'US household → American wording, whatever market the place is from');
  assert.equal(gbWord, 'Car park', 'GB household → British wording, whatever market the place is from');

  // And resolve keys ONLY on locale: a place or market passed alongside changes
  // nothing, because there is no parameter for it. If someone adds one, this
  // fails and they have to justify it past register entry 1.
  const withNoise = await resolve('places', 'facts.carpark',
    { locale: 'en-US', market: 'GB', placeCountry: 'GB', place: { market: 'GB' } });
  assert.equal(withNoise, 'Parking lot', 'a place/market alongside the locale is ignored');
});

test('drift: en-US is stale when the English moved on since it was written', () => {
  assert.equal(hasDrifted({ en_us: 'Parking lot', en_gb_version: 3, en_gb_version_when_us_written: 2 }), true);
  assert.equal(hasDrifted({ en_us: 'Parking lot', en_gb_version: 2, en_gb_version_when_us_written: 2 }), false);
  assert.equal(hasDrifted({ en_us: null, en_gb_version: 3, en_gb_version_when_us_written: null }), false);
  // An empty en-US is "not written", so it never drifts.
  assert.equal(hasDrifted({ en_us: '', en_gb_version: 3, en_gb_version_when_us_written: 2 }), false);
});
