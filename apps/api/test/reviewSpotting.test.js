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
const { looksLikeFeature, spotFeatures, spotFromDetail, reviewQueue, reviewQueueCounts, spottingTally } = await import('../src/sources/reviewSpotting.js');
const sets = await import('../src/repositories/questionSets.js');

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

test('the review queue lists spotted features with place counts and an example drawer', async () => {
  const sub = 'c30-queue-parks';
  const a = 'google:ChIJ_c30_q_a'; const b = 'google:ChIJ_c30_q_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 queue parks', 'c30-test-cat') on conflict do nothing", [sub]);
  for (const r of [a, b]) await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [r, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);
  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A splash pad and a sauna.' } });
  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A splash pad.' } });
  const sp = (await reviewQueue({ subcategory: sub })).find((f) => f.norm === 'splash pad');
  assert.ok(sp, 'splash pad is in the queue');
  assert.equal(sp.places, 2, 'seen at two places');
  assert.equal(sp.exampleSubcategory, sub);
  assert.equal(sp.known, false, 'not yet one of our facts');
});

test('approving a feature makes it a fact, asks it where there is a set, and clears the queue', async () => {
  const sub = 'c30-approve-parks';
  const ref = 'google:ChIJ_c30_appr';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 approve parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query("insert into question_sets (key, name) values ('c30-set', 'C30 set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-set') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from attribute_aliases where norm = 'water slide'").catch(() => {});
  await query("delete from place_attributes where key = 'water-slide'").catch(() => {});
  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A water slide.' } });
  assert.ok((await reviewQueue({ subcategory: sub })).some((f) => f.norm === 'water slide'), 'queued first');

  const res = await sets.approveFeature('water slide', { actor: 'tester' });
  assert.ok(res.attributeKey, 'a label was created');
  assert.ok(res.asked >= 1, 'asked in the drawer that has a set');
  assert.equal((await query('select 1 from place_attributes where key = $1', [res.attributeKey])).rowCount, 1, 'it is a fact now');
  assert.equal((await query('select 1 from questions where attribute_key = $1', [res.attributeKey])).rowCount, 1, 'and a question to verify');
  assert.ok(!(await reviewQueue({ subcategory: sub })).some((f) => f.norm === 'water slide'), 'gone from the queue');
  assert.equal((await query("select 1 from review_sightings where norm = 'water slide'")).rowCount, 0, 'sightings cleared');
  assert.equal((await query("select status from harvest_candidates where subcategory = $1 and norm = 'water slide'", [sub])).rows[0].status, 'promoted');
});

test('ignoring a feature drops it from the queue for good', async () => {
  const sub = 'c30-ignore-parks';
  const ref = 'google:ChIJ_c30_ign';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 ignore parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A climbing wall.' } });
  await sets.ignoreFeature('climbing wall', { actor: 'tester', reason: 'not one we track' });
  assert.ok(!(await reviewQueue({ subcategory: sub })).some((f) => f.norm === 'climbing wall'), 'gone from the queue');
  assert.equal((await query("select status from harvest_candidates where subcategory = $1 and norm = 'climbing wall'", [sub])).rows[0].status, 'ignored');
  assert.equal((await query("select 1 from review_sightings where norm = 'climbing wall'")).rowCount, 0, 'sightings cleared');
  // Re-spotting an ignored feature does not resurrect it: the tombstone drops it
  // before anything is written, so no sighting is even re-inserted.
  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A climbing wall.' } });
  assert.ok(!(await reviewQueue({ subcategory: sub })).some((f) => f.norm === 'climbing wall'), 'an ignored feature does not come back');
  assert.equal((await query("select 1 from review_sightings where norm = 'climbing wall'")).rowCount, 0, 'no sighting re-inserted for a tombstoned feature');
});

test('an ignore is permanent across a drawer it was never seen in before', async () => {
  // Codex, 2 Oct 2026: ignoring a word only marked the candidate rows that already
  // existed, so a later spot in a NEW subcategory re-raised it. The tombstone check
  // in spotFromDetail closes that — an ignore in one drawer is for good everywhere.
  const subA = 'c30-tomb-a'; const subB = 'c30-tomb-b';
  const a = 'google:ChIJ_c30_tomb_a'; const b = 'google:ChIJ_c30_tomb_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 tomb A', 'c30-test-cat') on conflict do nothing", [subA]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 tomb B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [a, subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);

  // Seen and ignored in drawer A. "ball pit" is a two-word feature whose parts are
  // not themselves features (pit is a head, not a solo noun), so the text raises it
  // alone — a clean test of one norm's tombstone.
  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A ball pit.' } });
  await sets.ignoreFeature('ball pit', { actor: 'tester', reason: 'not tracked' });

  // Now a place in a DIFFERENT drawer mentions it for the first time.
  const report = await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A ball pit.' } });
  assert.ok(!report.features.some((f) => f.norm === 'ball pit'), 'the tombstoned feature is not re-raised in the new drawer');
  assert.equal((await query("select count(*)::int n from review_sightings where norm = 'ball pit'")).rows[0].n, 0, 'no sighting written in the new drawer');
  assert.equal((await query('select count(*)::int n from harvest_candidates where subcategory = $1', [subB])).rows[0].n, 0, 'no candidate raised in the new drawer');
  assert.ok(!(await reviewQueue({ subcategory: subB })).some((f) => f.norm === 'ball pit'), 'and nothing in the new drawer’s queue');
});

test('a per-drawer ignoreCandidate does NOT tombstone the feature in other drawers', async () => {
  // Codex, 2 Oct 2026: the global tombstone must come only from the review queue's
  // norm-level Ignore (ignoreFeature), never from the ordinary per-subcategory
  // ignoreCandidate. "crazy golf" raises one feature (golf alone is a head, not a
  // solo noun, so it is filtered).
  const subA = 'c30-pd-a'; const subB = 'c30-pd-b';
  const a = 'google:ChIJ_c30_pd_a'; const b = 'google:ChIJ_c30_pd_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 pd A', 'c30-test-cat') on conflict do nothing", [subA]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 pd B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [a, subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);
  await query("delete from feature_tombstones where norm = 'crazy golf'");

  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A crazy golf.' } });
  const { rows: [cand] } = await query("select id from harvest_candidates where norm = 'crazy golf' and subcategory = $1", [subA]);
  await sets.ignoreCandidate(cand.id, { actor: 'tester', reason: 'not in this drawer' });
  assert.equal((await query("select count(*)::int n from feature_tombstones where norm = 'crazy golf'")).rows[0].n, 0, 'a per-drawer ignore writes no tombstone');

  // The same feature in a different drawer is still spotted.
  const report = await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A crazy golf.' } });
  assert.ok(report.features.some((f) => f.norm === 'crazy golf'), 'still raised in the other drawer');
  assert.equal((await query('select count(*)::int n from harvest_candidates where subcategory = $1', [subB])).rows[0].n >= 1, true, 'a candidate is raised in the other drawer');
});

test('approving a known feature asks it here and reuses the existing fact, not a new one', async () => {
  // P2#3/P2#4 (Codex, 2 Oct 2026): a spotted feature already in our fact list must
  // still be approvable — it adds the question in the spotted drawer — and must
  // reuse the existing attribute rather than silently minting or merging a key.
  const sub = 'c30-known-parks';
  const ref = 'google:ChIJ_c30_known';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 known parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query("insert into question_sets (key, name) values ('c30-known-set', 'C30 known set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-known-set') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from attribute_aliases where norm = 'wendy house'").catch(() => {});
  await query("insert into place_attributes (key, label, kind) values ('wendy-house', 'Wendy house', 'yesno') on conflict do nothing");

  const spotted = await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A wendy house.' } });
  assert.ok(spotted.features.find((f) => f.norm === 'wendy house')?.known, 'spotted as a known fact');

  const res = await sets.approveFeature('wendy house', { actor: 'tester' });
  assert.equal(res.attributeKey, 'wendy-house', 'reused the existing fact, not a new key');
  assert.ok(res.asked >= 1, 'asked in the spotted drawer');
  assert.equal((await query("select count(*)::int n from place_attributes where key like 'wendy%'")).rows[0].n, 1, 'no second label was minted');
});

