// Research every place the owner adds to Places, once (owner, 2 Oct 2026,
// "Saved places — photos and enrichment", Part 2, revised 16:45).
//
// What it is, in his words and in order:
//
//   • "Part 2 runs only for places I (roger@epic.day) add to Places." The
//     accounts are a list (EPIC_ENRICH_SAVED_ACCOUNTS) so the rule is visible
//     and testable; it defaults to his address and nobody else's.
//   • "Run the existing free research first (OSM, venue page,
//     encyclopaedias); the Claude pass fills only what's still missing."
//     The free pass is sources/own.js, queued exactly as any save queues it;
//     this waits for it to land, then looks at what is still empty.
//   • "Log purpose claude.enrich.saved_place." Up to 12p a place: the pass is
//     Haiku 4.5 — the cheapest model with web search and fetch — with three
//     searches, five page reads and each page cut to a few thousand tokens.
//   • "Each fact keeps the page Claude actually read as its source (URL +
//     date). A search snippet alone is not a source — store 'don't know'."
//     Every value Claude returns must name a page that its own web_fetch
//     brought back in the same call; anything else is dropped to don't know.
//   • Owned images from Commons (the place-picture ladder, which the free pass
//     already walks), Openverse, and the venue's own site — the last by
//     address only, unlicensed, for the back office and the owner's account.
//
// What it keeps, and under which rule:
//
//   • A field read on the venue's own page is a `site` fact in place_facts —
//     the same source, terms and precedence the free pass writes — and is
//     composed into place_records. A field found anywhere else is recorded
//     here, with its page, but never enters the owned record.
//   • A yes/no answer is a place_answer only from an owned source (§ question
//     sets): the venue's own page (`site`) or Wikipedia. From anywhere else it
//     is "don't know", with the page noted.
//   • A menu found on the venue's page is handed to the menu reader that
//     already pools dish names, prices and dietary marks (place_menus) — facts,
//     never a copy of the page or the PDF.
//
// Runs once, in the background, and nothing on any screen waits for it. A
// re-run is asked for from the back office. A deploy that kills a pass leaves
// its row part-way, and `resumeStale` picks it up again.

import { z } from 'zod';
import { query } from '../db.js';
import { searchWeb } from '../claude.js';
import { runAsSpender } from '../context.js';
import * as owned from '../repositories/ownedPlaces.js';
import * as sets from '../repositories/questionSets.js';
import * as scout from '../repositories/scout.js';
import { queueEnrichment, recordSiteFacts } from './own.js';
import { ownedNamesFor } from './displayNames.js';
import { picturesFor as openversePictures } from './openverse.js';
import { venuePicturesFor } from './venueImages.js';

export const PURPOSE = 'claude.enrich.saved_place';
export const MODEL = 'claude-haiku-4-5';
const MAX_SEARCHES = 3;
const MAX_FETCHES = 5;
const PAGE_TOKENS = 6000;
const MAX_QUESTIONS = 20;

