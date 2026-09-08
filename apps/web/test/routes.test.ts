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
import { hrefOf, isFullBleed, isImmersive, isTabHome, legacyHref, ownsHeader, parseRoute, paths, parentOf, splitHref, tabOf, titleOf, withQuery } from '../src/routes.ts';

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
  // Every mood but Food is a page here. Which of them the strip *offers* is
  // decided by what is actually near you, not by this list — hardcoding the
  // handoff's five lost Outdoors and Relaxing, which have places in them.
  assert.deepEqual(roundTrip('/inspire/outdoors'), { name: 'inspire', searching: false, mode: 'activities', pick: 'outdoors' });
  assert.deepEqual(roundTrip('/inspire/relaxing'), { name: 'inspire', searching: false, mode: 'activities', pick: 'relaxing' });
  assert.equal(parseRoute('/inspire/nonsense').name, 'unknown');
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
  const trips = { name: 'trips', searching: false, creating: false, tripId: null, section: null, dayId: null, stopRef: null };
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

/**
 * The layers the trip rebuild adds (7 Sep 2026). Each one is two layers into
 * the app, which is exactly the case the rule was written for: "2 layers in, I
 * should be able to share a URL with someone, and they should be able to get to
 * the exact point that I was on."
 */
test('a trip has a chat, a way of getting there, a share sheet and a stop', () => {
  const trips = { name: 'trips', searching: false, creating: false, tripId: null, section: null, dayId: null, stopRef: null };
  assert.deepEqual(roundTrip('/trips/abc/chat'), { ...trips, tripId: 'abc', section: 'chat' });
  assert.deepEqual(roundTrip('/trips/abc/travel'), { ...trips, tripId: 'abc', section: 'travel' });
  assert.deepEqual(roundTrip('/trips/abc/share'), { ...trips, tripId: 'abc', section: 'share' });
  // A stop is named by its source-qualified ref, which has a colon in it and so
  // travels encoded — and comes back decoded.
  assert.deepEqual(parseRoute('/trips/abc/stop/osm%3Anode%2F123'), { ...trips, tripId: 'abc', section: 'stop', stopRef: 'osm:node/123' });
  assert.equal(paths.tripStop('abc', 'osm:node/123'), '/trips/abc/stop/osm%3Anode%2F123');
  assert.equal(paths.tripChat('abc'), '/trips/abc/chat');
  assert.equal(paths.tripTravel('abc'), '/trips/abc/travel');
  assert.equal(paths.tripShare('abc'), '/trips/abc/share');
  // Up from any of them is the trip; the tab is still Trips.
  assert.equal(parentOf(parseRoute('/trips/abc/chat')), '/trips/abc');
  assert.equal(parentOf(parseRoute('/trips/abc/stop/x')), '/trips/abc');
  assert.equal(tabOf(parseRoute('/trips/abc/chat')), 'trips');
  // The chat is the trip page with the map collapsed, so it draws to every edge
  // too; the other three are ordinary pages and keep the chrome.
  assert.equal(isFullBleed(parseRoute('/trips/abc/chat')), true);
  assert.equal(isFullBleed(parseRoute('/trips/abc/travel')), false);
  assert.equal(isFullBleed(parseRoute('/trips/abc/stop/x')), false);
});

test('a trip somebody was sent has an address outside the app', () => {
  assert.deepEqual(roundTrip('/shared/abc123'), { name: 'shared', token: 'abc123' });
  assert.equal(paths.shared('abc123'), '/shared/abc123');
  assert.equal(parseRoute('/shared').name, 'unknown');
  // No tab lights up: it is not part of the household's app at all.
  assert.equal(tabOf(parseRoute('/shared/abc123')), null);
  assert.equal(titleOf(parseRoute('/shared/abc123')), 'A trip you have been sent · Epic');
});

