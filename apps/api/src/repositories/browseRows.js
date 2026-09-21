/**
 * The rows a household browses, and who has hearted them.
 *
 * A row is a question asked of every place, so filling one is running its rule
 * rather than reading a join table. That is the expensive part and the reason
 * everything here is done in one pass: forty rows against thirty thousand
 * places is forty full scans if each row fetches for itself.
 */

import { query } from '../db.js';
import * as filing from './filing.js';
import * as placeAttributes from './placeAttributes.js';
import { attributesIn, checkPredicate, matches, shorthand } from '../domain/browseRows.js';

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

export async function rows() {
  const { rows: list } = await query(
    'select * from browse_rows where active order by position, title');
  return list;
}

/**
 * Every place a row could return, with the values a rule is judged on.
 *
 * **Narrowest wins, the way the rest of the taxonomy reads.** A place's own
 * answer, else its drawer's default, else nothing known. Almost nothing has
 * been answered per place yet, so nearly every row fills from its drawer — and
 * that is not a shortcut, it is what a drawer default is *for*.
 */
export async function pool() {
  const [d, { list: attrs }] = await Promise.all([filing.drawers(), placeAttributes.attributes()]);
  const byKey = new Map(attrs.map((a) => [a.key, a]));
  const subOf = new Map(d.subcategories.map((s) => [s.key, s]));

  const places = [];
  for (const [subKey, refs] of d.refsBySub) {
    const sub = subOf.get(subKey);
    if (!sub || !sub.active) continue;
    for (const ref of refs) {
      places.push({
        ref,
        subcategory: subKey,
        category: sub.category_key,
        record: d.recordsByRef.get(ref) ?? null,
      });
    }
  }

  const valueOf = (place, key) => {
    const attr = byKey.get(key);
    if (!attr) return null;
    const own = d.valuesByRef.get(place.ref)?.get(key);
    if (filing.fits(attr, own)) return own;
    const inherited = d.defaultsBySub.get(place.subcategory)?.get(key);
    return filing.fits(attr, inherited) ? inherited : null;
  };

  return { places, valueOf, attributes: byKey, subcategories: subOf, categories: d.categories };
}

/**
 * The districts the rows are previewed in.
 *
 * Not a constant: the drawing names three Berkshire outcodes because that is
 * where its invented data was, and hard-coding them would make the preview a
 * picture of somewhere Epic may hold nothing. They are the outcodes we
 * actually have places in — the busiest, the middle and the thinnest — because
 * the whole point of previewing in three is that a rule returning fourteen in
 * one returns two in another.
 *
 * Where there are not three to choose from, that is said rather than padded.
 */
