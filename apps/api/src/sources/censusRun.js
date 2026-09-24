/**
 * The big census: a region, on a grid, over days.
 *
 * The brief, 20 September 2026 (*The big census run*). Every taxonomy decision
 * being made right now is being made without denominators — "Golf clubs · 41
 * places" is a Berkshire number and nobody knows what it means nationally. The
 * census is free at the IDs Only mask and permanent, so it is run across London
 * and the south and every one of those decisions gets a real number behind it.
 *
 * Four properties, and each of them is a thing that has already gone wrong here
 * at least once:
 *
 *   · **Tiled, not iterated.** Outcodes are irregular and overlap. The ring
 *     census drew an eight-kilometre box around each outcode centre and covered
 *     the same ground three and four times; that overlap is most of why the
 *     brief's own estimate came out at 1.1 million requests. A fixed grid,
 *     keeping only the squares a postcode sector actually falls in, covers the
 *     same region in 390 tiles. Deduplication is free, because two tiles cannot
 *     return the same place.
 *   · **Resumable and idempotent.** A run of this length will be interrupted —
 *     by a deploy, by a restart, by the ceiling. The checkpoint is per tile per
 *     subcategory, a tile censused inside the freshness window is skipped, and
 *     re-running a finished tile does nothing.
 *   · **Paced and bounded.** A rate, a per-run request ceiling, and a stop
 *     control a person can press. Free requests are exactly the ones a runaway
 *     hides in: nothing in the ledger would complain.
 *   · **Ledgered.** Every tile writes its meter to `provider_calls`, and the
 *     cost column is expected to read nought. **A non-zero figure is an
 *     alarm**, not an expense: it means something asked for a field the census
 *     may not buy.
 *
 * What this file does *not* do is decide what a count means. Tiles are the
 * record; the outcode numbers a person reads are derived from them, with their
 * coverage attached (`rollUpOutcodes`).
 */

import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { censusArea, slicePlan, CENSUS_FRESH_DAYS, CENSUS_MAX_DEPTH } from './census.js';
// The same corner test the ring count uses. One piece of arithmetic for "is
// this box inside this area", not two that can disagree (repositories/censusRing.js).
import { whereBoxSits } from '../repositories/censusRing.js';
import { refreshDue as refreshRingsBefore } from '../repositories/ringTables.js';
import { USD_TO_GBP } from '../domain/providerPrices.js';

/**
 * The grid.
 *
 * About 8.9 km by 8.3 km at the latitude of London, which is deliberately the
 * size of the boxes the ring census used: it is the one tile size whose request
 * cost has actually been measured (SL5 1,040 requests, SE1 5,473). A finer grid
 * multiplies the floor — 257 questions are asked of every tile whatever is in
 * it — and a coarser one saturates more and splits more, which costs the same
 * requests with less to show for them.
 */
export const TILE_LAT = Number(process.env.EPIC_CENSUS_TILE_LAT || 0.08);
export const TILE_LNG = Number(process.env.EPIC_CENSUS_TILE_LNG || 0.12);

/**
 * How far past a known postcode sector a tile is still censused.
 *
 * One tile. `geo_cells` holds about 6,300 sectors of the roughly 11,000 there
 * are, so a square can sit in the middle of a town and contain none of the ones
 * we have — and a square nobody censuses is a hole no count ever mentions.
 * Padding costs about a sixth more tiles on London and the home counties, all
 * of them cheap ones, and buys a grid with no silent gaps in it.
 */
export const PAD_KM = Number(process.env.EPIC_CENSUS_PAD_KM || 8);

/** How long one pass of the loop works before handing the process back. */
const SLICE_MS = Number(process.env.EPIC_CENSUS_SLICE_MS || 55_000);

/**
 * What Google will answer in a day, until it says otherwise.
 *
 * 75,000 Text Search requests, because that is what the cap was on 20 September
 * 2026 (owner, 21 Sep 2026: "assume the daily Text Search cap is 75,000 (it was
 * yesterday)"). An assumption with a date on it, held in one place, and checked
 * against the only authority there is — a refusal, which says what the limit
 * actually is and is stored verbatim when it arrives.
 */
export const DAILY_CAP = Number(process.env.EPIC_CENSUS_DAILY_CAP || 75_000);

/** The next 00:00 UTC, which is when Google's daily quota starts again. */
export const nextUtcMidnight = (from = new Date()) => {
  const d = new Date(from);
  d.setUTCHours(24, 0, 0, 0);
  return d;
};

/** How many goes a tile gets before the run is allowed to finish without it. */
export const MAX_TILE_TRIES = Number(process.env.EPIC_CENSUS_TILE_TRIES || 3);

/** A run untouched for this long has lost its process. */
export const STRANDED_AFTER_MS = 5 * 60_000;

/** This process, for the claim on a tile. Two instances cannot take the same one. */
const INSTANCE = `${process.env.RAILWAY_REPLICA_ID || 'local'}:${randomUUID().slice(0, 8)}`;

/** The square a point falls in, on the given grid. */
export const tileOf = (lat, lng, dLat = TILE_LAT, dLng = TILE_LNG) => {
  const i = Math.floor(lat / dLat);
  const j = Math.floor(lng / dLng);
  return {
    gridKey: `${dLat}x${dLng}/${i}/${j}`,
    minLat: i * dLat,
    minLng: j * dLng,
    maxLat: (i + 1) * dLat,
    maxLng: (j + 1) * dLng,
  };
};

/**
 * Which tiles a region is made of.
 *
 * A tile is kept only where a postcode sector centre falls inside it, so the
 * run follows where people are rather than squaring off the sea. The outcodes
 * of those sectors are written onto the tile, which is how a tile census is
 * reported by outcode afterwards without anybody having to guess.
 */
