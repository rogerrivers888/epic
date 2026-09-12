/**
 * Where a new place files (owner, 12 Sep 2026): the location the household
 * already has where the map names it; the nearest one they have where the
 * point is close enough to be in it; a new one otherwise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { fileUnder, kmBetween, SNAP_KM } = await import('../src/domain/fileUnder.js');

const CITIES = [
  { country: 'United Kingdom', countryCode: 'GB', locality: 'London', lat: 51.5074, lng: -0.1278 },
  { country: 'United Kingdom', countryCode: 'GB', locality: 'Runnymede', lat: 51.42, lng: -0.55 },
  { country: 'Italy', countryCode: 'IT', locality: 'Rome', lat: 41.9028, lng: 12.4964 },
];

test('the map names a location they already hold: it files there', () => {
  const r = fileUnder({ country: 'United Kingdom', countryCode: 'GB', locality: 'London' }, CITIES, { lat: 51.46, lng: -0.30 });
  assert.equal(r.locality, 'London');
  assert.equal(r.how, 'known');
});

test('the name is matched without regard to case or spaces', () => {
  const r = fileUnder({ countryCode: 'gb', locality: ' london ' }, CITIES, null);
  assert.equal(r.locality, 'London');
  assert.equal(r.countryCode, 'gb');
});

test('a district next door within reach snaps to the nearest location they hold', () => {
  // Thorpe Park is in Runnymede; a point in neighbouring Spelthorne, 5 km off.
  const r = fileUnder({ country: 'United Kingdom', countryCode: 'GB', locality: 'Spelthorne' }, CITIES, { lat: 51.43, lng: -0.48 });
  assert.equal(r.locality, 'Runnymede');
  assert.equal(r.how, 'nearest');
  assert.ok(r.km < SNAP_KM);
});

test('somewhere too far from anything they hold becomes a new location, in the map\'s words', () => {
  const r = fileUnder({ country: 'United Kingdom', countryCode: 'GB', locality: 'Bath' }, CITIES, { lat: 51.38, lng: -2.36 });
  assert.equal(r.locality, 'Bath');
  assert.equal(r.how, 'new');
});

test('never snaps across a border', () => {
  // Just over the water from nothing in particular: an Italian point never lands in Runnymede.
  const r = fileUnder({ country: 'Italy', countryCode: 'IT', locality: 'Fiumicino' }, CITIES, { lat: 41.77, lng: 12.23 });
  assert.equal(r.locality, 'Fiumicino');
  assert.equal(r.how, 'new');
});

test('no country from the map means no filing, and says so', () => {
  const r = fileUnder(null, CITIES, { lat: 0, lng: 0 });
  assert.equal(r.how, 'unknown');
  assert.equal(r.countryCode, null);
});

test('kmBetween is the great-circle distance', () => {
  assert.ok(Math.abs(kmBetween({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 }) - 343.5) < 2);
});
