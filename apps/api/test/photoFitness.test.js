/**
 * A machine look at each owned picture (owner, 2 Oct 2026): six checks, each
 * yes / no / don't know with a reason; Fit / Borderline / Not fit over them;
 * stored with the picture; it sorts the Photo review queue (Not fit last),
 * shows its agreement with the owner, and decides nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const fit = await import('../src/sources/photoFitness.js');
const { photoReviewRouter } = await import('../src/routes/savedPlaces.js');
const { runAsAccount } = await import('../src/context.js');
const { PURPOSE_CLASSES } = await import('../src/domain/costClass.js');

test.after(() => pool.end());

const all = (answer) => ({
  actual_place: { answer, reason: 'r' }, what_visitors_want: { answer, reason: 'r' }, sharp_and_well_lit: { answer, reason: 'r' },
  crops: { answer, reason: 'r' }, clean: { answer, reason: 'r' }, current: { answer, reason: 'r' },
});

test('the size half of the third check is ours, not the model\'s', () => {
  assert.equal(fit.sizeCheck({ answer: 'yes', reason: 'crisp' }, 800).answer, 'no', 'a small picture fails whatever it looks like');
  assert.equal(fit.sizeCheck({ answer: 'yes', reason: 'crisp' }, 1600).answer, 'yes');
  assert.equal(fit.sizeCheck({ answer: 'yes', reason: 'crisp' }, null).answer, 'unknown', 'a size nobody knows is not a pass');
  assert.equal(fit.sizeCheck({ answer: 'no', reason: 'blurred' }, 2000).answer, 'no');
});

test('Fit, Borderline and Not fit from the six answers', () => {
  const c = (o) => fit.CHECKS.map((k) => ({ key: k.key, answer: o[k.key] ?? 'yes' }));
  assert.equal(fit.verdictOf(c({})), 'fit');
  assert.equal(fit.verdictOf(c({ current: 'unknown' })), 'fit', 'one don\'t-know is allowed');
  assert.equal(fit.verdictOf(c({ current: 'unknown', crops: 'unknown' })), 'borderline');
  assert.equal(fit.verdictOf(c({ crops: 'no' })), 'borderline');
  assert.equal(fit.verdictOf(c({ actual_place: 'no' })), 'not_fit', 'not the place');
  assert.equal(fit.verdictOf(c({ clean: 'no' })), 'not_fit', 'watermarked, captioned, or a person');
  assert.equal(fit.verdictOf(c({ crops: 'no', current: 'no' })), 'not_fit', 'two failures');
  assert.equal(fit.verdictOf(c({ actual_place: 'unknown' })), 'borderline', 'not sure it is the place');
  assert.equal(fit.bestVerdict(['not_fit', 'borderline', null]), 'borderline');
});

async function picture(ref, { width = 1600 } = {}) {
  const { rows: [img] } = await query(
    `insert into image_assets (source, source_ref, licence, may_store, moderation, width, height)
     values ('openverse', $1, 'CC BY 2.0', true, 'pending', $2, 1000) returning id`, [`openverse:f-${randomUUID()}`, width]);
  await query(`insert into image_links (image_id, subject_type, subject_id, role, position) values ($1, 'place', $2, 'gallery', 10)`, [img.id, ref]);
  return img.id;
}

test('a look is stored with the picture under its purpose, and nothing is published by it', async () => {
  const ref = `google:fit-${randomUUID()}`;
  const id = await picture(ref, { width: 900 });
  let asked = null;
  const out = await fit.scorePicture({ venueRef: ref, imageId: id, name: 'The Pub', category: 'pub' }, {
    pictureOf: async () => ({ body: Buffer.from([0xff, 0xd8, 0xff]), mime: 'image/jpeg', longEdge: 900 }),
    parseStructured: async (args) => { asked = args; args.meta.costUsd = 0.003; return all('yes'); },
  });
  assert.equal(asked.purpose, 'claude.photo_fitness');
  assert.equal(asked.model, 'claude-haiku-4-5', 'the cheapest model with vision');
  assert.equal(asked.messages[0].content[0].type, 'image');
  assert.equal(out.verdict, 'borderline', 'everything yes but 900 px: the size check fails');
  assert.equal(out.checks.find((c) => c.key === 'sharp_lit_size').answer, 'no');
  assert.equal(Number(out.cost_usd), 0.003);
  const { rows: [img] } = await query(`select moderation from image_assets where id = $1`, [id]);
  assert.equal(img.moderation, 'pending', 'the machine decides nothing');
  assert.equal(PURPOSE_CLASSES['claude.photo_fitness'], 'library');
  assert.ok(!(await fit.unscored({ venueRef: ref })).length, 'looked at once, not again');
});

test('no picture to look at is skipped, never given a verdict', async () => {
  const out = await fit.scorePicture({ venueRef: 'google:none', imageUrl: 'https://gone.example/x.jpg' }, {
    pictureOf: async () => null,
    parseStructured: async () => { throw new Error('should not be asked'); },
  });
  assert.deepEqual(out, { skipped: 'no_picture' });
});

test('the queue puts the machine\'s Not fit last, shows agreement, and the board counts by category', async () => {
  const mk = async (name, verdict, owner) => {
    const ref = `google:q-${randomUUID()}`;
    await query(`insert into place_records (venue_ref, name, provenance) values ($1, $2, '{}')`, [ref, name]);
    await query(`insert into place_index (venue_ref, category, subcategory, ownership) values ($1, 'fun', null, 'claimed')`, [ref]);
    const id = await picture(ref);
    if (verdict) await query(`insert into photo_fitness (venue_ref, image_id, verdict, checks, model) values ($1, $2, $3, '[]', 'claude-haiku-4-5')`, [ref, id, verdict]);
    if (owner) await query(`insert into photo_reviews (venue_ref, verdict, reviewed_at) values ($1, $2, now() + interval '1 hour')`, [ref, owner]);
    return ref;
  };
  const tag = randomUUID().slice(0, 6);
  const notFit = await mk(`Qtest ${tag} A`, 'not_fit', null);
  const good = await mk(`Qtest ${tag} B`, 'fit', null);
  await mk(`Qtest ${tag} C`, 'fit', 'owned_fine');
  await mk(`Qtest ${tag} D`, 'borderline', 'owned_not_fit');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.access = { doors: ['admin'], capabilities: new Set(['view_library']), isOwner: true, role: null, elevated: true };
    runAsAccount({ id: null, email: 'roger@epic.day' }, next);
  });
  app.use('/review', photoReviewRouter);
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const list = await (await fetch(`${base}/review?q=${encodeURIComponent(`Qtest ${tag}`)}&reviewed=no`)).json();
    const order = list.places.map((p) => p.venueRef);
    assert.deepEqual(order, [good, notFit], 'unreviewed, the machine\'s Fit first and its Not fit last');
    assert.equal(list.places[1].machine, 'not_fit');
    assert.ok(list.summary.both >= 2);
    assert.equal(typeof list.summary.agreementPct, 'number');
    const board = await (await fetch(`${base}/review/board`)).json();
    const funRow = board.rows.find((r) => r.category === 'fun' && !r.subcategory);
    assert.ok(funRow && funRow.places >= 4);
    assert.ok(funRow.fitPct > 0);
  } finally { await new Promise((d) => s.close(d)); }
});
