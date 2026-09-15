/**
 * A place that is part of another place.
 *
 * The owner, 14 Sep 2026: "if you know something is part of Thorpe Park, it all
 * lives in Thorpe Park, and we should only ever display Thorpe Park, not Amity
 * Beach."
 *
 * This is deliberately not a label. Amity Beach and a real standalone water
 * park carry the same words, so nothing a rule can read tells them apart. What
 * tells them apart is that one is inside the other, which is a fact about two
 * places.
 *
 * A child keeps everything it has. It is only never offered on its own, and
 * what it knows is read as part of its parent.
 */

import { query } from '../db.js';
import * as placeAttributes from './placeAttributes.js';

const TTL_MS = 10_000;
let cache = null;
let cachedAt = 0;
export const forget = () => { cache = null; };

/** Every settled part-of, as child → parent. A proposal is not one until told. */
export async function parts() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const { rows } = await query(`select child_ref, parent_ref from place_parts where how = 'told'`);
  cache = { childToParent: new Map(rows.map((r) => [r.child_ref, r.parent_ref])) };
  cachedAt = Date.now();
  return cache;
}

/** Say so, or take it back. `parentRef` of null forgets it. */
export async function setPart(childRef, parentRef, { how = 'told', note = null, by = null } = {}) {
  const child = String(childRef ?? '').trim();
  if (!child) throw Object.assign(new Error('Which place?'), { status: 400, code: 'bad_request' });
  // Trimmed before it is judged: a parent of "   " is nothing, and taken as
  // something it would hide the child behind a reference nobody can reach
  // (Codex, 14 Sep 2026).
  const parent = String(parentRef ?? '').trim();
  if (!parent) {
    await query('delete from place_parts where child_ref = $1', [child]);
    forget();
    return null;
  }
  if (parent === child) {
    throw Object.assign(new Error('A place cannot be part of itself.'), { status: 400, code: 'bad_request' });
  }
  // One step only, checked from both ends. A part of a part would need the
  // reader to walk a chain, and nothing in Epic has ever needed more than
  // "this is inside that" (Codex, 14 Sep 2026: the first check only asked one
  // of the two questions).
  const { rows: up } = await query(`select parent_ref from place_parts where child_ref = $1 and how = 'told'`, [parent]);
  if (up[0]) {
    throw Object.assign(new Error(`${parent} is itself part of ${up[0].parent_ref}. Name that one instead.`),
      { status: 400, code: 'bad_request' });
  }
  const { rows: down } = await query(
    `select child_ref from place_parts where parent_ref = $1 and how = 'told' limit 1`, [child]);
  if (down[0]) {
    throw Object.assign(new Error(`${child} already has ${down[0].child_ref} inside it, so it cannot be inside something else.`),
      { status: 400, code: 'bad_request' });
  }
  const { rows } = await query(
    `insert into place_parts (child_ref, parent_ref, how, note, set_by)
     values ($1, $2, $3, $4, $5)
     on conflict (child_ref) do update
        set parent_ref = excluded.parent_ref, how = excluded.how,
            note = excluded.note, set_by = excluded.set_by, updated_at = now()
     returning *`,
    [child, parent, how, note, by]);
  forget();
  return rows[0];
}

/** What is inside this place. */
export async function childrenOf(parentRef) {
  const { rows } = await query(
    `select * from place_parts where parent_ref = $1 order by how, child_ref`, [String(parentRef ?? '')]);
  return rows;
}

/** The ones nobody has settled yet, newest first. */
export async function proposed(limit = 100) {
  const { rows } = await query(
    `select * from place_parts where how = 'proposed' order by created_at desc limit $1`,
    [Math.min(500, Math.max(1, limit))]);
  return withNames(rows);
}

/** Every part-of already told, so the screen is not empty when the work is done. */
export async function told(limit = 100) {
  const { rows } = await query(
    `select * from place_parts where how = 'told' order by updated_at desc limit $1`,
    [Math.min(500, Math.max(1, limit))]);
  return withNames(rows);
}

/**
 * A reference is not a name. `google:ChIJ…` on screen is the bug the owner
 * called out on a rule (12 Sep 2026), and the same one here: the row has to
 * read "Amity Beach is part of Thorpe Park". Names come from the owned records,
 * which is where Epic is allowed to keep one.
 */
