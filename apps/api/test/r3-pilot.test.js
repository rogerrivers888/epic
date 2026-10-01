import { test } from 'node:test';
import assert from 'node:assert/strict';

// The SL5 pilot and the pre-warm (round 3, agent PILOT, 29 Sep 2026): the
// ring's top 20 a category plus the reference set, through Spot (in memory),
// the researcher, Verify and answerPlace; resumable place by place; a paid
// refusal stops the run rather than spinning; and the drawer and the pre-warm
// feed the pipeline on real opens. A database of this file's own.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const pilot = await import('../src/desk/pilot.js');
const pipeline = await import('../src/desk/pipeline.js');
const { UnattributedCallError } = await import('../src/sources/paidGate.js');

test.after(() => pool.end());

const HH = '00000000-0000-4000-8000-00000000a1a1';
const CELL = 'PILOT1';

async function seed() {
  await query(`insert into households (id, name) values ($1, 'Pilot household') on conflict (id) do nothing`, [HH]);
  const { rows: [s] } = await query(
    `insert into api_sessions (token_hash, label, expires_at, kind) values ('test:pilot:' || gen_random_uuid()::text, 'a phone', now() + interval '1 day', 'device') returning id`);
  await query(`delete from pilot_runs where cell = $1`, [CELL]);
  await query(`delete from ring_rankings where cell = $1`, [CELL]);
  await query(`delete from ring_counts where cell = $1`, [CELL]);
  await query(`insert into ring_counts (cell, mode, minutes, category, places, unresolved, floor) values ($1, 'driving', 30, '', 0, 0, false), ($1, 'driving', 30, 'active', 25, 0, false), ($1, 'driving', 30, 'food', 2, 0, false)`, [CELL]);
  for (let i = 1; i <= 25; i += 1) {
    await query(`insert into ring_rankings (cell, mode, minutes, category, venue_ref, epic_score, rank) values ($1, 'driving', 30, 'active', $2, 50, $3)`, [CELL, `google:pilot-a${i}`, i]);
  }
  await query(`insert into ring_rankings (cell, mode, minutes, category, venue_ref, epic_score, rank) values ($1, 'driving', 30, 'food', 'google:pilot-a1', 50, 1), ($1, 'driving', 30, 'food', 'google:pilot-f2', 40, 2)`, [CELL]);
  await query(`delete from research_sweeps where started_by = 'pilot-test'`);
  const { rows: [sw] } = await query(`insert into research_sweeps (params, started_by, state) values ('{"mode":"reference"}', 'pilot-test', 'done') returning id`);
  await query(`insert into research_sweep_places (sweep_id, venue_ref, subcategory, tier) values ($1, 'google:pilot-a2', 'x', 'top'), ($1, 'google:pilot-ref1', 'x', 'top')`, [sw.id]);
  return s.id;
}

/** A researcher that writes the venue's own page, as own.enrich would, and says what it was asked. */
function fakeEnrich(asked) {
  return async (ref, opts) => {
    asked.push({ ref, paid: opts.paid, search: opts.search, seed: opts.seed });
    await query(`insert into place_facts (venue_ref, field, source, value, licence, retention) values ($1, 'body', 'site', to_jsonb('Clean toilets on site. Sadly no parking.'::text), 'own', 'keep')
                 on conflict (venue_ref, field, source) do update set value = excluded.value`, [ref]);
    return { state: 'done' };
  };
}

const REVIEW = 'The toilets were spotless and the wave machine was great fun.';

test('picks the ring’s top 20 a category plus the reference places not already picked, each once', async () => {
  await seed();
  const out = await pilot.pickPlaces({ cell: CELL, minutes: 30 });
  const refs = out.places.map((p) => p.venueRef);
  assert.equal(new Set(refs).size, refs.length, 'each place once');
  assert.equal(out.places.filter((p) => p.pickedFor === 'ring').length, 21, '20 active + 1 food not already picked');
  assert.ok(!refs.includes('google:pilot-a21'), 'rank 21 is not picked');
  assert.deepEqual(out.places.find((p) => p.venueRef === 'google:pilot-a1').categories, ['active', 'food']);
  assert.ok(out.places.find((p) => p.venueRef === 'google:pilot-a2').categories.includes('reference'));
  assert.equal(out.reference, 1);
  assert.ok(refs.includes('google:pilot-ref1'));
});

test('an uncounted ring is counted first (free), and one that ranks nothing fails with its reason, not a zero', async () => {
  await seed();
  let counted = 0;
  const out = await pilot.runPilot({
    householdId: HH, cell: 'PILOT-EMPTY', minutes: 30, paid: false, wait: true,
    deps: { refreshRing: async () => { counted += 1; }, enrich: async () => ({}) },
  });
  assert.equal(counted, 1);
  assert.equal(out.run.run.state, 'failed');
  assert.match(out.run.run.why, /could not be counted|ranks nothing/);
  await query(`delete from pilot_runs where cell = 'PILOT-EMPTY'`);
});