export function districts(ctx) {
  // Counted over the places a row can actually return — indexed, in an active
  // drawer — and not over every record with a postcode. An outcode full of
  // unfiled records would otherwise be chosen as the dense district and then
  // return nothing for every row on the screen (Codex, 21 Sep 2026).
  const counts = new Map();
  for (const p of ctx.places) {
    const code = outcodeOf(p);
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const out = [...counts].map(([code, places]) => ({ code, places }))
    .sort((a, b) => b.places - a.places);
  // An outward code is one or two letters then a digit. Anything else in that
  // column is not a postcode — foreign addresses put their own formats there.
  const real = out.filter((r) => /^[A-Z]{1,2}[0-9][0-9A-Z]?$/i.test(r.code));
  if (real.length < 3) {
    return { districts: real.map((r) => ({ ...r, density: 'all we have' })), enough: false };
  }
  const pick = [real[0], real[Math.floor(real.length / 2)], real[real.length - 1]];
  const density = ['dense', 'middling', 'thin'];
  return {
    districts: pick.map((r, i) => ({ code: r.code, places: r.places, density: density[i] })),
    // Three outcodes exist, but three outcodes holding one place between two of
    // them is not a preview of anything: the point of three is that a rule
    // returning fourteen in one returns two in another, and that needs two
    // that could plausibly return either. Said rather than padded.
    enough: pick.every((r) => r.places >= 5),
  };
}

/**
 * Why a row is empty, in a sentence, or null where it is not.
 *
 * "Nothing answers this" and "there is nothing like that near you" are
 * different problems and want different fixes — the first is a gap in what we
 * have asked, the second is a gap in what exists. A row showing a bare nought
 * makes them look identical, and the first is by far the commoner one on a
 * young estate: most of the eight have never been answered for any drawer, so
 * most rows are empty for a reason that has nothing to do with the places.
 */
export function emptyBecause(row, { places, valueOf, attributes }) {
  const asked = attributesIn(row.predicate);
  if (!asked.length) return 'nothing it asks about is set on any place';
  const silent = asked.filter((k) => !places.some((p) => valueOf(p, k)));
  if (!silent.length) return null;
  const names = silent.map((k) => (attributes.get(k)?.label ?? k).toLowerCase());
  const list = names.length === 1 ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `nothing has answered ${list}, so nothing can match`;
}

/** What a rule returns, per district, with the names behind each count. */
export function fillFor(row, { places, valueOf }, dists) {
  const hit = places.filter((p) => matches(row.predicate, p, valueOf));
  const fill = {};
  for (const d of dists) {
    const here = hit.filter((p) => outcodeOf(p) === d.code);
    fill[d.code] = {
      count: here.length,
      // The names, because clicking a row opens it to show what it actually
      // returns. A place we have not researched has no name we may print.
      places: here.slice(0, 12).map((p) => p.record?.name ?? null).filter(Boolean),
    };
  }
  return { fill, total: hit.length };
}

const outcodeOf = (p) => {
  const pc = p.record?.postcode;
  return pc ? String(pc).trim().split(/\s+/)[0] : null;
};

/**
 * Who has hearted what, for one household — **every** heart, not one per row.
 *
 * Keyed by row and holding a list, because more than one person in a household
 * can heart the same row and a Map keyed on `row_key` silently kept whichever
 * came back last. That lost two things at once: the screen named one person
 * when two had said yes, and unhearting aimed at the name it happened to be
 * showing deleted a real heart while another survived — so the row stayed
 * hearted and the screen reported success (Codex, 21 Sep 2026).
 *
 * Oldest first, so "who hearted this" has a stable answer rather than one that
 * depends on row order.
 */
export async function heartsFor(householdId) {
  if (!householdId) return new Map();
  const { rows: list } = await query(
    `select h.row_key, h.member_id, h.hearted_at, m.name
       from browse_row_hearts h join members m on m.id = h.member_id
      where h.household_id = $1
      order by h.hearted_at, h.member_id`, [householdId]);
  const out = new Map();
  for (const r of list) out.set(r.row_key, [...(out.get(r.row_key) ?? []), r]);
  return out;
}

/**
 * The share of households that heart each row.
 *
 * Null where nobody has, which is a different fact from nought — "nobody has
 * yet" and "households looked and declined" read differently and are drawn
 * differently.
 */
export async function shares() {
  const [{ rows: [{ n: households }] }, { rows: per }] = await Promise.all([
    query('select count(*)::int n from households'),
    query('select row_key, count(distinct household_id)::int n from browse_row_hearts group by 1'),
  ]);
  const out = new Map();
  for (const r of per) out.set(r.row_key, households ? r.n / households : null);
  return { shares: out, households };
}

/** Change a row's words, or its rule. */
export async function save(key, { title, copy, predicate }, context) {
  const { rows: was } = await query('select * from browse_rows where key = $1', [key]);
  if (!was[0]) throw bad(`There is no row called ${key}.`);
  if (predicate !== undefined) {
    // Refused at the field and never saved: a row with a rule nothing can run
    // would quietly return nothing for ever.
    checkPredicate(predicate, context);
  }
  const { rows: out } = await query(
    `update browse_rows
        set title = coalesce($2, title),
            copy = case when $3::boolean then $4 else copy end,
            predicate = coalesce($5::jsonb, predicate),
            seeded = false,
            updated_at = now()
      where key = $1 returning *`,
    [key, title ?? null, copy !== undefined, copy ?? null,
     predicate === undefined ? null : JSON.stringify(predicate)]);
  return out[0];
}

/**
 * Heart a row, or take the heart back.
 *
 * A heart belongs to a member. Which member is the first-heart question's
 * answer, and it is the caller's to supply — hearting with nobody chosen is
 * not a heart to drop, it is a question to ask.
 */
export async function heart(key, { householdId, memberId, on }) {
  if (!householdId) throw bad('Which household?');
  if (!memberId) throw bad('Whose heart is it?');
  if (!on) {
    await query('delete from browse_row_hearts where row_key = $1 and member_id = $2', [key, memberId]);
    return null;
  }
  const { rows: out } = await query(
    `insert into browse_row_hearts (row_key, household_id, member_id) values ($1, $2, $3)
     on conflict (row_key, member_id) do update set hearted_at = now()
     returning *`, [key, householdId, memberId]);
  return out[0];
}

export { shorthand, attributesIn };
