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
import { query, withTransaction } from '../db.js';
import { currentAccount } from '../context.js';
import { currentHousehold } from './household.js';
import { googleSource } from '../sources/google.js';
import { sourceOff } from '../sources/switches.js';
import { recordProviderCall } from '../repositories/visits.js';
import { healthOf } from '../sources/meter.js';
import { stampReviewImage } from '../sources/photoLinks.js';
import { enrichmentList, enrichmentSummary, enrichmentOf, rerun, backfill, backfillCandidates, isEnrichAccount, TARGET_PENCE, PURPOSE as ENRICH_PURPOSE } from '../sources/savedEnrich.js';
import { venuePicturesOf } from '../sources/venueImages.js';
import { unscored, scoreAll, PENCE_PER_PICTURE, CHECKS } from '../sources/photoFitness.js';
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
/** The venue's own pictures (by address), each with the machine's look if it has had one. */
async function venuePicturesWithFitness(venueRef) {
  const [pics, { rows: fit }] = await Promise.all([
    venuePicturesOf(venueRef),
    query(`select image_url, verdict, checks from photo_fitness where venue_ref = $1 and image_id is null`, [venueRef]),
  ]);
  const by = new Map(fit.map((f) => [f.image_url, { verdict: f.verdict, checks: f.checks }]));
  return pics.map((v) => ({ url: v.image_url, pageUrl: v.page_url, how: v.found_how, foundAt: v.found_at, licence: v.licence_status, fitness: by.get(v.image_url) ?? null }));
}