test('a paid run buys one detail a place, spots in memory, researches with the seed, verifies and answers — and keeps no review text', async () => {
  const session = await seed();
  const detailed = [];
  const asked = [];
  const out = await pilot.runPilot({
    householdId: HH, sessionId: session, cell: CELL, minutes: 30, paid: true, who: 'pilot@test', wait: true, top: 2,
    deps: {
      standing: async () => 'may_spend',
      detail: async (id, { meter }) => {
        detailed.push(id);
        meter['google-details'] = 1; meter.google = 1;
        return { name: `Place ${id}`, lat: 51.4, lng: -0.6, category: 'museum', reviews: [{ text: REVIEW }, { text: 'Toilets were clean.' }], aiSummary: null, reviewSummary: 'People like the toilets.' };
      },
      enrich: fakeEnrich(asked),
    },
  });
  const s = out.run;
  assert.equal(s.run.state, 'done');
  // top 2 active (a1, a2), food f2 (a1 already), reference ref1 (a2 already)
  assert.equal(s.run.places, 4);
  assert.equal(detailed.length, 4, 'one Place Details request a place');
  assert.ok(asked.every((a) => a.paid === true && a.search === true && a.seed?.name), 'researched paid, seeded from the detail in memory');
  const { rows: [a] } = await query(`select state, source from place_fact_answers where venue_ref = 'google:pilot-a1' and attribute_key = 'toilets'`);
  assert.deepEqual(a, { state: 'yes', source: 'site' });
  const { rows: sugg } = await query(`select 1 from fact_suggestions where venue_ref = 'google:pilot-a1' and feature = 'toilets'`);
  assert.equal(sugg.length, 0, 'the suggestion was verified and cleared');
  const { rows: places } = await query(`select outcome::text as o from pilot_places p join pilot_runs r on r.id = p.run_id where r.cell = $1`, [CELL]);
  for (const p of places) {
    assert.ok(!p.o.includes('spotless') && !p.o.includes('People like'), 'no review or summary text is kept');
    assert.ok(!p.o.includes('Place google'), 'no rented name is kept either');
  }
  const t = s.totals;
  assert.equal(t.detailsBought, 4);
  assert.ok(t.verified >= 4, 'toilets verified at each place');
  assert.ok(t.no >= 4, 'parking: the venue says no');
  assert.ok(s.byCategory.some((c) => c.category === 'reference' && c.places === 2));
  const details = s.requests.byMeter.find((m) => m.meter === 'google-details');
  assert.equal(details?.requests, 4, 'the ledger rows are the run’s own');
  assert.ok(s.requests.listGbp > 0);
  assert.equal(s.requests.billedGbp, null, 'can’t speak until the billing export attributes the rows');
  assert.deepEqual(s.notDerived.facts, ['suits-ages', 'duration', 'cost-band']);
  // Once billing has attributed the rows, each row's pounds count once however many meters it carries.
  await query(`update provider_calls set billed_gbp = 0.01, units = units || '{"google-pro":1,"pro-details":1}'::jsonb where purpose = 'pilot.detail' and venue_ref = any($1)`,
    [['google:pilot-a1', 'google:pilot-a2', 'google:pilot-f2', 'google:pilot-ref1']]);
  const again = await pilot.status(s.run.id);
  assert.equal(again.requests.rows, 4);
  assert.equal(again.requests.billedGbp, 0.04);
  assert.equal(again.requests.billedSays, 'billing has reached every row');
  assert.equal(typeof again.requests.estimateGbp, 'number');
  const { rows: [ch] } = await query(`select area, what from bo_changes where subject_type = 'pilot_run' and subject_id = $1`, [s.run.id]);
  assert.deepEqual(ch, { area: 'Fact automations', what: `Pilot run · ${CELL} · 4 places` });
});

