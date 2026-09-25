/**
 * The research sweep: twenty places a drawer, researched from what we may keep.
 *
 * The owner's one exception to "no paid research pass per place in V1"
 * (25 Sep 2026): pay once — a Place Details request to turn a census ID into
 * a name and a point, sometimes a second to find their page — to build the
 * vocabulary that is then asked of hundreds of thousands of places for free.
 * The enrichment sweep the rule was written for is still forbidden; this is
 * the exception, and CLAUDE.md records it as one with what it cost.
 *
 * Why it is a row and a list rather than a request: the feature pass before
 * it lived inside one HTTP request and was killed thirty-two drawers in by a
 * peer's push redeploying the service. This one writes each place as it is
 * done, heartbeats while it runs, and is picked up at boot if the process it
 * lived in died — the same shape as `resumeCollections`.
 *
 * Who it spends through: the collection ceiling (`roomToSpend`), reserved a
 * batch at a time and released as soon as the batch is known, exactly as
 * Collect does. And it refuses to start unless it is handed the request count
 * its own estimate reported — the gate every paid run here uses.
 */

import { query, withTransaction } from '../db.js';
import { pickSample, SAMPLE } from '../domain/questions.js';
import { PRICE_PER_UNIT_USD, USD_TO_GBP } from '../domain/providerPrices.js';
import * as own from './own.js';
import { roomToSpend, releaseSpend } from '../routes/placeIndex.js';

/** A drawer with fewer census places than this is not worth a question set. */
export const FLOOR = 100;
/** How many places one drawer gives: twelve at the top, eight from the mid-tail. */
export const SIZE = SAMPLE.top + SAMPLE.mid;
/** The most Google requests one place can cost: identify it, then find its page. */
export const REQUESTS_PER_PLACE = 2;
/** Places claimed at a time. Small, so a deploy in the middle loses little. */
export const BATCH = 4;
/** A sweep nobody has heard from for this long is stranded, whatever its row says. */
export const STRANDED_AFTER_MS = 10 * 60_000;

/**
 * How long one place may hold the sweep.
 *
 * `enrich` awaits the open map, the venue's own page and the encyclopedias,
 * and not all of those have a timeout of their own. Awaited directly it
 * bypassed the deadline `own.js`'s queue puts round the same call — and the
 * sweep's heartbeat kept `touched_at` fresh, so a place that never settled
 * held the sweep for the life of the process while recovery saw nothing
 * wrong (Codex, 25 Sep 2026). Generous, because a real pass takes the better
 * part of a minute; it is a deadlock guard, not a performance budget.
 */
export const PLACE_DEADLINE_MS = Number(process.env.EPIC_ENRICH_TIMEOUT_MS || 120_000);

/** Whichever comes first: the answer, or giving up on this place. */
function withDeadline(promise, ms) {
  let timer = null;
  const bell = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`gave up after ${Math.round(ms / 1000)}s`), { code: 'deadline' })), ms);
    timer.unref?.();
  });
  return Promise.race([promise, bell]).finally(() => { if (timer) clearTimeout(timer); });
}

/** One Place Details request on the narrowest mask, in pence. */
export const pencePerRequest = () => Math.round(PRICE_PER_UNIT_USD['google-pro'] * 100 * USD_TO_GBP * 100) / 100;

const gbp = (usd) => Math.round(usd * USD_TO_GBP * 100) / 100;

// ---------------------------------------------------------------------------
// the sample
// ---------------------------------------------------------------------------

/**
 * The drawers worth a set, with their census counts.
 *
 * Counted from `place_index`, which is what the census writes to, and only
 * the drawers at or above the floor: a question set for a drawer with thirty
 * places in the country would be asked of thirty places.
 */
export async function drawers({ subcategories = null, floor = FLOOR } = {}) {
  const { rows } = await query(
    `select s.key, s.label, count(p.venue_ref)::int as places
       from shelf_subcategories s
       join place_index p on p.subcategory = s.key
      where s.active
        ${subcategories?.length ? 'and s.key = any($2)' : ''}
      group by 1, 2
     having count(p.venue_ref) >= $1
      order by 3 desc, 1`,
    subcategories?.length ? [floor, subcategories] : [floor],
  );
  return rows;
}

