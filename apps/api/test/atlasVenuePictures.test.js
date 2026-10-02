/**
 * The venue's own pictures, unlicensed and held by address, reach the owner's
 * account and nobody else's (owner, 2 Oct 2026) — and only as a `photos`
 * entry, which the device's offline policy strips before anything is kept.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { atlas } = await import('../src/routes/atlas.js');
const { runAsAccount } = await import('../src/context.js');

test.after(() => pool.end());

async function serve(email, householdId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => runAsAccount({ id: null, email, household_id: householdId }, next));
  app.use('/atlas', atlas);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  return { base: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((d) => s.close(d)) };
}

test('the owner sees a venue-site picture on a bare row; another account does not', async () => {
  const realFetch = globalThis.fetch;
  const { rows: [{ id: hh }] } = await query(`insert into households (name) values ('venue pictures test') returning id`);
  const ref = `osm:node/${Math.floor(Math.random() * 1e9)}`;
  const town = `Testbury-${randomUUID().slice(0, 6)}`;
  await query(
    `insert into household_places (household_id, venue_ref, label, country_code, country, locality, kind)
     values ($1, $2, 'Bistro', 'GB', 'United Kingdom', $3, 'food')`, [hh, ref, town]);
  await query(`insert into venue_site_images (venue_ref, image_url, page_url, found_how) values ($1, 'https://bistro.example/front.jpg', 'https://bistro.example/', 'og:image')`, [ref]);
  const owner = await serve('roger@epic.day', hh);
  const other = await serve('guest@example.com', hh);
  try {
    // Only the test's own servers are reachable; every provider is closed.
    globalThis.fetch = async (url, opts) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, opts) : Promise.reject(new Error('network closed in tests')));
    const mine = await (await fetch(`${owner.base}/atlas/places?country=GB&city=${encodeURIComponent(town)}`)).json();
    const row = mine.places.find((p) => p.venueRef === ref);
    assert.ok(row, 'the row is there');
    assert.deepEqual(row.photos, [{ url: 'https://bistro.example/front.jpg', attribution: 'venue website' }]);
    const theirs = await (await fetch(`${other.base}/atlas/places?country=GB&city=${encodeURIComponent(town)}`)).json();
    const row2 = theirs.places.find((p) => p.venueRef === ref);
    assert.ok(row2);
    assert.equal(row2.photos, undefined, 'unlicensed pictures are the owner\'s alone');
    // Judged not fit in Photo review: no longer drawn, even for the owner.
    await query(`insert into photo_reviews (venue_ref, verdict) values ($1, 'owned_not_fit')`, [ref]);
    const after = await (await fetch(`${owner.base}/atlas/places?country=GB&city=${encodeURIComponent(town)}`)).json();
    assert.equal(after.places.find((p) => p.venueRef === ref).photos, undefined);
  } finally {
    globalThis.fetch = realFetch;
    await owner.close(); await other.close();
  }
});