test('an agent session with no grant waits before spending anything, and a refusal mid-run stops at once and resumes where it stopped', async () => {
  const session = await seed();
  let calls = 0;
  const first = await pilot.runPilot({
    householdId: HH, sessionId: session, cell: CELL, paid: true, wait: true, top: 2,
    deps: { standing: async () => 'agent', detail: async () => { calls += 1; }, enrich: async () => ({}) },
  });
  assert.equal(first.run.run.state, 'waiting');
  assert.equal(first.run.run.why, 'waiting for a paid grant');
  assert.equal(calls, 0, 'nothing was asked of Google');

  // Granted — but the grant is withdrawn under the run on the second place.
  const asked = [];
  const second = await pilot.runPilot({
    householdId: HH, sessionId: session, cell: CELL, paid: true, wait: true, top: 2,
    deps: {
      standing: async () => 'may_spend',
      detail: async (id, { meter }) => {
        calls += 1;
        if (calls >= 2) throw new UnattributedCallError('an agent session with no paid budget granted');
        meter['google-details'] = 1;
        return { name: 'x', lat: 51, lng: 0, reviews: [] };
      },
      enrich: fakeEnrich(asked),
    },
  });
  assert.equal(second.resumed, true, 'the same run, resumed');
  assert.equal(second.run.run.id, first.run.run.id);
  assert.equal(second.run.run.state, 'waiting');
  assert.equal(second.run.run.why, 'waiting for a paid grant');
  assert.equal(calls, 2, 'stopped on the refusal — no spin');
  assert.equal(second.run.run.done, 1);

  const third = await pilot.runPilot({
    householdId: HH, sessionId: session, cell: CELL, paid: true, wait: true, top: 2,
    deps: { standing: async () => 'may_spend', detail: async (id, { meter }) => { meter['google-details'] = 1; return { name: 'x', lat: 51, lng: 0, reviews: [] }; }, enrich: fakeEnrich(asked) },
  });
  assert.equal(third.run.run.id, first.run.run.id);
  assert.equal(third.run.run.state, 'done');
  assert.equal(third.run.run.done, 4);
  assert.equal(asked.filter((a) => a.ref === 'google:pilot-a1').length, 1, 'a place done is not done again');
});

test('the pre-warm is the same runner, free: no detail, research with paid off', async () => {
  await seed();
  const asked = [];
  let detail = 0;
  const out = await pilot.runPilot({
    householdId: HH, cell: CELL, paid: false, wait: true, top: 2,
    deps: { detail: async () => { detail += 1; }, enrich: fakeEnrich(asked), standing: async () => 'agent' },
  });
  assert.equal(out.run.run.state, 'done');
  assert.equal(detail, 0);
  assert.ok(asked.length === 3 && asked.every((a) => a.paid === false && a.search === false), 'the ring alone: no reference set on a pre-warm');
  assert.equal(out.run.totals.detailsBought, 0);
  const { rows: [ch] } = await query(`select what from bo_changes where subject_type = 'pilot_run' and subject_id = $1`, [out.run.run.id]);
  assert.equal(ch.what, `Pre-warm · ${CELL} · 3 places`);
});

test('the sign-up pre-warm answers a place again once its free research has landed', async () => {
  await query(`delete from ring_rankings where cell = 'PILOT-PW'`);
  await query(`insert into ring_rankings (cell, mode, minutes, category, venue_ref, epic_score, rank) values ('PILOT-PW', 'driving', 30, 'active', 'google:pilot-pw1', 50, 1)`);
  await query(`delete from place_facts where venue_ref = 'google:pilot-pw1'`);
  await query(`delete from place_fact_answers where venue_ref = 'google:pilot-pw1'`);
  const landed = [];
  await pipeline.prewarm({
    cell: 'PILOT-PW',
    research: (ref, opts) => {
      // The research lands a moment later, after the first answer has read nothing.
      setTimeout(async () => {
        await query(`insert into place_facts (venue_ref, field, source, value, licence, retention) values ($1, 'body', 'site', to_jsonb('Toilets on site.'::text), 'own', 'keep')`, [ref]);
        landed.push(ref);
        opts?.onDone?.({ state: 'done' });
      }, 50);
    },
  });
  await pipeline.drained();
  await new Promise((r) => setTimeout(r, 150));
  await pipeline.drained();
  assert.deepEqual(landed, ['google:pilot-pw1']);
  const { rows: [a] } = await query(`select state from place_fact_answers where venue_ref = 'google:pilot-pw1' and attribute_key = 'toilets'`);
  assert.equal(a?.state, 'yes', 'answered from the research that landed');
});

