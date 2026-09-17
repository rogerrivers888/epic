/**
 * Demand — what people asked for, and what we failed to give them.
 *
 * Three numbers, never one conversion rate. A single rate hides which of the
 * three faults it was, and the three have different owners:
 *
 *   · **shown nothing**  → we hold no places here. Fixed by collecting.
 *   · **clicked nothing** → we showed the wrong ones. Fixed in the category rules.
 *   · **clicked, never tripped** → the records are too thin to convince. Fixed by
 *     improving the data on the place.
 *
 * A search that returned nothing is logged as loudly as one that returned forty,
 * and none of it can be backfilled.
 */

import express from 'express';
import { can, requires } from '../access.js';
import { query } from '../db.js';
import * as searches from '../repositories/searches.js';
import * as index from '../repositories/placeIndex.js';
import { faultOf, SHORT_FAULT } from '../domain/placeIndex.js';
import { detailFor } from '../sources/compare.js';
import { roomToSpend, releaseSpend } from './placeIndex.js';
import { googleSource } from '../sources/google.js';
import { currentHousehold } from './household.js';

const router = express.Router();
const bad = (message, code = 'bad_request') => Object.assign(new Error(message), { status: 400, code });

/** A source, said the way a person would say it rather than the way it is keyed. */
const SOURCE_WORD = { google: 'Google', osm: 'OSM', atlas: 'the atlas', sweep: 'the sweep', own: 'ours', tripadvisor: 'Tripadvisor', claude: 'the planner', live: 'a live look' };

/** BO4a — three numbers, what was asked for, and the log itself. */
router.get('/', requires('view_reporting'), async (req, res, next) => {
  try {
    const areaSlug = req.query.where ? String(req.query.where).toLowerCase() : null;
    const since = Number(String(req.query.since ?? '30').replace(/[^0-9]/g, '')) || 30;
    const area = areaSlug ? await index.areaBySlug(areaSlug) : null;
    const totals = await searches.totals({ areaSlug, since });
    const subjects = await searches.bySubject({ areaSlug, since });
    const labels = new Map((await query('select key, label from shelf_subcategories')).rows.map((r) => [r.key, r.label]));
    const catLabels = new Map((await query('select key, label from shelf_categories')).rows.map((r) => [r.key, r.label]));
    const known = new Map((await query(
      `select subcategory, places from area_stats where area_slug = $1 and subcategory <> '' and source = '' and ownership = ''`,
      [areaSlug ?? 'gb'])).rows.map((r) => [r.subcategory, r.places]));

    const log = await searches.recent({ areaSlug, since });
    // The area's own name, not its slug: a screen that prints `berkshire` is a
    // screen showing the database rather than the place.
    const names = new Map((await query(
      'select slug, name from localities where slug = any($1)',
      [[...new Set(log.map((r) => r.area_slug).filter(Boolean))]])).rows.map((r) => [r.slug, r.name]));
    res.json({
      area: area ? { slug: area.slug, name: area.name, kind: area.kind } : null,
      since, totals,
      rows: subjects.map((s) => {
        const k = s.subject ? known.get(s.subject) ?? 0 : null;
        const f = faultOf({ ...s, known: k ?? 0 });
        return {
          subject: s.subject,
          label: s.subject ? (labels.get(s.subject) ?? catLabels.get(s.subject) ?? s.subject) : 'Anything',
          noSubject: !s.subject,
          searches: s.searches, empty: s.empty, noClick: s.noClick, noTrip: s.noTrip, known: k,
          fault: f.key, faultLabel: f.label,
          // "No places" only where we really hold none; otherwise the figures
          // say what they say and the row reads "Came back empty".
          shortFault: f.key === 'no-places' && k ? 'Came back empty' : SHORT_FAULT[f.key],
          owner: f.owner, act: f.act,
        };
      }),
      log: log.map((r) => ({
        id: r.id, at: r.at, surface: r.surface,
        subject: r.subject, label: r.subject ? (labels.get(r.subject) ?? catLabels.get(r.subject) ?? r.subject) : 'Anything',
        where: r.area_slug ? names.get(r.area_slug) ?? r.area_slug : r.cell ?? null, minutes: r.minutes, mode: r.mode,
        shown: r.shown_total, empty: r.empty, opened: r.opened, tripped: r.tripped, outcome: r.outcome,
        // Said, not shown: who it was is not printed on a list, only whether the
        // search was held against an account at all.
        identified: Boolean(r.account_id),
        asked: r.asked,
      })),
      // What a replay costs, said before the button is pressed.
      replayPence: 1,
    });
  } catch (err) { next(err); }
});

