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
  if (!parentRef) {
    await query('delete from place_parts where child_ref = $1', [child]);
    forget();
    return null;
  }
  const parent = String(parentRef).trim();
  if (parent === child) {
    throw Object.assign(new Error('A place cannot be part of itself.'), { status: 400, code: 'bad_request' });
  }
  // One step only. A part of a part would need the reader to walk a chain, and
  // nothing in Epic has ever needed more than "this is inside that".
  const { rows: up } = await query(`select parent_ref from place_parts where child_ref = $1 and how = 'told'`, [parent]);
  if (up[0]) {
    throw Object.assign(new Error(`${parent} is itself part of ${up[0].parent_ref}. Name that one instead.`),
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
  return rows;
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
