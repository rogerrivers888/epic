// The atlas: countries → cities → the household's places, across every trip.
//
//   GET /api/atlas                      countries and cities with counts
//   GET /api/atlas/places?country=&city=  places there: been / saved / special, with what everyone thought
//   GET /api/atlas/sketch?lat=&lng=      the map a search is drawn on while it runs
//
// Every visit, save, special or shortlist entry lands here (upsertHouseholdPlace),
// so going back somewhere makes the list longer, and a trip to that city starts
// from everything already known.

import { Router } from 'express';
import { withTransaction } from '../db.js';
import * as atlasRepo from '../repositories/atlas.js';
import { reverseGeocode, geocode } from '../sources/geocode.js';
import { searchAreas } from '../sources/areas.js';
import { recallVenue } from '../sources/index.js';
import { currentHousehold } from './household.js';
import { fillWhere } from '../sources/where.js';
import { fillTaxonomy, needsTaxonomy, taxonomyKept } from '../sources/taxonomy.js';
import { fillPhotos, needsPhoto, photosKept } from '../sources/rentedPhoto.js';
import { countryOutline, sketchFor, SKETCH_ATTRIBUTION } from '../sources/sketch.js';
import { atlasRowsFor, heroesForPlaces } from '../repositories/library.js';
import { shelvesForAtlas, shelvesForVenue } from '../domain/moods.js';
import { rules as shelfRules } from '../repositories/shelfRules.js';
import { taxonomy as shelfTaxonomy } from '../repositories/shelfTaxonomy.js';
import { fillRatings, needsRating, ratingKept } from '../sources/rentedRating.js';
import { recordsFor } from '../repositories/ownedPlaces.js';
import { fileUnder } from '../domain/fileUnder.js';
import { stampImage } from '../sources/photoLinks.js';

/**
 * A stored picture in the shape a card draws. `credit` travels with it because
 * for every licence but CC0 and public domain the picture without the line is
 * the licence broken; `source` travels with it because a mark is not a
 * photograph and must not be drawn like one.
 */
export const ownedImage = (row) => (row ? (row.contributor_household_id && row.moderation !== 'approved' ? stampImage : (x) => x)({
  id: row.id, source: row.source, lqip: row.lqip, credit: row.credit_line,
  licence: row.licence, licenceUrl: row.licence_url, sourceUrl: row.source_page_url,
  creditRequired: row.attribution_required,
}) : null);

export const atlas = Router();

// One background fill per household at a time.
const whereRunning = new Set();
const kindOfCategory = (c) => (['restaurant', 'cafe', 'pub', 'bar'].includes(c) ? 'food' : ['attraction', 'event'].includes(c) ? 'activity' : 'other');

// Reverse-geocoding is rate-limited; nearby points share a result.
const localityCache = new Map();
async function localityFor(lat, lng) {
  if (lat == null || lng == null) return null;
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (localityCache.has(key)) return localityCache.get(key);
  try {
    const r = await reverseGeocode(lat, lng);
    const v = r ? { country: r.country, countryCode: r.countryCode, locality: r.locality } : null;
    localityCache.set(key, v);
    return v;
  } catch { return null; }
}

/**
 * Where a place files: what was said, or else what the map says, snapped.
 *
 * Nothing said where it goes — a save from Inspire, a search from the top of
 * Places, a photograph, a visit recorded from a trip — so the map is asked,
 * and its answer is filed under a location the household already has where
 * there is one close enough (domain/fileUnder.js). A save made *inside* an
 * area names that area and is left exactly as it was said.
 */
export async function fileWhere(householdId, given, lat, lng) {
  const where = { country: given?.country ?? null, countryCode: given?.countryCode ?? null, locality: given?.locality ?? null };
  if (where.countryCode) return where;
  const reverse = await localityFor(lat, lng);
  if (!reverse) return where;
  const filed = fileUnder(reverse, await atlasRepo.locationsFor(householdId).catch(() => []), lat != null && lng != null ? { lat, lng } : null);
  return { country: filed.country, countryCode: filed.countryCode, locality: filed.locality };
}