test('approval refuses a custom label that collides with an unrelated fact', async () => {
  // P2#4 (Codex, 2 Oct 2026): on conflict do nothing used to suppress the collision
  // and silently map the feature onto whatever fact owned the key. A custom label
  // that slugs onto an unrelated existing key is now refused.
  const sub = 'c30-collide-parks';
  const ref = 'google:ChIJ_c30_collide';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 collide parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from attribute_aliases where norm = 'bowling green'").catch(() => {});
  await query("insert into place_attributes (key, label, kind) values ('picnic-area', 'Picnic area', 'yesno') on conflict do nothing");
  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A bowling green.' } });

  await assert.rejects(
    () => sets.approveFeature('bowling green', { actor: 'tester', label: 'picnic area' }),
    /already one of our labels/,
    'a label colliding with an unrelated fact is refused',
  );
  // And nothing was aliased onto the unrelated fact.
  assert.equal((await query("select count(*)::int n from attribute_aliases where norm = 'bowling green' and target_key = 'picnic-area'")).rows[0].n, 0, 'no silent merge');
});

test('a legacy Google-pass candidate with no sighting cannot be approved or ignored here', async () => {
  // Codex, 2 Oct 2026: the review queue's doors must act only on words review-spotting
  // actually raised (they leave a review_sighting), never on the 21 Sep Google-pass
  // candidates that carry sources ? 'google' but were never in this queue.
  const sub = 'c30-legacy';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 legacy', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query("delete from feature_tombstones where norm = 'legacy pavilion'");
  // A Google candidate created straight through the harvest door — no review_sighting.
  await sets.recordCandidates(sub, [{
    norm: 'legacy pavilion', raw: 'legacy pavilion', rawForms: ['legacy pavilion'],
    sources: ['google'], examples: [], kind: 'feature', placesSeen: 5, asserts: 5, denies: 0, asks: 0,
  }], { placesTotal: 5 });
  assert.equal((await query("select count(*)::int n from review_sightings where norm = 'legacy pavilion'")).rows[0].n, 0, 'no sighting, as a legacy candidate');

  await assert.rejects(() => sets.approveFeature('legacy pavilion', { actor: 'tester' }), /not a feature waiting in the review queue/);
  await assert.rejects(() => sets.ignoreFeature('legacy pavilion', { actor: 'tester' }), /not a feature waiting in the review queue/);
  // Neither door touched it: no tombstone, and the legacy candidate is untouched.
  assert.equal((await query("select count(*)::int n from feature_tombstones where norm = 'legacy pavilion'")).rows[0].n, 0, 'no tombstone written');
  assert.equal((await query("select status from harvest_candidates where subcategory = $1 and norm = 'legacy pavilion'", [sub])).rows[0].status, 'unresolved', 'the legacy candidate is left as it was');
});

test('approving does not re-ask a drawer where the word was ignored per-subcategory, nor count its sighting', async () => {
  // Codex, 2 Oct 2026: ignoreCandidate keeps a drawer's sightings but means "never
  // ask here again". A later spot in another drawer must not let approval add the
  // question back to the ignored drawer, and the queue must not count its sighting.
  // "sensory room" raises one feature (room alone is a head, not a solo noun).
  const subA = 'c30-pd2-a'; const subB = 'c30-pd2-b';
  const a = 'google:ChIJ_c30_pd2_a'; const b = 'google:ChIJ_c30_pd2_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 pd2 A', 'c30-test-cat') on conflict do nothing", [subA]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 pd2 B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query("insert into question_sets (key, name) values ('c30-pd2-set-a', 'A'), ('c30-pd2-set-b', 'B') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-pd2-set-a') on conflict do nothing", [subA]);
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-pd2-set-b') on conflict do nothing", [subB]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [a, subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);
  await query("delete from feature_tombstones where norm = 'sensory room'");
  await query("delete from attribute_aliases where norm = 'sensory room'").catch(() => {});
  await query("delete from place_attributes where key = 'sensory-room'").catch(() => {});

  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A sensory room.' } });
  const { rows: [candA] } = await query("select id from harvest_candidates where norm = 'sensory room' and subcategory = $1", [subA]);
  await sets.ignoreCandidate(candA.id, { actor: 'tester', reason: 'not this drawer' }); // per-drawer: keeps the sighting
  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A sensory room.' } });

  // The queue counts only drawer B — the ignored drawer A's sighting is stale.
  const q = (await reviewQueue()).find((f) => f.norm === 'sensory room');
  assert.ok(q, 'in the queue from drawer B');
  assert.equal(q.places, 1, 'drawer A’s ignored sighting is not counted');

  const res = await sets.approveFeature('sensory room', { actor: 'tester' });
  assert.deepEqual(res.subcategories, [subB], 'asked only in the drawer that was not ignored');
  assert.equal(res.asked, 1, 'one set asked');
});

test('a spotted synonym aliased onto an active fact reads as known, not new', async () => {
  // Codex, 2 Oct 2026: knownFeatureKeys only held keys and labels, so a wording
  // aliased onto an existing fact looked new and offered Approve. "splash zone"
  // raises one feature and is aliased onto an active splash-pad fact.
  const sub = 'c30-alias-parks';
  const ref = 'google:ChIJ_c30_alias';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 alias parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("insert into place_attributes (key, label, kind) values ('splash-pad', 'Splash pad', 'yesno') on conflict (key) do update set active = true");
  await query("insert into attribute_aliases (norm, target_key, raw) values ('splash zone', 'splash-pad', 'splash zone') on conflict (norm) do update set target_key = 'splash-pad'");

  const report = await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A splash zone.' } });
  assert.equal(report.features.find((f) => f.norm === 'splash zone')?.known, true, 'the aliased synonym is known');
  assert.equal((await reviewQueue({ subcategory: sub })).find((f) => f.norm === 'splash zone')?.known, true, 'and the queue marks it known');
});

test('approving a known feature reuses the fact even when its key is noncanonical', async () => {
  // Codex, 2 Oct 2026: a fact can be known by its label while its key is something
  // else (e.g. the label was renamed). Approval must ask that existing fact, not mint
  // a second one at slug(norm). "sensory garden" is known only by label here.
  const sub = 'c30-rename-parks';
  const ref = 'google:ChIJ_c30_rename';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 rename parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query("insert into question_sets (key, name) values ('c30-rename-set', 'C30 rename set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-rename-set') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from attribute_aliases where norm = 'sensory garden'").catch(() => {});
  await query("delete from place_attributes where key = 'sensory-garden'").catch(() => {});
  await query("insert into place_attributes (key, label, kind) values ('legacy-sg-key', 'Sensory garden', 'yesno') on conflict (key) do update set active = true, label = 'Sensory garden'");

  const report = await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A sensory garden.' } });
  assert.equal(report.features.find((f) => f.norm === 'sensory garden')?.known, true, 'known by its label');

  const res = await sets.approveFeature('sensory garden', { actor: 'tester' });
  assert.equal(res.attributeKey, 'legacy-sg-key', 'reused the existing fact by its real key');
  assert.equal((await query("select count(*)::int n from place_attributes where key = 'sensory-garden'")).rows[0].n, 0, 'no duplicate fact was minted');
});

test('a place reclassified after it was spotted still counts in its new drawer', async () => {
  // Codex, 2 Oct 2026: the queue is global on "awaiting a decision", so a place moved
  // to a new drawer (its candidate still filed under the old one) is not stranded.
  const subOld = 'c30-recat-old'; const subNew = 'c30-recat-new';
  const ref = 'google:ChIJ_c30_recat';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 recat old', 'c30-test-cat') on conflict do nothing", [subOld]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 recat new', 'c30-test-cat') on conflict do nothing", [subNew]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, subOld]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subOld, subNew]]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from feature_tombstones where norm = 'assault course'");

  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'An assault course.' } }); // filed under old
  await query('update place_index set subcategory = $2 where venue_ref = $1', [ref, subNew]); // reclassified, no re-spot

  const q = (await reviewQueue()).find((f) => f.norm === 'assault course');
  assert.ok(q, 'still in the queue after the place moved drawer');
  assert.equal(q.places, 1, 'counted in its new drawer');
  assert.equal(q.exampleSubcategory, subNew, 'shown under the current drawer');
});

