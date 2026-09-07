/**
 * Whether the public can actually go there.
 *
 * The atlas is harvested from Wikidata, which knows what a building *is* and
 * not whether you may walk in. So the owner's Culture row read: Windsor Castle,
 * then Bagshot Park Mansion — the Duke of Edinburgh's house — then Cumberland
 * Lodge, then Fort Belvedere, which is a private residence inside Windsor Great
 * Park (7 Sep 2026: "that definitely needs to be fixed"). All three score
 * higher in the atlas than Virginia Water Lake does, because notability is what
 * Wikidata measures and notability is not the same question.
 *
 * **This says no only when something says no.** The tempting rule — hide any
 * country house nobody has vouched for — was tried against the real table and
 * would have hidden Chatsworth, Blenheim, Highclere, Leeds Castle, Hever Castle
 * and Belton House, because a Wikipedia summary that happens not to mention
 * visiting is the ordinary case, not a signal. Of 193 published country houses
 * only a handful say anything either way, so `null` — nobody has established it
 * — is the common answer and it is shown. Getting this wrong in the hiding
 * direction is far worse than the bug it fixes.
 *
 * The reliable signals turned out to be types rather than prose. A place that
 * is a museum is open by definition; a residence of the royal family that is
 * *not* also a museum is closed, which separates Bagshot Park and Highgrove
 * from Windsor Castle, Sandringham and Osborne House in one line. Prose is used
 * only where it states the case outright, and the open tests always run first,
 * so "Osborne House is a former royal residence" cannot be read as a refusal.
 */

/** Types that mean people visit: if a place is one of these, it is open. */
export const OPEN_KINDS = new Set([
  'Q2087181',    // historic house museum
  'Q33506',      // museum
  'Q16735822',   // history museum
  'Q115154402',  // independent museum
  'Q115154345',  // local authority museum
  'Q1595639',    // local museum
  'Q207694',     // art museum
  'Q22698',      // park
  'Q1107656',    // garden
  'Q179049',     // nature reserve
  'Q23413',      // castle
  'Q24354',      // theatre building
  'Q483110',     // stadium
  'Q39614',      // cemetery
  // Palaces. Holyrood, Hampton Court, Kensington and the State Rooms at
  // Buckingham Palace are all somewhere you buy a ticket, and Holyrood is
  // "the official residence of the monarch in Scotland" in its own first
  // sentence — which is how it was wrongly hidden before this line existed.
  'Q16560',      // palace
  'Q15835',      // Japanese garden
  'Q1107656',    // garden (again, for clarity beside its neighbour)
]);

/**
 * Types that mean you cannot simply turn up.
 *
 * Deliberately short. Each one was found on the owner's own home screen and
 * checked against what else carries it.
 */
export const CLOSED_KINDS = new Map([
  // The one that started this. Windsor Castle, Sandringham and Osborne House
  // all carry it too and all are museums as well, so the open test above keeps
  // them; what is left is Bagshot Park, Highgrove and Gatcombe Park.
  ['Q131986827', 'a residence of the royal family, and not a museum'],
  ['Q917182', 'a military academy'],
  ['Q209465', 'a university campus'],
]);

/** Said outright, in the words these summaries actually use. */
const SAYS_OPEN = /national trust|english heritage|historic houses|cadw|open to the public|open to visitors|country park|visitor cent|now a museum|houses a museum|is a museum|open all year|admission charge/i;

const SAYS_CLOSED = /private residence|private home|is a private house|remains a private|not open to the public|closed to the public|official residence|family residence of|country home of|country house of the prime minister/i;

/**
 * A house that stopped being private is a house that opened.
 *
 * Wentworth Woodhouse runs tours, and its summary reads "…until it ceased to be
 * privately owned – often listed as the largest private residence in the United
 * Kingdom". Both halves are there, sixty characters apart, and the second half
 * is a superlative rather than a statement about today. Anywhere in the text is
 * the right scope: a summary that mentions the house ceasing to be private is
 * not describing somewhere you cannot go.
 */
const WAS_ONCE = /ceased to be private|no longer (a )?private|formerly a private|opened to the public/i;

/**
 * @returns {{ visiting: 'yes'|'no'|null, because: string|null }}
 *   `yes` — something establishes that the public may visit.
 *   `no`  — something establishes that they may not.
 *   `null` — nobody has established it either way. Shown, and listed in the
 *            back office for somebody to settle.
 */
export function judgeVisiting({ kinds = [], summary = '' } = {}) {
  const set = new Set(kinds || []);
  for (const q of set) if (OPEN_KINDS.has(q)) return { visiting: 'yes', because: 'it is a museum, a park or somewhere else people go' };
  const text = String(summary || '');
  const open = text.match(SAYS_OPEN);
  if (open) return { visiting: 'yes', because: `its description says "${open[0].toLowerCase()}"` };
  for (const [q, why] of CLOSED_KINDS) if (set.has(q)) return { visiting: 'no', because: why };
  // Only the defining sentence counts.
  //
  // Read over the whole summary this was wrong about as often as it was right.
  // "Following its dissolution in 1536, the buildings were converted to a
  // private residence" hid Reigate Priory, which is a school, a museum and a
  // park; "it was closed to the public in 1955 after an act of vandalism" hid
  // the Japanese garden at Cowden, which reopened after restoration. Both
  // sentences are about the seventeenth and twentieth centuries respectively.
  //
  // What a Wikipedia article says in its first sentence is what the place *is*.
  // Anything after it is history, and history is not opening hours.
  const first = text.split(/(?<=\.)\s/)[0] ?? '';
  const shut = first.match(SAYS_CLOSED);
  if (shut && !WAS_ONCE.test(first)) {
    return { visiting: 'no', because: `its description opens "${shut[0].toLowerCase()}"` };
  }
  return { visiting: null, because: null };
}
