/**
 * The rules behind Who's going and paying on the guest booking screen (guest
 * handoff G6–G10, G24, G26), kept apart from the screen so they can be tested.
 */

/** A child's age or date of birth, as typed: their choice which (README › Who's going). */
export type AgeAnswer = { byDob: boolean; age: string; dob: string };

/** The age or date of birth given, or null while it isn't one yet: 0 to 17 as a whole number, or YYYY-MM-DD. */
export function ageAnswer(a: AgeAnswer): { age: number; dob: null } | { age: null; dob: string } | null {
  if (a.byDob) return /^\d{4}-\d{2}-\d{2}$/.test(a.dob.trim()) ? { age: null, dob: a.dob.trim() } : null;
  const t = a.age.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n <= 17 ? { age: n, dob: null } : null;
}

/**
 * Whether one more person can be ticked: never more than the places left (or the
 * most from one household). Someone added with no room is still added, unticked —
 * the line under the list turns amber and a toast says so.
 */
export const roomForOneMore = (ticked: number, cap: number) => ticked < cap;

/** The toast when the cap stops a tick. */
export const capToast = (cap: number) => (cap === 1 ? 'Only 1 place left' : `Only ${cap} places left`);

/**
 * The payment sheet's title (G26): the first decline is "Your card was declined";
 * a retry that is declined again, or a failure on Epic's side, is "Payment didn't go through".
 */
export function payProblemTitle(kind: 'declined' | 'failed', declinesInARow: number): string {
  return kind === 'declined' && declinesInARow <= 1 ? 'Your card was declined' : 'Payment didn’t go through';
}

/** The latest of the refunds' dates (G17's "went back to your card on 21 Sep"), or null when none says. */
export function lastRefundAt(refunds: { at: string | null | undefined }[]): string | null {
  const at = refunds.map((r) => r.at).filter((x): x is string => Boolean(x)).sort();
  return at.length ? at[at.length - 1] : null;
}