/**
 * One drawer's places, ranked the way the brief says: the Epic score where we
 * have one, Google's own rank in the census where we do not, then age.
 *
 * `pickSample` takes the twelve at the top and eight at even intervals through
 * the 40th–80th percentile, so the mid-tail is reproducible from the ordering
 * alone (domain/questions.js).
 */
export async function sampleFor(subcategory) {
  const { rows } = await query(
    `select p.venue_ref
       from place_index p
       left join place_records r on r.venue_ref = p.venue_ref
      where p.subcategory = $1
      order by r.epic_score desc nulls last, p.found_rank asc nulls last, p.first_seen asc, p.venue_ref`,
    [subcategory],
  );
  const picked = pickSample(rows.map((r) => r.venue_ref));
  return picked.map((venue_ref, i) => ({ venue_ref, tier: i < SAMPLE.top ? 'top' : 'mid' }));
}

/**
 * Places we already hold a researched, identified record for.
 *
 * These are in the sample because they are at the top of the ranking, and they
 * cost nothing: `enrich` without `force` returns "already researched" for a
 * fresh, identified record before asking anybody anything. The estimate
 * counts them apart so the price is for what will actually go out.
 */
async function alreadyHeld(refs) {
  if (!refs.length) return new Set();
  // The same predicate `enrich` skips on — not a copy of it. A copy counted
  // any recent row with any provenance as free, and rows an older researcher
  // wrote were subtracted from the confirmed count and then paid for
  // (Codex, 25 Sep 2026).
  const { rows } = await query(
    `select venue_ref, enrich_state, enriched_at, research_version, provenance
       from place_records where venue_ref = any($1)`,
    [refs],
  );
  return new Set(rows.filter((r) => own.alreadyResearched(r)).map((r) => r.venue_ref));
}

// ---------------------------------------------------------------------------
// the price, before the click
// ---------------------------------------------------------------------------

/**
 * What a sweep would cost, at most.
 *
 * `requests` is the ceiling — two per place that will actually be asked — and
 * is the number `start` has to be handed. The low figure is one request a
 * place, which is what a place whose brief comes back with a website costs.
 */
export async function estimate({ subcategories = null, floor = FLOOR } = {}) {
  const list = await drawers({ subcategories, floor });
  const perDrawer = [];
  let sampled = 0;
  let held = 0;
  for (const d of list) {
    const sample = await sampleFor(d.key);
    const have = await alreadyHeld(sample.map((s) => s.venue_ref));
    perDrawer.push({ subcategory: d.key, places: d.places, sampled: sample.length, held: have.size });
    sampled += sample.length;
    held += have.size;
  }
  const asked = sampled - held;
  const pence = pencePerRequest();
  const requests = asked * REQUESTS_PER_PLACE;
  return {
    drawers: perDrawer,
    floor,
    sampled,
    held,
    asked,
    requests,
    pencePerRequest: pence,
    costGbpLow: Math.round(asked * pence) / 100,
    costGbpHigh: Math.round(requests * pence) / 100,
    basis: `${list.length} drawers at ${floor}+ census places · ${SAMPLE.top} top and ${SAMPLE.mid} mid-tail each · `
      + `${asked} to ask at up to ${REQUESTS_PER_PLACE} Place Details requests (${pence}p) apiece · the rest already held`,
  };
}

// ---------------------------------------------------------------------------
// starting one
// ---------------------------------------------------------------------------

