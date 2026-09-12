import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHECKED_ON, FIELDS, PROVIDERS, SERVICES, cellsOf, fieldByKey, matrix } from '../src/sources/catalogue.js';
import { sourceKeys } from '../src/sources/index.js';

/**
 * The catalogue of sources is only worth having if it is true. These hold its
 * `used` half to the code: every key resolves, every searchable source is in
 * it, and what it says Google is asked for is what google.js actually asks for.
 */

test('every field a provider names is in the master list, once', () => {
  const keys = FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, 'a master field is listed twice');
  for (const p of PROVIDERS) {
    for (const c of cellsOf(p)) assert.ok(fieldByKey.has(c.key), `${p.key} names "${c.key}", which is not a master field`);
    assert.ok(['own', 'id', 'none'].includes(p.keep), `${p.key} has no ownership grade`);
    assert.ok(p.licence && p.retention && p.file, `${p.key} is missing its licence, retention or file`);
  }
  assert.match(CHECKED_ON, /^\d{4}-\d{2}-\d{2}$/);
});

test('every source the search can run is in the catalogue', () => {
  for (const key of sourceKeys()) {
    if (['fixtures', 'scout', 'openai'].includes(key)) continue; // ours, a Claude run, and a service rather than a data provider
    assert.ok(PROVIDERS.some((p) => p.key === key), `${key} is searchable but not catalogued`);
  }
});

test('what the catalogue says Google is asked for is what google.js asks for', () => {
  const src = readFileSync(new URL('../src/sources/google.js', import.meta.url), 'utf8');
  const google = PROVIDERS.find((p) => p.key === 'google');
  // The field mask names top-level fields; a used path's first segment must be
  // in it, and an offered one must not — or the tag is a lie either way.
  const top = (path) => path.split(/[ /;(]/)[0].split('.')[0].split('[')[0];
  const masked = new Set([...src.matchAll(/places\.([A-Za-z]+)/g)].map((m) => m[1]).concat(['id', 'reviews', 'nationalPhoneNumber', 'routingSummaries', 'contextualContents']));
  for (const [key, path] of Object.entries(google.used)) {
    if (key === 'photo_bytes') continue; // a media URL, not a field
    assert.ok(masked.has(top(path)), `google.used.${key} = "${path}" is not in the field mask`);
  }
  for (const [key, path] of Object.entries(google.offered)) {
    assert.ok(!masked.has(top(path)), `google.offered.${key} = "${path}" is requested, so it is used`);
  }
});

test('the matrix flags use and ownership from the used half only', () => {
  const rows = matrix();
  const parking = rows.find((r) => r.key === 'parking');
  assert.equal(parking.cells.google.status, 'offered');
  assert.equal(parking.cells.osm.status, 'used');
  assert.equal(parking.used, true);
  assert.equal(parking.keep, 'own');
  const tolls = rows.find((r) => r.key === 'tolls');
  assert.equal(tolls.used, false);
  assert.equal(tolls.keep, null);
  const rating = rows.find((r) => r.key === 'rating');
  assert.equal(rating.keep, 'id', 'a rating is only ever rented');
  assert.ok(SERVICES.every((s) => s.what && s.unit));
});