export async function planTiles({ areas = [], outcodes = [], dLat = TILE_LAT, dLng = TILE_LNG, padKm = PAD_KM } = {}) {
  if (!areas.length && !outcodes.length) return [];
  // Either the whole postcode area or named districts. The second is what a
  // calibration run needs — three areas before committing to a thousand — and
  // what re-censusing one district after a taxonomy change needs afterwards.
  const { rows } = await query(
    `select outcode, lat, lng from geo_cells
      where outcode is not null
        and (($1::text[] <> '{}' and substring(outcode from '^[A-Z]+') = any($1))
          or ($2::text[] <> '{}' and upper(outcode) = any($2)))`,
    [areas.map((a) => a.toUpperCase()), outcodes.map((o) => o.toUpperCase())],
  );
  const points = rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), outcode: String(r.outcode).toUpperCase() }));
  const tiles = new Map();
  const put = (key, tile, outcode) => {
    const existing = tiles.get(key) ?? { ...tile, outcodes: new Set() };
    if (outcode) existing.outcodes.add(outcode);
    tiles.set(key, existing);
  };
  for (const p of points) {
    const t = tileOf(p.lat, p.lng, dLat, dLng);
    put(t.gridKey, t, p.outcode);
  }

  // The squares between the sectors we happen to hold.
  //
  // `geo_cells` is a sample, not the whole postcode file — about 6,300 sectors
  // against the roughly 11,000 there are — so a square can be in the middle of
  // a town and contain none of the ones we have. Keeping only squares with a
  // sector in them would leave holes in the grid that nothing ever reports,
  // which is the one failure §5 is written against: a count is worthless
  // unless it says what ground it covers, and a hole says nothing at all.
  //
  // So a square touching the region is censused too, and takes the outcodes of
  // the sectors it is near for reporting. Eight kilometres is one tile: it
  // fills the gaps between sampled sectors and does not walk off into the sea.
  if (padKm > 0) {
    const km = (a, b) => Math.hypot((a.lat - b.lat) * 111.32, (a.lng - b.lng) * 69.4);
    // As many squares out as it takes to reach `padKm` on *this* grid. Looking
    // one square out assumed a square was eight kilometres, which the default
    // is — and on a one-kilometre grid it padded by a kilometre while the
    // quote said eight, so the gaps between sampled sectors stayed uncensused
    // and nothing said so (Codex, 24 Sep 2026).
    const rLat = Math.max(1, Math.ceil(padKm / (dLat * 111.32)));
    const rLng = Math.max(1, Math.ceil(padKm / (dLng * 69.4)));
    const range = (r) => Array.from({ length: 2 * r + 1 }, (_, i) => i - r);
    const cell = (lat, lng) => [Math.floor(lat / dLat), Math.floor(lng / dLng)];

    // The sectors, bucketed by the square they fall in, so a candidate square
    // asks only the buckets within reach of it rather than every sector in the
    // region. Scanning them all per candidate was fine at one square out and
    // eight sectors a tile; on a one-kilometre grid with eight kilometres of
    // padding it was a thousand candidates per occupied square, each reading
    // every sector, on the request thread (Codex, 24 Sep 2026).
    const buckets = new Map();
    for (const q of points) {
      const [i, j] = cell(q.lat, q.lng);
      const k = `${i}/${j}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(q);
    }
    const nearPoints = (centre) => {
      const [ci, cj] = cell(centre.lat, centre.lng);
      const near = [];
      for (const di of range(rLat)) {
        for (const dj of range(rLng)) {
          const b = buckets.get(`${ci + di}/${cj + dj}`);
          if (!b) continue;
          for (const q of b) if (km(q, centre) <= padKm) near.push(q);
        }
      }
      return near;
    };

    // Each candidate once, however many occupied squares it neighbours.
    const candidates = new Map();
    for (const t of tiles.values()) {
      const [ti, tj] = cell(t.minLat + dLat / 2, t.minLng + dLng / 2);
      for (const di of range(rLat)) {
        for (const dj of range(rLng)) {
          if (!di && !dj) continue;
          const k = `${ti + di}/${tj + dj}`;
          if (candidates.has(k)) continue;
          const centre = { lat: (ti + di + 0.5) * dLat, lng: (tj + dj + 0.5) * dLng };
          const n = tileOf(centre.lat, centre.lng, dLat, dLng);
          if (tiles.has(n.gridKey)) continue;
          candidates.set(k, { n, centre });
        }
      }
    }
    for (const { n, centre } of candidates.values()) {
      const near = nearPoints(centre);
      if (!near.length) continue;
      put(n.gridKey, n, null);
      for (const q of near) put(n.gridKey, n, q.outcode);
    }
  }
  return [...tiles.values()].map((t) => ({ ...t, outcodes: [...t.outcodes].sort() }));
}

/**
 * Start a run, or refuse to start a second one over the same ground.
 *
 * Two runs of the same region would each pay for the same tiles, and free
 * requests are the ones where paying twice goes unnoticed (the same reasoning
 * as `collectRuns.startIfClear`).
 */
export async function startRun({
  label, areas = [], outcodes = [], maxRequests = 250_000, ratePerSec = 5, freshDays = CENSUS_FRESH_DAYS,
  dLat = TILE_LAT, dLng = TILE_LNG, padKm = PAD_KM, dailyCap = DAILY_CAP, startedBy = null,
} = {}) {
  if (!areas?.length && !outcodes?.length) {
    throw Object.assign(new Error('a run needs postcode areas or districts'), { status: 400 });
  }
  // A run waiting for the quota day to turn over is still a run, and still owns
  // its tiles. Letting a second one start while one waits reassigned those
  // tiles, and at midnight the sleeper woke into a region somebody else was
  // working — two rows saying running, one of them stripped of its ground
  // (Codex, 21 Sep 2026).
  const { rows: going } = await query(
    `select id, label, state from census_runs where state in ('running', 'waiting') limit 1`);
  if (going.length) {
    throw Object.assign(
      new Error(going[0].state === 'waiting'
        ? `“${going[0].label}” is waiting for the quota day to turn over; stop it before starting another`
        : `“${going[0].label}” is already running; stop it before starting another`),
      { status: 409 });
  }
  const tiles = await planTiles({ areas, outcodes, dLat, dLng, padKm });
  if (!tiles.length) throw Object.assign(new Error('no postcode sectors in those areas'), { status: 400 });

  const { rows: [run] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, started_by, tiles_total, daily_cap, day, day_requests)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, (now() at time zone 'utc')::date, 0) returning *`,
    [label ?? [...areas, ...outcodes].join(', '),
      [...areas.map((a) => a.toUpperCase()), ...outcodes.map((o) => o.toUpperCase())], dLat, dLng,
      maxRequests, ratePerSec, freshDays, startedBy, tiles.length, dailyCap]);

  // Tiles outlive runs: the same square keeps its row and its history, and this
  // run simply claims the ones that are not fresh. `do update` on the outcodes
  // because the sector table moves and a stale list would misreport.
  // Whether the square has been looked at recently enough to leave alone. Said
  // once and used in every branch below, because ON CONFLICT DO UPDATE has no
  // FROM clause to hang a computed value on.
  const FRESH = "census_tiles.censused_at is not null and census_tiles.censused_at > now() - ($8 || ' days')::interval";
  for (const t of tiles) {
    await query(
      `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, run_id, state)
       values ($1,$2,$3,$4,$5,$6,$7,'todo')
       on conflict (grid_key) do update
          set outcodes = excluded.outcodes,
              run_id   = excluded.run_id,
              -- A tile censused inside the freshness window keeps its state, so
              -- the run walks past it. One outside it is work again.
              state    = case when ${FRESH} then census_tiles.state else 'todo' end,
              done_subcategories = case when ${FRESH} then census_tiles.done_subcategories else '{}'::text[] end,
              -- And a tile that is work again starts its accounting again.
              --
              -- Taking the tile over while keeping the last run's requests,
              -- slices and saturation meant the progress pass attributed all of
              -- it to the new run: a second run over the same ground could hit
              -- its own ceiling before making a single request, and reported
              -- spending somebody else had done (Codex, 21 Sep 2026).
              requests   = case when ${FRESH} then census_tiles.requests else 0 end,
              slices     = case when ${FRESH} then census_tiles.slices else 0 end,
              places     = case when ${FRESH} then census_tiles.places else 0 end,
              saturated  = case when ${FRESH} then census_tiles.saturated else 0 end,
              failures   = case when ${FRESH} then census_tiles.failures else 0 end,
              problem    = case when ${FRESH} then census_tiles.problem else null end,
              started_at = case when ${FRESH} then census_tiles.started_at else null end`,
      [t.gridKey, t.minLat, t.minLng, t.maxLat, t.maxLng, t.outcodes, run.id, String(freshDays)]);
    // Membership is its own fact. `run_id` is the run that last claimed the
    // square, which is what the loop needs; this is the ground this run was
    // given, which is what its report is drawn from — and the next run over
    // overlapping country would otherwise take it away (21 Sep 2026).
    await query(
      `insert into census_run_tiles (run_id, grid_key) values ($1, $2) on conflict do nothing`,
      [run.id, t.gridKey]);
  }
  await refreshProgress(run.id);
  return run;
}

