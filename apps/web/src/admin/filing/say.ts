/**
 * The filing desk's judgements, in one place and testable.
 *
 * Every one of these decides what a screen *says* rather than what it looks
 * like, and each has a wrong answer that would be silent: a word reading "kept
 * as a label" when somebody answered "parking"; a row reading "0%" when nobody
 * has ever hearted it; a candidate drawn as distinctive when it is on every
 * place. None of that shows up in a screenshot, so it is here rather than
 * inline in the `.tsx`, where `node --test` can reach it.
 *
 * Nothing here knows about colour. A screen asks "which rung is this on" and
 * decides for itself how to draw the answer.
 */

import type { BrowseRow, SetRow, WordRow } from './types';

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Where a word points, said the way the person who answered would recognise.
 *
 * "Kept as a label" covers three of our five stored answers, and flattening
 * them loses two real decisions: `travel` is how you get there (parking, the
 * bus station) and `nearby` is what happens to be next to the place you came
 * for (the chemist by the museum). Somebody who answered one of those has to
 * see that they did, or the screen reads as though their answer was discarded.
 *
 * Pointing at a drawer is the stronger fact and wins: a word can be `mapped`
 * and still carry `answer: 'generic'`, and the drawer is what it does.
 */
export function pointsAt(w: Pick<WordRow, 'pointsAt' | 'decision' | 'answer'>): string {
  if (w.pointsAt) return w.pointsAt.label;
  if (w.decision === 'notinepic') return 'Not in Epic';
  if (w.decision === 'secondary') {
    if (w.answer === 'travel') return 'Kept as a label · how you get there';
    if (w.answer === 'nearby') return 'Kept as a label · what is nearby';
    return 'Kept as a label';
  }
  return 'not answered';
}

export type SortKey = 'brings' | 'opens' | 'word' | 'points' | 'flags';

/** Each sort, and what its two directions are called in words. */
export const SORTS: { key: SortKey; name: string; forwards: string; backwards: string }[] = [
  { key: 'brings', name: 'Places it brings in', forwards: 'most first', backwards: 'fewest first' },
  { key: 'opens', name: 'Ever opened', forwards: 'fewest first', backwards: 'most first' },
  { key: 'word', name: 'Google’s word', forwards: 'A to Z', backwards: 'Z to A' },
  { key: 'points', name: 'Where it points', forwards: 'A to Z', backwards: 'Z to A' },
  { key: 'flags', name: 'Flags', forwards: 'most flags first', backwards: 'fewest flags first' },
];

/**
 * The sort button, said in words rather than with an arrow.
 *
 * An arrow here would be a symbol standing in for an icon, which this app does
 * not do — and "most first" is clearer than a glyph anyway. Column headers
 * keep a real chevron, because there the direction is all the mark carries.
 *
 * The two text sorts run the other way from the numeric ones: `desc` on a name
 * is Z to A, and `desc` on a count is most-first, so a single flag cannot mean
 * the same thing for both.
 */
export function sortLabel(sort: SortKey, desc: boolean): string {
  const s = SORTS.find((x) => x.key === sort);
  if (!s) return 'Sorted';
  const alphabetical = s.key === 'word' || s.key === 'points';
  const forwards = alphabetical ? !desc : desc;
  return `Sorted by ${s.name.toLowerCase()} · ${forwards ? s.forwards : s.backwards}`;
}

/** The default direction for a column somebody has just switched to. */
export const startsDescending = (key: SortKey) => !(key === 'word' || key === 'points');

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export type Rung = 'distinctive' | 'ordinary' | 'useless';

/**
 * How useful a candidate word is, from how thinly it is spread.
 *
 * A word on two of sixty places tells two places apart; a word on fifty-eight
 * of sixty tells you nothing about any of them. The thresholds are read from
 * the server because they were set on one district of data and are meant to
 * move.
 *
 * A word nothing was read for is `ordinary`, not distinctive: nought of nought
 * is not a thin spread, it is an absence of evidence, and drawing it large
 * would put the loudest thing on the screen on the word we know least about.
 */
export function rung(seen: number, of: number, low: number, high: number): Rung {
  if (!of) return 'ordinary';
  const share = seen / of;
  if (share <= low) return 'distinctive';
  if (share >= high) return 'useless';
  return 'ordinary';
}

/**
 * The marks a question set wears.
 *
 * `settled` only when the judgeable queue is empty. A set that has stopped
 * producing words but still has candidates waiting is *settling*, and the two
 * must not look the same — a set at 0.4 with a queue is not finished, and that
 * used to look identical to finished.
 */
export function setMarks(s: Pick<SetRow, 'state' | 'tooFewForTooMany' | 'questions'>): string[] {
  const out: string[] = [];
  if (s.state === 'settled') out.push('SETTLED');
  if (s.state === 'settling') out.push('SETTLING');
  if (s.tooFewForTooMany) out.push('TOO FEW FOR TOO MANY');
  return out;
}

/**
 * Every question is asked of every place in every subcategory the set covers,
 * so the cost of one more is the whole population, not one row.
 */
export const TOO_MANY_QUESTIONS = 8;
export const tooManyQuestions = (n: number) => n >= TOO_MANY_QUESTIONS;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * A hearted row with too little near you waits quietly.
 *
 * Only a *hearted* row waits: an unhearted one below the fill is simply a row
 * that does not apply here, and marking it WAITING would promise something
 * nobody asked for. And a waiting row shows no shelf at all — an empty shelf
 * reads as "there is nothing good here", where no shelf reads as "not this
 * week", which is what is true.
 */
export function waiting(row: Pick<BrowseRow, 'hearted' | 'fill'>, district: string, minFill: number): boolean {
  if (!row.hearted) return false;
  return (row.fill[district]?.count ?? 0) < minFill;
}

/** Whether a row is below its minimum fill in any district at all. */
export function thinSomewhere(row: Pick<BrowseRow, 'fill'>, districts: string[], minFill: number): boolean {
  return districts.some((d) => (row.fill[d]?.count ?? 0) < minFill);
}

/**
 * The hearting share, said out loud.
 *
 * `null` is not nought. A row nobody has ever hearted is a fact about how young
 * the product is; "0%" is a claim that households looked at it and declined.
 * The screens draw the first in red and the second as an ordinary number, and
 * they must never be able to swap.
 */
export function shareSays(share: number | null): string {
  if (share == null) return 'nobody yet';
  return `${Math.round(share * 100)}%`;
}

/**
 * How old a heart is, and whether it has gone stale.
 *
 * Past about four months a heart was true once and may not be now, so it is
 * said in months and marked fading rather than counted in days for ever.
 */
export const FADES_AFTER_DAYS = 120;

export function heartAge(days: number): { says: string; fading: boolean } {
  if (days > FADES_AFTER_DAYS) {
    return { says: `hearted ${Math.round(days / 30)} months ago · fading`, fading: true };
  }
  return { says: `hearted ${days} ${days === 1 ? 'day' : 'days'} ago`, fading: false };
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

/**
 * What an apply actually did, reported as it came back.
 *
 * The audit applies once and a second apply is refused, so the screen has to
 * say what happened rather than what it asked for. Some proposals cannot be
 * applied without somebody naming something — a split with unnamed halves —
 * and reporting "21 applied" when one of them is still open is the kind of
 * quiet lie that makes an audit worthless.
 */
export function appliedSays(applied: number, advisory: number): string {
  if (!advisory) return `${applied} applied`;
  return `${applied} applied, ${advisory} still ${advisory === 1 ? 'needs' : 'need'} you`;
}
