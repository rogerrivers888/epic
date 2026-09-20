/**
 * Question sets, and the rule the whole harvest rests on.
 *
 * Brief: "Epic — Question sets and the vocabulary harvest", 20 September 2026.
 * Four things are held here because each of them is silent when it breaks:
 *
 *   · **Google may raise a word and may never answer a question.** A
 *     `place_answers` row from a rented source is the one failure that would
 *     look like success — a fuller place page, built on somebody else's
 *     content. It is refused in the repository and again by the database.
 *   · **"Asked, nothing found" is a real answer.** It is stored, and it is not
 *     the same as never having asked, which is the absence of a row.
 *   · **Ignored is permanent.** A word rejected here never raises a second
 *     candidate, or the queue fills with the same rejections every run.
 *   · **A word is normalised before anybody sees it.** *wave machine*,
 *     *wavemachine* and *Wave Machines* are one candidate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';
import {
  candidatesFor, disagree, earnsEnrichment, enrichmentOn, mayAnswer, phrasesIn, phrasesInTags,
  pickSample, regionOfArea, saturation, settle, spreadByRegion,
} from '../src/domain/questions.js';
import { skuFor } from '../src/sources/google.js';

const { query, pool } = await testDatabase();
const sets = await import('../src/repositories/questionSets.js');

test.after(() => pool.end());

// ---------------------------------------------------------------------------
// the words
// ---------------------------------------------------------------------------

test('four spellings of one thing are one candidate', () => {
  const keys = ['wave machine', 'Wave Machine', 'wave machines', 'WAVE  MACHINES!']
    .map((s) => [...phrasesIn(s).keys()].find((k) => k.includes('wave')));
  assert.equal(new Set(keys).size, 1, `collapsed to ${JSON.stringify(keys)}`);
});

test('a stopword is a cut, not a filter', () => {
  const found = [...phrasesIn('a toddler pool and a splash area').keys()];
  assert.ok(found.includes('toddler pool'), 'the two-word phrase survives');
  assert.ok(found.includes('splash area'));
  assert.ok(!found.some((k) => k.includes('and')), `a phrase spanned the stopword: ${found}`);
});

test('the common words are kept, because deciding they are noise is a human job', () => {
  // The brief is explicit: the harvester does not filter by frequency, because
  // "lockers 19 of 20" beside "wave machine 2 of 20" is what makes materiality
  // obvious. If `lockers` never reached the queue there would be nothing to
  // compare the find against.
  const found = [...phrasesIn('the lockers and the changing rooms were busy').keys()];
  assert.ok(found.includes('locker'), found);
  assert.ok(found.includes('changing room'), found);
});

test('the open map is read as words, and its names and numbers are not', () => {
  const found = [...phrasesInTags({
    leisure: 'water_park', changing_table: 'yes', wheelchair: 'no',
    name: 'Coral Reef Waterworld', 'addr:postcode': 'RG12 9SE', phone: '+44',
  }).keys()];
  assert.ok(found.includes('water park'), found);
  assert.ok(found.includes('changing table'), 'key=yes means the key is the fact');
  assert.ok(!found.includes('wheelchair'), 'wheelchair=no is not a claim that it has one');
  assert.ok(!found.some((k) => k.includes('coral')), 'a name is not vocabulary');
});

test('a word carries every source that raised it', () => {
  const raised = candidatesFor({
    tags: { leisure: 'water_park' },
    texts: [{ source: 'google', text: 'A water park with flumes.' }],
  });
  assert.deepEqual([...raised.get('water park').sources].sort(), ['google', 'osm']);
});

// ---------------------------------------------------------------------------
// the sample
// ---------------------------------------------------------------------------

test('twelve top and eight mid-tail, and the mid-tail is reproducible', () => {
  const ranked = Array.from({ length: 100 }, (_, i) => ({ venue_ref: `r${i}`, score: 100 - i }));
  const picked = pickSample(ranked);
  assert.equal(picked.length, 20);
  assert.deepEqual(picked.slice(0, 12).map((p) => p.venue_ref), ranked.slice(0, 12).map((p) => p.venue_ref));
  // The band is the 40th to the 80th percentile of the ordering, so none of
  // the tail is from the very top or the very bottom.
  const tail = picked.slice(12).map((p) => Number(p.venue_ref.slice(1)));
  assert.ok(Math.min(...tail) >= 40, `mid-tail reached the head: ${tail}`);
  assert.ok(Math.max(...tail) < 80, `mid-tail reached the bottom: ${tail}`);
  // Reproducible: the same ordering picks the same places.
  assert.deepEqual(pickSample(ranked).map((p) => p.venue_ref), picked.map((p) => p.venue_ref));
});

test('a small subcategory gives everything it has rather than nothing', () => {
  const ranked = Array.from({ length: 6 }, (_, i) => ({ venue_ref: `r${i}` }));
  assert.equal(pickSample(ranked).length, 6);
});

test('one county does not own the sample', () => {
  const rows = [
    ...Array.from({ length: 18 }, (_, i) => ({ venue_ref: `se${i}`, region: 'south-east' })),
    { venue_ref: 'n1', region: 'north' },
    { venue_ref: 'sw1', region: 'south-west' },
  ];
  const spread = spreadByRegion(rows, 6);
  assert.equal(new Set(spread.map((r) => r.region)).size, 3, 'every region Epic holds anything in is reached');
});

test('the regions are the ones the brief asks for, including coastal and northern', () => {
  assert.equal(regionOfArea('cornwall'), 'south-west');
  assert.equal(regionOfArea('cumbria'), 'north');
  assert.equal(regionOfArea('berkshire'), 'south-east');
  assert.equal(regionOfArea('nowhere'), null);
});

// ---------------------------------------------------------------------------
// saturation
// ---------------------------------------------------------------------------

test('saturation is measured per ten places, and a part-block proves nothing', () => {
  // Ten places teaching a word each, then ten teaching almost nothing.
  const learning = Array.from({ length: 10 }, (_, i) => [`w${i}`]);
  const repeating = Array.from({ length: 10 }, () => ['w1']);
  const done = saturation([...learning, ...repeating]);
  assert.deepEqual(done.curve.map((c) => c.newWords), [10, 0]);
  assert.equal(done.saturated, true, 'the last ten taught nothing new');

  const thin = saturation([...learning, ...repeating.slice(0, 3)]);
  assert.equal(thin.saturated, false, 'three places at the end is not evidence of anything');
  assert.equal(thin.curve.at(-1).partial, 3);
});

// ---------------------------------------------------------------------------
// the provenance rule
// ---------------------------------------------------------------------------

test('Google may raise a word and may never answer a question', async () => {
  assert.equal(mayAnswer('site'), true);
  assert.equal(mayAnswer('osm'), true);
  assert.equal(mayAnswer('google'), false);
  assert.equal(mayAnswer('tripadvisor'), false);

  await query("insert into shelf_categories (key, label) values ('test-cat', 'Test') on conflict do nothing");
  await query("insert into shelf_subcategories (key, label, category_key) values ('water-parks', 'Water parks', 'test-cat') on conflict do nothing");
  await sets.saveSet({ key: 'water', name: 'Water parks and lidos' });
  await sets.attach('water', 'water-parks');
  await query("insert into place_attributes (key, label, kind) values ('wave-machine', 'Wave machine', 'yesno') on conflict do nothing");
  const question = await sets.addQuestion({ attributeKey: 'wave-machine', setKey: 'water' });

  await assert.rejects(
    () => sets.saveAnswer({ venueRef: 'google:x', questionId: question.id, source: 'google', value: { yesno: true } }),
    /may not answer a question/,
    'the repository refuses before the database has to',
  );
  // And the database refuses too, for anything that gets past the repository.
  await assert.rejects(
    () => query(
      `insert into place_answers (venue_ref, question_id, source, state, yesno) values ($1, $2, 'google', 'answered', true)`,
      ['google:x', question.id],
    ),
    /place_answers_source_check|violates check constraint/,
  );
});

test('asked and nothing found is a row; never asked is no row at all', async () => {
  const { rows: [q] } = await query("select id from questions where attribute_key = 'wave-machine'");
  await sets.saveAnswer({ venueRef: 'google:quiet', questionId: q.id, source: 'osm', state: 'asked_nothing_found' });
  const answers = await sets.answersFor('google:quiet');
  assert.equal(answers.length, 1);
  assert.equal(settle(answers).state, 'asked_nothing_found');
  assert.equal(settle([]), null, 'a question never asked has nothing to settle');
});

test('two owned sources that disagree are both kept, and neither wins', async () => {
  const { rows: [q] } = await query("select id from questions where attribute_key = 'step-free' and scope = 'global'");
  await sets.saveAnswer({ venueRef: 'google:split', questionId: q.id, source: 'site', value: { yesno: true }, sourceUrl: 'https://example.org' });
  await sets.saveAnswer({ venueRef: 'google:split', questionId: q.id, source: 'osm', value: { yesno: false } });
  const rows = await sets.answersFor('google:split');
  assert.equal(rows.length, 2, 'both are stored');
  assert.ok(rows.every((r) => r.unresolved), 'the pair is marked, not resolved');
  const answer = settle(rows);
  assert.equal(answer.unresolved, true);
  assert.ok(answer.other, 'the other source comes back with it, for a human to pick');
  assert.equal(disagree({ yesno: true }, { yesno: false }), true);
  assert.equal(disagree({ yesno: true }, { yesno: true }), false);

  // Agreement clears it again rather than leaving a stale flag.
  await sets.saveAnswer({ venueRef: 'google:split', questionId: q.id, source: 'osm', value: { yesno: true } });
  const agreed = await sets.answersFor('google:split');
  assert.ok(agreed.every((r) => !r.unresolved));
});

// ---------------------------------------------------------------------------
// the queue
// ---------------------------------------------------------------------------

test('an ignored word never raises a second candidate', async () => {
  await sets.recordCandidates('water-parks', [
    { norm: 'wave machine', raw: 'wave machine', rawForms: ['wave machine'], sources: ['google'], placesSeen: 2, examples: ['google:a'] },
    { norm: 'locker', raw: 'lockers', rawForms: ['lockers'], sources: ['google'], placesSeen: 19, examples: ['google:a'] },
  ], { placesTotal: 20 });

  const before = await sets.candidates({ subcategory: 'water-parks' });
  assert.equal(before.length, 2);
  // The share is what the screen sorts on: a 10% find above a 95% word.
  assert.equal(before[0].norm, 'wave machine', 'the rarest word comes back first');

  const lockers = before.find((c) => c.norm === 'locker');
  await sets.ignoreCandidate(lockers.id, { actor: 'test' });
  const written = await sets.recordCandidates('water-parks', [
    { norm: 'locker', raw: 'lockers', sources: ['osm'], placesSeen: 19 },
  ], { placesTotal: 20 });
  assert.equal(written.skipped, 1, 'the harvest skipped it rather than writing it again');
  assert.equal((await sets.candidates({ subcategory: 'water-parks' })).length, 1);
});

test('promoting a word makes a question, reuses a label we have, and drops the scaffolding', async () => {
  const [candidate] = await sets.candidates({ subcategory: 'water-parks' });
  assert.ok(candidate.examples.length, 'examples are there while it is being reviewed');
  const promoted = await sets.promote(candidate.id, { gate: false, actor: 'test' });
  assert.equal(promoted.attributeKey, 'wave-machine', 'the label we already had was reused, not duplicated twice');
  const { rows } = await query('select * from harvest_candidates where id = $1', [candidate.id]);
  assert.equal(rows[0].status, 'promoted');
  assert.deepEqual(rows[0].examples, [], 'the word-to-place link goes with the decision');
  assert.ok(rows[0].question_id, 'and the question it became is on the row');
});

test('a global question is not a set\'s to switch off', async () => {
  const { rows: [global] } = await query("select id from questions where scope = 'global' limit 1");
  await assert.rejects(() => sets.removeQuestion(global.id), /asked everywhere/);
});

test('a question cannot invent a word', async () => {
  await assert.rejects(
    () => sets.addQuestion({ attributeKey: 'not-one-of-ours', setKey: 'water' }),
    /not one of our labels/,
  );
});

test('the resolver finds our label under the words somebody wrote', async () => {
  await sets.ensureAttributeAliases();
  assert.equal((await sets.resolveAttribute('Step free'))?.key, 'step-free');
  assert.equal((await sets.resolveAttribute('step free'))?.key, 'step-free');
  assert.equal((await sets.resolveAttribute('wave machines'))?.key, 'wave-machine');
});

// ---------------------------------------------------------------------------
// what it costs
// ---------------------------------------------------------------------------

test('a review summary is priced as the dearest thing Google sells', () => {
  // The harvest's mask. If this ever reads as Essentials or Pro the estimate
  // shown before the run would be wrong by a factor, which is the failure the
  // census tests exist to prevent and the same one applies here.
  assert.equal(skuFor('places.id,places.reviewSummary', '/places:searchText'), 'google-search');
});

test('the enrichment hook is built and off', () => {
  assert.equal(enrichmentOn({}), false, 'unset is off');
  assert.equal(enrichmentOn({ EPIC_ENRICHMENT: 'on' }), true);
  assert.equal(earnsEnrichment({ shown: 40 }), true);
  assert.equal(earnsEnrichment({ shown: 1, opened: 0 }), false);
});
