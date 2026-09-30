/**
 * The pilot (owner, 29 Sep 2026): "PILOT ON SL5 — run the full pipeline now.
 * Top 20 places in every category within 30 min of SL5 0JD, plus the earlier
 * reference places. For each: buy Google details (spot step, in memory), crawl
 * the venue website, check OpenStreetMap, Wikipedia, Wikidata, verify facts,
 * and fill standard facts … Paid Google is approved for this pilot."
 *
 * And the sign-up pre-warm is the same runner told not to pay: "free IDs-only
 * top 20 per category, then our own sources — no paid Google".
 *
 * One place at a time, written down place by place (migration 279), so a
 * deploy loses nothing: a run found `running` with nothing in this process
 * driving it reads as interrupted, and starting it again picks up at the first
 * place not done. Per place:
 *
 *   a. paid only — one Place Details request (reviews and the AI summaries)
 *      through `googleSource.get`, the same path `/api/places/detail` uses and
 *      so the same door (`paidGate.admitPaid`). Spot reads the review text in
 *      memory and writes suggestions only; the text goes nowhere (C30). The
 *      name and point it returned are handed to the researcher as a seed, in
 *      memory, exactly as the drawer does, so the researcher does not buy them
 *      a second time;
 *   b. `own.enrich` — the open map, the venue's own page, the address lookup,
 *      Wikipedia and Wikidata, the hygiene register (paid → its page lead and
 *      web search as well; free → nothing that costs);
 *   c. every suggestion Spot raised is verified against our own sources, then
 *      `pipeline.answerPlace` answers every other fact looked for there.
 *
 * Standard facts: the seven yes/no ones (indoor, step free, parking, toilets,
 * booking required, food on site, dog friendly) are answered by (c) from the
 * owned sources. Suits ages, Duration and Cost band have no owned per-place
 * derivation anywhere in the pipeline — they are set per subcategory by a
 * person — so this runner does not invent one; the report says so.
 *
 * A paid refusal stops the run — it never spins (CLAUDE.md, "a loop that reads
 * an error body as a result runs away"): an agent session with no grant, a
 * household cap, the day's ceiling or Google switched off leave the run
 * `waiting` with the reason, and it resumes from the same place when started
 * again.
 */

import { query } from '../db.js';
import { runAsSpender } from '../context.js';
import * as pipeline from './pipeline.js';
import { FILED_SQL } from './categories.js';
import { logChange } from './changes.js';
import { travelMode } from '../domain/travel.js';

export const TOP = 20;
const ENRICH_DEADLINE_MS = Number(process.env.EPIC_PILOT_PLACE_TIMEOUT_MS || 180_000);

/** Errors that mean "no more paid requests now", as opposed to one place failing. */
const STOPS = {
  unattributed_paid_call: (err) => (err.why === 'an agent session with no paid budget granted' ? 'waiting for a paid grant' : `paid call refused: ${err.why ?? 'no household or session'}`),
  spend_bound_reached: () => 'the household’s monthly Google bound is reached',
  daily_ceiling_reached: () => 'the day’s spend ceiling is reached',
  switched_off: () => 'Google is switched off in Settings › Providers',
};
export const stopReason = (err) => (err?.code && STOPS[err.code] ? STOPS[err.code](err) : null);

/** Where the ring is drawn from: a cell named, the place said, or the household's home. */
async function cellFor({ cell, where, householdId, minutes, mode }) {
  if (cell) return { cell, label: where ?? cell };
  const { ringFor, cellAt } = await import('../repositories/reach.js');
  if (where) {
    const ring = await ringFor({ where, minutes, mode }).catch(() => null);
    if (ring?.cell) return { cell: ring.cell, label: where };
  }
  if (householdId) {
    const { rows: [h] } = await query('select home_lat, home_lng, home_label from households where id = $1', [householdId]);
    if (h?.home_lat != null) {
      const at = await cellAt({ lat: Number(h.home_lat), lng: Number(h.home_lng) }).catch(() => null);
      if (at?.code) return { cell: at.code, label: where ?? h.home_label ?? at.code };
    }
  }
  return null;
}

/**
 * The places: the ring's top `TOP` in every category it ranks (counted first
 * if nobody has counted it — free, from the IDs-only census already held),
 * then the reference set's places not already picked.
 */
