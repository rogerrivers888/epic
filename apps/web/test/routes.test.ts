/**
 * Every address Epic has, read and written — src/routes.ts.
 *
 * This is the file that decides what a link means, so it is the file where a
 * mistake is silent and expensive: a shape that parses one way and writes back
 * another gives the same page two addresses, and a legacy address that stops
 * being answered breaks a link somebody was sent.
 *
 * So every route is walked both ways, and the old `?tab=` addresses — which the
 * owner keeps on his phone, and which went out in group invites — are pinned.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { hrefOf, isFullBleed, isImmersive, isTabHome, legacyHref, parseRoute, paths, parentOf, splitHref, tabOf, titleOf, withQuery } from '../src/routes.ts';

/** Read it, write it back, and get the same address. */
const roundTrip = (href: string, expected?: string) => {
  const route = parseRoute(href);
  assert.equal(hrefOf(route), expected ?? href, `${href} did not come back as itself`);
  return route;
};

// --- every page ------------------------------------------------------------

test('the home screen', () => {
  assert.deepEqual(parseRoute('/'), { name: 'inspire', searching: false, mode: 'activities', pick: null });
  assert.deepEqual(parseRoute('/inspire'), { name: 'inspire', searching: false, mode: 'activities', pick: null });
  roundTrip('/inspire');
});

test('one layer into Inspire: the search, and a category opened out', () => {
  assert.deepEqual(roundTrip('/inspire/search'), { name: 'inspire', searching: true, mode: 'activities', pick: null });
  assert.deepEqual(roundTrip('/inspire/culture'), { name: 'inspire', searching: false, mode: 'activities', pick: 'culture' });
  assert.equal(paths.inspireShelf('adrenaline'), '/inspire/adrenaline');
  // A mood the strip does not name is still addressable, so a link to one keeps working.
  assert.equal(parseRoute('/inspire/outdoors').name, 'unknown', 'only the five the strip offers are categories here');
});

test('Food is the other half of Inspire now, not a door into Places', () => {
  assert.deepEqual(roundTrip('/inspire/food'), { name: 'inspire', searching: false, mode: 'food', pick: null });
  // A cuisine is open ended — it comes from what is near, not from a table.
  assert.deepEqual(roundTrip('/inspire/food/italian'), { name: 'inspire', searching: false, mode: 'food', pick: 'italian' });
  assert.deepEqual(roundTrip('/inspire/food/pubs'), { name: 'inspire', searching: false, mode: 'food', pick: 'pubs' });
  assert.equal(paths.inspireFood(), '/inspire/food');
  assert.equal(paths.inspireFood('italian'), '/inspire/food/italian');
  assert.equal(paths.inspireMode('activities', 'culture'), '/inspire/culture');
  assert.equal(paths.inspireMode('activities', null), '/inspire');
  assert.equal(parseRoute('/inspire/food/italian/extra').name, 'unknown', 'a cuisine is the last layer');
});

test('how Inspire is set is the query, not the page', () => {
  // The drawer inside a category, how far, by what, and the budget: all ways of
  // setting one page, so none of them changes the path.
  assert.deepEqual(parseRoute('/inspire/culture?within=museums&travel=30&by=transit'),
    { name: 'inspire', searching: false, mode: 'activities', pick: 'culture' });
  assert.deepEqual(parseRoute('/inspire/food?open=1'), { name: 'inspire', searching: false, mode: 'food', pick: null });
});

test('Places: the atlas, close to home, one country, and one area in it', () => {
  assert.deepEqual(roundTrip('/places'), { name: 'places', scope: null });
  assert.deepEqual(roundTrip('/places/home'), { name: 'places', scope: { home: true } });
  assert.deepEqual(roundTrip('/places/IT'), { name: 'places', scope: { country: 'IT', city: null } });
  assert.deepEqual(roundTrip('/places/GB/London'), { name: 'places', scope: { country: 'GB', city: 'London' } });
});

test('a city with a space in its name survives the round trip', () => {
  const href = paths.placesCity('GB', 'Lake District');
  assert.equal(href, '/places/GB/Lake%20District');
  assert.deepEqual(parseRoute(href), { name: 'places', scope: { country: 'GB', city: 'Lake District' } });
  assert.equal(hrefOf(parseRoute(href)), href);
});

test('a country is a page of its own: its areas and its trips (handover, 5 Sep 2026)', () => {
  assert.deepEqual(parseRoute('/places/GB'), { name: 'places', scope: { country: 'GB', city: null } });
  assert.equal(paths.placesCountry('IT'), '/places/IT');
  // Lower case in the bar still means the same country.
  assert.deepEqual(parseRoute('/places/it'), { name: 'places', scope: { country: 'IT', city: null } });
});