/** The accounts whose saves are researched. His address alone unless the env says otherwise. */
export function enrichAccounts() {
  return new Set(String(process.env.EPIC_ENRICH_SAVED_ACCOUNTS ?? 'roger@epic.day')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export const isEnrichAccount = (account) => Boolean(account?.email) && enrichAccounts().has(String(account.email).toLowerCase());

const hostOf = (u) => {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};
const sameSite = (a, b) => {
  const ha = hostOf(a); const hb = hostOf(b);
  if (!ha || !hb) return false;
  return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
};
const isWikipedia = (u) => /(^|\.)wikipedia\.org$/.test(hostOf(u) ?? '');
// Fetched pages are compared without their fragment or trailing slash, so
// "https://x.co/menu/" read and "https://x.co/menu" cited are the same page.
const norm = (u) => {
  const raw = String(u ?? '').replace(/#.*$/, '');
  // Only the scheme and the host are case-blind; a path is not, so "/Menu"
  // read does not vouch for "/menu" cited (Codex, 2 Oct 2026).
  try {
    const x = new URL(raw);
    return `${x.protocol.toLowerCase()}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, '')}${x.search}`;
  } catch { return raw.replace(/\/+$/, ''); }
};

// ---------------------------------------------------------------------------
// the record
// ---------------------------------------------------------------------------

export async function enrichmentOf(venueRef) {
  const { rows } = await query('select * from saved_place_enrichment where venue_ref = $1', [venueRef]);
  return rows[0] ?? null;
}

async function setState(venueRef, state, extra = {}) {
  const cols = ['state = $2', 'last_run_at = now()'];
  const args = [venueRef, state];
  for (const [k, v] of Object.entries(extra)) {
    args.push(k === 'found' ? JSON.stringify(v) : v);
    cols.push(`${k} = $${args.length}`);
  }
  await query(`update saved_place_enrichment set ${cols.join(', ')} where venue_ref = $1`, args);
}

/**
 * A place the owner has just added to Places. Returns immediately.
 *
 * `rerun` is the back office's "Re-run"; without it a place already researched
 * is left alone, because the brief says once.
 */
export async function requestEnrichment({ venueRef, account, householdId, sessionId = null, rerun = false, seedName = null }) {
  if (!venueRef || !householdId) return { started: false, why: 'no_place' };
  if (!rerun && !isEnrichAccount(account)) return { started: false, why: 'not_enrolled' };
  // A re-run is of a place already researched, and nothing else: never a way
  // to start the paid pass on an arbitrary reference (Codex, 2 Oct 2026).
  if (rerun) {
    const { rows } = await query(
      `update saved_place_enrichment set state = 'queued', error = null, requested_at = now(),
              household_id = $2, session_id = $3
        where venue_ref = $1 and state in ('done', 'failed')
        returning venue_ref`, [venueRef, householdId, sessionId]);
    if (!rows.length) return { started: false, why: (await enrichmentOf(venueRef)) ? 'already' : 'not_found' };
    const ctx = { householdId, sessionId, seedName };
    await setState(venueRef, 'free');
    return { started: true, onDone: followOn(venueRef, ctx), onFailed: onFreeFailed(venueRef) };
  }
  const { rows } = await query(
    `insert into saved_place_enrichment (venue_ref, account_id, household_id, session_id)
     values ($1, $2, $3, $4)
     on conflict (venue_ref) do nothing
     returning venue_ref`,
    [venueRef, account?.id ?? null, householdId, sessionId]);
  // A place mid-pass is not started again, re-run or not: a second pipeline
  // beside a running one would pay twice and race its writes (Codex, 2 Oct 2026).
  if (!rows.length) return { started: false, why: 'already' };
  const ctx = { householdId, sessionId, seedName };
  await setState(venueRef, 'free');
  // Handed back rather than queued here: a save already queues the free
  // research (sources/own.js claimPlace), and this joins that one job as its
  // `onDone`, so the place is researched once.
  return { started: true, onDone: followOn(venueRef, ctx), onFailed: onFreeFailed(venueRef) };
}

// The places this process has set going and not yet finished. A row waiting
// its turn in the research line looks stale by the clock, and `resumeStale`
// must not start it a second time — that would be a second paid pass. A
// restart empties this, which is exactly when the waiting rows need picking up.
const inProcess = new Set();

/** When the free research itself throws: the place is free to be picked up again. */
const onFreeFailed = (venueRef) => (err) => {
  inProcess.delete(venueRef);
  setState(venueRef, 'failed', { error: `free research failed: ${String(err?.message ?? err).slice(0, 200)}` }).catch(() => null);
};

const followOn = (venueRef, ctx) => {
  inProcess.add(venueRef);
  return () => {
    afterFree(venueRef, ctx)
      .catch((err) => {
        console.warn(`savedEnrich: ${venueRef}: ${err.message}`);
        return setState(venueRef, 'failed', { error: String(err.message).slice(0, 300) }).catch(() => null);
      })
      .finally(() => inProcess.delete(venueRef));
  };
};

/** A re-run, a backfill, or a pass a restart cut short: queue the free research with the rest to follow. */
function start(venueRef, ctx) {
  setState(venueRef, 'free').catch(() => null);
  queueEnrichment(venueRef, { householdId: ctx.householdId, sessionId: ctx.sessionId, onDone: followOn(venueRef, ctx), onFailed: onFreeFailed(venueRef) });
}

/**
 * The owner's places already in Places when this was built, not yet
 * researched: saved, loved or been, not dismissed, not a photograph-only place.
 * The back office prices them before anything is spent (`backfill`).
 */
export async function backfillCandidates(householdId) {
  const { rows } = await query(
    `select hp.venue_ref from household_places hp
      where hp.household_id = $1
        and hp.venue_ref like '%:%' and hp.venue_ref not like 'photo:%'
        and not exists (select 1 from saved_place_enrichment e where e.venue_ref = hp.venue_ref)
        -- The ledger is append-only, so what counts is its latest word: a place
        -- dismissed and saved again since is in Places; one saved then
        -- dismissed, or been then dismissed, is not (Codex, 2 Oct 2026).
        and (select l.status from place_ledger l where l.household_id = hp.household_id
               and l.source || ':' || l.source_place_id = hp.venue_ref
             order by l.created_at desc limit 1) is distinct from 'dismissed'
        and (exists (select 1 from place_ledger l where l.household_id = hp.household_id
                       and l.source || ':' || l.source_place_id = hp.venue_ref and l.status in ('saved', 'special'))
             or exists (select 1 from visits v where v.household_id = hp.household_id and v.venue_ref = hp.venue_ref))
      order by hp.venue_ref`, [householdId]);
  return rows.map((r) => r.venue_ref);
}

/** The target ceiling a place is priced at before the click: the brief's 12p. */
export const TARGET_PENCE = 12;

/**
 * Research every one of the owner's places not yet researched. Refused unless
 * handed the count its own quote showed, so a list that grew between the quote
 * and the press is priced again rather than spent (the sweep's rule).
 */
export async function backfill({ account, householdId, sessionId = null, expectPlaces }) {
  if (!isEnrichAccount(account)) return { started: 0, why: 'not_enrolled' };
  const refs = await backfillCandidates(householdId);
  if (Number(expectPlaces) !== refs.length) return { started: 0, why: 'quote_changed', places: refs.length };
  let started = 0;
  for (const ref of refs) {
    const out = await requestEnrichment({ venueRef: ref, account, householdId, sessionId });
    if (!out.started) continue;
    queueEnrichment(ref, { householdId, sessionId, onDone: out.onDone, onFailed: out.onFailed });
    started += 1;
  }
  return { started, why: null };
}

/** The back office's "Re-run": research the place again, free pass first. */
export async function rerun(venueRef, { account = null, householdId, sessionId = null }) {
  const out = await requestEnrichment({ venueRef, account, householdId, sessionId, rerun: true });
  if (out.started) queueEnrichment(venueRef, { householdId, sessionId, onDone: out.onDone, onFailed: out.onFailed });
  return { started: out.started, why: out.why ?? null };
}

/**
 * Everything after the free research: the pictures, then Claude for what is
 * still missing. Spent on the saver's own household and session.
 */
export async function afterFree(venueRef, ctx, deps = {}) {
  return runAsSpender({ householdId: ctx.householdId, sessionId: ctx.sessionId }, async () => {
    const found = { fields: {}, facts: {}, pictures: {}, notes: [] };
    await query(
      `update saved_place_enrichment set free_done_at = now(), runs = runs + 1, last_run_at = now() where venue_ref = $1`, [venueRef]);
    const record = await owned.recordFor(venueRef).catch(() => null);
    const name = (await ownedNamesFor([venueRef], ctx.householdId).catch(() => new Map())).get(venueRef)?.name
      ?? record?.name ?? ctx.seedName ?? null;
    const locality = record?.postcode ?? null;

    // What the free pass established, so the back office can show it beside
    // what Claude added. The record's own provenance names the source.
    for (const f of ['website', 'phone', 'booking_url', 'menu_url', 'socials']) {
      const v = record?.[f];
      if (v && !(typeof v === 'object' && !Object.keys(v).length)) {
        found.fields[f] = { value: v, source: record?.provenance?.[f] ?? 'own', sourceUrl: null, checkedAt: record?.enriched_at ?? null };
      }
    }

    // Pictures: free, and asked before anything paid.
    const ov = await (deps.openverse ?? openversePictures)({ venueRef, name, locality }).catch((err) => ({ ok: false, why: err.message, stored: [] }));
    // What the place holds from Openverse now, not only what this run added:
    // a re-run that finds nothing new still owns what it found before (Codex,
    // 2 Oct 2026).
    const { rows: [heldOv] } = await query(
      `select count(*)::int as n from image_links l join image_assets i on i.id = l.image_id
        where l.subject_type = 'place' and l.subject_id = $1 and i.source = 'openverse' and i.moderation <> 'rejected'`, [venueRef]);
    found.pictures.openverse = ov.ok ? { stored: heldOv.n, added: ov.stored.length, refused: ov.refused } : { error: ov.why, stored: heldOv.n };
    if (record?.website) {
      const vs = await (deps.venuePictures ?? venuePicturesFor)(venueRef, record.website).catch((err) => ({ ok: false, why: err.message }));
      found.pictures.venueSite = vs.ok ? { kept: vs.kept } : { error: vs.why };
    }

    const asks = deps.asks ?? await questionsToAsk(venueRef);
    const missing = ['website', 'phone', 'booking_url', 'menu_url', 'socials'].filter((f) => !found.fields[f]);
    if (!name) {
      found.notes.push('No name to research the place by.');
      await setState(venueRef, 'done', { found, claude_done_at: null, last_cost_usd: 0 });
      return { state: 'done', found, costUsd: 0 };
    }
    if (!missing.length && !asks.length) {
      found.notes.push('The free research found everything; Claude was not asked.');
      await setState(venueRef, 'done', { found, last_cost_usd: 0 });
      return { state: 'done', found, costUsd: 0 };
    }

    await setState(venueRef, 'claude', { found });
    let pass;
    try {
      pass = await claudePass({ venueRef, name, record, missing, asks, ctx }, deps);
    } catch (err) {
      // A call that was made was paid for, whatever became of its reply: the
      // cost goes on the row as it went on the ledger (Codex, 2 Oct 2026).
      const spent = Number(err.costUsd ?? 0);
      found.notes.push(`Claude pass failed: ${err.code ?? err.message}`);
      await query(
        `update saved_place_enrichment set state = 'failed', last_run_at = now(), found = $2, error = $3,
                cost_usd = cost_usd + $4, last_cost_usd = $4
          where venue_ref = $1`,
        [venueRef, JSON.stringify(found), String(err.code ?? err.message).slice(0, 300), spent]);
      return { state: 'failed', found, costUsd: spent };
    }
    Object.assign(found.fields, pass.fields);
    found.facts = pass.facts;
    found.notes.push(...pass.notes);
    // A website Claude found and opened is the venue's site now: its pictures
    // are looked for there and then, not on the next re-run (Codex, 2 Oct 2026).
    if (!record?.website && pass.website) {
      const vs = await (deps.venuePictures ?? venuePicturesFor)(venueRef, pass.website).catch((err) => ({ ok: false, why: err.message }));
      found.pictures.venueSite = vs.ok ? { kept: vs.kept } : { error: vs.why };
    }
    await query(
      `update saved_place_enrichment set state = 'done', claude_done_at = now(), last_run_at = now(),
              found = $2, cost_usd = cost_usd + $3, last_cost_usd = $3, error = null
        where venue_ref = $1`,
      [venueRef, JSON.stringify(found), pass.costUsd ?? 0]);
    return { state: 'done', found, costUsd: pass.costUsd ?? 0 };
  });
}

/**
 * The yes/no questions this place's set asks that no owned source has
 * answered yet. Only yes/no: a range or a choice read off a page is a
 * different kind of reading, and the brief's fact sheet is yes / no / don't know.
 */
async function questionsToAsk(venueRef) {
  const { rows: place } = await query('select subcategory from place_index where venue_ref = $1', [venueRef]);
  const subcategory = place[0]?.subcategory ?? null;
  const set = subcategory ? await sets.setForSubcategory(subcategory) : null;
  const asked = await sets.questionsFor(set?.key ?? null);
  const answered = new Set((await sets.answersFor(venueRef)).filter((a) => a.state === 'answered').map((a) => a.question_id));
  return asked
    .filter((q) => q.active !== false && q.kind === 'yesno' && !answered.has(q.id))
    .slice(0, MAX_QUESTIONS)
    .map((q) => ({ id: q.id, key: q.attribute_key, label: q.label }));
}

// ---------------------------------------------------------------------------
// the Claude pass
// ---------------------------------------------------------------------------

const Cited = z.object({ value: z.string(), source_url: z.string() }).nullable().optional();
const Answer = z.object({
  fields: z.object({
    website: Cited, phone: Cited, booking_url: Cited, menu_url: Cited,
    socials: z.array(z.object({ network: z.string(), url: z.string(), source_url: z.string() })).optional(),
  }).partial().optional(),
  facts: z.array(z.object({
    key: z.string(),
    answer: z.enum(['yes', 'no', 'unknown']),
    source_url: z.string().nullable().optional(),
  })).optional(),
});

const SYSTEM = `You research one UK venue so a family app can describe it. Use web_search to find the venue's own official website, then web_fetch to read its pages (home, menu, contact, booking, about/FAQ). You may also read its Wikipedia article.

Rules:
- Only report what you read on a page you fetched with web_fetch. A search result snippet is not a source.
- Every value names the exact URL of the fetched page it came from.
- Prefer the venue's own website. Never use review sites, booking aggregators or social media posts as a source for a fact.
- For each question answer "yes" or "no" only when a fetched page says so plainly; otherwise "unknown" with source_url null.
- Do not describe the venue or copy its text.

Reply with one JSON object and nothing else:
{"fields":{"website":{"value":"","source_url":""},"phone":{...},"booking_url":{...},"menu_url":{...},"socials":[{"network":"instagram","url":"","source_url":""}]},"facts":[{"key":"","answer":"yes|no|unknown","source_url":""}]}
Omit a field you could not find.`;

/** The JSON object in a reply, or null. Never a guess: an unparsable reply is a failed pass. */
export function parseReply(text) {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = Answer.safeParse(JSON.parse(s.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/**
 * Keep only what was read, and file each thing under the source it came from.
 * Pure: the reply, the pages fetched, and the venue's site in; what to write
 * and what to show out. Tested on its own.
 */
export function judge({ reply, fetched, knownWebsite = null, asks = [] }) {
  const read = new Set((fetched ?? []).map(norm));
  const wasRead = (u) => Boolean(u) && read.has(norm(u));
  const at = new Date().toISOString();
  const fields = {};
  const siteFacts = {};
  const notes = [];

  // The venue's site: the one it already had, or the one Claude found and
  // actually opened. A website nobody opened is a guess about a website.
  let website = knownWebsite;
  const w = reply?.fields?.website;
  if (!website && w?.value && (wasRead(w.value) || [...read].some((u) => sameSite(u, w.value)))) {
    website = w.value;
    siteFacts.website = w.value;
    // The page that vouches for it is one that was fetched in this call —
    // the cited page if it was read, the site itself if that was, or else the
    // fetched page on the same site (Codex, 2 Oct 2026). Never an unread root.
    const vouch = (w.source_url && wasRead(w.source_url) && w.source_url)
      || (wasRead(w.value) && w.value)
      || (fetched ?? []).find((u) => sameSite(u, w.value));
    fields.website = { value: w.value, source: 'site', sourceUrl: vouch, checkedAt: at };
  } else if (!website && w?.value) {
    fields.website = { value: null, source: 'unknown', sourceUrl: null, checkedAt: at, why: 'found in search only, never opened' };
  }
  const onVenueSite = (u) => Boolean(website) && wasRead(u) && sameSite(u, website);

  for (const f of ['phone', 'booking_url', 'menu_url']) {
    const v = reply?.fields?.[f];
    if (!v?.value) continue;
    if (onVenueSite(v.source_url)) {
      siteFacts[f] = v.value;
      fields[f] = { value: v.value, source: 'site', sourceUrl: v.source_url, checkedAt: at };
    } else if (wasRead(v.source_url)) {
      // Read, but somewhere other than the venue's own page: shown in the back
      // office with its page, never written into the owned record.
      fields[f] = { value: v.value, source: 'other_page', sourceUrl: v.source_url, checkedAt: at };
    } else {
      fields[f] = { value: null, source: 'unknown', sourceUrl: null, checkedAt: at, why: 'no page read says so' };
    }
  }
  const socials = {};
  const socialPages = {};
  for (const s of reply?.fields?.socials ?? []) {
    if (!s?.url || !s.network) continue;
    if (!onVenueSite(s.source_url)) continue;
    const net = String(s.network).toLowerCase();
    socials[net] = s.url;
    socialPages[net] = s.source_url;
  }
  if (Object.keys(socials).length) {
    siteFacts.socials = socials;
    // Each link keeps the page it was read on (Codex, 2 Oct 2026): the page
    // shown is one that was fetched, never the site's root by assumption.
    const pages = [...new Set(Object.values(socialPages))];
    fields.socials = { value: socials, source: 'site', sourceUrl: pages[0], ...(pages.length > 1 ? { sourceUrls: socialPages } : {}), checkedAt: at };
  }

  const byKey = new Map(asks.map((q) => [q.key, q]));
  const facts = {};
  const answers = [];
  for (const f of reply?.facts ?? []) {
    const q = byKey.get(f.key);
    if (!q) continue;
    if (f.answer !== 'unknown' && f.source_url && (onVenueSite(f.source_url) || (wasRead(f.source_url) && isWikipedia(f.source_url)))) {
      const source = onVenueSite(f.source_url) ? 'site' : 'wikipedia';
      facts[f.key] = { label: q.label, answer: f.answer, source, sourceUrl: f.source_url, checkedAt: at };
      answers.push({ questionId: q.id, source, yesno: f.answer === 'yes', sourceUrl: f.source_url });
    } else {
      facts[f.key] = {
        label: q.label, answer: 'unknown', source: null, sourceUrl: null, checkedAt: at,
        ...(f.answer !== 'unknown' ? { why: wasRead(f.source_url) ? `said on ${hostOf(f.source_url)}, not an owned source` : 'not on a page that was read' } : {}),
      };
    }
  }
  // Questions Claude did not mention are don't-know too, said out loud.
  for (const q of asks) if (!facts[q.key]) facts[q.key] = { label: q.label, answer: 'unknown', source: null, sourceUrl: null, checkedAt: at };

  const venuePagesRead = [...read].filter((u) => website && sameSite(u, website));
  if (!venuePagesRead.length) notes.push("No page on the venue's own site was read.");
  return { website, fields, siteFacts, facts, answers, venuePagesRead, notes };
}

async function claudePass({ venueRef, name, record, missing, asks, ctx }, deps = {}) {
  const prompt = [
    `Venue: ${name}`,
    record?.address ? `Address: ${record.address}` : null,
    record?.postcode ? `Postcode: ${record.postcode}` : null,
    record?.category ? `Kind of place: ${record.category}` : null,
    record?.website ? `Its website (already known): ${record.website}` : 'Its website: not known yet — find it.',
    missing.length ? `Find: ${missing.join(', ')}.` : 'All contact fields are known.',
    asks.length ? `Questions (answer each by key):\n${asks.map((q) => `- ${q.key}: ${q.label}?`).join('\n')}` : 'No questions.',
  ].filter(Boolean).join('\n');

  const meta = {};
  const out = await (deps.searchWeb ?? searchWeb)({
    system: SYSTEM, prompt,
    householdId: ctx.householdId, sessionId: null,
    purpose: PURPOSE, model: MODEL,
    maxSearches: MAX_SEARCHES, maxFetches: MAX_FETCHES, maxPageTokens: PAGE_TOKENS,
    meta,
  });
  const costUsd = Number(meta.costUsd ?? 0);
  const reply = parseReply(out.text);
  // Can't speak: a reply that is not the shape asked for is a failed pass, not
  // a place with nothing to find (CLAUDE.md, the can't-speak rule).
  if (!reply) throw Object.assign(new Error('unparsed_reply'), { code: 'unparsed_reply', costUsd });
  try {
    return await writePass({ venueRef, reply, out, record, asks, costUsd });
  } catch (err) {
    throw Object.assign(err, { costUsd });
  }
}

async function writePass({ venueRef, reply, out, record, asks, costUsd }) {

  const j = judge({ reply, fetched: out.fetched, knownWebsite: record?.website ?? null, asks });
  if (Object.keys(j.siteFacts).length) await recordSiteFacts(venueRef, j.siteFacts);
  for (const a of j.answers) {
    await sets.saveAnswer({ venueRef, questionId: a.questionId, source: a.source, state: 'answered', value: { yesno: a.yesno }, sourceUrl: a.sourceUrl });
  }
  // "Asked, nothing found" is a real answer — but only where the venue's own
  // pages were actually read, and never over an answer the site already gave.
  if (j.venuePagesRead.length) {
    const had = new Set((await sets.answersFor(venueRef)).filter((a) => a.source === 'site').map((a) => a.question_id));
    for (const q of asks) {
      if (j.facts[q.key]?.answer === 'unknown' && !had.has(q.id)) {
        // The page actually read, never the site's root by assumption (Codex, 2 Oct 2026).
        await sets.saveAnswer({ venueRef, questionId: q.id, source: 'site', state: 'asked_nothing_found', sourceUrl: j.venuePagesRead[0] });
      }
    }
  }
  // A menu on the venue's page goes to the reader that pools dish names,
  // prices and dietary marks (place_menus); this pass does not read menus itself.
  if (j.siteFacts.menu_url) {
    await scout.recordMenuFound(venueRef, { venueLabel: null, menuUrl: j.siteFacts.menu_url, how: 'saved-place research' }).catch(() => null);
  }
  return {
    website: j.siteFacts.website ?? null,
    fields: j.fields, facts: j.facts,
    notes: [...j.notes, `Read ${out.fetched.length} page(s), ${out.searches} search(es).`],
    costUsd,
  };
}

// ---------------------------------------------------------------------------
// after a deploy
// ---------------------------------------------------------------------------

/**
 * Pick up passes a restart cut short. A row left in queued/free/claude for
 * longer than a pass takes is started again on the household and session it
 * was asked for.
 */
export async function resumeStale({ olderThanMinutes = 15 } = {}) {
  const { rows } = await query(
    `select venue_ref, household_id, session_id from saved_place_enrichment
      where state in ('queued', 'free', 'claude')
        and coalesce(last_run_at, requested_at) < now() - make_interval(mins => $1)
      order by requested_at limit 20`, [olderThanMinutes]);
  const due = rows.filter((r) => !inProcess.has(r.venue_ref));
  for (const r of due) start(r.venue_ref, { householdId: r.household_id, sessionId: r.session_id });
  return due.length;
}

let loop = null;
export function startSavedEnrichLoop({ everyMs = 10 * 60_000 } = {}) {
  if (loop) return;
  loop = setInterval(() => { resumeStale().catch(() => null); }, everyMs);
  loop.unref?.();
}

/** Every enrolled saved place and where its research is, for the back office. One more than asked, so a caller can say there are more. */
export async function enrichmentList({ limit = 500 } = {}) {
  const { rows } = await query(
    `select e.*, coalesce(r.name, e.venue_ref) as name, r.category, r.website, r.menu_url
       from saved_place_enrichment e left join place_records r on r.venue_ref = e.venue_ref
      order by e.requested_at desc limit $1`, [limit + 1]);
  return rows;
}

/**
 * The brief's measures over every finished pass, uncapped — never derived from
 * a page of rows (Codex, 2 Oct 2026; CLAUDE.md, "a capped list is not a
 * complete one"). A field counts as found when it has a value and a source
 * other than "don't know"; pictures are Openverse kept plus venue-site found.
 */
export async function enrichmentSummary() {
  const { rows: [r] } = await query(
    `with done as (select * from saved_place_enrichment where state = 'done')
     select count(*)::int as done,
            count(*) filter (where found->'fields'->'website'->>'value' is not null and found->'fields'->'website'->>'source' <> 'unknown')::int as website,
            count(*) filter (where found->'fields'->'menu_url'->>'value' is not null and found->'fields'->'menu_url'->>'source' <> 'unknown')::int as menu,
            count(*) filter (where coalesce((found->'pictures'->'openverse'->>'stored')::int, 0) + coalesce((found->'pictures'->'venueSite'->>'kept')::int, 0) > 0)::int as pictured,
            count(*) filter (where coalesce(last_cost_usd, 0) > 0)::int as paid,
            coalesce(avg(last_cost_usd) filter (where coalesce(last_cost_usd, 0) > 0), 0)::float as avg_cost_usd
       from done`);
  return r;
}