export async function pickPlaces({ cell, mode = 'driving', minutes = 30, top = TOP, refresh = null, reference: withReference = true } = {}) {
  const ring = await import('../repositories/ringTables.js');
  let counted = await ring.countsFor({ cell, mode, minutes });
  let refreshed = false;
  let live = null;
  if (counted == null) {
    live = await (refresh ?? ring.refreshRing)({ cell, mode, minutes });
    refreshed = true;
    counted = await ring.countsFor({ cell, mode, minutes });
  }
  const picked = new Map();
  const add = (venueRef, category, rank) => {
    const had = picked.get(venueRef);
    if (had) { if (!had.categories.includes(category)) had.categories.push(category); return; }
    picked.set(venueRef, { venueRef, categories: [category], pickedFor: 'ring', rank });
  };
  let cats;
  if (live?.estimated) {
    // A straight-line ring persists no rankings (they would freeze once a matrix
    // is built), so its ranked places come off the refresh's own result rather
    // than the empty `ring_rankings` table (Codex).
    cats = [...new Set((live.rankings ?? []).map((r) => r.category).filter((c) => c && c !== ''))].sort().map((category) => ({ category }));
    const byCat = new Map();
    for (const r of live.rankings ?? []) {
      const n = byCat.get(r.category) ?? 0;
      if (n >= top) continue;
      byCat.set(r.category, n + 1);
      add(r.venueRef, r.category, r.rank);
    }
  } else {
    ({ rows: cats } = await query(
      `select distinct category from ring_rankings where cell = $1 and mode = $2 and minutes = $3 and category <> '' order by category`,
      [cell, travelMode(mode), minutes]));
    for (const { category } of cats) {
      for (const r of await ring.rankingFor({ cell, mode, minutes, category, limit: top })) add(r.venueRef, category, r.rank);
    }
  }
  // The reference set (owner, 25 Sep 2026): research sweeps in reference mode.
  const { rows: refs } = !withReference ? { rows: [] } : await query(
    `select distinct on (p.venue_ref) p.venue_ref, coalesce(sc.category_key, 'reference') as category
       from research_sweep_places p
       join research_sweeps s on s.id = p.sweep_id and s.params->>'mode' = 'reference'
       left join shelf_subcategories sc on sc.key = p.subcategory
      order by p.venue_ref, s.started_at desc`).catch(() => ({ rows: [] }));
  let reference = 0;
  for (const r of refs) {
    const had = picked.get(r.venue_ref);
    if (had) { if (!had.categories.includes('reference')) had.categories.push('reference'); continue; }
    picked.set(r.venue_ref, { venueRef: r.venue_ref, categories: ['reference', r.category].filter((c, i, a) => a.indexOf(c) === i), pickedFor: 'reference', rank: null });
    reference += 1;
  }
  return {
    places: [...picked.values()],
    // An estimated ring is counted live and never lands in `ring_counts`, so a
    // null there is not "uncounted" when the refresh returned an estimate.
    counted: counted != null || Boolean(live?.estimated),
    refreshed,
    categories: cats.map((c) => c.category),
    reference,
  };
}

/** The yes/no facts looked for at a place: the standard ones and its drawers' active facts. */
async function lookedFor(ref) {
  const { rows } = await query(`
    with subs as (select distinct f.sub from (${FILED_SQL}) f where f.venue_ref = $1)
    select pa.key from place_attributes pa
     where pa.active and pa.kind = 'yesno'
       and (pa.standard or exists (select 1 from subcategory_facts sf join subs on subs.sub = sf.subcategory_key
                                    where sf.attribute_key = pa.key and sf.status = 'active'))`, [ref]);
  return rows.map((r) => r.key);
}

/** The place's facts after the pass: verified yes, no, conflict, don't know — keys only. */
async function factStates(ref) {
  const keys = await lookedFor(ref);
  const { rows } = await query(
    `select attribute_key, state from place_fact_answers where venue_ref = $1 and attribute_key = any($2) and hidden_at is null`,
    [ref, keys]);
  const by = new Map(rows.map((r) => [r.attribute_key, r.state]));
  const out = { yes: [], no: [], conflict: [], dontKnow: [] };
  for (const k of keys) {
    const s = by.get(k);
    if (s === 'yes') out.yes.push(k);
    else if (s === 'no') out.no.push(k);
    else if (s === 'conflict') out.conflict.push(k);
    else out.dontKnow.push(k); // an explicit don't-know, or nothing found and so nothing written
  }
  return out;
}

const withDeadline = (p, ms) => {
  let timer;
  const bell = new Promise((resolve) => { timer = setTimeout(() => resolve({ state: 'timeout' }), ms); timer.unref?.(); });
  return Promise.race([p, bell]).finally(() => clearTimeout(timer));
};