/** A person pressing stop. The run finishes the tile it is on and stops. */
export async function requestStop(id) {
  const { rows } = await query(
    `update census_runs set stop_requested = true where id = $1 and state = 'running' returning id`, [id]);
  return { stopping: rows.length > 0 };
}

/** Start again where it left off. Nothing is re-asked; the tiles remember. */
export async function resume(id) {
  // The same rule as starting. Without it, resuming an older paused run while a
  // newer one is going left two rows saying "running" — and since the loop
  // advances the earliest, the other one sat there looking active and being
  // given no work at all (Codex, 21 Sep 2026).
  const { rows: going } = await query(
    `select id, label from census_runs where state = 'running' and id <> $1 limit 1`, [id]);
  if (going.length) {
    throw Object.assign(new Error(`“${going[0].label}” is running; stop it before resuming another`), { status: 409 });
  }
  const { rows } = await query(
    `update census_runs
        set state = 'running', stop_requested = false, problem = null,
            resume_after = null, finished_at = null, last_seen_at = now()
      where id = $1 and state in ('paused', 'stopped', 'refused', 'waiting') returning *`, [id]);
  return rows[0] ?? null;
}

/**
 * Today's spending, rolled over at 00:00 UTC.
 *
 * Counted from the slices rather than kept as a running total, because the
 * process restarts and a counter in memory would start again with it. The day
 * is UTC because Google's quota day is.
 */
async function rollDay(runId) {
  const { rows: [row] } = await query(
    `update census_runs r
        set day = (now() at time zone 'utc')::date,
            -- Every census slice asked today, by any run. The quota belongs to
            -- the project, so the budget has to as well.
            day_requests = coalesce((select sum(cs.requests)::int from census_slices cs
                                      where cs.ran_at >= date_trunc('day', now() at time zone 'utc')), 0)
      where r.id = $1
      returning day_requests, coalesce(daily_cap, $2) as daily_cap`, [runId, DAILY_CAP]);
  return { dayRequests: Number(row?.day_requests ?? 0), dailyCap: Number(row?.daily_cap ?? DAILY_CAP) };
}

/**
 * Stop, and say when to try again.
 *
 * A separate state from paused, because the difference matters to whoever is
 * watching: paused is waiting for a person, waiting is waiting for a clock.
 */
async function waitUntil(id, when, why) {
  await query(
    `update census_runs
        set state = 'waiting', resume_after = $2, problem = $3, last_seen_at = now()
      where id = $1`, [id, when, why]);
  await refreshProgress(id);
}

/** Tiles left, and what the run has spent so far. */
async function refreshProgress(runId) {
  // What this run asked, from the questions themselves.
  //
  // Not from the tile counters. A tile carries the whole of its history — which
  // is right for the ground and wrong for a run — and a tile re-opened to be
  // asked a drawer invented mid-run keeps the start of its original sweep, so
  // no filter on the tile can separate the two. The slices are dated one by
  // one, so this is exact: every question asked since the run began, inside its
  // own tiles.
  await query(
    `update census_runs r
        set tiles_total = t.total, tiles_done = t.done,
            requests = s.requests, slices = s.slices, saturated = s.saturated,
            places = p.places,
            -- What the census has asked today — all of it, whoever asked it,
            -- because the quota is the project's and not the region's.
            day_requests = coalesce((select sum(cs.requests)::int from census_slices cs
                                      where cs.ran_at >= date_trunc('day', now() at time zone 'utc')), 0),
            last_seen_at = now()
       from (select started_at as began from census_runs where id = $1) r0,
            (select count(*)::int total,
                    count(*) filter (where t2.state = 'done')::int done
               from census_tiles t2
               join census_run_tiles m on m.grid_key = t2.grid_key and m.run_id = $1) t,
            lateral (select coalesce(sum(cs.requests), 0)::int as requests,
                    count(*)::int as slices,
                    count(*) filter (where cs.saturated and cs.depth >= $2)::int as saturated
               from census_slices cs
              where cs.ran_at >= r0.began
                and cs.area_slug in (select grid_key from census_run_tiles where run_id = $1)) s,
            -- From the run's own record, which nothing later rewrites
            -- (migration 244). Counted from the surfacing table, a finished
            -- run's places fell the day the ground was swept again.
            (select count(distinct venue_ref)::int as places
               from census_run_surfacings where run_id = $1) p
      where r.id = $1`, [runId, CENSUS_MAX_DEPTH]);
}

/**
 * Take the next tile, under a lock.
 *
 * `for update skip locked` rather than a read then a write: two instances
 * reading first both saw the same tile and both censused it, which on a free
 * tier costs nothing visible and doubles the run's length.
 */
async function claimTile(run) {
  const { rows } = await query(
    `update census_tiles t
        set state = 'doing', claimed_at = now(), claimed_by = $2, run_id = $1,
            -- When this sweep of the tile began, which is what its place count
            -- is counted from. A tile part way through keeps its start: three
            -- passes of the loop are still one census of it. A tile coming
            -- round again after the freshness window starts afresh, and
            -- anything the last census found drops out of the count unless
            -- this one finds it too (Codex, 20 Sep 2026).
            started_at = case when t.done_subcategories = '{}'::text[] or t.started_at is null
                              then now() else t.started_at end
      where t.id = (
        select ct.id from census_tiles ct
         join census_run_tiles m on m.grid_key = ct.grid_key and m.run_id = $1
         where (ct.state = 'todo'
                -- A run of four hundred tiles will have one throw: a connection
                -- reset, a statement timeout, a deploy landing on an open
                -- transaction. Leaving it failed and unclaimable left the run
                -- run for ever, unable to claim its last tile and unable to finish
                -- (Codex, 21 Sep 2026). Three goes, then it is let go of out loud.
                or (ct.state = 'failed' and ct.failures < $4)
                or (ct.state = 'doing' and ct.claimed_at < now() - ($3 || ' milliseconds')::interval))
         order by ct.state desc, ct.min_lat, ct.min_lng
         for update skip locked
         limit 1)
      returning *`, [run.id, INSTANCE, String(STRANDED_AFTER_MS), MAX_TILE_TRIES]);
  return rows[0] ?? null;
}

/**
 * Tiles that finished before a drawer existed.
 *
 * Compared against the plan as it is now, not as it was when the run started:
 * the point is precisely that the taxonomy moved underneath it.
 */
