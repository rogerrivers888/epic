/**
 * Back office › Saved places and Photo review (owner, 2 Oct 2026, Parts 2–3):
 * the summary withholds its rates until a pass has finished; Compare calls
 * Google only on the click, ledgers it as admin.photo_compare and stores
 * nothing; a verdict is one of three, and both need the owner signed in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { savedPlacesRouter, photoReviewRouter } = await import('../src/routes/savedPlaces.js');
const { googleSource } = await import('../src/sources/google.js');
const { runAsAccount } = await import('../src/context.js');

test.after(() => pool.end());

let HH;
test.before(async () => {
  ({ rows: [{ id: HH }] } = await query(`insert into households (name) values ('photo review test') returning id`));
});

async function serve({ elevated = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.access = { doors: ['admin'], capabilities: new Set(['view_library', 'manage_library']), isOwner: true, role: null, elevated };
    req.session = { id: null };
    runAsAccount({ id: null, email: 'roger@epic.day', household_id: HH }, next);
  });
  app.use('/saved', savedPlacesRouter);
  app.use('/review', photoReviewRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  return { base, close: () => new Promise((d) => s.close(d)) };
}

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('the summary says nothing until a pass has finished, then gives its rates', async () => {
  await query(`delete from saved_place_enrichment`);
  const { base, close } = await serve();
  try {
    const empty = await (await fetch(`${base}/saved`)).json();
    assert.equal(empty.summary.done, 0);
    assert.equal(empty.summary.websitePct, null, 'withheld, not nought');
    assert.equal(empty.summary.avgCostPence, null);
    const a = `google:sum-${randomUUID()}`; const b = `google:sum-${randomUUID()}`;
    await query(`insert into saved_place_enrichment (venue_ref, household_id, state, last_cost_usd, cost_usd, found) values
      ($1, $3, 'done', 0.10, 0.10, '{"fields":{"website":{"value":"https://a.example/","source":"site"}},"pictures":{"openverse":{"stored":1}}}'),
      ($2, $3, 'done', 0.06, 0.06, '{"fields":{"website":{"value":null,"source":"unknown"}},"pictures":{}}')`, [a, b, HH]);
    const two = await (await fetch(`${base}/saved`)).json();
    assert.equal(two.summary.done, 2);
    assert.equal(two.summary.websitePct, 50, 'an unknown website is not a found one');
    assert.equal(two.summary.ownedImagePct, 50);
    assert.equal(two.summary.avgCostPence, 6.3, '$0.08 average at the ledger rate');
  } finally { await close(); }
});

test('Compare asks Google on the click, ledgers it, keeps nothing; a verdict is one of three', async () => {
  const ref = `google:cmp-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Compared Place', '{}')`, [ref]);
  const original = googleSource.photos;
  let asked = 0;
  googleSource.photos = async (_id, { meter } = {}) => { asked += 1; if (meter) meter['google-pro'] = 1; return [{ ref: 'places/x/photos/1', attribution: 'A' }]; };
  const { base, close } = await serve();
  try {
    const before = asked;
    await fetch(`${base}/review?q=Compared`);
    assert.equal(asked, before, 'listing places never calls Google');
    const res = await post(`${base}/review/compare`, { ref });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(asked, before + 1);
    assert.equal(body.google[0].ref, 'places/x/photos/1');
    const { rows: ledger } = await query(`select purpose from provider_calls where purpose = 'admin.photo_compare' and venue_ref = $1`, [ref]);
    assert.equal(ledger.length, 1, 'ledgered under its own purpose');
    const { rows: stored } = await query(`select count(*)::int as n from image_assets where source_ref like 'places/x/%'`);
    assert.equal(stored[0].n, 0, 'Google photographs are never stored');

    assert.equal((await post(`${base}/review/verdict`, { ref, verdict: 'lovely' })).status, 400);
    const ok = await post(`${base}/review/verdict`, { ref, verdict: 'owned_worse_acceptable', note: 'darker' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).verdict, 'owned_worse_acceptable');
  } finally { googleSource.photos = original; await close(); }
});

test('an agent or shared session can read but cannot compare, verdict or re-run', async () => {
  const { base, close } = await serve({ elevated: false });
  try {
    assert.equal((await fetch(`${base}/saved`)).status, 200);
    for (const [path, body] of [['/review/compare', { ref: 'google:x' }], ['/review/verdict', { ref: 'google:x', verdict: 'owned_fine' }], ['/saved/rerun', { ref: 'google:x' }]]) {
      const res = await post(`${base}${path}`, body);
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).error, 'needs_personal_sign_in');
    }
  } finally { await close(); }
});