/** The default dependencies: Google's detail call, the researcher, the ledger. Tests hand in their own. */
async function defaults() {
  const [{ googleSource }, own, providerCalls, gate] = await Promise.all([
    import('../sources/google.js'), import('../sources/own.js'), import('../repositories/providerCalls.js'), import('../sources/paidGate.js'),
  ]);
  return {
    detail: (id, opts) => googleSource.get(id, opts),
    enrich: (ref, opts) => own.enrich(ref, opts),
    record: (...args) => providerCalls.record(...args),
    standing: (sessionId) => gate.sessionStanding(sessionId),
    forget: (sessionId) => gate.forgetSession(sessionId),
  };
}

/** One place, end to end. Returns its outcome (counts and keys), or `{ stop }` when paying must stop. */
async function onePlace(ref, { run, deps }) {
  const outcome = { detail: 'skipped', spotted: [] };
  let seed = {};
  if (run.paid && ref.startsWith('google:')) {
    const meter = {};
    let venue = null;
    try {
      venue = await deps.detail(ref.slice('google:'.length), { meter });
    } catch (err) {
      const stop = stopReason(err);
      if (stop) return { stop };
      outcome.detail = 'failed';
      outcome.detailFault = String(err?.code ?? err?.message ?? 'error').slice(0, 60);
    } finally {
      if (Object.keys(meter).length) await deps.record(run.household_id, 'google', 'pilot.detail', meter, run.session_id, ref).catch(() => null);
    }
    if (!venue && outcome.detail === 'skipped') {
      // Google answered nothing: no key, or switched off. Paying cannot go on.
      return { stop: meter.switched_off ? STOPS.switched_off() : 'Google is not configured (no key)' };
    }
    if (venue) {
      outcome.detail = 'bought';
      // In memory only: the review texts and the summaries go to Spot and
      // nowhere else; nothing of them is written (C30).
      const reviews = (venue.reviews ?? []).map((r) => r.text).filter(Boolean);
      const summary = [venue.aiSummary, venue.reviewSummary].filter(Boolean).join('\n') || null;
      const spotted = await pipeline.spot({ ref, reviews, summary }).catch(() => null);
      outcome.spotted = (spotted?.suggested ?? []).map((s) => s.fact);
      outcome.reviewsRead = reviews.length;
      seed = { name: venue.name ?? null, category: venue.category ?? null, lat: venue.lat ?? null, lng: venue.lng ?? null, website: venue.website ?? null, locality: venue.locality ?? null };
    }
  }
  const research = await withDeadline(
    Promise.resolve(deps.enrich(ref, { householdId: run.household_id, sessionId: run.session_id, seed, paid: run.paid, search: run.paid })).catch((err) => ({ state: 'failed', problems: [String(err?.message ?? err)] })),
    ENRICH_DEADLINE_MS);
  outcome.research = research?.skipped ? 'already researched' : research?.state ?? 'unknown';
  if (research?.state === 'timeout') outcome.research = 'timed out';
  // A refusal inside the researcher (its page lead) is written into its
  // problems, not thrown; when paying, it stops the run the same way.
  if (run.paid && (research?.problems ?? []).some((p) => /paid provider call was refused/.test(p))) {
    outcome.researchRefused = true;
  }
  let verified = 0;
  for (const fact of outcome.spotted) {
    const v = await pipeline.verify({ ref, fact }).catch(() => null);
    if (v && !v.waiting) verified += 1;
  }
  outcome.suggestionsChecked = verified;
  const answered = await pipeline.answerPlace(ref).catch(() => ({ answered: 0 }));
  outcome.answered = answered.answered ?? 0;
  if (answered.nothingToRead) outcome.nothingToRead = true;
  const facts = await factStates(ref);
  outcome.facts = facts;
  return { outcome };
}

const running = new Map(); // run id → promise, in this process