test('Trips: the list, where-to, the form, a trip, a trip’s tab, and one day of it', () => {
  const trips = { name: 'trips', searching: false, creating: false, tripId: null, section: null, dayId: null };
  assert.deepEqual(roundTrip('/trips'), trips);
  assert.deepEqual(roundTrip('/trips/search'), { ...trips, searching: true });
  assert.deepEqual(roundTrip('/trips/new'), { ...trips, creating: true });
  assert.deepEqual(roundTrip('/trips/abc'), { ...trips, tripId: 'abc' });
  assert.deepEqual(roundTrip('/trips/abc/shortlist'), { ...trips, tripId: 'abc', section: 'shortlist' });
  assert.deepEqual(roundTrip('/trips/abc/itinerary'), { ...trips, tripId: 'abc', section: 'itinerary' });
  assert.deepEqual(roundTrip('/trips/abc/places'), { ...trips, tripId: 'abc', section: 'places' });
  assert.deepEqual(roundTrip('/trips/abc/map'), { ...trips, tripId: 'abc', section: 'map' });
  assert.deepEqual(roundTrip('/trips/abc/day/d1'), { ...trips, tripId: 'abc', section: 'day', dayId: 'd1' });
  assert.equal(paths.tripsSearch(), '/trips/search');
});

test('where-to is a layer of Trips: it is on the tab, and Back is the trips', () => {
  assert.equal(tabOf(parseRoute('/trips/search')), 'trips');
  assert.equal(parentOf(parseRoute('/trips/search')), '/trips');
  // Not a map: the chrome stays, because this is a form and not the trip.
  assert.equal(isFullBleed(parseRoute('/trips/search')), false);
});

test('a tab is left pointing at a list, never at a record (owner, 7 Sep 2026)', () => {
  // "when I go to trips… Currently, it takes me into the last trip."
  assert.equal(isTabHome(parseRoute('/trips/abc/itinerary')), false);
  assert.equal(isTabHome(parseRoute('/trips/new')), false);
  assert.equal(isTabHome(parseRoute('/trips/search')), false);
  // How the list was set is still worth coming back to (owner, 4 Sep 2026).
  assert.equal(isTabHome(parseRoute('/trips')), true);
  assert.equal(isTabHome(parseRoute('/places/GB/London')), true);
  assert.equal(isTabHome(parseRoute('/inspire')), true);
});

test('a day identifier only means anything under the day tab', () => {
  // /trips/abc/stay/d1 would be a shape with no meaning; the day is dropped
  // rather than remembered somewhere it can never be used.
  assert.equal(parseRoute('/trips/abc/stay/d1').name, 'trips');
  assert.equal((parseRoute('/trips/abc/stay/d1') as any).dayId, null);
  assert.equal(paths.trip('abc', 'stay', 'd1'), '/trips/abc/stay');
});

test('a trip tab nobody has heard of is not a page', () => {
  assert.equal(parseRoute('/trips/abc/elsewhere').name, 'unknown');
});

test('Household, Settings, Prototypes and the back office', () => {
  assert.deepEqual(roundTrip('/household'), { name: 'household', memberId: null });
  assert.deepEqual(roundTrip('/household/m1'), { name: 'household', memberId: 'm1' });
  // Inviting somebody is a layer over their page, not a page of its own: the
  // person is the address, and `?invite=1` is how that page is set. So the
  // route it parses to is Gina — the flag is carried in the query and read by
  // the screen, which is what keeps one page from having two spellings.
  assert.deepEqual(parseRoute('/household/m1?invite=1'), { name: 'household', memberId: 'm1' });
  assert.equal(splitHref('/household/m1?invite=1').query.get('invite'), '1');
  assert.equal(hrefOf(parseRoute('/household/m1?invite=1')), '/household/m1');
  assert.deepEqual(roundTrip('/settings'), { name: 'settings', section: 'preferences' });
  assert.deepEqual(roundTrip('/settings/providers'), { name: 'settings', section: 'providers' });
  assert.deepEqual(roundTrip('/prototypes'), { name: 'prototypes', section: null });
  assert.deepEqual(roundTrip('/prototypes/trips'), { name: 'prototypes', section: 'trips' });
  assert.deepEqual(roundTrip('/admin/reporting'), { name: 'admin', screen: 'reporting' });
  assert.deepEqual(parseRoute('/admin'), { name: 'admin', screen: 'overview' });
});

test('an invite link is its own page and never a query on somebody else’s', () => {
  assert.deepEqual(roundTrip('/join/tok123'), { name: 'join', token: 'tok123' });
  assert.equal(paths.join('a/b'), '/join/a%2Fb');
  assert.deepEqual(parseRoute('/join/a%2Fb'), { name: 'join', token: 'a/b' });
});

