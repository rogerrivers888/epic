/**
 * The fact pipeline (back-office handover section 5): Spot, Verify, Add,
 * Re-check, Families confirm. Every threshold is read from the settings table
 * at run time (desk/settings.js), so changing a rule on Fact automations
 * changes what the machine does next, and nothing here spends money:
 *
 *   - Spot reads Google's review text that is already in memory because a
 *     household opened a place (a call already paid for), matches it against
 *     the facts Epic knows, with polarity, and writes a suggestion — a place
 *     id, a feature, a status, a date; never the text (C30). The text is
 *     discarded when the request ends.
 *   - Verify reads only our own sources: the venue's own page and the
 *     Wikipedia body (stored by the researcher), our local copy of the open
 *     map, and Wikidata's "has facility". Google never answers (C3, C22).
 *   - Add, Re-check and Families work on our own tables.
 */

import { query, withTransaction } from '../db.js';
import { settings } from './settings.js';
import * as osmLocal from '../sources/osmExtract.js';
import { osmElement } from '../sources/openMatch.js';
import { noteFetch } from './verification.js';

// ---------------------------------------------------------------------------
// Words

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

const NEGATIONS = new Set(['no', 'not', 'without', 'lacks', 'lacking', 'lack', 'never', 'nor', "doesn't", 'doesnt', "don't", 'dont', "didn't", 'didnt', "isn't", 'isnt', "wasn't", 'wasnt', "aren't", 'arent', "weren't", 'werent', "hasn't", 'hasnt', "haven't", 'havent', 'closed', 'shut', 'removed', 'gone']);
const WISHES = [/\bwish (they|there|it) (had|was|were)\b/, /\bwould be (nice|good|great)\b/, /\bif only\b/, /\bshould (have|add|get)\b/, /\bneeds? (a|an|some)\b/];

/**
 * What a sentence says about a phrase: 'asserts', 'denies' or 'asks' (C21,
 * §5.1 "Polarity is captured at extraction or not at all"). "Does it have a
 * wave machine? We couldn't find one" mentions it and means the opposite; "I
 * wish they had a sauna" is not an assertion.
 */