/**
 * Record (or refresh) a place in the atlas.
 *
 * The judgement is here and the statement is in the repository. What a snapshot
 * may hold is the judgement that matters: only an open source's own facts are
 * ever written down, because a licensed provider's name, hours or rating must
 * never reach `household_places` (Technical Constraints §13.10).
 *
 * `client` is a transaction client, or null to use the pool.
 */
export async function upsertHouseholdPlace(client, householdId, p) {
  const venue = p.venue ?? recallVenue(p.venueRef) ?? null;
  const category = p.category ?? venue?.category ?? null;
  const lat = p.lat ?? venue?.lat ?? null;
  const lng = p.lng ?? venue?.lng ?? null;
  const where = await fileWhere(householdId, p, lat, lng);
  const snapshot = venue && ['osm', 'fixtures', 'photo'].includes(String(p.venueRef).split(':')[0])
    ? { category: venue.category, cuisines: venue.cuisines, experiences: venue.experiences, dietaryOptions: venue.dietaryOptions, address: venue.address, website: venue.website, openingHours: venue.openingHours }
    : null;
  await atlasRepo.upsertHouseholdPlace(client, householdId, {
    venueRef: p.venueRef,
    label: p.label ?? venue?.name ?? p.venueRef,
    kind: p.kind ?? kindOfCategory(category),
    category, lat, lng,
    country: where.country, countryCode: where.countryCode, locality: where.locality,
    venue: snapshot, note: p.note ?? null,
  });
}

/**
 * A trip in the two words a row shows: where it was, and when.
 *
 * `label` is the trip's own name if it has one, then the place — a card that
 * says "Last: Puglia · Aug 2025" is saying which trip, not describing a region.
 */