async function reopenForNewDrawers(runId) {
  const plan = await slicePlan();
  if (!plan.length) return { reopened: 0 };
  const keys = plan.map((p) => p.subcategory);
  const { rowCount } = await query(
    `update census_tiles t
        set state = 'todo'
       from census_run_tiles m
      where m.grid_key = t.grid_key and m.run_id = $1
        and t.state = 'done'
        and not (t.done_subcategories @> $2::text[])`,
    [runId, keys]);
  return { reopened: rowCount };
}

/**
 * The signature of the plan: every question, in order, as one string.
 *
 * A question is a type *and* the words sent with it. Keyed on the type alone,
 * "sports_activity_location + climbing wall" and "sports_activity_location +
 * bouldering centre" are the same question — and those are exactly the drawers
 * Google has no word for, which is where the whole risk lives (Codex, 21 Sep
 * 2026, on the detector next door).
 */
const signatureOf = (plan) => plan
  .flatMap((p) => p.questions.map((q) => `${p.subcategory}|${q.type ?? ''}|${q.words ?? q.type ?? ''}`))
  .sort()
  .join('\n');

/**
 * Tiles finished before a drawer's questions changed.
 *
 * Not the same thing as a new drawer, and the difference cost twenty tiles this
 * morning: a typed rule for High ropes & zip lines landed an hour and a half
 * into the London run, and those tiles were already done with the drawer marked
 * answered, so nothing would ever have asked them the new question. The
 * region's ropes number would have been a sum of two different questions
 * wearing one name.
 *
 * Only the drawers whose questions moved, and only on the tiles that missed
 * them: the checkpoint keeps everything else, so a tile re-opened this way pays
 * for one question rather than two hundred and eighty-one.
 *
 * Reconciling every tile against every question is a hundred and thirty
 * thousand probes, so it runs when the plan has actually changed and not once a
 * minute. The run remembers the signature it last reconciled against.
 */
async function reopenForChangedQuestions(runId) {
  const plan = await slicePlan();
  if (!plan.length) return { reopened: 0 };
  const signature = signatureOf(plan);
  const { rows: [run] } = await query('select plan_signature from census_runs where id = $1', [runId]);
  if (run?.plan_signature === signature) return { reopened: 0, unchanged: true };

  const subs = []; const types = []; const queries = [];
  for (const p of plan) {
    for (const q of p.questions) {
      subs.push(p.subcategory);
      types.push(q.type ?? null);
      // What `sliceDown` writes: the words where there are words, the type's
      // own words otherwise. The pair is the question.
      queries.push(q.words ?? q.type);
    }
  }

  const { rows } = await query(
    `with plan as (
       select * from unnest($2::text[], $3::text[], $4::text[]) as p(subcategory, gtype, q)
     ), short as (
       select t.grid_key, array_agg(distinct p.subcategory) as drawers
         from census_tiles t
         join plan p on p.subcategory = any(t.done_subcategories)
        -- Every tile carrying a checkpoint, not only the finished ones.
        --
        -- Keyed on done alone, a tile part way through — or one the
        -- drawer-level re-open had just put back to todo — kept its
        -- checkpointed drawers unreconciled, and the signature was stored
        -- anyway: every later pass then took the fast path and that drawer was
        -- never re-asked (Codex, 21 Sep 2026). A tile in flight is left to its
        -- own worker and the signature is withheld until it lands.
        where t.run_id = $1 and t.state <> 'doing'
          and t.done_subcategories <> '{}'::text[]
          and not exists (
            select 1 from census_slices s
             where s.area_slug = t.grid_key
               and s.subcategory = p.subcategory
               and s.google_type is not distinct from p.gtype
               and s.query is not distinct from p.q
               -- A refused slice is a question that was asked and not
               -- answered, which is not an answer to re-map.
               and s.problem is null
               and s.ran_at >= coalesce(t.started_at, t.censused_at))
        group by t.grid_key
     )
     update census_tiles t
        set state = 'todo',
            done_subcategories = coalesce(
              (select array_agg(d) from unnest(t.done_subcategories) d
                where d <> all (short.drawers)), '{}'::text[])
       from short
      where short.grid_key = t.grid_key
      returning t.grid_key`, [runId, subs, types, queries]);

  // Only once nothing is in flight. A tile being worked now cannot be
  // reconciled — its own worker will write the checkpoint it loaded, over
  // anything done to it here — so the signature is withheld and the next pass
  // picks it up. Storing it regardless is what made the fast path permanent.
  const { rows: [busy] } = await query(
    `select count(*)::int n from census_tiles t
       join census_run_tiles m on m.grid_key = t.grid_key and m.run_id = $1
      where t.state = 'doing'`, [runId]);
  if (!busy.n) await query('update census_runs set plan_signature = $2 where id = $1', [runId, signature]);
  return { reopened: rows.length, deferred: Boolean(busy.n) };
}

/** A rate limiter that is a rate, not a sleep between tiles. */
const paceAt = (perSec) => {
  const gap = perSec > 0 ? 1000 / perSec : 0;
  let next = 0;
  return async () => {
    if (!gap) return;
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + gap;
    if (wait) await new Promise((r) => setTimeout(r, wait));
  };
};

/**
 * Work the run for a while, then hand the process back.
 *
 * Deliberately time-boxed. This runs inside the API process, which is also
 * answering households, and a deploy lands in this tree every few minutes — so
 * the most a restart can cost is the tile in flight, and even that resumes at
 * the drawer it reached.
 */
