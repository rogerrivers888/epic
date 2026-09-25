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
import { googleSource } from '../src/sources/google.js';
import { pool, query } from '../src/db.js';

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
  const wasKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key-never-sent';
  try {
    const r = ref('claimed_no_search');
    await query(`insert into households (id, name) values ('00000000-0000-4000-8000-0000000c1a1d', 'Test claimants') on conflict (id) do nothing`);
    await query(`insert into place_claims (household_id, venue_ref, reason) values ('00000000-0000-4000-8000-0000000c1a1d', $1, 'test') on conflict do nothing`, [r]);
    let out;
    await countingBriefs(async () => { out = await own.enrich(r, { force: true, paid: true, search: false, seed: { name: 'Nowhere Cafe', lat: 51.5, lng: -0.1 } }); });
    assert.equal((out.problems ?? []).some((p) => /looking for their page/.test(p)), false, 'the search was never attempted');
    await countingBriefs(async () => { out = await own.enrich(r, { force: true, paid: true, seed: { name: 'Nowhere Cafe', lat: 51.5, lng: -0.1 } }); });
    assert.equal((out.problems ?? []).some((p) => /looking for their page|could not go looking/.test(p)), true, 'with search allowed it goes, and with no network it says so');
  } finally {
    if (wasKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = wasKey;
    await query(`delete from place_claims where venue_ref like $1`, [`${PREFIX}%`]).catch(() => null);
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