const tripBrief = (t) => (t ? {
  id: t.id,
  label: t.title || t.place_label || t.locality || t.country,
  startsOn: t.starts_on, endsOn: t.ends_on,
  /** "Aug 2025" — the month is as precise as a row has room to be. */
  on: t.starts_on ? new Date(`${String(t.starts_on).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : null,
} : null);

/** The last one that has happened and the next one that has not, from a list already sorted newest first. */
function lastAndNext(list) {
  const today = new Date().toISOString().slice(0, 10);
  const past = list.filter((t) => String(t.ends_on ?? '') < today);
  const ahead = list.filter((t) => String(t.ends_on ?? '') >= today);
  return {
    lastTrip: tripBrief(past[0] ?? null),
    // Sorted newest first, so the soonest still to come is the last of them.
    nextTrip: tripBrief(ahead[ahead.length - 1] ?? null),
  };
}

/** GET /api/atlas — countries → areas, with the counts and the trips each carries. */
atlas.get('/', async (_req, res, next) => {
  try {
    const household = await currentHousehold();
    const rows = await atlasRepo.countryCityCounts(household.id);
    // Cities the household created on purpose, and cities its trips are in,
    // appear even before they have places.
    const { created, tripCities } = await atlasRepo.citiesWithoutPlaces(household.id);
    const countries = new Map();
    const ensure = (code, name) => { if (!countries.has(code)) countries.set(code, { code, name, places: 0, been: 0, cities: [] }); return countries.get(code); };
    const cityOf = (c, name) => {
      let ci = c.cities.find((x) => x.name === name);
      if (!ci) { ci = { name, places: 0, been: 0, special: 0, trips: 0, activities: 0, food: 0, hotels: 0, lastSeen: null, lat: null, lng: null, created: false, image: null, lastTrip: null, nextTrip: null }; c.cities.push(ci); }
      return ci;
    };
    for (const r of rows) {
      const c = ensure(r.country_code, r.country);
      c.places += r.places; c.been += r.been;
      // Added to, not overwritten. The same town can come back on more than one
      // row — the country's *name* is part of the grouping and two rows can
      // spell it differently, or not at all — and assigning made London say 9
      // when it had 23 in it.
      const ci = cityOf(c, r.locality ?? 'Elsewhere');
      ci.places += r.places; ci.been += r.been; ci.special += r.special;
      ci.activities += r.activities; ci.food += r.food; ci.hotels += r.hotels;
      if (!ci.lastSeen || (r.last_seen && r.last_seen > ci.lastSeen)) ci.lastSeen = r.last_seen;
    }
    for (const r of created) { const ci = cityOf(ensure(r.country_code, r.country), r.locality); ci.created = true; ci.lat ??= r.lat; ci.lng ??= r.lng; }
    for (const r of tripCities) { const ci = cityOf(ensure(r.country_code, r.country), r.locality ?? 'Elsewhere'); ci.trips = Math.max(ci.trips, r.trips); ci.lat ??= r.lat; ci.lng ??= r.lng; }
    // Give place-derived cities a centre from their places, for "add a place here".
    const centres = await atlasRepo.cityCentres(household.id);
    for (const r of centres) { const c = countries.get(r.country_code); const ci = c?.cities.find((x) => x.name === r.locality); if (ci) { ci.lat ??= Number(r.lat); ci.lng ??= Number(r.lng); } }
    const unplaced = await atlasRepo.unplacedCount(household.id);

    // Which trip went where, so a country says when they were last there and an
    // area says which trip it was. One read for the whole atlas.
    const tripRows = await atlasRepo.tripsByArea(household.id);
    const nights = (t) => (t.starts_on && t.ends_on
      ? Math.max(0, Math.round((+new Date(`${String(t.ends_on).slice(0, 10)}T12:00:00Z`) - +new Date(`${String(t.starts_on).slice(0, 10)}T12:00:00Z`)) / 86400000))
      : 0);
    for (const [code, c] of countries) {
      const mine = tripRows.filter((t) => t.country_code === code);
      Object.assign(c, lastAndNext(mine), { trips: mine.length, areas: c.cities.length });
      for (const ci of c.cities) {
        const here = mine.filter((t) => (t.locality ?? 'Elsewhere') === ci.name);
        Object.assign(ci, lastAndNext(here));
        ci.trips = Math.max(ci.trips, here.length);
        /**
         * Whether this area gets a Hotels tab. The handover left the rule open
         * ("distance vs overnight stay"); it is answered here by the fact
         * rather than by a guess about distance — somewhere is a holiday area
         * if the household has kept somewhere to stay there, or has ever slept
         * a night there. Reading & around never will be; Puglia was on the
         * first trip. One line to change if the owner wants distance instead.
         */
        ci.holiday = ci.hotels > 0 || here.some((t) => nights(t) > 0);
      }
    }
    // A country a trip went to but where nothing has been saved yet is still a
    // country the household has been to, so it gets its row.
    for (const t of tripRows) {
      const c = ensure(t.country_code, t.country);
      if (c.areas == null) { Object.assign(c, lastAndNext(tripRows.filter((x) => x.country_code === t.country_code)), { trips: 0, areas: c.cities.length }); }
    }

    // The picture each area carries, from somewhere the household actually put
    // there. Ours: the library only ever holds what we may keep.
    const refRows = await atlasRepo.areaPictureRefs(household.id);
    const heroes = await heroesForPlaces(refRows.map((r) => r.venue_ref));
    for (const r of refRows) {
      const hero = heroes.get(r.venue_ref);
      if (!hero) continue;
      const ci = countries.get(r.country_code)?.cities.find((x) => x.name === r.locality);
      if (!ci) continue;
      // A photograph, not a mark. A logo is the right picture for the business
      // it belongs to and the wrong one for a county: "Puglia" drawn as a
      // restaurant's blue square says nothing about Puglia. A mark is taken
      // only when there is no photograph in the area at all.
      if (!ci.image || (ci.image.source === 'logo' && hero.source !== 'logo')) ci.image = ownedImage(hero);
    }

    // Close to home: everything within the household's radius of the front
    // door, whichever city it files under. Not a city — a standing view.
    let home = null;
    if (household.home_lat != null && household.home_lng != null) {
      const radiusMiles = household.home_radius_miles ?? 10;
      const near = await atlasRepo.nearHomeCounts(household.id, household.home_lat, household.home_lng, radiusMiles);
      const nearRefs = await atlasRepo.nearHomePictureRefs(household.id, household.home_lat, household.home_lng, radiusMiles);
      const nearHeroes = await heroesForPlaces(nearRefs);
      const nearFound = nearRefs.map((ref) => nearHeroes.get(ref)).filter(Boolean);
      const firstHero = nearFound.find((h) => h.source !== 'logo') ?? nearFound[0] ?? null;
      // Which country the front door is in, so the atlas can say "the UK" and
      // "Abroad" rather than listing home among the foreign ones. Taken from
      // where the household's own places actually are, not from a setting
      // nobody filled in.
      const homeCountry = await atlasRepo.homeCountryCode(household.id, household.home_lat, household.home_lng, radiusMiles);
      home = { label: household.home_label, lat: household.home_lat, lng: household.home_lng, radiusMiles, ...near, image: ownedImage(firstHero), countryCode: homeCountry };
    }
    // Cities are drawn in the order an area list reads best: the ones with the
    // most in them first, then alphabetically, so "Elsewhere" does not lead.
    for (const c of countries.values()) c.cities.sort((a, b) => b.places - a.places || a.name.localeCompare(b.name));
    res.json({ countries: [...countries.values()].sort((a, b) => b.places - a.places || a.name.localeCompare(b.name)), unplaced, home });
  } catch (err) { next(err); }
});

/** GET /api/atlas/places?country=GB&city=London&kind=food&status=been|saved|loved */
atlas.get('/places', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const { country, city, kind, status, q, nearHome } = req.query;
    // "Close to home" cuts across cities: everything within the radius, wherever it files.
    if (nearHome && (household.home_lat == null || household.home_lng == null)) return res.json({ places: [], wherePending: 0 });
    const rows = await atlasRepo.placesIn(
      household.id,
      { country, city, kind, q, nearHome: Boolean(nearHome) },
      { lat: household.home_lat, lng: household.home_lng, radiusMiles: household.home_radius_miles ?? 10 },
    );
    let places = rows.map((r) => ({
      venueRef: r.venue_ref, name: r.known_label ?? r.label, unnamed: (r.known_label ?? r.label) === r.venue_ref, kind: r.category ? kindOfCategory(r.category) : r.kind, category: r.category, lat: r.lat, lng: r.lng,
      country: r.country, countryCode: r.country_code, locality: r.locality, venue: r.venue, note: r.note,
      visits: r.visits, lastOn: r.last_on, takes: r.takes ?? [], ledger: r.ledger, onTrips: (r.on_trips ?? []).filter(Boolean),
      status: r.visits > 0 ? 'been' : r.ledger === 'special' ? 'special' : 'saved',
      special: r.ledger === 'special',
      scores: r.scores ?? [],
      postcode: r.postcode ?? null, station: r.station ?? null, stationLines: r.station_lines ?? [], stationKind: r.station_kind ?? null,
      stationDistanceM: r.station_distance_m ?? null, whereChecked: r.where_checked ?? null,
      loved: (r.takes ?? []).filter((t) => t.take === 'loved').length,
      notForMe: (r.takes ?? []).filter((t) => t.take === 'not_for_me').length,
    }));
    // A licensed source's kind of place is rented, so it is never stored: what
    // has been fetched since the service started is held in memory and merged in here.
    places = places.map((p) => {
      const kinds = taxonomyKept(p.venueRef);
      return kinds ? { ...p, venue: { ...(p.venue ?? {}), cuisines: kinds.cuisines, experiences: kinds.experiences } } : p;
    });
    // What we own about these places, which for a row is the one thing that
    // matters: what kind of thing it is. A place saved from a map search often
    // arrives with no snapshot at all — "St James's Park" with an empty venue —
    // and the research in sources/own.js has since read OpenStreetMap and the
    // encyclopedias and written down what it is. That is ours to keep, so it is
    // read from the database rather than rented back from anybody.
    const owned = new Map((await recordsFor(places.map((p) => p.venueRef)).catch(() => [])).map((r) => [r.venue_ref, r]));
    places = places.map((p) => {
      const own = owned.get(p.venueRef);
      if (!own) return p;
      const v = p.venue ?? {};
      const experiences = (v.experiences ?? []).length ? v.experiences : (own.experiences ?? []);
      const cuisines = (v.cuisines ?? []).length ? v.cuisines : (own.cuisines ?? []);
      return { ...p, category: p.category ?? own.category ?? null, venue: { ...v, experiences, cuisines } };
    });
    // The picture we own for each of these, in one statement. A row without one
    // still draws its category icon; a row with one draws the mark or the
    // photograph the ladder found (sources/placePicture.js). Never a photograph
    // of somebody's food that we did not take.
    const ourPictures = await heroesForPlaces(places.map((p) => p.venueRef));
    // Theirs first: a photograph somebody in the house took of the place is the
    // best picture of it there is for them, and it is kept for this household
    // alone (migration 082) — never drawn as anybody else's card.
    const theirPictures = await atlasRepo.householdPhotosFor(household.id, places.map((p) => p.venueRef)).catch(() => new Map());
    // What a day here is like, over the closed set of six (domain/moods.js), so
    // the area screen's Mood dropdown is the same vocabulary as the home
    // screen's shelves. Nothing here fetches: it reads the experiences and the
    // category a search already returned.
    const [rules, tax, atlasRows] = await Promise.all([
      shelfRules(), shelfTaxonomy(), atlasRowsFor(places.map((p) => p.venueRef)).catch(() => new Map()),
    ]);
    places = places.map((p) => {
      const theirs = theirPictures.get(p.venueRef) ?? [];
      const ours = theirs.length ? ownedImage(theirs[0]) : ownedImage(ourPictures.get(p.venueRef) ?? null);
      return {
        ...p,
        image: ours,
        // The rung below the ladder's floor. Only where we hold no photograph
        // of our own, only what has been fetched since the service started,
        // and never written down — the same rented-in-memory bargain as the
        // taxonomy above (sources/rentedPhoto.js).
        //
        // A mark is not a photograph. Painshill Park had a logo from its own
        // website and so drew that on lime in Places, while the browse it was
        // saved from — and the drawer it opened into — showed the photograph
        // (owner, 12 Sep 2026: "it should actually just have the same picture
        // that I chose when I added it"). So the provider's photographs travel
        // beside a mark, and VenueThumb draws the photograph first and keeps
        // the mark for when there is none, or no signal.
        photos: ours && ours.source !== 'logo' ? undefined : photosKept(p.venueRef) ?? undefined,
        // The vocabulary has to be passed, not left to default: without it the
        // resolver has no parent for a drawer and can never name one, and the
        // whole point here is the drawer's name (owner, 7 Sep 2026 — a row
        // should "say what type of attraction it is, like theme park or
        // whatever… the subcategory, not just say attractions repeatedly").
        ...(() => {
          // A place kept from the atlas is filed the way the atlas is filed:
          // by its Wikidata types, which is what migration 054's hundred and
          // thirteen rules are keyed by and the only thing fine enough to tell
          // a country park from a stadium. Anything else is filed by the
          // experiences a search returned and the research wrote down.
          const a = atlasRows.get(p.venueRef);
          const shelf = a
            ? shelvesForAtlas({ ref: p.venueRef, category: a.category, kinds: a.kinds ?? [] }, rules, tax.vocab)
            : shelvesForVenue({
              source: p.venueRef.split(':')[0], sourcePlaceId: p.venueRef.split(':').slice(1).join(':'),
              category: p.category ?? p.venue?.category ?? null, experiences: p.venue?.experiences ?? [],
            }, rules, tax.vocab);
          // The cabinet's name is only worth putting on a row when something
          // actually decided it. A place with no tags and no type lands on Fun
          // because a place has to be somewhere, and "Fun" on the National
          // Gallery is a worse answer than saying nothing — so the label is
          // sent only where a rule, a tag or a category put it there, which is
          // exactly what a default with no subject means.
          const grounded = shelf.because.some((r) => r.scope !== 'default' || r.subject);
          return {
            moods: shelf.shelves,
            subcategory: shelf.subcategory,
            subcategoryLabel: shelf.subcategory ? tax.subByKey.get(shelf.subcategory)?.label ?? null : null,
            categoryLabel: grounded && shelf.category ? tax.byKey.get(shelf.category)?.label ?? null : null,
          };
        })(),
        // What everybody else made of it. Rented, held in memory, never
        // written down (sources/rentedRating.js), and stripped again before a
        // device may keep it. Sent whether or not anybody here has scored the
        // place: the Places row draws the household's own mark in its own
        // column and keeps the crowd's on the meta line beside the date
        // (handover v8, §3 — "it takes precedence over the global score, which
        // stays on the meta line"), so both are wanted.
        ...(ratingKept(p.venueRef) ?? {}),
      };
    });
    // "Loved" is what the screen calls it now (owner, 7 Sep 2026: "the Special
    // can be renamed Loved because we're using a heart icon"); `special` is
    // still the word in the ledger, and still answered, so an address somebody
    // shared last week does not break.
    if (status) places = places.filter((p) => (status === 'special' || status === 'loved' ? p.special : p.status === status));
    // Where a place is, and what kind of place it is, are looked up lazily a few
    // rows per read, after the response has gone; the web asks again shortly
    // while any row is still waiting.
    // A row we have no picture for at all — neither ours nor the provider's,
    // yet. Counted with the rest so the screen asks again and the tiles fill in,
    // rather than a household seeing mint squares until they navigate away.
    const wantPictures = places.filter((p) => needsPhoto(p.venueRef, Boolean(p.image) && p.image.source !== 'logo'));
    // A row with no crowd rating held yet. The household's own score no longer
    // spares a row the question, because the row shows both now (handover v8);
    // the pace is the same eight a read, and a match is kept for good.
    const wantRatings = places.filter((p) => needsRating(p.venueRef, false));
    const pending = rows.filter((r) => r.lat != null && r.lng != null && !r.where_checked).length
      + rows.filter(needsTaxonomy).length
      + wantPictures.length
      + wantRatings.length;
    res.json({ places, wherePending: pending });
    if (pending && !whereRunning.has(household.id)) {
      whereRunning.add(household.id);
      Promise.resolve()
        .then(() => fillWhere(household.id, rows))
        .then(() => fillTaxonomy(household.id, rows))
        // Last, and deliberately: the ladder is asked for nothing here, but a
        // provider is, and a provider bills. Anything that could have filled a
        // tile for free has already had its turn by now.
        .then(() => fillPhotos(household.id, wantPictures.map((p) => ({ venueRef: p.venueRef, hasOwn: Boolean(p.image) && p.image.source !== 'logo' }))))
        // Last of all, and for the same reason again: a rating and a review
        // count are the provider's dearest fields, so everything that could
        // have filled a row for nothing has already had its turn.
        .then(() => fillRatings(household.id, wantRatings.map((p) => ({ venueRef: p.venueRef, ours: false }))))
        .catch(() => null)
        .finally(() => whereRunning.delete(household.id));
    }
  } catch (err) { next(err); }
});


/** PATCH /api/atlas/places { venueRef, label } — name a place that was only ever held by its identifier. */
atlas.patch('/places', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const { venueRef, label } = req.body || {};
    if (!venueRef || !String(label || '').trim()) return res.status(400).json({ error: 'label_required' });
    await atlasRepo.nameUnnamedPlace(household.id, venueRef, String(label).trim());
    res.json({ venueRef, label: String(label).trim() });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/atlas/places { venueRef } — take a place out of the atlas
 * (owner, 4 Sep 2026: "I need to be able to delete stuff… manage my list, and
 * curate it"). The saved and dismissed marks go with it, so it does not walk
 * back in; a visit is a fact and is kept, so somewhere the household has
 * actually been reappears rather than being quietly erased.
 */
atlas.delete('/places', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const venueRef = String(req.body?.venueRef || '').trim();
    if (!venueRef) return res.status(400).json({ error: 'venue_ref_required' });
    if (await atlasRepo.visitCountFor(household.id, venueRef)) {
      return res.status(409).json({ error: 'has_visits', message: "You've been here, so it stays in your atlas. Delete the visit first if it was a mistake." });
    }
    await withTransaction((client) => atlasRepo.removePlace(client, household.id, venueRef));
    res.status(204).end();
  } catch (err) { next(err); }
});

/** POST /api/atlas/cities { placeText | place } — create a city on purpose. */
atlas.post('/cities', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const b = req.body || {};
    let place = b.place?.lat != null ? b.place : null;
    // Typed rather than picked: it is still a city or a region that is wanted, so ask the source that only knows those.
    if (!place && b.placeText) [place] = await searchAreas(b.placeText, { limit: 1 });
    if (!place) return res.status(404).json({ error: 'city_not_found', message: `Couldn't find "${b.placeText}". Try the city and country, e.g. "Lisbon, Portugal".` });
    // A city search returns the city itself; its locality is its own name.
    const locality = place.locality || place.label.split(',')[0];
    if (!place.countryCode) return res.status(400).json({ error: 'country_unknown', message: 'That place has no country in the map data.' });
    // A country is not a destination (owner, 3 Sep 2026): "United Kingdom" typed here used to become a city called United Kingdom.
    if (place.country && locality.trim().toLowerCase() === String(place.country).trim().toLowerCase()) {
      return res.status(400).json({ error: 'country_not_city', message: `${place.country} is a country — type a city or a region in it, like "Bath" or "Lake District".` });
    }
    await atlasRepo.upsertCity(household.id, { country: place.country, countryCode: place.countryCode, locality, lat: place.lat, lng: place.lng });
    res.status(201).json({ city: { name: locality, country: place.country, countryCode: place.countryCode, lat: place.lat, lng: place.lng } });
  } catch (err) { next(err); }
});