/**
 * BO4b — one search, replayed exactly as they saw it.
 *
 * The stored rows are identifiers; names are re-resolved at display, and for a
 * `google:` ref that costs a call. Fine for an occasional investigation, never
 * for a list that would do it forty times on load — which is why this is its own
 * request with its cost on the button.
 */
/** This month's Google spend so far, in pence, read off the ledger. */
async function googleSpentPence() {
  const { rows: [r] } = await query(
    `select coalesce(sum(estimated_cost_usd), 0)::numeric as usd
       from provider_calls where provider = 'google' and created_at > date_trunc('month', now())`);
  // The ledger is in dollars; everything on these screens is in pence.
  return Number(r?.usd ?? 0) * 100 * 0.79;
}

router.get('/search', requires('view_reporting'), async (req, res, next) => {
  try {
    const id = String(req.query.id ?? '').trim();
    if (!id) throw bad('Which search? Pass its id.');
    const found = await searches.oneSearch(id);
    if (!found) return res.status(404).json({ error: 'not_found', message: 'No search by that id.' });
    const { search, events } = found;

    const shown = events.filter((e) => e.kind === 'shown');
    const refs = [...new Set(events.map((e) => e.venue_ref).filter(Boolean))];
    const names = await index.namesFor(refs);

    /**
     * The names we do not hold, asked for rather than claimed.
     *
     * `namesFor` reads only what is ours, and deliberately never hands back a
     * stored copy of a provider's name — so a Google-only row comes back
     * nameless. The replay used to count those as "refetched" and put a price
     * on them without a single call going out (Codex, 17 Sep 2026).
     *
     * Asking is opt-in (`?names=1`), needs `manage_library` because it spends,
     * and what comes back is handed to this screen and written down nowhere.
     */
    const nameless = refs.filter((r) => !names.get(r)?.name && String(r).startsWith('google:'));
    let asked = 0;
    let named = 0;
    let spentPence = 0;
    let why = null;
    if (!nameless.length) why = null;
    else if (String(req.query.names ?? '') !== '1') why = 'not asked';
    else if (!can(req, 'manage_library')) why = 'asking costs a call, and that needs Manage the library';
    else if (!googleSource.enabled()) why = 'Google is not switched on here';
    else {
      // The ceiling, before the calls rather than after them. A replay near the
      // limit could take the month past a bound the Runs board calls hard
      // (Codex, 17 Sep 2026). Priced the same way Collect prices a Google ask.
      const want = Math.round(nameless.length * 2.8);
      const room = await roomToSpend(want, { holder: 'replay' });
      if (!room.ok) {
        why = `that would spend about £${(want / 100).toFixed(2)} and there is £${(room.leftPence / 100).toFixed(2)} left of this month`;
        asked = 0;
      } else {
      const household = await currentHousehold();
      // What it cost is read off the ledger, not counted from the answers.
      //
      // `detailFor` keeps its last three hundred responses, so a name that came
      // out of that cache cost nothing — and a call that went out and came back
      // without a name still did. Counting the names reported a charge for the
      // first and nothing for the second (Codex, 17 Sep 2026).
      const spentBefore = await googleSpentPence();
      for (const ref of nameless) {
        try {
          const detail = await detailFor('google', ref.slice(7), household.id);
          if (detail?.name) { names.set(ref, { name: detail.name, from: 'google' }); named += 1; }
        } catch { /* one that will not answer is one bare row, not a failed replay */ }
      }
      spentPence = Math.max(0, Math.round(((await googleSpentPence()) - spentBefore) * 10) / 10);
      asked = nameless.length;
      if (!named) why = 'asked, and none of them answered';
      await releaseSpend(room.reservation);
      }
    }
    const { rows: scored } = await query(
      'select venue_ref, data_score, subcategory from place_index where venue_ref = any($1)', [refs]);
    const byRef = new Map(scored.map((r) => [r.venue_ref, r]));
    const labels = new Map((await query('select key, label from shelf_subcategories')).rows.map((r) => [r.key, r.label]));

    // What they did to each row, in the household's own order.
    const did = new Map();
    for (const e of events) {
      if (e.kind === 'shown') continue;
      const prev = did.get(e.venue_ref) ?? [];
      prev.push(e);
      did.set(e.venue_ref, prev);
    }
    /**
     * What they did to one row, in the words the board uses.
     *
     * Three inactions, and they are different facts: a row they saw and moved
     * past, a row they said no to, and a row they never got down to. The third
     * is decided by the deepest thing they *did* touch — anything below the
     * furthest they reached was never reached (Codex, 17 Sep 2026).
     */
    const touched = events.filter((e) => e.kind !== 'shown');
    const deepest = Math.max(0, ...touched.map((e) => e.position ?? 0));
    const word = (list, position) => {
      const kinds = new Set((list ?? []).map((e) => e.kind));
      if (kinds.has('add_to_trip')) return { label: 'Opened, then tripped', strong: true };
      if (kinds.has('save') || kinds.has('shortlist')) return { label: 'Opened, then saved', strong: true };
      if (kinds.has('dismiss')) return { label: 'Dismissed', strong: false };
      if (kinds.has('open')) return { label: 'Opened, then closed', strong: true };
      // Nothing was done to it, and there are three ways that can be true. The
      // deepest row they touched is the only evidence we hold about how far down
      // they got — so where they touched nothing at all, we do not know, and the
      // row says that rather than claiming they never reached it (Codex and the
      // verification pass, 17 Sep 2026).
      if (!touched.length) return { label: 'Not opened', strong: false };
      return { label: position <= deepest ? 'Scrolled past' : 'Never reached', strong: false };
    };

    const rows = shown.map((e, i) => {
      const acts = did.get(e.venue_ref) ?? [];
      const w = word(acts, e.position ?? i + 1);
      const px = byRef.get(e.venue_ref);
      return {
        position: e.position ?? i + 1,
        ref: e.venue_ref,
        name: names.get(e.venue_ref)?.name ?? null,
        subcategory: px?.subcategory ? labels.get(px.subcategory) ?? px.subcategory : null,
        // The score at the time they were shown it, where the log kept it; the
        // score now otherwise, and the row says which.
        score: e.meta?.score ?? px?.data_score ?? null,
        scoreThen: e.meta?.score != null,
        did: w.label, strong: w.strong,
        dwellMs: acts.find((a) => a.dwell_ms != null)?.dwell_ms ?? null,
      };
    });

    const areaName = search.area_slug
      ? (await query('select name from localities where slug = $1', [search.area_slug])).rows[0]?.name ?? search.area_slug
      : null;
    res.json({
      id: search.id, at: search.at, surface: search.surface,
      subject: search.subject,
      // The subject in our own words, not the key it is stored under.
      subjectLabel: search.subject ? labels.get(search.subject) ?? search.subject : null,
      asked: search.asked,
      where: areaName ?? search.cell, minutes: search.minutes, mode: search.mode,
      // How many searches this area has had, so the way back says what it is
      // going back to (BO4b: "← Berkshire · 4,412 searches").
      searchesHere: search.area_slug
        ? (await query(
          `select count(*)::int as n from searches where area_slug = $1 and at > now() - interval '30 days'`,
          [search.area_slug])).rows[0].n
        : null,
      identified: Boolean(search.account_id), heldAgainst: search.account_id ? 'an account' : 'a household',
      shown: search.shown_total,
      opened: events.filter((e) => e.kind === 'open').length,
      saved: events.filter((e) => e.kind === 'save' || e.kind === 'shortlist').length,
      tripped: events.some((e) => e.kind === 'add_to_trip'),
      sourcesQueried: (search.sources_queried ?? []).map((k) => SOURCE_WORD[k] ?? k),
      degraded: search.degraded ?? [],
      rows,
      // What this replay actually cost, from the ledger, and what is still
      // bare. A figure that counts what was *not* fetched is a bill for nothing.
      refetched: named,
      askedAbout: asked,
      refetchedPence: spentPence,
      nameless: rows.filter((r) => !r.name).length,
      // Why a row is still an identifier — never left to be guessed at.
      namelessWhy: why,
    });
  } catch (err) { next(err); }
});

/** How big the log has got. The trigger to revisit retention is a count, not a date. */
router.get('/size', requires('view_reporting'), async (_req, res, next) => {
  try { res.json(await searches.size()); } catch (err) { next(err); }
});

/**
 * The aggregate-and-drop path, built and switched off.
 *
 * Nothing calls this on a timer. Switching it on is a setting rather than a
 * migration written under pressure.
 */
router.post('/roll-up', requires('manage_settings'), async (req, res, next) => {
  try {
    const before = req.body?.before ? new Date(req.body.before) : new Date(Date.now() - 365 * 86400_000);
    res.json(await searches.rollUp({ before, drop: req.body?.drop === true }));
  } catch (err) { next(err); }
});

export default router;
