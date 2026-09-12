/**
 * Hosts and events (migration 079, domain/hosting.js, repositories/hosting.js).
 *
 * The rules worth pinning are the ones a screen would quietly get wrong:
 *
 *   * a series skips half term and still runs the number of sessions promised;
 *   * a price is worked out from the offer, per person or per household, and
 *     a run that depends on numbers shows a ceiling as well as a likely figure;
 *   * the age gate names who cannot come, and a booking with no adult is refused;
 *   * Checked is required at their place, with children, and above £100 —
 *     and a night out is 18+ with a minimum party;
 *   * calling an offer off cancels every booking and refunds what was paid;
 *   * a sign-in code is written only as a hash and spends after six guesses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { aHousehold, testDatabase } from './helpers/db.js';

const { query } = await testDatabase();
const repo = await import('../src/repositories/hosting.js');
const {
  ageGate, anytimeSlots, decideBy, isRegulated, pitchChecklist, priceFor, publishBlockers, readsLikeCommentary, reviewPublishOn, seriesDates, standing,
} = await import('../src/domain/hosting.js');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ---------------------------------------------------------------------------
// the arithmetic
// ---------------------------------------------------------------------------

test('a series skips the dates the host tapped out and still runs its sessions', () => {
  const dates = seriesDates({ first_date: '2026-09-23', sessions: 6, skipped_dates: ['2026-10-28'] });
  assert.equal(dates.length, 6);
  assert.deepEqual(dates, ['2026-09-23', '2026-09-30', '2026-10-07', '2026-10-14', '2026-10-21', '2026-11-04']);
  // An end date instead of a count, and a fortnight or a month between them.
  assert.deepEqual(seriesDates({ first_date: '2026-09-23', end_date: '2026-10-08', skipped_dates: [] }), ['2026-09-23', '2026-09-30', '2026-10-07']);
  assert.deepEqual(seriesDates({ first_date: '2026-09-23', sessions: 2, repeat_every: 'fortnightly', skipped_dates: [] }), ['2026-09-23', '2026-10-07']);
  assert.deepEqual(seriesDates({ first_date: '2026-01-31', sessions: 2, repeat_every: 'monthly', skipped_dates: [] })[0], '2026-01-31');
});

test('the set-up walks only the steps the three axes call for', async () => {
  const { stepsFor } = await import('../src/domain/hosting.js');
  assert.deepEqual(stepsFor({ shape: 'oneoff', visibility: 'invite', money: 'free' }, {}), ['plan', 'vis', 'event', 'invite', 'money', 'done'], 'a free private wedding is two steps and an invitation');
  assert.deepEqual(stepsFor({ shape: 'series', visibility: 'link', money: 'direct' }, {}), ['plan', 'vis', 'event', 'weeks', 'invite', 'money', 'price', 'done']);
  assert.deepEqual(stepsFor({ shape: 'anytime', visibility: 'public', money: 'epic', checks: ['qual'] }, { type: 'meetups' }),
    ['plan', 'vis', 'event', 'numbers', 'money', 'price', 'basics', 'kind', 'subdetail', 'video', 'extract', 'checks', 'evidence', 'done']);
});

test('a guest document seeds only what the host has not filled, and says which', async () => {
  const { seedFromText } = await import('../src/routes/hosting.js');
  const text = 'Rachel and Jay, at Hyde Barn\nSaturday 14 June 2027 from 13:00\nHyde Barn, Cirencester GL7 5PZ\nCeremony at one, food at three, carriages at midnight. Parking in the field behind.';
  const r = seedFromText({ shape: 'oneoff' }, text);
  assert.equal(r.patch.title, 'Rachel and Jay, at Hyde Barn');
  assert.equal(r.patch.startsOn, '2027-06-14');
  assert.equal(r.patch.startsAt, '13:00');
  assert.match(r.patch.venueLabel, /GL7 5PZ/);
  assert.match(r.patch.description, /Ceremony at one/);
  assert.deepEqual(r.keys, ['title', 'startsOn', 'startsAt', 'venueLabel', 'description']);
  const kept = seedFromText({ shape: 'oneoff', title: 'Our wedding', starts_on: '2027-06-14' }, text);
  assert.ok(!kept.keys.includes('title') && !kept.keys.includes('startsOn'), 'what the host wrote stands');
});

test('a price is the offer’s arithmetic, per person or per household', () => {
  const same = { price_mode: 'same_each', price_pence: 1800, per: 'person' };
  assert.equal(priceFor(same, { heads: 3 }).pence, 5400);
  assert.equal(priceFor({ ...same, per: 'household' }, { heads: 3 }).pence, 1800);
  const numbers = { price_mode: 'by_numbers', total_pence: 100000, per: 'person', min_count: 20, expected_count: 32 };
  const p = priceFor(numbers, { heads: 2 });
  assert.equal(p.each, 3125, 'the likely figure divides by the expected number');
  assert.equal(p.ceilingPence, 10000, 'the ceiling divides by the minimum, for two people');
  assert.equal(priceFor({ price_mode: 'free' }, { heads: 4 }).pence, 0);
  // Dropping into one session of a series has its own price.
  assert.equal(priceFor({ shape: 'series', price_mode: 'same_each', price_pence: 15000, drop_in_pence: 2800, per: 'person' }, { heads: 1, occurrence: '2026-10-01' }).pence, 2800);
  assert.equal(priceFor({ shape: 'series', price_mode: 'same_each', price_pence: 15000, drop_in_pence: 2800, per: 'person' }, { heads: 1, occurrence: 'whole' }).pence, 15000);
});

test('standing counts heads that are in, not bookings, and not the waiting list', () => {
  const offer = { min_count: 6, expected_count: 10, max_count: 12 };
  const st = standing(offer, [
    { heads: 3, state: 'confirmed' }, { heads: 1, state: 'confirmed' }, { heads: 2, state: 'pending' },
    { heads: 2, state: 'waitlisted' }, { heads: 4, state: 'cancelled' },
  ]);
  assert.equal(st.heads, 6);
  assert.equal(st.bookings, 3);
  assert.equal(st.minimumMet, true);
  assert.equal(st.placesLeft, 6);
  assert.equal(st.full, false);
});

test('the age gate says plainly who cannot come, and a party needs an adult', () => {
  const g = ageGate({ age_limit: 16 }, [{ name: 'Sam', age: 41 }, { name: 'Kate', age: 39 }, { name: 'Ellie', age: 11, child: true }]);
  assert.deepEqual(g.blocked.map((p) => p.name), ['Ellie']);
  assert.equal(g.hasAdult, true);
  assert.equal(ageGate({ age_limit: null }, [{ name: 'Leo', age: 15 }]).hasAdult, false);
});

test('an anytime offer is booked into the host’s days and parts, a fortnight ahead, never a taken slot', () => {
  const offer = { availability: { days: [2], parts: ['evening'] } };
  const from = new Date('2026-09-14T09:00:00Z'); // a Monday
  const slots = anytimeSlots(offer, { from, taken: new Set(['2026-09-15T18:00']) });
  assert.equal(slots.length, 2, 'two Tuesdays in fourteen days');
  assert.equal(anytimeSlots({ availability: { days: [2], parts: ['evening'] }, notice_days: 3 }, { from })[0].date, '2026-09-22', 'three days\' notice skips tomorrow\'s Tuesday');
  assert.equal(slots[0].date, '2026-09-15');
  assert.deepEqual(slots[0].times, ['19:00', '20:00']);
  assert.deepEqual(anytimeSlots({ availability: {} }), []);
});

test('a held booking is decided two days before it runs; reviews publish a fortnight after', () => {
  assert.equal(decideBy({ shape: 'oneoff', starts_on: '2027-10-13' }, null), '2027-10-11');
  assert.equal(reviewPublishOn({ shape: 'oneoff', starts_on: '2026-08-30' }, null), '2026-09-13');
  assert.equal(reviewPublishOn({ shape: 'series', first_date: '2026-09-23', sessions: 2, skipped_dates: [] }, 'whole'), '2026-10-14', 'a whole run publishes after its last week');
});

// ---------------------------------------------------------------------------
// the rules
// ---------------------------------------------------------------------------

test('what stops an offer publishing follows the brief', () => {
  const host = { type: 'skill', trust: 'verified', payout_status: 'connected', date_of_birth: '1980-01-01' };
  const ok = { shape: 'oneoff', visibility: 'public', money: 'free', title: 'Supper', description: 'Three courses from the garden.', starts_on: '2026-10-01', price_mode: 'free', venue: 'out_about', video_id: 'v' };
  assert.deepEqual(publishBlockers(ok, host), []);
  assert.match(publishBlockers({ ...ok, venue: 'their_place' }, host).join(' '), /Checked/);
  assert.match(publishBlockers({ ...ok, money: 'epic', price_mode: 'same_each', price_pence: 12000 }, host).join(' '), /above £100/);
  assert.deepEqual(publishBlockers({ ...ok, money: 'epic', price_mode: 'same_each', price_pence: 12000 }, { ...host, trust: 'checked' }), []);
  assert.match(publishBlockers({ ...ok, money: 'epic', price_mode: 'same_each', price_pence: 1800 }, { ...host, payout_status: 'not_connected' }).join(' '), /payouts/);
  // Public paid is Epic-collects only.
  assert.match(publishBlockers({ ...ok, money: 'direct', price_mode: 'same_each', price_pence: 1800 }, host).join(' '), /through Epic/);
  // Private needs no video, no date of birth, no kind: a wedding is a one-off that happens to be invite-only.
  assert.deepEqual(publishBlockers({ ...ok, visibility: 'invite', video_id: null }, { type: null, trust: 'verified', payout_status: 'not_connected', date_of_birth: null }), []);
  assert.deepEqual(publishBlockers({ ...ok, visibility: 'link', money: 'direct', price_mode: 'same_each', price_pence: 15000, video_id: null }, { type: null, trust: 'verified', payout_status: 'not_connected' }), []);
  const night = publishBlockers({ ...ok, age_limit: null, min_count: 1, rules_accepted: true, sub_detail: {} }, { ...host, type: 'meetups', local_kind: 'night_out' });
  assert.match(night.join(' '), /over-18s/);
  assert.match(night.join(' '), /minimum group of three/);
  assert.match(night.join(' '), /Name the venues/);
});

test('a regulated city asks its one question and flags listing copy that reads like a tour', () => {
  assert.equal(isRegulated('IT'), true);
  assert.equal(isRegulated('GB'), false);
  assert.equal(readsLikeCommentary('A tour of the Duomo'), true);
  assert.equal(readsLikeCommentary('A morning cooking together'), false);
  const host = { type: 'skill', trust: 'checked', payout_status: 'connected', date_of_birth: '1980-01-01' };
  const florence = { shape: 'anytime', visibility: 'public', money: 'free', video_id: 'v', title: 'A morning cooking together', why_you: 'Twenty years in a trattoria kitchen.', venue_country: 'IT', venue: 'their_place', price_mode: 'free', availability: { days: [1], parts: ['morning'] } };
  assert.match(publishBlockers(florence, host).join(' '), /Italy/);
  assert.deepEqual(publishBlockers({ ...florence, regulated_answer: 'no_commentary' }, host), []);
  assert.match(publishBlockers({ ...florence, title: 'A tour of the Duomo', regulated_answer: 'no_commentary' }, host).join(' '), /reads like a guided tour/);
  assert.match(publishBlockers({ ...florence, regulated_answer: 'licensed' }, host).join(' '), /licence number/);
});

test('the pitch checklist reads the words the reviewer will', () => {
  const c = pitchChecklist({ description: 'Six places in three hours, none of them on a list. You will eat standing up twice. Not for anyone who wants a table and a menu.', outcome: null, photo_ids: ['x'] });
  assert.equal(c.what, 'clear');
  assert.equal(c.notSuits, 'clear');
  assert.equal(c.photos, 'clear');
  assert.equal(pitchChecklist({ description: 'A walk.' }).what, 'missing');
});

// ---------------------------------------------------------------------------
// the tables
// ---------------------------------------------------------------------------

test('one host per household, many offers, and calling one off refunds everybody', async () => {
  const { household } = await aHousehold(query, 'Maria’s household');
  const host = await repo.insertHost(household.id, { name: 'Maria Okafor', type: 'skill', credentials: ['Slade, 2009'], languages: ['English', 'Igbo'] });
  assert.equal(host.trust, 'verified');
  assert.equal(host.checks, 'running');
  await assert.rejects(repo.insertHost(household.id, { name: 'Again', type: 'expert' }), /unique/i, 'a household hosts once');

  const offer = await repo.insertOffer(host.id, 'oneoff', { title: 'A supper from the garden', startsOn: '2026-10-02', minCount: 6, maxCount: 12, priceMode: 'same_each', pricePence: 4200 });
  assert.equal(offer.state, 'draft');
  assert.equal(offer.price_pence, 4200);

  const guest = await aHousehold(query, 'the Pattersons');
  const a = await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: guest.household.id, bookedBy: 'Sam', occurrence: '2026-10-02', party: [{ name: 'Sam' }, { name: 'Kate' }], heads: 2, state: 'pending', amountPence: 8400 });
  await repo.updateBooking(a.id, { paymentStatus: 'paid', paidAt: new Date() });
  const b = await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: guest.household.id, bookedBy: 'Jon', occurrence: '2026-10-02', party: [{ name: 'Jon' }], heads: 1, state: 'pending', amountPence: 4200 });

  const { offer: ended, bookings } = await repo.cancelOfferAndRefund(offer.id, 'Not enough people.');
  assert.equal(ended.state, 'ended');
  assert.equal(bookings.length, 2);
  const paid = bookings.find((x) => x.id === a.id);
  const recorded = bookings.find((x) => x.id === b.id);
  assert.equal(paid.state, 'cancelled');
  assert.equal(paid.payment_status, 'refunded', 'money that was taken goes back');
  assert.equal(recorded.payment_status, 'recorded', 'money that was never taken is not "refunded"');

  const mine = await repo.bookingsOfHousehold(guest.household.id);
  assert.equal(mine.length, 2);
  assert.equal(mine[0].host_name, 'Maria Okafor');
});

test('a guest review publishes on the date given, and the rating counts only what is published', async () => {
  const { household } = await aHousehold(query, 'Tom’s household');
  const host = await repo.insertHost(household.id, { name: 'Tom Brennan', type: 'skill' });
  const offer = await repo.insertOffer(host.id, 'anytime', { title: 'A sourdough morning' });
  const guest = await aHousehold(query, 'a guest');
  const booking = await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: guest.household.id, occurrence: '2026-08-30T09:00', party: [{ name: 'A' }], heads: 1, state: 'attended' });
  await repo.insertReview({ bookingId: booking.id, offerId: offer.id, hostId: host.id, householdId: guest.household.id, stars: 5, chips: ['skill'], text: 'Sent us home with a starter.', publishOn: '2099-01-01' });
  assert.equal((await repo.ratingOf(host.id)).count, 0, 'not yet a fortnight');
  await repo.insertReview({ bookingId: booking.id, offerId: offer.id, hostId: host.id, householdId: guest.household.id, stars: 4, chips: ['skill'], text: 'Changed my mind.', publishOn: '2020-01-01' });
  const r = await repo.ratingOf(host.id);
  assert.equal(r.count, 1, 'one review per booking per side');
  assert.equal(r.rating, 4);
});

test('a sign-in code is only ever a hash, and six wrong guesses spend it', async () => {
  const { rows: [h] } = await query('insert into households (name) values ($1) returning id', ['code household']);
  const { rows: [account] } = await query(
    "insert into accounts (household_id, email, name, role, plan, status) values ($1, $2, 'Sam', 'customer', 'trial', 'active') returning id",
    [h.id, `sam-${Math.random().toString(36).slice(2, 7)}@example.com`],
  );
  const row = await repo.insertSignInCode(account.id, sha('418267'), '07700900812', new Date(Date.now() + 600_000));
  assert.equal(row.code_hash, sha('418267'));
  assert.equal(await repo.liveSignInCode(account.id, sha('000000')), null);
  const live = await repo.liveSignInCode(account.id, sha('418267'));
  assert.equal(live.id, row.id);
  await repo.useSignInCode(live.id);
  assert.equal(await repo.liveSignInCode(account.id, sha('418267')), null, 'a code is single-use');

  const second = await repo.insertSignInCode(account.id, sha('111111'), '07700900812', new Date(Date.now() + 600_000));
  for (let i = 0; i < 6; i++) await repo.liveSignInCode(account.id, sha('999999'));
  assert.equal(await repo.liveSignInCode(account.id, sha('111111')), null, 'the seventh attempt is refused even with the right code');
  assert.ok(second.id);
});

test('a waiting list holds one row per contact and nothing else', async () => {
  const { household } = await aHousehold(query, 'an organiser');
  const { rows: [trip] } = await query("insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at) values ($1, 'Snowdon', 'Reading', 51.45, -0.97, now(), now()) returning id", [household.id]);
  const { rows: [group] } = await query("insert into trip_groups (trip_id, household_id, invite_token, maximum_count) values ($1, $2, $3, 40) returning id", [trip.id, household.id, `t-${Math.random().toString(36).slice(2, 10)}`]);
  await repo.joinWaitlist(group.id, '+447700900812', 'mobile');
  await repo.joinWaitlist(group.id, '+447700900812', 'mobile');
  assert.equal((await repo.waitlistOf(group.id)).length, 1);
});

// ---------------------------------------------------------------------------
// what Codex found (12 Sep 2026)
// ---------------------------------------------------------------------------

test('a whole-run booking needs room in every session, drop-ins included', () => {
  const offer = { shape: 'series', first_date: '2026-09-24', sessions: 3, skipped_dates: [], max_count: 4, min_count: null };
  const bookings = [
    { heads: 2, state: 'confirmed', occurrence: 'whole' },
    { heads: 2, state: 'confirmed', occurrence: '2026-10-01' },   // one Thursday is full
  ];
  assert.equal(standing(offer, bookings, 'whole').heads, 4, 'the fullest session decides the whole run');
  assert.equal(standing(offer, bookings, '2026-09-24').heads, 2, 'another Thursday still has room');
  assert.equal(standing(offer, bookings, '2026-10-01').full, true);
});

test('a held booking is decided on its day: confirmed at the minimum, otherwise cancelled and told', async () => {
  const { settleHeldBookings } = await import('../src/routes/hosting.js');
  const { household } = await aHousehold(query, 'Marco’s household');
  const host = await repo.insertHost(household.id, { name: 'Marco', type: 'meetups', localKind: 'already_do' });
  const offer = await repo.insertOffer(host.id, 'oneoff', { title: 'I paint every Sunday', startsOn: '2027-10-13', minCount: 5, priceMode: 'free' });
  await repo.updateOffer(offer.id, { state: 'live' });
  const guest = await aHousehold(query, 'a guest household');
  const short = await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: guest.household.id, occurrence: '2027-10-13', party: [{ name: 'A' }], heads: 3, state: 'pending', decideBy: '2020-01-01' });
  const first = await settleHeldBookings();
  assert.ok(first.cancelled >= 1);
  assert.equal((await repo.bookingById(short.id)).state, 'cancelled', 'three of five on the day is off, and nothing was taken');

  const other = await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: guest.household.id, occurrence: '2027-10-13', party: [{ name: 'B' }], heads: 3, state: 'confirmed' });
  const held = await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: guest.household.id, occurrence: '2027-10-13', party: [{ name: 'C' }], heads: 2, state: 'pending', decideBy: '2020-01-01' });
  await settleHeldBookings();
  assert.equal((await repo.bookingById(held.id)).state, 'confirmed', 'five in on the day: it runs');
  assert.equal((await repo.bookingById(other.id)).state, 'confirmed');
});

test('stopping hosting takes the host, its offers and its media with it', async () => {
  const { household } = await aHousehold(query, 'a host who stops');
  const host = await repo.insertHost(household.id, { name: 'Roger', type: 'expert' });
  const offer = await repo.insertOffer(host.id, 'oneoff', { title: 'A draft' });
  const m = await repo.insertMedia({ householdId: household.id, kind: 'video', mime: 'video/webm', bytes: Buffer.from('x'), durationS: 30 });
  await repo.updateHost(host.id, { introVideoId: m.id });
  const theirs = await repo.insertMedia({ householdId: household.id, kind: 'photo', mime: 'image/png', bytes: Buffer.from('y') });
  const withIntro = await repo.hostById(host.id);
  assert.equal(await repo.deleteMediaOfHost(withIntro, [offer], undefined), 1, 'only the host’s own media, not a review photo of somebody else');
  await repo.deleteHost(host.id, household.id);
  assert.equal(await repo.hostByHousehold(household.id), null);
  assert.equal(await repo.offerById(offer.id), null, 'offers go with the host');
  assert.equal(await repo.mediaMeta(m.id), null);
  assert.ok(await repo.mediaMeta(theirs.id), 'the review photo survives');
});
