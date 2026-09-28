/**
 * The machine's proposals about Google words (handover 4.10).
 *
 * A proposal is raised only when it would change something and would not
 * reverse a settled decision:
 *
 *   - it is checked against the register before it is shown (the seeds below
 *     are the owner's own list, and the words he said not to fold are never
 *     proposed);
 *   - a proposal that changes nothing is not shown;
 *   - a "Kept" proposal is never raised again;
 *   - a narrowing states its rule.
 *
 * New words are not proposals: a word nobody has answered goes straight into
 * Needs a decision as "No suggestion — choose where it goes" (mapping.js).
 */

import { query } from '../db.js';
import { bringsAndAffected } from './mapping.js';

/**
 * The owner's decisions to seed (handover 4.10 table). `newSub` and `newFact`
 * are created when a person accepts the proposal, never before.
 */
export const SEEDS = [
  { word: 'road_bridge', grp: 'not_places', action: 'exclude', text: 'Exclude' },
  { word: 'bridge', grp: 'not_places', action: 'exclude', text: 'Exclude' },
  { word: 'cemetery', grp: 'not_places', action: 'exclude', text: 'Exclude' },
  { word: 'building_complex', grp: 'not_places', action: 'exclude', text: 'Exclude' },
  { word: 'staff_college', grp: 'not_places', action: 'exclude', text: 'Exclude' },
  { word: 'parking', grp: 'not_places', action: 'exclude', text: 'Exclude' },
  { word: 'sports_coaching', grp: 'not_places', action: 'exclude', text: 'Exclude — weekly lessons near home, not a day out' },
  {
    word: 'heritage_railway', grp: 'fold', action: 'repoint', subcategory: 'heritage-railways',
    newSub: { key: 'heritage-railways', label: 'Heritage railways', category: 'fun' },
    text: 'Fun › Heritage railways (new subcategory)',
  },
  {
    word: 'planetarium', grp: 'fold', action: 'repoint', subcategory: 'science-learning-centres',
    newSub: { key: 'science-learning-centres', label: 'Science & learning centres', category: 'educational' },
    fact: 'has-planetarium', newFact: { key: 'has-planetarium', label: 'Has a planetarium' },
    text: 'Educational › Science & learning centres + fact: Has a planetarium',
  },
  {
    // The drawer is named in the handover as Landmarks; its key has been
    // spelled two ways, so the proposal names whichever exists, and is not
    // raised at all where neither does (audit, 28 Sep 2026).
    word: 'church', grp: 'narrow', action: 'narrow', subcategory: ['landmarks-you-can-see', 'landmarks'], condition: 'encyclopedia_or_listing',
    rule: 'only churches with a Wikipedia/Wikidata entry or heritage listing',
    text: '{target} — only churches with a Wikipedia/Wikidata entry or heritage listing',
  },
  { word: 'tourist_attraction', grp: 'stop_filing', action: 'make_fact', text: 'Keep as a fact only (stop filing by it)' },
  // Two Food & drink drawers read nought because no Google word pointed at
  // them (owner, round 3, 29 Sep 2026). Google's Table A has brewery, brewpub,
  // winery and tea_house and no distillery or afternoon tea; winery already
  // points at Breweries. Each keeps where it files today as a secondary
  // (`also`), so nothing leaves Cafés or Pubs & bars — those counts include
  // secondary filing (categories.js FILED_SQL).
  {
    word: 'brewery', grp: 'fill', action: 'repoint', subcategory: 'breweries-distilleries', also: ['pubs-bars'],
    text: 'Food & drink › Breweries, wineries & distilleries (primary) · Pubs & bars stays as a secondary',
  },
  {
    word: 'brewpub', grp: 'fill', action: 'repoint', subcategory: 'pubs-bars', also: ['breweries-distilleries'],
    text: 'Also in Food & drink › Breweries, wineries & distilleries · Pubs & bars stays primary',
  },
  {
    word: 'tea_house', grp: 'fill', action: 'repoint', subcategory: 'afternoon-tea', also: ['cafes'],
    text: 'Food & drink › Afternoon tea (primary) · Cafés stays as a secondary',
  },
];

/**
 * Where a proposal's words would point, primary first: its own drawer and any
 * it keeps or adds as secondaries (`also`) that exist and are live.
 */
export function proposedTargets(seed, subs) {
  const primary = seed.subcategory;
  const also = (seed.also ?? []).filter((k) => k !== primary && (!subs || subs.get(k)?.active));
  return [primary, ...also];
}

/**
 * Words the owner said must never be folded into other subcategories
 * (handover 4.10: "Do not propose folding model_village, miniature_golf or
 * heritage_railway into other subcategories"). A proposal that would move one
 * of these anywhere but its own drawer is dropped.
 */
export const NEVER_FOLD = new Set(['model_village', 'miniature_golf', 'miniature_golf_course', 'heritage_railway']);

/**
 * The subcategory a seed files into, as it stands today: the drawer it will
 * create on accept (`newSub`), or the first of the keys it names that exists
 * and is active. Null where none does — a proposal is never raised for a
 * drawer that is not there and that nobody will make.
 */
export function resolveTarget(seed, subs) {
  if (!seed.subcategory) return { key: null, label: null };
  if (seed.newSub) return { key: seed.newSub.key, label: null };
  for (const k of [seed.subcategory].flat()) {
    const s = subs.get(k);
    if (s?.active) return { key: k, label: s.cat ? `${s.cat} › ${s.label}` : s.label };
  }
  return null;
}

