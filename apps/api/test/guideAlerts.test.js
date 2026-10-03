/**
 * "Tell me when" on the subcategory guides (routes/guideAlerts.js,
 * sources/ukPlace.js, migration 372).
 *
 * The failures worth pinning are the quiet ones: a refusal in a different order
 * or different words from the page, a consent stored that nobody was shown, a
 * repeat that says "you're already on it", a place guessed rather than left as
 * typed, and the demand counted in rows rather than people.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();

const { guideAlertsRouter, readAlert, GUIDE_CONSENT } = await import('../src/routes/guideAlerts.js');
const { demandByPlace } = await import('../src/repositories/guideAlerts.js');
const { placeOf, placeKeyOf } = await import('../src/sources/ukPlace.js');
const { isPublicPath } = await import('../src/auth.js');

const looked = [];
const PLACES = {
  reading: { name: 'Reading', county: 'Reading', region: 'South East', country: 'England', lat: 51.45, lng: -0.97, source: 'os-open-names' },
};
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api', guideAlertsRouter({ lookup: async (typed) => { looked.push(typed); return PLACES[typed.toLowerCase()] ?? null; } }));
app.use((err, req, res, _next) => res.status(500).json({ error: 'error', message: err.message }));
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); return pool.end(); });

let ip = 0;
const post = async (body) => {
  ip += 1;
  const res = await fetch(`${base}/api/guide-alerts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${ip}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const POTTERY = {
  subcategory: 'pottery', where: 'Reading', within: 15, consent: true, locale: 'en-gb',
  consentWording: 'Email me when pottery classes start near there. At most one email a week; unsubscribe in one tap.',
};
const rowsFor = async (email) => (await query('select * from guide_alerts where lower(email) = lower($1) order by created_at, place_typed', [email])).rows;

test('the form is a public path, and only the POST', () => {
  assert.equal(isPublicPath({ method: 'POST', path: '/api/guide-alerts' }), true);
  assert.equal(isPublicPath({ method: 'GET', path: '/api/guide-alerts' }), false);
});

test('an ask is stored lowercased with where it was filed, the radius, the consent and the campaign', async () => {
  const r = await post({ ...POTTERY, email: ' Clay.Fan@Example.COM ', pageUrl: 'https://epic.day/en-gb/events/pottery', utmCampaign: 'autumn', gclid: 'g1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, place: 'Reading' });
  const [row] = await rowsFor('clay.fan@example.com');
  assert.equal(row.email, 'clay.fan@example.com');
  assert.equal(row.subcategory, 'pottery');
  assert.equal(row.place_typed, 'Reading');
  assert.equal(row.place_name, 'Reading');
  assert.equal(row.county, 'Reading');
  assert.equal(row.place_source, 'os-open-names');
  assert.equal(row.within_miles, 15);
  assert.equal(row.consent_wording, POTTERY.consentWording);
  assert.equal(row.page_url, 'https://epic.day/en-gb/events/pottery');
  assert.equal(row.utm_campaign, 'autumn');
  assert.equal(row.gclid, 'g1');
});

test('a place that cannot be told is kept as typed, never refused and never guessed', async () => {
  const r = await post({ ...POTTERY, email: 'narnia@example.com', where: 'Narnia' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, place: null });
  const [row] = await rowsFor('narnia@example.com');
  assert.equal(row.place_typed, 'Narnia');
  assert.equal(row.place_name, null);
  assert.equal(row.place_source, null);
});

test('a repeat is the same 200 and one row; another place or another guide is another ask', async () => {
  await post({ ...POTTERY, email: 'again@example.com' });
  const again = await post({ ...POTTERY, email: 'AGAIN@example.com', where: 'reading' });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { ok: true, place: 'Reading' });
  assert.equal((await rowsFor('again@example.com')).length, 1);
  await post({ ...POTTERY, email: 'again@example.com', where: 'Bath' });
  await post({ ...POTTERY, email: 'again@example.com', subcategory: 'fossil-hunting', consentWording: GUIDE_CONSENT['fossil-hunting'] });
  assert.equal((await rowsFor('again@example.com')).length, 3);
});

test('a second ask for the same place is the latest word: its radius wins, and a lookup that failed before is filled in', async () => {
  await post({ ...POTTERY, email: 'latest@example.com', where: 'Narnia', within: 15 });
  PLACES.narnia = { name: 'Narnia', county: 'Lantern Waste', region: null, country: null, lat: 1, lng: 2, source: 'os-open-names' };
  try {
    const r = await post({ ...POTTERY, email: 'latest@example.com', where: 'narnia', within: 50 });
    assert.deepEqual(r.body, { ok: true, place: 'Narnia' }, 'answered like a first ask');
  } finally { delete PLACES.narnia; }
  const rows = await rowsFor('latest@example.com');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].within_miles, 50);
  assert.equal(rows[0].county, 'Lantern Waste');
  // A lookup that fails the third time never erases what the second found.
  await post({ ...POTTERY, email: 'latest@example.com', where: 'NARNIA', within: 10 });
  const [after] = await rowsFor('latest@example.com');
  assert.equal(after.within_miles, 10);
  assert.equal(after.county, 'Lantern Waste');
  // Asking again after unsubscribing is asking again.
  await query(`update guide_alerts set unsubscribed_at = now() where email = 'latest@example.com'`);
  await post({ ...POTTERY, email: 'latest@example.com', where: 'narnia' });
  assert.equal((await rowsFor('latest@example.com'))[0].unsubscribed_at, null);
});

test('one postcode however it is written is one ask', async () => {
  for (const where of ['RG1 1AA', 'rg11aa', ' Rg1  1aA ']) await post({ ...POTTERY, email: 'postcode@example.com', where });
  const rows = await rowsFor('postcode@example.com');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].place_key, 'pc:RG1 1AA');
  assert.equal(placeKeyOf('rg1', null), 'oc:RG1');
  assert.equal(placeKeyOf('Dorset', { source: 'county', county: 'Dorset' }), 'county:Dorset');
  assert.equal(placeKeyOf('Bath', { source: 'os-open-names', id: 'osgb400' }), 'os:osgb400');
  assert.equal(placeKeyOf('  Lyme   Regis ', null), 'typed:lyme regis');
});

test('the honeypot is thanked, and nothing is stored or looked up', async () => {
  looked.length = 0;
  const r = await post({ ...POTTERY, email: 'bot@example.com', website: 'http://spam.example' });
  assert.equal(r.status, 200);
  assert.equal((await rowsFor('bot@example.com')).length, 0);
  assert.equal(looked.length, 0);
});

test('refusals come in the page\'s order and words: email, then place, then the tick', async () => {
  const both = await post({ ...POTTERY, email: 'nope', where: '', consent: false });
  assert.deepEqual(both.body, { error: 'bad_email', message: "That email doesn't look right." });
  const place = await post({ ...POTTERY, email: 'ok@example.com', where: '   ', consent: false });
  assert.deepEqual(place.body, { error: 'no_place', message: 'Add a city, county or postcode.' });
  const tick = await post({ ...POTTERY, email: 'ok@example.com', consent: false });
  assert.deepEqual(tick.body, { error: 'no_consent', message: 'Tick the box so we can email you.' });
  // "true" as a string is not a tick.
  assert.equal((await post({ ...POTTERY, email: 'ok@example.com', consent: 'true' })).body.error, 'no_consent');
  assert.equal((await rowsFor('ok@example.com')).length, 0);
});

test('only the guides there are, their own consent sentence, the four radii and a known locale', async () => {
  const cases = [
    [{ subcategory: 'water-parks' }, 'bad_subcategory'],
    [{ subcategory: '__proto__' }, 'bad_subcategory'],
    [{ consentWording: GUIDE_CONSENT['fossil-hunting'] }, 'bad_consent'],
    [{ consentWording: 'Email me about anything you like.' }, 'bad_consent'],
    [{ within: 5 }, 'bad_within'],
    [{ within: '15; drop table' }, 'bad_within'],
    [{ locale: 'fr-fr' }, 'bad_locale'],
  ];
  for (const [change, error] of cases) {
    const r = await post({ ...POTTERY, email: 'rules@example.com', ...change });
    assert.equal(r.status, 400, JSON.stringify(change));
    assert.equal(r.body.error, error, JSON.stringify(change));
  }
  assert.equal((await rowsFor('rules@example.com')).length, 0);
  assert.equal(readAlert({ ...POTTERY, email: 'a@b.co', within: '25' }).alert.within, 25, 'a radius may arrive as text');
});

test('the demand counts people, not rows, and leaves out anybody who unsubscribed', async () => {
  await query('delete from guide_alerts');
  await post({ ...POTTERY, email: 'one@example.com' });
  await post({ ...POTTERY, email: 'two@example.com' });
  await post({ ...POTTERY, email: 'two@example.com', where: 'READING' });
  await post({ ...POTTERY, email: 'gone@example.com' });
  await query(`update guide_alerts set unsubscribed_at = now() where email = 'gone@example.com'`);
  await post({ ...POTTERY, email: 'one@example.com', where: 'narnia' });
  const rows = await demandByPlace();
  assert.deepEqual(rows.map((r) => [r.subcategory, r.place, r.resolved, r.people]), [
    ['pottery', 'Reading', true, 2],
    ['pottery', 'Narnia', false, 1],
  ]);
});

test('the place lookup: counties from the list, postcodes from ONS, names only on an exact match', async () => {
  const asked = [];
  const fake = (answers) => async (url) => {
    asked.push(url);
    const hit = Object.entries(answers).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ result: hit[1] }) };
  };
  // A county never asks anybody: Open Names does not know "Dorset", and finds a Surrey hamlet for "Isle of Wight".
  assert.equal((await placeOf('dorset', { fetchImpl: fake({}) })).county, 'Dorset');
  assert.equal((await placeOf('Co. Durham', { fetchImpl: fake({}) })).name, 'County Durham');
  assert.equal(asked.length, 0);

  const pc = await placeOf('sw1a1aa', { fetchImpl: fake({ '/postcodes/SW1A%201AA': { admin_district: 'Westminster', admin_county: null, region: 'London', country: 'England', latitude: 51.5, longitude: -0.14 } }) });
  assert.deepEqual([pc.name, pc.county, pc.source], ['Westminster', 'Westminster', 'ons-postcode']);
  const oc = await placeOf('rg1', { fetchImpl: fake({ '/outcodes/RG1': { admin_district: ['Reading', 'Wokingham'], admin_county: [], country: ['England'], latitude: 51.45, longitude: -0.97 } }) });
  assert.deepEqual([oc.name, oc.county, oc.source], ['RG1', 'Reading', 'ons-outcode']);

  const names = [
    { name_1: 'Bath Street', local_type: 'Other Settlement', county_unitary: 'Gloucestershire' },
    { name_1: 'Bath', local_type: 'Village', county_unitary: 'Somewhere' },
    { name_1: 'Bath', local_type: 'City', county_unitary: 'Bath and North East Somerset', region: 'South West', latitude: 51.38, longitude: -2.36 },
  ];
  const bath = await placeOf('bath', { fetchImpl: fake({ '/places?q=bath': names }) });
  assert.deepEqual([bath.name, bath.county, bath.source], ['Bath', 'Bath and North East Somerset', 'os-open-names'], 'the city, not the village or the street');
  assert.equal(await placeOf('Bat', { fetchImpl: fake({ '/places?q=Bat': names }) }), null, 'no exact match is no answer');
  assert.equal(await placeOf('Reading', { fetchImpl: async () => { throw new Error('down'); } }), null, 'a failed lookup is no answer, never a throw');
  assert.equal(await placeOf('   '), null);
});
