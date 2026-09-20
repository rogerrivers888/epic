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
import { censusArea, CENSUS_FRESH_DAYS } from './census.js';
// The same corner test the ring count uses. One piece of arithmetic for "is
// this box inside this area", not two that can disagree (repositories/censusRing.js).
import { whereBoxSits } from '../repositories/censusRing.js';

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

/** How long one pass of the loop works before handing the process back. */
const SLICE_MS = Number(process.env.EPIC_CENSUS_SLICE_MS || 55_000);

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
export async function planTiles({ areas = [], outcodes = [], dLat = TILE_LAT, dLng = TILE_LNG } = {}) {
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
  const tiles = new Map();
  for (const r of rows) {
    const t = tileOf(Number(r.lat), Number(r.lng), dLat, dLng);
    const existing = tiles.get(t.gridKey) ?? { ...t, outcodes: new Set() };
    existing.outcodes.add(String(r.outcode).toUpperCase());
    tiles.set(t.gridKey, existing);
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
  dLat = TILE_LAT, dLng = TILE_LNG, startedBy = null,
} = {}) {
  if (!areas?.length && !outcodes?.length) {
    throw Object.assign(new Error('a run needs postcode areas or districts'), { status: 400 });
  }
  const { rows: going } = await query(
    `select id, label from census_runs where state = 'running' limit 1`);
  if (going.length) {
    throw Object.assign(new Error(`“${going[0].label}” is already running; stop it before starting another`), { status: 409 });
  }
  const tiles = await planTiles({ areas, outcodes, dLat, dLng });
  if (!tiles.length) throw Object.assign(new Error('no postcode sectors in those areas'), { status: 400 });

  const { rows: [run] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, started_by, tiles_total)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [label ?? [...areas, ...outcodes].join(', '),
      [...areas.map((a) => a.toUpperCase()), ...outcodes.map((o) => o.toUpperCase())], dLat, dLng,
      maxRequests, ratePerSec, freshDays, startedBy, tiles.length]);

  // Tiles outlive runs: the same square keeps its row and its history, and this
  // run simply claims the ones that are not fresh. `do update` on the outcodes
  // because the sector table moves and a stale list would misreport.
  for (const t of tiles) {
    await query(
      `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, run_id, state)
       values ($1,$2,$3,$4,$5,$6,$7,'todo')
       on conflict (grid_key) do update
          set outcodes = excluded.outcodes,
              run_id   = excluded.run_id,
              -- A tile censused inside the freshness window keeps its state, so
              -- the run walks past it. One outside it is work again.
              state    = case
                           when census_tiles.censused_at is not null
                            and census_tiles.censused_at > now() - ($8 || ' days')::interval
                           then census_tiles.state else 'todo' end,
              done_subcategories = case
                           when census_tiles.censused_at is not null
                            and census_tiles.censused_at > now() - ($8 || ' days')::interval
                           then census_tiles.done_subcategories else '{}'::text[] end`,
      [t.gridKey, t.minLat, t.minLng, t.maxLat, t.maxLng, t.outcodes, run.id, String(freshDays)]);
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
  const { rows } = await query(
    `update census_runs
        set state = 'running', stop_requested = false, problem = null,
            finished_at = null, last_seen_at = now()
      where id = $1 and state in ('paused', 'stopped', 'refused') returning *`, [id]);
  return rows[0] ?? null;
}

