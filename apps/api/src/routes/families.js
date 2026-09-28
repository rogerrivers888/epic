/**
 * /api/families — families who have visited are one of our own sources
 * (back-office handover 4.7, C42), asked one question in the rating after a
 * visit ("Epic Visit Question" board V1–V4, 28 Sep 2026).
 *
 *   GET  /question?placeId=&visitId=   { factId, question, answer, visitId, placeId } | null
 *   GET  /question?booking=            the same, for a hosted experience at a place:
 *                                      the booking stands for the visit
 *   POST /answer  { visitId, factId, answer: yes | no | unsure }
 *                                      → { visitId, factId, answer, at }; a Change
 *                                      overwrites the same record
 *
 * `answer` on the question is what this household already said to it, so the
 * rating can draw the thank-you and Change after a reload (V2/V3); null while
 * it is open (V1). A null body is V4: nothing to ask.
 *
 * Which household answered what is never shown anywhere.
 */

import { Router } from 'express';
import { currentHousehold } from './household.js';
import { query } from '../db.js';
import * as pipeline from '../desk/pipeline.js';
import { occurrenceDate } from '../domain/hosting.js';

export const familyRoutes = Router();

const refuse = (status, error, message) => Object.assign(new Error(message ?? error), { status, code: error });
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The visit a hosted booking stands for: the household's own visit to the
 * experience's place on the day, recorded now if it has none. Null when the
 * experience is at no place we know, has not happened yet, or the household
 * was never in (held, waiting, cancelled).
 */
export async function bookingVisit(householdId, bookingId) {
  const { rows: [b] } = await query(
    `select b.id, b.state, b.occurrence, o.venue_ref, o.venue_label, o.title, o.shape, o.starts_on, o.first_date
       from experience_bookings b join host_offers o on o.id = b.offer_id
      where b.id = $1 and b.household_id = $2`, [bookingId, householdId]);
  if (!b) throw refuse(404, 'not_found', 'That booking is not one of yours.');
  if (!b.venue_ref || !['confirmed', 'attended'].includes(b.state)) return null;
  const on = occurrenceDate(b, b.occurrence);
  if (!on || on >= today()) return null;
  const { rows: [had] } = await query(
    'select id from visits where household_id = $1 and venue_ref = $2 and visited_on = $3 order by created_at limit 1', [householdId, b.venue_ref, on]);
  if (had) return { visitId: had.id, placeId: b.venue_ref };
  // Keyed on the booking, so two requests at once record one visit.
  await query(
    `insert into visits (client_id, household_id, venue_ref, venue_label, visited_on)
     values ($1, $2, $3, coalesce((select name from place_records where venue_ref = $3), $4, $5, 'A hosted experience'), $6)
     on conflict (client_id) do nothing`,
    [b.id, householdId, b.venue_ref, b.venue_label, b.title, on]);
  const { rows: [v] } = await query('select id from visits where client_id = $1 and household_id = $2', [b.id, householdId]);
  return v ? { visitId: v.id, placeId: b.venue_ref } : null;
}

familyRoutes.get('/question', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    if (!household) return res.status(400).json({ error: 'no_household' });
    let visitId = String(req.query.visitId ?? req.query.visit ?? '') || null;
    let placeId = String(req.query.placeId ?? req.query.ref ?? '') || null;
    if (req.query.booking) {
      const v = await bookingVisit(household.id, String(req.query.booking));
      if (!v) return res.json(null);
      ({ visitId, placeId } = v);
    }
    // Asked only after a recorded visit: the visit is what says they were there.
    if (!visitId) return res.status(400).json({ error: 'visit_required' });
    if (!/^[0-9a-f-]{36}$/i.test(visitId)) return res.json(null);
    const q = await pipeline.visitQuestion({ householdId: household.id, visitId });
    if (!q || (placeId && q.placeId !== placeId)) return res.json(null);
    res.json(q);
  } catch (err) { next(err); }
});

familyRoutes.post('/answer', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    if (!household) return res.status(400).json({ error: 'no_household' });
    const visitId = String(req.body?.visitId ?? '');
    const factId = String(req.body?.factId ?? '');
    const answer = String(req.body?.answer ?? '');
    if (!visitId || !factId) return res.status(400).json({ error: 'visit_and_fact_required' });
    if (!/^[0-9a-f-]{36}$/i.test(visitId)) return res.status(404).json({ error: 'not_found' });
    const { rows: [v] } = await query('select venue_ref from visits where id = $1 and household_id = $2', [visitId, household.id]);
    if (!v) return res.status(404).json({ error: 'not_found' });
    const out = await pipeline.familyAnswer({ householdId: household.id, ref: v.venue_ref, fact: factId, answer });
    // The settlement is not the household's business; the answer is recorded.
    res.json({ visitId, factId, answer: out.answer, at: out.at });
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.code ?? 'refused', message: err.message });
    next(err);
  }
});

export default familyRoutes;