export async function advance({ runId = null, budgetMs = SLICE_MS, now = () => Date.now() } = {}) {
  const { rows: [run] } = runId
    ? await query(`select * from census_runs where id = $1`, [runId])
    : await query(`select * from census_runs where state = 'running' order by started_at limit 1`);
  if (!run || run.state !== 'running') return { working: false, reason: run ? run.state : 'nothing running' };

  const until = now() + budgetMs;
  const pace = paceAt(Number(run.rate_per_sec));
  let tiles = 0;
  // A drawer that did not exist when the tile was censused.
  //
  // The taxonomy is being rewritten while this runs — drawers are split, words
  // are moved, subcategories are created — and the policy's promise that "a
  // taxonomy change re-maps for free" is only true for *filing*. A brand new
  // drawer is a brand new question, and a tile already marked done would never
  // be asked it: the run would finish with its earliest tiles missing whatever
  // was invented after they ran, and nothing would say so.
  //
  // So a finished tile that does not cover the current plan is work again. It
  // costs only the new drawer, because the checkpoint is what it already
  // answered, and it keeps its `started_at` — one census of that tile, carried
  // on, not a second one.
  await reopenForNewDrawers(run.id);
  await reopenForChangedQuestions(run.id);

  while (now() < until) {
    const { rows: [fresh] } = await query(
      `select stop_requested, requests, max_requests, daily_cap, day, day_requests
         from census_runs where id = $1`, [run.id]);
    if (fresh?.stop_requested) {
      await finish(run.id, 'stopped', null);
      return { working: false, reason: 'stopped', tiles };
    }
    if (fresh && fresh.requests >= fresh.max_requests) {
      await finish(run.id, 'paused', `stopped at the ${fresh.max_requests}-request ceiling; resume to carry on`);
      return { working: false, reason: 'ceiling', tiles };
    }
    // The day's allowance, spent before Google has to refuse it. A quota is a
    // promise about a day, and a client that waits to be told no has already
    // spent somebody's goodwill — so the run stops itself and picks up at the
    // reset (owner, 21 Sep 2026).
    const today = await rollDay(run.id);
    if (today.dayRequests >= today.dailyCap) {
      const back = nextUtcMidnight();
      await waitUntil(run.id, back,
        `${today.dayRequests.toLocaleString('en-GB')} requests today, which is the ${today.dailyCap.toLocaleString('en-GB')} assumed daily cap; back at ${back.toISOString().slice(11, 16)} UTC`);
      return { working: false, reason: 'daily cap', resumeAfter: back, tiles };
    }

    const tile = await claimTile(run);
    if (!tile) {
      await refreshProgress(run.id);
      // A tile given up on is not outstanding. It is on the record as failed,
      // with its reason and its three attempts, and the run is allowed to end.
      const { rows: [left] } = await query(
        `select count(*) filter (where t.state <> 'done' and not (t.state = 'failed' and t.failures >= $2))::int outstanding
           from census_tiles t
           join census_run_tiles m on m.grid_key = t.grid_key and m.run_id = $1`, [run.id, MAX_TILE_TRIES]);
      if (!left.outstanding) { await finish(run.id, 'done', null); return { working: false, reason: 'done', tiles }; }
      return { working: true, reason: 'every tile is claimed', tiles };
    }

    const out = await censusOneTile({
      run, tile, pace,
      // The smaller of what the run has left and what the day has left.
      //
      // Handing the tile the run's allowance meant a tile starting at 74,999 of
      // 75,000 could ask its way through a whole drawer before the daily check
      // came round again — so the client would meet the 429 it exists to avoid
      // (Codex, 21 Sep 2026). The budget is only a budget if it is spent
      // against.
      remaining: Math.min(
        Math.max(0, (fresh?.max_requests ?? run.max_requests) - (fresh?.requests ?? 0)),
        Math.max(0, today.dailyCap - today.dayRequests),
      ),
      // The deadline goes *into* the tile, not around it. A tile of central
      // London is twenty minutes of asking, and a budget checked only between
      // tiles meant the pass ran for as long as the tile did — so a deploy
      // landing in the middle threw away two thousand answered requests that
      // nothing had written down yet.
      until,
      stopping: async () => {
        const { rows: [now] } = await query(
          'select stop_requested from census_runs where id = $1', [run.id]);
        return Boolean(now?.stop_requested);
      },
    });
    tiles += 1;
    await refreshProgress(run.id);

    // The ledger, read rather than trusted.
    //
    // §4: "Ledger everything in `provider_calls` as usual, with the expectation
    // that the cost column reads zero — and alert if it does not, because a
    // non-zero figure means something is running at the wrong field mask." At a
    // hundred thousand requests the difference between the free tier and Pro is
    // the difference between nothing and three thousand pounds, so this is not
    // a warning to log: the run stops on the first penny and waits for a
    // person. The alarm is checked after each tile because a tile is the most
    // that can be spent before somebody could have noticed.
    const spent = await spentSince(run.started_at);
    if (spent > 0) {
      await finish(run.id, 'paused',
        `stopped on the first penny: the census ledgered $${spent.toFixed(4)}, and IDs Only is free — something is asking Google for a field the census may not buy`);
      return { working: false, reason: 'billed', spent, tiles };
    }
    if (out.refused) {
      // A refusal is the provider telling the whole run to stop, not one tile
      // failing. The first ring census fired 9,321 doomed requests past a daily
      // cap because nothing read the answer (sources/census.js) — and a run
      // that retries against a refusal spends the whole of the next day's
      // allowance proving the same point. So: stop, keep what it said word for
      // word, and come back after the reset (owner, 21 Sep 2026).
      const back = nextUtcMidnight();
      await query(
        `update census_runs set refusal = $2, refused_at = now() where id = $1`,
        [run.id, String(out.refused).slice(0, 500)]);
      await waitUntil(run.id, back, `Google refused: ${String(out.refused).slice(0, 200)}`);
      return { working: false, reason: 'refused', problem: out.refused, resumeAfter: back, tiles };
    }
  }
  await query(`update census_runs set last_seen_at = now() where id = $1`, [run.id]);
  return { working: true, tiles };
}

/**
 * One tile, a drawer at a time, written down as it goes.
 *
 * The checkpoint the brief asks for is "per tile per subcategory", and the
 * reason is this: a tile of central London is two thousand requests and twenty
 * minutes of asking. Censusing the whole tile in one call meant nothing was
 * written until the end, so a deploy in the middle — and deploys land in this
 * tree every few minutes — threw away every answer it had already been given.
 * A drawer at a time costs one extra plan query per drawer, which is nothing
 * beside the several hundred Google calls it saves on a restart.
 */
async function censusOneTile({ run, tile, pace, remaining, until = Infinity, stopping = null }) {
  const done = new Set(tile.done_subcategories ?? []);
  const box = {
    minLat: Number(tile.min_lat), minLng: Number(tile.min_lng),
    maxLat: Number(tile.max_lat), maxLng: Number(tile.max_lng),
  };

  const plan = await slicePlan();
  const left = plan.map((p) => p.subcategory).filter((key) => !done.has(key));
  if (!left.length) {
    await query(
      `update census_tiles set state = 'done', censused_at = coalesce(censused_at, now()),
                               claimed_at = null, claimed_by = null
        where id = $1`, [tile.id]);
    return { requests: 0, places: 0 };
  }

  let spentHere = 0;
  let refused = null;
  let ranOut = false;
  for (const subcategory of left) {
    if (Date.now() >= until) break;
    if (spentHere >= remaining) { ranOut = true; break; }
    if (stopping && await stopping()) break;

    let out;
    try {
      out = await censusArea({
        // The tile is the area of record. Its counts are not written to the
        // board — an outcode is what a person browses, and `rollUpOutcodes`
        // derives those from the tiles afterwards.
        areaSlug: tile.grid_key,
        outcode: null,
        box,
        subcategories: [subcategory],
        maxRequests: Math.max(1, remaining - spentHere),
        pace,
        rollUpCounts: false,
        censusRunId: run.id,
      });
    } catch (err) {
      await query(
        `update census_tiles
          set state = 'failed', failures = failures + 1, problem = $2,
              claimed_at = null, claimed_by = null
        where id = $1`,
      [tile.id, String(err.message).slice(0, 200)]);
      return { problem: err.message, requests: spentHere };
    }

    spentHere += out.requests ?? 0;
    // Only a drawer that was actually carried through. A run that stopped at
    // its ceiling used to roll the whole plan up anyway, which wrote nought
    // against drawers it never reached (Codex, 19 Sep 2026) — here it would
    // checkpoint them as done and they would never be asked again.
    const finished = (out.done ?? []).includes(subcategory);
    if (finished) done.add(subcategory);

    await query(
      `update census_tiles
          set done_subcategories = $2,
              requests = requests + $3,
              slices = slices + $4,
              -- Counted, not added up. A place found by three drawers is one
              -- place in this tile, and adding each drawer's total would have
              -- made the run's headline number a count of surfacings wearing
              -- the word "places" — the same mistake as 135 rows for 65 places
              -- (repositories/censusRing.js).
              -- Counted, not added up, and counted from when this sweep began.
              -- A place found by three drawers is one place (135 rows for 65
              -- places was that mistake in the ring count); and a surfacing
              -- left over from the last census of this tile is not something
              -- this one found, however legitimately the row is kept.
              places = (select count(distinct venue_ref)::int from place_subcategories
                         where area_slug = census_tiles.grid_key
                           and last_seen >= coalesce(census_tiles.started_at, census_tiles.claimed_at, now())),
              saturated = saturated + $5,
              problem = coalesce($6, problem)
        where id = $1`,
      [tile.id, [...done], out.requests ?? 0, out.slices ?? 0, out.saturated ?? 0,
        out.problems?.length ? out.problems.slice(0, 2).join(' · ').slice(0, 300) : null]);

    if (out.refused) { refused = out.refused; break; }
    if (out.stopped) { ranOut = true; break; }
  }

  const everything = plan.every((p) => done.has(p.subcategory));
  await query(
    `update census_tiles
        set state = $2,
            censused_at = case when $2 = 'done' then now() else censused_at end,
            claimed_at = null, claimed_by = null
      where id = $1`, [tile.id, everything ? 'done' : 'todo']);

  return { refused, requests: spentHere, ranOut };
}

