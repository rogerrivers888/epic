/**
 * The walking and cycling matrices, routed over the road network with OSRM.
 *
 * Owner, 1 Oct 2026: "build OSRM walking and cycling on our GB OSM extract, as
 * a batch build (compute the matrices, then tear OSRM down, ~£0/month)."
 *
 * This is the half of the reach matrix that distance-from-a-straight-line
 * cannot do honestly. Driving was fitted against real road times and is good to
 * a p95 of seven minutes (`domain/travel.js`, 20 Sep 2026); walking and cycling
 * were never fitted, because a footpath network is not a scaled-down road one —
 * a towpath, a park, a bridge a car may not use all change the answer. So those
 * two modes are routed for real, once, over the OpenStreetMap extract, and the
 * answer is stored exactly like the estimator's: rows in `reach` keyed by mode,
 * a `cell_builds` marker per origin, a `reach_runs` row for the whole pass. The
 * only difference a reader sees is `method = 'osrm'` where the estimator writes
 * `'estimate'` (migration 139 reserved the column for exactly this).
 *
 * OSRM itself does not run in production. The matrices are computed in a batch,
 * written to Postgres, and then OSRM is torn down — the served path reads the
 * stored rows and never calls a router. `reach-osrm.mjs` at the repo root is the
 * operator entry point that stands OSRM up, calls `buildOsrmMode`, and stops it.
 *
 * Nothing licensed goes near it: OSM is ODbL, a cell is an ONS sector, and a
 * routed time over open data is our own derived fact, kept like any other.
 *
 * **One contract for whoever surfaces these rows.** Nothing on the household
 * display path asks for walking or cycling today — the picker offers driving
 * only — so these rows are written and read by nothing until that path is
 * wired. When it is: the display fence (`domain/band.js`'s `fenceToBand`, via
 * `routes/inspire.js`) recomputes `estimateTravelMinutes` to fence a list to the
 * band, and that estimator is the *driving* one's sibling, not OSRM. A place
 * OSRM routes inside the band but the straight-line estimate overstates — a
 * genuinely walkable 7km — would be dropped from the shown list though it is in
 * this matrix. So the routed minutes must be carried into the fence (or an
 * OSRM-backed ring must skip the estimator fence) at the same time as the mode
 * is offered. The rows here are correct; the fence that reads them is the piece
 * that has to learn `method = 'osrm'`.
 *
 * The same batch-2 moment needs the race `refreshWhileLocked` already handles:
 * a ring count that began before a rebuild can read the old reach and write its
 * stale total afterwards. There is no walking/cycling ring counter today (ring
 * counting is driving-only), so the per-origin invalidation below is enough for
 * now; when walk/cycle rings are first counted, the build must reconcile with a
 * recorded cutoff (force-recount rings counted before it), not lean on the
 * delete alone.
 */

import { pool, query } from '../db.js';
import { boundKm, HORIZON_MINUTES } from '../domain/reach.js';
import { kmBetween, travelMode } from '../domain/travel.js';
import { modeWriteLockKey } from '../repositories/reach.js';

/**
 * How much wider than the estimator's bound to cast the net for candidates.
 *
 * `boundKm` is derived from the straight-line estimator, and OSRM's foot profile
 * is a touch faster than the estimator's walking speed — so a route OSRM would
 * do inside the horizon can sit just past the estimator's bound and be filtered
 * out before OSRM is ever asked (Codex, P2). The candidate bound only decides
 * what to *ask* about; asking about a few cells OSRM then rejects is free, so it
 * is cast half again as wide and the horizon filter on the real routed time is
 * what actually decides.
 */
const CANDIDATE_SLACK = 1.5;

/**
 * An OSRM `/table` client, bound to one running `osrm-routed`.
 *
 * `osrm-routed` serves whichever profile it was built with; the profile word in
 * the path is only a label, so one base URL answers for whatever extract it was
 * handed. One origin against many destinations, durations and distances in one
 * request — the shape `buildOsrmMode` wants.
 */
