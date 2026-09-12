// A place added from a photograph (owner, 12 Sep 2026: "it should also support
// a photograph because I might want to just take a photograph of somewhere
// that looks cool and just add it").
//
//   POST /api/places/photo               the picture and where it was taken
//   POST /api/places/photo/:id/attach    it is this place: keep the photo on it, and save the place
//   POST /api/places/photo/:id/place     it is nowhere the sources know: make it a place of the household's own
//
// The photograph is the household's. It lands in the library pending a
// person's look, as every upload does (migration 036), and is kept on the
// place for this household alone (migration 082) — the card and the drawer
// draw it above any mark or Commons frame we found, and nobody else's card
// ever draws it. Where the place files is decided the same way as every other
// save that does not say: the map is asked, and the answer is snapped to the
// nearest location the household already has (domain/fileUnder.js).

import express from 'express';
import crypto from 'node:crypto';
import * as lib from '../repositories/library.js';
import * as atlasRepo from '../repositories/atlas.js';
import * as visitsRepo from '../repositories/visits.js';
import { reverseGeocode } from '../sources/geocode.js';
import { sniff, dimensions } from '../sources/pictureBytes.js';
import { fileUnder } from '../domain/fileUnder.js';
import { claimPlace } from '../sources/own.js';
import { currentHousehold } from './household.js';
import { ownedImage, upsertHouseholdPlace } from './atlas.js';

export const placePhotos = express.Router();

/** A phone's photograph, shrunk on the phone to 1,600px on its long edge, is well under this. */
const MAX_BYTES = 8_000_000;
/** What the picture may be of, in the Places tab's three words. */
const CATEGORY_OF_KIND = { do: 'attraction', eat: 'restaurant', stay: 'hotel' };

const refuse = (status, code, message) => { const e = new Error(message); e.status = status; e.code = code; return e; };
const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** A JSON body big enough for one photograph, on these routes only: the app's default is 1mb. */
placePhotos.use('/photo', express.json({ limit: '12mb' }));

/**
 * POST /api/places/photo { data, mime, width, height, lqip, lat, lng }
 *
 * `data` is the photograph, base64. `lat`/`lng` is where it was taken: from
 * the picture's own EXIF where the phone left it in, else from the device's
 * fix at the moment it was chosen. Answers with the stored picture and where
 * the point is in words, so the screen can say "Painshill Park?" and "Filed
 * under Elmbridge" before anything is saved.
 */
placePhotos.post('/photo', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const b = req.body || {};
    const bytes = typeof b.data === 'string' ? Buffer.from(b.data.replace(/^data:[^,]*,/, ''), 'base64') : null;
    if (!bytes?.length) throw refuse(400, 'empty', 'No photograph arrived.');
    if (bytes.length > MAX_BYTES) throw refuse(413, 'too_big', 'That photograph is too big.');
    const mime = sniff(bytes);
    if (!mime) throw refuse(400, 'bad_type', 'That is not a picture.');
    const dims = dimensions(bytes, mime) ?? { width: num(b.width), height: num(b.height) };
    const lat = num(b.lat);
    const lng = num(b.lng);
    const lqip = typeof b.lqip === 'string' && /^data:image\/(jpeg|webp|png);base64,/.test(b.lqip) && b.lqip.length < 4000 ? b.lqip : null;

    const image = await lib.saveImage({
      source: 'household', sourceRef: null, sourcePageUrl: null,
      licence: 'Household photograph', licenceUrl: null,
      usageTerms: 'Taken by the household; shown to them on their own places.',
      attributionRequired: false, mayStore: true,
      creditLine: null, title: null, tags: ['household'],
      mime, width: dims?.width ?? null, height: dims?.height ?? null, bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), lqip,
      contributorHouseholdId: household.id, moderation: 'pending',
    }, [{ width: dims?.width ?? 960, actualWidth: dims?.width ?? null, actualHeight: dims?.height ?? null, mime, bytes: bytes.length, body: bytes }]);

    // Where it was taken, in words, and where it would file.
    let where = null;
    if (lat != null && lng != null) {
      const hit = await reverseGeocode(lat, lng, { zoom: 17 }).catch(() => null);
      await visitsRepo.recordProviderCall(household.id, 'osm-nominatim', 'places.photo').catch(() => null);
      if (hit) {
        const filed = fileUnder(hit, await atlasRepo.locationsFor(household.id).catch(() => []), { lat, lng });
        const near = [hit.address?.line1, hit.address?.area].filter(Boolean).join(', ');
        where = { label: near || hit.label || null, country: filed.country, countryCode: filed.countryCode, locality: filed.locality, how: filed.how };
      }
    }
    res.status(201).json({ image: ownedImage(image), point: lat != null && lng != null ? { lat, lng } : null, where });
  } catch (err) { next(err); }
});

/** Whose photograph, and is it this household's. */
async function own(imageId, householdId) {
  const owner = await atlasRepo.photoOwner(imageId);
  if (!owner || owner !== householdId) throw refuse(404, 'not_found', 'That photograph is not one of yours.');
}

/**
 * POST /api/places/photo/:id/attach { venueRef, label, category, lat, lng, venue? }
 *
 * The photograph is of a place a source knows. Keep it on that place for this
 * household, and save the place — the photograph *is* the act of adding it.
 */
placePhotos.post('/photo/:id/attach', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    await own(req.params.id, household.id);
    const b = req.body || {};
    const venueRef = String(b.venueRef || '').trim();
    const [source, ...rest] = venueRef.split(':');
    if (!source || !rest.join(':')) throw refuse(400, 'ref_required', 'Say which place.');
    await atlasRepo.addHouseholdPhoto(household.id, venueRef, req.params.id);
    await visitsRepo.recordLedger(household.id, source, rest.join(':'), 'saved');
    await upsertHouseholdPlace(null, household.id, { venueRef, label: b.label, venue: b.venue, category: b.category, lat: num(b.lat), lng: num(b.lng) });
    claimPlace(household.id, venueRef, 'saved', { name: b.label ?? null, category: b.category ?? null, lat: num(b.lat), lng: num(b.lng), website: b.venue?.website ?? null });
    res.json({ venueRef, filed: await atlasRepo.whereFiled(household.id, venueRef) });
  } catch (err) { next(err); }
});

/**
 * POST /api/places/photo/:id/place { name, kind, lat, lng }
 *
 * Nowhere the sources know — a view, a bench, a stall. The household names it
 * and it becomes a place of their own: `photo:<id>`, held outright, with the
 * photograph as its picture and the point as where it is.
 */
placePhotos.post('/photo/:id/place', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    await own(req.params.id, household.id);
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 120);
    if (!name) throw refuse(400, 'name_required', 'Give it a name.');
    const category = CATEGORY_OF_KIND[b.kind] ?? 'attraction';
    const lat = num(b.lat);
    const lng = num(b.lng);
    const venueRef = `photo:${req.params.id}`;
    await atlasRepo.addHouseholdPhoto(household.id, venueRef, req.params.id);
    await visitsRepo.recordLedger(household.id, 'photo', req.params.id, 'saved');
    await upsertHouseholdPlace(null, household.id, { venueRef, label: name, category, lat, lng, venue: { name, category, cuisines: [], experiences: [] } });
    claimPlace(household.id, venueRef, 'saved', { name, category, lat, lng, website: null });
    res.status(201).json({ venueRef, filed: await atlasRepo.whereFiled(household.id, venueRef) });
  } catch (err) { next(err); }
});
