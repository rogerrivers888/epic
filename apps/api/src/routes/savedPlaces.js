// Back office › Places › Saved places and Photo review (owner, 2 Oct 2026,
// "Saved places — photos and enrichment", Parts 2 and 3, revised 16:45).
//
//   GET  /api/admin/saved-places               every place the owner added, with
//                                              where its research has got to
//   GET  /api/admin/saved-places/place?ref=    one place: what was found, on which
//                                              page, the cost, the pictures
//   POST /api/admin/saved-places/rerun         research it again (paid; the owner
//                                              personally signed in)
//
//   GET  /api/admin/photo-review?q=&category=&reviewed=
//                                              places with owned pictures, searchable
//   POST /api/admin/photo-review/compare       Google's photographs, live, on the
//                                              click and only then (purpose
//                                              admin.photo_compare); nothing stored
//   POST /api/admin/photo-review/verdict       the owner's verdict on a place
//
// Google's photographs are rented: the compare call returns references signed
// for this sign-in, drawn through /api/photos/google like every other rented
// picture, and nothing about them is written down. The verdict is ours.

import express from 'express';
import { requires, requireOwnerSignedIn } from '../access.js';
import { query } from '../db.js';
import { currentAccount } from '../context.js';
import { currentHousehold } from './household.js';
import { googleSource } from '../sources/google.js';
import { sourceOff } from '../sources/switches.js';
import { recordProviderCall } from '../repositories/visits.js';
import { healthOf } from '../sources/meter.js';
import { stampImage } from '../sources/photoLinks.js';
import { enrichmentList, enrichmentSummary, enrichmentOf, rerun, backfill, backfillCandidates, isEnrichAccount, TARGET_PENCE, PURPOSE as ENRICH_PURPOSE } from '../sources/savedEnrich.js';
import { venuePicturesOf } from '../sources/venueImages.js';
import { USD_TO_GBP, PRICE_PER_UNIT_USD } from '../domain/providerPrices.js';

export const savedPlacesRouter = express.Router();
export const photoReviewRouter = express.Router();

const bad = (message, code = 'bad_request') => Object.assign(new Error(message), { status: 400, code });
const pence = (usd) => (usd == null ? null : Math.round(Number(usd) * USD_TO_GBP * 1000) / 10);
const VERDICTS = ['owned_fine', 'owned_worse_acceptable', 'owned_not_fit'];
// What one Compare costs at most, said before the click: one Place Details
// photo request, and the three photographs it returns drawn once each.
const COMPARE_PHOTOS = 3;
export const comparePence = () => pence(PRICE_PER_UNIT_USD['google-pro'] + COMPARE_PHOTOS * PRICE_PER_UNIT_USD['google-photos']);

/**
 * The pictures we hold for a place, pending ones included, each with a link
 * signed for this sign-in so a picture still waiting for a look can be drawn
 * here and nowhere else (routes/library.js).
 */
