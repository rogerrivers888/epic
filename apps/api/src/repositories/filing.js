/**
 * Filing: how a place ends up in a drawer, and what we know about the drawer.
 *
 * This is the read side of the Places redesign (Claude Design, 20 Sep 2026) —
 * the six tabs a person works the taxonomy through. Nothing here calls a
 * provider and nothing here writes; every number comes from the index, the
 * owned records, the search log and the rules themselves, which is what lets
 * these screens be opened as often as anybody likes.
 *
 * **A default is proposed until somebody agrees with it.** The subcategory
 * screen draws that distinction in the shape of the control — outline is
 * proposed, filled is set — so every value comes back with `settled` beside
 * it, and with the count of places that agree, which is the evidence for the
 * proposal. A default nobody has agreed to and nothing supports is not shown
 * as a fact; it is shown as "no places to read it from".
 *
 * **What the places disagree about is not a default at all.** Where the places
 * in a drawer disagree at or past the spread threshold, the drawer has no honest
 * answer and each place answers for itself. Castles are neither indoors nor
 * out, and a drawer that insists is worse than one that shrugs.
 *
 * **A name here is an owned name.** `place_index` holds no name on purpose —
 * names are rented (CLAUDE.md, the data policy) — so a place we have not
 * researched has nothing we may print, and it says so rather than borrowing
 * one from a provider to fill the column.
 */

import { query } from '../db.js';
import * as placeAttributes from './placeAttributes.js';
import * as shelfTaxonomy from './shelfTaxonomy.js';
import { thresholdValues } from './settings.js';

/** One value, compared by its shape rather than by JSON, which orders keys. */
export function sameValue(a, b) {
  if (!a || !b) return false;
  if (a.yesno != null || b.yesno != null) return a.yesno === b.yesno;
  if (a.choice != null || b.choice != null) return a.choice === b.choice;
  if (a.from != null || a.to != null || b.from != null || b.to != null) {
    return (a.from ?? null) === (b.from ?? null) && (a.to ?? null) === (b.to ?? null);
  }
  return false;
}

/** How a value reads on a row. The shape decides, never the attribute. */
export function said(value, attribute = null) {
  if (!value) return '—';
  if (value.yesno != null) return value.yesno ? 'Yes' : 'No';
  if (value.choice != null) return String(value.choice);
  if (value.from != null || value.to != null) {
    const lo = value.from ?? attribute?.range_min ?? '';
    const hi = value.to ?? attribute?.range_max ?? '';
    return `${lo} to ${hi}`;
  }
  return '—';
}

/** A stable key for a value, so the modal answer can be counted. */
const valueKey = (v) => {
  if (!v) return null;
  if (v.yesno != null) return `y:${v.yesno}`;
  if (v.choice != null) return `c:${v.choice}`;
  if (v.from != null || v.to != null) return `r:${v.from ?? ''}-${v.to ?? ''}`;
  return null;
};

/**
 * A value on its own, with nothing about where it came from attached.
 *
 * Rows carry `settled`, `set_by` and `reason` beside the value, and every one
 * of them is about the *answer* rather than about the value. Letting them ride
 * inside it means a default read off one screen and written back by another
 * arrives claiming to be settled, and `sameValue` has to learn to ignore keys
 * it should never have been given (the filing tests).
 */
const bare = (v) => {
  if (!v) return null;
  if (v.yesno != null) return { yesno: v.yesno };
  if (v.choice != null) return { choice: v.choice };
  if (v.from != null || v.to != null) return { from: v.from ?? null, to: v.to ?? null };
  return null;
};

// `level` is not read: it was the eight graded scales' column, and the eight
// were cancelled (migration 246). A value still there belongs to a retired label.
const valueOfRow = (row) => {
  if (!row) return null;
  if (row.yesno != null) return { yesno: row.yesno };
  if (row.from_value != null || row.to_value != null) return { from: row.from_value, to: row.to_value };
  if (row.choice != null) return { choice: row.choice };
  return null;
};

/**
 * Everything the drawer screens read, in one pass.
 *
 * One read and not one per subcategory: the categories tab draws every drawer
 * at once, and a query per drawer is fifty-two round trips for one screen.
 */