/** Drive a run from its first place not done. Never throws; the run row carries how it ended. */
async function drive(runId, deps) {
  const { rows: [run] } = await query('select * from pilot_runs where id = $1', [runId]);
  if (!run) return null;
  try {
    return await runAsSpender({ householdId: run.household_id, sessionId: run.session_id }, async () => {
      if (run.paid) {
        deps.forget?.(run.session_id);
        const standing = await deps.standing(run.session_id).catch(() => 'no_session');
        if (standing !== 'may_spend') {
          const why = standing === 'agent' ? 'waiting for a paid grant' : `paid call refused: ${standing.replace(/_/g, ' ')}`;
          await query(`update pilot_runs set state = 'waiting', waiting_why = $2, updated_at = now() where id = $1`, [runId, why]);
          return { state: 'waiting', why };
        }
      }
      for (;;) {
        const { rows: [next] } = await query(
          `select venue_ref from pilot_places where run_id = $1 and state = 'pending' order by position limit 1`, [runId]);
        if (!next) break;
        const r = await onePlace(next.venue_ref, { run, deps }).catch((err) => ({ outcome: { error: String(err?.message ?? err).slice(0, 120) }, failed: true }));
        if (r.stop) {
          await query(`update pilot_runs set state = 'waiting', waiting_why = $2, updated_at = now() where id = $1`, [runId, r.stop]);
          return { state: 'waiting', why: r.stop };
        }
        // A place whose paid research was refused stays pending, so the
        // resume does it again rather than stepping past it (Codex, 29 Sep).
        if (r.outcome?.researchRefused) {
          const why = 'the researcher’s paid page lead was refused — waiting for a paid grant';
          await query(`update pilot_runs set state = 'waiting', waiting_why = $2, updated_at = now() where id = $1`, [runId, why]);
          return { state: 'waiting', why };
        }
        await query(
          `update pilot_places set state = $3, outcome = $4, done_at = now() where run_id = $1 and venue_ref = $2`,
          [runId, next.venue_ref, r.failed ? 'failed' : 'done', JSON.stringify(r.outcome)]);
        await query('update pilot_runs set updated_at = now() where id = $1', [runId]);
      }
      // What the run confirmed joins its subcategories now, not at the next
      // daily pass — the fact pages and collections read the result (C33).
      await pipeline.add().catch((err) => console.warn(`pilot add: ${err.message}`));
      const { rows: [done] } = await query(
        `update pilot_runs set state = 'done', waiting_why = null, finished_at = now(), updated_at = now() where id = $1 returning *`, [runId]);
      await logChange({
        who: run.started_by ?? 'Epic (pilot)', area: 'Fact automations',
        what: `${run.paid ? 'Pilot run' : 'Pre-warm'} · ${run.where_label ?? run.cell} · ${done.places} places`,
        after: `${run.minutes} min ring of ${run.cell}${run.paid ? ', paid Google details' : ', free'}`,
        subjectType: 'pilot_run', subjectId: runId,
      }).catch(() => null);
      return { state: 'done' };
    });
  } catch (err) {
    await query(`update pilot_runs set state = 'failed', waiting_why = $2, updated_at = now() where id = $1`, [runId, String(err?.message ?? err).slice(0, 200)]).catch(() => null);
    return { state: 'failed', why: err?.message };
  }
}

/**
 * Start (or resume) a run. The reference set comes with a paid pilot and
 * not with the pre-warm, which is the ring's top 20 alone ("free IDs-only top
 * 20 per category").
 * Returns at once with the run; the work goes on in
 * the background. An unfinished run for the same household, ring and paid
 * flag is resumed rather than a second one made — on the caller's session,
 * so a grant given since is the one the gate reads.
 */
