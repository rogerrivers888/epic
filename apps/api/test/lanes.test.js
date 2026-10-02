/**
 * Four ways to host (domain/lanes.js, Epic hosting v7 — RULINGS.md over the README).
 *
 * The rules worth pinning are the ones the handoff states as rulings rather
 * than as pictures:
 *
 *   * the step order is the prototype's SEQ, Course at nine;
 *   * a course's run skips bank holidays and the host's dates and is pushed
 *     back so it is still the number of sessions promised; weekly runs on more
 *     than one day;
 *   * the children's path is set by the upper age only, Course keeps step 7,
 *     and Checked is needed for drop off at a public event — never private;
 *   * decides-by defaults to a week before the first session;
 *   * Epic's public share is earned by rating, not by event count;
 *   * refunds follow the policy, and are always full when the host cancels;
 *   * on-request slots come from the hour ranges and the session length;
 *   * the checklist blocks what RULINGS says it blocks, and nothing else.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEQ, DEFAULT_CONFIG, hostingConfig, courseRun, weeklyRun, oneoffDays, sessionsFor, holidaySet, asksParentsOnWho, dropsOff, needsChecked,
  decidesOn, publicSharePct, chargesFor, refundPct, refundWords, perPersonAt, slotsFor, bookableDay, stepFilled, missingSteps, checklist,
  sendBlockers, publishAction, paidThroughEpic, isPaid, ageOn,
} from '../src/domain/lanes.js';

const BH = holidaySet([{ date: '2026-12-25', title: 'Christmas Day' }, { date: '2026-12-28', title: 'Boxing Day' }, { date: '2027-01-01', title: 'New Year’s Day' }]);

test('the step order is the prototype’s, and Course is nine steps', () => {
  assert.equal(SEQ.oneoff.length, 8);
  assert.equal(SEQ.weekly.length, 5);
  assert.equal(SEQ.course.length, 9);
  assert.equal(SEQ.onrequest.length, 6);
  for (const lane of Object.keys(SEQ)) {
    assert.equal(SEQ[lane][0], 'what', `${lane} starts with what`);
    assert.equal(SEQ[lane].at(-1), 'who', `${lane} ends with who`);
  }
  assert.equal(SEQ.course[6], 'staydrop', 'Parents stay or drop off is Course’s step 7');
});

test('config: the placeholders, and an override that is laid over them key by key', () => {
  assert.equal(DEFAULT_CONFIG.privateEventPence, 1000);
  assert.equal(DEFAULT_CONFIG.proMonthlyPence, 1299);
  assert.equal(DEFAULT_CONFIG.privateCollectPct, 3);
  const cfg = hostingConfig({ EPIC_HOSTING_CONFIG: JSON.stringify({ privateEventPence: 1200, refunds: { flexible: { fullHoursBefore: 48 } } }) });
  assert.equal(cfg.privateEventPence, 1200);
  assert.equal(cfg.refunds.flexible.fullHoursBefore, 48);
  assert.equal(cfg.refunds.strict.partPct, 50, 'the rest of the refunds stand');
  assert.equal(hostingConfig({ EPIC_HOSTING_CONFIG: '{not json' }), DEFAULT_CONFIG, 'a malformed override is ignored, not half-applied');
});

test('a course skips bank holidays and the host’s dates, and is pushed back to keep its number', () => {
  const offer = { lane: 'course', first_date: '2026-12-11', sessions: 4, skipped_dates: ['2027-01-08'], exclude_bank_holidays: true };
  // Fridays: 11 Dec, 18 Dec, 25 Dec (bank), 1 Jan (bank), 8 Jan (host), 15 Jan, 22 Jan.
  const run = courseRun(offer, BH);
  assert.deepEqual(run.dates, ['2026-12-11', '2026-12-18', '2027-01-15', '2027-01-22']);
  assert.deepEqual(run.skipped.map((s) => [s.date, s.why]), [['2026-12-25', 'bank'], ['2027-01-01', 'bank'], ['2027-01-08', 'host']]);
  // Bank holidays left in when the host switches the exclusion off.
  assert.deepEqual(courseRun({ ...offer, exclude_bank_holidays: false, skipped_dates: [] }, BH).dates, ['2026-12-11', '2026-12-18', '2026-12-25', '2027-01-01']);
  // The session plan's topics ride on the sessions, in order.
  const s = sessionsFor({ ...offer, starts_at: '09:00', duration_min: 45, weeks: [{ title: 'In the water' }, { title: 'Floating' }] }, BH);
  assert.equal(s[0].topic, 'In the water');
  assert.equal(s[0].endsAt, '09:45');
  assert.equal(s[2].topic, null);
});

test('weekly runs on more than one day, and skips what is excluded', () => {
  // Tuesdays and Thursdays from Tue 22 Dec, two weeks.
  const run = weeklyRun({ first_date: '2026-12-22', weekdays: [2, 4], skipped_dates: ['2026-12-29'] }, BH, { weeks: 2 });
  assert.deepEqual(run.dates, ['2026-12-22', '2026-12-24', '2026-12-31']);
  assert.deepEqual(run.skipped.map((x) => x.date), ['2026-12-29']);
  assert.deepEqual(weeklyRun({ first_date: '2026-12-22', weekdays: [] }, BH).dates, [], 'no day, no sessions');
});

test('a one-off over several days is a day a row, capped at four', () => {
  assert.deepEqual(oneoffDays({ starts_on: '2026-06-12' }), ['2026-06-12']);
  assert.deepEqual(oneoffDays({ starts_on: '2026-06-12', multi_day: true, ends_on: '2026-06-14' }), ['2026-06-12', '2026-06-13', '2026-06-14']);
  assert.equal(oneoffDays({ starts_on: '2026-06-12', multi_day: true, ends_on: '2026-06-30' }).length, 4);
  const s = sessionsFor({ lane: 'oneoff', starts_on: '2026-06-12', multi_day: true, ends_on: '2026-06-14', starts_at: '15:00', ends_at: '12:00' });
  assert.equal(s[0].startsAt, '15:00');
  assert.equal(s[2].endsAt, '12:00');
  assert.deepEqual(sessionsFor({ lane: 'onrequest' }), [], 'on request lays down no sessions until a booking is accepted');
});

test('the children’s path: upper age only; Course keeps step 7; Anyone is none', () => {
  assert.equal(asksParentsOnWho({ lane: 'oneoff', age_min: 5, age_max: 11 }), true);
  assert.equal(asksParentsOnWho({ lane: 'oneoff', age_min: 5, age_max: 18 }), false, '18 is not under 18');
  assert.equal(asksParentsOnWho({ lane: 'weekly' }), false, 'Anyone');
  assert.equal(asksParentsOnWho({ lane: 'course', age_max: 8 }), false, 'Course never repeats it on Who can come');
  assert.equal(dropsOff({ lane: 'oneoff', age_max: 11, parents: 'drop_off' }), true);
  assert.equal(dropsOff({ lane: 'oneoff', parents: 'drop_off' }), false, 'a stale answer under Anyone is not a children’s path');
  assert.equal(dropsOff({ lane: 'course', parents: 'drop_off' }), true);
});

test('Checked: drop off at a public event, in every lane — never a private one', () => {
  for (const lane of ['oneoff', 'weekly', 'onrequest']) {
    assert.equal(needsChecked({ lane, visibility: 'public', age_max: 10, parents: 'drop_off' }), true, lane);
    assert.equal(needsChecked({ lane, visibility: 'invite', age_max: 10, parents: 'drop_off' }), false, `${lane} private`);
    assert.equal(needsChecked({ lane, visibility: 'public', age_max: 10, parents: 'stay' }), false, `${lane} parents stay`);
  }
  assert.equal(needsChecked({ lane: 'course', visibility: 'public', parents: 'drop_off' }), true);
  assert.equal(needsChecked({ lane: 'course', visibility: 'invite', parents: 'drop_off' }), false);
});

test('decides by: a week before the first session by default, the host’s own date when set, only with a minimum', () => {
  const course = { lane: 'course', first_date: '2027-01-09', sessions: 8, min_count: 4 };
  assert.equal(decidesOn(course, BH), '2027-01-02');
  assert.equal(decidesOn({ ...course, decides_on: '2026-12-20' }, BH), '2026-12-20');
  assert.equal(decidesOn({ ...course, min_count: null }, BH), null, 'no minimum, no decides-by');
  assert.equal(decidesOn({ lane: 'oneoff', starts_on: '2026-06-13', min_count: 10 }), '2026-06-06');
  assert.equal(decidesOn({ lane: 'weekly', first_date: '2026-10-08', weekdays: [4], min_count: 4 }), null, 'weekly decides each session');
});

test('Epic’s public share is earned by rating, not by how many events', () => {
  assert.equal(publicSharePct({ ratedEvents: 0, avg: null }), 20);
  assert.equal(publicSharePct({ ratedEvents: 50, avg: 4.2 }), 20, 'many events, ratings not held up');
  assert.equal(publicSharePct({ ratedEvents: 5, avg: 4.5 }), 15);
  assert.equal(publicSharePct({ ratedEvents: 9, avg: 4.9 }), 15, 'not yet ten rated');
  assert.equal(publicSharePct({ ratedEvents: 10, avg: 4.8 }), 10);
  assert.equal(publicSharePct({ ratedEvents: 10, avg: 4.7 }), 15);
});

test('charges: private is the £10 or Pro, plus 3% only when paid through Epic; free public costs nothing', () => {
  const priv = chargesFor({ visibility: 'invite', lane: 'oneoff', price_mode: 'same_each', money: 'epic' });
  assert.equal(priv.kind, 'private'); assert.equal(priv.sharePct, 3); assert.equal(priv.eventPence, 1000);
  assert.equal(chargesFor({ visibility: 'invite', lane: 'oneoff', price_mode: 'free' }).sharePct, 0, 'free private: no payment fee');
  assert.equal(chargesFor({ visibility: 'invite', lane: 'oneoff', price_mode: 'same_each', money: 'direct' }).sharePct, 0, 'paid directly: Epic takes nothing of it');
  assert.equal(chargesFor({ visibility: 'public', lane: 'oneoff', price_mode: 'free' }).sharePct, 0);
  assert.equal(chargesFor({ visibility: 'public', lane: 'oneoff', price_mode: 'same_each' }, { rating: { ratedEvents: 10, avg: 4.9 } }).sharePct, 10);
  assert.equal(chargesFor({ visibility: 'invite', price_mode: 'free' }, { isPro: true }).words, 'Included in Pro');
});

test('refunds follow the policy, and a host cancelling or a call-off is always full', () => {
  assert.equal(refundPct('flexible', 25), 100);
  assert.equal(refundPct('flexible', 23), 0);
  assert.equal(refundPct('moderate', 121), 100);
  assert.equal(refundPct('moderate', 119), 0);
  assert.equal(refundPct('strict', 200), 50);
  assert.equal(refundPct('strict', 100), 0);
  assert.equal(refundPct('strict', 1, { hostCancelled: true }), 100);
  assert.equal(refundPct('strict', 1, { calledOff: true }), 100);
  assert.equal(refundWords('flexible'), 'Full refund up to 24h before');
  assert.equal(refundWords('moderate'), 'Full refund up to 5 days before');
  assert.equal(refundWords('strict'), '50% up to 7 days before, none after');
});

test('depends on numbers: the total split, rounded up so it is covered', () => {
  assert.equal(perPersonAt(42000, 10), 4200);
  assert.equal(perPersonAt(42000, 40), 1050);
  assert.equal(perPersonAt(10000, 3), 3334);
  assert.equal(perPersonAt(0, 3), null);
});

test('on request: hourly starts inside the ranges that leave room for the session', () => {
  const hours = { 6: [['14:00', '17:00']], 2: [['09:00', '12:00'], ['18:00', '21:00']] };
  assert.deepEqual(slotsFor(hours, 6, 120), ['14:00', '15:00']);
  assert.deepEqual(slotsFor(hours, 6, 180), ['14:00']);
  assert.deepEqual(slotsFor(hours, 2, 60), ['09:00', '10:00', '11:00', '18:00', '19:00', '20:00']);
  assert.deepEqual(slotsFor(hours, 3, 60), [], 'a day with no hours has no slots');
  // Notice: 48 hours from a Friday noon rules out Saturday, not the Tuesday after.
  const now = new Date('2026-10-09T12:00:00Z');
  assert.equal(bookableDay('2026-10-10', hours, { now }), false);
  assert.equal(bookableDay('2026-10-13', hours, { now }), true);
  assert.equal(bookableDay('2026-10-14', hours, { now }), false, 'not a free weekday');
});

test('what is still to fill in, step by step', () => {
  const offer = { lane: 'onrequest', what_label: 'Cooking lesson', title: 'A Thai cooking lesson', why_you: '', free_hours: {}, session_lengths: [], venue: 'their_place', venue_area: 'Reading', travel_radius_min: 10, price_mode: 'same_each', price_pence: 8000, visibility: null };
  assert.deepEqual(missingSteps(offer), ['why', 'avail', 'price', 'who']);
  assert.equal(stepFilled({ ...offer, refund_policy: 'moderate' }, 'price'), true, 'on request needs no maximum');
  assert.equal(stepFilled({ lane: 'oneoff', price_mode: 'by_numbers', total_pence: 42000, max_count: 40 }, 'price'), false, 'depends on numbers needs a minimum');
  assert.equal(stepFilled({ lane: 'oneoff', visibility: 'invite' }, 'who'), false, 'a default is not a choice');
  assert.equal(stepFilled({ lane: 'oneoff', age_max: 10, visibility: 'invite', who_chosen: true }, 'who'), false, 'a children’s event asks parents on who');
  assert.equal(stepFilled({ lane: 'oneoff', age_max: 10, visibility: 'invite', who_chosen: true, parents: 'stay' }, 'who'), true);
});

test('weekly is paid when either price is set', () => {
  assert.equal(isPaid({ lane: 'weekly' }), false);
  assert.equal(isPaid({ lane: 'weekly', book_ahead_pence: 1000 }), true);
  assert.equal(paidThroughEpic({ lane: 'weekly', drop_in_pence: 1200, visibility: 'public', money: 'direct' }), true, 'public paid is Epic collects only');
});

const host = (over = {}) => ({ name: 'Maya Okafor', photo_id: 'p1', date_of_birth: '1986-03-02', identity_state: 'none', payouts_state: 'none', checked_state: 'none', tax_reference: null, ...over });
const account = { email: 'maya@example.com', mobile: '07700900118' };

test('private checklist: profile and payouts block sending; the video is optional; tax waits for the first payout', () => {
  const offer = { lane: 'oneoff', visibility: 'invite', price_mode: 'same_each', money: 'epic' };
  const items = checklist(offer, { host: host(), account });
  assert.deepEqual(items.map((i) => i.key), ['email', 'phone', 'profile', 'video', 'payouts', 'tax']);
  assert.deepEqual(sendBlockers(items), ['payouts']);
  assert.equal(items.find((i) => i.key === 'video').blocks, null);
  assert.equal(items.find((i) => i.key === 'tax').blocks, 'payout');
  // Free private: nothing about money at all.
  assert.deepEqual(checklist({ lane: 'oneoff', visibility: 'invite', price_mode: 'free' }, { host: host(), account }).map((i) => i.key), ['email', 'phone', 'profile', 'video']);
  // Paid directly: no payouts, no tax.
  assert.ok(!checklist({ ...offer, money: 'direct' }, { host: host(), account }).some((i) => i.key === 'payouts'));
});

test('the host profile needs a date of birth, and the host must be eighteen', () => {
  const offer = { lane: 'oneoff', visibility: 'invite', price_mode: 'free' };
  assert.deepEqual(sendBlockers(checklist(offer, { host: host({ date_of_birth: null }), account })), ['profile']);
  const young = new Date(); young.setUTCFullYear(young.getUTCFullYear() - 17);
  assert.deepEqual(sendBlockers(checklist(offer, { host: host({ date_of_birth: young.toISOString().slice(0, 10) }), account })), ['profile']);
  assert.equal(ageOn('2000-10-03', '2026-10-02'), 25);
  assert.equal(ageOn('2000-10-02', '2026-10-02'), 26);
});

test('public checklist: verified and the video block review; Checked blocks going live; tax the first payout', () => {
  const offer = { lane: 'course', visibility: 'public', price_mode: 'same_each', parents: 'drop_off' };
  const items = checklist(offer, { host: host(), account });
  assert.deepEqual(items.map((i) => i.key), ['email', 'phone', 'profile', 'verified', 'video', 'checked', 'payouts', 'tax', 'review']);
  assert.deepEqual(sendBlockers(items), ['verified', 'video', 'payouts']);
  assert.equal(items.find((i) => i.key === 'checked').blocks, 'live');
  // Parents stay: no Checked.
  assert.ok(!checklist({ ...offer, parents: 'stay' }, { host: host(), account }).some((i) => i.key === 'checked'));
  // Let Epic make it, public: the photos and ten seconds of the host.
  const epicMade = { ...offer, parents: 'stay', video_made_by: 'epic', video_photo_ids: ['a', 'b', 'c'] };
  assert.equal(checklist(epicMade, { host: host(), account }).find((i) => i.key === 'video').done, false, 'public needs the hello take too');
  assert.equal(checklist({ ...epicMade, hello_video_id: 'h' }, { host: host(), account }).find((i) => i.key === 'video').done, true);
});

test('the checklist button says what pressing it does', () => {
  const pub = { visibility: 'public' };
  assert.equal(publishAction(pub, [{ key: 'verified', done: false }]).label, 'Carry on · Verified');
  assert.equal(publishAction(pub, [{ key: 'verified', done: true }]).label, 'Send for review');
  assert.equal(publishAction({ visibility: 'invite', private_plan: 'event' }, []).label, 'Pay £10 · send the invites');
  assert.equal(publishAction({ visibility: 'invite', private_plan: 'pro' }, []).label, 'Join Pro · send the invites');
  assert.equal(publishAction({ visibility: 'invite', private_plan: 'event' }, [], { isPro: true }).label, 'Send the invites');
  assert.equal(publishAction({ visibility: 'invite', private_fee_state: 'paid' }, []).label, 'Send the invites');
});