atlas.delete('/cities', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const { countryCode, locality } = req.body || {};
    await atlasRepo.deleteCity(household.id, countryCode, locality);
    res.status(204).end();
  } catch (err) { next(err); }
});

/**
 * GET /api/atlas/sketch?lat=&lng=&radiusKm=&country=GB
 *
 * The map a search is drawn on while it runs (owner, 4 Sep 2026; mock-up
 * /mockups/waiting-options.html): the country's coast, the named areas around
 * the point, and the ground the search covers. All of it open data and all of
 * it kept — see sources/sketch.js.
 *
 * It answers from what is stored, so it never holds a search up. The first
 * search in a new town gets the country and the one area the centre sits in;
 * the neighbours are filled in behind it and are there the next time.
 */
atlas.get('/sketch', async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'point_required', message: 'lat and lng are required' });
    }
    const radiusKm = Math.min(50, Math.max(0.5, Number(req.query.radiusKm) || 3));
    let code = req.query.country ? String(req.query.country) : null;
    if (!code) code = (await localityFor(lat, lng))?.countryCode ?? null;
    const { place, areas, complete } = await sketchFor({ lat, lng, radiusKm });
    res.json({
      centre: { lat, lng }, radiusKm, place, areas, complete,
      country: countryOutline(code),
      attribution: SKETCH_ATTRIBUTION,
    });
  } catch (err) { next(err); }
});
