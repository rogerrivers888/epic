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
  const host = { type: 'practitioner', trust: 'verified', payout_status: 'connected' };
  const ok = { shape: 'oneoff', title: 'Supper', description: 'Three courses from the garden.', starts_on: '2026-10-01', price_mode: 'free', venue: 'out_about' };
  assert.deepEqual(publishBlockers(ok, host), []);
  assert.match(publishBlockers({ ...ok, venue: 'their_place' }, host).join(' '), /Checked/);
  assert.match(publishBlockers({ ...ok, price_mode: 'same_each', price_pence: 12000 }, host).join(' '), /above £100/);
  assert.deepEqual(publishBlockers({ ...ok, price_mode: 'same_each', price_pence: 12000 }, { ...host, trust: 'checked' }), []);
  assert.match(publishBlockers({ ...ok, price_mode: 'same_each', price_pence: 1800 }, { ...host, payout_status: 'not_connected' }).join(' '), /payouts/);
  const night = publishBlockers({ ...ok, age_limit: null, min_count: 1 }, { type: 'local', local_kind: 'night_out', trust: 'verified', payout_status: 'connected' });
  assert.match(night.join(' '), /over-18s/);
  assert.match(night.join(' '), /minimum party of three/);
});

test('a regulated city asks its one question and flags listing copy that reads like a tour', () => {
  assert.equal(isRegulated('IT'), true);
  assert.equal(isRegulated('GB'), false);
  assert.equal(readsLikeCommentary('A tour of the Duomo'), true);
  assert.equal(readsLikeCommentary('A morning cooking together'), false);
  const host = { type: 'practitioner', trust: 'checked', payout_status: 'connected' };
  const florence = { shape: 'anytime', title: 'A morning cooking together', why_you: 'Twenty years in a trattoria kitchen.', venue_country: 'IT', venue: 'their_place', price_mode: 'free', availability: { days: [1], parts: ['morning'] } };
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
  const host = await repo.insertHost(household.id, { name: 'Maria Okafor', type: 'practitioner', credentials: ['Slade, 2009'], languages: ['English', 'Igbo'] });
  assert.equal(host.trust, 'verified');
  assert.equal(host.checks, 'running');
  await assert.rejects(repo.insertHost(household.id, { name: 'Again', type: 'guide' }), /unique/i, 'a household hosts once');

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
  const host = await repo.insertHost(household.id, { name: 'Tom Brennan', type: 'practitioner' });
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
