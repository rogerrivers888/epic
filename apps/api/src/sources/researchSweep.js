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
import { sourceHasKey, sourceOff } from './index.js';
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

/**
 * Whether identifying this place costs a Google request.
 *
 * Only a `google:` ref is an ID and nothing else. An `osm:` or `atlas:` place
 * carries its own name and point and is researched from the open map and
 * the encyclopedias for nothing — `seedFor` never asks Google about it. So
 * it is neither priced, reserved for, nor a reason to stop when Google is
 * off (Codex, 25 Sep 2026).
 */
export const needsGoogle = (venueRef) => String(venueRef).startsWith('google:');

/**
 * How many Google requests each place may still cost, from what we hold.
 *
 * Two for a Google place we know only as an id — identify it, then find its
 * page. One for a Google place we have a name and point for but no website:
 * `enrich` with `paid` still buys the website lead. Nought for anything with
 * a website, or for a place that is not Google's at all. The sample sweep
 * counted a fresh identified record as free, and the reference set — which
 * forces research whatever the record holds — was reserving nothing for the
 * lead it would then buy (Codex, 25 Sep 2026).
 */
export async function requestsStillNeeded(refs) {
  const out = new Map(refs.map((r) => [r, needsGoogle(r) ? REQUESTS_PER_PLACE : 0]));
  if (!refs.length) return out;
  const { rows } = await query('select venue_ref, name, lat, website from place_records where venue_ref = any($1)', [refs]);
  for (const r of rows) {
    if (!needsGoogle(r.venue_ref)) continue;
    if (r.name && r.lat != null) out.set(r.venue_ref, r.website ? 0 : 1);
  }
  return out;
}

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
  let free = 0;
  for (const d of list) {
    const sample = await sampleFor(d.key);
    const have = await alreadyHeld(sample.map((s) => s.venue_ref));
    const unheld = sample.filter((s) => !have.has(s.venue_ref));
    const freeHere = unheld.filter((s) => !needsGoogle(s.venue_ref)).length;
    // The sample travels with the estimate, so what `start` writes down is
    // exactly what was priced — not a second sample taken after the census
    // moved (Codex, 25 Sep 2026).
    perDrawer.push({ subcategory: d.key, places: d.places, sampled: sample.length, held: have.size, free: freeHere, sample });
    sampled += sample.length;
    held += have.size;
    free += freeHere;
  }
  const asked = sampled - held - free;
  const pence = pencePerRequest();
  const requests = asked * REQUESTS_PER_PLACE;
  return {
    drawers: perDrawer,
    floor,
    sampled,
    held,
    free,
    asked,
    requests,
    pencePerRequest: pence,
    costGbpLow: Math.round(asked * pence) / 100,
    costGbpHigh: Math.round(requests * pence) / 100,
    basis: `${list.length} drawers at ${floor}+ census places · ${SAMPLE.top} top and ${SAMPLE.mid} mid-tail each · `
      + `${asked} to ask Google at up to ${REQUESTS_PER_PLACE} Place Details requests (${pence}p) apiece · `
      + `${free} researched free from the open map · ${held} already held`,
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
  if (plan.asked > 0 && (!sourceHasKey('google') || sourceOff('google'))) {
    // A census place is an ID and nothing else, and the one way to learn what
    // it is costs a Google request. Without Google every asked place would be
    // "could not ask", and the sweep would finish having done none of the
    // research it was confirmed for (Codex, 25 Sep 2026).
    throw Object.assign(new Error(`${plan.asked} of these places can only be identified through Google, which is ${sourceOff('google') ? 'switched off in Settings' : 'not configured'}.`),
      { code: 'google_unavailable', status: 409, plan });
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
      // The estimate's own sample, not a fresh one.
      for (const s of d.sample) {
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
    // `fields` is a count; the record's provenance says whether a summary
    // landed. Read off `fields.summary` this was always false, and the one
    // number the sweep exists to move read nought while pages and
    // encyclopedia entries were landing (found live, 25 Sep 2026).
    described: Boolean(out?.provenance?.summary),
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
            count(*) filter (where p.state = 'done' and outcome->>'skipped' is not null)::int as held,
            count(*) filter (where p.state in ('done', 'failed') and outcome->>'skipped' is null)::int as asked,
            count(*) filter (where p.state = 'done' and outcome->>'state' = 'done')::int as identified,
            count(*) filter (where (outcome->>'openMap')::boolean)::int as open_map,
            count(*) filter (where (outcome->>'theirPage')::boolean)::int as their_page,
            count(*) filter (where (outcome->>'encyclopedia')::boolean)::int as encyclopedia,
            -- Whether there is a description to read is the record's fact,
            -- not the outcome's: counted from place_records so it is true
            -- whenever it is asked, including for rows written before the
            -- outcome recorded it properly.
            count(*) filter (where p.state <> 'pending' and length(coalesce(r.summary, '')) > 80)::int as described,
            count(*) filter (where (outcome->>'couldNotAsk')::boolean)::int as could_not_ask,
            count(*) filter (where p.state = 'failed')::int as failed,
            count(*) filter (where p.state = 'pending')::int as pending,
            count(*) filter (where p.state = 'asking')::int as asking,
            coalesce(sum(cost_usd), 0)::numeric as usd
       from research_sweep_places p
       left join place_records r on r.venue_ref = p.venue_ref
      where p.sweep_id = $1`,
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
    `select p.subcategory,
            count(*)::int as sampled,
            count(*) filter (where p.state = 'done' and outcome->>'state' = 'done')::int as identified,
            count(*) filter (where p.state <> 'pending' and length(coalesce(r.summary, '')) > 80)::int as described,
            count(*) filter (where p.state = 'failed')::int as failed,
            coalesce(sum(cost_usd), 0)::numeric as usd
       from research_sweep_places p
       left join place_records r on r.venue_ref = p.venue_ref
      where p.sweep_id = $1
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
/**
 * The reference set's research: everything, again, and kept.
 *
 * `force` asks every source whatever the record already holds; `replace`
 * clears a source's facts before taking what it says now, so a wrong match
 * cannot survive; the seed is the record's own name and point, so a place we
 * already know is not bought back from Google. The sample sweep leaves a
 * fresh identified record alone; the reference set does not.
 */
/** What the record already knows about a place, as the seed `enrich` takes — or nothing. */
async function seedFromRecord(venueRef) {
  const r = await query('select name, lat, lng, website, postcode, category, address from place_records where venue_ref = $1', [venueRef]);
  const rec = r.rows[0];
  // A complete seed short-circuits `seedFor`, so everything it would have
  // merged has to be here: the category decides whether a menu is looked
  // for, and the address tells two branches of one chain apart (Codex, 25
  // Sep 2026).
  return rec?.name && rec?.lat != null
    ? { name: rec.name, lat: rec.lat, lng: rec.lng, website: rec.website ?? undefined, postcode: rec.postcode ?? undefined, category: rec.category ?? undefined, address: rec.address ?? undefined }
    : {};
}

/**
 * The sample sweep's research: `enrich` as it stands, seeded from the record
 * where there is one.
 *
 * `seedFor` reads a household's own row and the shortlist, not place_records,
 * so a place this sweep had already identified and then failed on — an
 * Overpass timeout, 119 times over — would have been bought back from Google
 * on the retry. The record's own name and point go in first; a place with no
 * record is unchanged (owner via epic-ed, 25 Sep 2026: retry the failures).
 */
export async function sampleResearch(venueRef, opts = {}) {
  return own.enrich(venueRef, { ...opts, seed: await seedFromRecord(venueRef) });
}

export async function referenceResearch(venueRef, opts = {}) {
  let seed = await seedFromRecord(venueRef);
  // An atlas place may have no record of its own yet; the atlas holds its
  // name and point, and without them the research could not ask — eight of
  // the sport picks were atlas places (found in the first proposal, 25 Sep
  // 2026).
  if (!seed.name && String(venueRef).startsWith('atlas:')) {
    const { rows: [at] } = await query('select name, lat, lng, website from attractions where id::text = $1', [String(venueRef).slice(6)]);
    if (at?.name && at?.lat != null) seed = { name: at.name, lat: at.lat, lng: at.lng, website: at.website ?? undefined };
  }
  return own.enrich(venueRef, { ...opts, seed, force: true, replace: true, hygiene: true });
}

export async function work(id, { research = null, room = roomToSpend, release = releaseSpend, householdId = null, deadlineMs = PLACE_DEADLINE_MS } = {}) {
  const run = await one(id);
  if (!run || run.state !== 'running') return run;
  // The kind of research is the run's, so a resume after a deploy does the
  // same work the start did.
  const ask = research ?? (run.params?.mode === 'reference' ? referenceResearch : sampleResearch);
  const household = householdId ?? run.household_id;
  const pulse = setInterval(() => { void beat(id); }, STRANDED_AFTER_MS / 4);
  pulse.unref?.();
  try {
    for (;;) {
      const still = await one(id);
      if (!still || still.state !== 'running') return still;
      // Google may have been switched off, or lost its key, since `start`
      // checked. Without it every asked place is "could not ask", and the
      // worker would drain the sample marking rows done that were never
      // researched (Codex, 25 Sep 2026). Stopped instead, before claiming,
      // with the rest left pending.
      // Only the places that would actually need it: a sweep of nothing but
      // places already held passes through `enrich`'s free path and may
      // finish with Google off (Codex, 25 Sep 2026).
      const { rows: pendingRows } = await query(`select venue_ref from research_sweep_places where sweep_id = $1 and state = 'pending'`, [id]);
      // The same arithmetic the reservation uses: in reference mode a known
      // place without a website still buys its page lead, so Google is still
      // needed for it (Codex, 25 Sep 2026).
      // What each pending place may still cost from what it holds — in sample
      // mode a held place costs nothing on top of that, since `enrich` skips
      // it. A retried place seeded from its record needs no identification,
      // and the older test required Google for it anyway (Codex, 25 Sep 2026).
      const pendingCost = await requestsStillNeeded(pendingRows.map((r) => r.venue_ref));
      if (run.params?.mode !== 'reference') {
        const pendingHeld = pendingRows.length ? await alreadyHeld(pendingRows.map((r) => r.venue_ref)) : new Set();
        for (const ref of pendingHeld) pendingCost.set(ref, 0);
      }
      const stillNeedsGoogle = [...pendingCost.values()].some((c) => c > 0);
      if (stillNeedsGoogle && (!sourceHasKey('google') || sourceOff('google'))) {
        await writeProgress(id, { state: 'failed', problem: `Google is ${sourceOff('google') ? 'switched off in Settings' : 'not configured'}; the places not yet asked are left as they were` });
        return one(id);
      }
      const batch = await claimBatch(id);
      if (!batch.length) break;

      // Reserve the most this batch could cost; give back what it did not.
      // Only for the places that can spend: a place the estimate called held
      // is one `enrich` will skip, and reserving for it near the ceiling
      // failed a sweep whose real work still fitted (Codex, 25 Sep 2026).
      // What each place may still cost from what it holds; in sample mode a
      // held place is skipped by `enrich` and costs nothing on top.
      const remaining = await requestsStillNeeded(batch.map((p) => p.venue_ref));
      if (run.params?.mode !== 'reference') {
        const held = await alreadyHeld(batch.map((p) => p.venue_ref));
        for (const ref of held) remaining.set(ref, 0);
      }
      const chargeableRequests = batch.reduce((n, p) => n + (remaining.get(p.venue_ref) ?? 0), 0);
      const want = chargeableRequests * pencePerRequest();
      const got = await room(Math.ceil(want), { holder: `sweep:${id}` });
      if (!got.ok) {
        // The ceiling is monthly and the sweep is not going to get under it by
        // waiting a minute. Stopped, with the places it never asked left as
        // they were; a new sweep next month samples afresh, and the ones done
        // here are held and cost it nothing.
        await query(`update research_sweep_places set state = 'pending' where sweep_id = $1 and state = 'asking'`, [id]);
        await writeProgress(id, { state: 'failed', problem: `over this month's ceiling with £${(got.leftPence / 100).toFixed(2)} left` });
        return one(id);
      }
      // Places that outlived their deadline and may still spend. The batch's
      // own reservation already covers them, so it is simply kept until the
      // last of them settles rather than released and taken again: a second
      // hold taken while the batch's stood counted the same work twice, and
      // releasing first left a gap another run could take (Codex, 25 Sep
      // 2026, twice). It over-holds by what the settled places in the batch
      // already spent, which errs the safe way and lasts only as long as the
      // stray does; a stray that never settles is let go by the reservation's
      // own half-hour expiry.
      const strays = [];
      try {
        for (const p of batch) {
          // The window the ledger is read over starts at the claim, on the
          // database's clock. Taken from `new Date()` here it was a
          // millisecond race with `created_at`, and half the rows were missed.
          const since = p.attempted_at;
          let outcome;
          let state = 'done';
          // Two Google requests at most, and never the web search: that is
          // what the estimate priced and what the ceiling was asked for.
          const asking = ask(p.venue_ref, { householdId: household, paid: true, search: false, force: false });
          try {
            const out = await withDeadline(asking, deadlineMs);
            outcome = outcomeOf(out);
            if (outcome.state === 'failed') state = 'failed';
          } catch (err) {
            state = 'failed';
            outcome = { state: 'failed', problems: [String(err?.message ?? err).slice(0, 160)] };
            if (err?.code === 'deadline') {
              // The research cannot be cancelled from here — `own.js` has no
              // abort — so a call that outlives its deadline may still go on
              // to spend. It is remembered, and the batch's reservation stays
              // until it settles (below). Either way it settles — answered
              // or thrown — what it cost by then is read again and written,
              // because the read at the deadline may have run before the
              // request landed.
              strays.push({
                place: p,
                settled: asking.then(
                  (out) => outcomeOf(out),
                  (err) => ({ state: 'failed', problems: [String(err?.message ?? err).slice(0, 160)] }),
                ).then(async (late) => {
                  const usd = await spentOn(p.venue_ref, since, household);
                  await query(
                    `update research_sweep_places
                          set cost_usd = $4,
                              outcome = jsonb_strip_nulls(jsonb_build_object('retried', outcome->'retried')) || $3::jsonb
                      where sweep_id = $1 and venue_ref = $2`,
                    [id, p.venue_ref, JSON.stringify({ ...late, late: true, problems: [...outcome.problems, ...(late.problems ?? [])] }), usd]);
                  await writeProgress(id).catch(() => null);
                }).catch(() => null),
              });
            }
          }
          const usd = await spentOn(p.venue_ref, since, household);
          await query(
            `update research_sweep_places
                  set state = $3, cost_usd = $5,
                      outcome = jsonb_strip_nulls(jsonb_build_object('retried', outcome->'retried')) || $4::jsonb
              where sweep_id = $1 and venue_ref = $2`,
            [id, p.venue_ref, state, JSON.stringify(outcome), usd]);
        }
      } finally {
        if (strays.length) {
          void Promise.all(strays.map((s) => s.settled)).then(() => release(got.reservation)).catch(() => null);
        } else {
          await release(got.reservation);
        }
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

/** Every place in a sweep, with what happened to it — for reading the problems, not the text. */
export async function places(id) {
  const { rows } = await query(
    `select p.venue_ref, p.subcategory, p.tier, p.state, p.outcome, p.cost_usd, p.attempted_at,
            length(coalesce(r.summary, '')) > 80 as described
       from research_sweep_places p
       left join place_records r on r.venue_ref = p.venue_ref
      where p.sweep_id = $1
      order by p.subcategory, case p.tier when 'top' then 0 else 1 end, p.venue_ref`,
    [id]);
  return rows;
}

/**
 * Ask again about the places a finished sweep failed on.
 *
 * Owner, 25 Sep 2026: seventeen per cent of the sample failed, almost all
 * Overpass timeouts, and those cluster on the biggest places — "if the thin
 * drawers and the failed places overlap, the corpus is thin for a fixable
 * reason." The failed rows go back to pending, the sweep back to running,
 * and the worker takes it from there. `attempted_at` is kept, so what a
 * place cost across both goes is still its cost; nothing is bought twice
 * because the research is seeded from the record it already has.
 */
/** The failed rows a retry would take: not a place still in flight at its deadline. */
const RETRYABLE = `state = 'failed'
          and not (coalesce(outcome->'problems'->>0, '') like 'gave up after%' and not coalesce((outcome->>'late')::boolean, false))`;

/**
 * What a retry would cost, and the number it has to be confirmed with.
 *
 * Most retried places are seeded from their record and cost nothing; one
 * without a website still buys its page lead, and one that was never
 * identified buys two. The same gate as the sweep itself: nothing paid
 * starts on a number the caller has not seen (Codex, 25 Sep 2026).
 */
export async function retryEstimate(id) {
  const { rows } = await query(`select venue_ref from research_sweep_places where sweep_id = $1 and ${RETRYABLE}`, [id]);
  const cost = await requestsStillNeeded(rows.map((r) => r.venue_ref));
  const counts = [...cost.values()];
  const requests = counts.reduce((n, c) => n + c, 0);
  const pence = pencePerRequest();
  return {
    places: rows.length,
    free: counts.filter((c) => c === 0).length,
    toFindPage: counts.filter((c) => c === 1).length,
    toIdentify: counts.filter((c) => c === 2).length,
    requests,
    pencePerRequest: pence,
    costGbpHigh: Math.round(requests * pence) / 100,
    basis: `${rows.length} failed places · ${counts.filter((c) => c === 0).length} seeded from their record and free · `
      + `${counts.filter((c) => c === 1).length} without a website (one request) · ${counts.filter((c) => c === 2).length} never identified (two) · ${pence}p a request`,
  };
}

export async function retryFailed(id, { confirm = null } = {}) {
  const plan = await retryEstimate(id);
  if (Number(confirm) !== plan.requests) {
    const err = new Error(`This retry is ${plan.places} places, up to ${plan.requests} Google requests at £${plan.costGbpHigh.toFixed(2)}. Confirm with ${plan.requests} to run it.`);
    err.code = 'confirm_required'; err.status = 409; err.plan = plan;
    throw err;
  }
  return withTransaction(async (client) => {
    // The same lock `start` takes, and both updates inside it: two retries,
    // or a retry racing a start, could each see no running sweep and both
    // go; and rows put back to pending under a sweep that then failed to
    // reopen would be lost to every later retry (Codex, 25 Sep 2026).
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['epic.research_sweep.start']);
    const { rows: [run] } = await client.query('select * from research_sweeps where id = $1', [id]);
    if (!run) return null;
    if (run.state === 'running') throw Object.assign(new Error('That sweep is still running.'), { code: 'already_running', status: 409 });
    const { rows: going } = await client.query(`select id from research_sweeps where state = 'running' limit 1`);
    if (going.length) throw Object.assign(new Error('A sweep is already running.'), { code: 'already_running', status: 409, sweep: going[0].id });
    // A place given up on at its deadline may still be in flight — its
    // research cannot be cancelled — and asking again now would run two at
    // once and could pay twice. It is left as it is until its late answer
    // lands, which marks it `late`; a retry after that takes it.
    const { rowCount } = await client.query(
      `update research_sweep_places set state = 'pending', outcome = coalesce(outcome, '{}'::jsonb) || '{"retried": true}'::jsonb
        where sweep_id = $1 and ${RETRYABLE}`,
      [id]);
    if (!rowCount) return { ...run, retried: 0 };
    const { rows: [reopened] } = await client.query(
      `update research_sweeps set state = 'running', finished_at = null, problem = null, touched_at = now() where id = $1 returning *`, [id]);
    return { ...reopened, retried: rowCount };
  });
}

/** The last few sweeps, with their funnels, for a report. */
export async function recent({ limit = 5 } = {}) {
  const { rows } = await query('select * from research_sweeps order by started_at desc limit $1', [limit]);
  return rows;
}
