/**
 * A browse row: a title, a copy line and a rule. Never a drawer.
 *
 * The rows are the long scrollable list a household actually browses, and
 * hearting one is the highest-signal tap in the product. Nothing is ever
 * *filed* into a row — a row is a question asked of every place, and the
 * answer changes as the places do.
 *
 * **The rule is structured, and that is the whole point of this module.**
 * In the design prototype a row carries both a shorthand string and a
 * JavaScript predicate, and the shorthand is decoration: `rowFill` filters on
 * the function, and editing the caption to "anything at all" leaves the row
 * returning exactly what it returned before. That is fine in a drawing and a
 * lie in production — an editable field that changes nothing is worse than a
 * read-only one, because somebody will edit it, believe they have changed what
 * a household sees, and be wrong. So the rule is data, the shorthand is
 * rendered *from* the data, and the two cannot disagree.
 *
 * A clause is one of:
 *
 *   { attribute, atLeast | atMost | is }   a scale, nought to four
 *   { attribute, yes: true | false }       a yes or no
 *   { attribute, overlaps: [lo, hi] }      a range, against a range
 *   { attribute, from | to }               one end of a range
 *   { subcategory: [key, …] }              the drawer it is in
 *   { category: [key, …] }                 the cabinet
 *   { not: clause }                        the opposite
 *   { any: [clause, …] }                   one of these
 *   { all: [clause, …] }                   all of these
 *
 * There is deliberately no clause for *where* a place is. How far away
 * somewhere is belongs to one fence (`domain/band.js`) and depends on the
 * household asking; a row that quietly held its own idea of "near" would be a
 * second fence, and the first thing it would do is disagree with the first one.
 */

const KINDS = new Set(['atLeast', 'atMost', 'is', 'yes', 'overlaps', 'from', 'to']);

/** Every attribute a predicate names, so a caller can fetch only those. */
export function attributesIn(predicate) {
  const out = new Set();
  walk(predicate, (c) => { if (c.attribute) out.add(c.attribute); });
  return [...out];
}

function walk(clause, fn) {
  if (!clause || typeof clause !== 'object') return;
  if (Array.isArray(clause.all)) { clause.all.forEach((c) => walk(c, fn)); return; }
  if (Array.isArray(clause.any)) { clause.any.forEach((c) => walk(c, fn)); return; }
  if (clause.not) { walk(clause.not, fn); return; }
  fn(clause);
}

/**
 * Whether a predicate is sayable at all.
 *
 * Refused at the field and never saved, so a row cannot be left with a rule
 * nothing can run. The message is the one the screen prints.
 */
export function checkPredicate(clause, { attributes, subcategories, categories }) {
  const bad = (m) => Object.assign(new Error(m), { status: 400, code: 'bad_request' });
  if (!clause || typeof clause !== 'object') throw bad('A rule has to say something.');
  if (Array.isArray(clause.all) || Array.isArray(clause.any)) {
    const list = clause.all ?? clause.any;
    if (!list.length) throw bad('A rule has to say something.');
    list.forEach((c) => checkPredicate(c, { attributes, subcategories, categories }));
    return;
  }
  if (clause.not) { checkPredicate(clause.not, { attributes, subcategories, categories }); return; }

  if (clause.subcategory) {
    const keys = [clause.subcategory].flat();
    // An empty list is not "any drawer", it is a rule that can never match —
    // and it would sit there returning nothing for ever without saying why.
    if (!keys.length) throw bad('Name at least one subcategory.');
    for (const k of keys) if (!subcategories.has(k)) throw bad(`${k} is not one of our subcategories.`);
    return;
  }
  if (clause.category) {
    const keys = [clause.category].flat();
    if (!keys.length) throw bad('Name at least one category.');
    for (const k of keys) if (!categories.has(k)) throw bad(`${k} is not one of our categories.`);
    return;
  }

  // An empty clause is not an unknown label, and saying so sends whoever wrote
  // it looking for a label that was never named.
  if (clause.attribute == null) throw bad('A rule has to say something.');
  const a = attributes.get(clause.attribute);
  if (!a) throw bad(`${clause.attribute} is not one of our labels.`);
  const said = Object.keys(clause).filter((k) => KINDS.has(k));
  if (said.length !== 1) throw bad(`Say one thing about ${a.label}, not ${said.length}.`);
  const [how] = said;

  if (a.kind === 'scale' && !['atLeast', 'atMost', 'is'].includes(how)) {
    throw bad(`${a.label} is a scale — say at least, at most, or exactly.`);
  }
  if (a.kind === 'yesno' && how !== 'yes') throw bad(`${a.label} is a yes or no.`);
  if (a.kind === 'range' && !['overlaps', 'from', 'to'].includes(how)) {
    throw bad(`${a.label} is a range — say overlaps, from, or to.`);
  }
  if (a.kind === 'oneof') throw bad(`${a.label} is one of a list, which a row cannot ask about yet.`);
  if (how === 'overlaps') {
    const v = clause.overlaps;
    if (!Array.isArray(v) || v.length !== 2 || v.some((n) => !Number.isFinite(Number(n)))) {
      throw bad(`${a.label} overlaps two numbers.`);
    }
  }
  if (['atLeast', 'atMost', 'is', 'from', 'to'].includes(how) && !Number.isFinite(Number(clause[how]))) {
    throw bad(`${a.label} wants a number.`);
  }
}

