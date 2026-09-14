/**
 * Asking Claude what a place actually is.
 *
 * The owner, 14 Sep 2026: "I don't want to have to determine whether Amity
 * Beach is part of Thorpe Park. You should use the Anthropic API to confirm and
 * fill in those blanks. It should be an automated process." And: "we'll be able
 * to bulk say, 'Anthropic, go look and find this, and get the answers.'"
 *
 * Two things are asked at once, because they are the two the labels cannot
 * settle: which of our primary labels a place is, and whether it is part of
 * somewhere else. The answer must carry the sentence it relied on and where
 * that came from, because an answer without a source is a guess wearing a
 * suit — and nothing is applied until he approves it.
 */

import { searchWeb } from '../claude.js';

const SYSTEM = `You are settling what a place is, for a British family day-out planner.

You are given a place, the words a map provider uses for it, and a closed list
of the only answers allowed. Look it up on the open web.

Answer with JSON and nothing else:
{
  "is": "<one key from the list, or null if none fits>",
  "partOf": "<the name of the larger place it sits inside, or null>",
  "because": "<one sentence, quoting or closely paraphrasing what you read>",
  "source": "<the URL you relied on>"
}

Rules you must keep:
- "is" must be one of the keys given, spelled exactly, or null. Never invent one.
- "partOf" is for a place that is a part of a bigger attraction and cannot be
  visited or bought separately: a ride inside a theme park, a cafe inside a
  museum. A neighbouring business is not part of anything.
- If the web does not tell you, say null and explain that in "because". A
  confident wrong answer is worse than an honest blank.
- Never answer from the words alone. The words are why we are unsure.`;

/** One place, looked up. Returns null where nothing could be established. */
export async function research({ place, allowed, householdId, sessionId, meta = null }) {
  const prompt = [
    `Place: ${place.name ?? place.ref}`,
    place.address ? `Address: ${place.address}` : null,
    place.words?.length ? `The provider calls it: ${place.words.join(', ')}` : null,
    '',
    'The only answers allowed for "is":',
    ...allowed.map((a) => `- ${a.key} — ${a.label}`),
  ].filter(Boolean).join('\n');

  const { text } = await searchWeb({
    system: SYSTEM,
    prompt,
    householdId,
    sessionId,
    purpose: 'admin.taxonomy.research',
    maxSearches: 3,
    maxFetches: 2,
    effort: 'low',
    meta,
  });

  const json = text.match(/\{[\s\S]*\}/);
  if (!json) return null;
  let said;
  try { said = JSON.parse(json[0]); } catch { return null; }
  // Only an answer from the list. A model that invents a key is answering a
  // question nobody asked.
  const is = allowed.some((a) => a.key === said.is) ? said.is : null;
  return {
    is,
    partOf: said.partOf ? String(said.partOf).slice(0, 200) : null,
    because: said.because ? String(said.because).slice(0, 600) : null,
    source: said.source ? String(said.source).slice(0, 400) : null,
  };
}