export async function runPilot({ householdId, sessionId = null, cell = null, where = null, minutes = 30, mode = 'driving', paid = false, reference = paid, who = null, deps: given = null, top = TOP, wait = false } = {}) {
  if (!householdId) throw Object.assign(new Error('A pilot runs for a household.'), { status: 409, code: 'no_household' });
  const deps = { ...(await defaults()), ...(given ?? {}) };
  const at = await cellFor({ cell, where, householdId, minutes, mode });
  if (!at) throw Object.assign(new Error(`Not a place we know: ${where ?? cell ?? 'no home set'}.`), { status: 400, code: 'unknown_place' });
  const { rows: [open] } = await query(
    `select * from pilot_runs where household_id = $1 and cell = $2 and minutes = $3 and paid = $4 and state in ('running', 'waiting')
      order by started_at desc limit 1`, [householdId, at.cell, minutes, Boolean(paid)]);
  let run = open;
  if (run && running.has(run.id)) return { run: await status(run.id), resumed: false, alreadyRunning: true };
  if (run) {
    ({ rows: [run] } = await query(
      `update pilot_runs set state = 'running', waiting_why = null, session_id = coalesce($2, session_id), updated_at = now() where id = $1 returning *`,
      [run.id, sessionId]));
  } else {
    const picked = await pickPlaces({ cell: at.cell, mode, minutes, top, refresh: given?.refreshRing ?? null, reference });
    ({ rows: [run] } = await query(
      `insert into pilot_runs (household_id, session_id, where_label, cell, mode, minutes, paid, started_by, places)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [householdId, sessionId, at.label, at.cell, mode, minutes, Boolean(paid), who, picked.places.length]));
    let i = 0;
    for (const p of picked.places) {
      i += 1;
      await query(
        `insert into pilot_places (run_id, venue_ref, position, categories, picked_for, rank) values ($1, $2, $3, $4, $5, $6)
         on conflict do nothing`, [run.id, p.venueRef, i, p.categories, p.pickedFor, p.rank]);
    }
    if (!picked.places.length) {
      // Can't speak: a ring with nothing ranked is not a ring with nothing in it.
      const why = picked.counted ? 'the ring is counted but ranks nothing yet (a ranking needs an Epic score)' : 'the ring could not be counted';
      await query(`update pilot_runs set state = 'failed', waiting_why = $2, finished_at = now() where id = $1`, [run.id, why]);
      return { run: await status(run.id), resumed: false };
    }
  }
  const job = drive(run.id, deps).finally(() => running.delete(run.id));
  running.set(run.id, job);
  if (wait) await job;
  return { run: await status(run.id), resumed: Boolean(open) };
}

/**
 * What a run did: per category — places, enriched, facts verified, no,
 * conflicts, don't-knows, suggestions raised — and the Google requests it
 * made by meter, with their cost three ways: at list price, as Google would
 * bill it on top of the month's other use (allowances first), and what the
 * billing export has attributed to its rows so far (null until it has).
 */
export async function status(runId = null, { householdId = null } = {}) {
  const { rows: [run] } = runId
    ? await query('select * from pilot_runs where id = $1', [runId])
    : await query(`select * from pilot_runs ${householdId ? 'where household_id = $1' : ''} order by started_at desc limit 1`, householdId ? [householdId] : []);
  if (!run) return null;
  const { rows: places } = await query(
    `select p.venue_ref, p.categories, p.picked_for, p.state, p.outcome, r.enrich_state, r.name
       from pilot_places p left join place_records r on r.venue_ref = p.venue_ref
      where p.run_id = $1 order by p.position`, [run.id]);
  const blank = () => ({ places: 0, done: 0, failed: 0, detailsBought: 0, enriched: 0, identified: 0, suggestions: 0, verified: 0, no: 0, conflicts: 0, dontKnows: 0 });
  const byCategory = new Map();
  const total = blank();
  for (const p of places) {
    const o = p.outcome ?? {};
    const add = (t) => {
      t.places += 1;
      if (p.state === 'done') t.done += 1;
      if (p.state === 'failed') t.failed += 1;
      if (o.detail === 'bought') t.detailsBought += 1;
      if (p.state === 'done' && o.research && !['failed', 'timed out', 'unknown'].includes(o.research)) t.enriched += 1;
      if (p.enrich_state === 'done') t.identified += 1;
      t.suggestions += (o.spotted ?? []).length;
      t.verified += o.facts?.yes?.length ?? 0;
      t.no += o.facts?.no?.length ?? 0;
      t.conflicts += o.facts?.conflict?.length ?? 0;
      t.dontKnows += o.facts?.dontKnow?.length ?? 0;
    };
    add(total);
    for (const c of p.categories ?? []) {
      if (!byCategory.has(c)) byCategory.set(c, blank());
      add(byCategory.get(c));
    }
  }
  // The run's own ledger rows: this household, the run's places, inside the
  // run's window — the detail bought here and whatever the researcher paid
  // for (its page lead, a web search). A household opening one of these
  // places during the run would be counted too; the purposes say which.
  const refs = places.map((p) => p.venue_ref);
  const { rows: ledger } = await query(
    `select m.key as meter, sum((m.value)::numeric)::float as units, array_agg(distinct c.purpose) as purposes
       from provider_calls c, jsonb_each_text(c.units) m
      where c.household_id is not distinct from $1 and c.venue_ref = any($2)
        and c.created_at >= $3 and c.created_at <= coalesce($4, now())
        and jsonb_typeof(c.units) = 'object' and (m.key like 'google-%' or m.key = 'pro-details') and m.value ~ '^[0-9.]+$'
      group by m.key order by m.key`,
    [run.household_id, refs, run.started_at, run.finished_at]);
  // Billing's side, one row once (a row carries several meters).
  const { rows: [billed] } = await query(
    `select count(*)::int as rows, count(c.billed_gbp)::int as billed_rows, sum(c.billed_gbp)::float as billed_gbp
       from provider_calls c
      where c.household_id is not distinct from $1 and c.venue_ref = any($2)
        and c.created_at >= $3 and c.created_at <= coalesce($4, now())
        and jsonb_typeof(c.units) = 'object' and exists (select 1 from jsonb_object_keys(c.units) k where k like 'google-%')`,
    [run.household_id, refs, run.started_at, run.finished_at]);
  const cost = await costOf(ledger, billed, run.started_at);
  const inProcess = running.has(run.id);
  return {
    run: {
      id: run.id, state: run.state === 'running' && !inProcess ? 'interrupted' : run.state,
      why: run.waiting_why, paid: run.paid, where: run.where_label, cell: run.cell, minutes: run.minutes, mode: run.mode,
      places: run.places, done: total.done, failed: total.failed, pending: places.filter((p) => p.state === 'pending').length,
      startedAt: run.started_at, finishedAt: run.finished_at, startedBy: run.started_by, inProcess,
    },
    totals: total,
    byCategory: [...byCategory.entries()].map(([category, t]) => ({ category, ...t })).sort((a, b) => a.category.localeCompare(b.category)),
    requests: { byMeter: ledger.map((l) => ({ meter: l.meter, requests: l.units, purposes: l.purposes })), ...cost },
    notDerived: {
      facts: ['suits-ages', 'duration', 'cost-band'],
      why: 'No owned per-place derivation exists for these: they are set per subcategory by a person. The pilot does not invent one.',
    },
  };
}

/**
 * The run's Google requests priced per SKU: at list price, and as Google
 * would bill them this month — the month's use with and without the run's,
 * each past its line's free allowance (desk/billing.js googleEstimate). The
 * billed figure is what the billing export attributed to the run's rows, and
 * speaks only for the rows it has reached.
 */
async function costOf(ledger, billed, startedAt) {
  const { PRICE_PER_UNIT_USD, USD_TO_GBP } = await import('../domain/providerPrices.js');
  const { googleEstimate } = await import('./billing.js');
  const { rows: [{ month }] } = await query(`select to_char($1::timestamptz at time zone 'Europe/London', 'YYYY-MM') as month`, [startedAt]);
  const est = await googleEstimate(month).catch(() => null);
  // `pro-details` marks how many of the `google-pro` requests were Place
  // Details, which billing judges against their own allowance; it is not a
  // meter of its own and has no price of its own.
  const run = new Map(ledger.map((l) => [l.meter, l.units]));
  const split = (est?.lines ?? []).some((l) => l.key === 'google-pro-details');
  const runFor = (key) => {
    if (key === 'google-pro-details') return run.get('pro-details') ?? 0;
    if (key === 'google-pro' && split) return Math.max(0, (run.get('google-pro') ?? 0) - (run.get('pro-details') ?? 0));
    return run.get(key) ?? 0;
  };
  const listPrice = (key) => (PRICE_PER_UNIT_USD[key === 'google-pro-details' ? 'google-pro' : key] ?? 0) * USD_TO_GBP;
  let listGbp = 0;
  for (const l of ledger) if (l.meter !== 'pro-details') listGbp += listPrice(l.meter) * l.units;
  let marginalGbp = 0;
  for (const line of est?.lines ?? []) {
    const mine = runFor(line.key);
    if (!mine) continue;
    const price = line.billable > 0 ? line.gbp / line.billable : listPrice(line.key);
    const without = Math.max(0, line.used - mine - line.free);
    marginalGbp += (line.billable - without) * price;
  }
  const billedRows = billed?.billed_rows ?? 0;
  const rows = billed?.rows ?? 0;
  return {
    month,
    listGbp: Math.round(listGbp * 100) / 100,
    estimateGbp: est ? Math.round(marginalGbp * 100) / 100 : null,
    estimateBasis: est ? 'as Google bills it: the month’s use past each line’s free allowance, with and without this run' : 'the month’s ledger could not be read',
    billedGbp: billedRows ? Math.round((billed.billed_gbp ?? 0) * 100) / 100 : null,
    billedRows,
    rows,
    billedSays: billedRows ? (billedRows < rows ? `billing has reached ${billedRows} of ${rows} rows` : 'billing has reached every row') : 'not yet attributed by the billing export (daily job)',
  };
}

/** Runs this process is driving (tests, and a clean shutdown). */
export const inFlight = (runId) => running.get(runId) ?? null;