test('approving a feature whose fact was retired brings the fact back', async () => {
  // Codex, 2 Oct 2026: an alias (or key) can point at a retired fact. Approving must
  // not attach a question to a switched-off fact — it reactivates it.
  const sub = 'c30-retired-parks';
  const ref = 'google:ChIJ_c30_retired';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 retired parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query("insert into question_sets (key, name) values ('c30-retired-set', 'C30 retired set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-retired-set') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("insert into place_attributes (key, label, kind, active) values ('dormant-fact', 'Dormant', 'yesno', false) on conflict (key) do update set active = false");
  await query("insert into attribute_aliases (norm, target_key, raw) values ('sun terrace', 'dormant-fact', 'sun terrace') on conflict (norm) do update set target_key = 'dormant-fact'");

  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A sun terrace.' } });
  const res = await sets.approveFeature('sun terrace', { actor: 'tester' });
  assert.equal(res.attributeKey, 'dormant-fact', 'reused the aliased fact');
  assert.equal((await query("select active from place_attributes where key = 'dormant-fact'")).rows[0].active, true, 'the retired fact was brought back');
});

test('asked counts new questions once, even when drawers share a set', async () => {
  // Codex, 2 Oct 2026: addQuestion returns the existing row too, and two drawers can
  // share one set, so asked must count genuinely new questions, once per set.
  const subX = 'c30-shared-x'; const subY = 'c30-shared-y';
  const x = 'google:ChIJ_c30_shared_x'; const y = 'google:ChIJ_c30_shared_y';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 shared X', 'c30-test-cat') on conflict do nothing", [subX]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 shared Y', 'c30-test-cat') on conflict do nothing", [subY]);
  await query("insert into question_sets (key, name) values ('c30-shared-set', 'C30 shared set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-shared-set'), ($2, 'c30-shared-set') on conflict do nothing", [subX, subY]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [x, subX]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [y, subY]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subX, subY]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[x, y]]);
  await query("delete from attribute_aliases where norm = 'paddling area'").catch(() => {});
  await query("delete from place_attributes where key = 'paddling-area'").catch(() => {});
  await query("delete from feature_tombstones where norm = 'paddling area'");

  await spotFromDetail({ venueRef: x, detail: { reviewSummary: 'A paddling area.' } });
  await spotFromDetail({ venueRef: y, detail: { reviewSummary: 'A paddling area.' } });
  const res = await sets.approveFeature('paddling area', { actor: 'tester' });
  assert.deepEqual(res.subcategories.sort(), [subX, subY], 'both drawers want it');
  assert.equal(res.asked, 1, 'the shared set is asked once, counted once');
  assert.equal((await query("select count(*)::int n from questions where attribute_key = $1 and set_key = 'c30-shared-set'", [res.attributeKey])).rows[0].n, 1, 'one question on the shared set');
});

test('a review-queue ignore closes owned candidates too, and no harvest can re-raise the word', async () => {
  // Codex, 2 Oct 2026 (P1): the permanent ignore is about the word. An owned
  // feature-harvest candidate for the same norm must be closed with it, and every
  // ingestion path — recordCandidates is the one door — must honour the tombstone.
  const sub = 'c30-p1-a'; const sub2 = 'c30-p1-b'; const sub3 = 'c30-p1-c';
  const ref = 'google:ChIJ_c30_p1';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  for (const [k, l] of [[sub, 'C30 p1 A'], [sub2, 'C30 p1 B'], [sub3, 'C30 p1 C']]) {
    await query("insert into shelf_subcategories (key, label, category_key) values ($1, $2, 'c30-test-cat') on conflict do nothing", [k, l]);
  }
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[sub, sub2, sub3]]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from feature_tombstones where norm = 'roof terrace'");
  const owned = [{ norm: 'roof terrace', raw: 'roof terrace', rawForms: ['roof terrace'], sources: ['venue'], examples: [], kind: 'feature', placesSeen: 1, asserts: 1, denies: 0, asks: 0 }];

  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A roof terrace.' } }); // Google-raised, in sub
  await sets.recordCandidates(sub2, owned, { placesTotal: 1 });                          // owned, in another drawer
  assert.equal((await query("select status from harvest_candidates where norm = 'roof terrace' and subcategory = $1", [sub2])).rows[0].status === 'ignored', false, 'the owned candidate starts undecided');

  await sets.ignoreFeature('roof terrace', { actor: 'tester' });
  assert.equal((await query("select status from harvest_candidates where norm = 'roof terrace' and subcategory = $1", [sub2])).rows[0].status, 'ignored', 'the owned candidate is closed with it');

  // A later owned harvest in a drawer that never saw the word does not raise it.
  const later = await sets.recordCandidates(sub3, owned, { placesTotal: 1 });
  assert.equal(later.skipped, 1, 'the tombstoned word is skipped at the door');
  assert.equal((await query("select count(*)::int n from harvest_candidates where norm = 'roof terrace' and subcategory = $1", [sub3])).rows[0].n, 0, 'no candidate raised in the new drawer');
});

test('approving switches an inactive question back on, and counts it', async () => {
  // Codex, 2 Oct 2026: addQuestion's on-conflict leaves an inactive question inactive,
  // so approval must reactivate it — otherwise "Ask here" asks nothing.
  const sub = 'c30-react-parks';
  const ref = 'google:ChIJ_c30_react';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 react parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query("insert into question_sets (key, name) values ('c30-react-set', 'C30 react set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-react-set') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("insert into place_attributes (key, label, kind) values ('sunken-garden', 'Sunken garden', 'yesno') on conflict (key) do update set active = true");
  await query("delete from questions where attribute_key = 'sunken-garden'");
  await query("insert into questions (attribute_key, scope, set_key, active) values ('sunken-garden', 'set', 'c30-react-set', false)");

  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A sunken garden.' } });
  const res = await sets.approveFeature('sunken garden', { actor: 'tester' });
  assert.equal(res.asked, 1, 'the reactivated question counts as newly asked');
  assert.equal((await query("select active from questions where attribute_key = 'sunken-garden' and set_key = 'c30-react-set'")).rows[0].active, true, 'the question is on again');
});

test('a label that takes a subcategory’s name is refused as a 400, not a 500', async () => {
  // Codex, 2 Oct 2026: our labels are one vocabulary (migration 110); the
  // epic_label_key_claim trigger raises 23505 on the insert, which approval must
  // turn into the same actionable refusal promote() gives.
  const sub = 'c30-claim-parks';
  const ref = 'google:ChIJ_c30_claim';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 claim parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from attribute_aliases where norm = 'sun deck'").catch(() => {});

  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A sun deck.' } });
  // Name it after an existing subcategory — the trigger's case.
  await assert.rejects(
    () => sets.approveFeature('sun deck', { actor: 'tester', label: sub }),
    (err) => err.status === 400 && /already one of our labels/.test(err.message),
  );
  assert.equal((await query("select status from harvest_candidates where norm = 'sun deck' and subcategory = $1", [sub])).rows[0].status, 'unresolved', 'nothing was decided — it can be approved under another name');
});

test('restoring a review-queue-ignored word lifts its tombstone, so harvests raise it again', async () => {
  // Codex, 2 Oct 2026: restore is the way back, so it must not report success while
  // the norm-level tombstone keeps every later harvest discarding the word.
  const sub = 'c30-restore-a'; const sub2 = 'c30-restore-b';
  const ref = 'google:ChIJ_c30_restore';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 restore A', 'c30-test-cat') on conflict do nothing", [sub]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 restore B', 'c30-test-cat') on conflict do nothing", [sub2]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[sub, sub2]]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from feature_tombstones where norm = 'boot room'");

  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A boot room.' } });
  await sets.ignoreFeature('boot room', { actor: 'tester' });
  const { rows: [cand] } = await query("select id from harvest_candidates where norm = 'boot room' and subcategory = $1", [sub]);
  const restored = await sets.unignore(cand.id);
  assert.ok(restored, 'the candidate came back');
  assert.equal((await query("select count(*)::int n from feature_tombstones where norm = 'boot room'")).rows[0].n, 0, 'the tombstone is lifted');

  const owned = [{ norm: 'boot room', raw: 'boot room', rawForms: ['boot room'], sources: ['venue'], examples: [], kind: 'feature', placesSeen: 1, asserts: 1, denies: 0, asks: 0 }];
  const later = await sets.recordCandidates(sub2, owned, { placesTotal: 1 });
  assert.equal(later.skipped, 0, 'a later harvest is no longer turned away');
  assert.equal((await query("select count(*)::int n from harvest_candidates where norm = 'boot room' and subcategory = $1", [sub2])).rows[0].n, 1, 'and raises the word again');
});