/** Whether a seed would change anything about the word as it stands. */
export function changesSomething(seed, word) {
  if (!word) return false;
  const out = word.decision && ['aside', 'travel', 'nearby'].includes(word.decision);
  if (seed.action === 'exclude') return !out;
  if (seed.action === 'make_fact') return word.decision !== 'generic';
  // A seed may name its drawer more than one way (church: Landmarks); being
  // in any of them is being there.
  const targets = [seed.subcategory].flat();
  if (seed.action === 'narrow') {
    if (out) return false; // settled out by a person; the register wins
    return !targets.includes(word.narrowedTo);
  }
  if (seed.action === 'repoint') {
    if (out) return false;
    // With secondaries named, it changes something while the primary differs
    // or any of them is not yet a target of the word.
    if (seed.also?.length) {
      const has = new Set(word.targets ?? []);
      return !targets.includes(word.points_at) || seed.also.some((k) => !has.has(k));
    }
    return !targets.includes(word.points_at);
  }
  return false;
}

/**
 * Raise what should be raised and retire what no longer applies. Idempotent;
 * run at boot and daily. Returns what it did, for the log line.
 */
export async function refreshProposals() {
  const [{ rows: words }, { rows: kept }, { rows: open }, { rows: narrowed }, counts, { rows: subRows }, { rows: allTargets }, { rows: decidedRows }] = await Promise.all([
    query(`select key, decision, points_at, active from taxonomy_labels where namespace = 'google'`),
    query(`select word from word_proposals where state = 'kept'`),
    query(`select id, word from word_proposals where state = 'open'`),
    query(`select word, subcategory_key from word_targets where condition is not null and is_primary`),
    bringsAndAffected(),
    query(`select s.key, s.label, s.active, c.label as cat from shelf_subcategories s left join shelf_categories c on c.key = s.category_key`),
    query(`select word, subcategory_key from word_targets where namespace = 'google'`),
    query(`select distinct word from word_decisions where namespace = 'google' and undone_at is null`),
  ]);
  // A word a person has decided anything about since is theirs: a proposal
  // that only fills an empty drawer is not raised over it (a later picker
  // edit taking Pubs & bars off brewery is not reversed by the next run).
  const decidedSet = new Set(decidedRows.map((r) => r.word));
  const subs = new Map(subRows.map((r) => [r.key, r]));
  const byWord = new Map(words.map((w) => [w.key, w]));
  for (const n of narrowed) { const w = byWord.get(n.word); if (w) w.narrowedTo = n.subcategory_key; }
  for (const t of allTargets) { const w = byWord.get(t.word); if (w) (w.targets ??= []).push(t.subcategory_key); }
  const keptSet = new Set(kept.map((k) => k.word));
  const openSet = new Set(open.map((o) => o.word));
  let raised = 0; let retired = 0;
  for (const seed of SEEDS) {
    const w = byWord.get(seed.word);
    if (keptSet.has(seed.word)) continue;
    // A word the owner said not to fold is only ever proposed into its own
    // drawer (heritage_railway → Heritage railways), never folded elsewhere.
    if (NEVER_FOLD.has(seed.word) && seed.subcategory && !seed.newSub) continue;
    const target = resolveTarget(seed, subs);
    const s = target === null ? null : {
      ...seed,
      subcategory: target.key,
      text: seed.text.replace('{target}', target.label ?? ''),
      ...(seed.also ? { also: proposedTargets({ ...seed, subcategory: target.key }, subs).slice(1) } : {}),
    };
    const wanted = s !== null && changesSomething(s, w) && !(seed.grp === 'fill' && decidedSet.has(seed.word) && !openSet.has(seed.word));
    const changeTo = s && JSON.stringify({
      text: s.text, subcategory: s.subcategory ?? null, newSub: s.newSub ?? null, fact: s.fact ?? null, newFact: s.newFact ?? null, condition: s.condition ?? null,
      ...(s.also ? { also: s.also } : {}),
    });
    if (wanted && openSet.has(s.word)) {
      // Keep an open proposal saying what the seed says today (a drawer
      // renamed, a target that now exists): the owner decides what is shown.
      await query(`update word_proposals set change_to = $2::jsonb, rule_text = $3 where word = $1 and state = 'open' and change_to is distinct from $2::jsonb`,
        [s.word, changeTo, s.rule ?? null]);
    } else if (wanted) {
      const c = counts.get(s.word) ?? { brings: 0, affected: 0 };
      await query(
        `insert into word_proposals (namespace, word, grp, action, change_to, rule_text, places_affected)
         values ('google', $1, $2, $3, $4::jsonb, $5, $6) on conflict do nothing`,
        // places_affected is what it was when raised; the screen recounts on
        // every read (mapping.js), so this is a record, not the number shown.
        [s.word, s.grp, s.action, changeTo, s.rule ?? null, c.affected]);
      raised += 1;
    } else if (!wanted && openSet.has(seed.word)) {
      // It no longer changes anything (somebody decided it another way): retire
      // it quietly rather than leave a proposal that would be a no-op.
      await query(`delete from word_proposals where word = $1 and state = 'open'`, [seed.word]);
      retired += 1;
    }
  }
  return { raised, retired };
}
