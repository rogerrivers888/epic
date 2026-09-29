import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, bandCount, destShortName, alongSub, THIN_BELOW } from '../src/screens/tripIdeas.ts';
import type { TripAlongPlace, Trip } from '../src/api.ts';

// The National Gallery, roughly. A degree of latitude is ~111km; 0.007° ≈ 0.78km,
// just inside the 0.8km "Right by" fence, and 0.02° ≈ 2.2km, well outside it.
const DEST = { lat: 51.5089, lng: -0.1283 };

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't1', title: 'Gallery Saturday', origin: { label: 'Home', lat: 51.4, lng: -0.3 } as any,
    destination: { label: 'The National Gallery, London', lat: DEST.lat, lng: DEST.lng } as any,
    departAt: '2026-10-03T09:00:00Z', returnAt: '2026-10-03T18:00:00Z',
    travelMode: 'driving', intensity: 'balanced', dayEnd: '13:00',
    ...over,
  } as Trip;
}

let seq = 0;
function place(over: Partial<TripAlongPlace> = {}): TripAlongPlace {
  seq += 1;
  return {
    venueRef: `osm:node/${seq}`, source: 'osm', name: `Place ${seq}`, category: 'attraction',
    lat: DEST.lat + 0.02, lng: DEST.lng + 0.02, cuisines: [], experiences: [], moods: ['fun'],
    subcategory: null, rating: 4.5, ratingCount: 100, priceLevel: 2, openingHours: null, phone: null,
    website: null, address: null, summary: null, openNow: null, closesAt: null, opensAt: null,
    goodForChildren: null, photos: [], attribution: null, detourMinutes: 12, detourMiles: 3,
    estimated: true, onShortlist: false, onDay: false,
    ...over,
  };
}

test('the fit line is always "+N min detour", rounded (owner 8a)', () => {
  const feed = buildFeed({ places: Array.from({ length: 6 }, () => place({ detourMinutes: 6.4 })), kind: 'activities', trip: trip(), minutes: 15 });
  const card = feed.rows.flatMap((r) => r.items)[0];
  assert.equal(card.fit, '+6 min detour');
});

test('the detour filter is a client-side band; the counts follow it', () => {
  const places = [place({ detourMinutes: 6 }), place({ detourMinutes: 12 }), place({ detourMinutes: 22 }), place({ detourMinutes: 28 })];
  assert.equal(bandCount(places, 10), 1);
  assert.equal(bandCount(places, 15), 2);
  assert.equal(bandCount(places, 30), 4);
  // A place with no detour minutes is in no band.
  assert.equal(bandCount([...places, place({ detourMinutes: null })], 30), 4);
});

test('a tab with fewer than five in the band becomes a thin list with the widen count', () => {
  // Four inside 15, more outside it → thin at 15, and the wider count sees all.
  const places = [
    place({ detourMinutes: 6 }), place({ detourMinutes: 8 }), place({ detourMinutes: 12 }), place({ detourMinutes: 14 }),
    place({ detourMinutes: 22 }), place({ detourMinutes: 26 }),
  ];
  const feed = buildFeed({ places, kind: 'activities', trip: trip(), minutes: 15 });
  assert.equal(feed.rows.length, 0);
  assert.ok(feed.thin);
  assert.equal(feed.thin!.count, 4);
  assert.ok(feed.thin!.count < THIN_BELOW);
  assert.equal(feed.thin!.widerCount, 6);
  assert.equal(feed.thin!.items.length, 4);
  // Widened to 30, it is no longer thin.
  const wide = buildFeed({ places, kind: 'activities', trip: trip(), minutes: 30 });
  assert.equal(wide.thin, null);
  assert.ok(wide.rows.length > 0);
});

test('"Right by" holds only places within a 10-minute walk of the destination, and it is filter-independent', () => {
  const nearOne = place({ name: 'Next door', lat: DEST.lat + 0.005, lng: DEST.lng, detourMinutes: 3 });
  const farOnes = Array.from({ length: 6 }, () => place({ lat: DEST.lat + 0.02, lng: DEST.lng + 0.02, detourMinutes: 12 }));
  const feed = buildFeed({ places: [nearOne, ...farOnes], kind: 'activities', trip: trip(), minutes: 15 });
  const nearRow = feed.rows.find((r) => r.key === 'near');
  assert.ok(nearRow, 'a Right by row exists');
  assert.equal(nearRow!.title, 'Right by The National Gallery');
  assert.equal(nearRow!.sub, 'Within a 10-minute walk');
  assert.deepEqual(nearRow!.items.map((i) => i.name), ['Next door']);
  // It appears in only one of Picked / Right by / On the way.
  const others = feed.rows.filter((r) => r.key === 'pick' || r.key === 'way').flatMap((r) => r.items.map((i) => i.name));
  assert.ok(!others.includes('Next door'));
});

test('activities lead with a big "Picked for your household" row, in the pool order', () => {
  const places = Array.from({ length: 10 }, (_, i) => place({ name: `Rank ${i}`, lat: DEST.lat + 0.02, lng: DEST.lng + 0.02, detourMinutes: 12 }));
  const feed = buildFeed({ places, kind: 'activities', trip: trip(), minutes: 15 });
  const pick = feed.rows.find((r) => r.key === 'pick');
  assert.ok(pick);
  assert.equal(pick!.big, true);
  assert.equal(pick!.items[0].name, 'Rank 0');
});

test('food splits into a big lunch-near row and keyword rows for coffee and sweet', () => {
  const lunch = place({ name: 'Bistro', category: 'restaurant', moods: ['food'], lat: DEST.lat + 0.004, lng: DEST.lng, detourMinutes: 2 });
  const coffee = place({ name: 'The Roastery', category: 'cafe', cuisines: ['coffee'], moods: ['food'], detourMinutes: 8 });
  const sweet = place({ name: 'Bageriet', category: 'bakery', moods: ['food'], detourMinutes: 7 });
  const other = place({ name: 'Curry House', category: 'restaurant', cuisines: ['indian'], moods: ['food'], detourMinutes: 10 });
  const filler = Array.from({ length: 3 }, () => place({ category: 'restaurant', cuisines: ['indian'], moods: ['food'], detourMinutes: 11 }));
  const feed = buildFeed({ places: [lunch, coffee, sweet, other, ...filler], kind: 'food', trip: trip(), minutes: 15 });
  const keys = feed.rows.map((r) => r.key);
  assert.deepEqual(keys, ['near', 'coffee', 'sweet', 'other']);
  const near = feed.rows.find((r) => r.key === 'near')!;
  assert.equal(near.title, 'Lunch near The National Gallery');
  assert.equal(near.big, true);
  assert.equal(near.sub, 'Around 13:00, when you leave');
  assert.deepEqual(feed.rows.find((r) => r.key === 'coffee')!.items.map((i) => i.name), ['The Roastery']);
  assert.deepEqual(feed.rows.find((r) => r.key === 'sweet')!.items.map((i) => i.name), ['Bageriet']);
});

test('the "On the way" subtitle matches the trip mode', () => {
  assert.equal(alongSub('driving'), 'Along your drive in');
  assert.equal(alongSub('walking'), 'Along your walk in');
  assert.equal(alongSub('transit'), 'Along your train in');
});

test('the destination short name is the label up to its first comma', () => {
  assert.equal(destShortName(trip()), 'The National Gallery');
  assert.equal(destShortName(trip({ destination: null })), 'your destination');
});