export function osrmTable(baseUrl, { fetchImpl = fetch, profile = 'driving' } = {}) {
  const base = baseUrl.replace(/\/$/, '');
  return async function table(origin, dests) {
    if (!dests.length) return [];
    const coords = [origin, ...dests].map((c) => `${c.lng},${c.lat}`).join(';');
    const destIdx = dests.map((_, i) => i + 1).join(';');
    const url = `${base}/table/v1/${profile}/${coords}?sources=0&destinations=${destIdx}&annotations=duration,distance`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`osrm table ${res.status}`);
    const body = await res.json();
    // A well-formed answer is the only thing that counts as one: a body without
    // `code: 'Ok'` is a router that could not speak, not a table of zeroes
    // (CLAUDE.md, the can't-speak rule). Let the caller decide, by throwing.
    if (body.code !== 'Ok') throw new Error(`osrm ${body.code ?? 'no code'}`);
    const durations = body.durations?.[0];
    const distances = body.distances?.[0] ?? [];
    // A short or missing duration row is a malformed answer, not a grid of
    // unroutable cells: without this, the missing entries would read as null,
    // the origin would commit self-only and mark itself complete, and resume
    // would skip the corrupted origin for good (Codex). One entry per
    // destination or it does not count as an answer.
    if (!Array.isArray(durations) || durations.length !== dests.length) {
      throw new Error(`osrm table row has ${Array.isArray(durations) ? durations.length : 'no'} of ${dests.length} destinations`);
    }
    return dests.map((d, i) => ({
      to: d,
      // `null` where OSRM could not route to a cell (off the extract, an island
      // with no path). Carried through as null, never coerced to 0.
      seconds: durations[i] ?? null,
      metres: distances[i] ?? null,
    }));
  };
}

/**
 * Build one mode's matrix for the given cells, routed through `table`.
 *
 * Written exactly like `repositories/reach.js#buildMatrix`: the rows for an
 * origin are replaced inside their own statement, and the `cell_builds` marker
 * is written as the origin finishes, so an interrupted pass leaves a table that
 * is short rather than wrong and `resume` can pick it up.
 *
 *   `cells`     the candidate grid: `{ code, lat, lng }`, as `allCells` returns
 *               — every cell an origin may reach to.
 *   `origins`   the cells to build *from* (defaults to `cells`). A regional
 *               build passes a smaller, interior set here while keeping the full
 *               region as candidates, so a boundary origin is left unbuilt
 *               rather than marked complete with its cross-boundary neighbours
 *               missing (Codex, P1).
 *   `table`     an OSRM client from `osrmTable` (or any `(origin, dests) =>`
 *               `[{ to, seconds, metres }]` for a test).
 *   `horizon`   how far out to build, in minutes — the cap plus the edge
 *               allowance, same as the estimator.
 *   `resume`    skip an origin already built to at least `horizon` by OSRM.
 *   `since`     with resume, skip only origins built at or after this moment —
 *               the start of the build being resumed — so a retry never trusts
 *               an older build's markers.
 *               Resume is for continuing one interrupted run over one coverage:
 *               it cannot tell which extract built an origin, so a build over a
 *               *different* extract (a regional proof, then the full-GB run) must
 *               pass `resume: false` — otherwise a route the narrow extract could
 *               not make (a ferry, a road just outside it) stays missing though
 *               the origin is marked complete. The production build is a single
 *               full-GB pass, where this does not arise (Codex).
 *   `chunk`     destinations per `/table` request (OSRM's `--max-table-size`
 *               must be at least this plus one).
 */
