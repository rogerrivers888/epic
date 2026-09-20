/**
 * A telephone number is a thing you can ring, or it is nothing.
 *
 * The owner, 20 Sep 2026, on The Curator's record: "the phone number is a
 * string with percentages. This phone number is not fit for purpose. We need
 * some controls to prevent that from happening. If the phone number is not
 * suitable, then we can't show that at all."
 *
 * It came off a `tel:` link — `tel:+44%20(0)20%208564%208492` — and everything
 * between the scheme and the screen treated it as a word. So this is the one
 * gate: every phone number we write down or print goes through it, it decodes
 * what a link encodes, and anything that is not a number a person could dial
 * comes back null rather than as a string with percent signs in it.
 *
 * Deliberately not a formatter. It tidies and it judges; it does not invent a
 * national style, because a number we hold for a place in Lisbon is not ours to
 * rewrite into 020 7946 0000.
 */

/** What a link carries, turned back into what a person reads. */
const decoded = (raw) => {
  const once = String(raw).replace(/^\s*(?:tel|callto|phone)\s*:/i, '').trim();
  if (!/%[0-9a-f]{2}/i.test(once)) return once;
  try { return decodeURIComponent(once); } catch { return once.replace(/%20/gi, ' '); }
};

/**
 * A number fit to print, or null.
 *
 * The rules are the ones that separate a telephone number from the other things
 * that turn up in the same field: a company number, a date, a price, a fragment
 * of markup. Digits between seven and fifteen (E.164's ceiling), nothing
 * alphabetic, and no punctuation beyond what people actually write.
 */
export function phoneOf(raw) {
  if (raw == null) return null;
  const said = decoded(raw)
    // Non-breaking spaces and the typographic dashes a site's stylesheet puts
    // in, back to the characters a keypad has.
    .replace(/[   ]/g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!said) return null;
  // A word in the middle of it is a sentence, not a number: "Call 020 8564
  // 8492 or book online" is the page's prose and we did not read it properly.
  if (/[a-z]/i.test(said)) return null;
  if (!/^[+()\d\s./-]+$/.test(said)) return null;
  const digits = said.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  // A run of the same digit is a placeholder somebody left in a template.
  if (/^(\d)\1+$/.test(digits)) return null;
  return said;
}

/** Whether what we are holding is fit to show at all. */
export const canRing = (raw) => phoneOf(raw) != null;
