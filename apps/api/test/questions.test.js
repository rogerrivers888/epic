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
  candidatesFor, disagree, discriminates, earnsEnrichment, enrichmentOn, gateWord, mayAnswer,
  phrasesIn, phrasesInTags, pickSample, plainKindOf, polarityOf, regionOfArea, saturation, settle,
  spreadByRegion,
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
// polarity, which cannot be recovered later
// ---------------------------------------------------------------------------

test('a question about a feature is not evidence that the place has it', () => {
  // The brief's own example. "It cannot be recovered later, so capture it at
  // extraction or not at all" — by the time anything else runs, the text is
  // gone.
  assert.equal(polarityOf('The wave machine is great', 'wave machine'), 'asserts');
  assert.equal(polarityOf('No wave machine any more, sadly', 'wave machine'), 'denies');
  assert.equal(polarityOf("Does it have a wave machine? We couldn't find one", 'wave machine'), 'asks');
});

test('one sentence can assert one thing and deny another', () => {
  // Reading the whole sentence would have marked the flume as denied too,
  // which is how a place ends up answered backwards.
  assert.equal(polarityOf('There is a flume and no toddler pool', 'flume'), 'asserts');
  assert.equal(polarityOf('There is a flume and no toddler pool', 'toddler pool'), 'denies');
});

test('polarity is counted per place, not per mention', () => {
  const raised = candidatesFor({
    texts: [
      { source: 'google', text: 'A water park with flumes. No toddler pool.' },
      { source: 'site', text: 'Does it have a toddler pool?' },
    ],
  });
  const pool = raised.get('toddler pool');
  assert.equal(pool.asserts, 0, 'nobody said it has one');
  assert.equal(pool.denies, 1);
  assert.equal(pool.asks, 1);
});

test('an opinion and a condition are not questions about a place', () => {
  assert.equal(plainKindOf('rude staff'), 'opinion');
  assert.equal(plainKindOf('busy at weekend'), 'condition');
  assert.equal(plainKindOf('wave machine'), null, 'a word code cannot call goes to the classifier');
});