test('a review-queue ignore waits for a harvest already writing, so it cannot be undone by it', async () => {
  // Codex, 2 Oct 2026: a harvest holds the tombstone lock shared for its whole write;
  // ignoreFeature takes it exclusively, so it waits rather than letting the harvest
  // read "no tombstone" and insert after the ignore commits.
  const sub = 'c30-race-parks';
  const ref = 'google:ChIJ_c30_race';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 race parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from feature_tombstones where norm = 'music room'");
  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A music room.' } });

  // A harvest mid-write: it holds the shared lock in an open transaction.
  const harvest = await pool.connect();
  let done = false;
  try {
    await harvest.query('begin');
    await harvest.query('select pg_advisory_xact_lock_shared(hashtext($1)::bigint)', ['feature-tombstones']);
    const ignoring = sets.ignoreFeature('music room', { actor: 'tester' }).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(done, false, 'the ignore waits while the harvest is writing');
    await harvest.query('commit');
    await ignoring;
    assert.equal(done, true, 'and completes once the harvest has committed');
  } finally {
    harvest.release();
  }
  assert.equal((await query("select count(*)::int n from feature_tombstones where norm = 'music room'")).rows[0].n, 1, 'the tombstone stands');
});

test('with no question set yet, approval makes the fact now and asks it once a set is attached', async () => {
  // Owner, 2 Oct 2026: "create the fact anyway and start asking once a set is
  // attached. Don't refuse."
  const sub = 'c30-noset-parks';
  const ref = 'google:ChIJ_c30_noset';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 noset parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('delete from question_set_subcategories where subcategory_key = $1', [sub]);
  await query("insert into question_sets (key, name) values ('c30-later-set', 'C30 later set') on conflict do nothing");
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from attribute_aliases where norm = 'game room'").catch(() => {});
  await query("delete from questions where attribute_key = any($1)", [['game-room', 'games-room']]).catch(() => {});
  await query("delete from place_attributes where key = any($1)", [['game-room', 'games-room']]).catch(() => {});

  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A games room.' } });
  const res = await sets.approveFeature('game room', { actor: 'tester' });
  assert.equal((await query('select count(*)::int n from place_attributes where key = $1 and active', [res.attributeKey])).rows[0].n, 1, 'the fact is made at once');
  assert.equal(res.asked, 0, 'nothing to ask it in yet');
  assert.deepEqual(res.waiting, [sub], 'the drawer is owed the question');
  assert.ok(!(await reviewQueue({ subcategory: sub })).some((f) => f.norm === 'game room'), 'decided, so out of the queue');

  // Attaching a set to the drawer asks it.
  await sets.attach('c30-later-set', sub);
  assert.equal((await query("select count(*)::int n from questions where attribute_key = $1 and set_key = 'c30-later-set' and active", [res.attributeKey])).rows[0].n, 1, 'asked in the set just attached');
  assert.equal((await query('select count(*)::int n from feature_pending_asks where attribute_key = $1', [res.attributeKey])).rows[0].n, 0, 'and no longer owed');
});

test('each spotting pass is tallied as counts only: raised, filtered, queued', async () => {
  // The owner's report needs "opinions filtered out", which nothing else records.
  const sub = 'c30-tally-parks';
  const ref = 'google:ChIJ_c30_tally';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 tally parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from review_spotting_tallies where venue_ref = $1', [ref]);

  const r = await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'Friendly staff and delicious food. A study room.' } });
  const { rows: [t] } = await query('select raised, filtered, queued from review_spotting_tallies where venue_ref = $1', [ref]);
  assert.equal(t.filtered, r.filtered, 'the dropped phrases are counted');
  assert.ok(t.filtered > 0, 'opinions were dropped');
  assert.equal(t.queued, r.queued, 'and the queued features');
  assert.equal(t.raised, t.filtered + t.queued, 'raised = filtered + queued here (nothing tombstoned)');
  // An opinions-only pass is tallied too — that is most of what the filter is for.
  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'Friendly staff. Delicious.' } });
  assert.equal((await query('select count(*)::int n from review_spotting_tallies where venue_ref = $1 and queued = 0 and filtered > 0', [ref])).rows[0].n, 1, 'an all-opinion pass is counted');
  // A pass that raised nothing at all is still a place read, so it is a row too.
  await spotFromDetail({ venueRef: ref, detail: { reviews: [] } });
  assert.equal((await query('select count(*)::int n from review_spotting_tallies where venue_ref = $1 and raised = 0', [ref])).rows[0].n, 1, 'an empty pass is counted');
  const all = await spottingTally();
  assert.ok(all.spots >= 2 && all.filtered >= t.filtered, 'the tally sums the passes');
  // No text anywhere in the table.
  const cols = (await query("select column_name from information_schema.columns where table_name = 'review_spotting_tallies'")).rows.map((c) => c.column_name).sort();
  assert.deepEqual(cols, ['filtered', 'id', 'queued', 'raised', 'spotted_at', 'tombstoned', 'venue_ref'], 'counts and the place id only');
});

test('the queue counts are over the whole queue, not the page', async () => {
  // Codex, 2 Oct 2026: newCount/knownCount were read off the capped page.
  const sub = 'c30-count-all';
  const refs = ['google:ChIJ_c30_ca_1', 'google:ChIJ_c30_ca_2', 'google:ChIJ_c30_ca_3'];
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 count all', 'c30-test-cat') on conflict do nothing", [sub]);
  for (const r of refs) await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [r, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = any($1)', [refs]);
  const texts = ['A splash zone.', 'A sensory room.', 'A crazy golf.'];
  for (let i = 0; i < refs.length; i += 1) await spotFromDetail({ venueRef: refs[i], detail: { reviewSummary: texts[i] } });

  const page = await reviewQueue({ subcategory: sub, limit: 1 });
  const counts = await reviewQueueCounts({ subcategory: sub });
  assert.equal(page.length, 1, 'the page is capped');
  assert.equal(counts.newCount + counts.knownCount, 3, 'the counts cover all three waiting features');
});

test('an owned-only candidate ignored in a drawer still vetoes that drawer', async () => {
  // Codex, 2 Oct 2026: a per-drawer ignore is "never ask here again" whatever raised
  // the word. An owned-harvest candidate ignored in drawer A must keep approval from
  // asking A, and keep A's later Google sighting out of the count.
  const subA = 'c30-ov-a'; const subB = 'c30-ov-b';
  const a = 'google:ChIJ_c30_ov_a'; const b = 'google:ChIJ_c30_ov_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 ov A', 'c30-test-cat') on conflict do nothing", [subA]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 ov B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query("insert into question_sets (key, name) values ('c30-ov-set-a', 'A'), ('c30-ov-set-b', 'B') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-ov-set-a'), ($2, 'c30-ov-set-b') on conflict do nothing", [subA, subB]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [a, subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);
  await query("delete from attribute_aliases where norm = 'tack room'").catch(() => {});
  await query("delete from place_attributes where key = 'tack-room'").catch(() => {});

  // Raised in A by the owned harvest only, then ignored there.
  await sets.recordCandidates(subA, [{ norm: 'tack room', raw: 'tack room', rawForms: ['tack room'], sources: ['venue'], examples: [], kind: 'feature', placesSeen: 1, asserts: 1, denies: 0, asks: 0 }], { placesTotal: 1 });
  const { rows: [candA] } = await query("select id from harvest_candidates where norm = 'tack room' and subcategory = $1", [subA]);
  await sets.ignoreCandidate(candA.id, { actor: 'tester' });
  // Google then mentions it at places in both drawers.
  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A tack room.' } });
  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A tack room.' } });

  assert.equal((await reviewQueue()).find((f) => f.norm === 'tack room')?.places, 1, 'drawer A’s sighting is not counted');
  const res = await sets.approveFeature('tack room', { actor: 'tester' });
  assert.deepEqual(res.subcategories, [subB], 'drawer A, which ignored it, is not asked');
});