async function withNames(rows) {
  const refs = [...new Set(rows.flatMap((r) => [r.child_ref, r.parent_ref]).filter(Boolean))];
  if (!refs.length) return rows;
  const children = [...new Set(rows.map((r) => r.child_ref).filter(Boolean))];
  const [named, primary, swept, vocab] = await Promise.all([
    query(`select venue_ref, name from place_records where venue_ref = any($1)`, [refs]),
    // What the child would have been filed as, which is what goes up as the
    // parent's `contains` — the thing that lets a family searching for a water
    // park find the theme park around it.
    query(`select venue_ref, would_be, words from not_sure where venue_ref = any($1)`, [children]),
    query(`select venue_ref, secondary from scout_places where venue_ref = any($1) and secondary is not null`, [children]),
    placeAttributes.attributes(),
  ]);
  const by = new Map(named.rows.map((n) => [n.venue_ref, n.name]));
  const filed = new Map(primary.rows.map((n) => [n.venue_ref, n.would_be]));
  const wordsOf = new Map(primary.rows.map((n) => [n.venue_ref, (n.words ?? []).map((w) => `google:${w}`)]));
  const sweptSays = new Map(swept.rows.map((n) => [n.venue_ref, n.secondary ?? {}]));
  // Resolved the way rollUp() resolves, not read off the raw tables: a label a
  // child *inherits* from its drawer, or one another label brought it, travels
  // up too, and an inactive one does not (Codex, 15 Sep 2026).
  const own = new Map();
  for (const ref of children) own.set(ref, await placeAttributes.valuesFor(ref));
  return rows.map((r) => {
    const resolved = placeAttributes.resolveFor(
      { subcategory: filed.get(r.child_ref) ?? null, words: wordsOf.get(r.child_ref) ?? [], alsoTrue: sweptSays.get(r.child_ref) ?? null },
      own.get(r.child_ref) ?? new Map(), vocab,
    );
    return {
      ...r,
      child_name: by.get(r.child_ref) ?? null,
      parent_name: by.get(r.parent_ref) ?? null,
      // Exactly what the parent gains, named *with its value* rather than
      // described: "Suits ages 0 to 12", not "Suits ages" (the handoff, BO11).
      goes_up: {
        primary: filed.get(r.child_ref) ?? null,
        secondary: Object.entries(resolved).map(([key, v]) => ({
          key,
          label: vocab.byKey.get(key)?.label ?? key,
          value: v,
        })),
      },
    };
  });
}

/**
 * Drop anything that is part of something else from a list of places.
 *
 * The parent is left exactly where it was. Where a child is in the list and its
 * parent is not — the search reached the water park but not the theme park
 * around it — the child is still dropped, because showing it would be showing
 * the thing he asked never to see on its own.
 */
export function withoutParts(places, childToParent, refOf = (p) => p.venueRef) {
  if (!childToParent?.size) return places ?? [];
  return (places ?? []).filter((p) => !childToParent.has(refOf(p)));
}

/**
 * Give the parent what its children knew, before the children are dropped.
 *
 * The owner, 14 Sep 2026: "it appears in theme park, and we have an attribute
 * of that theme park to say it has a water park." Hiding Amity Beach is only
 * half of it; Thorpe Park has to come away knowing there is a water park in it,
 * or the knowledge is simply thrown away (Codex, 14 Sep 2026).
 *
 * The parent's own answers always win. A child only ever adds.
 */
export function rollUp(places, childToParent, refOf = (p) => p.venueRef) {
  if (!childToParent?.size) return places ?? [];
  const byRef = new Map((places ?? []).map((p) => [refOf(p), p]));
  for (const child of places ?? []) {
    const parent = byRef.get(childToParent.get(refOf(child)) ?? '');
    if (!parent || parent === child) continue;
    // What is inside it, named by the drawer each child is in, so a theme park
    // with a water park in it can be found by somebody looking for one.
    if (child.subcategory) {
      parent.contains = [...new Set([...(parent.contains ?? []), child.subcategory])];
    }
    for (const m of child.moods ?? []) if (!(parent.moods ?? []).includes(m)) parent.moods = [...(parent.moods ?? []), m];
    // The child's experiences too. Those are the closed vocabulary voice is
    // interpreted against, so without them "somewhere with a gallery" would not
    // reach the house that has one: a drawer key and a spoken word are two
    // different vocabularies (Codex, 14 Sep 2026).
    for (const e of child.experiences ?? []) {
      if (!(parent.experiences ?? []).includes(e)) parent.experiences = [...(parent.experiences ?? []), e];
    }
    // Attributes the parent has nothing to say about. Its own always stand.
    parent.attrs = { ...(child.attrs ?? {}), ...(parent.attrs ?? {}) };
    if (parent.indoor == null && child.indoor != null) parent.indoor = child.indoor;
    if (parent.forKids == null && child.forKids != null) parent.forKids = child.forKids;
  }
  return places ?? [];
}