async function ownedPicturesOf(venueRef) {
  const { rows } = await query(
    `select i.id, i.source, i.licence, i.licence_url, i.creator, i.credit_line, i.source_page_url,
            i.attribution_required, i.moderation, i.width, i.height, i.lqip, l.role, l.position,
            f.verdict as fitness, f.checks as fitness_checks
       from image_links l join image_assets i on i.id = l.image_id
       left join photo_fitness f on f.image_id = i.id and f.venue_ref = l.subject_id
      where l.subject_type = 'place' and l.subject_id = $1
      -- Turned-down pictures too: a place judged not fit stays in the review so
      -- its verdict can be changed, and the owner must see what he is
      -- reconsidering (Codex, 2 Oct 2026). Drawn on a signed link, here only.
      order by (i.moderation = 'rejected'), (l.role = 'hero') desc, l.position, i.fetched_at`, [venueRef]);
  return rows.map((r) => {
    const signed = r.moderation === 'approved' ? { id: r.id } : stampReviewImage({ id: r.id });
    return {
      id: r.id, source: r.source, role: r.role, moderation: r.moderation,
      licence: r.licence, licenceUrl: r.licence_url, creator: r.creator, credit: r.credit_line,
      sourceUrl: r.source_page_url, creditRequired: r.attribution_required,
      width: r.width, height: r.height, lqip: r.lqip,
      fitness: r.fitness ? { verdict: r.fitness, checks: r.fitness_checks } : null,
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
        avgCostPerPlacePence: sum.researched ? Math.round(sum.avg_cost_per_place_usd * USD_TO_GBP * 1000) / 10 : null,
        totalCostPence: Math.round(sum.total_cost_usd * USD_TO_GBP * 1000) / 10,
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
      enrichmentOf(ref), venuePicturesWithFitness(ref), ownedPicturesOf(ref),
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
      venuePictures,
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
    res.status(out.started ? 202 : out.why === 'not_found' ? 404 : 409).json(out);
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

// Reviewed means a verdict, and no picture found for the place since it was
// given: a re-run that finds a new one reopens the review (Codex, 2 Oct 2026).
const REVIEWED = `(pr.venue_ref is not null and not exists (
                    select 1 from image_links l join image_assets i on i.id = l.image_id
                     where l.subject_type = 'place' and l.subject_id = r.venue_ref
                       and i.moderation <> 'rejected' and greatest(i.fetched_at, l.created_at) > pr.reviewed_at)
                  and not exists (
                    select 1 from venue_site_images v
                     where v.venue_ref = r.venue_ref and v.found_at > pr.reviewed_at))`;

// A place's best machine verdict over its pictures (sources/photoFitness.js).
// Only pictures the place still holds: a verdict on one since removed from the
// venue's page, or unlinked, says nothing about the place now (Codex, 2 Oct 2026).
const HELD_FITNESS = `(f.image_id is not null and exists (select 1 from image_links l where l.image_id = f.image_id and l.subject_type = 'place' and l.subject_id = f.venue_ref))
                      or (f.image_id is null and exists (select 1 from venue_site_images v where v.venue_ref = f.venue_ref and v.image_url = f.image_url))`;
const MACHINE = `(select f.verdict from photo_fitness f where f.venue_ref = r.venue_ref and (${HELD_FITNESS})
                   order by case f.verdict when 'fit' then 0 when 'borderline' then 1 else 2 end limit 1)`;

photoReviewRouter.get('/', requires('view_library'), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const category = String(req.query.category ?? '').trim() || null;
    const reviewed = ['yes', 'no'].includes(req.query.reviewed) ? req.query.reviewed : null;
    const args = [];
    // Any picture of ours: one in the library, or one on the venue's own site
    // held by address (Codex, 2 Oct 2026 — those count too, and must be findable).
    // A turned-down picture still counts here: a place judged not fit stays in
    // the review, where its verdict can be changed (Codex, 2 Oct 2026).
    const anyPicture = `(exists (select 1 from image_links l join image_assets i on i.id = l.image_id
                             where l.subject_type = 'place' and l.subject_id = r.venue_ref)
                         or exists (select 1 from venue_site_images v where v.venue_ref = r.venue_ref))`;
    const where = [anyPicture];
    if (q) { args.push(`%${q}%`); where.push(`r.name ilike $${args.length}`); }
    if (category) { args.push(category); where.push(`r.category = $${args.length}`); }
    if (reviewed === 'yes') where.push(REVIEWED);
    if (reviewed === 'no') where.push(`not ${REVIEWED}`);
    const { rows } = await query(
      `select r.venue_ref, r.name, r.category, r.postcode, pr.verdict, pr.reviewed_at, ${MACHINE} as machine,
              -- Every picture the review shows, turned-down ones included.
              (select count(*) from image_links l where l.subject_type = 'place' and l.subject_id = r.venue_ref)
              + (select count(*) from venue_site_images v where v.venue_ref = r.venue_ref) as pictures
         from place_records r left join photo_reviews pr on pr.venue_ref = r.venue_ref
        where ${where.join(' and ')}
        -- Not yet reviewed first; within that, the machine's best guess first and
        -- its Not fit last. The machine sorts the queue and decides nothing
        -- (owner, 2 Oct 2026).
        order by ${REVIEWED} asc,
                 case ${MACHINE} when 'fit' then 0 when 'borderline' then 1 when 'not_fit' then 3 else 2 end,
                 r.name nulls last
        limit 201`, args);
    // Over every place with owned pictures, whatever the filter: the numbers
    // the owner's policy call is made from.
    const { rows: [sum] } = await query(
      `select count(*)::int as places,
              count(*) filter (where ${REVIEWED})::int as reviewed,
              count(*) filter (where ${REVIEWED} and pr.verdict = 'owned_fine')::int as fine,
              count(*) filter (where ${REVIEWED} and pr.verdict = 'owned_worse_acceptable')::int as acceptable,
              count(*) filter (where ${REVIEWED} and pr.verdict = 'owned_not_fit')::int as not_fit,
              count(*) filter (where ${MACHINE} is not null)::int as scored,
              count(*) filter (where ${REVIEWED} and ${MACHINE} is not null)::int as both,
              count(*) filter (where ${REVIEWED} and ${MACHINE} = case pr.verdict
                when 'owned_fine' then 'fit' when 'owned_worse_acceptable' then 'borderline' else 'not_fit' end)::int as agree
         from place_records r left join photo_reviews pr on pr.venue_ref = r.venue_ref
        where ${anyPicture}`);
    // Agreement between the owner and the machine, over the places both have
    // judged; withheld until there are any (CLAUDE.md, can't speak).
    sum.agreementPct = sum.both ? Math.round((sum.agree / sum.both) * 100) : null;
    // A capped list says what it found, not what is absent (CLAUDE.md).
    res.json({
      summary: sum,
      places: rows.slice(0, 200).map((r) => ({ venueRef: r.venue_ref, name: r.name, category: r.category, postcode: r.postcode, pictures: Number(r.pictures), verdict: r.verdict, reviewedAt: r.reviewed_at, machine: r.machine })),
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
    const venuePictures = await venuePicturesWithFitness(ref);
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
    // All or nothing: the verdict and what it does to the pictures land
    // together, or not at all (Codex, 2 Oct 2026).
    const out = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `insert into photo_reviews (venue_ref, verdict, note, reviewed_by)
         values ($1, $2, $3, $4)
         on conflict (venue_ref) do update set verdict = excluded.verdict, note = excluded.note,
           reviewed_by = excluded.reviewed_by, reviewed_at = now()
         returning venue_ref, verdict, note, reviewed_at`,
        [ref, verdict, note, currentAccount()?.id ?? null]);
      // The verdict settles the pictures found for a saved place (Openverse),
      // both ways and whatever an earlier verdict decided: fine or acceptable
      // publishes them, not fit turns them down and takes them off the card. A
      // household's own upload waits for its own look and is not decided here.
      const accept = verdict !== 'owned_not_fit';
      const { rows: settled } = await client.query(
        `update image_assets i set moderation = $2, updated_at = now()
           from image_links l
          where l.image_id = i.id and l.subject_type = 'place' and l.subject_id = $1
            and i.source = 'openverse'
          returning i.id, l.position, l.role`, [ref, accept ? 'approved' : 'rejected']);
      // A turned-down picture never holds the card: whatever it is, and before
      // anything is promoted into its place (one hero per place, by index).
      await client.query(
        `update image_links l set role = 'gallery' from image_assets i
          where i.id = l.image_id and l.subject_type = 'place' and l.subject_id = $1 and l.role = 'hero' and i.moderation = 'rejected'`, [ref]);
      let hero = null;
      if (accept && settled.length) {
        const { rows: [has] } = await client.query(
          `select 1 from image_links where subject_type = 'place' and subject_id = $1 and role = 'hero' limit 1`, [ref]);
        if (!has) {
          hero = settled.sort((x, y) => x.position - y.position)[0].id;
          await client.query(`update image_links set role = 'hero' where image_id = $1 and subject_type = 'place' and subject_id = $2`, [hero, ref]);
        }
      }
      return { ...rows[0], settled: settled.length, hero };
    });
    res.json(out);
  } catch (err) { next(err); }
});

/**
 * The summary board (owner, 2 Oct 2026): "per category and subcategory, % of
 * places with a Fit owned image, % Borderline, % none." Over the places we hold
 * research on or a household has claimed (place_index ownership owned/claimed),
 * filed by our own categories. A place's figure is its best picture's verdict;
 * "none" is a place with no picture of ours at all, and a place whose pictures
 * are not yet looked at is counted apart rather than hidden in either.
 */
photoReviewRouter.get('/board', requires('view_library'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `with held as (
         select pi.venue_ref, coalesce(pi.category, 'unfiled') as category, coalesce(pi.subcategory, 'unfiled') as subcategory,
                (exists (select 1 from image_links l join image_assets i on i.id = l.image_id
                          where l.subject_type = 'place' and l.subject_id = pi.venue_ref and i.moderation <> 'rejected')
                 or exists (select 1 from venue_site_images v where v.venue_ref = pi.venue_ref)) as pictured,
                (select f.verdict from photo_fitness f where f.venue_ref = pi.venue_ref and (${HELD_FITNESS})
                  order by case f.verdict when 'fit' then 0 when 'borderline' then 1 else 2 end limit 1) as best
           from place_index pi where pi.ownership in ('owned', 'claimed')
       )
       select h.category, c.label as category_label, h.subcategory, sc.label as subcategory_label,
              count(*)::int as places,
              count(*) filter (where h.best = 'fit')::int as fit,
              count(*) filter (where h.best = 'borderline')::int as borderline,
              count(*) filter (where h.best = 'not_fit')::int as not_fit,
              count(*) filter (where h.pictured and h.best is null)::int as unscored,
              count(*) filter (where not h.pictured)::int as none
         from held h
         left join shelf_categories c on c.key = h.category
         left join shelf_subcategories sc on sc.key = h.subcategory
        group by grouping sets ((h.category, c.label), (h.category, c.label, h.subcategory, sc.label))
        order by h.category, (h.subcategory is not null), count(*) desc`);
    const pct = (n, of) => (of ? Math.round((n / of) * 100) : null);
    res.json({
      rows: rows.map((r) => ({
        category: r.category, categoryLabel: r.category_label ?? r.category,
        subcategory: r.subcategory ?? null, subcategoryLabel: r.subcategory ? (r.subcategory_label ?? r.subcategory) : null,
        places: r.places, fitPct: pct(r.fit, r.places), borderlinePct: pct(r.borderline, r.places),
        notFitPct: pct(r.not_fit, r.places), unscoredPct: pct(r.unscored, r.places), nonePct: pct(r.none, r.places),
      })),
    });
  } catch (err) { next(err); }
});

/** The machine look, priced before the click: every picture not yet looked at. */
photoReviewRouter.get('/score/quote', requires('view_library'), async (_req, res, next) => {
  try {
    const todo = await unscored({ limit: 5000 });
    res.json({ pictures: todo.length, pence: Math.ceil(todo.length * PENCE_PER_PICTURE), perPicturePence: PENCE_PER_PICTURE, checks: CHECKS });
  } catch (err) { next(err); }
});

photoReviewRouter.post('/score', requires('manage_library'), requireOwnerSignedIn('look at every owned picture'), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const out = await scoreAll({ householdId: household.id, expectPictures: req.body?.expectPictures });
    if (out.why === 'quote_changed') return res.status(409).json({ error: 'quote_changed', message: `There are ${out.pictures} pictures now — price it again.`, pictures: out.pictures });
    if (out.why === 'already_running') return res.status(409).json({ error: 'already_running', message: 'The pictures are being looked at now.' });
    res.status(202).json({ started: out.started, pictures: out.pictures });
  } catch (err) { next(err); }
});