export async function drawers() {
  const [tax, places, values, defaults, records, atlas, areas, sets, setSubs] = await Promise.all([
    // Through the repository, not a query of our own: `also_in` is the extra
    // cabinets a drawer is listed in and lives in its own table, and reading it
    // twice in two ways is how two screens come to disagree about it.
    shelfTaxonomy.taxonomy(),
    query(`select venue_ref, subcategory, found_by from place_index
            where subcategory is not null`),
    query('select * from place_attribute_values'),
    query('select * from shelf_subcategory_attributes'),
    // Not `where name is not null`: a place we have not researched still has a
    // postcode, and a row's district count has to include it even though its
    // name is not ours to print. Only the *name* is withheld, never the place.
    query(`select venue_ref, name, postcode, image_url from place_records
            where name is not null or postcode is not null`),
    /**
     * The atlas, which is ours.
     *
     * A place with no owned record still has a name where it came from the
     * atlas — Wikipedia, Wikidata and Commons are open sources we may keep for
     * good (CLAUDE.md), and `attractions.name` is that name. Reading only
     * `place_records` left whole drawers rendering as a hundred and seventy-
     * nine rows of "not researched yet", which is not a data-policy
     * consequence, it is a table we forgot to join (the side-by-side audit,
     * 21 Sep 2026).
     */
    query(`select 'atlas:' || id as venue_ref, name, region_slug from attractions where name is not null`),
    query(`select venue_ref, area_slug from place_areas`),
    query('select key, name, active, vocabulary_settled from question_sets'),
    query('select subcategory_key, set_key from question_set_subcategories'),
  ]);

  const refsBySub = new Map();
  for (const p of places.rows) {
    refsBySub.set(p.subcategory, [...(refsBySub.get(p.subcategory) ?? []), p.venue_ref]);
  }

  const valuesByRef = new Map();
  for (const v of values.rows) {
    const value = valueOfRow(v);
    if (!value) continue;
    const m = valuesByRef.get(v.venue_ref) ?? new Map();
    // `set_by` is what makes a value a person's rather than a sweep's, and the
    // screen draws the two differently ("a human answered" against "defaults").
    // `at` rides with it because the Rules tab dates the last time somebody
    // overruled a default, and a count of corrections with no date behind it
    // cannot tell an argument that ended a month ago from one still going on.
    m.set(v.attribute_key, {
      ...value, by: v.set_by ?? null, reason: v.reason ?? null, at: v.updated_at ?? null,
    });
    valuesByRef.set(v.venue_ref, m);
  }

  const defaultsBySub = new Map();
  for (const d of defaults.rows) {
    const value = valueOfRow(d);
    if (!value) continue;
    const m = defaultsBySub.get(d.subcategory_key) ?? new Map();
    m.set(d.attribute_key, { ...value, settled: Boolean(d.settled) });
    defaultsBySub.set(d.subcategory_key, m);
  }

  const setBySub = new Map(setSubs.rows.map((r) => [r.subcategory_key, r.set_key]));
  const setByKey = new Map(sets.rows.map((s) => [s.key, s]));

  return {
    categories: tax.categories,
    subcategories: tax.subcategories,
    refsBySub,
    valuesByRef,
    defaultsBySub,
    /**
     * What we may print about a place, owned first and atlas behind it.
     *
     * A researched record wins — it is the more specific and the more recent.
     * The atlas fills in the name and where it is for everything else, and a
     * place in neither has genuinely nothing we are allowed to show.
     */
    recordsByRef: (() => {
      const m = new Map();
      for (const a of atlas.rows) {
        m.set(a.venue_ref, { venue_ref: a.venue_ref, name: a.name, postcode: null, image_url: null, where: a.region_slug });
      }
      for (const r of records.rows) {
        const had = m.get(r.venue_ref);
        m.set(r.venue_ref, {
          ...r,
          name: r.name ?? had?.name ?? null,
          where: had?.where ?? null,
        });
      }
      return m;
    })(),
    areasByRef: (() => {
      const m = new Map();
      for (const a of areas.rows) m.set(a.venue_ref, [...(m.get(a.venue_ref) ?? []), a.area_slug]);
      return m;
    })(),
    setBySub,
    setByKey,
  };
}

/**
 * Whether a value is the shape its label is.
 *
 * The database refuses to *write* a mismatched value (migration 132) but the
 * table predates that trigger, so it can still hold them — `museums / indoor`
 * on one machine holds a range of 0 to 7 under a yes/no label. Read straight
 * out, that draws "Indoors · 0 to 7" on a screen, which is worse than drawing
 * nothing: it is a sentence nobody wrote and nobody can act on.
 *
 * So anything that does not fit is read as *nothing said*. Not deleted —
 * clearing somebody's row is a decision about their data — but not believed
 * either, and `acceptDefault` replaces it the moment anybody accepts.
 */
