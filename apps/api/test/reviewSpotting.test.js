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
const { looksLikeFeature, spotFeatures, spotFromDetail, reviewQueue } = await import('../src/sources/reviewSpotting.js');
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

test.after(async () => { await pool.end(); });
