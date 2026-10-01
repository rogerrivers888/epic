// "Research this place": the stream's shape, the cost quote, and the licence
// line that reviews are read in memory and nothing is stored from them.
//
// The pipeline itself (`own.js` enrich) has its own tests; here `run` and the
// Google adapter are injected, so this is about the orchestration — the frames
// it emits, the worst-case it quotes, and that a review pass is attributed but
// stores nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

// A key so `googleSource.enabled()` is true for the quote; never sent anywhere,
// because the adapter is injected in the streaming tests and the quote makes no
// call.
process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'test-key-never-sent';

const { query, pool } = await testDatabase();
const { sse, runResearchStream, quoteResearch, rectFromCenter, runRanked } = await import('../src/routes/placeResearch.js');

const PREFIX = 'google:ChIJ_research_test_';
test.after(async () => {
  await query('delete from place_records where venue_ref like $1', [`${PREFIX}%`]);
  await pool.end();
});

test('one frame is a named event and its JSON payload', () => {
  assert.equal(sse('done', { state: 'done' }), 'event: done\ndata: {"state":"done"}\n\n');
  assert.equal(sse('waiting'), 'event: waiting\ndata: {}\n\n');
});

test('the stream relays each source step, then what we kept, then done', async () => {
  const frames = [];
  const send = (event, data) => frames.push({ event, data });
  // A pipeline that reports two source steps and returns a found record.
  const run = async (ref, opts) => {
    assert.equal(opts.paid, true, 'the button is a paid pass');
    assert.equal(opts.force, true, 'the button means "look now"');
    opts.onStep({ source: 'open-map', state: 'checking' });
    opts.onStep({ source: 'open-map', state: 'found', ref: 'node/42' });
    opts.onStep({ source: 'venue-site', state: 'nothing' });
    return { state: 'done', fields: { name: 'Windsor Great Park', summary: 'A royal park.', address: 'Windsor', opening_hours: 'Dawn to dusk' }, problems: [] };
  };
  let recorded = null;
  const google = { enabled: () => true, get: async (id, { meter }) => { meter.google = 1; meter['google-details'] = 1; return { reviews: [{}, {}, {}], reviewSummary: 'Lovely.' }; } };
  const recordCall = async (...args) => { recorded = args; };

  const out = await runResearchStream({ ref: `${PREFIX}kept`, householdId: 'hh1', sessionId: 's1', send, run, google, recordCall });

  const events = frames.map((f) => f.event);
  assert.deepEqual(events, ['start', 'source', 'source', 'source', 'kept', 'source', 'source', 'done']);
  // The kept frame reports what our record now holds, as ticks.
  const kept = frames.find((f) => f.event === 'kept').data;
  assert.equal(kept.state, 'done');
  assert.equal(kept.have.name, true);
  assert.equal(kept.have.what_it_is, true, 'a summary is "what it is"');
  assert.equal(kept.have.where_to_go, true, 'an address is "where to go"');
  assert.equal(kept.have.hours, true, '"Dawn to dusk" is a known opening answer');
  // The reviews pass ran in memory, was attributed to the ledger, and reported
  // itself as spotting-only with verification pending — nothing stored.
  const reviews = frames.filter((f) => f.event === 'source' && f.data.source === 'reviews');
  assert.equal(reviews.length, 2, 'checking then found');
  assert.equal(reviews[1].data.state, 'found');
  assert.equal(reviews[1].data.read, 3);
  assert.equal(reviews[1].data.verification, 'pending');
  assert.ok(recorded, 'the review call is on the ledger');
  assert.equal(recorded[2], 'admin.places.research.reviews');
  assert.equal(out.state, 'done');
});

test('no Google id means no review pass, and the rest still streams', async () => {
  const frames = [];
  const send = (event, data) => frames.push({ event, data });
  const run = async (_ref, opts) => { opts.onStep({ source: 'open-map', state: 'nothing' }); return { state: 'partial', fields: {}, problems: ['no match in OpenStreetMap'] }; };
  // enabled but never asked, because there is no id to read reviews by.
  let asked = false;
  const google = { enabled: () => true, get: async () => { asked = true; return {}; } };
  // A non-google ref with no stored match resolves to no id (matchesFor returns
  // an empty map here — nothing seeded).
  await runResearchStream({ ref: `${PREFIX}noid`.replace('google:', 'osm:'), householdId: 'hh1', sessionId: 's1', send, run, google, recordCall: async () => {} });
  assert.equal(asked, false, 'no id, no review call');
  assert.ok(frames.some((f) => f.event === 'done'));
  assert.ok(!frames.some((f) => f.event === 'source' && f.data.source === 'reviews'));
});

test('the quote is the worst case, minus what is plainly not needed', async () => {
  // A place we hold Google's id for (a google: ref) and no website: no identify
  // call, one page-find, one review read.
  const noSite = await quoteResearch(`${PREFIX}nosite`);
  assert.equal(noSite.off, false);
  assert.deepEqual(noSite.breakdown, { identify: 0, findPage: 1, reviews: 1 });
  assert.ok(noSite.pence > 0);

  // The same place once we hold a website: the page-find drops off.
  await query(
    `insert into place_records (venue_ref, website) values ($1, 'https://example.com')
     on conflict (venue_ref) do update set website = 'https://example.com'`,
    [`${PREFIX}withsite`]);
  const withSite = await quoteResearch(`${PREFIX}withsite`);
  assert.deepEqual(withSite.breakdown, { identify: 0, findPage: 0, reviews: 1 });
  assert.ok(withSite.pence < noSite.pence, 'holding a website costs less to research');
});

test('a rectangle around a point spans the radius and is capped at 50km', () => {
  const box = rectFromCenter({ lat: 51.5, lng: -0.6, radiusKm: 30 });
  assert.ok(box.maxLat > box.minLat && box.maxLng > box.minLng);
  // ~30km north-south is about 0.27 degrees of latitude.
  assert.ok(Math.abs((box.maxLat - box.minLat) / 2 - 30 / 111.32) < 1e-6);
  const huge = rectFromCenter({ lat: 51.5, lng: -0.6, radiusKm: 5000 });
  assert.ok((huge.maxLat - huge.minLat) / 2 <= 50 / 111.32 + 1e-9, 'radius is capped at Google\'s 50km');
});

test('the ranked list numbers from `from`, threads the page token, and keeps names for display only', async () => {
  const calls = [];
  const slice = async (args) => {
    calls.push(args);
    return { places: [{ id: 'g1', name: 'One', primaryType: 'park' }, { id: 'g2', name: 'Two', primaryType: 'museum' }], nextPageToken: 'TOK2', requests: 1, problem: null };
  };
  // First page.
  const p1 = await runRanked({ lat: 51.5, lng: -0.6, radiusKm: 30, query: 'parks', from: 0, slice });
  assert.deepEqual(p1.places.map((p) => p.rank), [1, 2]);
  assert.equal(p1.places[0].name, 'One');
  assert.equal(p1.nextPageToken, 'TOK2');
  // The box was computed from the centre and handed to the slice.
  assert.ok(calls[0].box && Number.isFinite(calls[0].box.minLat));
  assert.equal(calls[0].query, 'parks');

  // Next page carries the count on and threads Google's token.
  const p2 = await runRanked({ lat: 51.5, lng: -0.6, from: 20, pageToken: 'TOK2', slice });
  assert.deepEqual(p2.places.map((p) => p.rank), [21, 22]);
  assert.equal(calls[1].pageToken, 'TOK2');
});