test('a fact named in the plural is known to the singular spotted word, and reused on approval', async () => {
  // Codex, 2 Oct 2026: matching facts without the vocabulary normaliser missed
  // "Party rooms" for the norm "party room" and approved a duplicate.
  const sub = 'c30-plural-parks';
  const ref = 'google:ChIJ_c30_plural';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 plural parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query("insert into question_sets (key, name) values ('c30-plural-set', 'C30 plural set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-plural-set') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from attribute_aliases where norm = 'party room'").catch(() => {});
  await query("delete from place_attributes where key = 'party-room'").catch(() => {});
  await query("insert into place_attributes (key, label, kind) values ('party-rooms', 'Party rooms', 'yesno') on conflict (key) do update set active = true");

  const report = await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A party room.' } });
  assert.equal(report.features.find((f) => f.norm === 'party room')?.known, true, 'known through the normaliser');
  const res = await sets.approveFeature('party room', { actor: 'tester' });
  assert.equal(res.attributeKey, 'party-rooms', 'reused the plural fact');
  assert.equal((await query("select count(*)::int n from place_attributes where key = 'party-room'")).rows[0].n, 0, 'no singular duplicate');
});

test('approving a word closes its owned candidates too, and asks their drawers', async () => {
  // Codex, 2 Oct 2026: approval is about the word. An owned-only candidate in
  // another drawer must not stay open to be promoted a second time — it is closed,
  // and its drawer is asked the question rather than left with nothing.
  const subB = 'c30-own-b'; const subC = 'c30-own-c';
  const b = 'google:ChIJ_c30_own_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 own B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 own C', 'c30-test-cat') on conflict do nothing", [subC]);
  await query("insert into question_sets (key, name) values ('c30-own-set-b', 'B'), ('c30-own-set-c', 'C') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-own-set-b'), ($2, 'c30-own-set-c') on conflict do nothing", [subB, subC]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subB, subC]]);
  await query('delete from review_sightings where venue_ref = $1', [b]);
  await query("delete from attribute_aliases where norm = 'craft room'").catch(() => {});
  await query("delete from place_attributes where key = 'craft-room'").catch(() => {});

  await sets.recordCandidates(subC, [{ norm: 'craft room', raw: 'craft room', rawForms: ['craft room'], sources: ['venue'], examples: [], kind: 'feature', placesSeen: 1, asserts: 1, denies: 0, asks: 0 }], { placesTotal: 1 });
  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A craft room.' } });

  const res = await sets.approveFeature('craft room', { actor: 'tester' });
  assert.deepEqual(res.subcategories, [subB, subC], 'both drawers that raised it are asked');
  assert.equal(res.asked, 2, 'one new question in each set');
  assert.equal((await query("select status from harvest_candidates where norm = 'craft room' and subcategory = $1", [subC])).rows[0].status, 'promoted', 'the owned candidate is closed, not left to be promoted again');
});

test('approval waits for a harvest already writing, so no candidate slips in after it', async () => {
  // Codex, 2 Oct 2026 (P1): approval closes all of the word's candidates; a harvest
  // holding the shared lock must finish before approval reads them.
  const sub = 'c30-apprace-parks';
  const ref = 'google:ChIJ_c30_apprace';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 apprace parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query("insert into question_sets (key, name) values ('c30-apprace-set', 'C30 apprace set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-apprace-set') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from attribute_aliases where norm = 'drying room'").catch(() => {});
  await query("delete from place_attributes where key = 'drying-room'").catch(() => {});
  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A drying room.' } });

  const harvest = await pool.connect();
  let done = false;
  try {
    await harvest.query('begin');
    await harvest.query('select pg_advisory_xact_lock_shared(hashtext($1)::bigint)', ['feature-tombstones']);
    const approving = sets.approveFeature('drying room', { actor: 'tester' }).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(done, false, 'approval waits while the harvest is writing');
    await harvest.query('commit');
    await approving;
    assert.equal(done, true, 'and completes once the harvest has committed');
  } finally {
    harvest.release();
  }
});

test('a drawer owed a fact that is asked everywhere by the time a set arrives is simply cleared', async () => {
  // Codex, 2 Oct 2026: only "already asked everywhere" (or retired) discharges a
  // pending ask without adding a set question; anything else must ask or fail.
  const sub = 'c30-pendglobal-parks';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 pendglobal parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('delete from question_set_subcategories where subcategory_key = $1', [sub]);
  await query("insert into question_sets (key, name) values ('c30-pendglobal-set', 'C30 pendglobal set') on conflict do nothing");
  await query("insert into place_attributes (key, label, kind) values ('pg-everywhere', 'Asked everywhere', 'yesno') on conflict (key) do update set active = true");
  await query("delete from questions where attribute_key = 'pg-everywhere'");
  // Switched off: the attach must switch it back on, or the fact is asked nowhere.
  await query("insert into questions (attribute_key, scope, active) values ('pg-everywhere', 'global', false)");
  await query("insert into feature_pending_asks (attribute_key, subcategory_key) values ('pg-everywhere', $1) on conflict do nothing", [sub]);
  // The drawer's approved candidate, promoted with no question yet.
  await query("insert into attribute_aliases (norm, target_key, raw) values ('pg everywhere', 'pg-everywhere', 'pg everywhere') on conflict (norm) do update set target_key = 'pg-everywhere'");
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await sets.recordCandidates(sub, [{ norm: 'pg everywhere', raw: 'pg everywhere', rawForms: ['pg everywhere'], sources: ['google'], examples: [], kind: 'feature', placesSeen: 1, asserts: 1, denies: 0, asks: 0 }], { placesTotal: 1 });
  await query("update harvest_candidates set status = 'promoted', decided_at = now(), question_id = null where norm = 'pg everywhere' and subcategory = $1", [sub]);

  await sets.attach('c30-pendglobal-set', sub);
  const { rows: [g] } = await query("select id from questions where attribute_key = 'pg-everywhere' and scope = 'global'");
  assert.equal((await query("select question_id from harvest_candidates where norm = 'pg everywhere' and subcategory = $1", [sub])).rows[0].question_id, g.id, 'the candidate points at the global question');
  assert.equal((await query("select count(*)::int n from questions where attribute_key = 'pg-everywhere' and scope = 'set'")).rows[0].n, 0, 'no set question beside the global one');
  assert.equal((await query("select active from questions where attribute_key = 'pg-everywhere' and scope = 'global'")).rows[0].active, true, 'the switched-off global is asked again');
  assert.equal((await query("select count(*)::int n from feature_pending_asks where attribute_key = 'pg-everywhere'")).rows[0].n, 0, 'the obligation is met and cleared');
});

test('a word this drawer ignored is not counted as queued when spotted again', async () => {
  // Codex, 2 Oct 2026: the tally and report counted attempted writes; a candidate
  // the drawer ignored is refused by the write and never reaches the queue.
  const sub = 'c30-qcount-parks';
  const ref = 'google:ChIJ_c30_qcount';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 qcount parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query('delete from review_spotting_tallies where venue_ref = $1', [ref]);
  await query("delete from feature_tombstones where norm = 'tea room'");

  const first = await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A tea room.' } });
  assert.equal(first.queued, 1, 'queued the first time');
  const { rows: [cand] } = await query("select id from harvest_candidates where norm = 'tea room' and subcategory = $1", [sub]);
  await sets.ignoreCandidate(cand.id, { actor: 'tester' });
  const again = await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A tea room.' } });
  assert.equal(again.queued, 0, 'not queued once the drawer has ignored it');
  assert.deepEqual((await query('select queued from review_spotting_tallies where venue_ref = $1 order by id', [ref])).rows.map((r) => r.queued), [1, 0], 'and the tally agrees');
});

