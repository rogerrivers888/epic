/**
 * /api/collections — the collections a signed-in household sees in Inspire
 * (back-office handover 4.11, D6–D11; the prototype's household phone).
 *
 *   GET  /              the rows this household would see, in the prototype's
 *                       two orders (`inspire`, `list`), each with its shelf
 *   POST /:key/heart    { on, member? } — heart a collection, or take it back
 *
 * **Whose list is this.** A heart belongs to a person (migration 225). An
 * account that is somebody's own (`accounts.member_id`) is always that person
 * and is never asked. Otherwise the device says who is holding it — `?as=` on
 * the read, `member` on a heart — which is the answer to "Whose list is
 * this?", asked on the first heart and kept on the device, because the same
 * household shares phones and each phone is somebody's. A heart with nobody
 * named is refused as `whose_list`, never guessed.
 *
 * Owned tables only — browse_rows, place_index and our own records and
 * pictures — so nothing here asks a provider, and nothing here spends. The
 * judging is `desk/collections.js`, the same code the back office's "See as a
 * household" reads, so the preview is what a family gets.
 */

import { Router } from 'express';
import { currentHousehold } from './household.js';
import { currentAccount } from '../context.js';
import { query } from '../db.js';
import * as collections from '../desk/collections.js';

export const collectionRoutes = Router();

/**
 * Who is looking: the account's own person, else the member the device named
 * if they are in this household, else nobody yet. A name that is not in this
 * household is nobody — the device forgets it and asks again.
 */
async function viewerOf(householdId, said) {
  const own = currentAccount()?.member_id ?? null;
  if (own) return { id: own, fixed: true };
  if (!said) return { id: null, fixed: false };
  const { rows: [m] } = await query('select id from members where id = $1 and household_id = $2', [String(said), householdId]);
  return { id: m?.id ?? null, fixed: false };
}

collectionRoutes.get('/', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const viewer = await viewerOf(household.id, req.query.as ? String(req.query.as) : null);
    const out = await collections.familyCollections({ householdId: household.id, viewer: viewer.id });
    res.json({ ...out, whoseFixed: viewer.fixed });
  } catch (err) { next(err); }
});

collectionRoutes.post('/:key/heart', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const on = req.body?.on !== false;
    const said = req.body?.member ? String(req.body.member) : null;
    const own = currentAccount()?.member_id ?? null;
    // An account that is somebody's own hearts as them, and only them.
    if (own && said && said !== own) {
      return res.status(400).json({ error: 'bad_request', message: 'You can only heart as yourself.' });
    }
    const out = await collections.heartCollection({ householdId: household.id, key: String(req.params.key), on, memberId: own ?? said });
    res.json(out);
  } catch (err) {
    if (err.code === 'whose_list') {
      // The first heart's question, with who can answer it.
      const household = await currentHousehold().catch(() => null);
      const { rows } = household
        ? await query('select id, name from members where household_id = $1 order by created_at', [household.id])
        : { rows: [] };
      return res.status(409).json({ error: 'whose_list', message: 'Whose list is this?', members: rows });
    }
    next(err);
  }
});
