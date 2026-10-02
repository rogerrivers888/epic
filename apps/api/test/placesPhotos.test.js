/**
 * Places photos as fast as Inspire (owner, 2 Oct 2026). Three causes of a
 * Places screen that took minutes to show its pictures, one test each:
 *
 *   • the live name lookup carries the photograph references in the same call,
 *     so a named card needs no second Place Details;
 *   • the rest are asked for side by side before the page goes, and the page
 *     waits a bounded moment for them — never for the station lookup;
 *   • a refused station lookup rests before it is tried again, rather than
 *     being redone first on every read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { resolveNames } = await import('../src/sources/displayNames.js');
const { googleSource } = await import('../src/sources/google.js');
const { photosKept, photosNow, needsPhoto } = await import('../src/sources/rentedPhoto.js');
const { whereDue, fillWhere } = await import('../src/sources/where.js');
const { runAsSpender } = await import('../src/context.js');

test.after(() => pool.end());

async function household() {
  const { rows: [h] } = await query('insert into households (name) values ($1) returning id', ['places photos test']);
  return h.id;
}

async function session(label) {
  const { rows: [s] } = await query(
    `insert into api_sessions (token_hash, label) values ($1, 'test device') returning id`, [`test:${label}:${randomUUID()}`]);
  return s.id;
}

test('the live name lookup brings the photograph references with it', async () => {
  const hh = await household();
  const sid = await session('names-photos');
  const ref = `google:np-${randomUUID()}`;
  const original = googleSource.displayName;
  let photoCalls = 0;
  googleSource.displayName = async (_id, { onPhotos } = {}) => {
    onPhotos?.([{ ref: 'places/x/photos/one', attribution: 'A. Person' }]);
    return 'Live Name';
  };
  const originalPhotos = googleSource.photos;
  googleSource.photos = async () => { photoCalls += 1; return []; };
  try {
    const rows = [{ venueRef: ref, name: null }];
    await runAsSpender({ householdId: hh, sessionId: sid }, () => resolveNames(rows, { refKey: 'venueRef', purpose: 'test.names.photos' }));
    assert.equal(rows[0].name, 'Live Name');
    const kept = photosKept(ref);
    assert.equal(kept?.[0]?.ref, 'places/x/photos/one', 'the reference is held in memory');
    assert.equal(needsPhoto(ref, false), false, 'so the card needs no second request');
    await runAsSpender({ householdId: hh, sessionId: sid }, () => photosNow(hh, [{ venueRef: ref, hasOwn: false }]));
    assert.equal(photoCalls, 0, 'and nothing else is bought for its picture');
  } finally {
    googleSource.displayName = original;
    googleSource.photos = originalPhotos;
  }
});

test('the photograph references are asked for side by side, once each, and the page waits a bounded moment', async () => {
  const hh = await household();
  const sid = await session('photos-now');
  const refs = Array.from({ length: 6 }, () => `google:pn-${randomUUID()}`);
  const slow = `google:slow-${randomUUID()}`;
  const original = googleSource.photos;
  let inFlight = 0; let most = 0; const asked = [];
  googleSource.photos = async (id) => {
    asked.push(id);
    inFlight += 1; most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, id.startsWith('slow-') ? 400 : 40));
    inFlight -= 1;
    return [{ ref: `places/${id}/photos/a`, attribution: '' }];
  };
  try {
    const rows = [...refs, slow].map((venueRef) => ({ venueRef, hasOwn: false }));
    const owned = { venueRef: `google:own-${randomUUID()}`, hasOwn: true };
    const t = Date.now();
    await runAsSpender({ householdId: hh, sessionId: sid }, () => photosNow(hh, [...rows, owned], { deadlineMs: 150 }));
    const took = Date.now() - t;
    assert.ok(most >= 6, `asked in parallel (at most ${most} at once)`);
    assert.ok(took < 350, `the page waited ${took}ms, not for the slow one`);
    for (const r of refs) assert.ok(photosKept(r)?.length, 'every quick answer is on this read');
    assert.equal(photosKept(slow), null, 'the slow one missed the deadline');
    assert.ok(!asked.includes(owned.venueRef.slice('google:'.length)), 'a place with its own photograph costs nothing');
    // The next read joins the lookup still running instead of buying it again.
    await runAsSpender({ householdId: hh, sessionId: sid }, () => photosNow(hh, rows, { deadlineMs: 1000 }));
    assert.ok(photosKept(slow)?.length, 'it lands for the next read');
    assert.equal(asked.filter((id) => id.startsWith('slow-')).length, 1, 'asked once, not once per read');
  } finally {
    googleSource.photos = original;
  }
});

test('a refused station lookup rests before it is tried again, and keeps the postcode it found', async () => {
  const hh = await household();
  const ref = `google:where-${randomUUID()}`;
  await query(`insert into household_places (household_id, venue_ref, label) values ($1, $2, 'Somewhere')`, [hh, ref]);
  const row = { venue_ref: ref, lat: 51.5, lng: -0.1, where_checked: null, postcode: 'WC2N' };
  assert.equal(whereDue(hh, row), true, 'never asked, so due');
  assert.equal(whereDue(hh, { ...row, where_checked: new Date() }), false, 'a checked row is done');
  assert.equal(whereDue(hh, { ...row, lat: null }), false, 'a row with no point cannot be looked up');
  const seen = [];
  await fillWhere(hh, [row], { lookup: async (_lat, _lng, opts) => { seen.push(opts.postcode); return { postcode: opts.postcode, station: null, failed: true }; } });
  assert.deepEqual(seen, ['WC2N'], 'the postcode already found is handed over, not asked for again');
  assert.equal(whereDue(hh, row), false, 'refused: it rests rather than being redone on the next read');
  const again = await fillWhere(hh, [row], { lookup: async () => { throw new Error('should rest'); } });
  assert.equal(again, 0, 'and the next fill passes it by');
  const { rows: [hp] } = await query('select postcode, where_checked from household_places where household_id = $1 and venue_ref = $2', [hh, ref]);
  assert.equal(hp.postcode, 'WC2N');
  assert.equal(hp.where_checked, null, 'not stamped as checked, so it is tried again later');
});
