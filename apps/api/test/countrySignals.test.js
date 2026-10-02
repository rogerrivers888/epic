/**
 * What a place's own text says about its country, held against the stamp (owner,
 * 2 Oct 2026). Iris Bay Tower — a Dubai business — was stamped GB from its Google
 * pin in Heston; its own phone, domain and prices all say the UAE, and nothing read
 * them. A check, not a rule: it names the disagreement and changes no country.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneCountries, websiteCountry, currenciesIn, disagreements } from '../src/domain/countrySignals.js';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
test.after(() => pool.end());

test('each signal names a country, or says nothing', () => {
  assert.deepEqual(phoneCountries('+971585072674'), ['AE']);
  assert.deepEqual(phoneCountries('+44 1753 123456'), ['GB', 'JE', 'GG', 'IM']);
  assert.deepEqual(phoneCountries('0039 06 1234'), ['IT', 'VA', 'SM']);
  assert.equal(phoneCountries('01753 123456'), null, 'a local number names no country');
  assert.deepEqual(phoneCountries('+999 1'), ['?'], 'international but unrecognised is said so');
  assert.equal(websiteCountry('https://dunebuggyrentaldubai.ae/'), 'AE');
  assert.equal(websiteCountry('www.example.co.uk'), 'GB');
  assert.equal(websiteCountry('https://example.com'), null);
  assert.equal(websiteCountry('https://startup.io'), null, 'a vanity domain is not a country');
  assert.deepEqual(currenciesIn('AED 399 - AED 1499'), ['AED']);
  assert.deepEqual(currenciesIn('££'), ['GBP']);
  assert.deepEqual(currenciesIn('$$'), [], 'a price-level sign is not a currency');
});

test('Iris Bay Tower: three of its own signals say the UAE against a GB stamp', () => {
  const d = disagreements({
    country: 'GB',
    addresses: [{ source: 'nominatim', value: '38 Lampton Road, Heston, London, England, TW3 1JH, United Kingdom' }, { source: 'site', value: 'Iris Bay Tower, Business Bay, Dubai, Dubai, 00000' }],
    phone: '+971585072674', website: 'https://dunebuggyrentaldubai.ae/', priceRange: 'AED 399 - AED 1499',
  }, (c) => ({ GB: 'GBP', AE: 'AED' })[c] ?? null);
  assert.deepEqual(d.map((x) => [x.signal, x.says]), [['phone', 'AE'], ['website', 'AE'], ['currency', 'AED']]);
  // "Dubai" is a city: no signal guesses a country from it.
  assert.ok(!d.some((x) => x.signal === 'address'));
});

test('a place whose own text agrees with its stamp raises nothing', () => {
  assert.deepEqual(disagreements({ country: 'GB', addresses: [{ source: 'site', value: 'High St, Windsor, SL4 1NJ, United Kingdom' }], phone: '+44 1753 1', website: 'https://x.co.uk', priceRange: '££' }, () => 'GBP'), []);
  // Codex: a town that shares a country's name is not read from a venue's address…
  assert.deepEqual(disagreements({ country: 'US', addresses: [{ source: 'site', value: '123 Main St, Lebanon, 37087' }] }), []);
  assert.deepEqual(disagreements({ country: 'US', addresses: [{ source: 'site', value: '123 Main St, Lebanon' }] }), [], 'a street and a town');
  // …and an unrecognised prefix, or a stamp the table does not cover, says nothing.
  assert.deepEqual(disagreements({ country: 'ID', phone: '+62 21 1234' }), []);
  assert.deepEqual(disagreements({ country: 'GB', phone: '+62 21 1234' }), []);
  // But a venue's own address that ends with a country is read.
  assert.deepEqual(disagreements({ country: 'GB', addresses: [{ source: 'site', value: 'Iris Bay, Dubai, United Arab Emirates' }] }).map((d) => d.says), ['AE']);
  assert.deepEqual(disagreements({ country: 'VA', phone: '+39 06 1' }), [], 'the Vatican shares Italy\'s calling code');
});

test('the check reads every settled place with a record and names the contradictions', async () => {
  const m = await import('../src/desk/markets.js');
  await query(`insert into place_index (venue_ref, country_code) values ('google:cs-iris', 'GB'), ('google:cs-fine', 'GB')
               on conflict (venue_ref) do update set country_code = excluded.country_code`);
  await query(`insert into place_facts (venue_ref, field, source, value, licence, retention) values
               ('google:cs-iris', 'address', 'site', to_jsonb('Iris Bay Tower, Business Bay, Dubai, Dubai, 00000'::text), 'own', 'indefinite')
               on conflict (venue_ref, field, source) do nothing`);
  await query(`insert into place_records (venue_ref, phone, website, price_range, address) values
               ('google:cs-iris', '+971585072674', 'https://dunebuggyrentaldubai.ae/', 'AED 399 - AED 1499', 'Iris Bay Tower, Business Bay, Dubai, Dubai, 00000'),
               ('google:cs-fine', '+44 1753 1', 'https://x.co.uk', '££', 'High St, Windsor, SL4 1NJ')
               on conflict (venue_ref) do update set phone = excluded.phone, website = excluded.website, price_range = excluded.price_range`);
  const out = await m.countryContradictions();
  const iris = out.places.find((p) => p.venue_ref === 'google:cs-iris');
  assert.equal(iris.signals.length, 3);
  assert.ok(!out.places.some((p) => p.venue_ref === 'google:cs-fine'));
  assert.ok(out.checked >= 2 && out.flagged >= 1 && out.twoOrMore >= 1);
  // An address typed into the record itself is read too (Codex).
  await query(`insert into place_index (venue_ref, country_code) values ('google:cs-typed', 'GB') on conflict (venue_ref) do update set country_code = 'GB'`);
  await query(`insert into place_records (venue_ref, address) values ('google:cs-typed', '1 Rue de Rivoli, Paris, France')
               on conflict (venue_ref) do update set address = excluded.address`);
  const again = await m.countryContradictions();
  const typed = again.places.find((p) => p.venue_ref === 'google:cs-typed');
  assert.deepEqual(typed?.signals.map((x) => [x.signal, x.says, x.source]), [['address', 'FR', 'record']]);
  assert.equal(out.listed, 'all');
});

test('the composed address is not counted twice', async () => {
  const m = await import('../src/desk/markets.js');
  await query(`insert into place_index (venue_ref, country_code) values ('google:cs-dup', 'GB') on conflict (venue_ref) do update set country_code = 'GB'`);
  await query(`insert into place_facts (venue_ref, field, source, value, licence, retention) values
               ('google:cs-dup', 'address', 'nominatim', to_jsonb('1 Rue de Rivoli, Paris, France'::text), 'ODbL', 'indefinite')
               on conflict (venue_ref, field, source) do nothing`);
  await query(`insert into place_records (venue_ref, address) values ('google:cs-dup', '1 Rue de Rivoli, Paris, France')
               on conflict (venue_ref) do update set address = excluded.address`);
  const out = await m.countryContradictions();
  const dup = out.places.find((p) => p.venue_ref === 'google:cs-dup');
  assert.deepEqual(dup.signals.map((x) => x.source), ['nominatim']);
});