export async function start({ subcategories = null, floor = FLOOR, confirm = null, householdId = null, startedBy = null } = {}) {
  const plan = await estimate({ subcategories, floor });
  if (Number(confirm) !== plan.requests) {
    const err = new Error(`This sweep is up to ${plan.requests} requests at £${plan.costGbpLow.toFixed(2)}–£${plan.costGbpHigh.toFixed(2)}. Confirm with ${plan.requests} to run it.`);
    err.code = 'confirm_required';
    err.status = 409;
    err.plan = plan;
    throw err;
  }
  if (!householdId) {
    // No household means nothing to attribute the calls to, and a run whose
    // spend is on nobody's account is a run the ledger cannot explain.
    throw Object.assign(new Error('A sweep is run by a signed-in household.'), { code: 'no_household', status: 409 });
  }
  return withTransaction(async (client) => {
    // One at a time. Two sweeps would share Overpass's patience and the
    // ceiling, and the second's places would mostly be the first's.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['epic.research_sweep.start']);
    const { rows: going } = await client.query(`select id from research_sweeps where state = 'running' limit 1`);
    if (going.length) {
      throw Object.assign(new Error('A sweep is already running. Wait for it, or it will be picked up if it has stalled.'),
        { code: 'already_running', status: 409, sweep: going[0].id });
    }
    const { rows: [row] } = await client.query(
      `insert into research_sweeps (subcategories, params, household_id, started_by, places)
       values ($1, $2, $3, $4, $5) returning *`,
      [JSON.stringify(plan.drawers.map((d) => d.subcategory)), JSON.stringify({ floor, requests: plan.requests, estimateGbp: plan.costGbpHigh }),
        householdId, startedBy, plan.sampled]);
    for (const d of plan.drawers) {
      const sample = await sampleFor(d.subcategory);
      for (const s of sample) {
        await client.query(
          `insert into research_sweep_places (sweep_id, venue_ref, subcategory, tier)
           values ($1, $2, $3, $4) on conflict do nothing`,
          [row.id, s.venue_ref, d.subcategory, s.tier]);
      }
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// the work
// ---------------------------------------------------------------------------

export async function one(id) {
  const { rows } = await query('select * from research_sweeps where id = $1', [id]);
  return rows[0] ?? null;
}

const beat = (id) => query(`update research_sweeps set touched_at = now() where id = $1 and state = 'running'`, [id]).catch(() => null);

/**
 * Take the next few pending places, marking them as in the air.
 *
 * `attempted_at` is set once and kept: it is the start of the window the
 * ledger is read over, and a place asked again after a deploy must be costed
 * from its *first* attempt, or the request the dead process made is left out
 * of the sweep's spend — in exactly the case the recovery exists for (Codex,
 * 25 Sep 2026).
 */
async function claimBatch(id, n = BATCH) {
  const { rows } = await query(
    `update research_sweep_places set state = 'asking', attempted_at = coalesce(attempted_at, now())
      where (sweep_id, venue_ref) in (
        select sweep_id, venue_ref from research_sweep_places
         where sweep_id = $1 and state = 'pending'
         -- The top of each drawer first: if the ceiling runs out, the
         -- places a household is likeliest to open are the ones done.
         order by subcategory, case tier when 'top' then 0 else 1 end, venue_ref
         for update skip locked
         limit $2)
      returning venue_ref, subcategory, tier, attempted_at`,
    [id, n]);
  return rows;
}

/**
 * What the research came back with, as facts the funnel can count.
 *
 * Never the text: a description that landed is `described: true`, not the
 * description. The place's record holds that.
 */
function outcomeOf(out) {
  const matched = out?.matched ?? {};
  return {
    state: out?.state ?? 'unknown',
    skipped: out?.skipped ?? null,
    openMap: Boolean(matched.osm),
    theirPage: Boolean(matched.site),
    encyclopedia: Boolean(matched.wikipedia),
    described: Boolean(out?.fields?.summary),
    couldNotAsk: (out?.problems ?? []).some((p) => /could not ask|no name|nothing to go on/i.test(p)),
    problems: (out?.problems ?? []).slice(0, 3),
  };
}

/**
 * What this place's research cost, from the ledger rather than from a guess.
 *
 * Narrowed to this sweep's household and to the two purposes the research
 * spends under, so a display search or a drawer somebody else opened on the
 * same place in the same minutes is not booked to the sweep (Codex, 25 Sep
 * 2026). What is left is the same household opening the same place at the
 * same moment, which is narrow enough to live with rather than worth a run
 * id on every ledger row.
 */
async function spentOn(venueRef, since, householdId) {
  const { rows: [r] } = await query(
    `select coalesce(sum(estimated_cost_usd), 0)::numeric as usd
       from provider_calls
      where venue_ref = $1 and created_at >= $2 and provider = 'google'
        and purpose in ('own.seed', 'own.lead')
        and household_id is not distinct from $3`,
    [venueRef, since, householdId]);
  return Number(r?.usd ?? 0);
}

/** The funnel, counted from the rows rather than kept in step with them. */
export async function funnelOf(id) {
  const { rows: [f] } = await query(
    `select count(*)::int as sampled,
            count(*) filter (where state = 'done' and outcome->>'skipped' is not null)::int as held,
            count(*) filter (where state in ('done', 'failed') and outcome->>'skipped' is null)::int as asked,
            count(*) filter (where state = 'done' and outcome->>'state' = 'done')::int as identified,
            count(*) filter (where (outcome->>'openMap')::boolean)::int as open_map,
            count(*) filter (where (outcome->>'theirPage')::boolean)::int as their_page,
            count(*) filter (where (outcome->>'encyclopedia')::boolean)::int as encyclopedia,
            count(*) filter (where (outcome->>'described')::boolean)::int as described,
            count(*) filter (where (outcome->>'couldNotAsk')::boolean)::int as could_not_ask,
            count(*) filter (where state = 'failed')::int as failed,
            count(*) filter (where state = 'pending')::int as pending,
            count(*) filter (where state = 'asking')::int as asking,
            coalesce(sum(cost_usd), 0)::numeric as usd
       from research_sweep_places where sweep_id = $1`,
    [id]);
  return {
    sampled: f.sampled, held: f.held, asked: f.asked, identified: f.identified,
    openMap: f.open_map, theirPage: f.their_page, encyclopedia: f.encyclopedia, described: f.described,
    couldNotAsk: f.could_not_ask, failed: f.failed, pending: f.pending, asking: f.asking,
    spentUsd: Number(f.usd), spentGbp: gbp(Number(f.usd)),
  };
}

/** Per drawer: how many were asked and how many now have something to read. */
export async function byDrawer(id) {
  const { rows } = await query(
    `select subcategory,
            count(*)::int as sampled,
            count(*) filter (where state = 'done' and outcome->>'state' = 'done')::int as identified,
            count(*) filter (where (outcome->>'described')::boolean)::int as described,
            count(*) filter (where state = 'failed')::int as failed,
            coalesce(sum(cost_usd), 0)::numeric as usd
       from research_sweep_places where sweep_id = $1
      group by 1 order by 1`,
    [id]);
  return rows.map((r) => ({ ...r, gbp: gbp(Number(r.usd)) }));
}

async function writeProgress(id, { problem = null, state = null } = {}) {
  const f = await funnelOf(id);
  await query(
    `update research_sweeps
        set funnel = $2::jsonb, spent_usd = $3, touched_at = now()
            ${state ? `, state = '${state}', finished_at = now()` : ''}
            ${problem ? ', problem = $4' : ''}
      where id = $1`,
    problem ? [id, JSON.stringify(f), f.spentUsd, problem] : [id, JSON.stringify(f), f.spentUsd]);
  return f;
}

/**
 * Drain one sweep. Returns when there is nothing left or the sweep stopped.
 *
 * `research` is `own.enrich` unless a test hands in something cheaper; `room`
 * and `release` are the ceiling, likewise. Places go one at a time — Overpass
 * and the venue's own server are somebody else's, and `own.js` runs its own
 * queue at one for the same reason.
 */
export async function work(id, { research = own.enrich, room = roomToSpend, release = releaseSpend, householdId = null, deadlineMs = PLACE_DEADLINE_MS } = {}) {
  const run = await one(id);
  if (!run || run.state !== 'running') return run;
  const household = householdId ?? run.household_id;
  const pulse = setInterval(() => { void beat(id); }, STRANDED_AFTER_MS / 4);
  pulse.unref?.();
  try {
    for (;;) {
      const still = await one(id);
      if (!still || still.state !== 'running') return still;
      const batch = await claimBatch(id);
      if (!batch.length) break;

      // Reserve the most this batch could cost; give back what it did not.
      // Only for the places that can spend: a place the estimate called held
      // is one `enrich` will skip, and reserving for it near the ceiling
      // failed a sweep whose real work still fitted (Codex, 25 Sep 2026).
      const held = await alreadyHeld(batch.map((p) => p.venue_ref));
      const want = (batch.length - held.size) * REQUESTS_PER_PLACE * pencePerRequest();
      const got = await room(Math.ceil(want), { holder: `sweep:${id}` });
      if (!got.ok) {
        // The ceiling is monthly and the sweep is not going to get under it by
        // waiting a minute. Stopped, with the places it never asked left
        // pending, so starting it again next month picks up here.
        await query(`update research_sweep_places set state = 'pending' where sweep_id = $1 and state = 'asking'`, [id]);
        await writeProgress(id, { state: 'failed', problem: `over this month's ceiling with £${(got.leftPence / 100).toFixed(2)} left` });
        return one(id);
      }
      try {
        for (const p of batch) {
          // The window the ledger is read over starts at the claim, on the
          // database's clock. Taken from `new Date()` here it was a
          // millisecond race with `created_at`, and half the rows were missed.
          const since = p.attempted_at;
          let outcome;
          let state = 'done';
          try {
            // Two Google requests at most, and never the web search: that is
            // what the estimate priced and what the ceiling was asked for.
            const out = await withDeadline(research(p.venue_ref, { householdId: household, paid: true, search: false, force: false }), deadlineMs);
            outcome = outcomeOf(out);
            if (outcome.state === 'failed') state = 'failed';
          } catch (err) {
            state = 'failed';
            outcome = { state: 'failed', problems: [String(err?.message ?? err).slice(0, 160)] };
          }
          const usd = await spentOn(p.venue_ref, since, household);
          await query(
            `update research_sweep_places set state = $3, outcome = $4::jsonb, cost_usd = $5
              where sweep_id = $1 and venue_ref = $2`,
            [id, p.venue_ref, state, JSON.stringify(outcome), usd]);
        }
      } finally {
        await release(got.reservation);
      }
      await writeProgress(id);
    }
    await writeProgress(id, { state: 'done' });
    return one(id);
  } catch (err) {
    await writeProgress(id, { state: 'failed', problem: String(err?.message ?? err).slice(0, 200) }).catch(() => null);
    throw err;
  } finally {
    clearInterval(pulse);
  }
}

// ---------------------------------------------------------------------------
// picking up after a deploy
// ---------------------------------------------------------------------------

/**
 * Any sweep that was running when its process died is started again.
 *
 * Claimed and read in one statement, so two instances booting together
 * cannot both take the same sweep. A place that was in the air when the
 * process died goes back to pending and is asked again: at most one Place
 * Details request might be paid twice, which is a few pence against a hole in
 * the sample — the opposite trade from Collect, whose in-flight batches are
 * ten paid details at a time.
 */
export async function resume({ work: doWork = work } = {}) {
  const { rows } = await query(
    `update research_sweeps set touched_at = now()
      where id in (
        select id from research_sweeps
         where state = 'running' and touched_at < now() - ($1 || ' milliseconds')::interval
         order by started_at
         for update skip locked)
      returning *`, [String(STRANDED_AFTER_MS)]);
  let resumed = 0;
  for (const run of rows) {
    if (!run.household_id) {
      await writeProgress(run.id, { state: 'failed', problem: 'it was interrupted and we cannot tell whose sweep it was' });
      continue;
    }
    await query(`update research_sweep_places set state = 'pending' where sweep_id = $1 and state = 'asking'`, [run.id]);
    // The reservation the dead process held outlives it by half an hour, and
    // near the ceiling the resumed worker would count it against itself and
    // give up for good (Codex, 25 Sep 2026). Whatever it covered is on the
    // ledger by now.
    await query('delete from spend_reservations where holder = $1', [`sweep:${run.id}`]).catch(() => null);
    void doWork(run.id).catch((err) => console.warn(`sweep ${run.id}: ${err.message}`));
    resumed += 1;
  }
  return { resumed, stranded: rows.length };
}

/** The last few sweeps, with their funnels, for a report. */
export async function recent({ limit = 5 } = {}) {
  const { rows } = await query('select * from research_sweeps order by started_at desc limit $1', [limit]);
  return rows;
}
