/**
 * What tapping a date does to the dates already chosen.
 *
 * Lifted out of `MonthCalendar` so it can be tested without a React tree
 * (`test/dates.test.ts`) — it is four lines of decision that were wrong in a
 * way nobody could work around, and that is exactly the kind of thing that
 * should have a test rather than a screenshot.
 *
 * One rule does most of the work: **a finished range plus another tap starts
 * again from that date.** What was here before extended the range from
 * whatever the start happened to be, which made a set of dates impossible to
 * correct (owner, 7 Sep 2026: "If I select the 15th, it goes from the 7th to
 * the 15th. If I touch 15 and then touch 30, it still goes from the 7th to the
 * 30th"). With the rule above, tapping the 15th twice makes it the start and
 * the 30th closes the range, which is what he asked for.
 */

export type Range = { start: string | null; end: string | null };

export function nextRange(now: Range, date: string): Range {
  // Nothing chosen yet: this is the day.
  if (!now.start) return { start: date, end: null };
  // A finished range: whatever is tapped begins a new one there.
  if (now.end) return { start: date, end: null };
  // One date so far.
  if (date === now.start) return { start: null, end: null };   // tapped again: cleared
  if (date < now.start) return { start: date, end: null };     // earlier: start again there
  return { start: now.start, end: date };                      // later: close the range
}

/** The nights between two dates. Same day is 0 — a day out, whatever it is called. */
export const nightsBetween = (a: string, b: string) =>
  Math.max(0, Math.round((+new Date(`${b}T12:00:00`) - +new Date(`${a}T12:00:00`)) / 86_400_000));