/**
 * Yes, no, or nobody has said — and the third one is not a kind of no.
 *
 * Three states rather than a boolean, because negation over two of them is
 * wrong in a way that only shows up nested. A first attempt asked "is this
 * knowable?" and "is it true?" in two separate passes, and
 * `not(any([known-false, unknown]))` then matched: the `any` had one known
 * child so the first pass called it knowable, and returned false so the
 * second pass negated it to true — for a place nobody had asked (Codex,
 * 21 Sep 2026). Three-valued logic gets this right by construction, and an
 * editable rule can nest as deeply as somebody likes.
 */
const YES = 'yes';
const NO = 'no';
const UNKNOWN = 'unknown';

export function evaluate(clause, place, valueOf) {
  if (!clause) return UNKNOWN;

  if (Array.isArray(clause.all)) {
    const seen = clause.all.map((c) => evaluate(c, place, valueOf));
    // One no settles it. Otherwise an unknown leaves the whole thing unknown:
    // "indoors and step free" is not answered by a place we know is indoors
    // and have never asked about steps.
    if (seen.includes(NO)) return NO;
    return seen.includes(UNKNOWN) ? UNKNOWN : YES;
  }
  if (Array.isArray(clause.any)) {
    const seen = clause.any.map((c) => evaluate(c, place, valueOf));
    if (seen.includes(YES)) return YES;
    return seen.includes(UNKNOWN) ? UNKNOWN : NO;
  }
  if (clause.not) {
    const inner = evaluate(clause.not, place, valueOf);
    return inner === UNKNOWN ? UNKNOWN : inner === YES ? NO : YES;
  }

  // Which drawer a place is in is always known: it is how it got here.
  if (clause.subcategory) return [clause.subcategory].flat().includes(place.subcategory) ? YES : NO;
  if (clause.category) return [clause.category].flat().includes(place.category) ? YES : NO;

  const v = valueOf(place, clause.attribute);
  if (!v) return UNKNOWN;
  const said = (b) => (b ? YES : NO);
  if (clause.atLeast != null) return v.level == null ? UNKNOWN : said(v.level >= Number(clause.atLeast));
  if (clause.atMost != null) return v.level == null ? UNKNOWN : said(v.level <= Number(clause.atMost));
  if (clause.is != null) return v.level == null ? UNKNOWN : said(v.level === Number(clause.is));
  if (clause.yes != null) return v.yesno == null ? UNKNOWN : said(v.yesno === Boolean(clause.yes));
  if (clause.overlaps) {
    const [lo, hi] = clause.overlaps.map(Number);
    return said((v.from ?? 0) <= hi && (v.to ?? 99) >= lo);
  }
  if (clause.from != null) return said((v.from ?? 0) >= Number(clause.from));
  if (clause.to != null) return said((v.to ?? 99) <= Number(clause.to));
  return UNKNOWN;
}

/**
 * Does this place answer the rule?
 *
 * `valueOf` is handed in rather than looked up, so the caller decides the
 * narrowest-wins reading once — the place's own answer, else its drawer's,
 * else nothing — and every row is judged on the same reading.
 *
 * **Nothing known is not a no.** A place that has never been asked whether it
 * is indoors does not answer "It's raining again", and it does not answer "not
 * indoors" either; it simply is not in either row. Treating an absent value as
 * false is how a row fills up with places nobody has checked.
 */
export function matches(clause, place, valueOf) {
  return evaluate(clause, place, valueOf) === YES;
}

/**
 * The rule in shorthand: "how much walking ≥ 3 · indoors".
 *
 * Rendered from the structure every time and never stored, so it cannot come
 * to describe a rule the row no longer has.
 */
export function shorthand(clause, labels) {
  const name = (k) => (labels.get(k)?.label ?? k).toLowerCase();
  const one = (c) => {
    if (Array.isArray(c.all)) return c.all.map(one).join(' · ');
    if (Array.isArray(c.any)) return c.any.map(one).join(' or ');
    if (c.not) return `not ${one(c.not)}`;
    if (c.subcategory) return [c.subcategory].flat().map((k) => labels.get(k)?.label ?? k).join(' or ');
    if (c.category) return [c.category].flat().map((k) => labels.get(k)?.label ?? k).join(' or ');
    if (c.atLeast != null) return `${name(c.attribute)} ≥ ${c.atLeast}`;
    if (c.atMost != null) return `${name(c.attribute)} ≤ ${c.atMost}`;
    if (c.is != null) return `${name(c.attribute)} ${c.is}`;
    if (c.yes != null) return c.yes ? name(c.attribute) : `not ${name(c.attribute)}`;
    if (c.overlaps) return `${name(c.attribute)} overlaps ${c.overlaps[0]}–${c.overlaps[1]}`;
    if (c.from != null) return `${name(c.attribute)} from ${c.from}`;
    if (c.to != null) return `${name(c.attribute)} to ${c.to}`;
    return '?';
  };
  return one(clause);
}
