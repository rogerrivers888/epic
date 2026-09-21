/**
 * Where a run's volume went — src/domain/runFunnel.js.
 *
 * These are the judgements the Runs screen is built on, and each has a wrong
 * answer that is quiet rather than loud: a run whose middle was never written
 * down reading as a clean bill of health; a backlog growing reading the same
 * as one clearing; a set that has stopped producing words reading as finished
 * when eight words are still waiting on somebody.
 *
 * None of those shows up in a screenshot, which is why they are pinned here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLLAPSE_FLOOR, ENOUGH_TO_JUDGE, KEPT_FLOOR, PEN_CEILING, STAGES,
  LISTABLE, STALL_AFTER_MS, clearsOf, diagnose, headlineOf, livenessOf, saturationOf, stageOf,
  verdictOf,
} from '../src/domain/runFunnel.js';

// --- the stages ------------------------------------------------------------

test('the sixth stage is not called validated, because nothing was validated', () => {
  // A harvest reads rented text, normalises it and writes the survivors down.
  // What confirms a word against an owned source is a different run entirely,
  // and calling this one validation would claim the single thing the Labels
  // tab exists to keep honest: Google may raise a word, never answer one.
  const names = STAGES.map(([, name]) => name);
  assert.equal(names.includes('validated'), false);
  assert.deepEqual(names, [
    'places read', 'words out', 'after the resolver',
    'too thin', 'held', 'written down', 'waiting on you',
  ]);
});

// --- the diagnosis ---------------------------------------------------------

test('a run that never wrote its middle down is unknown, not healthy', () => {
  // The distinction that matters most on this screen. Without it every run
  // from before the funnel existed reads as a clean bill of health.
  const d = diagnose(null);
  assert.equal(d.recorded, false);
  assert.equal(d.says, 'not recorded');
  assert.equal(d.at, null);
});

test('a resolver that is not collapsing is named, and the stage is enlarged', () => {
  const d = diagnose({ read: 620, raw: 1480, collapsed: 1290, thin: 410, held: 20, stored: 900 });
  assert.equal(d.says, 'the resolver is not collapsing');
  assert.equal(d.at, 'collapsed');
  assert.equal(d.healthy, false);
  assert.equal(d.recorded, true);
});

test('a small pile of words is not judged on its collapse rate', () => {
  // Ten words that collapse to ten is not evidence of anything. The floor
  // exists so a first, tiny run does not open with an accusation.
  const d = diagnose({ read: 9, raw: ENOUGH_TO_JUDGE - 1, collapsed: ENOUGH_TO_JUDGE - 1, held: 0, stored: 99 });
  assert.notEqual(d.says, 'the resolver is not collapsing');
});

test('the holding pen taking more than its share is named before the rest', () => {
  // Collapse is fine here; the pen is not. Ordering matters: a run with two
  // faults has one worst one, and a screen listing both makes somebody choose.
  const d = diagnose({ read: 100, raw: 400, collapsed: 100, held: 60, stored: 30 });
  assert.equal(d.says, 'the holding pen is taking half');
  assert.equal(d.at, 'held');
});

test('most words dying unconfirmed is the third thing looked for', () => {
  const d = diagnose({ read: 100, raw: 400, collapsed: 100, held: 10, stored: 20 });
  assert.equal(d.says, 'most words die unconfirmed');
  assert.equal(d.at, 'stored');
});

test('a healthy run says so and enlarges nothing', () => {
  const d = diagnose({ read: 100, raw: 400, collapsed: 100, held: 10, stored: 80 });
  assert.equal(d.says, 'drop-off looks normal');
  assert.equal(d.at, null);
  assert.equal(d.healthy, true);
});

test('the thresholds are the boundary, not a hair past it', () => {
  // Exactly at the pen ceiling is not over it; exactly at the kept floor is
  // not under it. A limit somebody sets to 0.4 means four in ten is the most
  // they will accept, not that four in ten is already too many.
  const atPen = diagnose({ raw: 400, collapsed: 100, held: PEN_CEILING * 100, stored: 80 });
  assert.notEqual(atPen.says, 'the holding pen is taking half');
  const atKept = diagnose({ raw: 400, collapsed: 100, held: 0, stored: KEPT_FLOOR * 100 });
  assert.notEqual(atKept.says, 'most words die unconfirmed');
  const atCollapse = diagnose({ raw: 100, collapsed: 100 * (1 - COLLAPSE_FLOOR), held: 0, stored: 70 });
  assert.notEqual(atCollapse.says, 'the resolver is not collapsing');
});

test('a run that raised nothing is not accused of a bad collapse', () => {
  // Nought raw words is an absence of evidence. Dividing by it would make the
  // emptiest run the loudest thing on the screen.
  const d = diagnose({ read: 40, raw: 0, collapsed: 0, held: 0, stored: 0 });
  assert.equal(d.says, 'drop-off looks normal');
  assert.equal(d.recorded, true);
});

// --- the headline ----------------------------------------------------------

test('the headline answers the question somebody opened the screen with', () => {
  assert.equal(headlineOf([{ raised: 94, decided: 51 }]), 'The queue grew by 43 last week');
  assert.equal(headlineOf([{ raised: 20, decided: 32 }]), 'You are 12 ahead of the harvest');
  assert.equal(headlineOf([{ raised: 10, decided: 10 }]), 'The queue held level last week');
  assert.equal(headlineOf([]), 'Nothing has run yet');
});

// --- clearing --------------------------------------------------------------

test('a backlog held exactly level never clears', () => {
  // Equal rates are not good news: a backlog held level for ever is a backlog
  // that never clears, and rounding that up is how a screen lies politely.
  const level = clearsOf([{ raised: 10, decided: 10 }, { raised: 10, decided: 10 }]);
  assert.equal(level.ever, false);
  assert.equal(level.says, 'At this rate the backlog never clears.');
});

test('deciding faster than raising clears, and says the rates', () => {
  const good = clearsOf([{ raised: 10, decided: 30 }, { raised: 10, decided: 30 }]);
  assert.equal(good.ever, true);
  assert.match(good.note, /Deciding 30 a week against 10 raised/);
});

test('four quiet weeks are not a failing backlog', () => {
  // Nothing raised and nothing decided is not "never clears" — there is
  // nothing to clear, and saying otherwise sends somebody looking for a fault.
  const quiet = clearsOf([{ raised: 0, decided: 0 }, { raised: 0, decided: 0 }]);
  assert.equal(quiet.ever, true);
  assert.equal(quiet.says, 'Nothing raised and nothing decided');
});

// --- saturation ------------------------------------------------------------

test('a set that has stopped growing with a queue is not finished', () => {
  // The case the third verdict exists for. At 0.4 with eight waiting this used
  // to look exactly like a settled set.
  assert.deepEqual(verdictOf({ rate: 0.4, waiting: 8, limit: 1 }),
    { verdict: 'stopped growing, 8 waiting', tone: 'stuck' });
  assert.deepEqual(verdictOf({ rate: 0.4, waiting: 0, limit: 1 }),
    { verdict: 'settled · no more reviews read', tone: 'settled' });
  assert.deepEqual(verdictOf({ rate: 2.6, waiting: 8, limit: 1 }),
    { verdict: 'still growing · read more', tone: 'growing' });
});

test('a set still growing says so even with nothing waiting', () => {
  assert.equal(verdictOf({ rate: 3, waiting: 0, limit: 1 }).tone, 'growing');
});

// --- the saturation denominator --------------------------------------------

const SETS = [{ key: 'water', name: 'Water parks & pools', subcategories: ['pools', 'waterparks'] }];
const LIMITS = { sightingFloor: 2, saturationLimit: 1 };
const raised = (subcategory, n, { placesTotal, placesSeen = 1, status = 'unresolved', kind = 'unclear' } = {}) =>
  Array.from({ length: n }, () => ({
    subcategory, status, kind, places_seen: placesSeen, places_total: placesTotal,
  }));

test('saturation is words per ten places read, not per sighting of the commonest word', () => {
  // The bug this pins: a hundred distinct words each seen once across a
  // hundred places is a rate of ten, not a thousand. Using a word's own
  // frequency as the denominator reported a settled set as still growing for
  // ever, and "still growing · read more" is an instruction to spend money.
  const [s] = saturationOf(SETS, raised('pools', 100, { placesTotal: 100, placesSeen: 1 }), LIMITS);
  assert.equal(s.rate, 10);
});

test('the denominator is the sample, so a word on every place does not shrink it', () => {
  // Ten words, one of which turned up on all hundred places. The rate is still
  // ten words per hundred places.
  const rows = [
    ...raised('pools', 9, { placesTotal: 100, placesSeen: 1 }),
    ...raised('pools', 1, { placesTotal: 100, placesSeen: 100 }),
  ];
  assert.equal(saturationOf(SETS, rows, LIMITS)[0].rate, 1);
});

test('a set spanning two drawers adds their samples together', () => {
  // `places_total` is recorded per subcategory, so a set covering two of them
  // was read over both samples and the denominator is the sum.
  const rows = [
    ...raised('pools', 10, { placesTotal: 60 }),
    ...raised('waterparks', 10, { placesTotal: 40 }),
  ];
  assert.equal(saturationOf(SETS, rows, LIMITS)[0].rate, 2);
});

test('a set nothing has been read for has no rate rather than an infinite one', () => {
  assert.equal(saturationOf(SETS, [], LIMITS)[0].rate, 0);
  assert.equal(saturationOf(SETS, raised('pools', 5, { placesTotal: 0 }), LIMITS)[0].rate, 0);
});

test('only a promotable word counts as waiting on somebody', () => {
  // Held words and words below the floor are not a queue: nobody can act on
  // them, and counting them would make every set look permanently stuck.
  const rows = [
    ...raised('pools', 3, { placesTotal: 50, placesSeen: 5, status: 'new', kind: 'feature' }),
    ...raised('pools', 4, { placesTotal: 50, placesSeen: 1, status: 'new', kind: 'feature' }),
    ...raised('pools', 5, { placesTotal: 50, placesSeen: 9, status: 'unresolved', kind: 'unclear' }),
  ];
  assert.equal(saturationOf(SETS, rows, LIMITS)[0].waiting, 3);
});

// --- a run in flight -------------------------------------------------------

test('the live panel shows a stage only once the run has reached it', () => {
  // `noteRun` writes the six stages a run counts as it goes; `thin` and
  // `waiting` are computed at read time and are not in it. Drawing them as
  // nought mid-run would say the run had reached them and found nothing.
  const midRun = { read: 400, raw: 900, collapsed: 210, stored: 40, held: 12, ignored: 3 };
  const reached = (key) => midRun[key] != null;
  assert.equal(reached('read'), true);
  assert.equal(reached('collapsed'), true);
  assert.equal(reached('thin'), false);
  assert.equal(reached('waiting'), false);
});

// --- opening a stage -------------------------------------------------------

test('where the recorded count and the list disagree, the count stands and the list says so', () => {
  // This test used to assert the opposite, and asserted a bug: it let a short
  // list overwrite a larger recorded figure and call the result exact. On a
  // repeat run the two disagree for a good reason — the funnel counted every
  // word that passed through, the list holds the ones first raised then — and
  // silently reporting the smaller number loses the run's own measurement.
  const s = stageOf({ stage: 'collapsed', funnel: { collapsed: 9999 }, places: 40, items: ['a', 'b'] });
  assert.equal(s.count, 9999);
  assert.equal(s.listed, 2);
  assert.equal(s.exact, false);
  assert.equal(s.recorded, true);
});

test('places read is a count and never a list', () => {
  const s = stageOf({ stage: 'read', funnel: null, places: 39, items: [] });
  assert.equal(s.count, 39);
  assert.equal(s.recorded, true);
});

test('a stage the run did not record is unknown, not empty', () => {
  // Nought here would read as "nothing came through", which is the one thing
  // it does not mean.
  const s = stageOf({ stage: 'raw', funnel: null, places: 39, items: [] });
  assert.equal(s.count, null);
  assert.equal(s.recorded, false);
});

test('words out is never listed, however much the run recorded', () => {
  // The mentions are read out of rented text in memory and never written down.
  const s = stageOf({ stage: 'raw', funnel: { raw: 1480 }, places: 620, items: [] });
  assert.equal(s.count, 1480);
  assert.equal(LISTABLE.has('raw'), false);
});

// --- alive, stalled, or neither --------------------------------------------

test('a finished run is done however long ago it was touched', () => {
  assert.equal(livenessOf({ finished_at: '2026-09-01T00:00:00Z', touched_at: null }), 'done');
});

test('a run touched a moment ago is running', () => {
  const now = Date.now();
  assert.equal(livenessOf({ finished_at: null, touched_at: new Date(now - 1000).toISOString() }, now), 'running');
});

test('a run nothing has touched for a long time is stalled, not finished', () => {
  // Every deploy restarts the process a sweep lives inside, so an interrupted
  // run keeps `status = running` for ever. Reading status alone made the live
  // panel claim a sweep was going — with a red Stop beside it — for half an
  // hour after it died.
  const now = Date.now();
  const cold = new Date(now - STALL_AFTER_MS - 1000).toISOString();
  assert.equal(livenessOf({ finished_at: null, touched_at: cold }, now), 'stalled');
});

test('stalled is its own answer and never becomes finished', () => {
  // We do not know how it ended; we know only that nothing has touched it.
  // Calling it finished would invent a result.
  const now = Date.now();
  const cold = new Date(now - STALL_AFTER_MS - 1).toISOString();
  assert.notEqual(livenessOf({ finished_at: null, touched_at: cold }, now), 'done');
});

test('a run from before the heartbeat falls back to when it started', () => {
  // `touched_at` is null on every row written before migration 239, and an old
  // run was last known alive when it began — which correctly reads as long
  // stalled rather than as touched just now.
  const now = Date.now();
  const old = new Date(now - 60 * 60 * 1000).toISOString();
  assert.equal(livenessOf({ finished_at: null, touched_at: null, started_at: old }, now), 'stalled');
});

test('a repeat run keeps its recorded count and says what the list is', () => {
  // `first_seen` never moves, so a word a second harvest saw again belongs to
  // the run that first found it — while the funnel counted it passing through
  // this one. The list must not quietly replace the count with a smaller
  // number and call it exact (Codex, 21 Sep 2026).
  const s = stageOf({ stage: 'collapsed', funnel: { collapsed: 4330 }, places: 868, items: ['a', 'b', 'c'] });
  assert.equal(s.count, 4330);
  assert.equal(s.listed, 3);
  assert.equal(s.exact, false);
});

test('a first run lists everything it counted', () => {
  const s = stageOf({ stage: 'collapsed', funnel: { collapsed: 3 }, places: 10, items: ['a', 'b', 'c'] });
  assert.equal(s.count, 3);
  assert.equal(s.exact, true);
});

test('a listable stage on a run with no funnel falls back to its list', () => {
  const s = stageOf({ stage: 'held', funnel: null, places: 10, items: ['a', 'b'] });
  assert.equal(s.count, 2);
  assert.equal(s.recorded, true);
});
