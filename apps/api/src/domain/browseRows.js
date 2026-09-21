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
    for (const k of keys) if (!subcategories.has(k)) throw bad(`${k} is not one of our subcategories.`);
    return;
  }
  if (clause.category) {
    const keys = [clause.category].flat();
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
  if (!clause) return false;
  if (Array.isArray(clause.all)) return clause.all.every((c) => matches(c, place, valueOf));
  if (Array.isArray(clause.any)) return clause.any.some((c) => matches(c, place, valueOf));
  // `not` over an unknown is still unknown, so it cannot be a plain negation:
  // "not indoors" must not sweep in every place nobody has asked.
  if (clause.not) {
    const known = sayable(clause.not, place, valueOf);
    return known && !matches(clause.not, place, valueOf);
  }
  if (clause.subcategory) return [clause.subcategory].flat().includes(place.subcategory);
  if (clause.category) return [clause.category].flat().includes(place.category);

  const v = valueOf(place, clause.attribute);
  if (!v) return false;
  if (clause.atLeast != null) return v.level != null && v.level >= Number(clause.atLeast);
  if (clause.atMost != null) return v.level != null && v.level <= Number(clause.atMost);
  if (clause.is != null) return v.level != null && v.level === Number(clause.is);
  if (clause.yes != null) return v.yesno === Boolean(clause.yes);
  if (clause.overlaps) {
    const [lo, hi] = clause.overlaps.map(Number);
    const from = v.from ?? 0;
    const to = v.to ?? 99;
    return from <= hi && to >= lo;
  }
  if (clause.from != null) return (v.from ?? 0) >= Number(clause.from);
  if (clause.to != null) return (v.to ?? 99) <= Number(clause.to);
  return false;
}

/** Whether anything is known about what this clause asks of this place. */
function sayable(clause, place, valueOf) {
  if (Array.isArray(clause.all)) return clause.all.every((c) => sayable(c, place, valueOf));
  if (Array.isArray(clause.any)) return clause.any.some((c) => sayable(c, place, valueOf));
  if (clause.not) return sayable(clause.not, place, valueOf);
  if (clause.subcategory || clause.category) return true;
  return Boolean(valueOf(place, clause.attribute));
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
