// A machine look at each owned picture (owner, 2 Oct 2026, Photo review).
//
// "Machine quality check per owned image (Claude vision, cheapest model that
// does the job, stored with the image, purpose claude.photo_fitness). Each
// check is yes / no / don't know with a one-line reason … The result is Fit /
// Borderline / Not fit … Until the agreement rate is proven, my verdict still
// decides publishing. The machine only sorts the queue: Not fit last."
//
// So nothing here publishes, rejects or moves a picture. It writes one row per
// picture in photo_fitness, and Photo review reads it to sort and to show the
// agreement between the machine and the owner.
//
// The model is Haiku 4.5, the cheapest with vision. It sees the picture, the
// place's name and kind, and answers six closed questions. One half of one
// question is not its to answer: "at least 1200 px on the long edge" is a fact
// we hold (the picture's size) and is decided here from that, not guessed from
// a thumbnail.

import { z } from 'zod';
import { query } from '../db.js';
import { parseStructured } from '../claude.js';
import * as lib from '../repositories/library.js';
import { fetchPublicPicture } from './safeFetch.js';

export const PURPOSE = 'claude.photo_fitness';
export const MODEL = 'claude-haiku-4-5';
/** What one picture is priced at before a bulk run: about 2,000 tokens in and 300 out on Haiku, rounded up. */
export const PENCE_PER_PICTURE = 0.4;
const MIN_LONG_EDGE = 1200;

export const CHECKS = [
  { key: 'actual_place', label: 'Is it the actual place?' },
  { key: 'what_visitors_want', label: 'Does it show what a visitor wants?' },
  { key: 'sharp_lit_size', label: 'Sharp, well lit, at least 1200 px on the long edge?' },
  { key: 'crops', label: 'Works as a 4:3 and 1:1 crop?' },
  { key: 'clean', label: 'No watermark, text, or people as the subject?' },
  { key: 'current', label: 'Looks current?' },
];

const Answer = z.enum(['yes', 'no', 'unknown']);
const Reply = z.object({
  actual_place: z.object({ answer: Answer, reason: z.string() }),
  what_visitors_want: z.object({ answer: Answer, reason: z.string() }),
  sharp_and_well_lit: z.object({ answer: Answer, reason: z.string() }),
  crops: z.object({ answer: Answer, reason: z.string() }),
  clean: z.object({ answer: Answer, reason: z.string() }),
  current: z.object({ answer: Answer, reason: z.string() }),
});

const SYSTEM = `You judge one photograph for a family day-out app's card of a venue. Answer each question "yes", "no" or "unknown", with one short reason (under 15 words). Say "unknown" when the picture cannot settle it.

- actual_place: is this plausibly a photograph of this specific venue (its building, grounds, interior, food or activity), not the town in general, a different venue, a map or only a logo?
- what_visitors_want: does it show what a visitor would want to see — the entrance or outside, the inside, the food, or the activity itself?
- sharp_and_well_lit: is it in focus and well exposed?
- crops: would the subject survive a 4:3 crop and a square 1:1 crop?
- clean: is it free of watermarks, overlaid text, and people as the main subject?
- current: does it look current (no obviously dated signage, branding or film-era quality)?`;

/** Join the model's sharpness answer with the size we hold. Pure. */
export function sizeCheck(model, longEdge) {
  if (Number.isFinite(longEdge) && longEdge > 0 && longEdge < MIN_LONG_EDGE) {
    return { answer: 'no', reason: `${longEdge} px on the long edge, under ${MIN_LONG_EDGE}` };
  }
  if (model.answer === 'no') return model;
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    return { answer: 'unknown', reason: `size not known; ${model.reason}` };
  }
  return model.answer === 'yes' ? { answer: 'yes', reason: `${longEdge} px; ${model.reason}` } : model;
}

/**
 * Fit / Borderline / Not fit from the six answers. Pure.
 *
 * Not fit: it is not the place, or it is spoiled (watermark, text, a person as
 * the subject), or two or more checks fail. Fit: it is the place and nothing
 * fails, with at most one "don't know". Everything else is Borderline.
 */
export function verdictOf(checks) {
  const by = Object.fromEntries(checks.map((c) => [c.key, c.answer]));
  const nos = checks.filter((c) => c.answer === 'no').length;
  const unknowns = checks.filter((c) => c.answer === 'unknown').length;
  if (by.actual_place === 'no' || by.clean === 'no' || nos >= 2) return 'not_fit';
  if (by.actual_place === 'yes' && nos === 0 && unknowns <= 1) return 'fit';
  return 'borderline';
}

/** The bytes and the long edge of a picture, ours or the venue's. */
async function pictureOf({ imageId, imageUrl }) {
  if (imageId) {
    const img = await lib.imageById(imageId);
    const variant = await lib.variantFor(imageId, 960);
    if (!img || !variant?.body) return null;
    return { body: variant.body, mime: variant.mime ?? 'image/jpeg', longEdge: Math.max(Number(img.width) || 0, Number(img.height) || 0) || null };
  }
  // A venue's picture address came off somebody else's page: fetched only from
  // a public address, pinned, every redirect re-checked (sources/safeFetch.js).
  const pic = await fetchPublicPicture(imageUrl);
  if (!pic) return null;
  return { body: pic.body, mime: pic.mime, longEdge: Math.max(Number(pic.width) || 0, Number(pic.height) || 0) || null };
}