test('the Trips list draws its own head now, so the shell draws none', () => {
  // The wordmark and "+ New trip" are the screen's (1a); a lime band above them
  // would be a second wordmark on the same screen.
  assert.equal(ownsHeader(parseRoute('/trips')), true);
  // And so does everything pushed on top of it: each has its own title and ×.
  assert.equal(ownsHeader(parseRoute('/trips/search')), true);
  assert.equal(ownsHeader(parseRoute('/trips/new')), true);
  assert.equal(ownsHeader(parseRoute('/trips/abc/travel')), true);
  assert.equal(ownsHeader(parseRoute('/trips/abc/stop/x')), true);
  // The trip itself is full-bleed — no header at all, and the tab bar over it.
  assert.equal(ownsHeader(parseRoute('/trips/abc')), false);
  assert.equal(ownsHeader(parseRoute('/trips/abc/shortlist')), false);
  // Places draws its own head at every level (handover v8): lime at the root,
  // cream below it, and the wordmark on both.
  assert.equal(ownsHeader(parseRoute('/places')), true);
  assert.equal(ownsHeader(parseRoute('/places/home')), true);
  assert.equal(ownsHeader(parseRoute('/places/GB')), true);
  assert.equal(ownsHeader(parseRoute('/places/GB/London')), true);
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
  assert.deepEqual(roundTrip('/household'), { name: 'household', memberId: null, voice: null });
  assert.deepEqual(roundTrip('/household/m1'), { name: 'household', memberId: 'm1', voice: null });
  // Inviting somebody is a layer over their page, not a page of its own: the
  // person is the address, and `?invite=1` is how that page is set. So the
  // route it parses to is Gina — the flag is carried in the query and read by
  // the screen, which is what keeps one page from having two spellings.
  assert.deepEqual(parseRoute('/household/m1?invite=1'), { name: 'household', memberId: 'm1', voice: null });
  assert.equal(splitHref('/household/m1?invite=1').query.get('invite'), '1');
  assert.equal(hrefOf(parseRoute('/household/m1?invite=1')), '/household/m1');
  assert.deepEqual(roundTrip('/settings'), { name: 'settings', section: 'preferences' });
  assert.deepEqual(roundTrip('/settings/providers'), { name: 'settings', section: 'providers' });
  assert.deepEqual(roundTrip('/prototypes'), { name: 'prototypes', section: null });
  assert.deepEqual(roundTrip('/prototypes/trips'), { name: 'prototypes', section: 'trips' });
  assert.deepEqual(roundTrip('/admin/reporting'), { name: 'admin', screen: 'reporting' });
  // The voice lab: the ways of hearing compared on the same sentences.
  assert.deepEqual(roundTrip('/admin/voice'), { name: 'admin', screen: 'voice' });
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
  /**
   * A phone, as the handoff draws it — and said the way the handoff says it,
   * which is how much *map* is left: 672 down, 310 by default, 100 up (trips
   * V2). Under a tab bar there are seventy fewer pixels to hand out.
   */
  const phone = detentHeights(844, 70);
  assert.equal(phone.half, 844 - 70 - 310);
  assert.equal(phone.full, 844 - 70 - 100);
  // Peek wants the handoff's 672 of map, and stops at 120 — below that there
  // is not room for the handle, the title and the line under it, which is the
  // whole of what the drawer-down state is for.
  assert.equal(phone.peek, Math.max(120, 844 - 70 - 672));
  assert.ok(phone.peek < phone.half && phone.half < phone.full, 'the detents must be in order');

  // Inside a browse the shell takes the tab bar away, so the sheet gets it.
  const browsing = detentHeights(844, 0);
  assert.equal(browsing.half, 844 - 310);
  assert.equal(browsing.peek, 844 - 672, 'with no bar under it, peek is the handoff’s own number');
  assert.ok(browsing.half > phone.half, 'no tab bar means more sheet, not a gap under it');

  // A short window — a laptop in the phone frame, or a browser with the
  // developer tools open — cannot have a half taller than its full.
  const short = detentHeights(520, 70);
  assert.ok(short.half < short.full, 'half must stay under full on a short screen');
  assert.ok(short.peek <= short.half);

  // And an absurdly short one still leaves something to hold on to.
  const tiny = detentHeights(200, 70);
  assert.ok(tiny.full >= 300, 'the sheet never collapses to nothing');
  assert.ok(tiny.peek <= tiny.half && tiny.half <= tiny.full, 'and stays in order doing it');
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

  // And a browse, which is in the query rather than the path: the page is
  // still the trip's map (trips V2, 8 Sep 2026).
  const browsing = new URLSearchParams('pill=activities');
  assert.ok(isImmersive(trip, browsing), 'a browse takes the tab bar with it');
  assert.ok(!isImmersive(trip, new URLSearchParams()), 'and gives it back on the trip itself');
  assert.ok(!isImmersive(parseRoute('/places/home'), browsing), 'a pill elsewhere means nothing');
  // A place open over the map is a place view, and takes the tab bar with it
  // whether or not a browse is under it (handover v8, §1).
  const placeOpen = new URLSearchParams('place=google%3Aabc');
  assert.ok(isImmersive(trip, placeOpen), 'a place view hides the tab bar');
  assert.ok(!isImmersive(parseRoute('/places/home'), placeOpen), 'but only on the trip map');
});

