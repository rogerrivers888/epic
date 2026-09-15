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
  // An answer with nothing behind it is a guess wearing a suit. No sentence and
  // no source means no answer, whatever it said (Codex, 14 Sep 2026).
  const because = said.because ? String(said.because).trim() : '';
  const source = said.source ? String(said.source).trim() : '';
  if (!because || !/^https?:\/\//i.test(source)) return null;
  if (!is && !said.partOf) return null;
  return {
    is,
    partOf: said.partOf ? String(said.partOf).slice(0, 200) : null,
    because: because.slice(0, 600),
    source: source.slice(0, 400),
  };
}

const WORD_SYSTEM = `You are deciding what one of a map provider's words actually means, for a
British family day-out planner.

You are given the provider's word, a sample of real places it is used on with
their websites, and a closed list of the only answers allowed. Read the
websites. Decide what the word means *in practice*, not what it sounds like.

Answer with JSON and nothing else:
{
  "primary": "<one key from the primary list, or null if none fits>",
  "secondary": [{ "key": "<one key from the secondary list>", "choice": "<one of its options, or null>" }],
  "because": "<one sentence, saying what the places turned out to be>",
  "source": "<the URL you relied on most>"
}

Rules you must keep:
- "primary" must be one of the primary keys given, spelled exactly, or null.
- "secondary" may be empty. Only include one where the places really share it.
- A word can be too broad to have one answer. Say null and explain why.
- If the websites do not tell you, say null. A confident wrong answer is worse
  than an honest blank, because it will file hundreds of places.
- Never answer from the word alone. The word is why we are unsure.`;

/**
 * What one of a provider's words means, read off the real places that carry it.
 *
 * The owner, 15 Sep 2026: "I want to have the option to ask the AI to look at
 * them and to actually check the website addresses and come up with a
 * recommendation." So the sample goes in with its websites, and what comes back
 * is a recommendation for the *word* — never applied, only offered.
 */
export async function recommendForWord({ word, places, primary, secondary, householdId, sessionId, meta = null }) {
  const prompt = [
    `The provider's word: ${word}`,
    '',
    'Real places it is used on:',
    ...places.slice(0, 12).map((p) => [
      `- ${p.name ?? p.id}`,
      p.address ? `  ${p.address}` : null,
      p.website ? `  ${p.website}` : '  (no website)',
      p.types?.length ? `  also called: ${p.types.filter((t) => t !== word).join(', ')}` : null,
    ].filter(Boolean).join('\n')),
    '',
    'The only answers allowed for "primary":',
    ...primary.map((a) => `- ${a.key} — ${a.label}`),
    '',
    'The only answers allowed for "secondary":',
    ...secondary.map((a) => `- ${a.key} — ${a.label}${a.options?.length ? ` (one of: ${a.options.join(', ')})` : ''}`),
  ].filter(Boolean).join('\n');

  const { text } = await searchWeb({
    system: WORD_SYSTEM,
    prompt,
    householdId,
    sessionId,
    purpose: 'admin.taxonomy.word',
    maxSearches: 4,
    maxFetches: 6,
    effort: 'low',
    meta,
  });

  const json = text.match(/\{[\s\S]*\}/);
  if (!json) return null;
  let said;
  try { said = JSON.parse(json[0]); } catch { return null; }
  const is = primary.some((a) => a.key === said.primary) ? said.primary : null;
  // Same bar as a place: a sentence and a real source, or it is not an answer.
  const because = said.because ? String(said.because).trim() : '';
  const source = said.source ? String(said.source).trim() : '';
  if (!because || !/^https?:\/\//i.test(source)) return null;
  const alsoSays = (Array.isArray(said.secondary) ? said.secondary : [])
    .map((x) => {
      const a = secondary.find((o) => o.key === x?.key);
      if (!a) return null;
      // A one-of choice has to be on its own list, like everywhere else.
      if (a.options?.length && !a.options.includes(x.choice)) return null;
      return { key: a.key, label: a.label, choice: x.choice ?? null };
    })
    .filter(Boolean);
  if (!is && !alsoSays.length) return null;
  return { primary: is, secondary: alsoSays, because: because.slice(0, 600), source: source.slice(0, 400) };
}