/**
 * Look at one picture and write what the machine made of it. Returns the row,
 * or `{ skipped: why }` when there was no picture to look at — never a verdict
 * invented for a picture nobody saw.
 */
export async function scorePicture({ venueRef, imageId = null, imageUrl = null, name = null, category = null, householdId = null }, deps = {}) {
  const pic = await (deps.pictureOf ?? pictureOf)({ imageId, imageUrl });
  if (!pic) return { skipped: 'no_picture' };
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(pic.mime)) return { skipped: `unsupported_${pic.mime}` };
  const meta = {};
  const reply = await (deps.parseStructured ?? parseStructured)({
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: pic.mime, data: pic.body.toString('base64') } },
        { type: 'text', text: `Venue: ${name ?? 'unknown name'}${category ? ` (${category})` : ''}.` },
      ],
    }],
    schema: Reply,
    householdId, sessionId: null, purpose: PURPOSE, model: MODEL, maxTokens: 800, meta,
  });
  const checks = [
    { key: 'actual_place', ...reply.actual_place },
    { key: 'what_visitors_want', ...reply.what_visitors_want },
    { key: 'sharp_lit_size', ...sizeCheck(reply.sharp_and_well_lit, pic.longEdge) },
    { key: 'crops', ...reply.crops },
    { key: 'clean', ...reply.clean },
    { key: 'current', ...reply.current },
  ].map((c) => ({ ...c, reason: String(c.reason ?? '').slice(0, 160) }));
  const verdict = verdictOf(checks);
  const args = [venueRef, imageId, imageId ? null : imageUrl, verdict, JSON.stringify(checks), MODEL, meta.costUsd ?? null];
  const { rows } = imageId
    ? await query(
      `insert into photo_fitness (venue_ref, image_id, image_url, verdict, checks, model, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (image_id) where image_id is not null do update set
         venue_ref = excluded.venue_ref, verdict = excluded.verdict, checks = excluded.checks,
         model = excluded.model, cost_usd = excluded.cost_usd, checked_at = now()
       returning *`, args)
    : await query(
      `insert into photo_fitness (venue_ref, image_id, image_url, verdict, checks, model, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (venue_ref, image_url) where image_id is null do update set
         verdict = excluded.verdict, checks = excluded.checks,
         model = excluded.model, cost_usd = excluded.cost_usd, checked_at = now()
       returning *`, args);
  return rows[0];
}

/**
 * The pictures not yet looked at: ours in the library (not turned down) and the
 * venue-site ones held by address. `venueRef` narrows it to one place.
 */
export async function unscored({ venueRef = null, limit = 1000 } = {}) {
  const { rows } = await query(
    `select * from (
       select l.subject_id as venue_ref, i.id as image_id, null::text as image_url, r.name, r.category
         from image_links l join image_assets i on i.id = l.image_id
         left join place_records r on r.venue_ref = l.subject_id
        where l.subject_type = 'place' and i.moderation <> 'rejected'
          and not exists (select 1 from photo_fitness f where f.image_id = i.id)
       union all
       select v.venue_ref, null::uuid, v.image_url, r.name, r.category
         from venue_site_images v left join place_records r on r.venue_ref = v.venue_ref
        where not exists (select 1 from photo_fitness f where f.image_id is null and f.venue_ref = v.venue_ref and f.image_url = v.image_url)
     ) x
     where $1::text is null or x.venue_ref = $1
     order by venue_ref
     limit $2`, [venueRef, limit]);
  return rows;
}

/**
 * Look at every unscored picture of one place, one after another. Never
 * throws: a picture that fails is left unscored for the next look.
 */
export async function scorePlace(venueRef, { householdId = null } = {}, deps = {}) {
  const todo = await unscored({ venueRef, limit: 12 });
  let scored = 0; let failed = 0;
  for (const p of todo) {
    try {
      const out = await scorePicture({ venueRef, imageId: p.image_id, imageUrl: p.image_url, name: p.name, category: p.category, householdId }, deps);
      if (!out.skipped) scored += 1;
    } catch { failed += 1; }
  }
  return { scored, failed, looked: todo.length };
}

/**
 * Every unscored picture, one after another, for the back office's priced
 * press. Refused unless handed the count its quote showed.
 */
export async function scoreAll({ householdId, expectPictures }, deps = {}) {
  const todo = await unscored({ limit: 5000 });
  if (Number(expectPictures) !== todo.length) return { started: false, why: 'quote_changed', pictures: todo.length };
  (async () => {
    for (const p of todo) {
      try { await scorePicture({ venueRef: p.venue_ref, imageId: p.image_id, imageUrl: p.image_url, name: p.name, category: p.category, householdId }, deps); } catch { /* left for the next look */ }
    }
  })().catch(() => null);
  return { started: true, pictures: todo.length };
}

const RANK = { fit: 0, borderline: 1, not_fit: 2 };
/** The place's best machine verdict, from its pictures' rows. Pure. */
export const bestVerdict = (verdicts) => (verdicts.filter(Boolean).sort((a, b) => RANK[a] - RANK[b])[0] ?? null);

/** The owner's verdict in the machine's words, for the agreement rate. */
export const OWNER_TO_MACHINE = { owned_fine: 'fit', owned_worse_acceptable: 'borderline', owned_not_fit: 'not_fit' };