test('the code on a restaurant table has an address of its own', () => {
  assert.deepEqual(roundTrip('/order/tok123'), { name: 'order', token: 'tok123' });
  assert.equal(paths.order('a/b'), '/order/a%2Fb');
  assert.deepEqual(parseRoute('/order/a%2Fb'), { name: 'order', token: 'a/b' });
  // It is not a page of the app: no tab lights up behind it.
  assert.equal(tabOf(parseRoute('/order/tok123')), null);
});

test('an address with no page behind it says so rather than pretending', () => {
  for (const path of ['/nowhere', '/settings/money', '/plan/extra', '/prototypes/nothing', '/order']) {
    assert.equal(parseRoute(path).name, 'unknown', `${path} should not resolve to a page`);
  }
});

test('the query is never part of which page it is', () => {
  assert.deepEqual(parseRoute('/places/GB/London?kind=eat&sort=recent'), { name: 'places', scope: { country: 'GB', city: 'London' } });
  assert.deepEqual(parseRoute('/inspire/culture?travel=30'), { name: 'inspire', searching: false, mode: 'activities', pick: 'culture' });
});

// --- the links that already exist ------------------------------------------

test('the addresses Epic used to have still land somewhere', () => {
  const q = (s: string) => new URLSearchParams(s);
  assert.equal(legacyHref('/', q('tab=places')), '/places');
  assert.equal(legacyHref('/', q('tab=trips')), '/trips');
  assert.equal(legacyHref('/', q('tab=trips&trip=abc')), '/trips/abc');
  assert.equal(legacyHref('/', q('tab=trips&trip=abc&section=group')), '/trips/abc/group');
  assert.equal(legacyHref('/', q('tab=plan')), '/plan');
  assert.equal(legacyHref('/', q('join=tok')), '/join/tok');
});

test('a magic link travels across the redirect rather than being dropped', () => {
  assert.equal(legacyHref('/', new URLSearchParams('tab=places&signin=abc')), '/places?signin=abc');
});

test('an address that is already the new shape is left alone', () => {
  assert.equal(legacyHref('/trips/abc', new URLSearchParams('tab=places')), null);
  assert.equal(legacyHref('/', new URLSearchParams('')), null);
  assert.equal(legacyHref('/', new URLSearchParams('signin=abc')), null);
});

// --- what the shell needs from a route -------------------------------------

test('every route knows which tab it lights up', () => {
  assert.equal(tabOf(parseRoute('/trips/abc/day/d1')), 'trips');
  assert.equal(tabOf(parseRoute('/places/home')), 'places');
  assert.equal(tabOf(parseRoute('/admin/audit')), null);
  assert.equal(tabOf(parseRoute('/join/x')), null);
});

test('Back has somewhere to go for somebody who arrived on a shared link', () => {
  assert.equal(parentOf(parseRoute('/trips/abc/day/d1')), '/trips/abc/day');
  assert.equal(parentOf(parseRoute('/trips/abc/shortlist')), '/trips/abc');
  assert.equal(parentOf(parseRoute('/trips/abc')), '/trips');
  assert.equal(parentOf(parseRoute('/places/GB/London')), '/places/GB');
  assert.equal(parentOf(parseRoute('/places/GB')), '/places');
  assert.equal(parentOf(parseRoute('/places/home')), '/places');
  assert.equal(parentOf(parseRoute('/household/m1')), '/household');
  assert.equal(parentOf(parseRoute('/admin/audit')), '/admin/overview');
});

test('a window of Epic tabs is not seven identical ones', () => {
  assert.equal(titleOf(parseRoute('/places/GB/London')), 'London · Epic');
  assert.equal(titleOf(parseRoute('/places/IT')), 'IT · Epic');
  assert.equal(titleOf(parseRoute('/inspire/culture')), 'Culture · Epic');
  assert.equal(titleOf(parseRoute('/nowhere')), 'Not a page · Epic');
});

// --- changing part of an address -------------------------------------------

test('a change to the query keeps the rest of the address', () => {
  assert.equal(withQuery('/places/home?kind=eat&sort=recent', { status: 'been' }), '/places/home?kind=eat&sort=recent&status=been');
  assert.equal(withQuery('/places/home', { kind: 'eat' }), '/places/home?kind=eat');
  // A default is never written down, so clearing is null or the empty string.
  assert.equal(withQuery('/places/home?kind=eat&type=Museum', { type: null }), '/places/home?kind=eat');
  assert.equal(withQuery('/places/home?kind=eat', { kind: '' }), '/places/home');
  // A tap that moves and sets a filter at once passes the path it is moving to.
  assert.equal(withQuery('/inspire?mood=fun', { mood: 'culture' }, '/places/GB/London'), '/places/GB/London?mood=culture');
});

