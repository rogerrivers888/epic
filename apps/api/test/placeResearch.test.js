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
  // A pipeline that reports source steps and returns a found record.
  const run = async (ref, opts) => {
    assert.equal(opts.paid, true, 'the button is a paid pass');
    assert.equal(opts.force, true, 'the button means "look now"');
    opts.onStep({ source: 'open-map', state: 'checking' });
    opts.onStep({ source: 'open-map', state: 'found', ref: 'node/42' });
    opts.onStep({ source: 'venue-site', state: 'nothing' });
    // `enrich` returns `fields` as a count and `provenance` as which field came
    // from where; `kept.have` is read from provenance.
    return { state: 'done', fields: 4, provenance: { name: 'osm', summary: 'wikipedia', address: 'nominatim', opening_hours: 'site' }, problems: [] };
  };

  const out = await runResearchStream({ ref: `${PREFIX}kept`, householdId: 'hh1', sessionId: 's1', send, run });

  const events = frames.map((f) => f.event);
  assert.deepEqual(events, ['start', 'source', 'source', 'source', 'kept', 'done']);
  // The kept frame reports what our record now holds, as ticks, read from provenance.
  const kept = frames.find((f) => f.event === 'kept').data;
  assert.equal(kept.state, 'done');
  assert.equal(kept.have.name, true);
  assert.equal(kept.have.what_it_is, true, 'a summary is "what it is"');
  assert.equal(kept.have.where_to_go, true, 'an address is "where to go"');
  assert.equal(kept.have.hours, true, 'an opening answer is "when it\'s open"');
  // Reading Google reviews for spotting is deferred to the verification answerer
  // (it cannot use googleSource.get while that carries C57's status sink), so the
  // stream emits no reviews pass yet.
  assert.ok(!frames.some((f) => f.event === 'source' && f.data.source === 'reviews'), 'no reviews pass yet');
  assert.equal(out.state, 'done');
});

test('the quote reserves the worst case and never under-reserves', async () => {
  // A google: ref with no website held: reserve the identify brief and the
  // page-find (both Pro) and one review read — so the reservation always covers
  // what the pipeline can spend, rather than under-reserving an identify that
  // seedFor still makes.
  const bare = await quoteResearch(`${PREFIX}bare`);
  assert.equal(bare.off, false);
  assert.deepEqual(bare.breakdown, { identify: 1, findPage: 1, reviews: 0 });
  assert.ok(bare.pence > 0);

  // Once we hold a website, the page-find drops off; identify and the review read
  // stay reserved for the Google id.
  await query(
    `insert into place_records (venue_ref, website) values ($1, 'https://example.com')
     on conflict (venue_ref) do update set website = 'https://example.com'`,
    [`${PREFIX}withsite`]);
  const withSite = await quoteResearch(`${PREFIX}withsite`);
  assert.deepEqual(withSite.breakdown, { identify: 1, findPage: 0, reviews: 0 });
  assert.ok(withSite.pence < bare.pence, 'holding a website costs less to research');

  // A non-google ref with no stored match makes no Google call at all — it seeds
  // from its own record and looks for a page via a Claude search (its own
  // budget), so nothing is reserved against the Google ceiling here.
  const osm = await quoteResearch('osm:way/123_research_test');
  assert.deepEqual(osm.breakdown, { identify: 0, findPage: 0, reviews: 0 });
  assert.equal(osm.pence, 0);
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