export function fits(attribute, value) {
  if (!value) return false;
  switch (attribute?.kind) {
    case 'yesno': return value.yesno != null;
    case 'range': return value.from != null || value.to != null;
    case 'oneof': return value.choice != null;
    default: return false;
  }
}

/**
 * What one drawer says about one attribute, and on what evidence.
 *
 * The three states the screen draws, and they are genuinely three:
 *   `nothing`  no place in the drawer has ever answered, so there is nothing
 *              to propose from and the row says so rather than guessing;
 *   `proposed` the places mostly agree and this is what they say, in outline;
 *   `set`      a person has agreed to it, filled in.
 *
 * Plus `mixed`, which is not a state of the default but the absence of one: the
 * places disagree past the threshold, so the drawer keeps quiet and each place
 * answers. That is why it is returned separately from `value` — a mixed row has
 * no value, and giving it one would make every reader pick a side.
 */
export function drawerAnswer({ attribute, refs, valuesByRef, defaults, spreadLimit }) {
  const said_ = [];
  for (const ref of refs) {
    const v = valuesByRef.get(ref)?.get(attribute.key);
    // A value of the wrong shape is not a quieter answer, it is no answer.
    if (fits(attribute, v)) said_.push(v);
  }
  const was = defaults?.get(attribute.key) ?? null;
  const current = fits(attribute, was) ? was : null;

  const counts = new Map();
  for (const v of said_) {
    const k = valueKey(v);
    if (!k) continue;
    counts.set(k, [...(counts.get(k) ?? []), v]);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
  const modal = ranked[0] ? ranked[0][1][0] : null;

  const value = bare(current ?? modal);
  const agree = value ? said_.filter((v) => sameValue(v, value)).length : 0;
  const spread = said_.length ? (said_.length - agree) / said_.length : 0;

  /**
   * Mixed is *at or past* the limit, and the words here say so because the
   * code does (Codex read "past the limit" above and objected to the `>=`,
   * rightly — they disagreed).
   *
   * `>=` and not `>` because that is what the prototype does, and the drawing
   * is the specification. A threshold you have to exceed by a hair is also the
   * more surprising of the two: somebody setting it to 0.35 means a third
   * disagreeing is too many, not that a third is fine.
   *
   * `spread > 0` is separate and is not about the boundary: it stops a limit of
   * nought marking every unanimous drawer as mixed. A drawer with nothing to
   * read from is not a drawer whose places disagree, and neither is one whose
   * places all say the same thing.
   */
  const mixed = said_.length > 0 && !current?.settled && spread > 0 && spread >= spreadLimit;

  return {
    key: attribute.key,
    label: attribute.label,
    kind: attribute.kind,
    anchor: attribute.unit ?? null,
    value: mixed ? null : value,
    said: mixed ? '—' : said(value, attribute),
    settled: Boolean(current?.settled),
    proposed: Boolean(value) && !current?.settled,
    mixed,
    heard: said_.length,
    agree,
    spread: Number(spread.toFixed(4)),
    // The sentence under the value, written here so the screen never composes
    // a number into prose and gets the plural wrong. Four cases and not three:
    // a drawer with no places in it and a drawer whose places have never been
    // asked are different problems, and "set" outranks both because a person
    // having agreed to something is the strongest thing the row can say.
    why: current?.settled ? 'set'
      : refs.length === 0 ? 'no places to read it from'
        : said_.length === 0 ? 'no place here has answered yet'
          : `${agree} of ${said_.length} agree`,
  };
}

/** Every attribute of one drawer, split the way the screen draws them. */
export async function drawerOf(subcategoryKey, loaded = null) {
  const d = loaded ?? await drawers();
  const [{ list: attrs }, limits] = await Promise.all([placeAttributes.attributes(), thresholdValues()]);
  const refs = d.refsBySub.get(subcategoryKey) ?? [];
  const defaults = d.defaultsBySub.get(subcategoryKey) ?? new Map();
  const answers = attrs
    .filter((a) => a.active)
    .map((a) => drawerAnswer({
      attribute: a, refs, valuesByRef: d.valuesByRef, defaults, spreadLimit: limits.spreadLimit,
    }));
  return {
    refs,
    facets: answers.filter((a) => !a.mixed),
    excluded: answers.filter((a) => a.mixed),
    // What is proposed but not yet agreed to — the "PROPOSED" number in the
    // band, and what "Accept all" would accept.
    proposed: answers.filter((a) => a.proposed && !a.mixed).length,
  };
}

/**
 * The places in a drawer that argue with it, and what they argue about.
 *
 * Each difference is written as a phrase rather than a pair of values, because
 * the column it lands in is one line wide and "parking no" reads where
 * "parking: expected Yes, got No" does not.
 */
export function disagreeingIn({ refs, valuesByRef, answers, recordsByRef }) {
  const out = [];
  for (const ref of refs) {
    const mine = valuesByRef.get(ref);
    if (!mine) continue;
    const diffs = [];
    let human = false;
    for (const a of answers) {
      if (a.mixed || !a.value) continue;
      const v = mine.get(a.key);
      if (!v || sameValue(v, a.value)) continue;
      if (v.by) human = true;
      diffs.push(`${a.label.toLowerCase()} ${said(v, a).toLowerCase()}`);
    }
    if (!diffs.length) continue;
    const rec = recordsByRef.get(ref) ?? null;
    out.push({
      ref,
      name: rec?.name ?? null,
      postcode: rec?.postcode ?? null,
      photo: rec?.image_url ?? null,
      // Two is what the column fits; the rest are on the place itself.
      diff: diffs.slice(0, 2).join(' · '),
      more: Math.max(0, diffs.length - 2),
      human,
    });
  }
  return out;
}

/**
 * Every default a drawer sets, and the two different ways one can be wrong.
 *
 * Pure, so the counting can be exercised without a database — which matters
 * here because the two counts are easy to conflate and the difference is the
 * whole point of the screen (owner, 20 Sep 2026):
 *
 *  - **contradicted** is computed. Of the places this default files, how many
 *    hold a different value. Nobody has said anything; the data disagrees with
 *    itself, which can mean the rule is too broad or the drawer wants
 *    splitting.
 *  - **overridden** is human: of those, how many a person set. Every one is
 *    somebody who looked at a place and said no, which makes it the stronger
 *    signal and the reason it is counted apart rather than folded in.
 *
 * A place that says nothing is not a contradiction. It is a place nobody has
 * asked, and counting silence as disagreement would condemn every default in a
 * drawer nobody has researched.
 */
export function rulesFrom({ subcategories, refsBySub, defaultsBySub, valuesByRef, byKey, deadShare = 0.6 }) {
  const rows = [];
  let defaults = 0;

  for (const sub of subcategories) {
    if (!sub.active) continue;
    const refs = refsBySub.get(sub.key) ?? [];
    for (const [attributeKey, value] of defaultsBySub.get(sub.key) ?? new Map()) {
      const attribute = byKey.get(attributeKey);
      if (!attribute || !attribute.active) continue;
      defaults += 1;
      // A default nothing can contradict is still a default and is counted as
      // one, but it is not a row here: "being argued with" is the question
      // this screen asks, and an empty drawer cannot argue.
      if (!refs.length) continue;

      let contradicted = 0;
      let overridden = 0;
      let last = null;
      for (const ref of refs) {
        const mine = valuesByRef.get(ref)?.get(attributeKey);
        if (!mine || sameValue(mine, value)) continue;
        contradicted += 1;
        if (!mine.by) continue;
        overridden += 1;
        if (!last || (mine.at && +new Date(mine.at) > +new Date(last))) last = mine.at ?? last;
      }

      rows.push({
        // A default has no id of its own — it *is* the pair — so the pair is
        // the id, and a retire cannot be aimed at the wrong drawer.
        id: `${sub.key}:${attributeKey}`,
        what: `${attribute.label} · ${said(value, attribute)}`,
        level: 'Subcategory',
        where: sub.label,
        places: refs.length,
        contradicted,
        overridden,
        overriddenAt: last ? new Date(last).toISOString().slice(0, 10) : null,
        dead: contradicted > refs.length * deadShare,
        subcategory: sub.key,
      });
    }
  }

  // Worst first, and a human correction outranks a quiet disagreement: two
  // defaults contradicted equally often are not equally wrong if somebody took
  // the trouble to overrule one of them.
  rows.sort((a, b) => (b.overridden - a.overridden)
    || (b.contradicted - a.contradicted)
    || a.where.localeCompare(b.where));

  return { rows, defaults };
}