export async function buildOsrmMode({
  mode, cells, origins = cells, table, horizon = HORIZON_MINUTES, scheme = 'sector',
  resume = true, since = null, chunk = 300, onProgress = null, onRingsDropped = null,
} = {}) {
  const canonical = travelMode(mode);
  if (canonical !== 'walking' && canonical !== 'cycling') {
    // Driving is the fitted estimator's and stays there; transit has no network
    // here and keeps its marked straight-line estimate (owner, 1 Oct 2026).
    throw new Error(`osrm matrix is walking or cycling, not ${mode}`);
  }
  const bound = boundKm(horizon, canonical) * CANDIDATE_SLACK;
  const { rows: [run] } = await query(
    `insert into reach_runs (scheme, mode, method, cap_minutes, cells)
     values ($1, $2, 'osrm', $3, $4) returning id`,
    [scheme, canonical, horizon, origins.length],
  );
  let pairs = 0;
  let built = 0;
  let skipped = 0;
  try {
    for (let i = 0; i < origins.length; i += 1) {
      const from = origins[i];
      if (resume) {
        // `since` scopes resume to one build: only an origin this build has
        // already written is skipped — never one an earlier, finished build
        // marked, which a rebuild exists to replace (Codex).
        const { rows } = await query(
          `select 1 from cell_builds where from_cell = $1 and mode = $2
             and method = 'osrm' and cap_minutes >= $3
             and ($4::timestamptz is null or at >= $4::timestamptz)`,
          [from.code, canonical, horizon, since],
        );
        if (rows.length) { skipped += 1; continue; }
      }
      // The straight-line bound only decides which cells are worth asking OSRM
      // about; OSRM decides the real time. Cast wide (CANDIDATE_SLACK) — a
      // footpath or a towpath can be shorter than the open-road bound.
      const cands = cells.filter((c) => c.code !== from.code
        && Math.abs(c.lat - from.lat) * 111 <= bound
        && kmBetween(from, c) <= bound);
      // A cell always reaches itself in nothing, same as the estimator — a
      // search that starts in SL5 0 must find the places in SL5 0.
      const edges = [{ to_cell: from.code, minutes: 0, km: 0 }];
      for (let j = 0; j < cands.length; j += chunk) {
        const slice = cands.slice(j, j + chunk);
        const ans = await table(from, slice);
        for (const a of ans) {
          if (a.seconds == null) continue; // OSRM could not route to it — drop, never 0
          const minutes = Math.round(a.seconds / 60);
          if (minutes > horizon) continue;
          const km = a.metres != null
            ? Math.round(a.metres / 10) / 100
            : Math.round(kmBetween(from, a.to) * 100) / 100;
          edges.push({ to_cell: a.to.code, minutes, km });
        }
      }
      // The delete, the rows and the marker are one transaction per origin, so
      // an interruption leaves an origin either fully built or untouched —
      // never wiped-then-marked-complete, which a reader would trust and a
      // resume would skip for good (Codex).
      let droppedRings = [];
      const client = await pool.connect();
      try {
        await client.query('begin');
        // The mode's write lock, the same one the estimator takes per origin
        // (repositories/reach.js#inModeWrite): from this origin's commit on, no
        // estimator write can land in this mode.
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [modeWriteLockKey(canonical)]);
        await client.query('delete from reach where from_cell = $1 and mode = $2', [from.code, canonical]);
        await client.query(
          `insert into reach (from_cell, to_cell, mode, minutes, km, method)
           select $1, t, $2, m, k, 'osrm'
             from unnest($3::text[], $4::smallint[], $5::real[]) as u(t, m, k)
           on conflict (from_cell, to_cell, mode)
             do update set minutes = excluded.minutes, km = excluded.km, method = excluded.method`,
          [from.code, canonical, edges.map((e) => e.to_cell), edges.map((e) => e.minutes), edges.map((e) => e.km)],
        );
        await client.query(
          `insert into cell_builds (from_cell, mode, cap_minutes, pairs, method, built_lat, built_lng, at)
           values ($1, $2, $3, $4, 'osrm', $5, $6, now())
           on conflict (from_cell, mode) do update
             set cap_minutes = excluded.cap_minutes, pairs = excluded.pairs,
                 method = excluded.method, built_lat = excluded.built_lat,
                 built_lng = excluded.built_lng, at = excluded.at`,
          [from.code, canonical, horizon, edges.length, from.lat, from.lng],
        );
        // A ring centred here for this mode was counted from this origin's old
        // reach; now that the reach has changed, the cached counts and rankings
        // are stale, and `censusForRing` would go on serving them for the rest
        // of the 30-day cycle (Codex). Drop them in the same transaction, so the
        // next request recomputes from the routed matrix — never a half-built
        // run leaving a ring that disagrees with the rows under it.
        const { rows: dropped } = await client.query(
          'delete from ring_counts where cell = $1 and mode = $2 returning minutes', [from.code, canonical]);
        await client.query('delete from ring_rankings where cell = $1 and mode = $2', [from.code, canonical]);
        droppedRings = [...new Set(dropped.map((r) => r.minutes))]
          .map((minutes) => ({ cell: from.code, mode: canonical, minutes }));
        // The rings just dropped are handed to the caller inside this same
        // transaction, so the obligation to recount them is written with the
        // marker that says this origin is done — never a done origin whose
        // dropped ring nobody owes (Codex).
        if (droppedRings.length && onRingsDropped) await onRingsDropped(droppedRings, (sql, params) => client.query(sql, params));
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      pairs += edges.length;
      built += 1;
      if (onProgress && i % 100 === 0) {
        try { onProgress({ done: i + 1, of: origins.length, built, skipped, pairs }); } catch { /* not the build */ }
      }
    }
    await query('update reach_runs set state = $2, pairs = $3, finished_at = now() where id = $1', [run.id, 'done', pairs]);
  } catch (err) {
    await query('update reach_runs set state = $2, why = $3, pairs = $4, finished_at = now() where id = $1',
      [run.id, 'failed', String(err?.message ?? err).slice(0, 400), pairs]);
    throw err;
  }
  return { mode: canonical, cells: cells.length, built, skipped, pairs, runId: run.id };
}