test('the voice intake: the mic, the wizard, the card and its questions', () => {
  assert.deepEqual(roundTrip('/say'), { name: 'say', intakeId: null, steps: false, ask: false });
  assert.deepEqual(roundTrip('/say/steps'), { name: 'say', intakeId: null, steps: true, ask: false });
  assert.deepEqual(roundTrip('/say/abc-123'), { name: 'say', intakeId: 'abc-123', steps: false, ask: false });
  assert.deepEqual(roundTrip('/say/abc-123/ask'), { name: 'say', intakeId: 'abc-123', steps: false, ask: true });
  assert.equal(parseRoute('/say/abc-123/other').name, 'unknown');
  assert.equal(paths.say({ for: 'trip' }), '/say?for=trip');
  assert.equal(paths.say({ for: 'inspire', type: true }), '/say?for=inspire&type=1');
  assert.equal(paths.ask('abc', 2), '/say/abc/ask?n=2');
  assert.equal(parentOf(parseRoute('/say/abc/ask')), '/say/abc');
  assert.equal(parentOf(parseRoute('/say/abc')), '/say');
  assert.equal(isImmersive(parseRoute('/say'), new URLSearchParams()), true, 'no tab bar on the mic');
  for (const href of ['/say', '/say/steps', '/say/abc', '/say/abc/ask', '/welcome', '/setup', '/household/m1/tell']) {
    assert.equal(ownsHeader(parseRoute(href)), true, `${href} draws its own head`);
  }
});

test('first run and the two-minute set-up', () => {
  assert.deepEqual(roundTrip('/welcome'), { name: 'welcome' });
  assert.deepEqual(roundTrip('/setup'), { name: 'setup' });
  assert.equal(paths.setup(3), '/setup?step=3');
  assert.equal(parentOf(parseRoute('/setup')), '/welcome');
});

test('telling Epic about one person, and reviewing what it heard', () => {
  assert.deepEqual(roundTrip('/household/m1/tell'), { name: 'household', memberId: 'm1', voice: 'tell' });
  assert.deepEqual(roundTrip('/household/m1/review'), { name: 'household', memberId: 'm1', voice: 'review' });
  assert.deepEqual(roundTrip('/household/m1'), { name: 'household', memberId: 'm1', voice: null });
  assert.equal(parentOf(parseRoute('/household/m1/tell')), '/household/m1');
  assert.equal(isTabHome(parseRoute('/household/m1/tell')), false, 'a recording is not where the tab is left');
});