test('a set shared with a drawer that ignored the word is not asked, and says so', async () => {
  // Codex, 2 Oct 2026: questions live on sets, and a set is shared across drawers,
  // so asking from drawer B would ask drawer A too. A's "never ask here again"
  // stands: the set is skipped and reported, at approval and when a set is attached.
  const subA = 'c30-shared-ign-a'; const subB = 'c30-shared-ign-b'; const subC = 'c30-shared-ign-c';
  const a = 'google:ChIJ_c30_si_a'; const b = 'google:ChIJ_c30_si_b'; const c = 'google:ChIJ_c30_si_c';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  for (const [k, l] of [[subA, 'C30 si A'], [subB, 'C30 si B'], [subC, 'C30 si C']]) {
    await query("insert into shelf_subcategories (key, label, category_key) values ($1, $2, 'c30-test-cat') on conflict do nothing", [k, l]);
  }
  await query('delete from question_set_subcategories where subcategory_key = $1', [subC]);
  await query("insert into question_sets (key, name) values ('c30-si-set', 'C30 si set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-si-set'), ($2, 'c30-si-set') on conflict do nothing", [subA, subB]);
  for (const [r, sub] of [[a, subA], [b, subB], [c, subC]]) {
    await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [r, sub]);
  }
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB, subC]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b, c]]);
  await query("delete from attribute_aliases where norm = 'map room'").catch(() => {});
  await query("delete from place_attributes where key = 'map-room'").catch(() => {});

  // Drawer A ignores it; B and C (C has no set yet) raise it.
  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A map room.' } });
  const { rows: [candA] } = await query("select id from harvest_candidates where norm = 'map room' and subcategory = $1", [subA]);
  await sets.ignoreCandidate(candA.id, { actor: 'tester' });
  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A map room.' } });
  await spotFromDetail({ venueRef: c, detail: { reviewSummary: 'A map room.' } });

  const res = await sets.approveFeature('map room', { actor: 'tester' });
  assert.deepEqual(res.blocked, [{ setKey: 'c30-si-set', ignoredIn: [subA] }], 'the shared set is held back, naming the drawer');
  assert.equal(res.asked, 0, 'nothing asked over the ignore');
  assert.equal((await query("select count(*)::int n from questions where attribute_key = $1 and set_key = 'c30-si-set'", [res.attributeKey])).rows[0].n, 0, 'no question on the shared set');
  assert.deepEqual(res.waiting, [subC], 'C is owed it');

  // B, held back by the shared set, is still owed it: moved to a set of its own, it is asked.
  assert.equal((await query('select count(*)::int n from feature_pending_asks where attribute_key = $1 and subcategory_key = $2', [res.attributeKey, subB])).rows[0].n, 1, 'B is still owed it');
  await query("insert into question_sets (key, name) values ('c30-si-own-b', 'C30 si own B') on conflict do nothing");
  await sets.attach('c30-si-own-b', subB);
  assert.equal((await query("select count(*)::int n from questions where attribute_key = $1 and set_key = 'c30-si-own-b' and active", [res.attributeKey])).rows[0].n, 1, 'and asked once B is on a set nobody vetoes');

  // Attaching C to the same shared set does not ask it over A's ignore; C stays owed.
  await sets.attach('c30-si-set', subC);
  assert.equal((await query("select count(*)::int n from questions where attribute_key = $1 and set_key = 'c30-si-set'", [res.attributeKey])).rows[0].n, 0, 'still not asked on the shared set');
  assert.equal((await query('select count(*)::int n from feature_pending_asks where attribute_key = $1 and subcategory_key = $2', [res.attributeKey, subC])).rows[0].n, 1, 'and C is still owed it');

  // Restoring A's ignore lifts the veto, and C is asked without anyone re-attaching it.
  await sets.unignore(candA.id);
  assert.equal((await query("select count(*)::int n from questions where attribute_key = $1 and set_key = 'c30-si-set' and active", [res.attributeKey])).rows[0].n, 1, 'asked on the shared set once the veto is gone');
  assert.equal((await query('select count(*)::int n from feature_pending_asks where attribute_key = $1 and subcategory_key = $2', [res.attributeKey, subC])).rows[0].n, 0, 'and C is no longer owed it');
  // A's restored candidate is decided by that asking, not left actionable.
  const { rows: [qs] } = await query("select id from questions where attribute_key = $1 and set_key = 'c30-si-set'", [res.attributeKey]);
  const { rows: [ra] } = await query('select status, question_id from harvest_candidates where id = $1', [candA.id]);
  assert.deepEqual(ra, { status: 'promoted', question_id: qs.id }, 'the restored candidate is promoted and points at the question');
});

test('a detail cached without a place is spotted, free, when read again for that place', async () => {
  // Codex, 2 Oct 2026: the demand screen caches Google's detail without naming the
  // place; compare-all must still read it through detailFor with the ref so its
  // reviews are spotted — and that read must not go back to Google.
  const { detailFor } = await import('../src/sources/compare.js');
  const { googleSource } = await import('../src/sources/google.js');
  const sub = 'c30-cache-parks';
  const id = 'ChIJ_c30_cachehit';
  const ref = `google:${id}`;
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 cache parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);

  const real = googleSource.get;
  let calls = 0;
  googleSource.get = async () => { calls += 1; return { reviewSummary: 'A wet room.', reviews: [], photos: [] }; };
  try {
    await detailFor('google', id, null);                 // cached by a path that names no place
    assert.equal(calls, 1, 'one call fills the cache');
    await detailFor('google', id, null, { venueRef: ref }); // compare-all's read
    assert.equal(calls, 1, 'the second read comes from the cache — no call');
    let seen = 0;
    for (let i = 0; i < 40 && !seen; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      seen = (await query("select count(*)::int n from review_sightings where venue_ref = $1 and norm = 'wet room'", [ref])).rows[0].n;
    }
    assert.equal(seen, 1, 'and its reviews are spotted for the place');
  } finally {
    googleSource.get = real;
  }
});

test('ignoring a feature that is already a fact dismisses it, and retires nothing', async () => {
  // Codex, 2 Oct 2026: a tombstone on an active fact's word would leave the fact
  // asked while suppressing every later sighting of it.
  const sub = 'c30-dismiss-parks';
  const ref = 'google:ChIJ_c30_dismiss';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 dismiss parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("delete from feature_tombstones where norm = 'card room'");
  await query("insert into place_attributes (key, label, kind) values ('card-room', 'Card room', 'yesno') on conflict (key) do update set active = true");

  // An owned-harvest candidate for the same fact, in a drawer the reviews never touched.
  const other = 'c30-dismiss-other';
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 dismiss other', 'c30-test-cat') on conflict do nothing", [other]);
  await query('delete from harvest_candidates where subcategory = $1', [other]);
  await sets.recordCandidates(other, [{ norm: 'card room', raw: 'card room', rawForms: ['card room'], sources: ['venue'], examples: [], kind: 'feature', placesSeen: 1, asserts: 1, denies: 0, asks: 0 }], { placesTotal: 1 });

  // And one whose sources merged with Google's somewhere, in a drawer with no sighting now.
  const merged = 'c30-dismiss-merged';
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 dismiss merged', 'c30-test-cat') on conflict do nothing", [merged]);
  await query('delete from harvest_candidates where subcategory = $1', [merged]);
  await sets.recordCandidates(merged, [{ norm: 'card room', raw: 'card room', rawForms: ['card room'], sources: ['venue', 'google'], examples: [], kind: 'feature', placesSeen: 1, asserts: 1, denies: 0, asks: 0 }], { placesTotal: 1 });

  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A card room.' } });
  const res = await sets.ignoreFeature('card room', { actor: 'tester' });
  assert.notEqual((await query("select status from harvest_candidates where norm = 'card room' and subcategory = $1", [merged])).rows[0].status, 'ignored', 'a Google-sourced candidate in an unsighted drawer is left alone');
  assert.notEqual((await query("select status from harvest_candidates where norm = 'card room' and subcategory = $1", [other])).rows[0].status, 'ignored', 'the owned candidate elsewhere is left alone');
  assert.equal(res.dismissed, true, 'dismissed, not ignored for good');
  assert.equal((await query("select count(*)::int n from feature_tombstones where norm = 'card room'")).rows[0].n, 0, 'no tombstone on an active fact');
  assert.equal((await query("select active from place_attributes where key = 'card-room'")).rows[0].active, true, 'the fact is still ours');
  assert.ok(!(await reviewQueue({ subcategory: sub })).some((f) => f.norm === 'card room'), 'and the suggestion is gone from the queue');
});

