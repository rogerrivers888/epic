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
  { word: 'heritage_railway', grp: 'fold', action: 'repoint', subcategory: 'heritage-railways', text: 'Fun › Heritage railways' },
  {
    word: 'planetarium', grp: 'fold', action: 'repoint', subcategory: 'science-learning-centres',
    newSub: { key: 'science-learning-centres', label: 'Science & learning centres', category: 'educational' },
    fact: 'has-planetarium', newFact: { key: 'has-planetarium', label: 'Has a planetarium' },
    text: 'Educational › Science & learning centres + fact: Has a planetarium',
  },
  {
    word: 'church', grp: 'narrow', action: 'narrow', subcategory: 'landmarks-you-can-see', condition: 'encyclopedia_or_listing',
    rule: 'only churches with a Wikipedia/Wikidata entry or heritage listing',
    text: 'Culture › Landmarks — only churches with a Wikipedia/Wikidata entry or heritage listing',
  },
  { word: 'tourist_attraction', grp: 'stop_filing', action: 'make_fact', text: 'Keep as a fact only (stop filing by it)' },
];

/**
 * Words the owner said must never be folded into other subcategories
 * (handover 4.10: "Do not propose folding model_village, miniature_golf or
 * heritage_railway into other subcategories"). A proposal that would move one
 * of these anywhere but its own drawer is dropped.
 */
export const NEVER_FOLD = new Set(['model_village', 'miniature_golf', 'miniature_golf_course', 'heritage_railway']);

/** Whether a seed would change anything about the word as it stands. */
export function changesSomething(seed, word) {
  if (!word) return false;
  const out = word.decision && ['aside', 'travel', 'nearby'].includes(word.decision);
  if (seed.action === 'exclude') return !out;
  if (seed.action === 'make_fact') return word.decision !== 'generic';
  if (seed.action === 'repoint' || seed.action === 'narrow') {
    if (out) return false; // settled out by a person; the register wins
    if (word.points_at !== seed.subcategory) return true;
    return seed.action === 'narrow' && !word.narrowed;
  }
  return false;
}

/**
 * Raise what should be raised and retire what no longer applies. Idempotent;
 * run at boot and daily. Returns what it did, for the log line.
 */
export async function refreshProposals() {
  const [{ rows: words }, { rows: kept }, { rows: open }, { rows: narrowed }, counts] = await Promise.all([
    query(`select key, decision, points_at, active from taxonomy_labels where namespace = 'google'`),
    query(`select word from word_proposals where state = 'kept'`),
    query(`select id, word from word_proposals where state = 'open'`),
    query(`select word from word_targets where condition is not null`),
    bringsAndAffected(),
  ]);
  const byWord = new Map(words.map((w) => [w.key, w]));
  for (const n of narrowed) { const w = byWord.get(n.word); if (w) w.narrowed = true; }
  const keptSet = new Set(kept.map((k) => k.word));
  const openSet = new Set(open.map((o) => o.word));
  let raised = 0; let retired = 0;
  for (const s of SEEDS) {
    const w = byWord.get(s.word);
    if (keptSet.has(s.word)) continue;
    if (NEVER_FOLD.has(s.word) && s.subcategory && s.newSub == null && s.subcategory !== 'heritage-railways') continue;
    const wanted = changesSomething(s, w);
    if (wanted && !openSet.has(s.word)) {
      const c = counts.get(s.word) ?? { brings: 0, affected: 0 };
      await query(
        `insert into word_proposals (namespace, word, grp, action, change_to, rule_text, places_affected)
         values ('google', $1, $2, $3, $4::jsonb, $5, $6) on conflict do nothing`,
        [s.word, s.grp, s.action,
          JSON.stringify({ text: s.text, subcategory: s.subcategory ?? null, newSub: s.newSub ?? null, fact: s.fact ?? null, newFact: s.newFact ?? null, condition: s.condition ?? null }),
          s.rule ?? null, s.action === 'repoint' || s.action === 'narrow' ? c.brings : c.affected]);
      raised += 1;
    } else if (!wanted && openSet.has(s.word)) {
      // It no longer changes anything (somebody decided it another way): retire
      // it quietly rather than leave a proposal that would be a no-op.
      await query(`delete from word_proposals where word = $1 and state = 'open'`, [s.word]);
      retired += 1;
    }
  }
  return { raised, retired };
}