async function ownedPicturesOf(venueRef) {
  const { rows } = await query(
    `select i.id, i.source, i.licence, i.licence_url, i.creator, i.credit_line, i.source_page_url,
            i.attribution_required, i.moderation, i.width, i.height, i.lqip, l.role, l.position
       from image_links l join image_assets i on i.id = l.image_id
      where l.subject_type = 'place' and l.subject_id = $1 and i.moderation <> 'rejected'
      order by (l.role = 'hero') desc, l.position, i.fetched_at`, [venueRef]);
  return rows.map((r) => {
    const signed = r.moderation === 'approved' ? { id: r.id } : stampImage({ id: r.id });
    return {
      id: r.id, source: r.source, role: r.role, moderation: r.moderation,
      licence: r.licence, licenceUrl: r.licence_url, creator: r.creator, credit: r.credit_line,
      sourceUrl: r.source_page_url, creditRequired: r.attribution_required,
      width: r.width, height: r.height, lqip: r.lqip,
      ...(signed.sig ? { sig: signed.sig, exp: signed.exp } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Part 2: saved places and their research
// ---------------------------------------------------------------------------

savedPlacesRouter.get('/', requires('view_library'), async (_req, res, next) => {
  try {
    const [all, sum] = await Promise.all([enrichmentList({ limit: 500 }), enrichmentSummary()]);
    const rows = all.slice(0, 500);
    const has = (r, f) => {
      const v = r.found?.fields?.[f];
      return Boolean(v && v.value && v.source !== 'unknown');
    };
    const pics = (r) => Number(r.found?.pictures?.openverse?.stored ?? 0) + Number(r.found?.pictures?.venueSite?.kept ?? 0);
    const rate = (n) => (sum.done ? Math.round((n / sum.done) * 100) : null);
    res.json({
      places: rows.map((r) => ({
        venueRef: r.venue_ref, name: r.name, category: r.category, state: r.state,
        requestedAt: r.requested_at, lastRunAt: r.last_run_at, runs: r.runs,
        costPence: pence(r.cost_usd), lastCostPence: pence(r.last_cost_usd),
        website: has(r, 'website'), menu: has(r, 'menu_url'), pictures: pics(r), error: r.error,
      })),
      more: all.length > 500,
      // The brief's measures over every finished pass (uncapped), withheld
      // (null) until there is one — never a nought for "not yet".
      summary: {
        done: sum.done,
        websitePct: rate(sum.website),
        menuPct: rate(sum.menu),
        ownedImagePct: rate(sum.pictured),
        avgCostPence: sum.paid ? Math.round(sum.avg_cost_usd * USD_TO_GBP * 1000) / 10 : null,
        paidPasses: sum.paid,
        purpose: ENRICH_PURPOSE,
      },
    });
  } catch (err) { next(err); }
});

savedPlacesRouter.get('/place', requires('view_library'), async (req, res, next) => {
  try {
    const ref = String(req.query.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.');
    const [row, venuePictures, owned, review] = await Promise.all([
      enrichmentOf(ref), venuePicturesOf(ref), ownedPicturesOf(ref),
      query('select verdict, note, reviewed_at from photo_reviews where venue_ref = $1', [ref]).then((r) => r.rows[0] ?? null),
    ]);
    res.json({
      venueRef: ref,
      enrichment: row ? {
        state: row.state, requestedAt: row.requested_at, freeDoneAt: row.free_done_at, claudeDoneAt: row.claude_done_at,
        lastRunAt: row.last_run_at, runs: row.runs, costPence: pence(row.cost_usd), lastCostPence: pence(row.last_cost_usd),
        found: row.found, error: row.error,
      } : null,
      // Unlicensed: the venue's own pictures, by address, for this screen and
      // the owner's account only. Drawn straight from the venue's server.
      venuePictures: venuePictures.map((v) => ({ url: v.image_url, pageUrl: v.page_url, how: v.found_how, foundAt: v.found_at, licence: v.licence_status })),
      ownedPictures: owned,
      review,
    });
  } catch (err) { next(err); }
});

savedPlacesRouter.post('/rerun', requires('manage_library'), requireOwnerSignedIn('research a saved place again'), async (req, res, next) => {
  try {
    const ref = String(req.body?.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.');
    const household = await currentHousehold();
    const out = await rerun(ref, { account: currentAccount(), householdId: household.id, sessionId: req.session?.id ?? null });
    res.status(out.started ? 202 : 409).json(out);
  } catch (err) { next(err); }
});

/**
 * The owner's places already in Places, not yet researched, priced before the
 * click at the brief's 12p target each. Only the enrolled account has any.
 */
savedPlacesRouter.get('/backfill/quote', requires('view_library'), async (_req, res, next) => {
  try {
    const account = currentAccount();
    if (!isEnrichAccount(account)) return res.json({ places: 0, pence: 0, enrolled: false });
    const household = await currentHousehold();
    const refs = await backfillCandidates(household.id);
    res.json({ places: refs.length, pence: refs.length * TARGET_PENCE, perPlacePence: TARGET_PENCE, enrolled: true });
  } catch (err) { next(err); }
});

savedPlacesRouter.post('/backfill', requires('manage_library'), requireOwnerSignedIn('research your saved places'), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const out = await backfill({ account: currentAccount(), householdId: household.id, sessionId: req.session?.id ?? null, expectPlaces: req.body?.expectPlaces });
    if (out.why === 'quote_changed') return res.status(409).json({ error: 'quote_changed', message: `There are ${out.places} places now — price it again.`, places: out.places });
    if (out.why) return res.status(403).json({ error: out.why });
    res.status(202).json(out);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Part 3: photo review
// ---------------------------------------------------------------------------

photoReviewRouter.get('/', requires('view_library'), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const category = String(req.query.category ?? '').trim() || null;
    const reviewed = ['yes', 'no'].includes(req.query.reviewed) ? req.query.reviewed : null;
    const args = [];
    // Any picture of ours: one in the library, or one on the venue's own site
    // held by address (Codex, 2 Oct 2026 — those count too, and must be findable).
    const anyPicture = `(exists (select 1 from image_links l join image_assets i on i.id = l.image_id
                             where l.subject_type = 'place' and l.subject_id = r.venue_ref and i.moderation <> 'rejected')
                         or exists (select 1 from venue_site_images v where v.venue_ref = r.venue_ref))`;
    const where = [anyPicture];
    if (q) { args.push(`%${q}%`); where.push(`r.name ilike $${args.length}`); }
    if (category) { args.push(category); where.push(`r.category = $${args.length}`); }
    if (reviewed === 'yes') where.push('pr.venue_ref is not null');
    if (reviewed === 'no') where.push('pr.venue_ref is null');
    const { rows } = await query(
      `select r.venue_ref, r.name, r.category, r.postcode, pr.verdict, pr.reviewed_at,
              (select count(*) from image_links l join image_assets i on i.id = l.image_id
                where l.subject_type = 'place' and l.subject_id = r.venue_ref and i.moderation <> 'rejected')
              + (select count(*) from venue_site_images v where v.venue_ref = r.venue_ref) as pictures
         from place_records r left join photo_reviews pr on pr.venue_ref = r.venue_ref
        where ${where.join(' and ')}
        order by (pr.venue_ref is null) desc, r.name nulls last
        limit 201`, args);
    // Over every place with owned pictures, whatever the filter: the numbers
    // the owner's policy call is made from.
    const { rows: [sum] } = await query(
      `select count(*)::int as places,
              count(pr.venue_ref)::int as reviewed,
              count(*) filter (where pr.verdict = 'owned_fine')::int as fine,
              count(*) filter (where pr.verdict = 'owned_worse_acceptable')::int as acceptable,
              count(*) filter (where pr.verdict = 'owned_not_fit')::int as not_fit
         from place_records r left join photo_reviews pr on pr.venue_ref = r.venue_ref
        where ${anyPicture}`);
    // A capped list says what it found, not what is absent (CLAUDE.md).
    res.json({
      summary: sum,
      places: rows.slice(0, 200).map((r) => ({ venueRef: r.venue_ref, name: r.name, category: r.category, postcode: r.postcode, pictures: Number(r.pictures), verdict: r.verdict, reviewedAt: r.reviewed_at })),
      more: rows.length > 200,
      comparePence: comparePence(),
    });
  } catch (err) { next(err); }
});

/**
 * Google's photographs of one place, beside ours. A live Place Details photo
 * request, made on the click and only then, ledgered as admin.photo_compare.
 * The references come back signed for this sign-in and are drawn through the
 * rented-photo route; none of it is written down.
 */
photoReviewRouter.post('/compare', requires('view_library'), requireOwnerSignedIn('fetch Google photographs to compare'), async (req, res, next) => {
  try {
    const ref = String(req.body?.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.');
    const owned = await ownedPicturesOf(ref);
    const venuePictures = (await venuePicturesOf(ref)).map((v) => ({ url: v.image_url, pageUrl: v.page_url }));
    const [source, ...rest] = ref.split(':');
    if (source !== 'google') return res.json({ venueRef: ref, google: [], googleWhy: 'not_a_google_place', owned, venuePictures });
    if (sourceOff('google')) return res.json({ venueRef: ref, google: [], googleWhy: 'google_off', owned, venuePictures });
    const household = await currentHousehold();
    const meter = {};
    let google = null;
    try {
      google = await googleSource.photos(rest.join(':'), { meter });
    } finally {
      if (Object.keys(meter).length || healthOf(meter).failed) {
        await recordProviderCall(household.id, 'google', 'admin.photo_compare', meter, ref).catch(() => null);
      }
    }
    res.json({ venueRef: ref, google: google ?? [], googleWhy: google ? null : 'no_photos', owned, venuePictures });
  } catch (err) { next(err); }
});

photoReviewRouter.post('/verdict', requires('manage_library'), requireOwnerSignedIn('give a photo verdict'), async (req, res, next) => {
  try {
    const ref = String(req.body?.ref ?? '').trim();
    const verdict = String(req.body?.verdict ?? '');
    if (!ref) throw bad('Which place? Pass its ref.');
    if (!VERDICTS.includes(verdict)) throw bad(`A verdict is one of ${VERDICTS.join(', ')}.`);
    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
    const { rows } = await query(
      `insert into photo_reviews (venue_ref, verdict, note, reviewed_by)
       values ($1, $2, $3, $4)
       on conflict (venue_ref) do update set verdict = excluded.verdict, note = excluded.note,
         reviewed_by = excluded.reviewed_by, reviewed_at = now()
       returning venue_ref, verdict, note, reviewed_at`,
      [ref, verdict, note, currentAccount()?.id ?? null]);
    // The verdict settles the pictures that were waiting for it (Codex, 2 Oct
    // 2026). Only the ones found for a saved place (Openverse): a household's
    // own upload waits for its own look, and is not decided here. Fine or
    // acceptable publishes them, and the first becomes the card picture where
    // the place has none; not fit turns them down.
    const accept = verdict !== 'owned_not_fit';
    const { rows: settled } = await query(
      `update image_assets i set moderation = $2, updated_at = now()
         from image_links l
        where l.image_id = i.id and l.subject_type = 'place' and l.subject_id = $1
          and i.source = 'openverse' and i.moderation = 'pending'
        returning i.id, l.position`, [ref, accept ? 'approved' : 'rejected']);
    let hero = null;
    if (accept && settled.length) {
      const { rows: [has] } = await query(
        `select 1 from image_links l join image_assets i on i.id = l.image_id
          where l.subject_type = 'place' and l.subject_id = $1 and l.role = 'hero' and i.moderation <> 'rejected' limit 1`, [ref]);
      if (!has) {
        hero = settled.sort((a, b) => a.position - b.position)[0].id;
        await query(`update image_links set role = 'hero' where image_id = $1 and subject_type = 'place' and subject_id = $2`, [hero, ref]);
      }
    }
    res.json({ ...rows[0], settled: settled.length, hero });
  } catch (err) { next(err); }
});