test('an ordinary promotion waits for the word’s locks, like the review decisions', async () => {
  // Codex, 2 Oct 2026: promote() took its row lock and no advisory lock, so it could
  // race approval on the same word. It now takes the word's locks first.
  const sub = 'c30-promlock-parks';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 promlock parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query("insert into question_sets (key, name) values ('c30-promlock-set', 'C30 promlock set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-promlock-set') on conflict do nothing", [sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query("delete from feature_tombstones where norm = 'wet room'");
  await query("delete from attribute_aliases where norm = 'wet room'").catch(() => {});
  await sets.recordCandidates(sub, [{ norm: 'wet room', raw: 'wet room', kind: 'feature', sources: ['features'], placesSeen: 1, examples: [], asserts: 1, evidence: 'there is a wet room by the pool', evidenceRef: 'osm:x' }], { placesTotal: 1 });
  const { rows: [cand] } = await query("select id, status from harvest_candidates where norm = 'wet room' and subcategory = $1", [sub]);
  assert.equal(cand.status, 'new', 'a quoted, promotable candidate');

  const other = await pool.connect();
  let done = false;
  try {
    await other.query('begin');
    await other.query('select pg_advisory_xact_lock(hashtext($1)::bigint)', ['feature:wet room']); // a review decision on the word
    const promoting = sets.promote(cand.id, { actor: 'tester' }).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(done, false, 'the promotion waits for the word');
    await other.query('commit');
    await promoting;
    assert.equal(done, true, 'and goes ahead once it is free');
  } finally {
    other.release();
  }
});

test('approved candidates point at the question that now asks them, including once a set arrives', async () => {
  // Codex, 2 Oct 2026: promoted with no question_id, the decision trail read "never
  // checked anywhere" for a word that was being asked.
  const subA = 'c30-qid-a'; const subB = 'c30-qid-b';
  const a = 'google:ChIJ_c30_qid_a'; const b = 'google:ChIJ_c30_qid_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 qid A', 'c30-test-cat') on conflict do nothing", [subA]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 qid B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query('delete from question_set_subcategories where subcategory_key = $1', [subB]);
  await query("insert into question_sets (key, name) values ('c30-qid-set-a', 'A'), ('c30-qid-set-b', 'B') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-qid-set-a') on conflict do nothing", [subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [a, subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);
  await query("delete from attribute_aliases where norm = 'gun room'").catch(() => {});

  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A gun room.' } });
  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A gun room.' } });
  const res = await sets.approveFeature('gun room', { actor: 'tester' });
  const qidOf = async (sub) => (await query("select question_id from harvest_candidates where norm = 'gun room' and subcategory = $1", [sub])).rows[0].question_id;
  const { rows: [qa] } = await query("select id from questions where attribute_key = $1 and set_key = 'c30-qid-set-a'", [res.attributeKey]);
  assert.equal(await qidOf(subA), qa.id, 'the candidate in A points at A’s question');
  assert.equal(await qidOf(subB), null, 'B has no set yet, so nothing to point at');
  await sets.attach('c30-qid-set-b', subB);
  const { rows: [qb] } = await query("select id from questions where attribute_key = $1 and set_key = 'c30-qid-set-b'", [res.attributeKey]);
  assert.equal(await qidOf(subB), qb.id, 'and points at B’s question once the set is attached');
});

test('a drawer that ignored another wording of the fact still holds back its shared set', async () => {
  // Codex, 2 Oct 2026: the shared-set check looked at the approved spelling only;
  // an ignore of another alias of the same fact is the same refusal.
  const subA = 'c30-alias-ign-a'; const subB = 'c30-alias-ign-b';
  const a = 'google:ChIJ_c30_ai_a'; const b = 'google:ChIJ_c30_ai_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 ai A', 'c30-test-cat') on conflict do nothing", [subA]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 ai B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query("insert into question_sets (key, name) values ('c30-ai-set', 'C30 ai set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-ai-set'), ($2, 'c30-ai-set') on conflict do nothing", [subA, subB]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [a, subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);
  // One fact, two wordings: "mud room" and "boot area".
  await query("insert into place_attributes (key, label, kind) values ('mud-room', 'Mud room', 'yesno') on conflict (key) do update set active = true");
  await query("delete from questions where attribute_key = 'mud-room'");
  await query("insert into attribute_aliases (norm, target_key, raw) values ('boot area', 'mud-room', 'boot area') on conflict (norm) do update set target_key = 'mud-room'");

  // Drawer A ignored the other wording.
  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A boot area.' } });
  const { rows: [candA] } = await query("select id from harvest_candidates where norm = 'boot area' and subcategory = $1", [subA]);
  await sets.ignoreCandidate(candA.id, { actor: 'tester' });

  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A mud room.' } });
  const res = await sets.approveFeature('mud room', { actor: 'tester' });
  assert.equal(res.attributeKey, 'mud-room');
  assert.deepEqual(res.blocked, [{ setKey: 'c30-ai-set', ignoredIn: [subA] }], 'the shared set is held back for the other wording');
  assert.equal((await query("select count(*)::int n from questions where attribute_key = 'mud-room' and set_key = 'c30-ai-set'")).rows[0].n, 0, 'no question over the ignore');
});

test('moving the ignoring drawer to another set re-asks the set it left', async () => {
  // Codex, 2 Oct 2026: a direct move lifts the old set's veto just as detach does.
  const subA = 'c30-move-a'; const subB = 'c30-move-b';
  const a = 'google:ChIJ_c30_move_a'; const b = 'google:ChIJ_c30_move_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 move A', 'c30-test-cat') on conflict do nothing", [subA]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 move B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query("insert into question_sets (key, name) values ('c30-move-set', 'C30 move set'), ('c30-move-away', 'C30 move away') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-move-set'), ($2, 'c30-move-set') on conflict (subcategory_key) do update set set_key = excluded.set_key", [subA, subB]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [a, subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);
  await query("delete from attribute_aliases where norm = 'gift kiosk'").catch(() => {});
  await query("delete from place_attributes where key = 'gift-kiosk'").catch(() => {});

  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A gift kiosk.' } });
  const { rows: [candA] } = await query("select id from harvest_candidates where norm = 'gift kiosk' and subcategory = $1", [subA]);
  await sets.ignoreCandidate(candA.id, { actor: 'tester' });
  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A gift kiosk.' } });
  const res = await sets.approveFeature('gift kiosk', { actor: 'tester' });
  assert.equal(res.blocked.length, 1, 'held back by A on the shared set');

  await sets.attach('c30-move-away', subA); // A moves off the shared set
  assert.equal((await query("select count(*)::int n from questions where attribute_key = $1 and set_key = 'c30-move-set' and active", [res.attributeKey])).rows[0].n, 1, 'B’s set is asked once A has left it');
});

test('dismissing a known fact reaches a candidate left in the drawer its place has moved out of', async () => {
  // Codex, 2 Oct 2026: the candidate stays filed under the spotting-time drawer.
  const subOld = 'c30-dm-old'; const subNew = 'c30-dm-new';
  const ref = 'google:ChIJ_c30_dm';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 dm old', 'c30-test-cat') on conflict do nothing", [subOld]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 dm new', 'c30-test-cat') on conflict do nothing", [subNew]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, subOld]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subOld, subNew]]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  await query("insert into place_attributes (key, label, kind) values ('sport-hall', 'Sport hall', 'yesno') on conflict (key) do update set active = true");

  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A sports hall.' } });       // filed under old
  await query('update place_index set subcategory = $2 where venue_ref = $1', [ref, subNew]);   // moved, no re-spot
  const res = await sets.ignoreFeature('sport hall', { actor: 'tester' });
  assert.equal(res.dismissed, true);
  assert.equal((await query("select status from harvest_candidates where norm = 'sport hall' and subcategory = $1", [subOld])).rows[0].status, 'ignored', 'the old-drawer candidate is closed, not orphaned');
});

