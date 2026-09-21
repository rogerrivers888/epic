/**
 * What is in the text but is not about the place.
 *
 * The first harvest raised 46,000 "features" and produced nought decisions,
 * because the extractor read whatever was in front of it. What was in front of
 * it was licence footers, opening-hours syntax, the place's own name and the
 * county it sits in — `by-sa`, `mo-su`, `bristol`, `uefa` — and every one of
 * those was written down as a candidate feature of a day out.
 *
 * None of it is a judgement call. A Creative Commons footer is boilerplate
 * wherever it appears; `Mo-Su 09:00-17:00` is a syntax, not a sentence; and a
 * place's own name is the one phrase guaranteed to recur across its text and
 * guaranteed to say nothing about what is there. So it is stripped before the
 * model is asked anything, rather than filtered out of the answers afterwards —
 * cheaper, and it stops the model spending its attention on it.
 */

/**
 * Licence and attribution footers, in the forms our sources actually use.
 *
 * Wikipedia and Wikidata carry CC BY-SA; OpenStreetMap carries ODbL; venue
 * pages carry a copyright line. They are matched as whole phrases rather than
 * as words, so a genuine mention of "commons" (Bucklebury Common) survives.
 */
const LICENCE = [
  /\bcc[- ]by(?:[- ]sa)?(?:[- ]\d(?:\.\d)?)?\b/gi,
  /\bcreative\s+commons\b[^.]*/gi,
  /\bopen\s+database\s+licen[cs]e\b/gi,
  /\bodbl\b/gi,
  /©\s*[^.\n]*/g,
  /\ball rights reserved\b/gi,
  /\bcontributors?\b(?=[^.]*openstreetmap)/gi,
  /\bwikimedia\b[^.]*/gi,
  /\bdata\s+from\s+openstreetmap\b/gi,
];

/**
 * OpenStreetMap's opening-hours grammar.
 *
 * `Mo-Su 10:00-18:00; Dec 25 off` is a machine-readable field that happens to
 * live in a text column. It produced `mo-su` as a candidate feature on more
 * than a hundred places.
 */
const DAY = String.raw`(?:mo|tu|we|th|fr|sa|su)`;
const TIME = String.raw`\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}`;
const HOURS = [
  // A day token only counts as one when it *ends* as a word and is part of a
  // range or carries a time. Without the trailing boundary, `th` matched the
  // start of "There", `fr` the start of "Front" and `su` the start of
  // "Sunset" — the expression ate the first two letters of ordinary words and
  // left "ere is a shop". Caught by a test asserting two sentences do not fuse,
  // which is not what it was written to check.
  new RegExp(String.raw`\b${DAY}\b(?:\s*[-,]\s*${DAY}\b)*\s*${TIME}`, 'gi'),
  new RegExp(String.raw`\b${DAY}\s*-\s*${DAY}\b`, 'gi'),
  /\b24\/7\b/gi,
  /\b(?:ph|sh)\s+off\b/gi,
  new RegExp(String.raw`\b${TIME}\b`, 'g'),
];

/** Wiki and page furniture that says nothing about the place. */
const FURNITURE = [
  /\[\d+\]/g,                       // Wikipedia footnote markers
  /\{\{[^}]*\}\}/g,                 // template leftovers
  /\bretrieved\s+\d[^.]*/gi,
  /\bthis\s+article\s+[^.]*/gi,
  /\bsee\s+also\b[^.]*/gi,
  /\bcookie(?:s)?\s+polic(?:y|ies)\b[^.]*/gi,
  /\bprivacy\s+polic(?:y|ies)\b[^.]*/gi,
  /\bterms\s+(?:and|&)\s+conditions\b[^.]*/gi,
  /\bskip\s+to\s+(?:main\s+)?content\b/gi,
];

/**
 * A place's own name, and the words a name is made of.
 *
 * The one phrase guaranteed to recur across a place's text and guaranteed to
 * say nothing about what is there. Stripped as the whole name *and* as its
 * parts, because "Aberdulais Falls" turns up as "aberdulais" on its own — but
 * only parts long enough to be distinctive, so "The Lookout" does not take the
 * word "lookout" out of a sentence about a viewing platform.
 */
const NAME_PART_MIN = 5;

/** Words that are part of a name but are also ordinary English. */
const KEEP = new Set([
  'park', 'garden', 'gardens', 'castle', 'museum', 'centre', 'center', 'beach',
  'falls', 'caves', 'lake', 'forest', 'woods', 'farm', 'house', 'hall', 'abbey',
  'bridge', 'tower', 'pool', 'lido', 'court', 'green', 'common', 'lookout',
]);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Everything to strip for one place: its name, its town, and its name's parts.
 *
 * Returned as a list of expressions rather than applied here, so the caller can
 * build it once per place and reuse it across that place's several texts.
 */
export function namesOf({ name = null, town = null } = {}) {
  const out = [];
  for (const whole of [name, town]) {
    if (!whole) continue;
    out.push(new RegExp(`\\b${escape(whole)}\\b`, 'gi'));
  }
  for (const part of String(name ?? '').split(/[^A-Za-z']+/)) {
    const word = part.toLowerCase();
    if (word.length < NAME_PART_MIN || KEEP.has(word)) continue;
    out.push(new RegExp(`\\b${escape(part)}\\b`, 'gi'));
  }
  return out;
}

/**
 * The text with everything that is not about the place taken out.
 *
 * Replaced with a space rather than deleted, so two sentences either side of a
 * footer do not run together into a phrase that was never written.
 */
export function strip(text, { names = [] } = {}) {
  if (!text) return '';
  let out = String(text);
  for (const re of [...LICENCE, ...HOURS, ...FURNITURE, ...names]) out = out.replace(re, ' ');
  return out
    // Punctuation the removed phrase was carrying. "A waterwheel. © 2026 X.
    // There is a shop." leaves a stranded full stop between two real
    // sentences, and a stranded stop reads to the extractor as a sentence
    // boundary where there is none.
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.,;:!?])\s*(?=[.,;:!?])/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is this a menu rather than a description?
 *
 * Menu text is the single largest source of false features — `prawn linguine`,
 * `tomahawk pork`, `egg benedict`, `lobster mac`, each seen on exactly one
 * place. A dish is not a facility, and the thing a menu *does* say about a
 * place is its cuisine, which has its own vocabulary and its own path
 * (`place_attributes.cuisine`, and the carries on a Google word).
 *
 * Detected by shape rather than by keyword: a run of short comma- or
 * newline-separated noun phrases with prices, or a high share of lines that
 * are two or three words and nothing else.
 */
export function looksLikeMenu(text) {
  if (!text) return false;
  const s = String(text);
  const prices = (s.match(/£\s?\d+(?:\.\d{2})?/g) ?? []).length;
  const lines = s.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  // Several prices in a short text is a menu whatever the words are.
  if (prices >= 3 && prices / Math.max(1, lines.length) > 0.2) return true;
  const short = lines.filter((l) => {
    const words = l.split(/\s+/).length;
    return words >= 1 && words <= 4 && !/[.!?]$/.test(l);
  }).length;
  return lines.length >= 6 && short / lines.length > 0.7;
}
