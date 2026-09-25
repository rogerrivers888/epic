/**
 * A sweep told not to spend must not spend.
 *
 * `enrich` takes `paid`, and the comment at the website lead says what it is
 * for: "a pass run to fill in what kind of place something is has no business
 * spending on either" (owner, 8 Sep 2026, "no provider spend"). The flag
 * stopped the website lead and the web search — and did not reach `seedFor`,
 * which turns a bare Google place ID back into a name and a point with one
 * Place Details request. That request bills at Pro, 3.2p, once per place.
 *
 * Two callers already pass `paid: false` (`routes/placeIndex.js` and the
 * catch-up queue in `own.js`), so this was live spend, not a hypothetical: a
 * twenty-place drawer swept "for free" cost £0.64, and the data policy's "no
 * paid research pass per place in V1" was broken by the callers written to
 * obey it.
 *
 * Unpaid and unidentified is a real outcome, not a failure — the record says
 * we could not ask, and asks again when the place is claimed or a display
 * search has given us its point for nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

// Its own database, built from the migrations, before anything that opens a
// pool is imported. The first version of this file imported `db.js` directly
// and ran — for four days — against the development database, which is what
// the helper exists to prevent, and which showed the moment a migration
// added a column the development database did not have (25 Sep 2026).
const { query, pool } = await testDatabase();
const { googleSource } = await import('../src/sources/google.js');
const { noteFault } = await import('../src/sources/meter.js');
const own = await import('../src/sources/own.js');

/**
 * `enrich` writes a record for the ref it is given, which is the point of it.
 * Each test here uses a fresh ref so the runs cannot interfere, and that means
 * they would otherwise pile up a row per run for ever (Codex, 21 Sep 2026).
 * They share one prefix so the clean-up can name them exactly.
 */
const PREFIX = 'google:ChIJ_own_free_sweep_test_';
const ref = (what) => `${PREFIX}${what}_${Date.now()}`;

test.after(async () => {
  await query('delete from place_records where venue_ref like $1', [`${PREFIX}%`]).catch(() => null);
  await pool.end();
});

/**
 * Count what the research asks Google, with nothing else allowed out.
 *
 * Two things had to be arranged for this to mean anything.
 *
 * The key has to be present, or `sourceHasKey('google')` short-circuits the
 * gate before it ever reaches the flag and every assertion here holds whatever
 * the code does — which is what the first version of this file did. `brief` is
 * swapped out, so the key is only ever a gate and no Google request is made.
 *
 * And the rest of the research has to be stopped at the door. `enrich` goes on
 * to ask Overpass, Nominatim and Wikipedia, none of which this file is about;
 * left alone they made a three-assertion test two minutes long, and made it
 * depend on three services being up (Codex, 21 Sep 2026). `fetch` is the one
 * road out of the process for all of them, so stubbing it closes every one at
 * once — and keeps the test honest about what it is measuring, which is a
 * decision taken before any of that happens.
 */