/**
 * Places opens on Loved now (owner, 7 Sep 2026), so Loved is the default and
 * the default is the one thing never written into the address. Everything else
 * is, including the year picker that stands in for the trip chip close to home.
 */
test('the status a Places list opens on is the one it does not write down', () => {
  // Loved is the default and a default is never spelled out, so choosing
  // another status writes it and clearing it takes it away again.
  assert.equal(withQuery('/places/home?kind=eat', { status: 'been' }), '/places/home?kind=eat&status=been');
  assert.equal(withQuery('/places/home?kind=eat', { status: 'saved' }), '/places/home?kind=eat&status=saved');
  assert.equal(withQuery('/places/home?status=been', { status: null }), '/places/home');
  // Close to home the trip chip is a year chip, and a year is part of the page.
  assert.equal(withQuery('/places/home?kind=eat', { year: '2025' }), '/places/home?kind=eat&year=2025');
  assert.equal(withQuery('/places/home?kind=eat&year=2025', { year: null }), '/places/home?kind=eat');
});

/**
 * Food & drink asks two questions and the second only exists once the first is
 * answered (owner, 7 Sep 2026). Both are in the address, and choosing a
 * different kind of place clears the food — two calls in one tap, which is the
 * shape that has broken before.
 */
test('the kind of place and what it serves are two keys, and the second follows the first', () => {
  assert.equal(withQuery('/places/home?kind=eat', { type: 'Restaurants' }), '/places/home?kind=eat&type=Restaurants');
  assert.equal(
    withQuery('/places/home?kind=eat&type=Restaurants', { cuisine: 'Italian' }),
    '/places/home?kind=eat&type=Restaurants&cuisine=Italian',
  );
  // Tapping Cafés clears the cuisine in the same handler, so the second call
  // has to start from what the first wrote.
  const kindChosen = withQuery('/places/home?kind=eat&type=Restaurants&cuisine=Italian', { type: 'Cafés' });
  assert.equal(withQuery(kindChosen, { cuisine: null }), '/places/home?kind=eat&type=Caf%C3%A9s');
});

/**
 * The one that mattered: tapping Food & drink also clears the Type filter, and
 * those are two calls in the same handler. Each has to start from what the last
 * one wrote, or the second undoes the first and the tab looks dead (owner,
 * 5 Sep 2026: "when I click on Food and Drink, it does not work").
 */
test('two changes in one tap compose instead of racing', () => {
  const first = withQuery('/places/home?type=Museum', { kind: 'eat' });
  assert.equal(withQuery(first, { type: null }), '/places/home?kind=eat');
});

// --- the sheet over the map -------------------------------------------------

test('the sheet’s three detents fit the screen they are on', async () => {
  const { detentHeights } = await import('../src/components/detents.ts');
  // A phone, as the handoff draws it: peek 112, half 470, full to 60 from the top.
  const phone = detentHeights(844, 70);
  assert.equal(phone.peek, 112);
  assert.equal(phone.half, 470);
  assert.equal(phone.full, 844 - 60 - 70);
  assert.ok(phone.peek < phone.half && phone.half < phone.full, 'the detents must be in order');

  // A short window — a laptop in the phone frame, or a browser with the
  // developer tools open — cannot have a half taller than its full.
  const short = detentHeights(520, 70);
  assert.ok(short.half < short.full, 'half must stay under full on a short screen');
  assert.ok(short.peek <= short.half);

  // And an absurdly short one still leaves something to hold on to.
  const tiny = detentHeights(200, 70);
  assert.ok(tiny.full >= 320, 'the sheet never collapses to nothing');
});

/**
 * Which addresses give up the shell's chrome, and how much of it. Getting this
 * wrong strands somebody on a screen with no way out, so both are pinned to the
 * addresses they belong to rather than to a screen's own idea of itself.
 */
test('the trip is full-bleed; configuring its group is immersive', () => {
  const trip = parseRoute('/trips/abc');
  const group = parseRoute('/trips/abc/group');
  const shortlist = parseRoute('/trips/abc/shortlist');
  const newTrip = parseRoute('/trips/new');

  assert.ok(isFullBleed(trip) && isFullBleed(group), 'the trip and its group are the map, edge to edge');
  assert.ok(!isFullBleed(shortlist) && !isFullBleed(newTrip), 'the working surfaces keep the chrome');

  // Only the group gives up the tab bar, and only inside a trip.
  assert.ok(isImmersive(group));
  assert.ok(!isImmersive(trip) && !isImmersive(shortlist) && !isImmersive(newTrip));
  assert.ok(!isImmersive(parseRoute('/places/home')));
});
