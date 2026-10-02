/**
 * A missing country from the place's own address (owner, 2 Oct 2026). Twenty Rome
 * landmarks and a Dubai tower sat in the corpus with no country: no GB postcode rule
 * could place them, and their owned addresses name Italy, the Vatican and the UAE.
 *
 * Only a country NAME is evidence — the last component of an address that is not a
 * code. The Vatican is VA, never Italy. 00000 is not a postcode and decides nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { countryNamedIn, countryFromAddresses } from '../src/domain/countryFromAddress.js';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const index = await import('../src/repositories/placeIndex.js');
test.after(() => pool.end());

test('the country an address names, and only a country', () => {
  assert.equal(countryNamedIn('Piazza della Bocca della Verità, Municipio Roma I, Rome, Lazio, 00153, Italy'), 'IT');
  assert.equal(countryNamedIn('Viale della Zitella, Vatican City, 00120'), 'VA', 'the Vatican is its own country');
  assert.equal(countryNamedIn("St Peter's Square, 00120 Vatican City, Vatican City"), 'VA');
  assert.equal(countryNamedIn('Iris Bay Tower, Business Bay, Dubai, United Arab Emirates'), 'AE');
  assert.equal(countryNamedIn('Windsor, SL4 1NJ, United Kingdom'), 'GB', 'not the reserved code UK');
  assert.equal(countryNamedIn('Iris Bay Tower, Business Bay, Dubai, Dubai, 00000'), null, 'a city and a placeholder name no country');
  assert.equal(countryNamedIn('Piazza di San Giovanni in Laterano, Roma, 00184'), null, 'a city is not evidence');
  assert.equal(countryNamedIn('Atlanta, Georgia'), null, 'a name that is also a US state is refused');
  assert.equal(countryNamedIn('Italy, Via Roma, Milan'), null, 'only the last real component counts');
  assert.equal(countryNamedIn('00000'), null);
  // Current ISO codes only — never an obsolete one the runtime still names (Codex).
  for (const [name, code] of [['Germany', 'DE'], ['Serbia', 'RS'], ['Vietnam', 'VN'], ['Curaçao', 'CW'], ['Vanuatu', 'VU'], ['Yemen', 'YE'], ['Kosovo', 'XK']]) {
    assert.equal(countryNamedIn(`Somewhere, ${name}`), code, name);
  }
});

test('owned addresses must agree; a disagreement is not resolved by picking one', () => {
  assert.deepEqual(countryFromAddresses(['a, Rome, Italy', 'Roma, 00186']), { code: 'IT', from: 'a, Rome, Italy' });
  assert.equal(countryFromAddresses(['a, Italy', 'b, Vatican City']).code, null);
  assert.match(countryFromAddresses(['a, Italy', 'b, Vatican City']).reason, /disagree/);
  assert.match(countryFromAddresses(['Dubai, Dubai, 00000']).reason, /no owned address names a country/);
});

const place = async (ref, { country = null, address = null, facts = [] } = {}) => {
  await index.noteMany([{ ref, lat: 41.9, lng: 12.5 }], { source: 'osm' });
  await query('update place_index set country_code = $2 where venue_ref = $1', [ref, country]);
  await query(`insert into place_records (venue_ref, address, postcode, updated_at) values ($1, $2, '00000', now())
               on conflict (venue_ref) do update set address = excluded.address`, [ref, address]);
  for (const [source, value] of facts) {
    await query(`insert into place_facts (venue_ref, field, source, value, licence, retention) values ($1, 'address', $2, to_jsonb($3::text), 'ODbL', 'indefinite')
                 on conflict (venue_ref, field, source) do update set value = excluded.value`, [ref, source, value]);
  }
};
const countryOf = async (ref) => (await query('select country_code from place_index where venue_ref = $1', [ref])).rows[0].country_code;

test('the settle pass fills a missing country from owned addresses, and reports what it could not', async () => {
  await place('google:addr-pantheon', { address: 'Piazza della Rotonda, Roma, 00186', facts: [['nominatim', 'Piazza della Rotonda, Municipio Roma I, Rome, Lazio, 00186, Italy']] });
  await place('google:addr-vatican', { address: 'Viale della Zitella, Vatican City, 00120' });
  await place('google:addr-dubai', { address: 'Iris Bay Tower, Business Bay, Dubai, Dubai, 00000' });
  await place('google:addr-gb', { country: 'GB', address: 'Somewhere, Rome, Italy' });

  const out = await index.settleCountriesFromAddresses(['google:addr-pantheon', 'google:addr-vatican', 'google:addr-dubai', 'google:addr-gb']);
  assert.deepEqual(out.settled.map((s) => [s.ref, s.country]).sort(),
    [['google:addr-pantheon', 'IT'], ['google:addr-vatican', 'VA']]);
  assert.deepEqual(out.unsettled, [{ ref: 'google:addr-dubai', reason: 'no owned address names a country' }],
    'the placeholder 00000 settled nothing');
  assert.equal(await countryOf('google:addr-pantheon'), 'IT');
  assert.equal(await countryOf('google:addr-vatican'), 'VA');
  assert.equal(await countryOf('google:addr-dubai'), null);
  assert.equal(await countryOf('google:addr-gb'), 'GB', 'a stamped country is never overridden from text');
  const { rows: [q] } = await query(`select placed_at from place_index where venue_ref = 'google:addr-pantheon'`);
  assert.equal(q.placed_at, null, 'requeued, so settle files it under Italy');

  // Once an owned address names the UAE, Dubai settles too.
  await place('google:addr-dubai', { facts: [['nominatim', 'Iris Bay Tower, Business Bay, Dubai, United Arab Emirates']] });
  const again = await index.settleCountriesFromAddresses(['google:addr-dubai']);
  assert.deepEqual(again.settled.map((s) => s.country), ['AE']);
});

test('the area-key check names the settled, the unsettled with its reason, and the placeholders', async () => {
  const m = await import('../src/desk/markets.js');
  await place('google:addr-unknown', { address: 'Somewhere, 00000' });
  await query(`insert into place_records (venue_ref, postcode, updated_at) values ('google:addr-na', 'N/A', now())
               on conflict (venue_ref) do update set postcode = excluded.postcode`);
  const out = await m.areaKeyCheck();
  assert.ok(out.nonGbPlaces.some((p) => p.venue_ref === 'google:addr-vatican' && p.country === 'VA'));
  const v = out.addressVerdicts.find((x) => x.venue_ref === 'google:addr-unknown');
  assert.equal(v.reason, 'no owned address names a country');
  assert.ok(out.placeholderPostcodes.some((p) => p.postcode === '00000' && p.places >= 1));
  assert.ok(out.placeholderPostcodes.some((p) => p.postcode === 'N/A'), 'in any case');
  // And migration 357 is confirmed from the database, not inferred from a deploy.
  // The test database is built without the runner's ledger, so it cannot say.
  assert.equal(out.migration357.recorded, null);
  assert.match(out.migration357.recordedReason, /no schema_migrations/);
  assert.deepEqual(out.migration357.area_counts_key, ['country_code', 'area_slug', 'category', 'subcategory']);
  assert.equal(out.migration357.slug_check, true);
  assert.equal(out.migration357.country_default, null);
});