const countingBriefs = async (run) => {
  const wasBrief = googleSource.brief;
  const wasKey = process.env.GOOGLE_MAPS_API_KEY;
  const wasFetch = globalThis.fetch;
  let asked = 0;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key-never-sent';
  googleSource.brief = async () => { asked += 1; return { name: 'Bought', lat: 51.5, lng: -0.1, website: null }; };
  // Nothing answers, which is a state the research already knows how to hold:
  // it records that it could not ask rather than that the place said no.
  globalThis.fetch = async () => { throw new Error('no network in this test'); };
  try { await run(); return asked; } finally {
    googleSource.brief = wasBrief;
    globalThis.fetch = wasFetch;
    if (wasKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = wasKey;
  }
};

test('a free sweep does not buy a place ID back from Google', async () => {
  // A bare Google ref with nothing of ours behind it — the exact case that
  // reaches for the brief.
  const asked = await countingBriefs(() => own.enrich(ref('bare_free'), { force: true, paid: false }));
  assert.equal(asked, 0, 'paid: false must reach seedFor, not stop at the website lead');
});

test('a paid pass still identifies a place it has nothing of its own on', async () => {
  // The guard is the flag, not the removal of the capability: research that is
  // allowed to spend still turns an ID into something searchable.
  const asked = await countingBriefs(() => own.enrich(ref('bare_paid'), { force: true, paid: true }));
  assert.ok(asked >= 1, 'a paid pass may still ask what the place is');
});

test('a paid pass may be told to identify a place and still never go searching the web for it', async () => {
  // The research sweep's promise is two Google requests at most. A claimed
  // place with no website anywhere is the one case `enrich` would go further
  // — a Claude web search, neither in the estimate nor under the ceiling —
  // so the sweep switches that off separately (Codex, 25 Sep 2026).
  //
  // The search itself is stubbed at `own.web.search`, not left to the stubbed
  // `fetch`: the SDK never saw that stub, so this test used to measure whether
  // a Claude key happened to be in the environment, and read a gate that had
  // silently said no as "no network" (owner, 25 Sep 2026: stub the call).
  // Counting the stub is what makes the assertion name the right thing when
  // it fails — the gate, not the weather.
  const wasKey = process.env.ANTHROPIC_API_KEY;
  const wasSearch = own.web.search;
  process.env.ANTHROPIC_API_KEY = 'test-key-never-sent';
  let searches = 0;
  own.web.search = async () => { searches += 1; throw new Error('no network in this test'); };
  try {
    const r = ref('claimed_no_search');
    await query(`insert into households (id, name) values ('00000000-0000-4000-8000-0000000c1a1d', 'Test claimants') on conflict (id) do nothing`);
    await query(`insert into place_claims (household_id, venue_ref, reason) values ('00000000-0000-4000-8000-0000000c1a1d', $1, 'test') on conflict do nothing`, [r]);
    let out;
    await countingBriefs(async () => { out = await own.enrich(r, { force: true, paid: true, search: false, seed: { name: 'Nowhere Cafe', lat: 51.5, lng: -0.1 } }); });
    assert.equal(searches, 0, 'the search was never attempted');
    assert.equal((out.problems ?? []).some((p) => /looking for their page/.test(p)), false, 'and nothing says it was');
    await countingBriefs(async () => { out = await own.enrich(r, { force: true, paid: true, seed: { name: 'Nowhere Cafe', lat: 51.5, lng: -0.1 } }); });
    assert.equal(searches, 1, 'with search allowed it goes, once');
    assert.equal((out.problems ?? []).some((p) => /looking for their page: no network in this test/.test(p)), true, 'and with no network it says so, in those words');
    // Answered NONE: written down as looked-and-nothing, which is what stops
    // the next pass paying to look again.
    own.web.search = async () => { searches += 1; return { text: 'NONE', searches: 1, stopReason: 'end_turn' }; };
    await countingBriefs(async () => { out = await own.enrich(r, { force: true, paid: true, seed: { name: 'Nowhere Cafe', lat: 51.5, lng: -0.1 } }); });
    assert.equal(searches, 2);
    assert.ok((out.problems ?? []).some((p) => /no website found for it anywhere/.test(p)), 'nothing found is an answer');
  } finally {
    own.web.search = wasSearch;
    if (wasKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = wasKey;
    await query(`delete from place_claims where venue_ref like $1`, [`${PREFIX}%`]).catch(() => null);
  }
});

test('an identification that fails is still on the ledger, against the place', async () => {
  // The sweep reads its cost and the ceiling its headroom from provider_calls.
  // A request that went out and threw, or came back with no point, was billed
  // and used to vanish because only the successful branch recorded it
  // (Codex, 25 Sep 2026).
  const r = ref('brief_threw');
  const wasBrief = googleSource.brief;
  const wasKey = process.env.GOOGLE_MAPS_API_KEY;
  const wasFetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key-never-sent';
  globalThis.fetch = async () => { throw new Error('no network in this test'); };
  googleSource.brief = async (_id, { meter }) => { meter.google = 1; meter['google-pro'] = 1; noteFault(meter, 'http_503'); throw new Error('Google Places 503'); };
  try {
    await own.enrich(r, { force: true, paid: true });
    const { rows } = await query(`select purpose, ok, failed, fault from provider_calls where venue_ref = $1 and purpose = 'own.seed'`, [r]);
    assert.equal(rows.length, 1, 'the attempt is recorded, with the place on it');
    // And recorded as the failure it was. The meter's faults live under
    // Symbol keys; stringified on the way to the ledger they were lost, and
    // a billed failure arrived as a call nobody had observed (Codex, 25 Sep
    // 2026). `brief` in this test notes the fault the way `call()` does.
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].failed, 1);
    assert.equal(rows[0].fault, 'http_503');
  } finally {
    googleSource.brief = wasBrief;
    globalThis.fetch = wasFetch;
    if (wasKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = wasKey;
    await query('delete from provider_calls where venue_ref like $1', [`${PREFIX}%`]).catch(() => null);
  }
});

test('a seeded place costs nothing to research for free, and one request to research paid', async () => {
  // How the sweep is meant to be scoped: take the places the atlas or
  // `place_records` already names, hand them over as the seed, and `seedFor`
  // returns without asking anybody anything.
  //
  // A paid pass on the same place still buys *one* request, and a different
  // one — the website lead, which is how we find their own page to read. So
  // the two flags are not the same lever: the seed decides whether we have to
  // buy an identification, and `paid` decides whether we may buy a way in to
  // their page. Free and seeded is the only combination that spends nothing.
  const seed = { name: 'Aberdulais Falls', lat: 51.6, lng: -3.8 };
  const free = await countingBriefs(() => own.enrich(ref('seeded_free'), { force: true, paid: false, seed }));
  assert.equal(free, 0, 'seeded and unpaid is the free sweep');

  const paid = await countingBriefs(() => own.enrich(ref('seeded_paid'), { force: true, paid: true, seed }));
  assert.equal(paid, 1, 'the website lead, not a second identification');
});

test('the hygiene register is asked once there is a postcode, and what it says is kept for good', async () => {
  // Owner, 25 Sep 2026: the reference set keeps every fact the owned sources
  // hold, FSA included. Open government data, retention indefinite.
  const r = ref('hygiene');
  const wasFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (/api\.ratings\.food\.gov\.uk/.test(String(url))) {
      return new Response(JSON.stringify({ establishments: [{ FHRSID: 4242, BusinessName: 'Nowhere Cafe', PostCode: 'SL5 9JH', RatingValue: '4', RatingDate: '2025-01-02T00:00:00', SchemeType: 'FHRS' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('no network in this test');
  };
  try {
    await own.enrich(r, { force: true, paid: false, seed: { name: 'Nowhere Cafe', lat: 51.5, lng: -0.1, postcode: 'SL5 9JH' } });
    const { rows } = await query(`select field, value, retention, expires_at from place_facts where venue_ref = $1 and source = 'fsa' order by field`, [r]);
    assert.deepEqual(rows.map((x) => [x.field, x.value, x.retention, x.expires_at]), [
      ['fsa_id', '4242', 'indefinite', null],
      ['fsa_rated_at', '2025-01-02', 'indefinite', null],
      ['fsa_rating', '4', 'indefinite', null],
    ]);
    const { rows: [rec] } = await query('select fsa_rating, fsa_id, provenance from place_records where venue_ref = $1', [r]);
    assert.equal(rec.fsa_rating, '4');
    assert.equal(rec.provenance.fsa_rating, 'fsa', 'the record says where it came from');
  } finally {
    globalThis.fetch = wasFetch;
    await query('delete from place_facts where venue_ref like $1', [`${PREFIX}%`]).catch(() => null);
  }
});

test('a hygiene register that cannot be reached has not withdrawn what it said', async () => {
  // Reference research replaces every source's facts — but only with an
  // answer. A timeout is not one (Codex, 25 Sep 2026).
  const r = ref('hygiene_kept');
  await query(`insert into place_facts (venue_ref, field, source, value, licence, retention, confidence, expires_at) values ($1, 'fsa_rating', 'fsa', '"5"', 'OGL v3.0', 'indefinite', 1, null) on conflict do nothing`, [r]);
  const wasFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no network in this test'); };
  try {
    await own.enrich(r, { force: true, replace: true, paid: false, seed: { name: 'Nowhere Cafe', lat: 51.5, lng: -0.1, postcode: 'SL5 9JH' } });
    const { rows } = await query(`select value from place_facts where venue_ref = $1 and source = 'fsa' and field = 'fsa_rating'`, [r]);
    assert.deepEqual(rows.map((x) => x.value), ['5'], 'still held');
  } finally {
    globalThis.fetch = wasFetch;
    await query('delete from place_facts where venue_ref like $1', [`${PREFIX}%`]).catch(() => null);
  }
});
