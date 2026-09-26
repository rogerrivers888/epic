/**
 * Every paid Google request is attributed or refused (sources/paidGate.js).
 *
 * Owner, 26 Sep 2026 (G7): "call() in google.js and routing.js refuses any
 * paid tier with no household AND no real session. Only exemption: the
 * IDs-only census." And, for done: "a test proving an unattributed paid call
 * is refused." These are that test, for Places, photos and Routes, beside the
 * exemption and the switch Routes now shares — plus the two decisions that go
 * with it: own.js researches free unless a caller says otherwise, and Settings
 * shows the bound the guard enforces.
 *
 * `fetch` is stubbed throughout and counts what would have gone out: the
 * assertion that matters in each refusal is that the count is nought.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { googleSource, fetchPhoto } = await import('../src/sources/google.js');
const { routeMatrixMinutes, routingEnabled } = await import('../src/sources/routing.js');
const { runAsSpender } = await import('../src/context.js');
const { healthOf } = await import('../src/sources/meter.js');
const { setOffKeys, offKeysList } = await import('../src/sources/switches.js');
const { serviceSessionId } = await import('../src/repositories/providerCalls.js');
const own = await import('../src/sources/own.js');
const { allowanceUsage } = await import('../src/sources/usage.js');

const HH = '00000000-0000-4000-8000-0000000a7e01';
let SIGNED_IN = null;
let SERVICE = null;

test.before(async () => {
  await query(`insert into households (id, name) values ($1, 'Gate household') on conflict (id) do nothing`, [HH]);
  await query(`insert into accounts (household_id, email, role, status, plan, monthly_call_bound) values ($1, 'gate@test', 'owner', 'active', 'family', 1234)`, [HH]);
  ({ rows: [{ id: SIGNED_IN }] } = await query(
    `insert into api_sessions (token_hash, label, expires_at, kind) values ('test:paid-gate', 'a phone', now() + interval '1 day', 'device')
     on conflict (token_hash) do update set label = excluded.label, kind = 'device' returning id`));
  SERVICE = await serviceSessionId();
});
test.after(async () => {
  await query('delete from provider_calls where household_id = $1', [HH]);
  await query('delete from accounts where household_id = $1', [HH]);
  await query('delete from households where id = $1', [HH]);
  await pool.end();
});

const withGoogle = async (run) => {
  const wasKey = process.env.GOOGLE_MAPS_API_KEY; const wasFetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key-never-sent';
  let out = 0;
  globalThis.fetch = async (url) => {
    out += 1;
    if (String(url).includes('/media')) return new Response(Buffer.from('jpeg'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    if (String(url).includes('routes.googleapis.com')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { return await run(() => out); } finally {
    globalThis.fetch = wasFetch;
    if (wasKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = wasKey;
  }
};

const refused = (e) => e.code === 'unattributed_paid_call';

test('an unattributed paid Places call is refused before it goes out, and the meter says why', async () => {
  await withGoogle(async (out) => {
    // Nobody at all: the shape of a script run with `node` in the container.
    const meter = {};
    await assert.rejects(() => googleSource.brief('ChIJ_nobody', { meter }), refused);
    // A household but the server's own session: the shape of a boot loop.
    await assert.rejects(() => runAsSpender({ householdId: HH, sessionId: SERVICE }, () => googleSource.brief('ChIJ_loop', { meter: {} })), refused);
    // A household and no session at all.
    await assert.rejects(() => runAsSpender({ householdId: HH }, () => googleSource.brief('ChIJ_nosession', { meter: {} })), refused);
    // A sign-in and no household.
    await assert.rejects(() => runAsSpender({ sessionId: SIGNED_IN }, () => googleSource.brief('ChIJ_nohousehold', { meter: {} })), refused);
    assert.equal(out(), 0, 'not one request left the process');
    assert.match(JSON.stringify(healthOf(meter)), /unattributed/);
    assert.equal(meter.google ?? 0, 0, 'a refused request is not on the meter as one Google billed');
  });
});

test('a household and a signed-in session are let through', async () => {
  await withGoogle(async (out) => {
    await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => googleSource.brief('ChIJ_attributed', { meter: {} }));
    assert.equal(out(), 1);
  });
});

test('the IDs Only census is the one exemption: free, and on nobody’s behalf', async () => {
  await withGoogle(async (out) => {
    const meter = {};
    await googleSource.censusSlice({ box: { minLat: 51.4, minLng: -0.7, maxLat: 51.41, maxLng: -0.69 }, includedType: 'park', pages: 1, meter });
    assert.equal(out(), 1, 'the slice went out with no household and no session');
    assert.equal(meter['google-essentials'], 1);
  });
});

test('a photograph is refused on nobody’s behalf and fetched on somebody’s', async () => {
  await withGoogle(async (out) => {
    await assert.rejects(() => fetchPhoto('places/ChIJ_x/photos/nobody'), refused);
    assert.equal(out(), 0);
    const got = await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => fetchPhoto('places/ChIJ_x/photos/somebody'));
    assert.ok(got?.body);
    assert.equal(out(), 1);
  });
});

test('Routes is refused unattributed, charged per element, and under the Google switch', async () => {
  const one = [{ lat: 51.4, lng: -0.6 }];
  const two = [{ lat: 51.41, lng: -0.61 }, { lat: 51.42, lng: -0.62 }];
  await withGoogle(async (out) => {
    await assert.rejects(() => routeMatrixMinutes({ origins: one, destinations: two, meter: {}, purpose: 'test.refused' }), refused);
    assert.equal(out(), 0);
    const rowsFor = async (purpose) => (await query('select units, session_id from provider_calls where purpose = $1', [purpose])).rows;
    assert.equal((await rowsFor('test.refused')).length, 0, 'a refused request is not on the ledger as one Google billed');

    await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => routeMatrixMinutes({ origins: one, destinations: two, meter: {}, purpose: 'test.matrix' }));
    assert.equal(out(), 1);
    const [row] = await rowsFor('test.matrix');
    assert.deepEqual(row?.units, { 'google-routes': 2 }, 'written by the door, one per origin × destination element');
    assert.equal(row.session_id, SIGNED_IN);

    const was = offKeysList();
    setOffKeys([...was, 'google']);
    try {
      assert.equal(routingEnabled(), false);
      assert.equal(await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => routeMatrixMinutes({ origins: one, destinations: two })), null);
      assert.equal(out(), 1, 'switched off, nothing went out');
    } finally { setOffKeys(was); }
  });
});

test('own.js researches free unless a caller says it may pay', async () => {
  await withGoogle(async (out) => {
    // A household and a real session, so the door would let it through —
    // the point is that the default never knocks.
    await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => own.enrich('google:ChIJ_free_default', { householdId: HH, force: true }));
    const google = (await query(`select count(*)::int as n from provider_calls where household_id = $1 and purpose in ('own.seed', 'own.lead') and estimated_cost_usd > 0`, [HH])).rows[0].n;
    assert.equal(google, 0, 'no paid research on the default');
    void out;
  });
});

test('Settings shows the bound the guard enforces, not the estate default', async () => {
  const { allowances } = await allowanceUsage(HH);
  assert.equal(allowances['google-paid'].limit, 1234, 'the account’s own number');
  assert.ok(allowances.claude.limit <= 1234, 'Claude’s budget never above the account’s number');
});

test('Claude’s budget is its own default where no account has set a number', async () => {
  // Codex, 26 Sep 2026: the Google default is not a ceiling on Claude.
  const { claudeBoundFor, HOUSEHOLD_MONTHLY_CLAUDE_BOUND } = await import('../src/claude.js');
  const bare = '00000000-0000-4000-8000-0000000a7e03';
  await query(`insert into households (id, name) values ($1, 'No account') on conflict (id) do nothing`, [bare]);
  try {
    assert.equal(await claudeBoundFor(bare), HOUSEHOLD_MONTHLY_CLAUDE_BOUND);
    assert.equal(await claudeBoundFor(HH), Math.min(1234, HOUSEHOLD_MONTHLY_CLAUDE_BOUND));
  } finally { await query('delete from households where id = $1', [bare]); }
});

test('a Routes request whose caller writes nothing still reaches the ledger, so a restart cannot forget it', async () => {
  const { directions } = await import('../src/sources/routing.js');
  await withGoogle(async (out) => {
    await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => directions({ from: { lat: 51.4, lng: -0.6 }, to: { lat: 51.5, lng: -0.1 } }));
    assert.equal(out(), 1);
    const { rows: [row] } = await query(
      `select units, session_id from provider_calls where household_id = $1 and purpose = 'routes.route' order by created_at desc limit 1`, [HH]);
    assert.deepEqual(row?.units, { 'google-routes': 1 });
    assert.equal(row.session_id, SIGNED_IN);
  });
});

test('a photo link is signed again for whoever it is sent to', async () => {
  const { stampPhoto, restampForSpender, spenderForLink } = await import('../src/sources/photoLinks.js');
  const OTHER = '00000000-0000-4000-8000-0000000a7e04';
  // Cached by the first household's search…
  const cached = runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => ({ venue: { photos: [stampPhoto({ ref: 'places/x/photos/cached' })] } }));
  // …and served to another (Codex, 26 Sep 2026).
  const served = runAsSpender({ householdId: OTHER, sessionId: SIGNED_IN }, () => restampForSpender(cached));
  const photo = served.venue.photos[0];
  assert.notEqual(photo.sig, cached.venue.photos[0].sig);
  assert.equal(spenderForLink({ s: photo.sig }).householdId, OTHER);
  assert.equal(spenderForLink({ s: cached.venue.photos[0].sig }).householdId, HH, 'the cached copy is not changed in place');
});

test('a paid request from the drawer upgrades a free job already waiting', () => {
  // Codex, 26 Sep 2026: the loop's free job swallowed the drawer's paid one.
  const line = [{ venueRef: 'google:a', householdId: HH }, { venueRef: 'google:b', householdId: HH }];
  assert.equal(own.upgradeWaiting(line, 'google:b', { householdId: HH, paid: true, force: true }, SIGNED_IN), true);
  assert.deepEqual(line[1], { venueRef: 'google:b', householdId: HH, paid: true, force: true, sessionId: SIGNED_IN });
  assert.equal(own.upgradeWaiting(line, 'google:a', { householdId: HH }, SIGNED_IN), false, 'a free ask changes nothing');
  assert.equal(line[0].paid, undefined);
});

test('a photo that fails after it was admitted is still on the ledger', async () => {
  // Codex, 26 Sep 2026: the row was written only on success.
  const wasKey = process.env.GOOGLE_MAPS_API_KEY; const wasFetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key-never-sent';
  globalThis.fetch = async () => new Response('slow', { status: 504 });
  try {
    const before = (await query(`select count(*)::int as n from provider_calls where household_id = $1 and purpose = 'photo'`, [HH])).rows[0].n;
    await assert.rejects(() => runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => fetchPhoto('places/x/photos/fails')));
    const after = (await query(`select count(*)::int as n from provider_calls where household_id = $1 and purpose = 'photo'`, [HH])).rows[0].n;
    assert.equal(after, before + 1);
  } finally {
    globalThis.fetch = wasFetch;
    if (wasKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = wasKey;
  }
});

test('the Google paid line on Settings is the guard’s own count, for any period and by month', async () => {
  // Codex, 26 Sep 2026: rows that say only {google: n} were counted by the
  // guard and left off the screen, and the monthly series had nothing at all.
  const { usageBetween, usageByMonth } = await import('../src/sources/usage.js');
  const { countGoogleThisMonth } = await import('../src/repositories/providerCalls.js');
  await query(`insert into provider_calls (household_id, session_id, provider, purpose, units, estimated_cost_usd) values ($1, $2, 'google', 'test.generic', '{"google": 3}'::jsonb, 0.096)`, [HH, SIGNED_IN]);
  const { lines } = await usageBetween(HH, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
  assert.equal(lines['google-paid'].units, await countGoogleThisMonth(HH));
  const series = await usageByMonth(HH, 3);
  assert.equal(series.lines['google-paid'].at(-1).units, await countGoogleThisMonth(HH));
});

test('a revoked or expired session stops spending, even through a link it signed', async () => {
  // Codex, 26 Sep 2026: the check looked only at the kind of session.
  const { rows: [{ id: gone }] } = await query(
    `insert into api_sessions (token_hash, label, expires_at, revoked_at) values ('test:paid-gate-revoked', 'signed out', now() + interval '1 day', now())
     on conflict (token_hash) do update set revoked_at = now() returning id`);
  const { rows: [{ id: old }] } = await query(
    `insert into api_sessions (token_hash, label, expires_at) values ('test:paid-gate-expired', 'expired', now() - interval '1 minute')
     on conflict (token_hash) do update set expires_at = now() - interval '1 minute' returning id`);
  await withGoogle(async (out) => {
    for (const sessionId of [gone, old]) {
      await assert.rejects(() => runAsSpender({ householdId: HH, sessionId }, () => googleSource.brief('ChIJ_gone', { meter: {} })), refused);
    }
    assert.equal(out(), 0);
  });
});

test('two paid requests arriving together cannot both take the last of the allowance', async () => {
  // Codex, 26 Sep 2026: the corridor's two matrices under one Promise.all.
  const TIGHT = '00000000-0000-4000-8000-0000000a7e05';
  await query(`insert into households (id, name) values ($1, 'Tight household') on conflict (id) do nothing`, [TIGHT]);
  await query(`insert into accounts (household_id, email, role, status, plan, monthly_call_bound) values ($1, 'tight@test', 'member', 'active', 'family', 3)`, [TIGHT]);
  try {
    await withGoogle(async (out) => {
      const one = [{ lat: 51.4, lng: -0.6 }];
      const two = [{ lat: 51.41, lng: -0.61 }, { lat: 51.42, lng: -0.62 }];
      const results = await runAsSpender({ householdId: TIGHT, sessionId: SIGNED_IN }, () => Promise.allSettled([
        routeMatrixMinutes({ origins: one, destinations: two, purpose: 'test.race' }),
        routeMatrixMinutes({ origins: one, destinations: two, purpose: 'test.race' }),
      ]));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'two elements each against a bound of three: one fits');
      assert.equal(out(), 1);
    });
  } finally {
    await query('delete from provider_calls where household_id = $1', [TIGHT]);
    await query('delete from accounts where household_id = $1', [TIGHT]);
    await query('delete from households where id = $1', [TIGHT]);
  }
});

// ---------------------------------------------------------------------------
// G8: agent sessions spend nothing unless granted; the estate's daily ceiling.
// ---------------------------------------------------------------------------

const agentSession = async (tok, grantHours = 0) => (await query(
  `insert into api_sessions (token_hash, label, expires_at, kind, paid_grant_until)
   values ($1, 'epic-xx some agent', now() + interval '1 day', 'agent', case when $2::int > 0 then now() + make_interval(hours => $2::int) end)
   on conflict (token_hash) do update set kind = 'agent', paid_grant_until = excluded.paid_grant_until returning id`, [tok, grantHours])).rows[0].id;

test('an agent session is refused paid Google and Claude calls until it is granted hours', async () => {
  const { forgetSession } = await import('../src/sources/paidGate.js');
  const { assertWithinBounds } = await import('../src/claude.js');
  const agent = await agentSession('test:paid-gate-agent');
  await withGoogle(async (out) => {
    const meter = {};
    await assert.rejects(() => runAsSpender({ householdId: HH, sessionId: agent }, () => googleSource.brief('ChIJ_agent', { meter })), refused);
    assert.match(JSON.stringify(healthOf(meter)), /agent_session/);
    await assert.rejects(() => runAsSpender({ householdId: HH, sessionId: agent }, () => assertWithinBounds({ householdId: HH, sessionId: null })), refused);
    assert.equal(out(), 0);

    await query(`update api_sessions set paid_grant_until = now() + interval '1 hour' where id = $1`, [agent]);
    forgetSession(agent);
    await runAsSpender({ householdId: HH, sessionId: agent }, () => googleSource.brief('ChIJ_agent_granted', { meter: {} }));
    assert.equal(out(), 1, 'granted, it goes out');
  });
});

test('a session is a device only from a real browser naming itself the way the app does', async () => {
  const { sessionKindFor } = await import('../src/auth.js');
  const chrome = { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' } };
  const headless = { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0 Safari/537.36' } };
  const curl = { headers: { 'user-agent': 'curl/8.7.1' } };
  assert.equal(sessionKindFor(chrome, 'Computer · Chrome'), 'device');
  assert.equal(sessionKindFor(chrome, 'epic-f0 edge census'), 'agent', 'a label the app never writes');
  assert.equal(sessionKindFor(chrome, null), 'agent');
  assert.equal(sessionKindFor(headless, 'Computer · Chrome'), 'agent', 'a headless browser copying the label');
  assert.equal(sessionKindFor(curl, 'Computer · Chrome'), 'agent');
  assert.equal(sessionKindFor({ headers: {} }, 'Phone · Safari'), 'agent', 'no user agent at all');
  assert.equal(sessionKindFor(chrome, 'Sam · invited to Cornwall', { onAccount: true }), 'device', 'a person on their own account');
  assert.equal(sessionKindFor(curl, null, { onAccount: true }), 'agent');
});

test('the daily ceiling refuses at 100%, and raises each alarm once', async () => {
  const { assertUnderDailyCeiling, raiseAlarm, todayStatus } = await import('../src/sources/dailyCeiling.js');
  const was = process.env.EPIC_DAILY_SPEND_CEILING_GBP;
  await query(`delete from spend_alarms where day = (now() at time zone 'Europe/London')::date`);
  try {
    const spent = (await todayStatus({ fresh: true })).spentGbp;
    // Just above today's spend: under the ceiling, past 80% of it.
    process.env.EPIC_DAILY_SPEND_CEILING_GBP = String(spent / 0.9 + 0.0001);
    await query(`insert into provider_calls (household_id, session_id, provider, purpose, estimated_cost_usd) values ($1, $2, 'google', 'test.ceiling', 0)`, [HH, SIGNED_IN]);
    const warn = await todayStatus({ fresh: true });
    if (spent > 0) assert.equal(warn.level, 'warn');
    const sent = [];
    const send = async (m) => { sent.push(m); return { sent: true }; };
    process.env.EPIC_ALARM_EMAIL = 'alarm@test';
    assert.equal((await raiseAlarm({ level: 'warn', spentGbp: 8, ceilingGbp: 10 }, { send })).raised, true);
    assert.equal((await raiseAlarm({ level: 'warn', spentGbp: 9, ceilingGbp: 10 }, { send })).raised, false, 'once a day');
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /80% of the daily ceiling/);

    // At the ceiling: refused, at the door and before Claude.
    process.env.EPIC_DAILY_SPEND_CEILING_GBP = '0.0000001';
    await todayStatus({ fresh: true });
    await query(`insert into provider_calls (household_id, session_id, provider, purpose, estimated_cost_usd) values ($1, $2, 'google', 'test.ceiling', 0.01)`, [HH, SIGNED_IN]);
    await todayStatus({ fresh: true });
    await assert.rejects(() => assertUnderDailyCeiling(), (e) => e.code === 'daily_ceiling_reached');
    await withGoogle(async (out) => {
      await assert.rejects(() => runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => googleSource.brief('ChIJ_ceiling', { meter: {} })), (e) => e.code === 'daily_ceiling_reached');
      assert.equal(out(), 0);
    });
  } finally {
    if (was === undefined) delete process.env.EPIC_DAILY_SPEND_CEILING_GBP; else process.env.EPIC_DAILY_SPEND_CEILING_GBP = was;
    delete process.env.EPIC_ALARM_EMAIL;
    await query(`delete from spend_alarms where day = (now() at time zone 'Europe/London')::date`);
    await query(`delete from provider_calls where purpose = 'test.ceiling'`);
    const { todayStatus: t } = await import('../src/sources/dailyCeiling.js');
    await t({ fresh: true });
  }
});

test('the call that crosses the line raises the alarm itself', async () => {
  // Codex, 26 Sep 2026: the alarm was looked for only before the next paid call.
  const { record } = await import('../src/repositories/providerCalls.js');
  const { todayStatus } = await import('../src/sources/dailyCeiling.js');
  const was = process.env.EPIC_DAILY_SPEND_CEILING_GBP;
  await query(`delete from spend_alarms where day = (now() at time zone 'Europe/London')::date`);
  try {
    const spent = (await todayStatus({ fresh: true })).spentGbp;
    // One Enterprise search (4 cents) takes the day past the ceiling.
    process.env.EPIC_DAILY_SPEND_CEILING_GBP = String(spent + 0.01);
    await runAsSpender({ householdId: HH, sessionId: SIGNED_IN }, () => record(HH, 'google', 'test.crossing', { google: 1, 'google-search': 1 }));
    let levels = [];
    for (let i = 0; i < 40 && !levels.includes('stop'); i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      levels = (await query(`select level from spend_alarms where day = (now() at time zone 'Europe/London')::date`)).rows.map((r) => r.level);
    }
    assert.ok(levels.includes('stop'), 'raised by the write, with no further call');
  } finally {
    if (was === undefined) delete process.env.EPIC_DAILY_SPEND_CEILING_GBP; else process.env.EPIC_DAILY_SPEND_CEILING_GBP = was;
    await query(`delete from spend_alarms where day = (now() at time zone 'Europe/London')::date`);
    await query(`delete from provider_calls where purpose = 'test.crossing'`);
    await todayStatus({ fresh: true });
  }
});

test('the agent list holds the last 24 hours and any live grant, and says how many there are in all', async () => {
  // Owner, 26 Sep 2026: "Trim the Agent sessions panel to sessions seen in the
  // last 24 hours, with a link to show all."
  const { liveAgentSessions } = await import('../src/repositories/sessions.js');
  const make = (tok, seen, grant = false) => query(
    `insert into api_sessions (token_hash, label, kind, expires_at, last_seen_at, created_at, paid_grant_until)
     values ($1, $1, 'agent', now() + interval '30 days', now() - $2::interval, now() - interval '40 days', case when $3 then now() + interval '1 hour' end)
     on conflict (token_hash) do update set last_seen_at = excluded.last_seen_at, paid_grant_until = excluded.paid_grant_until`,
    [tok, seen, grant]);
  await make('test:agents-recent', '1 hour');
  await make('test:agents-old', '5 days');
  await make('test:agents-old-granted', '5 days', true);
  try {
    const labels = (out) => out.sessions.map((s) => s.label);
    const recent = await liveAgentSessions();
    assert.ok(labels(recent).includes('test:agents-recent'));
    assert.ok(!labels(recent).includes('test:agents-old'), 'not seen for five days');
    assert.ok(labels(recent).includes('test:agents-old-granted'), 'a live grant can always be taken away');
    const every = await liveAgentSessions({ all: true });
    assert.ok(labels(every).includes('test:agents-old'));
    assert.equal(recent.total, every.total);
    assert.equal(every.sessions.length, every.total);
  } finally {
    await query(`delete from api_sessions where token_hash like 'test:agents-%'`);
  }
});