/**
 * What the census has been charged since a moment, in dollars.
 *
 * Only the census's own purpose. Households are searching and paying for
 * display calls the whole time this runs, and reading the whole ledger would
 * see their spending and stop a run that had cost nothing.
 */
async function spentSince(startedAt) {
  const { rows: [row] } = await query(
    `select coalesce(sum(estimated_cost_usd), 0)::float as usd
       from provider_calls
      where purpose = 'census.slice' and created_at >= $1`, [startedAt]);
  return Number(row?.usd ?? 0);
}

async function finish(id, state, problem) {
  const { rows: [run] } = await query(
    `update census_runs set state = $2, problem = $3, finished_at = now(), last_seen_at = now(), stop_requested = false
      where id = $1 returning started_at`, [id, state, problem]);
  await refreshProgress(id);
  // A run that got to the end is rolled onto the board and into every ring
  // counted before it began (Codex, 24 Sep 2026: a home that asked for its
  // districts to be censused kept reading the snapshot taken before the census
  // had found anything). The roll-up is the run's own outcodes, as the button
  // on the board would do; the rings are recounted behind it, never awaited —
  // a ring is a few reads of our own tables, and a run touches nothing else.
  if (state === 'done' && run?.started_at) {
    await rollUpOutcodes({ runId: id }).catch((err) => console.warn(`epic-api: census — could not roll up run ${id}: ${err.message}`));
    void refreshRingsBefore({ before: run.started_at, limit: 1000 }).catch(() => {});
  }
}

/**
 * Pick up a run whose process went away.
 *
 * Deploys land in this tree minutes apart, so this is not an edge case — it is
 * the normal way a run of thirty hours proceeds. A tile left claimed by a dead
 * process is released by the claim's own age; this only has to notice that the
 * run is still meant to be going.
 */
export async function resumeInterrupted() {
  // A run waiting for the quota day to turn over, whose clock has come round.
  // Automatic, because the owner asked for it to be — "resume automatically
  // after the 00:00 UTC reset" — and because a run that needs a person at
  // midnight is a run that loses a day (21 Sep 2026).
  const { rows: woken } = await query(
    `update census_runs
        set state = 'running', resume_after = null, problem = null,
            day = (now() at time zone 'utc')::date, day_requests = 0, last_seen_at = now()
      where state = 'waiting' and resume_after is not null and resume_after <= now()
        -- Never into a region somebody else is working. Starting refuses while
        -- a run waits, so this should not arise — but a clock that wakes a run
        -- regardless of what else is going is the half of the pair that turns a
        -- refused start into two live runs (Codex, 21 Sep 2026).
        and not exists (select 1 from census_runs other where other.state = 'running')
      returning id, label`);

  const { rows } = await query(
    `select id, label, last_seen_at from census_runs
      where state = 'running' and last_seen_at < now() - ($1 || ' milliseconds')::interval`,
    [String(STRANDED_AFTER_MS)]);
  if (!rows.length) return { resumed: 0, woken: woken.length, runs: woken };
  await query(
    `update census_tiles set state = 'todo', claimed_at = null, claimed_by = null
      where run_id = any($1) and state = 'doing' and claimed_at < now() - ($2 || ' milliseconds')::interval`,
    [rows.map((r) => r.id), String(STRANDED_AFTER_MS)]);
  return { resumed: rows.length, woken: woken.length, runs: [...rows, ...woken] };
}

/** What a run looks like to somebody watching it. */
export async function list({ limit = 10 } = {}) {
  const { rows } = await query(
    `select r.*,
            (select count(*) filter (where t.state = 'failed')::int from census_tiles t
               join census_run_tiles m on m.grid_key = t.grid_key and m.run_id = r.id) as tiles_failed
       from census_runs r order by started_at desc limit $1`, [Math.min(50, limit)]);
  return rows;
}

/**
 * Tiles back to outcodes, which is what a person browses.
 *
 * The brief, §4: "Map results back to outcodes afterwards for reporting." It
 * has to be *afterwards* and it has to be arithmetic, because the census is
 * IDs Only: a place has no coordinate of its own until a display search buys
 * one. What it has is the box it was found in — `place_index.slice`, written
 * on every place the census sees — and a box can be tested against an outcode
 * the same way `censusRing` tests one against a ring.
 *
 * Three verdicts, and the third is the honest one (owner, 20 Sep 2026: "Do not
 * discard them. Resolve them, then count them"):
 *
 *   · the box sits wholly inside the outcode — counted;
 *   · wholly outside — not counted;
 *   · across its edge — **unresolved**, kept in its own column and shown as a
 *     floor. Splitting the saturated slices is what shrinks it; dropping it
 *     silently is what makes a board undercount without saying so.
 *
 * The coverage goes on the row beside the count, because §5 is not a nicety:
 * "A count of 2,400 for a subcategory means nothing without knowing what was
 * covered." A count drawn from four tiles of which one was cut off at sixty is
 * a different number from the same count out of four clean ones.
 */