/** Tiles left, and what the run has spent so far. */
async function refreshProgress(runId) {
  await query(
    `update census_runs r
        set tiles_total = t.total, tiles_done = t.done,
            requests = t.requests, slices = t.slices, places = t.places, saturated = t.saturated,
            last_seen_at = now()
       from (select count(*)::int total,
                    count(*) filter (where state = 'done')::int done,
                    coalesce(sum(requests), 0)::int requests,
                    coalesce(sum(slices), 0)::int slices,
                    coalesce(sum(places), 0)::int places,
                    coalesce(sum(saturated), 0)::int saturated
               from census_tiles where run_id = $1) t
      where r.id = $1`, [runId]);
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
        set state = 'doing', claimed_at = now(), claimed_by = $2, run_id = $1
      where t.id = (
        select id from census_tiles
         where run_id = $1
           and (state = 'todo'
                or (state = 'doing' and claimed_at < now() - ($3 || ' milliseconds')::interval))
         order by state desc, min_lat, min_lng
         for update skip locked
         limit 1)
      returning *`, [run.id, INSTANCE, String(STRANDED_AFTER_MS)]);
  return rows[0] ?? null;
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

  while (now() < until) {
    const { rows: [fresh] } = await query(
      `select stop_requested, requests, max_requests from census_runs where id = $1`, [run.id]);
    if (fresh?.stop_requested) {
      await finish(run.id, 'stopped', null);
      return { working: false, reason: 'stopped', tiles };
    }
    if (fresh && fresh.requests >= fresh.max_requests) {
      await finish(run.id, 'paused', `stopped at the ${fresh.max_requests}-request ceiling; resume to carry on`);
      return { working: false, reason: 'ceiling', tiles };
    }

    const tile = await claimTile(run);
    if (!tile) {
      await refreshProgress(run.id);
      const { rows: [left] } = await query(
        `select count(*) filter (where state <> 'done')::int outstanding from census_tiles where run_id = $1`, [run.id]);
      if (!left.outstanding) { await finish(run.id, 'done', null); return { working: false, reason: 'done', tiles }; }
      return { working: true, reason: 'every tile is claimed', tiles };
    }

    const out = await censusOneTile({ run, tile, pace, remaining: Math.max(0, (fresh?.max_requests ?? run.max_requests) - (fresh?.requests ?? 0)) });
    tiles += 1;
    await refreshProgress(run.id);
    if (out.refused) {
      // A refusal is the provider telling the whole run to stop, not one tile
      // failing. The first ring census fired 9,321 doomed requests past a daily
      // cap because nothing read the answer (sources/census.js).
      await finish(run.id, 'refused', out.refused);
      return { working: false, reason: 'refused', problem: out.refused, tiles };
    }
  }
  await query(`update census_runs set last_seen_at = now() where id = $1`, [run.id]);
  return { working: true, tiles };
}

/** One tile: the drawers it has not done yet, then the checkpoint. */
async function censusOneTile({ run, tile, pace, remaining }) {
  const done = new Set(tile.done_subcategories ?? []);
  const box = {
    minLat: Number(tile.min_lat), minLng: Number(tile.min_lng),
    maxLat: Number(tile.max_lat), maxLng: Number(tile.max_lng),
  };

  let out;
  try {
    out = await censusArea({
      // The tile is the area of record. Its counts are not written to the board
      // — an outcode is what a person browses, and the roll-up derives those.
      areaSlug: tile.grid_key,
      outcode: null,
      box,
      maxRequests: Math.max(1, remaining),
      pace,
      rollUpCounts: false,
    });
  } catch (err) {
    await query(
      `update census_tiles set state = 'failed', problem = $2, claimed_at = null, claimed_by = null where id = $1`,
      [tile.id, String(err.message).slice(0, 200)]);
    return { problem: err.message };
  }

  // Only the drawers that were actually carried through. A run that stopped at
  // its ceiling used to roll the whole plan up anyway, which wrote nought
  // against drawers it never reached (Codex, 19 Sep 2026) — here that would
  // checkpoint them as done and they would never be asked again.
  for (const key of out.done ?? []) done.add(key);
  const everything = (out.planned ?? []).every((key) => done.has(key));

  await query(
    `update census_tiles
        set state = $2,
            done_subcategories = $3,
            requests = requests + $4,
            slices = slices + $5,
            places = greatest(places, $6),
            saturated = saturated + $7,
            problem = $8,
            censused_at = case when $2 = 'done' then now() else censused_at end,
            claimed_at = null, claimed_by = null
      where id = $1`,
    [tile.id, everything ? 'done' : 'todo', [...done], out.requests ?? 0, out.slices ?? 0,
      out.noted ?? 0, out.saturated ?? 0, out.problems?.length ? out.problems.slice(0, 3).join(' · ').slice(0, 300) : null]);

  return { refused: out.refused ?? null, requests: out.requests ?? 0, places: out.noted ?? 0 };
}

async function finish(id, state, problem) {
  await query(
    `update census_runs set state = $2, problem = $3, finished_at = now(), last_seen_at = now(), stop_requested = false
      where id = $1`, [id, state, problem]);
  await refreshProgress(id);
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
  const { rows } = await query(
    `select id, label, last_seen_at from census_runs
      where state = 'running' and last_seen_at < now() - ($1 || ' milliseconds')::interval`,
    [String(STRANDED_AFTER_MS)]);
  if (!rows.length) return { resumed: 0 };
  await query(
    `update census_tiles set state = 'todo', claimed_at = null, claimed_by = null
      where run_id = any($1) and state = 'doing' and claimed_at < now() - ($2 || ' milliseconds')::interval`,
    [rows.map((r) => r.id), String(STRANDED_AFTER_MS)]);
  return { resumed: rows.length, runs: rows };
}

/** What a run looks like to somebody watching it. */
export async function list({ limit = 10 } = {}) {
  const { rows } = await query(
    `select r.*,
            (select count(*) filter (where state = 'failed')::int from census_tiles t where t.run_id = r.id) as tiles_failed
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
      `select distinct unnest(outcodes) as code from census_tiles
        where censused_at is not null ${runId ? 'and run_id = $1' : ''}`,
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
    const { rows: tiles } = await query(
      `select grid_key, saturated, censused_at, state from census_tiles
        where outcodes @> array[$1] and censused_at is not null`, [code]);
    if (!tiles.length) continue;
    const keys = tiles.map((t) => t.grid_key);

    const { rows } = await query(
      `select ps.category, ps.subcategory, ps.venue_ref, pi.lat, pi.lng, pi.slice
         from place_subcategories ps
         join place_index pi on pi.venue_ref = ps.venue_ref
        where ps.area_slug = any($1)`, [keys]);

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
    const add = (map, key, ref) => {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(ref);
    };
    for (const r of rows) {
      const key = `${r.category}/${r.subcategory}`;
      drawer.set(key, { category: r.category, subcategory: r.subcategory });
      // Its own point beats any box: that is exact, and a display search will
      // have bought one for anything a household has actually looked at.
      if (r.lat != null && r.lng != null) {
        if (mine.has(nearest(Number(r.lat), Number(r.lng)))) add(counted, key, r.venue_ref);
        continue;
      }
      if (!r.slice) continue;
      const v = verdictOf(r.slice);
      if (v === 'inside') add(counted, key, r.venue_ref);
      else if (v === 'across') add(unresolved, key, r.venue_ref);
    }

    const censusedAt = tiles.map((t) => new Date(t.censused_at).getTime()).sort((a, b) => a - b);
    const saturatedTiles = tiles.filter((t) => Number(t.saturated) > 0).length;
    const complete = tiles.every((t) => t.state === 'done');
    for (const [key, { category, subcategory }] of drawer) {
      const refs = counted.get(key) ?? new Set();
      const { rows: [scored] } = refs.size
        ? await query('select count(*)::int n from epic_scores where venue_ref = any($1)', [[...refs]])
        : { rows: [{ n: 0 }] };
      await query(
        `insert into area_counts (area_slug, category, subcategory, census_count, surfaced_count, scored_count,
                                  saturated, censused_at, complete, tiles, tiles_saturated, unresolved)
         values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (area_slug, category, subcategory) do update
            set census_count = excluded.census_count, surfaced_count = excluded.surfaced_count,
                scored_count = excluded.scored_count, saturated = excluded.saturated,
                censused_at = excluded.censused_at, complete = excluded.complete,
                tiles = excluded.tiles, tiles_saturated = excluded.tiles_saturated,
                unresolved = excluded.unresolved`,
        [code.toLowerCase(), category, subcategory, refs.size, scored.n, saturatedTiles,
          // The oldest tile, not the newest: a count is only as fresh as the
          // stalest ground it is drawn from.
          new Date(censusedAt[0]), complete,
          tiles.length, saturatedTiles, unresolved.get(key)?.size ?? 0]);
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