test('a per-drawer ignore waits for the word, so it cannot slip in under an approval', async () => {
  // Codex, 2 Oct 2026: ignoreCandidate now takes the word's locks like every other
  // decision on a word.
  const sub = 'c30-iclock-parks';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 iclock parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await sets.recordCandidates(sub, [{ norm: 'tack shed', raw: 'tack shed', rawForms: ['tack shed'], sources: ['venue'], examples: [], kind: 'feature', placesSeen: 1, asserts: 1, denies: 0, asks: 0 }], { placesTotal: 1 });
  const { rows: [cand] } = await query("select id from harvest_candidates where norm = 'tack shed' and subcategory = $1", [sub]);

  const other = await pool.connect();
  let done = false;
  try {
    await other.query('begin');
    await other.query('select pg_advisory_xact_lock(hashtext($1)::bigint)', ['feature:tack shed']); // an approval on the word
    const ignoring = sets.ignoreCandidate(cand.id, { actor: 'tester' }).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(done, false, 'the per-drawer ignore waits for the word');
    await other.query('commit');
    await ignoring;
    assert.equal(done, true, 'and goes ahead once it is free');
  } finally {
    other.release();
  }
});

test('a word already filed under a drawer keeps its filing through review-queue decisions', async () => {
  // Codex, 2 Oct 2026 (P1): a filing is 'unresolved' but decided; approve and ignore
  // must not overwrite it.
  const subA = 'c30-filed-a'; const subB = 'c30-filed-b';
  const a = 'google:ChIJ_c30_filed_a'; const b = 'google:ChIJ_c30_filed_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 filed A', 'c30-test-cat') on conflict do nothing", [subA]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 filed B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query("insert into question_sets (key, name) values ('c30-filed-set', 'C30 filed set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-filed-set') on conflict do nothing", [subB]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [a, subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);
  await query("delete from attribute_aliases where norm = 'tack shed'").catch(() => {});
  await query("delete from place_attributes where key = 'tack-shed'").catch(() => {});

  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A tack shed.' } });
  const { rows: [candA] } = await query("select id from harvest_candidates where norm = 'tack shed' and subcategory = $1", [subA]);
  await sets.fileUnder(candA.id, { under: subB, by: 'tester' });
  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A tack shed.' } });

  await sets.approveFeature('tack shed', { actor: 'tester' });
  const { rows: [after] } = await query("select status, kind, files_under from harvest_candidates where id = $1", [candA.id]);
  assert.deepEqual(after, { status: 'unresolved', kind: 'filing', files_under: subB }, 'the filing stands');
});

test('approval refuses a label with nothing in it to make a key from', async () => {
  // Codex, 2 Oct 2026: slug("  !! ") is empty; never a blank fact.
  const sub = 'c30-blank-parks';
  const ref = 'google:ChIJ_c30_blank';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 blank parks', 'c30-test-cat') on conflict do nothing", [sub]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [ref, sub]);
  await query('delete from harvest_candidates where subcategory = $1', [sub]);
  await query('delete from review_sightings where venue_ref = $1', [ref]);
  // A word with no fact or alias yet, so the label is what names it.
  await query("delete from feature_pending_asks where attribute_key = 'gift-kiosk'").catch(() => {});
  await query("delete from attribute_aliases where norm = 'gift kiosk'").catch(() => {});
  await query("delete from questions where attribute_key = 'gift-kiosk'").catch(() => {});
  await query("delete from place_attributes where key = 'gift-kiosk'").catch(() => {});
  await query("delete from harvest_candidates where norm = 'gift kiosk'");
  await spotFromDetail({ venueRef: ref, detail: { reviewSummary: 'A gift kiosk.' } });
  await assert.rejects(() => sets.approveFeature('gift kiosk', { actor: 'tester', label: '  !! ' }), (err) => err.status === 400);
  assert.equal((await query("select count(*)::int n from place_attributes where key = ''")).rows[0].n, 0, 'no blank fact');
});

test('restoring an older per-drawer ignore leaves a later word-level Ignore standing', async () => {
  // Codex, 2 Oct 2026: restore lifts only the tombstone its own ignore wrote.
  const subA = 'c30-tomb-scope-a'; const subB = 'c30-tomb-scope-b';
  const a = 'google:ChIJ_c30_ts_a'; const b = 'google:ChIJ_c30_ts_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 ts A', 'c30-test-cat') on conflict do nothing", [subA]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 ts B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [a, subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);
  await query("delete from feature_tombstones where norm = 'trophy room'");

  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A trophy room.' } });
  const { rows: [candA] } = await query("select id from harvest_candidates where norm = 'trophy room' and subcategory = $1", [subA]);
  await sets.ignoreCandidate(candA.id, { actor: 'tester' });               // an older, per-drawer ignore
  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A trophy room.' } });
  await sets.ignoreFeature('trophy room', { actor: 'tester' });            // the later word-level Ignore
  const { rows: [candB] } = await query("select id from harvest_candidates where norm = 'trophy room' and subcategory = $1", [subB]);

  await sets.unignore(candA.id);
  assert.equal((await query("select count(*)::int n from feature_tombstones where norm = 'trophy room'")).rows[0].n, 1, 'the word-level Ignore stands');
  await sets.unignore(candB.id);
  assert.equal((await query("select count(*)::int n from feature_tombstones where norm = 'trophy room'")).rows[0].n, 0, 'restoring a candidate that Ignore closed lifts it');
});

test('a shared set that already asks the fact is reported as asked, not held back', async () => {
  // Codex, 2 Oct 2026: approval does not switch off a question somebody set up, so a
  // set that already actively asks the fact is not "held back" — the report says so.
  const subA = 'c30-pre-a'; const subB = 'c30-pre-b';
  const a = 'google:ChIJ_c30_pre_a'; const b = 'google:ChIJ_c30_pre_b';
  await query("insert into shelf_categories (key, label) values ('c30-test-cat', 'C30 test') on conflict do nothing").catch(() => {});
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 pre A', 'c30-test-cat') on conflict do nothing", [subA]);
  await query("insert into shelf_subcategories (key, label, category_key) values ($1, 'C30 pre B', 'c30-test-cat') on conflict do nothing", [subB]);
  await query("insert into question_sets (key, name) values ('c30-pre-set', 'C30 pre set') on conflict do nothing");
  await query("insert into question_set_subcategories (subcategory_key, set_key) values ($1, 'c30-pre-set'), ($2, 'c30-pre-set') on conflict do nothing", [subA, subB]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [a, subA]);
  await query('insert into place_index (venue_ref, subcategory) values ($1, $2) on conflict (venue_ref) do update set subcategory = $2', [b, subB]);
  await query('delete from harvest_candidates where subcategory = any($1)', [[subA, subB]]);
  await query('delete from review_sightings where venue_ref = any($1)', [[a, b]]);
  await query("insert into place_attributes (key, label, kind) values ('tack-shed', 'Tack shed', 'yesno') on conflict (key) do update set active = true");
  await query("delete from questions where attribute_key = 'tack-shed'");
  await query("insert into questions (attribute_key, scope, set_key, active) values ('tack-shed', 'set', 'c30-pre-set', true)");

  await spotFromDetail({ venueRef: a, detail: { reviewSummary: 'A tack shed.' } });
  const { rows: [candA] } = await query("select id from harvest_candidates where norm = 'tack shed' and subcategory = $1", [subA]);
  await sets.ignoreCandidate(candA.id, { actor: 'tester' });
  await spotFromDetail({ venueRef: b, detail: { reviewSummary: 'A tack shed.' } });
  const res = await sets.approveFeature('tack shed', { actor: 'tester' });
  assert.deepEqual(res.blocked, [], 'not reported as held back');
  assert.equal(res.asked, 0, 'nothing newly asked — the set already asks it');
  assert.equal((await query("select active from questions where attribute_key = 'tack-shed' and set_key = 'c30-pre-set'")).rows[0].active, true, 'the existing question is left on');
});

test.after(async () => { await pool.end(); });