test('a drawer open with review text queues Verify, and a real answer lands from our own page', async () => {
  const express = (await import('express')).default;
  const { places } = await import('../src/routes/places.js');
  const { rememberVenues } = await import('../src/sources/index.js');
  await query(`insert into households (id, name) values ($1, 'Pilot household') on conflict (id) do nothing`, [HH]);
  const ref = 'fixtures:pilot-drawer';
  await query(`delete from place_fact_answers where venue_ref = $1`, [ref]);
  await query(`delete from fact_suggestions where venue_ref = $1`, [ref]);
  await query(`insert into place_facts (venue_ref, field, source, value, licence, retention) values ($1, 'body', 'site', to_jsonb('We have a sauna and a steam room.'::text), 'own', 'keep')
               on conflict (venue_ref, field, source) do update set value = excluded.value`, [ref]);
  await query(`insert into place_attributes (key, label, kind, active) values ('pilot-sauna', 'Sauna', 'yesno', true) on conflict (key) do update set active = true`);
  pipeline.forgetVocabulary();
  rememberVenues([{ source: 'fixtures', sourcePlaceId: 'pilot-drawer', name: 'Pilot Spa', category: 'museum', reviews: [{ text: 'The sauna was lovely.' }], aiSummary: 'A spa with a sauna.' }]);
  const app = express();
  app.use(express.json());
  app.use('/places', places);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/places/detail?ref=${encodeURIComponent(ref)}`);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body).slice(0, 200));
    await pipeline.drained();
    const { rows: [a] } = await query(`select state, source, evidence_quote from place_fact_answers where venue_ref = $1 and attribute_key = 'pilot-sauna'`, [ref]);
    assert.equal(a?.state, 'yes', 'spotted, verified from the venue’s page');
    assert.equal(a.source, 'site');
    const { rows: [c] } = await query(`select outcome from fact_checks where venue_ref = $1 and attribute_key = 'pilot-sauna' order by at desc limit 1`, [ref]);
    assert.equal(c.outcome, 'verified', 'Verification counts it');
  } finally {
    await new Promise((r) => s.close(r));
  }
});

test('POST /pilot needs manage_settings and starts for the caller’s household and session; GET reports it', async () => {
  const express = (await import('express')).default;
  const { deskRoutes } = await import('../src/routes/desk.js');
  const session = await seed();
  const serve = (caps, elevated = false) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // Starting the pilot needs personal sign-in now (G11): the owner serve is elevated.
      req.access = { doors: ['admin'], capabilities: new Set(caps), isOwner: false, role: null, elevated };
      req.account = { email: 'pilot@test', household_id: HH };
      req.session = { id: session };
      next();
    });
    app.use('/desk', deskRoutes);
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
    const s = app.listen(0);
    return new Promise((r) => s.once('listening', () => r({ url: `http://127.0.0.1:${s.address().port}/desk`, close: () => new Promise((d) => s.close(d)) })));
  };
  const viewer = await serve(['view_library']);
  try {
    const refused = await fetch(`${viewer.url}/pilot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cell: 'PILOT-NONE', paid: false }) });
    assert.equal(refused.status, 403);
  } finally { await viewer.close(); }
  const owner = await serve(['view_library', 'manage_settings'], true);
  try {
    const bad = await fetch(`${owner.url}/pilot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cell: 'PILOT-NONE', minutes: 45 }) });
    assert.equal(bad.status, 400);
    // A ring with nothing ranked: the run fails at once with its reason, and nothing is researched.
    await query(`delete from pilot_runs where cell = 'PILOT-NONE'`);
    await query(`insert into ring_counts (cell, mode, minutes, category, places, unresolved, floor) values ('PILOT-NONE', 'driving', 30, '', 0, 0, false) on conflict do nothing`);
    const res = await fetch(`${owner.url}/pilot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cell: 'PILOT-NONE', paid: false }) });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.run.run.state, 'failed');
    assert.match(body.run.run.why, /ranks nothing/);
    const { rows: [r] } = await query(`select household_id, session_id from pilot_runs where id = $1`, [body.run.run.id]);
    assert.deepEqual(r, { household_id: HH, session_id: session });
    const got = await (await fetch(`${owner.url}/pilot?run=${body.run.run.id}`)).json();
    assert.equal(got.run.id, body.run.run.id);
  } finally { await owner.close(); }
});

test('a place whose paid research was refused stays pending, and the resume does it again', async () => {
  const session = await seed();
  const refusing = async (ref) => ({ state: 'failed', problems: [`${ref}: a paid provider call was refused`] });
  const first = await pilot.runPilot({
    householdId: HH, sessionId: session, cell: CELL, paid: true, wait: true, top: 2,
    deps: { standing: async () => 'may_spend', detail: async (id, { meter }) => { meter['google-details'] = 1; return { name: 'x', lat: 51, lng: 0, reviews: [] }; }, enrich: refusing },
  });
  assert.equal(first.run.run.state, 'waiting');
  assert.equal(first.run.run.done, 0, 'the refused place is not counted done');
  const asked = [];
  const again = await pilot.runPilot({
    householdId: HH, sessionId: session, cell: CELL, paid: true, wait: true, top: 2,
    deps: { standing: async () => 'may_spend', detail: async (id, { meter }) => { meter['google-details'] = 1; return { name: 'x', lat: 51, lng: 0, reviews: [] }; }, enrich: fakeEnrich(asked) },
  });
  assert.equal(again.run.run.state, 'done');
  assert.ok(asked.some((a) => a.ref === 'google:pilot-a1'), 'the refused place was researched on the resume');
});
