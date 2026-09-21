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
import { pool } from '../src/db.js';

const own = await import('../src/sources/own.js');

test.after(() => pool.end());

/**
 * Count what the research asks Google.
 *
 * The key has to be present or the gate short-circuits before it reaches the
 * flag, and every assertion here would pass for the wrong reason — which is
 * exactly what happened the first time this was written. `brief` is swapped
 * out, so the key is only ever a gate and no request leaves the machine.
 */
const countingBriefs = async (run) => {
  const wasBrief = googleSource.brief;
  const wasKey = process.env.GOOGLE_MAPS_API_KEY;
  let asked = 0;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key-never-sent';
  googleSource.brief = async () => { asked += 1; return { name: 'Bought', lat: 51.5, lng: -0.1, website: null }; };
  try { await run(); return asked; } finally {
    googleSource.brief = wasBrief;
    if (wasKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = wasKey;
  }
};

test('a free sweep does not buy a place ID back from Google', async () => {
  // A bare Google ref with nothing of ours behind it — the exact case that
  // reaches for the brief.
  const ref = `google:ChIJ_free_sweep_${Date.now()}`;
  const asked = await countingBriefs(() => own.enrich(ref, { force: true, paid: false }));
  assert.equal(asked, 0, 'paid: false must reach seedFor, not stop at the website lead');
});

test('a paid pass still identifies a place it has nothing of its own on', async () => {
  // The guard is the flag, not the removal of the capability: research that is
  // allowed to spend still turns an ID into something searchable.
  const ref = `google:ChIJ_paid_sweep_${Date.now()}`;
  const asked = await countingBriefs(() => own.enrich(ref, { force: true, paid: true }));
  assert.ok(asked >= 1, 'a paid pass may still ask what the place is');
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
  const free = await countingBriefs(() => own.enrich(`google:ChIJ_seeded_free_${Date.now()}`, { force: true, paid: false, seed }));
  assert.equal(free, 0, 'seeded and unpaid is the free sweep');

  const paid = await countingBriefs(() => own.enrich(`google:ChIJ_seeded_paid_${Date.now()}`, { force: true, paid: true, seed }));
  assert.equal(paid, 1, 'the website lead, not a second identification');
});