export async function rollUpOutcodes({ outcodes = null, runId = null } = {}) {
  const codes = outcodes?.length
    ? outcodes.map((c) => String(c).toUpperCase())
    : (await query(
      `select distinct unnest(t.outcodes) as code from census_tiles t
         ${runId ? 'join census_run_tiles m on m.grid_key = t.grid_key and m.run_id = $1' : ''}
        where t.censused_at is not null`,
      runId ? [runId] : [])).rows.map((r) => r.code);
  if (!codes.length) return { outcodes: 0, rows: 0 };

  // Every sector of every outcode these tiles touch. The verdict is a
  // nearest-sector test, so the candidate set has to include the neighbours —
  // otherwise every box on the edge of the region reads as inside it.
  const { rows: universe } = await query(
    `select code, upper(outcode) as outcode, lat, lng from geo_cells
      where outcode is not null
        and upper(outcode) in (
          select distinct unnest(t.outcodes) from census_tiles t where t.outcodes && $1)`,
    [codes]);
  if (!universe.length) return { outcodes: 0, rows: 0 };

  let written = 0;
  for (const code of codes) {
    // Asked about one run, answer about that run. Rolling every censused tile
    // carrying the outcode meant another run's tiles in an overlapping district
    // were counted into this one's result (Codex, 21 Sep 2026).
    const { rows: tiles } = await query(
      `select t.grid_key, t.saturated, t.censused_at, t.state from census_tiles t
         ${runId ? 'join census_run_tiles m on m.grid_key = t.grid_key and m.run_id = $2' : ''}
        where t.outcodes @> array[$1] and t.censused_at is not null`,
      runId ? [code, runId] : [code]);
    if (!tiles.length) continue;
    const keys = tiles.map((t) => t.grid_key);

    // Only what the current census of each tile found. A surfacing is kept
    // after its question stops finding it — "this used to be here" is worth
    // keeping — but a board counting those would report a district as growing
    // every time it was re-censused, however many places had closed.
    const { rows } = await query(
      `select ps.category, ps.subcategory, ps.venue_ref, ps.sourced, pi.lat, pi.lng, pi.slice
         from place_subcategories ps
         join place_index pi on pi.venue_ref = ps.venue_ref
         join census_tiles t on t.grid_key = ps.area_slug
        where ps.area_slug = any($1)
          and ps.last_seen >= coalesce(t.started_at, t.censused_at)`, [keys]);

    const mine = new Set(universe.filter((u) => u.outcode === code).map((u) => u.code));
    if (!mine.size) continue;

    const verdicts = new Map();
    const verdictOf = (slice) => {
      if (verdicts.has(slice)) return verdicts.get(slice);
      const v = whereBoxSits(boxFromSlice(slice), { cells: mine, universe });
      verdicts.set(slice, v);
      return v;
    };
    const nearest = (lat, lng) => {
      let best = null; let bestD = Infinity;
      for (const u of universe) {
        const d = (u.lat - lat) ** 2 + (u.lng - lng) ** 2;
        if (d < bestD) { bestD = d; best = u; }
      }
      return best?.code ?? null;
    };

    const counted = new Map();
    const unresolved = new Map();
    const drawer = new Map();
    // How each drawer's places were found. A count made of text-query answers
    // is a different kind of number from one Google guaranteed the type of, and
    // it says so wherever it is shown (owner, 21 Sep 2026).
    const sourcedBy = new Map();
    const fromText = new Map();
    const add = (map, key, ref) => {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(ref);
    };
    for (const r of rows) {
      const key = `${r.category}/${r.subcategory}`;
      drawer.set(key, { category: r.category, subcategory: r.subcategory });
      // Its own point beats any box: that is exact, and a display search will
      // have bought one for anything a household has actually looked at.
      const inside = (r.lat != null && r.lng != null)
        ? (mine.has(nearest(Number(r.lat), Number(r.lng))) ? 'inside' : 'outside')
        : (r.slice ? verdictOf(r.slice) : 'nowhere');
      if (inside === 'inside') {
        add(counted, key, r.venue_ref);
        // How it was found, counted only where it is counted.
        //
        // A tile is wider than an outcode and reaches into its neighbours, so
        // reading the label off every row in the tile let a drawer be marked
        // "mixed", or even "text", on the strength of places in the next
        // district — a caveat attached to a number that none of those places
        // are in (21 Sep 2026).
        if (!sourcedBy.has(key)) sourcedBy.set(key, new Set());
        sourcedBy.get(key).add(r.sourced ?? 'type');
        if ((r.sourced ?? 'type') === 'text') add(fromText, key, r.venue_ref);
      } else if (inside === 'across') {
        add(unresolved, key, r.venue_ref);
      }
    }

    const censusedAt = tiles.map((t) => new Date(t.censused_at).getTime()).sort((a, b) => a - b);
    const saturatedTiles = tiles.filter((t) => Number(t.saturated) > 0).length;
    const complete = tiles.every((t) => t.state === 'done');
    for (const [key, { category, subcategory }] of drawer) {
      const refs = counted.get(key) ?? new Set();
      const { rows: [scored] } = refs.size
        ? await query('select count(*)::int n from epic_scores where venue_ref = any($1)', [[...refs]])
        : { rows: [{ n: 0 }] };
      const kinds = [...(sourcedBy.get(key) ?? ['type'])];
      await query(
        `insert into area_counts (area_slug, category, subcategory, census_count, surfaced_count, scored_count,
                                  saturated, censused_at, complete, tiles, tiles_saturated, unresolved,
                                  sourced, text_count)
         values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (area_slug, category, subcategory) do update
            set census_count = excluded.census_count, surfaced_count = excluded.surfaced_count,
                scored_count = excluded.scored_count, saturated = excluded.saturated,
                censused_at = excluded.censused_at, complete = excluded.complete,
                tiles = excluded.tiles, tiles_saturated = excluded.tiles_saturated,
                unresolved = excluded.unresolved,
                sourced = excluded.sourced, text_count = excluded.text_count`,
        [code.toLowerCase(), category, subcategory, refs.size, scored.n, saturatedTiles,
          // The oldest tile, not the newest: a count is only as fresh as the
          // stalest ground it is drawn from.
          new Date(censusedAt[0]), complete,
          tiles.length, saturatedTiles, unresolved.get(key)?.size ?? 0,
          // One word where a drawer was answered one way, "mixed" where it was
          // not — and how many of the places came from a text query either way,
          // because that is the number a person is being asked to trust.
          kinds.length === 1 ? kinds[0] : 'mixed', fromText.get(key)?.size ?? 0]);
      written += 1;
    }
  }
  return { outcodes: codes.length, rows: written };
}

/** `51.4000,-0.7000,51.4800,-0.5800` back into a box. */
const boxFromSlice = (slice) => {
  const n = String(slice ?? '').split(',').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return null;
  return { minLat: n[0], minLng: n[1], maxLat: n[2], maxLng: n[3] };
};

/**
 * What a run did, by postcode area and in total.
 *
 * Owner, 21 September 2026: "Report per area and in total; ledger cost from
 * `provider_calls`." So the money is read out of the ledger rather than
 * asserted from the tier the code believes it used — the two have disagreed
 * before, and the ledger is the one that would show it.
 *
 * A postcode area is the letters of an outcode: SE1 and SE22 are both SE. A
 * tile can touch two areas, so its requests are attributed to each area it
 * touches and the total is taken from the tiles themselves rather than by
 * adding the areas up — otherwise a boundary tile is counted twice, which is
 * the same double count the census fixed one level down.
 */
