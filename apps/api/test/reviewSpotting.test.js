/**
 * Review-spotting (C30, authorised as C61, owner 2 Oct 2026).
 *
 * The whole reason C61 reopens what the 21 Sep verdict closed is the filter: the
 * 21 Sep pass harvested every word and opinions drowned the signal. So the tests
 * that matter are the ones that prove concrete features survive and opinions,
 * adjectives and service words do not — and that a Google-raised feature is
 * stored as our own derived output (feature, place, polarity) in the holding pen,
 * never promotable on Google alone, with no Google text kept.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

// The test database is built and DATABASE_URL pointed at it before anything that
// imports `db.js` loads — `reviewSpotting.js` imports it, so it comes in here,
// dynamically, after the switch (the same reason questions.test.js does).
const { query, pool } = await testDatabase();
const { looksLikeFeature, spotFeatures, spotFromDetail } = await import('../src/sources/reviewSpotting.js');

test('concrete features pass the filter; opinions, adjectives and service words do not', () => {
  for (const f of ['splash pad', 'toddler pool', 'mini race track', 'waterfall', 'sauna', 'steam room', 'trig point', 'soft play', 'changing room', 'swimming pool']) {
    assert.equal(looksLikeFeature(f), true, `${f} is a concrete feature and should pass`);
  }
  // The exact words the owner named (delicious, friendly, staff, great, clean) and
  // their neighbours — the 21 Sep noise — must not.
  for (const w of ['delicious', 'friendly', 'staff', 'great', 'clean', 'lovely', 'atmosphere', 'service', 'friendly staff', 'amazing', 'highly recommend', 'value for money']) {
    assert.equal(looksLikeFeature(w), false, `${w} is opinion/service and should be filtered`);
  }
  // Generic solo nouns and fragments are not features on their own …
  for (const w of ['room', 'area', 'point', 'walk', 'food', 'kid', 'splash', 'pad']) {
    assert.equal(looksLikeFeature(w), false, `solo ${w} is a fragment and should be filtered`);
  }
  // … but the two-word feature that contains one still stands.
  assert.equal(looksLikeFeature('steam room'), true);
  assert.equal(looksLikeFeature('race track'), true);
  // A bare age word is not a facility — it must not ride in on the age signal; the
  // facility phrase that names one does.
  for (const w of ['toddler', 'family', 'families', 'baby', 'babies']) {
    assert.equal(looksLikeFeature(w), false, `bare ${w} is not a feature`);
  }
  for (const f of ['baby changing', 'soft play', 'step free access', 'wheelchair access']) {
    assert.equal(looksLikeFeature(f), true, `${f} names a facility`);
  }
});

test('spotFeatures reads reviews in memory and keeps only the features, with polarity', () => {
  const detail = {
    reviewSummary: 'The splash pad was great and the staff were friendly. Delicious food.',
    reviews: [
      { text: { text: 'Lovely sauna and steam room. We could not find a toddler pool.' } },
      'The waterfall walk was amazing.',
    ],
  };
  const f = spotFeatures(detail);
  const kept = [...f.keys()];
  assert.ok(kept.includes('splash pad'), 'splash pad kept');
  assert.ok(kept.includes('sauna'), 'sauna kept');
  assert.ok(kept.includes('steam room'), 'steam room kept');
  assert.ok(kept.includes('waterfall'), 'waterfall kept');
  for (const noise of ['staff', 'friendly', 'delicious', 'great', 'lovely', 'amazing', 'food']) {
    assert.ok(!kept.includes(noise), `${noise} filtered out`);
  }
  // "could not find a toddler pool" is a denial — captured at extraction, never
  // re-readable once the text is gone (§5.1).
  assert.equal(f.get('toddler pool')?.denies, 1, 'the denial is counted');
});

test('a Google-raised feature is queued in the pen as our own derived output, no text kept', async () => {
  const sub = 'c30-test-parks';
  const ref = 'google:ChIJ_c30_spotting_test';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 test parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  // A known feature already in our fact list, and a new one that is not.
  await query("insert into place_attributes (key, label, kind) values ('swimming-pool', 'Swimming pool', 'yesno') on conflict do nothing");
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);

  const report = await spotFromDetail({
    venueRef: ref,
    detail: {
      reviewSummary: 'Great splash pad and a lovely swimming pool. Friendly staff, delicious food.',
      reviews: [{ text: { text: 'The sauna was amazing.' } }],
    },
  });

  // It reports what it queued and what it filtered, and which were already known.
  assert.ok(report.queued >= 3, 'splash pad, swimming pool and sauna queued');
  assert.ok(report.filtered > 0, 'the opinions were filtered, not queued');
  assert.ok(report.known >= 1, 'swimming pool is a known feature');
  assert.equal(report.subcategory, sub);

  const { rows } = await query("select norm, sources, status, evidence, examples, kind, asserts from harvest_candidates where subcategory = $1 order by norm", [sub]);
  const byNorm = Object.fromEntries(rows.map((r) => [r.norm, r]));
  // The features are there …
  assert.ok(byNorm['splash pad'], 'splash pad queued');
  assert.ok(byNorm['sauna'], 'sauna queued');
  // … the opinions are not.
  for (const noise of ['staff', 'friendly', 'delicious', 'great', 'lovely', 'amazing', 'food']) {
    assert.ok(!byNorm[noise], `${noise} not queued`);
  }
  const sp = byNorm['splash pad'];
  // Stored as our own derived output: the source, the place link, the polarity —
  // and a Google-raised word carries NO evidence quote, so it stays in the pen
  // and can never be promoted on Google alone.
  assert.deepEqual(sp.sources, { google: 1 });
  assert.equal(sp.status, 'unresolved', 'google-raised → holding pen, not promotable');
  assert.equal(sp.evidence, null, 'no Google text is ever kept');
  assert.ok(sp.examples.includes(ref), 'the place→feature link is kept');
  assert.equal(sp.asserts >= 1, true);
});

test('a feature seen at two places counts two; the same place twice counts once', async () => {
  const sub = 'c30-count-parks';
  const a = 'google:ChIJ_c30_count_a';
  const b = 'google:ChIJ_c30_count_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 count parks', 'c30-test-cat') on conflict do nothing", [sub]);
  for (const r of [a, b]) await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [r, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);

  const detail = { reviewSummary: 'A lovely splash pad.' };
  await spotFromDetail({ venueRef: a, detail });
  const again = await spotFromDetail({ venueRef: a, detail });   // same place again — must not double-count
  assert.equal(again.features.find((f) => f.norm === 'splash pad').places, 1, 'one place, however many times it is searched');

  const second = await spotFromDetail({ venueRef: b, detail });    // a second, different place
  assert.equal(second.features.find((f) => f.norm === 'splash pad').places, 2, 'two distinct places, counted two — not greatest(1,1)');
  const sightings = await query("select count(*)::int as n from review_sightings where norm = 'splash pad' and venue_ref = any($1)", [[a, b]]);
  assert.equal(sightings.rows[0].n, 2, 'one sighting row per place');
});

test('a deleted place takes its sightings with it (cascade)', async () => {
  const sub = 'c30-count-parks';
  const gone = 'google:ChIJ_c30_gone';
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [gone, sub]);
  await spotFromDetail({ venueRef: gone, detail: { reviewSummary: 'A splash pad.' } });
  assert.equal((await query('select count(*)::int n from review_sightings where venue_ref = $1', [gone])).rows[0].n, 1);
  await query('delete from place_index where venue_ref = $1', [gone]);
  assert.equal((await query('select count(*)::int n from review_sightings where venue_ref = $1', [gone])).rows[0].n, 0, 'the sighting went with the place');
});

test('spotFromDetail never throws, and queues nothing it cannot file', async () => {
  // No ref, no detail, an unindexed place: each returns a quiet empty report.
  assert.equal((await spotFromDetail({})).queued, 0);
  assert.equal((await spotFromDetail({ venueRef: 'google:nope', detail: { reviewSummary: 'splash pad' } })).queued, 0, 'an unindexed place files nothing');
});

test('C61 records review-spotting AND leaves the paid bulk pass refused', async () => {
  // The paid-pass verdict still stands — nothing supersedes it — so googleHarvest
  // keeps refusing. This is the invariant the migration had to get right: a row
  // that named harvest.google-pass in `supersedes` would have reopened it.
  const standing = await query(
    `select 1 from data_verdicts v where v.key = 'harvest.google-pass'
       and not exists (select 1 from data_verdicts l where l.supersedes = v.key)`);
  assert.equal(standing.rowCount, 1, 'the paid bulk pass verdict still stands');
  // And the review-spotting allowance is on the record.
  const spotting = await query("select supersedes from data_verdicts where key = 'harvest.review-spotting'");
  assert.equal(spotting.rowCount, 1, 'the review-spotting verdict is recorded');
  assert.equal(spotting.rows[0].supersedes, null, 'it must not supersede the paid-pass row');
});

test.after(async () => { await pool.end(); });
