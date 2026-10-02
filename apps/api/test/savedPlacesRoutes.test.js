/**
 * Back office › Saved places and Photo review (owner, 2 Oct 2026, Parts 2–3):
 * the summary withholds its rates until a pass has finished; Compare calls
 * Google only on the click, ledgers it as admin.photo_compare and stores
 * nothing; a verdict is one of three, and both need the owner signed in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { savedPlacesRouter, photoReviewRouter } = await import('../src/routes/savedPlaces.js');
const { googleSource } = await import('../src/sources/google.js');
const { runAsAccount } = await import('../src/context.js');

test.after(() => pool.end());

let HH;
test.before(async () => {
  ({ rows: [{ id: HH }] } = await query(`insert into households (name) values ('photo review test') returning id`));
});

async function serve({ elevated = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.access = { doors: ['admin'], capabilities: new Set(['view_library', 'manage_library']), isOwner: true, role: null, elevated };
    req.session = { id: null };
    runAsAccount({ id: null, email: 'roger@epic.day', household_id: HH }, next);
  });
  app.use('/saved', savedPlacesRouter);
  app.use('/review', photoReviewRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  return { base, close: () => new Promise((d) => s.close(d)) };
}

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('the summary says nothing until a pass has finished, then gives its rates; spend comes from the ledger', async () => {
  await query(`delete from saved_place_enrichment`);
  await query(`delete from provider_calls where purpose = 'claude.enrich.saved_place'`);
  const { base, close } = await serve();
  const ledger = (usd) => query(`insert into provider_calls (household_id, provider, purpose, estimated_cost_usd) values ($1, 'anthropic', 'claude.enrich.saved_place', $2)`, [HH, usd]);
  try {
    const empty = await (await fetch(`${base}/saved`)).json();
    assert.equal(empty.summary.done, 0);
    assert.equal(empty.summary.websitePct, null, 'withheld, not nought');
    assert.equal(empty.summary.avgCostPence, null);
    const a = `google:sum-${randomUUID()}`; const b = `google:sum-${randomUUID()}`;
    await query(`insert into saved_place_enrichment (venue_ref, household_id, state, found) values
      ($1, $3, 'done', '{"fields":{"website":{"value":"https://a.example/","source":"site"}},"pictures":{"openverse":{"stored":1}}}'),
      ($2, $3, 'done', '{"fields":{"website":{"value":null,"source":"unknown"}},"pictures":{}}')`, [a, b, HH]);
    await ledger(0.10); await ledger(0.06);
    const two = await (await fetch(`${base}/saved`)).json();
    assert.equal(two.summary.done, 2);
    assert.equal(two.summary.websitePct, 50, 'an unknown website is not a found one');
    assert.equal(two.summary.ownedImagePct, 50);
    assert.equal(two.summary.paidPasses, 2);
    assert.equal(two.summary.avgCostPence, 6.3, '$0.08 average at the ledger rate');
    // A pass cut short after it was paid for: on the ledger, so it counts.
    await ledger(0.04);
    const three = await (await fetch(`${base}/saved`)).json();
    assert.equal(three.summary.paidPasses, 3);
    assert.equal(three.summary.totalCostPence, Math.round(0.20 * 0.79 * 1000) / 10);
    assert.equal(three.summary.avgCostPerPlacePence, Math.round((0.20 / 2) * 0.79 * 1000) / 10);
    assert.equal(three.summary.done, 2, 'hit rates stay over the finished places');
  } finally { await close(); }
});

test('Compare asks Google on the click, ledgers it, keeps nothing; a verdict is one of three', async () => {
  const ref = `google:cmp-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Compared Place', '{}')`, [ref]);
  const original = googleSource.photos;
  let asked = 0;
  googleSource.photos = async (_id, { meter } = {}) => { asked += 1; if (meter) meter['google-pro'] = 1; return [{ ref: 'places/x/photos/1', attribution: 'A' }]; };
  const { base, close } = await serve();
  try {
    const before = asked;
    await fetch(`${base}/review?q=Compared`);
    assert.equal(asked, before, 'listing places never calls Google');
    const res = await post(`${base}/review/compare`, { ref });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(asked, before + 1);
    assert.equal(body.google[0].ref, 'places/x/photos/1');
    const { rows: ledger } = await query(`select purpose from provider_calls where purpose = 'admin.photo_compare' and venue_ref = $1`, [ref]);
    assert.equal(ledger.length, 1, 'ledgered under its own purpose');
    const { rows: stored } = await query(`select count(*)::int as n from image_assets where source_ref like 'places/x/%'`);
    assert.equal(stored[0].n, 0, 'Google photographs are never stored');

    assert.equal((await post(`${base}/review/verdict`, { ref, verdict: 'lovely' })).status, 400);
    const ok = await post(`${base}/review/verdict`, { ref, verdict: 'owned_worse_acceptable', note: 'darker' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).verdict, 'owned_worse_acceptable');
  } finally { googleSource.photos = original; await close(); }
});

test('an agent or shared session can read but cannot compare, verdict or re-run', async () => {
  const { base, close } = await serve({ elevated: false });
  try {
    assert.equal((await fetch(`${base}/saved`)).status, 200);
    for (const [path, body] of [['/review/compare', { ref: 'google:x' }], ['/review/verdict', { ref: 'google:x', verdict: 'owned_fine' }], ['/saved/rerun', { ref: 'google:x' }]]) {
      const res = await post(`${base}${path}`, body);
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).error, 'needs_personal_sign_in');
    }
  } finally { await close(); }
});

test('a place whose only pictures are on its own website is findable in Photo review', async () => {
  const ref = `google:venue-only-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Venue Only Bistro', '{}')`, [ref]);
  await query(`insert into venue_site_images (venue_ref, image_url, page_url) values ($1, 'https://vo.example/a.jpg', 'https://vo.example/')`, [ref]);
  const { base, close } = await serve();
  try {
    const body = await (await fetch(`${base}/review?q=Venue%20Only&reviewed=no`)).json();
    const row = body.places.find((p) => p.venueRef === ref);
    assert.ok(row, 'listed');
    assert.equal(row.pictures, 1);
    assert.ok(body.summary.places >= 1);
  } finally { await close(); }
});

test('a verdict settles the pictures waiting for it: accepted becomes the card picture, not fit is turned down', async () => {
  const mk = async (ref, n) => {
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      const { rows: [img] } = await query(
        `insert into image_assets (source, source_ref, licence, may_store, moderation) values ('openverse', $1, 'CC BY 2.0', true, 'pending') returning id`,
        [`openverse:v-${randomUUID()}`]);
      await query(`insert into image_links (image_id, subject_type, subject_id, role, position) values ($1, 'place', $2, 'gallery', $3)`, [img.id, ref, 10 + i]);
      ids.push(img.id);
    }
    return ids;
  };
  const good = `google:v-good-${randomUUID()}`; const bad = `google:v-bad-${randomUUID()}`;
  const goodIds = await mk(good, 2); const badIds = await mk(bad, 1);
  const { base, close } = await serve();
  try {
    const ok = await (await post(`${base}/review/verdict`, { ref: good, verdict: 'owned_fine' })).json();
    assert.equal(ok.settled, 2);
    assert.equal(ok.hero, goodIds[0], 'the first becomes the card picture where there was none');
    const { rows: g } = await query(`select i.moderation, l.role from image_assets i join image_links l on l.image_id = i.id where l.subject_id = $1 order by l.position`, [good]);
    assert.deepEqual(g.map((r) => [r.moderation, r.role]), [['approved', 'hero'], ['approved', 'gallery']]);
    const no = await (await post(`${base}/review/verdict`, { ref: bad, verdict: 'owned_not_fit' })).json();
    assert.equal(no.settled, 1);
    assert.equal(no.hero, null);
    const { rows: [b] } = await query(`select moderation from image_assets where id = $1`, [badIds[0]]);
    assert.equal(b.moderation, 'rejected');
  } finally { await close(); }
});

test('a changed verdict re-settles its pictures both ways, and a picture found after the verdict reopens the review', async () => {
  const ref = `google:rev-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Revised Place', '{}')`, [ref]);
  const { rows: [img] } = await query(
    `insert into image_assets (source, source_ref, licence, may_store, moderation) values ('openverse', $1, 'CC BY 2.0', true, 'pending') returning id`, [`openverse:rev-${randomUUID()}`]);
  await query(`insert into image_links (image_id, subject_type, subject_id, role, position) values ($1, 'place', $2, 'gallery', 10)`, [img.id, ref]);
  const { base, close } = await serve();
  const state = async () => (await query(`select i.moderation, l.role from image_assets i join image_links l on l.image_id = i.id where i.id = $1`, [img.id])).rows[0];
  try {
    await post(`${base}/review/verdict`, { ref, verdict: 'owned_fine' });
    assert.deepEqual(await state(), { moderation: 'approved', role: 'hero' });
    await post(`${base}/review/verdict`, { ref, verdict: 'owned_not_fit' });
    assert.deepEqual(await state(), { moderation: 'rejected', role: 'gallery' }, 'taken down, and off the card');
    await post(`${base}/review/verdict`, { ref, verdict: 'owned_worse_acceptable' });
    assert.equal((await state()).moderation, 'approved', 'and brought back');

    const listed = async () => (await (await fetch(`${base}/review?q=Revised&reviewed=no`)).json()).places.some((p) => p.venueRef === ref);
    assert.equal(await listed(), false, 'reviewed');
    const { rows: [img2] } = await query(
      `insert into image_assets (source, source_ref, licence, may_store, moderation, fetched_at) values ('openverse', $1, 'CC BY 2.0', true, 'pending', now() + interval '1 minute') returning id`, [`openverse:rev2-${randomUUID()}`]);
    await query(`insert into image_links (image_id, subject_type, subject_id, role, position) values ($1, 'place', $2, 'gallery', 11)`, [img2.id, ref]);
    assert.equal(await listed(), true, 'a new picture since the verdict puts it back in the queue');
  } finally { await close(); }
});

test('a venue-site picture found after the verdict reopens the review, and a reopened place leaves the verdict counts', async () => {
  const ref = `google:reopen-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Reopened Venue', '{}')`, [ref]);
  await query(`insert into venue_site_images (venue_ref, image_url, page_url, found_at) values ($1, 'https://ro.example/a.jpg', 'https://ro.example/', now() - interval '1 day')`, [ref]);
  await query(`insert into photo_reviews (venue_ref, verdict) values ($1, 'owned_fine')`, [ref]);
  const { base, close } = await serve();
  try {
    const listed = async () => (await (await fetch(`${base}/review?q=Reopened&reviewed=no`)).json()).places.some((p) => p.venueRef === ref);
    const before = (await (await fetch(`${base}/review`)).json()).summary;
    assert.equal(await listed(), false);
    await query(`insert into venue_site_images (venue_ref, image_url, page_url, found_at) values ($1, 'https://ro.example/b.jpg', 'https://ro.example/', now() + interval '1 minute')`, [ref]);
    assert.equal(await listed(), true, 'the new picture has never been assessed');
    const after = (await (await fetch(`${base}/review`)).json()).summary;
    assert.equal(after.reviewed, before.reviewed - 1);
    assert.equal(after.fine, before.fine - 1, 'its old verdict no longer counts');
    assert.ok(after.fine + after.acceptable + after.not_fit <= after.reviewed);
  } finally { await close(); }
});

test('a place judged not fit stays in the review; a picture added since a verdict reopens it whatever its state', async () => {
  const ref = `google:nf-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Notfit Only', '{}')`, [ref]);
  const { rows: [img] } = await query(`insert into image_assets (source, source_ref, licence, may_store, moderation) values ('openverse', $1, 'CC BY 2.0', true, 'pending') returning id`, [`openverse:nf-${randomUUID()}`]);
  await query(`insert into image_links (image_id, subject_type, subject_id, role, position) values ($1, 'place', $2, 'gallery', 10)`, [img.id, ref]);
  const { base, close } = await serve();
  try {
    await post(`${base}/review/verdict`, { ref, verdict: 'owned_not_fit' });
    const all = (await (await fetch(`${base}/review?q=Notfit&reviewed=yes`)).json()).places;
    assert.ok(all.some((p) => p.venueRef === ref && p.verdict === 'owned_not_fit'), 'still there to be changed');
    const { rows: [c] } = await query(`insert into image_assets (source, source_ref, licence, may_store, moderation, fetched_at) values ('wikimedia', $1, 'CC BY-SA 4.0', true, 'approved', now() + interval '1 minute') returning id`, [`File:nf-${randomUUID()}.jpg`]);
    await query(`insert into image_links (image_id, subject_type, subject_id, role, position) values ($1, 'place', $2, 'gallery', 11)`, [c.id, ref]);
    const open = (await (await fetch(`${base}/review?q=Notfit&reviewed=no`)).json()).places;
    assert.ok(open.some((p) => p.venueRef === ref), 'an approved Commons picture found since reopens it');
  } finally { await close(); }
});

test('an existing picture newly linked to a place after its verdict reopens the review', async () => {
  const ref = `google:link-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Linked Later', '{}')`, [ref]);
  await query(`insert into venue_site_images (venue_ref, image_url, page_url, found_at) values ($1, 'https://ll.example/a.jpg', 'https://ll.example/', now() - interval '2 days')`, [ref]);
  await query(`insert into photo_reviews (venue_ref, verdict, reviewed_at) values ($1, 'owned_fine', now() - interval '1 day')`, [ref]);
  const { rows: [old] } = await query(`insert into image_assets (source, source_ref, licence, may_store, moderation, fetched_at) values ('wikimedia', $1, 'CC0', true, 'approved', now() - interval '30 days') returning id`, [`File:ll-${randomUUID()}.jpg`]);
  await query(`insert into image_links (image_id, subject_type, subject_id, role, position) values ($1, 'place', $2, 'gallery', 1)`, [old.id, ref]);
  const { base, close } = await serve();
  try {
    const open = (await (await fetch(`${base}/review?q=Linked%20Later&reviewed=no`)).json()).places;
    assert.ok(open.some((p) => p.venueRef === ref), 'fetched long ago, linked just now: a new picture for this place');
  } finally { await close(); }
});

test('a turned-down picture is still shown in the place\'s detail, on a signed link', async () => {
  const ref = `google:shown-${randomUUID()}`;
  const { rows: [img] } = await query(`insert into image_assets (source, source_ref, licence, may_store, moderation) values ('openverse', $1, 'CC BY 2.0', true, 'rejected') returning id`, [`openverse:sh-${randomUUID()}`]);
  await query(`insert into image_links (image_id, subject_type, subject_id, role, position) values ($1, 'place', $2, 'gallery', 10)`, [img.id, ref]);
  const { base, close } = await serve();
  try {
    const d = await (await fetch(`${base}/saved/place?ref=${encodeURIComponent(ref)}`)).json();
    const p = d.ownedPictures.find((x) => x.id === img.id);
    assert.ok(p, 'there to be reconsidered');
    assert.equal(p.moderation, 'rejected');
    assert.ok(p.sig && p.exp, 'drawn on a signed link');
  } finally { await close(); }
});

test('accepting a verdict where a turned-down picture still holds the card puts the accepted one there instead', async () => {
  const ref = `google:rhero-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Rejected Hero', '{}')`, [ref]);
  const { rows: [old] } = await query(`insert into image_assets (source, source_ref, licence, may_store, moderation) values ('wikimedia', $1, 'CC0', true, 'rejected') returning id`, [`File:rh-${randomUUID()}.jpg`]);
  await query(`insert into image_links (image_id, subject_type, subject_id, role, position) values ($1, 'place', $2, 'hero', 0)`, [old.id, ref]);
  const { rows: [nu] } = await query(`insert into image_assets (source, source_ref, licence, may_store, moderation) values ('openverse', $1, 'CC BY 2.0', true, 'pending') returning id`, [`openverse:rh-${randomUUID()}`]);
  await query(`insert into image_links (image_id, subject_type, subject_id, role, position) values ($1, 'place', $2, 'gallery', 10)`, [nu.id, ref]);
  const { base, close } = await serve();
  try {
    const res = await post(`${base}/review/verdict`, { ref, verdict: 'owned_fine' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).hero, nu.id);
    const { rows } = await query(`select image_id, role from image_links where subject_id = $1 order by role`, [ref]);
    assert.deepEqual(rows.map((r) => [r.image_id, r.role]).sort(), [[nu.id, 'hero'], [old.id, 'gallery']].sort());
    const list = (await (await fetch(`${base}/review?q=Rejected%20Hero`)).json()).places;
    assert.equal(list.find((p) => p.venueRef === ref).pictures, 2, 'turned-down pictures counted, as shown');
  } finally { await close(); }
});

test('a household\'s pending link stops drawing a picture once it is turned down; only a review link does', async () => {
  const { imageRouter } = await import('../src/routes/library.js');
  const { stampImage, stampReviewImage } = await import('../src/sources/photoLinks.js');
  const { rows: [img] } = await query(
    `insert into image_assets (source, source_ref, licence, may_store, moderation) values ('household', $1, 'household', true, 'pending') returning id`, [`h-${randomUUID()}`]);
  await query(`insert into image_variants (image_id, width, mime, bytes, body) values ($1, 500, 'image/jpeg', 3, $2)`, [img.id, Buffer.from([0xff, 0xd8, 0xff])]);
  const app = express(); app.use('/img', imageRouter);
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  const url = (st) => `http://127.0.0.1:${s.address().port}/img/${img.id}/500?s=${encodeURIComponent(st.sig)}&e=${st.exp}`;
  try {
    const householdLink = stampImage({ id: img.id });
    const reviewLink = stampReviewImage({ id: img.id });
    assert.equal((await fetch(url(householdLink))).status, 200, 'pending: the household link draws it');
    await query(`update image_assets set moderation = 'rejected' where id = $1`, [img.id]);
    assert.equal((await fetch(url(householdLink))).status, 404, 'turned down: that link no longer draws it');
    assert.equal((await fetch(url(reviewLink))).status, 200, 'the review link still does, for reconsidering');
  } finally { await new Promise((d) => s.close(d)); }
});