const VERB = /^(?:is|are|was|were|will|be|been|being|has|have|had|remains?|remained|stays?|stayed|seems?|seemed|appears?|appeared|looks?|looked|gets?|got|getting|'re|'ve|'ll|'d|’re|’ve|’ll|’d|isnt|isn't|wasnt|wasn't)$/;
const ADVERB = /^(?:still|now|currently|permanently|temporarily|sadly|unfortunately|often|sometimes|always|\w+ly)$/;
const CLOSURE = /^(?:closed|shut|removed|gone|broken|unavailable)$/;
const CLOSURE_2 = /^(?:out of (?:order|use)|not working|not open)/;
const WHEN_WHY = /^(?:for|until|till|since|on|at|in|during|over|by|due|because|when|as|today|tomorrow|now|again|this|last|next|all|to|pending|every|indefinitely|\w+ly)$/;
function closureOfPhrase(clause) {
  const words = String(clause).replace(/^\s*(['’](?:s|ll|d|re|ve))/, ' $1').trim().split(/\s+/).map((w) => w.replace(/[^a-z'’]/g, '')).filter(Boolean);
  let verb = false;
  for (let i = 0; i < Math.min(words.length, 6); i += 1) {
    const w = words[i];
    const rest = words.slice(i).join(' ');
    if (CLOSURE.test(w) || CLOSURE_2.test(rest)) {
      if (verb) return true;
      const next = words[i + (CLOSURE_2.test(rest) ? 3 : 1)];
      return next === undefined || WHEN_WHY.test(next);
    }
    if (VERB.test(w)) { verb = true; continue; }
    if (ADVERB.test(w) || /^['’]s$/.test(w)) continue;
    return false; // anything else between them: the closure belongs to something else
  }
  return false;
}

export function polarity(sentence, phrase) {
  const s = norm(sentence);
  const p = norm(phrase);
  const at = s.indexOf(p);
  if (at < 0) return null;
  if (/\?/.test(sentence)) return 'asks';
  if (WISHES.some((re) => re.test(s))) return 'asks';
  const before = s.slice(Math.max(0, at - 40), at).split(' ').filter(Boolean).slice(-5);
  if (before.some((w) => NEGATIONS.has(w))) return 'denies';
  // After the phrase: "the toilets are not available", "the sauna isn't
  // working", "the pool was closed" (Codex, 28 Sep 2026).
  // Only a negation that belongs to the phrase: straight after it, or after
  // its verb — "great, not crowded" says nothing against the pool.
  // Read from the sentence as written: normalising drops the comma, and
  // "pool, not crowded" would read as "pool not" (Codex, 28 Sep 2026).
  const raw = String(sentence).toLowerCase();
  const ri = raw.indexOf(String(phrase).toLowerCase());
  const tail = ri >= 0 ? raw.slice(ri + String(phrase).length, ri + String(phrase).length + 40) : s.slice(at + p.length, at + p.length + 40);
  if (/^\s*(?:(?:are|is|was|were|has been|have been|seems|seemed)\s+)?(?:not|never|no longer)\b/.test(tail)) return 'denies';
  if (/^\s*(?:isnt|isn't|arent|aren't|wasnt|wasn't|werent|weren't)\b/.test(tail)) return 'denies';
  // A status word counts only when it belongs to the phrase — straight after
  // it or after its verb, inside the same clause: "the pool; the cafe was
  // closed" says nothing about the pool (Codex, 28 Sep 2026).
  // The phrase's own clause: what follows it up to the next ; . ! ? , or a
  // "but"/"and" — so "the pool is still closed", "Pool: closed" and "remains
  // closed" deny the pool, and "the pool; the cafe was closed" does not.
  const clause = tail.replace(/^\s*[:\-–—]\s*/, ' ').split(/[;.!?,]|\s(?:but|and|while|whereas)\s/)[0];
  // Walk the phrase's clause: links (verbs, adverbs, contractions) up to a
  // closure word. Said of the phrase when a verb links them — "is closed",
  // "has been closed", "'ll be closed" — whatever follows ("indefinitely",
  // "to visitors", "every Monday"). With no verb — "Pool: closed", or the
  // possessive "the pool's recently closed cafe" — it is said of the phrase
  // only if nothing but when or why follows; a noun after it means it
  // describes that noun (Codex, 28 Sep 2026, several rounds).
  if (closureOfPhrase(clause)) return 'denies';
  if (/\bno longer\b/.test(s.slice(Math.max(0, at - 30), at))) return 'denies';
  return 'asserts';
}

const sentences = (text) => String(text ?? '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

/**
 * The yes/no facts Epic knows, each with the phrases that name it (its label,
 * a plural, and its aliases). Standard facts are included: a review saying
 * "no toilets" is as useful as one saying "a sauna".
 */
let vocabCache = null;
let vocabAt = 0;
export async function vocabulary() {
  if (vocabCache && Date.now() - vocabAt < 60_000) return vocabCache;
  const [{ rows: attrs }, { rows: aliases }] = await Promise.all([
    query(`select key, label, standard, access, age, dietary from place_attributes where active and kind = 'yesno'`),
    query('select norm, target_key from attribute_aliases').catch(() => ({ rows: [] })),
  ]);
  const byKey = new Map(attrs.map((a) => [a.key, { ...a, phrases: new Set([norm(a.label), `${norm(a.label)}s`]) }]));
  for (const a of aliases) byKey.get(a.target_key)?.phrases.add(norm(a.norm));
  // Standard facts are said in plainer words than their labels.
  const EXTRA = { 'step-free': ['step free', 'wheelchair accessible', 'step-free access'], 'dog-friendly': ['dog friendly', 'dogs allowed', 'dogs welcome'], 'food-on-site': ['cafe on site', 'restaurant on site', 'food on site'], 'booking-required': ['booking required', 'book in advance', 'pre-booking'], indoor: ['indoors', 'indoor'] };
  for (const [k, list] of Object.entries(EXTRA)) for (const w of list) byKey.get(k)?.phrases.add(norm(w));
  vocabCache = [...byKey.values()].map((a) => ({ ...a, phrases: [...a.phrases].filter((p) => p.length >= 3) }));
  vocabAt = Date.now();
  return vocabCache;
}
export const forgetVocabulary = () => { vocabCache = null; };

// ---------------------------------------------------------------------------
// 1. Spot

/**
 * Read review text in memory and raise suggestions. `reviews` is a list of
 * review texts, one per review (the unit `spotMentions` counts); `summary` is
 * Google's own summary, read like one more review. Nothing here is stored but
 * the suggestion. Returns what a household may be shown in this session
 * ("Reviewers mention a sauna"), which is never stored either.
 */
export async function spot({ ref, reviews = [], summary = null }) {
  const cfg = (await settings()).values;
  const vocab = await vocabulary();
  const texts = [...reviews, ...(summary ? [summary] : [])].filter(Boolean);
  if (!ref || !texts.length) return { suggested: [], mention: [] };
  const tally = new Map();
  for (const t of texts) {
    const seen = new Map();
    for (const s of sentences(t)) {
      for (const a of vocab) {
        for (const p of a.phrases) {
          const pol = polarity(s, p);
          if (!pol) continue;
          // One review counts once per fact, its strongest statement: a
          // denial beats an assertion beats a question.
          const was = seen.get(a.key);
          const rank = { denies: 3, asserts: 2, asks: 1 };
          if (!was || rank[pol] > rank[was]) seen.set(a.key, pol);
        }
      }
    }
    for (const [k, pol] of seen) {
      const c = tally.get(k) ?? { asserts: 0, denies: 0, asks: 0 };
      c[pol] += 1;
      tally.set(k, c);
    }
  }
  const byKey = new Map(vocab.map((a) => [a.key, a]));
  const suggested = [];
  const mention = [];
  for (const [k, c] of tally) {
    const a = byKey.get(k);
    if (c.asserts >= cfg.spotMentions || c.denies > 0) {
      const status = c.denies > 0 ? 'conflict' : 'waiting';
      await query(
        `insert into fact_suggestions (venue_ref, feature, status) values ($1, $2, $3)
         on conflict (venue_ref, feature) do update set status = case when excluded.status = 'conflict' then 'conflict' else fact_suggestions.status end`,
        [ref, k, status]);
      suggested.push({ fact: k, label: a.label, status });
    }
    if (c.asserts >= cfg.suggestReviews && c.denies === 0) mention.push({ fact: k, label: a.label, text: `Reviewers mention ${a.label.toLowerCase().startsWith('a ') ? a.label.toLowerCase() : article(a.label)}`, credit: 'Google' });
  }
  return { suggested, mention };
}

const article = (label) => { const l = label.toLowerCase(); return /^[aeiou]/.test(l) ? `an ${l}` : `a ${l}`; };

// ---------------------------------------------------------------------------
// 2. Verify

/** Which re-check period applies to a fact (5.1: physical 12, access 6, food 6 months). */
function recheckMonths(attr, cfg) {
  if (attr.dietary) return cfg.recheckFood;
  if (attr.access) return cfg.recheckAccess;
  return cfg.recheckPhysical;
}

/** Open-map tags that answer a standard fact directly. */
const OSM_TAG = { toilets: 'toilets', 'step-free': 'wheelchair', 'dog-friendly': 'dog' };

/** What the open map says: yes, no or nothing, and the tag it read. */
export function fromOsm(attr, phrases, tags) {
  if (!tags) return { says: 'nothing' };
  const key = OSM_TAG[attr.key];
  if (key && tags[key]) {
    const v = String(tags[key]).toLowerCase();
    if (['yes', 'designated', 'limited', 'leashed'].includes(v)) return { says: 'yes', quote: `${key}=${tags[key]}` };
    if (v === 'no') return { says: 'no', quote: `${key}=${tags[key]}` };
  }
  // A feature that is a tag value somewhere on the element: leisure=sauna,
  // sport=swimming, attraction=water_slide.
  for (const [k, v] of Object.entries(tags)) {
    const val = norm(String(v).replace(/_/g, ' '));
    if (phrases.some((p) => val === p || val === p.replace(/s$/, ''))) return { says: 'yes', quote: `${k}=${v}` };
    if (norm(k.replace(/_/g, ' ')) === norm(attr.label) && ['yes', 'no'].includes(String(v).toLowerCase())) return { says: String(v).toLowerCase(), quote: `${k}=${v}` };
  }
  return { says: 'nothing' };
}

/** What a body of text says: yes, no or nothing, with the sentence as evidence. */
export function fromText(phrases, text) {
  let found = null;
  for (const s of sentences(text)) {
    for (const p of phrases) {
      const pol = polarity(s, p);
      if (pol === 'denies') return { says: 'no', quote: s.slice(0, 300) };
      if (pol === 'asserts' && !found) found = { says: 'yes', quote: s.slice(0, 300) };
    }
  }
  return found ?? { says: 'nothing' };
}

/** Wikidata's "has facility" (P912) and "has part" (P527) labels, fetched free. */
async function wikidataFacilities(qid) {
  if (!/^Q\d+$/.test(String(qid ?? ''))) return null;
  // The one source the verify step fetches live, so its fetches are written
  // down (Verification's Failing %, via noteFetch) — the others are read from
  // our own stored copies.
  const began = Date.now();
  const note = (ok, fault = null) => noteFetch('wikidata', ok, { ms: Date.now() - began, fault });
  try {
    const ua = { headers: { 'user-agent': `Epic/0.1 (${process.env.EPIC_CONTACT_EMAIL ?? 'hello@epic.day'})` }, signal: AbortSignal.timeout(8000) };
    const r1 = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, ua);
    if (!r1.ok) { await note(false, `http_${r1.status}`); return null; }
    const e = await r1.json();
    const claims = e.entities?.[qid]?.claims ?? {};
    const ids = ['P912', 'P527'].flatMap((p) => (claims[p] ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean)).slice(0, 40);
    if (!ids.length) { await note(true); return []; }
    const r2 = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels&languages=en&format=json`, ua);
    if (!r2.ok) { await note(false, `http_${r2.status}`); return null; }
    const l = await r2.json();
    await note(true);
    return Object.values(l.entities ?? {}).map((x) => x.labels?.en?.value).filter(Boolean);
  } catch (err) {
    await note(false, err?.name === 'TimeoutError' ? 'timeout' : 'unreachable');
    return null;
  }
}

/**
 * Everything our own sources hold about a place, read once: the venue page and
 * the Wikipedia body (stored by the researcher), the element in our local copy
 * of the open map, and Wikidata's facilities. Answering several facts reads
 * this once, not once a fact.
 */
/**
 * An element fetched from the open map, remembered for a day — including
 * "not there" — so opening a place again, or a pre-warm, does not ask the
 * public mirrors for the same element over and over and hold up the queue
 * (Codex, 28 Sep 2026). A failed fetch is not remembered.
 */
const OSM_TTL_MS = 24 * 3600_000;
const osmSeen = new Map();
async function osmFetched(ref) {
  const hit = osmSeen.get(ref);
  if (hit && Date.now() - hit.at < OSM_TTL_MS) return hit.value;
  const value = await osmElement(ref).catch(() => undefined);
  if (value === undefined) return undefined;
  if (osmSeen.size > 5000) osmSeen.delete(osmSeen.keys().next().value);
  osmSeen.set(ref, { at: Date.now(), value });
  return value;
}

export async function evidenceFor(ref) {
  const [{ rows: facts }, { rows: [rec] }] = await Promise.all([
    query(`select source, field, value from place_facts where venue_ref = $1 and field in ('body', 'summary') and source in ('site', 'wikipedia')`, [ref]),
    query('select osm_ref, wikidata_id from place_records where venue_ref = $1', [ref]),
  ]);
  const textOf = (src) => facts.filter((f) => f.source === src).map((f) => (typeof f.value === 'string' ? f.value : f.value?.text ?? '')).join('\n');
  const out = { site: textOf('site') || null, wikipedia: textOf('wikipedia') || null, osm: undefined, wikidata: undefined };
  if (rec?.osm_ref) {
    // Our own copy first; a miss there may only mean the element lies outside
    // every loaded extract, so it is asked of the open map itself before it
    // counts as "read and found nothing" (Codex, 28 Sep 2026). A failed fetch
    // leaves it unread (undefined), never an answer.
    const ref = String(rec.osm_ref).replace(/^osm:/, '');
    const el = (await osmLocal.covers(null, null)) ? await osmLocal.element(ref) : null;
    if (el) out.osm = el.tags ?? null;
    else {
      const got = await osmFetched(ref);
      if (got !== undefined) out.osm = got?.tags ?? null;
    }
  }
  if (rec?.wikidata_id) out.wikidata = await wikidataFacilities(rec.wikidata_id);
  return out;
}

/** What each source says about one fact, from a place's evidence. */
export function judge(attr, phrases, ev) {
  const evidence = {};
  if (ev.site) evidence.site = fromText(phrases, ev.site);
  if (ev.wikipedia) evidence.wikipedia = fromText(phrases, ev.wikipedia);
  if (ev.osm !== undefined) evidence.osm = ev.osm ? fromOsm(attr, phrases, ev.osm) : { says: 'nothing' };
  if (Array.isArray(ev.wikidata)) {
    const hit = ev.wikidata.find((f) => phrases.some((p) => norm(f).includes(p)));
    evidence.wikidata = hit ? { says: 'yes', quote: `has facility: ${hit}` } : { says: 'nothing' };
  }
  return evidence;
}

/**
 * The rules (5.2 step 2):
 *   - ≥ verifySources say yes and none say no → Verified yes;
 *   - a source says no and none yes → No;
 *   - they disagree → the venue decides if venueWins and it states the fact,
 *     otherwise Conflict;
 *   - nothing found → Don't know.
 */
export function decide(evidence, cfg) {
  const yes = Object.entries(evidence).filter(([, e]) => e.says === 'yes').map(([s]) => s);
  const no = Object.entries(evidence).filter(([, e]) => e.says === 'no').map(([s]) => s);
  if (yes.length && no.length) {
    if (cfg.venueWins && evidence.site && evidence.site.says !== 'nothing') return { state: evidence.site.says, source: 'site', venueOverride: true };
    return { state: 'conflict', source: null, venueOverride: false };
  }
  if (yes.length && yes.length >= cfg.verifySources) return { state: 'yes', source: yes.includes('site') ? 'site' : yes[0], venueOverride: false };
  if (no.length) return { state: 'no', source: no.includes('site') ? 'site' : no[0], venueOverride: false };
  return { state: 'dont_know', source: null, venueOverride: false };
}

/** Write one fact's answer, its evidence and its outcome. */
async function record({ ref, attr, evidence, verdict, cfg, firstSeen = null }) {
  const { state, source, venueOverride } = verdict;
  const due = new Date();
  due.setMonth(due.getMonth() + recheckMonths(attr, cfg));
  const fact = attr.key;
  await withTransaction(async (c) => {
    for (const [src, e] of Object.entries(evidence)) {
      await c.query(
        `insert into place_fact_evidence (venue_ref, attribute_key, source, says, quote, checked_at) values ($1, $2, $3, $4, $5, now())
         on conflict (venue_ref, attribute_key, source) do update set says = excluded.says, quote = excluded.quote, checked_at = now()`,
        [ref, fact, src, e.says, e.quote ?? null]);
    }
    const { rows: [was] } = await c.query('select state, hidden_at from place_fact_answers where venue_ref = $1 and attribute_key = $2', [ref, fact]);
    // Reinstated (4.7): a fact families hid, confirmed again by our sources,
    // comes back marked "disputed before" so the next visitors are asked first.
    const reinstated = Boolean(was?.hidden_at && state === 'yes');
    await c.query(
      `insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source, evidence_quote, checked_at, recheck_due, venue_override, hidden_at, disputed_before)
       values ($1, $2, $3, $4, $5, $6, now(), $7, $8, null, false)
       on conflict (venue_ref, attribute_key) do update set state = excluded.state, yesno = excluded.yesno, source = excluded.source,
         evidence_quote = excluded.evidence_quote, checked_at = now(), recheck_due = excluded.recheck_due, venue_override = excluded.venue_override,
         hidden_at = case when $9 then null else place_fact_answers.hidden_at end,
         disputed_before = place_fact_answers.disputed_before or $9`,
      [ref, fact, state, state === 'yes' ? true : state === 'no' ? false : null, source,
        source ? evidence[source]?.quote ?? null : null, due, venueOverride, reinstated]);
    const { rows: [s] } = await c.query('delete from fact_suggestions where venue_ref = $1 and feature = $2 returning first_seen', [ref, fact]);
    await c.query(
      `insert into fact_checks (venue_ref, attribute_key, feature, outcome, source, first_seen) values ($1, $2, $3, $4, $5, $6)`,
      [ref, fact, attr.label, { yes: 'verified', no: 'no', conflict: 'conflict', dont_know: 'dont_know' }[state], source, s?.first_seen ?? firstSeen]);
  });
}

/**
 * Verify one fact at one place against our own sources. The suggestion is
 * deleted, the outcome recorded for Verification, each source's evidence kept
 * (owned text may be kept), and a person's correction is never touched.
 */
export async function verify({ ref, fact, firstSeen = null, evidence: ev = null }) {
  const cfg = (await settings()).values;
  const { rows: [attr] } = await query('select key, label, kind, access, age, dietary from place_attributes where key = $1', [fact]);
  if (!attr) return null;
  const phrases = (await vocabulary()).find((a) => a.key === fact)?.phrases ?? [norm(attr.label)];
  const e = ev ?? await evidenceFor(ref);
  // Nothing of ours to read yet — research on the place has not landed (a
  // drawer open queues it separately): the suggestion waits rather than being
  // answered "don't know" and put off for months (Codex, 28 Sep 2026). The
  // 30-day expiry still clears it if nothing ever arrives.
  // "Read and found nothing" is not "not read": an OSM element looked up and
  // absent is null, a Wikidata item with no facilities is [] — both answers.
  // Only sources never read (undefined), or a Wikidata fetch that failed (null),
  // leave nothing to go on.
  if (!e?.site && !e?.wikipedia && e?.osm === undefined && (e?.wikidata === undefined || e?.wikidata === null)) {
    return { ref, fact, waiting: true, why: 'nothing of ours to read yet' };
  }
  const evidence = judge(attr, phrases, e);
  const verdict = decide(evidence, cfg);
  await record({ ref, attr, evidence, verdict, cfg, firstSeen });
  return { ref, fact, ...verdict, evidence };
}

/**
 * Answer every fact looked for at a place (its subcategories' active facts and
 * the standard yes/no facts), reading its evidence once. What "looked for at
 * each place in that subcategory as that place next comes up" means (5.2 step
 * 3), and what the sign-up pre-warm runs for the top places near a home.
 * Facts already answered and not yet due are left alone.
 */
export async function answerPlace(ref) {
  const cfg = (await settings()).values;
  const { rows: wanted } = await query(`
    with subs as (
      select subcategory as sub from place_index where venue_ref = $1 and subcategory is not null
      union
      select t.subcategory_key from place_index_labels pil join word_targets t on 'google:' || t.word = pil.label where pil.venue_ref = $1)
    select pa.key, pa.label, pa.kind, pa.access, pa.age, pa.dietary
      from place_attributes pa
     where pa.active and pa.kind = 'yesno'
       and (pa.standard or exists (select 1 from subcategory_facts sf join subs on subs.sub = sf.subcategory_key
                                    where sf.attribute_key = pa.key and sf.status = 'active'))
       and not exists (select 1 from place_fact_answers a where a.venue_ref = $1 and a.attribute_key = pa.key
                        and (a.recheck_due is null or a.recheck_due > now()))`, [ref]);
  if (!wanted.length) return { ref, answered: 0 };
  const ev = await evidenceFor(ref);
  if (!ev.site && !ev.wikipedia && ev.osm == null && !Array.isArray(ev.wikidata)) return { ref, answered: 0, nothingToRead: true };
  const vocab = await vocabulary();
  let answered = 0;
  for (const attr of wanted) {
    const phrases = vocab.find((a) => a.key === attr.key)?.phrases ?? [norm(attr.label)];
    const evidence = judge(attr, phrases, ev);
    const verdict = decide(evidence, cfg);
    // Nothing found about a fact nobody suggested is not written: "don't
    // know" is recorded where a suggestion was checked, not for every fact
    // at every place (the absence of a row is "never asked").
    if (verdict.state === 'dont_know') continue;
    await record({ ref, attr, evidence, verdict, cfg });
    answered += 1;
  }
  return { ref, answered };
}

/**
 * A small in-process queue for the free work a household's activity sets off
 * (answering places as they come up, verifying fresh suggestions). One at a
 * time, bounded, never blocking a request; a deploy loses only what is
 * queued, and the next surfacing queues it again.
 */
const queue = [];
const queued = new Set();
let running = false;
let draining = Promise.resolve();
const QUEUE_MAX = 500;
export function enqueue(kind, ref, fact = null) {
  const key = `${kind}|${ref}|${fact ?? ''}`;
  if (queued.has(key) || queue.length >= QUEUE_MAX) return false;
  queued.add(key);
  queue.push({ kind, ref, fact, key });
  if (!running) draining = drain();
  return true;
}
async function drain() {
  running = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      if (job.kind === 'answer') await answerPlace(job.ref);
      else if (job.kind === 'verify') await verify({ ref: job.ref, fact: job.fact });
      else if (job.kind === 'recheck') await recheck(job.ref);
    } catch (err) {
      console.warn(`pipeline ${job.kind} ${job.ref}: ${err.message}`);
    } finally {
      queued.delete(job.key);
    }
  }
  running = false;
}
export const queueLength = () => queue.length;
/** Resolves when the queue has emptied (tests, and a clean shutdown). */
export const drained = () => draining;

/** Verify every waiting suggestion, oldest first, a bounded batch at a time. */
export async function verifyBacklog({ limit = 50 } = {}) {
  const { rows } = await query('select venue_ref, feature, first_seen from fact_suggestions order by first_seen limit $1', [limit]);
  let done = 0;
  for (const r of rows) {
    await verify({ ref: r.venue_ref, fact: r.feature, firstSeen: r.first_seen }).catch((err) => console.warn(`verify ${r.venue_ref} ${r.feature}: ${err.message}`));
    done += 1;
  }
  return { checked: done };
}

/** Suggestions older than suggestExpiry days are dropped (Housekeeping). */
export async function dropExpired() {
  const cfg = (await settings()).values;
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `delete from fact_suggestions where first_seen < now() - ($1 || ' days')::interval returning venue_ref, feature, first_seen`, [String(cfg.suggestExpiry)]);
    for (const r of rows) {
      await c.query(`insert into fact_checks (venue_ref, attribute_key, feature, outcome, first_seen) values ($1, $2, $2, 'dropped', $3)`, [r.venue_ref, r.feature, r.first_seen]);
    }
    return { dropped: rows.length };
  });
}

// ---------------------------------------------------------------------------
// 3. Add

/**
 * Work out each subcategory's facts from what has been verified at its places
 * (5.2 step 3): verified at ≥ addPlaces places → Active; on more than shareMax
 * of places → Ignored as on nearly every place (access and age facts exempt);
 * seen at fewer → Gathering evidence. A fact a person removed stays removed,
 * and one a person included anyway stays included.
 */
export async function add() {
  const cfg = (await settings()).values;
  const { rows } = await query(`
    with filed as (select venue_ref, subcategory as sub from place_index where subcategory is not null and not_in_epic_at is null),
    sizes as (select sub, count(*)::int n from filed group by sub),
    verified as (
      select f.sub, a.attribute_key, count(distinct a.venue_ref)::int v
        from filed f join place_fact_answers a on a.venue_ref = f.venue_ref and a.state = 'yes' and a.hidden_at is null and not exists (select 1 from fact_unknowns u where u.venue_ref = a.venue_ref and u.attribute_key = a.attribute_key)
        join place_attributes pa on pa.key = a.attribute_key and pa.active and not pa.standard and pa.kind = 'yesno'
       group by f.sub, a.attribute_key)
    select v.sub, v.attribute_key, v.v, s.n, pa.access, pa.age,
           sf.status, sf.reason, sf.include_anyway
      from verified v join sizes s on s.sub = v.sub join place_attributes pa on pa.key = v.attribute_key
      join shelf_subcategories sc on sc.key = v.sub and sc.active
      left join subcategory_facts sf on sf.subcategory_key = v.sub and sf.attribute_key = v.attribute_key`);
  let changed = 0;
  for (const r of rows) {
    if (r.reason === 'removed_by_a_person') continue;
    let status; let reason = null;
    const share = r.n ? (r.v / r.n) * 100 : 0;
    if (r.include_anyway) status = 'active';
    else if (r.v >= cfg.addPlaces && share > cfg.shareMax && !r.access && !r.age) { status = 'ignored'; reason = 'on_nearly_every_place'; }
    else if (r.v >= cfg.addPlaces) status = 'active';
    else status = r.status === 'active' ? 'active' : 'gathering';
    if (r.status === status && (r.reason ?? null) === reason) {
      await query('update subcategory_facts set verified_places = $3 where subcategory_key = $1 and attribute_key = $2 and verified_places <> $3', [r.sub, r.attribute_key, r.v]);
      continue;
    }
    await query(
      `insert into subcategory_facts (subcategory_key, attribute_key, status, reason, verified_places, active_since)
       values ($1, $2, $3, $4, $5, case when $3 = 'active' then now() end)
       on conflict (subcategory_key, attribute_key) do update set status = excluded.status, reason = excluded.reason,
         verified_places = excluded.verified_places,
         active_since = case when excluded.status = 'active' and subcategory_facts.status <> 'active' then now() else subcategory_facts.active_since end,
         updated_at = now()`,
      [r.sub, r.attribute_key, status, reason, r.v]);
    changed += 1;
  }
  return { changed };
}

// ---------------------------------------------------------------------------
// 4. Re-check

/**
 * Re-check a place's facts past their period, as the place comes up (5.2 step
 * 4: "When a surfaced place has a fact past its period, check it again" —
 * never a sweep). Called when a household opens the place.
 */
export async function recheck(ref) {
  const { rows } = await query(
    `select attribute_key from place_fact_answers where venue_ref = $1 and recheck_due is not null and recheck_due < now()`, [ref]);
  if (!rows.length) return [];
  const ev = await evidenceFor(ref);
  const out = [];
  for (const r of rows) out.push(await verify({ ref, fact: r.attribute_key, evidence: ev }).catch(() => null));
  return out.filter(Boolean);
}

// ---------------------------------------------------------------------------
// 5. Families confirm (4.7). Backend only; the in-app question is a separate
// design brief.

/**
 * The question to ask a household after a visit, or none: at most
 * askPerVisit, only facts this place is looked at for, never one this
 * household has been asked, conflicts and disputed facts first. A fact about
 * young children is asked only of a household with a child that age.
 */
export async function questionFor({ householdId, ref, visitId = null }) {
  const cfg = (await settings()).values;
  if (!cfg.askPerVisit) return [];
  const { rows: [visited] } = await query('select 1 from visits where household_id = $1 and venue_ref = $2 limit 1', [householdId, ref]);
  if (!visited) return []; // someone who hasn't been can't answer
  // A named visit must be this household's visit to this place, or any fresh
  // id would buy a fresh batch (Codex, 28 Sep 2026).
  if (visitId) {
    const { rows: [own] } = await query('select 1 from visits where id = $1 and household_id = $2 and venue_ref = $3', [visitId, householdId, ref]);
    if (!own) return [];
  }
  const { rows: members } = await query('select birth_year, birth_date, is_minor from members where household_id = $1', [householdId]);
  const year = new Date().getFullYear();
  const ages = members.map((m) => (m.birth_date ? year - new Date(m.birth_date).getFullYear() : m.birth_year ? year - m.birth_year : m.is_minor ? 8 : 35));
  const young = ages.some((a) => a <= 4);
  const kids = ages.some((a) => a <= 12);
  // One visit carries at most askPerVisit questions, however often it is
  // asked for (Codex, 28 Sep 2026): a visit that already has its questions
  // gets the ones still unanswered, never a fresh batch. With no visit named,
  // the last day's asks at this place stand in for the visit.
  const { rows: already } = await query(
    `select x.attribute_key, pa.label,
            exists (select 1 from family_answers f where f.household_id = x.household_id and f.venue_ref = x.venue_ref and f.attribute_key = x.attribute_key) as answered
       from family_asks x join place_attributes pa on pa.key = x.attribute_key
      where x.household_id = $1 and x.venue_ref = $2
        and (case when $3::uuid is null then x.asked_at > now() - interval '1 day' else x.visit_id = $3::uuid end)
      order by x.asked_at, x.attribute_key`,
    [householdId, ref, visitId]);
  if (already.length) {
    return already.filter((a) => !a.answered).slice(0, cfg.askPerVisit)
      .map((p) => ({ fact: p.attribute_key, label: p.label, answers: ['Yes', 'No', 'Didn’t notice'] }));
  }
  const { rows } = await query(`
    with subs as (select subcategory as sub from place_index where venue_ref = $1 and subcategory is not null),
    looked as (
      select sf.attribute_key from subcategory_facts sf join subs on subs.sub = sf.subcategory_key where sf.status = 'active'
      union
      select key from place_attributes where standard and active and kind = 'yesno')
    select l.attribute_key, pa.label, a.state, a.disputed_before
      from looked l join place_attributes pa on pa.key = l.attribute_key
      left join place_fact_answers a on a.venue_ref = $1 and a.attribute_key = l.attribute_key
     where not exists (select 1 from family_asks x where x.household_id = $2 and x.venue_ref = $1 and x.attribute_key = l.attribute_key)`,
    [ref, householdId]);
  const matters = (label) => {
    const l = label.toLowerCase();
    if (/toddler|baby|babies|nappy|changing/.test(l)) return young;
    if (/kids|children|child|play/.test(l)) return kids;
    return true;
  };
  const rank = (r) => (r.state === 'conflict' ? 0 : r.disputed_before ? 1 : r.state == null || r.state === 'dont_know' ? 2 : 3);
  const pick = rows.filter((r) => matters(r.label)).sort((a, b) => rank(a) - rank(b)).slice(0, cfg.askPerVisit);
  // Stamped a millisecond apart in the order they were ranked, so a repeat
  // hands the batch back in the same order.
  for (const [i, p] of pick.entries()) {
    await query(
      `insert into family_asks (household_id, venue_ref, attribute_key, visit_id, asked_at)
       values ($1, $2, $3, $4, now() + make_interval(secs => $5::double precision / 1000)) on conflict do nothing`,
      [householdId, ref, p.attribute_key, visitId, i]);
  }
  return pick.map((p) => ({ fact: p.attribute_key, label: p.label, answers: ['Yes', 'No', 'Didn’t notice'] }));
}

/**
 * A family's answer. Kept with the machine's answer at the time and the
 * source it relied on, so accuracy measures the rules, not the places. Then
 * settled (4.7): two or more agreeing and none disagreeing settles a fact;
 * two or more saying a shown fact is wrong hides it until it is re-checked.
 * Which household said what is never shown.
 */
export async function familyAnswer({ householdId, ref, fact, answer }) {
  if (!['yes', 'no', 'didnt_notice'].includes(answer)) throw Object.assign(new Error('Yes, no or didn’t notice.'), { status: 400 });
  // Only a question we asked can be answered (Codex, 28 Sep 2026): otherwise
  // any two households could settle or hide a fact about a place neither of
  // them has been to. The ask is issued only after a recorded visit.
  const { rows: [asked] } = await query(
    'select 1 from family_asks where household_id = $1 and venue_ref = $2 and attribute_key = $3', [householdId, ref, fact]);
  if (!asked) throw Object.assign(new Error('That question was not asked of this household.'), { status: 409 });
  const cfg = (await settings()).values;
  const { rows: [m] } = await query('select state, source from place_fact_answers where venue_ref = $1 and attribute_key = $2', [ref, fact]);
  const { rows: [sub] } = await query('select subcategory from place_index where venue_ref = $1', [ref]);
  await query(
    `insert into family_answers (venue_ref, attribute_key, household_id, answer, machine_state, machine_source, subcategory_key)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (venue_ref, attribute_key, household_id) do nothing`,
    [ref, fact, householdId, answer, m?.state ?? null, m?.source ?? null, sub?.subcategory ?? null]);
  const { rows: [t] } = await query(
    `select count(*) filter (where answer = 'yes')::int yes, count(*) filter (where answer = 'no')::int no
       from family_answers where venue_ref = $1 and attribute_key = $2`, [ref, fact]);
  let settled = null;
  if (m?.state === 'yes' && t.no >= cfg.familiesWrong) {
    await query(`update place_fact_answers set hidden_at = now(), recheck_due = now() where venue_ref = $1 and attribute_key = $2`, [ref, fact]);
    settled = 'hidden';
  } else if (t.yes >= cfg.familiesSettle && t.no === 0 && m?.state !== 'yes') {
    await query(
      `insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source, checked_at) values ($1, $2, 'yes', true, 'families', now())
       on conflict (venue_ref, attribute_key) do update set state = 'yes', yesno = true, source = 'families', checked_at = now(), hidden_at = null`, [ref, fact]);
    settled = 'yes';
  } else if (t.no >= cfg.familiesSettle && t.yes === 0 && m?.state !== 'no') {
    await query(
      `insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source, checked_at) values ($1, $2, 'no', false, 'families', now())
       on conflict (venue_ref, attribute_key) do update set state = 'no', yesno = false, source = 'families', checked_at = now()`, [ref, fact]);
    settled = 'no';
  }
  return { recorded: true, settled };
}

// ---------------------------------------------------------------------------
// Pre-warm (handover 4.5, C38)

export const PREWARM_TOP = 20;

/**
 * When a household sets its home, the top 20 in every category of its
 * 30-minute ring are answered from our own sources and put in line for free
 * research, so the first search reads a record rather than waits for one.
 * Nothing here spends: `own` researches free unless a caller says paid, and
 * this caller never does. A place with no owned record yet has nothing to
 * answer from — the IDs-only census gives no name or coordinates — so the
 * free research is what makes it answerable on the next pass.
 */
export async function prewarm({ cell, mode = 'driving', minutes = 30, research = null } = {}) {
  if (!cell) return { places: 0 };
  const { rankingFor } = await import('../repositories/ringTables.js');
  // Whatever the ring tables rank by is what a household is shown, so read
  // the categories from the ring itself rather than guess the vocabulary.
  const { rows: cats } = await query(
    `select distinct category from ring_rankings where cell = $1 and minutes = $2`, [cell, minutes]);
  const refs = new Set();
  for (const c of cats) {
    for (const r of await rankingFor({ cell, mode, minutes, category: c.category, limit: PREWARM_TOP })) refs.add(r.venueRef);
  }
  const queueResearch = research ?? (await import('../sources/own.js')).queueEnrichment;
  for (const ref of refs) {
    enqueue('answer', ref);
    queueResearch(ref);
  }
  return { places: refs.size };
}