export async function report(runId = null) {
  const { rows: [run] } = runId
    ? await query('select * from census_runs where id = $1', [runId])
    : await query("select * from census_runs order by started_at desc limit 1");
  if (!run) return null;

  // One row per area per tile, *distinct*, before anything is added up: a tile
  // touching SE1 and SE11 is one SE tile, and summing over the outcodes counted
  // its requests twice (21 Sep 2026).
  //
  // And the work is counted from the questions asked, exactly as the total
  // below is. Summing the tile counters here attributed an earlier census's
  // requests to this run for every tile it skipped as fresh, so the areas and
  // the total disagreed with each other in the same report (Codex, 21 Sep
  // 2026).
  const { rows: areas } = await query(
    `with mine as (
       -- The ground this run was given. Membership, not the claim: a later run
       -- over the same country takes run_id and would otherwise empty this
       -- half of the report while the total, which already read membership,
       -- went on saying what it asked — one report disagreeing with itself
       -- (Codex, 23 Sep 2026).
       select t.* from census_tiles t
        join census_run_tiles m on m.grid_key = t.grid_key and m.run_id = $1
     ), touching as (
       select distinct upper(substring(o from '^[A-Z]+')) as area,
              t.grid_key, t.state, t.censused_at
         from mine t
         cross join lateral unnest(t.outcodes) as o
     ), districts as (
       select upper(substring(o from '^[A-Z]+')) as area, count(distinct o)::int as outcodes
         from mine t
         cross join lateral unnest(t.outcodes) as o
        group by 1
     ), spent as (
       select cs.area_slug as grid_key,
              sum(cs.requests)::int as requests,
              count(*) filter (where cs.saturated and cs.depth >= $3)::int as saturated
         from census_slices cs
        where cs.ran_at >= $2 and cs.ran_at <= $4
          and cs.area_slug in (select grid_key from census_run_tiles where run_id = $1)
        group by 1
     ), found as (
       select grid_key, count(distinct venue_ref)::int as places
         from census_run_surfacings where run_id = $1
        group by 1
     )
     select tt.area,
            d.outcodes,
            count(*)::int                                    as tiles,
            count(*) filter (where tt.state = 'done')::int     as done,
            count(*) filter (where tt.state = 'failed')::int   as failed,
            coalesce(sum(sp.requests), 0)::int                as requests,
            coalesce(sum(fo.places), 0)::int                  as places,
            coalesce(sum(sp.saturated), 0)::int               as saturated,
            min(tt.censused_at)                               as first_seen,
            max(tt.censused_at)                               as last_seen
       from touching tt
       join districts d on d.area = tt.area
       left join spent sp on sp.grid_key = tt.grid_key
       left join found fo on fo.grid_key = tt.grid_key
      group by tt.area, d.outcodes
      order by tt.area`, [run.id, run.started_at, CENSUS_MAX_DEPTH, run.finished_at ?? new Date()]);

  // Every tile once, whatever it touches — and separately, what this run
  // actually asked. A tile still fresh from an earlier census is skipped rather
  // than swept, so its requests belong to that census and its places belong to
  // the ground.
  const { rows: [whole] } = await query(
    `select count(*)::int tiles,
            count(*) filter (where t.state = 'done')::int done,
            count(*) filter (where t.state = 'failed')::int failed,
            count(*) filter (where t.started_at < $2)::int skipped,
            -- Between this run starting and this run ending. Membership keeps
            -- the ground; it does not keep the *time*, so without the upper
            -- bound every later census over the same tiles was added to this
            -- run's totals and a finished report grew after the fact (Codex,
            -- 23 Sep 2026). The spend query already had it; these did not.
            coalesce((select sum(cs.requests)::int from census_slices cs
                       where cs.ran_at >= $2 and cs.ran_at <= $3
                         and cs.area_slug in (select grid_key from census_run_tiles where run_id = $1)), 0) as requests,
            coalesce((select count(distinct venue_ref)::int from census_run_surfacings where run_id = $1), 0) as places,
            coalesce((select count(*)::int from census_slices cs
                       where cs.ran_at >= $2 and cs.ran_at <= $3
                         and cs.area_slug in (select grid_key from census_run_tiles where run_id = $1)), 0) as slices,
            coalesce(sum(t.saturated), 0)::int saturated,
            coalesce(sum(t.requests), 0)::int ground_requests,
            coalesce(sum(t.places), 0)::int ground_places
       from census_tiles t
       join census_run_tiles m on m.grid_key = t.grid_key and m.run_id = $1`,
    [run.id, run.started_at, run.finished_at ?? new Date()]);

  // The money, from the ledger and nowhere else.
  const { rows: [spend] } = await query(
    `select count(*)::int rows,
            coalesce(sum(estimated_cost_usd), 0)::float usd,
            coalesce(sum((units->>'google')::int), 0)::int requests,
            coalesce(sum((units->>'google-essentials')::int), 0)::int essentials,
            coalesce(sum((units->>'google-pro')::int), 0)::int pro,
            coalesce(sum((units->>'google-search')::int), 0)::int search
       from provider_calls
      -- Between the run starting and the run ending. Without the second bound
      -- an old run's cost grew every time a later one asked Google, which is a
      -- report that changes after the fact (Codex, 21 Sep 2026).
      where purpose = 'census.slice' and created_at >= $1 and created_at <= $2`,
    [run.started_at, run.finished_at ?? new Date()]);

  // How the places were found, which is the thing the nine text-query drawers
  // exist to be judged on.
  const { rows: sourced } = await query(
    `select sourced,
            count(distinct venue_ref)::int as places,
            count(distinct subcategory)::int as drawers
       from census_run_surfacings
      where run_id = $1
      group by 1 order by 1`, [run.id]);

  return {
    run: {
      id: run.id,
      label: run.label,
      state: run.state,
      areas: run.areas,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      ratePerSec: Number(run.rate_per_sec),
      dailyCap: run.daily_cap,
      dayRequests: run.day_requests,
      resumeAfter: run.resume_after,
      // What Google said, word for word, if it ever refused. The owner asked
      // what the 429 says the limit actually is, and this is where it says it.
      refusal: run.refusal,
      refusedAt: run.refused_at,
      problem: run.problem,
    },
    total: {
      ...whole,
      // "Places the region is now known to hold", beside "places this run
      // found". They differ by whatever was already fresh.
      ground: { requests: whole.ground_requests, places: whole.ground_places },
      hours: run.started_at
        ? Math.round(((new Date(run.finished_at ?? Date.now()) - new Date(run.started_at)) / 3_600_000) * 10) / 10
        : null,
    },
    areas: areas.map((a) => ({
      area: a.area,
      outcodes: a.outcodes,
      tiles: a.tiles,
      done: a.done,
      failed: a.failed,
      requests: a.requests,
      places: a.places,
      saturated: a.saturated,
      firstSeen: a.first_seen,
      lastSeen: a.last_seen,
    })),
    sourced,
    ledger: {
      rows: spend.rows,
      requests: spend.requests,
      byTier: { essentials: spend.essentials, pro: spend.pro, search: spend.search },
      usd: spend.usd,
      gbp: Math.round(spend.usd * USD_TO_GBP * 10000) / 10000,
      // The claim the whole design rests on, checked rather than repeated.
      free: spend.usd === 0,
    },
  };
}