test('a word that everywhere has tells nothing apart — unless it is a gate', () => {
  assert.equal(discriminates(0.2), true, '4 of 20 is a find');
  assert.equal(discriminates(0.98), false, '20 of 20 is the category, not a question');
  assert.equal(discriminates(0.98, { gate: true }), true, 'a gate is decisive at any frequency');
  assert.equal(gateWord('step free access'), true);
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

test('a word nobody has classified waits in the holding pen', async () => {
  await sets.recordCandidates('water-parks', [
    { norm: 'wave machine', raw: 'wave machine', rawForms: ['wave machine'], sources: ['google'], placesSeen: 2, examples: ['google:a'], asserts: 2 },
    { norm: 'locker', raw: 'lockers', rawForms: ['lockers'], sources: ['google'], placesSeen: 19, examples: ['google:a'], asserts: 19 },
    { norm: 'rude staff', raw: 'rude staff', rawForms: ['rude staff'], sources: ['google'], placesSeen: 5, asserts: 5 },
  ], { placesTotal: 20 });

  // Nothing is promotable until something has said it is a feature. "Rude
  // staff" never will be: the code's own pass called it an opinion.
  assert.equal((await sets.candidates({ subcategory: 'water-parks', status: 'new' })).length, 0);
  const pen = await sets.unclassified({ subcategory: 'water-parks' });
  assert.deepEqual(pen.map((p) => p.norm).sort(), ['locker', 'wave machine'], 'the opinion is not waiting on anybody');
  const opinions = await sets.candidates({ subcategory: 'water-parks', status: 'unresolved', kind: 'opinion' });
  assert.equal(opinions[0].norm, 'rude staff');

  // The classifier calls the two it was given features — and neither becomes
  // promotable, because neither carries a quote (C21, owner 26 Sep 2026: "a
  // Google-raised word is never promoted on a classifier verdict alone").
  const verdicts = { 'wave machine': 'feature', locker: 'feature' };
  for (const row of pen) await sets.setKind(row.id, { kind: verdicts[row.norm], by: 'test' });
  assert.equal((await sets.candidates({ subcategory: 'water-parks', status: 'new' })).length, 0, 'a verdict alone promotes nothing');
  const called = await sets.candidates({ subcategory: 'water-parks', status: 'unresolved', kind: 'feature' });
  assert.deepEqual(called.map((c) => c.norm).sort(), ['locker', 'wave machine'], 'the verdicts are kept as facts about the words');

  // The feature harvest then finds one of them in owned text, with a sentence
  // to show for it: that is what makes it promotable.
  await sets.recordCandidates('water-parks', [
    { norm: 'wave machine', raw: 'wave machine', kind: 'feature', sources: ['features'], placesSeen: 2, examples: ['osm:a'], asserts: 2, evidence: 'the wave machine runs on the hour', evidenceRef: 'osm:a' },
  ], { placesTotal: 20 });
  const before = await sets.candidates({ subcategory: 'water-parks', status: 'new' });
  assert.equal(before.length, 1);
  // Seen-on is what the screen sorts by: a 10% find above a 95% word.
  assert.equal(before[0].norm, 'wave machine', 'the quoted word is the promotable one');
  assert.equal(before[0].discriminates, true);
  assert.equal(called.find((c) => c.norm === 'locker').discriminates, false, '19 of 20 is the category');

  const lockers = called.find((c) => c.norm === 'locker');
  await sets.ignoreCandidate(lockers.id, { actor: 'test' });
  const written = await sets.recordCandidates('water-parks', [
    { norm: 'locker', raw: 'lockers', sources: ['osm'], placesSeen: 19 },
  ], { placesTotal: 20 });
  assert.equal(written.skipped, 1, 'the harvest skipped it rather than writing it again');
  assert.equal((await sets.candidates({ subcategory: 'water-parks', status: 'new' })).length, 1);
});

test('a candidate says when its mentions are mostly against it', async () => {
  await sets.recordCandidates('water-parks', [
    { norm: 'slide tower', raw: 'slide tower', sources: ['google'], placesSeen: 4, asserts: 1, denies: 2, asks: 1 },
  ], { placesTotal: 20 });
  const [row] = await sets.candidates({ subcategory: 'water-parks', status: 'unresolved', kind: 'unclear' })
    .then((rows) => rows.filter((r) => r.norm === 'slide tower'));
  assert.equal(row.polarity.mostlyAgainst, true, 'three of its four mentions are a denial or a question');
  assert.equal(row.seenOn, 0.2);
});

test('a settled set leaves the Google pass, and a new subcategory brings it back', async () => {
  await sets.settleSet('water', { on: { places: 20 } });
  let settled = await sets.settledSubcategories();
  assert.equal(settled.get('water-parks').vocabulary_settled, true);

  await query("insert into shelf_subcategories (key, label, category_key) values ('lidos', 'Lidos', 'test-cat') on conflict do nothing");
  await sets.attach('water', 'lidos');
  settled = await sets.settledSubcategories();
  assert.equal(settled.get('water-parks').vocabulary_settled, false,
    'lidos bring a vocabulary nobody has harvested, so the set is not settled any more');
});

test('promoting a word makes a question, reuses a label we have, and drops the scaffolding', async () => {
  const [candidate] = await sets.candidates({ subcategory: 'water-parks', status: 'new' });
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
    /not one of our facts/,
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

// ---------------------------------------------------------------------------
// being a good guest
// ---------------------------------------------------------------------------

test('a venue that says no is not read', async () => {
  // Brief §5.5: enrichment reads venue pages, so it respects robots.txt and a
  // per-domain crawl delay, "set centrally in the client". Centrally is the
  // word — three places in Epic fetch a venue's own page, and a rule that
  // lives in one of them is a rule the other two break.
  const polite = await import('../src/sources/politeness.js');
  const theirs = polite.parse([
    'User-agent: *', 'Disallow: /admin', 'Crawl-delay: 2', '',
    'User-agent: EpicBot', 'Disallow: /private', 'Allow: /private/menu',
  ].join('\n'));
  assert.equal(polite.allowedBy(theirs.rules, '/private/prices'), false, 'they named us and said no');
  assert.equal(polite.allowedBy(theirs.rules, '/private/menu'), true, 'the longer rule wins');
  assert.equal(polite.allowedBy(theirs.rules, '/admin'), true, 'the wildcard group is not ours once they name us');

  const blanket = polite.parse('User-agent: *\nDisallow: /');
  assert.equal(polite.allowedBy(blanket.rules, '/anything'), false);
  // An empty Disallow is the standard's way of saying "nothing is disallowed".
  assert.equal(polite.allowedBy(polite.parse('User-agent: *\nDisallow:').rules, '/x'), true);
  // A site with no robots.txt has not refused anything.
  assert.equal(polite.allowedBy(polite.parse('').rules, '/x'), true);
});

// ---------------------------------------------------------------------------
// the three ways our own facts are keyed
// ---------------------------------------------------------------------------

test('a key is split however it was written, so stepFree meets step free', async () => {
  // Found in the live queue on 20 Sep: `stepfree` and `wheelchairtoilet`, six
  // places each, raised as *new* words when `step-free` is already one of our
  // labels and already a global question. The tag conventions were split and
  // the camelCase keys `own.js` composes into `place_records.accessibility`
  // were not, so the alias table — whose whole job is to stop that duplicate —
  // never saw a word it could match.
  const { heldTextFor } = await import('../src/sources/vocabulary.js');
  const ref = 'test:keys';
  await query('delete from place_facts where venue_ref = $1', [ref]);
  await query('delete from place_records where venue_ref = $1', [ref]);
  await query(
    `insert into place_facts (venue_ref, field, source, value, licence, retention)
     values ($1, 'accessibility', 'site', $2::jsonb, 'owned', 'keep')`,
    [ref, JSON.stringify({ stepFree: true, 'wheelchair:toilet': true, hearing_loop: true })],
  );
  const { texts } = await heldTextFor(ref);
  const words = texts.map((t) => t.text).join(' ');
  for (const phrase of ['step Free', 'wheelchair toilet', 'hearing loop']) {
    assert.match(words, new RegExp(phrase, 'i'), `${phrase} came back glued together`);
  }
  const { phrasesIn } = await import('../src/domain/questions.js');
  const raised = [...phrasesIn(words).keys()];
  assert.ok(raised.includes('step free'), 'the harvest must raise the words our label is written in');
  assert.ok(!raised.includes('stepfree'), 'a glued key is a word nobody wrote');
  await query('delete from place_facts where venue_ref = $1', [ref]);
});

test('a sweep clears the glued spelling of a word it now raises properly', async () => {
  // Migration 211 cleared what was in the queue; this is the same test run on
  // every sweep, so the next change to extraction cleans up after itself.
  const sub = (await query("select key from shelf_subcategories where active limit 1")).rows[0].key;
  await query("delete from harvest_candidates where subcategory = $1 and norm in ('splash zone', 'splashzone')", [sub]);
  await query(
    `insert into harvest_candidates (norm, raw_forms, subcategory, places_seen, places_total, kind, status)
     values ('splashzone', '{splashzone}', $1, 6, 20, 'feature', 'new')`, [sub],
  );
  await sets.recordCandidates(sub, [{ norm: 'splash zone', raw: 'splash zone', placesSeen: 6, sources: ['osm'], asserts: 6 }], { placesTotal: 20 });
  const left = await query("select norm from harvest_candidates where subcategory = $1 and norm in ('splash zone', 'splashzone')", [sub]);
  assert.deepEqual(left.rows.map((r) => r.norm), ['splash zone'], 'the glued spelling should have gone with the sweep');
  await query("delete from harvest_candidates where subcategory = $1 and norm = 'splash zone'", [sub]);
});

test('a feature pass is readable behind the words a Google pass left', async () => {
  // Why the filter exists. The list is ordered by share ascending, so a
  // feature seen on two places of twenty (10%) sorts *below* every Google word
  // seen on one place in a hundred (1%). Read off a limited list, the drawers
  // with the most in them came back with nothing — which is how a run that had
  // worked was read as a run that had not.
  await query("insert into shelf_categories (key, label) values ('test-cat', 'Test') on conflict do nothing");
  await query("insert into shelf_subcategories (key, label, category_key) values ('trig-points', 'Trig points', 'test-cat') on conflict do nothing");
  const google = Array.from({ length: 40 }, (_, i) => ({
    norm: `google word ${i}`, raw: `google word ${i}`, sources: ['google'], placesSeen: 1, asserts: 1,
  }));
  await sets.recordCandidates('trig-points', google, { placesTotal: 100 });
  await sets.recordCandidates('trig-points', [
    { norm: 'trig point', raw: 'Trig point', sources: ['features'], placesSeen: 4, asserts: 4 },
    { norm: 'steep slope', raw: 'Steep slopes', sources: ['features'], placesSeen: 2, asserts: 2 },
  ], { placesTotal: 20 });

  const capped = await sets.candidates({ subcategory: 'trig-points', status: null, limit: 40 });
  assert.equal(capped.length, 40);
  assert.equal(capped.filter((c) => c.sources?.features).length, 0,
    'the feature pass is exactly what a limit hides');

  const mine = await sets.candidates({ subcategory: 'trig-points', status: null, source: 'features', limit: 40 });
  assert.deepEqual(mine.map((c) => c.norm).sort(), ['steep slope', 'trig point']);

  // The filter narrows and does not re-sort: rarest still first.
  assert.equal(mine[0].norm, 'steep slope');

  // A source nothing was raised under is an empty list, not everything.
  assert.equal((await sets.candidates({ subcategory: 'trig-points', status: null, source: 'wikipedia' })).length, 0);
});

test('a quote is kept from an owned source and dropped from a rented one', async () => {
  // Migration 247. The owner: "a candidate I can certify but not read is one
  // I cannot approve". Owned text may be quoted; a Google review summary may
  // not reach a column under any name, including this one.
  await query("insert into shelf_subcategories (key, label, category_key) values ('quoted-drawer', 'Quoted', 'test-cat') on conflict do nothing");
  // The test database outlives one run, and an ignored word stays ignored.
  await query("delete from harvest_candidates where subcategory = 'quoted-drawer'");
  await sets.recordCandidates('quoted-drawer', [
    { norm: 'trig point', raw: 'Trig point', sources: ['features'], placesSeen: 4, asserts: 4,
      evidence: 'A trig point marks the summit', evidenceRef: 'atlas:1' },
    { norm: 'wave machine', raw: 'wave machine', sources: ['google'], placesSeen: 3, asserts: 3,
      evidence: 'the wave machine runs on the hour' },
  ], { placesTotal: 20 });
  const rows = await sets.candidates({ subcategory: 'quoted-drawer', status: null, limit: 10, withEvidence: true });
  const trig = rows.find((c) => c.norm === 'trig point');
  const wave = rows.find((c) => c.norm === 'wave machine');
  assert.equal(trig.evidence, 'A trig point marks the summit');
  assert.equal(trig.evidence_ref, 'atlas:1');
  assert.ok(trig.evidence_at);
  assert.equal(wave.evidence, null, 'rented text is never written down, whatever the caller sent');

  // Raised again by the Google pass, the owned quote stays.
  await sets.recordCandidates('quoted-drawer', [
    { norm: 'trig point', raw: 'trig point', sources: ['google'], placesSeen: 2, asserts: 2, evidence: 'from a review' },
  ], { placesTotal: 100 });
  const again = (await sets.candidates({ subcategory: 'quoted-drawer', status: null, limit: 10, withEvidence: true })).find((c) => c.norm === 'trig point');
  assert.equal(again.evidence, 'A trig point marks the summit');

  // Decided, the examples go with the decision — and the quote stays. It is
  // owned text, and under C21 (no quote, no promotion) it is the only thing
  // that can make a restored word promotable again; clearing it here left an
  // ignored-then-restored word an unresolved feature nothing could ever pick
  // up (Codex, 26 Sep 2026).
  await sets.setKind(again.id, { kind: 'feature', by: 'test' });
  await sets.ignoreCandidate(again.id, { actor: 'test' });
  const [gone] = await sets.candidates({ subcategory: 'quoted-drawer', status: 'ignored', limit: 10, withEvidence: true });
  assert.deepEqual(gone.examples, []);
  assert.equal(gone.evidence, 'A trig point marks the summit');
  assert.equal(gone.evidence_ref, 'atlas:1');
});

test('the pen can be read from its common end, above a sightings floor', async () => {
  // Rarest-first is the design brief's order and stays the default. But a
  // list capped at a thousand rows and sorted that way can never show the
  // words seen on the most places in a drawer whose pen holds more than that —
  // with thirty-seven thousand words in the pen, that was every rich drawer.
  const sub = (await query("select key from shelf_subcategories where active limit 1")).rows[0].key;
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
  const rows = [['zz once', 1], ['zz twice', 2], ['zz thrice', 3]];
  for (const [norm, seen] of rows) {
    await query(
      `insert into harvest_candidates (norm, raw_forms, subcategory, places_seen, places_total, kind, status)
       values ($1, array[$1], $2, $3, 20, 'unclear', 'unresolved')`, [norm, sub, seen],
    );
  }
  const rare = await sets.candidates({ subcategory: sub, status: 'unresolved', kind: 'unclear', limit: 3 });
  assert.equal(rare[0].norm, 'zz once', 'the default is still rarest-first');
  const common = await sets.candidates({ subcategory: sub, status: 'unresolved', kind: 'unclear', sort: 'common', limit: 3 });
  assert.deepEqual(common.map((c) => c.norm), ['zz thrice', 'zz twice', 'zz once']);
  const floored = await sets.candidates({ subcategory: sub, status: 'unresolved', kind: 'unclear', sort: 'common', minSeen: 2, limit: 10 });
  assert.deepEqual(floored.map((c) => c.norm), ['zz thrice', 'zz twice'], 'a word seen once is below the floor');
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
});

test('a floor that is not a whole number is no floor, not a 500', async () => {
  // Codex, 25 Sep 2026: `minSeen=1.5` or `Infinity` reached `$7::int` and the
  // GET answered 500. A floor is a reading aid; anything the database cannot
  // hold as one is read as "no floor" rather than refused.
  const sub = (await query("select key from shelf_subcategories where active limit 1")).rows[0].key;
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
  await query(
    `insert into harvest_candidates (norm, raw_forms, subcategory, places_seen, places_total, kind, status)
     values ('zz once', array['zz once'], $1, 1, 20, 'unclear', 'unresolved')`, [sub],
  );
  for (const floor of [1.5, Infinity, 'many', -3, '', 9999999999]) {
    const rows = await sets.candidates({ subcategory: sub, status: 'unresolved', kind: 'unclear', minSeen: floor, limit: 5 });
    assert.ok(Array.isArray(rows), `a floor of ${String(floor)} must not throw`);
  }
  // A whole number above int4 is finite and still not a floor the cast can
  // hold: it is read as no floor and keeps the singleton (Codex, 25 Sep 2026).
  assert.equal((await sets.candidates({ subcategory: sub, status: 'unresolved', kind: 'unclear', minSeen: 9999999999, limit: 5 })).length, 1);
  // 1.5 floors to 1 and keeps the singleton; 2.9 floors to 2 and drops it.
  assert.equal((await sets.candidates({ subcategory: sub, status: 'unresolved', kind: 'unclear', minSeen: 1.5, limit: 5 })).length, 1);
  assert.equal((await sets.candidates({ subcategory: sub, status: 'unresolved', kind: 'unclear', minSeen: 2.9, limit: 5 })).length, 0);
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
});

// ---------------------------------------------------------------------------
// the verdict on the Google pass
// ---------------------------------------------------------------------------

test('the Google pass is decided against, and the code refuses before it quotes a price', async () => {
  // The owner, 26 Sep 2026: "No second Google pass. The 21 Sep run is
  // conclusive — 41,816 words, nought promotable… Record that verdict so
  // nobody proposes it a third time." Migration 251 records it; this pins
  // that the recording is read, so the door cannot be reopened by deleting a
  // line — only by a later verdict row with evidence of its own.
  const { rows: [verdict] } = await query("select * from data_verdicts where key = 'harvest.google-pass'");
  assert.ok(verdict, 'migration 251 must have written the verdict');
  assert.equal(verdict.evidence.words_raised, 41816);
  assert.equal(verdict.evidence.promotable, 0);
  const harvest = await import('../src/sources/vocabulary.js');
  assert.equal((await harvest.verdictAgainst('harvest.google-pass'))?.key, 'harvest.google-pass');
  await assert.rejects(
    () => harvest.googleHarvest({ confirm: 295 }),
    (err) => err.code === 'decided_against' && /decided against on/.test(err.message) && !('plan' in err),
    'the refusal names the verdict and quotes no price',
  );
  // A later row that supersedes it reopens the door — and only that.
  await query(
    `insert into data_verdicts (key, question, verdict, supersedes, decided_by)
     values ('harvest.google-pass.test-reopen', 'test', 'test', 'harvest.google-pass', 'test')`,
  );
  assert.equal(await harvest.verdictAgainst('harvest.google-pass'), null, 'a superseded verdict no longer stands');
  await query("delete from data_verdicts where key = 'harvest.google-pass.test-reopen'");
});

test('a word the classifier cannot call is not asked again until its count rises', async () => {
  // 26 Sep 2026: an unclear verdict wrote nothing, and the pen is read
  // most-seen first, so the same four hundred words came back at the top of
  // every tranche — 416 of 480 held, then 461 of 480 — and were bought again.
  const harvest = await import('../src/sources/vocabulary.js');
  const sub = (await query("select key from shelf_subcategories where active limit 1")).rows[0].key;
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
  const { rows: [row] } = await query(
    `insert into harvest_candidates (norm, raw_forms, subcategory, places_seen, places_total, kind, status)
     values ('zz murk', array['zz murk'], $1, 7, 20, 'unclear', 'unresolved') returning id`, [sub],
  );
  const first = await harvest.classifyCandidates({ subcategory: sub, limit: 10, ask: async (slice) => slice.map((w) => ({ word: w.norm, kind: 'unclear' })) });
  assert.equal(first.looked, 1);
  assert.equal(first.held, 1, 'the verdict was unclear');
  const { rows: [after] } = await query('select classified_at, classified_seen, kind, status from harvest_candidates where id = $1', [row.id]);
  assert.ok(after.classified_at, 'an unclear verdict is written down');
  assert.equal(after.classified_seen, 7);
  assert.equal(after.kind, 'unclear');
  assert.equal(after.status, 'unresolved', 'still in the pen');
  const second = await harvest.classifyCandidates({ subcategory: sub, limit: 10, ask: async () => { throw new Error('must not be asked'); } });
  assert.equal(second.looked, 0, 'not asked again at the same count');
  await query('update harvest_candidates set places_seen = 9 where id = $1', [row.id]);
  const third = await harvest.classifyCandidates({ subcategory: sub, limit: 10, ask: async (slice) => slice.map((w) => ({ word: w.norm, kind: 'feature' })) });
  assert.equal(third.looked, 1, 'a raised count earns another look');
  assert.equal(third.features, 1);
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
});

// ---------------------------------------------------------------------------
// no quote, no promotion
// ---------------------------------------------------------------------------

test('promotable means harvest-found and quoted; a classifier verdict alone never makes one', async () => {
  // The owner, 26 Sep 2026 (C21): "A Google-raised word is never promoted on
  // a classifier verdict alone." Four doors, one rule at each.
  const harvest = await import('../src/sources/vocabulary.js');
  const sub = (await query("select key from shelf_subcategories where active limit 1")).rows[0].key;
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);

  // 1. Written by a Google run as a feature: in the pen, not promotable.
  await sets.recordCandidates(sub, [{ norm: 'zz wave machine', raw: 'zz wave machine', placesSeen: 5, sources: ['google'], asserts: 5 }], { placesTotal: 20 });
  await query("update harvest_candidates set kind = 'feature' where subcategory = $1 and norm = 'zz wave machine'", [sub]);
  // 2. Found by the feature harvest with a quote: promotable.
  await sets.recordCandidates(sub, [{ norm: 'zz toddler pool', raw: 'zz toddler pool', kind: 'feature', placesSeen: 3, sources: ['features'], asserts: 3, evidence: 'a heated toddler pool beside the main pool', evidenceRef: 'osm:way/1' }], { placesTotal: 20 });
  const [g] = await sets.candidates({ subcategory: sub, status: null, sort: 'common', limit: 10 }).then((r) => r.filter((c) => c.norm === 'zz wave machine'));
  const [f] = await sets.candidates({ subcategory: sub, status: null, sort: 'common', limit: 10 }).then((r) => r.filter((c) => c.norm === 'zz toddler pool'));
  assert.equal(g.status, 'unresolved', 'a Google feature is not promotable');
  assert.equal(f.status, 'new', 'a quoted harvest feature is');

  // 3. The classifier calling the Google word a feature changes its kind, not its status.
  const verdict = await harvest.classifyCandidates({ subcategory: sub, limit: 10, ask: async (slice) => slice.map((w) => ({ word: w.norm, kind: 'feature' })) });
  assert.ok(verdict.looked >= 0);
  await query("update harvest_candidates set kind = 'unclear', status = 'unresolved', classified_seen = null where subcategory = $1 and norm = 'zz wave machine'", [sub]);
  const called = await harvest.classifyCandidates({ subcategory: sub, limit: 10, ask: async (slice) => slice.map((w) => ({ word: w.norm, kind: 'feature' })) });
  assert.equal(called.features, 1);
  const { rows: [after] } = await query("select kind, status from harvest_candidates where subcategory = $1 and norm = 'zz wave machine'", [sub]);
  assert.deepEqual(after, { kind: 'feature', status: 'unresolved' }, 'a verdict is a fact about the word, not a promotion');

  // 4. Promotion refuses an unquoted word at the door, even if its status were forced.
  await query("update harvest_candidates set status = 'new' where subcategory = $1 and norm = 'zz wave machine'", [sub]);
  const { rows: [row] } = await query("select id from harvest_candidates where subcategory = $1 and norm = 'zz wave machine'", [sub]);
  await assert.rejects(() => sets.promote(row.id, { actor: 'test' }), /no evidence quote/);

  // 5. Migration 258's reset, applied to the same shapes.
  await query("update harvest_candidates set kind = 'feature', status = 'new' where subcategory = $1 and norm = 'zz wave machine'", [sub]);
  await query(`update harvest_candidates set kind = 'unclear', status = 'unresolved' where status = 'new' and not (sources ? 'features') and subcategory = $1`, [sub]);
  const { rows: [reset] } = await query("select kind, status from harvest_candidates where subcategory = $1 and norm = 'zz wave machine'", [sub]);
  assert.deepEqual(reset, { kind: 'unclear', status: 'unresolved' });
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
});

test('an ignored word keeps its quote, so the way back leads somewhere', async () => {
  // Codex, 26 Sep 2026: ignoring cleared the evidence, so under C21 a restored
  // word could never be promotable again — an unresolved feature nothing
  // would ever pick up. The examples are scaffolding and go; the quote is
  // owned text and stays.
  const sub = (await query("select key from shelf_subcategories where active limit 1")).rows[0].key;
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
  await sets.recordCandidates(sub, [{ norm: 'zz lazy river', raw: 'zz lazy river', kind: 'feature', sources: ['features'], placesSeen: 4, examples: ['osm:b'], asserts: 4, evidence: 'a lazy river winds round the outdoor pool', evidenceRef: 'osm:b' }], { placesTotal: 20 });
  const [row] = (await sets.candidates({ subcategory: sub, status: 'new', limit: 50 })).filter((c) => c.norm === 'zz lazy river');
  assert.equal(row.status, 'new');
  const ignored = await sets.ignoreCandidate(row.id, { actor: 'test' });
  assert.deepEqual(ignored.examples, [], 'the scaffolding goes with the decision');
  assert.ok(ignored.evidence, 'the quote does not');
  const back = await sets.unignore(row.id);
  assert.equal(back.status, 'new', 'restored, and promotable again because it is still quoted');
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
});

// ---------------------------------------------------------------------------
// the alias plan: merges, another sheet, filings (C18, C24)
// ---------------------------------------------------------------------------

test('a word promoted onto an existing label becomes its alias, and may land on another sheet', async () => {
  // Riverside is river said another way (a merge), and a moat raised under
  // museums belongs to Historic (the owner, 26 Sep 2026).
  const sub = (await query("select key from shelf_subcategories where active limit 1")).rows[0].key;
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
  await query("insert into question_sets (key, name) values ('zz-other', 'Other') on conflict do nothing");
  await sets.recordCandidates(sub, [
    { norm: 'zz river', raw: 'zz river', kind: 'feature', sources: ['features'], placesSeen: 4, examples: ['osm:r'], asserts: 4, evidence: 'found on the River Dulais', evidenceRef: 'osm:r' },
    { norm: 'zz riverside', raw: 'zz riverside', kind: 'feature', sources: ['features'], placesSeen: 4, examples: ['osm:r2'], asserts: 4, evidence: 'located next to the River Thames', evidenceRef: 'osm:r2' },
  ], { placesTotal: 20 });
  const rows = await sets.candidates({ subcategory: sub, status: 'new', limit: 50 });
  const river = rows.find((c) => c.norm === 'zz river');
  const riverside = rows.find((c) => c.norm === 'zz riverside');
  const first = await sets.promote(river.id, { actor: 'test', setKey: 'zz-other' });
  assert.equal(first.setKey, 'zz-other', 'the override names the sheet');
  const merged = await sets.promote(riverside.id, { actor: 'test', attributeKey: first.attributeKey, setKey: 'zz-other' });
  assert.equal(merged.attributeKey, first.attributeKey, 'merged onto the same label');
  assert.equal((await sets.resolveAttribute('zz riverside'))?.key, first.attributeKey, 'the merged wording resolves there from now on');
  await assert.rejects(() => sets.promote(river.id, { actor: 'test', setKey: 'zz-nowhere' }), /already been decided|no question set called/);
  await query("delete from questions where set_key = 'zz-other'");
  await query("delete from question_sets where key = 'zz-other'");
  await query("delete from attribute_aliases where norm like 'zz %'");
  await query("delete from place_attributes where key like 'zz-%'");
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
});

test('a drawer name is decided as a filing, never a question', async () => {
  const sub = (await query("select key from shelf_subcategories where active limit 1")).rows[0].key;
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
  await sets.recordCandidates(sub, [
    { norm: 'zz lake', raw: 'zz lake', kind: 'feature', sources: ['features'], placesSeen: 10, examples: ['osm:l'], asserts: 10, evidence: 'a boating lake', evidenceRef: 'osm:l' },
  ], { placesTotal: 83 });
  const [lake] = (await sets.candidates({ subcategory: sub, status: 'new', limit: 50 })).filter((c) => c.norm === 'zz lake');
  const filed = await sets.fileUnder(lake.id, { under: sub, by: 'test' });
  assert.equal(filed.kind, 'filing');
  assert.equal(filed.files_under, sub);
  assert.equal(filed.status, 'unresolved', 'decided, and not promotable');
  assert.ok(filed.evidence, 'the quote stays with the decision');
  assert.equal((await sets.candidates({ subcategory: sub, status: 'new', limit: 50 })).filter((c) => c.norm === 'zz lake').length, 0);
  await assert.rejects(() => sets.fileUnder(lake.id, { under: 'zz-no-such-drawer' }), /no drawer called/);
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
});

test('dining area is food-on-site said another way', async () => {
  // Migration 259: the wording is an alias of the global label, so the
  // resolver answers the question already asked of everything.
  assert.equal((await sets.resolveAttribute('Dining area'))?.key, 'food-on-site');
});

test('Codex: a filing needs its drawer, a merge names a real label, and a wording means one thing', async () => {
  // Three doors the alias plan opened and did not guard (Codex, 26 Sep 2026).
  const sub = (await query("select key from shelf_subcategories where active limit 1")).rows[0].key;
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
  await query("insert into question_sets (key, name) values ('zz-other', 'Other') on conflict do nothing");
  await sets.recordCandidates(sub, [
    { norm: 'zz brook', raw: 'zz brook', kind: 'feature', sources: ['features'], placesSeen: 3, examples: ['osm:b'], asserts: 3, evidence: 'a brook runs through the meadow', evidenceRef: 'osm:b' },
  ], { placesTotal: 20 });
  const [brook] = (await sets.candidates({ subcategory: sub, status: 'new', limit: 50 })).filter((c) => c.norm === 'zz brook');

  // 1. The generic kind endpoint cannot make a filing with no drawer.
  await assert.rejects(() => sets.setKind(brook.id, { kind: 'filing', by: 'test' }), /decide it with \/file/);

  // 2. Merging onto a label that does not exist is a 400 with a sentence, not a 500.
  await assert.rejects(
    () => sets.promote(brook.id, { actor: 'test', attributeKey: 'zz-no-such-label', setKey: 'zz-other' }),
    (err) => err.status === 400 && /not one of our labels/.test(err.message),
  );

  // 3. A wording already pointed at one label is not promoted onto another.
  await query("insert into place_attributes (key, label, kind, position) values ('zz-stream', 'Zz stream', 'yesno', 200), ('zz-water-feature', 'Zz water feature', 'yesno', 200) on conflict do nothing");
  await query("insert into attribute_aliases (norm, target_key, raw) values ('zz brook', 'zz-stream', 'zz brook') on conflict (norm) do nothing");
  await assert.rejects(
    () => sets.promote(brook.id, { actor: 'test', attributeKey: 'zz-water-feature', setKey: 'zz-other' }),
    /already means zz-stream/,
  );
  // Merged where it already points, it goes through.
  const ok = await sets.promote(brook.id, { actor: 'test', attributeKey: 'zz-stream', setKey: 'zz-other' });
  assert.equal(ok.attributeKey, 'zz-stream');

  await query("delete from questions where set_key = 'zz-other'");
  await query("delete from question_sets where key = 'zz-other'");
  await query("delete from attribute_aliases where norm like 'zz %'");
  await query("delete from harvest_candidates where subcategory = $1 and norm like 'zz %'", [sub]);
  await query("delete from place_attributes where key like 'zz-%'");
});

test('migration 260 turns a promoted soft play on Water into a filing under Play', async () => {
  // The owner, 26 Sep 2026: "Soft play: make it a filing under Play, not a
  // Water question (C24)." The test database holds no production rows, so
  // the shape is seeded and the migration's own statements are run over it.
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('../migrations/260_soft_play_is_a_filing_under_play.sql', import.meta.url), 'utf8');
  await query("insert into shelf_subcategories (key, label, category_key) values ('lidos', 'Lidos', 'test-cat'), ('play', 'Play', 'test-cat') on conflict do nothing");
  await query("insert into question_sets (key, name) values ('water', 'Water') on conflict do nothing");
  await query("insert into place_attributes (key, label, kind, position) values ('soft-play', 'Soft play', 'yesno', 200) on conflict do nothing");
  await query("delete from questions where attribute_key = 'soft-play'");
  const { rows: [q] } = await query("insert into questions (attribute_key, scope, set_key) values ('soft-play', 'set', 'water') returning id");
  await query("delete from harvest_candidates where subcategory = 'lidos' and norm = 'soft play'");
  await query(
    `insert into harvest_candidates (norm, raw_forms, subcategory, places_seen, places_total, kind, status, question_id, evidence, sources)
     values ('soft play', '{Soft play}', 'lidos', 3, 20, 'feature', 'promoted', $1, 'soft play & fitness studio', '{"features": 3}')`, [q.id],
  );
  await query(sql);
  const { rows: [question] } = await query('select active from questions where id = $1', [q.id]);
  assert.equal(question.active, false, 'the Water question is switched off, not deleted');
  const { rows: [row] } = await query("select kind, status, files_under, question_id, evidence from harvest_candidates where subcategory = 'lidos' and norm = 'soft play'");
  assert.deepEqual({ kind: row.kind, status: row.status, files_under: row.files_under, question_id: row.question_id }, { kind: 'filing', status: 'unresolved', files_under: 'play', question_id: null });
  assert.ok(row.evidence, 'the quote stays with the decision');
  await query("delete from harvest_candidates where subcategory = 'lidos' and norm = 'soft play'");
  await query('delete from questions where id = $1', [q.id]);
});

test('an evidence quote goes to the approver only; everybody else is told there is one (E11b, 26 Sep 2026)', async () => {
  const qs = await import('../src/repositories/questionSets.js');
  const sub = (await query("select key from shelf_subcategories where active limit 1")).rows[0].key;
  await query("delete from harvest_candidates where subcategory = $1 and norm = 'zz wave machine'", [sub]);
  await query(
    `insert into harvest_candidates (norm, raw_forms, subcategory, places_seen, places_total, kind, status, sources, evidence, evidence_ref)
     values ('zz wave machine', array['zz wave machine'], $1, 3, 20, 'feature', 'new', '{"features": 3}'::jsonb, 'The pool has a zz wave machine every hour.', 'google:x')`, [sub]);
  try {
    const plain = (await qs.candidates({ subcategory: sub, status: 'new' })).find((c) => c.norm === 'zz wave machine');
    assert.equal(plain.evidence, null);
    assert.equal(plain.evidence_ref, null);
    assert.equal(plain.quoted, true);
    const approver = (await qs.candidates({ subcategory: sub, status: 'new', withEvidence: true })).find((c) => c.norm === 'zz wave machine');
    assert.match(approver.evidence, /wave machine/);
  } finally {
    await query("delete from harvest_candidates where subcategory = $1 and norm = 'zz wave machine'", [sub]);
  }
});
