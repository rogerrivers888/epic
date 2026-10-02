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
  assert.equal(decidesOn({ lane: 'oneoff', starts_on: '2027-06-12', min_count: 10 }), '2027-06-05');
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
  const offer = { lane: 'onrequest', what_label: 'Cooking lesson', title: 'A Thai cooking lesson', why_you: '', free_hours: {}, session_lengths: [], venue: 'your_place', venue_area: 'Reading', travel_radius_min: 10, price_mode: 'same_each', price_pence: 8000, visibility: null };
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

const host = (over = {}) => ({ name: 'Maya Okafor', photo_id: 'p1', intro_text: 'Henley local', date_of_birth: '1986-03-02', identity_state: 'none', payouts_state: 'none', checked_state: 'none', tax_reference: null, ...over });
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
  // The host makes their own video: photos alone are never a video.
  assert.equal(checklist({ ...offer, parents: 'stay', video_made_by: 'epic', video_photo_ids: ['a', 'b', 'c'] }, { host: host(), account }).find((i) => i.key === 'video').done, false);
  assert.equal(checklist({ ...offer, parents: 'stay', video_id: 'v' }, { host: host(), account }).find((i) => i.key === 'video').done, true);
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

test('the old readers see a lane offer’s dates and slots (the guest page and booking use them)', async () => {
  const { seriesDates, anytimeSlots } = await import('../src/domain/hosting.js');
  // Weekly: several weekdays, no session count, bank holidays out (Codex, 2 Oct 2026).
  const weekly = seriesDates({ lane: 'weekly', first_date: '2026-12-22', weekdays: [2, 4], skipped_dates: [], exclude_bank_holidays: true });
  assert.deepEqual(weekly.slice(0, 4), ['2026-12-22', '2026-12-24', '2026-12-29', '2026-12-31']);
  const course = seriesDates({ lane: 'course', first_date: '2026-12-18', sessions: 3, skipped_dates: [], exclude_bank_holidays: true });
  assert.deepEqual(course, ['2026-12-18', '2027-01-08', '2027-01-15'], 'Christmas Day and New Year’s Day pushed the run back');
  // On request: the hour ranges, the shortest length, the notice in hours.
  const slots = anytimeSlots({ lane: 'onrequest', free_hours: { 6: [['14:00', '17:00']] }, session_lengths: [120, 180], notice_hours: 48 }, { from: new Date('2026-10-09T12:00:00Z'), days: 9 });
  assert.deepEqual(slots, [{ date: '2026-10-17', times: ['14:00', '15:00'] }], 'Sat 10 Oct is inside the 48 hours; Sat 17 is not');
});

test('an adult age set in config is the one the publish gate asks about', async () => {
  const { stepFilled, hostingConfig } = await import('../src/domain/lanes.js');
  const cfg = hostingConfig({ EPIC_HOSTING_CONFIG: JSON.stringify({ adultAge: 16 }) });
  const offer = { lane: 'oneoff', age_max: 17, visibility: 'invite', who_chosen: true };
  assert.equal(stepFilled(offer, 'who'), false, 'at 18, a top age of 17 is a children’s event');
  assert.equal(stepFilled(offer, 'who', cfg), true, 'at 16 it is not');
});

test('a one-off needs its end, and on one day the end comes after the start', () => {
  const base = { lane: 'oneoff', starts_on: '2026-06-13', starts_at: '13:00' };
  assert.equal(stepFilled(base, 'when'), false, 'no end time');
  assert.equal(stepFilled({ ...base, ends_at: '12:00' }, 'when'), false, 'ends before it starts');
  assert.equal(stepFilled({ ...base, ends_at: '23:00' }, 'when'), true);
  assert.equal(stepFilled({ ...base, ends_at: '12:00', multi_day: true, ends_on: '2026-06-14' }, 'when'), true, 'over two days, noon the next day is fine');
  assert.equal(stepFilled({ ...base, ends_at: '12:00', multi_day: true, ends_on: '2026-06-13' }, 'when'), false, 'several days that end on the first is not several days');
});

test('the booking age gate reads a lane offer’s range (Codex, 2 Oct 2026)', async () => {
  const { ageGate } = await import('../src/domain/hosting.js');
  const kids = { lane: 'course', age_min: 5, age_max: 8 };
  assert.deepEqual(ageGate(kids, [{ name: 'Mum', child: false }, { name: 'Ada', age: 6, child: true }]).blocked, [], 'a parent with a six-year-old');
  assert.equal(ageGate(kids, [{ name: 'Mum', child: false }, { name: 'Tom', age: 11, child: true }]).blocked.length, 1, 'eleven is over the top age');
  assert.equal(ageGate(kids, [{ name: 'Mum', child: false }, { name: 'Bo', child: true }]).blocked.length, 1, 'a child with no age cannot be checked');
  const adults = { lane: 'oneoff', age_min: 18 };
  assert.equal(ageGate(adults, [{ name: 'Sam', child: false }, { name: 'Kid', age: 12, child: true }]).blocked.length, 1, 'adults only turns any child away');
  assert.deepEqual(ageGate(adults, [{ name: 'Sam', child: false }]).blocked, []);
});

test('times are the host’s wall clock: summer and winter in London; a zero notice is zero', async () => {
  const { localInstant } = await import('../src/domain/lanes.js');
  assert.equal(localInstant('2026-07-10', '19:00').toISOString(), '2026-07-10T18:00:00.000Z');
  assert.equal(localInstant('2026-12-10', '19:00').toISOString(), '2026-12-10T19:00:00.000Z');
  const { anytimeSlots } = await import('../src/domain/hosting.js');
  const slots = anytimeSlots({ lane: 'onrequest', free_hours: { 6: [['14:00', '17:00']] }, session_lengths: [60], notice_hours: 0 }, { from: new Date('2026-10-10T08:00:00Z'), days: 0 });
  assert.deepEqual(slots, [{ date: '2026-10-10', times: ['14:00', '15:00', '16:00'] }], 'no notice asked, so today’s afternoon is open');
});

test('drop off: the children come without the parent who booked them', async () => {
  const { ageGate } = await import('../src/domain/hosting.js');
  const g = ageGate({ lane: 'oneoff', age_min: 5, age_max: 10, parents: 'drop_off' }, [{ name: 'Ada', age: 6, child: true }]);
  assert.deepEqual(g.blocked, []);
  assert.equal(g.hasAdult, true, 'no attending adult is asked for');
  assert.equal(ageGate({ lane: 'oneoff', age_min: 5, age_max: 10, parents: 'stay' }, [{ name: 'Ada', age: 6, child: true }]).hasAdult, false, 'parents stay: one must come');
});

test('a parent comes to a 5–18 event whatever their age; an adults’ event holds adults to its range', async () => {
  const { ageGate } = await import('../src/domain/hosting.js');
  assert.deepEqual(ageGate({ lane: 'weekly', age_min: 5, age_max: 18 }, [{ name: 'Dad', age: 40, child: false }, { name: 'Kit', age: 9, child: true }]).blocked, []);
  assert.equal(ageGate({ lane: 'oneoff', age_min: 30, age_max: 50 }, [{ name: 'Jo', age: 25, child: false }]).blocked.length, 1);
});

test('a weekly class rolls on: its window starts today once the first session has passed', () => {
  const run = weeklyRun({ first_date: '2026-01-06', weekdays: [2], skipped_dates: [] }, new Map(), { weeks: 2, from: '2026-10-02' });
  assert.deepEqual(run.dates, ['2026-10-06', '2026-10-13']);
  assert.deepEqual(weeklyRun({ first_date: '2026-11-03', weekdays: [2], skipped_dates: [] }, new Map(), { weeks: 1, from: '2026-10-02' }).dates, ['2026-11-03'], 'a start still to come is kept');
});

test('a session plan keeps each topic on its own session, and a gone date blocks approval too', async () => {
  const s = sessionsFor({ lane: 'course', first_date: '2027-01-08', sessions: 3, starts_at: '09:00', duration_min: 60, weeks: [{ n: 1, title: 'One' }, { n: 3, title: 'Three' }] });
  assert.deepEqual(s.map((x) => x.topic), ['One', null, 'Three']);
  const { laneBlockers } = await import('../src/domain/lanes.js');
  const gone = laneBlockers({ lane: 'oneoff', starts_on: '2026-01-10', starts_at: '10:00', ends_at: '12:00', visibility: 'invite', who_chosen: true }, host());
  assert.match(gone[0], /date has gone/);
});

test('an adults’ event has no children to drop off, so Checked never kicks in', () => {
  assert.equal(needsChecked({ lane: 'course', visibility: 'public', parents: 'drop_off', age_min: 18 }), false, 'Adults is the default');
  assert.equal(needsChecked({ lane: 'course', visibility: 'public', parents: 'drop_off', age_min: null }), true, 'Anyone, dropped off, public');
});

test('weekly and course need how long, so every session has an end', () => {
  assert.equal(stepFilled({ lane: 'weekly', weekdays: [4], first_date: '2027-01-07', starts_at: '19:00' }, 'weekly'), false);
  assert.equal(stepFilled({ lane: 'weekly', weekdays: [4], first_date: '2027-01-07', starts_at: '19:00', duration_min: 60 }, 'weekly'), true);
  assert.equal(stepFilled({ lane: 'course', first_date: '2027-01-07', starts_at: '09:00', sessions: 8 }, 'run'), false);
});

test('on request needs hours a session fits into; a late session ends the next day', () => {
  assert.equal(stepFilled({ lane: 'onrequest', free_hours: { 1: [['09:00', '10:00']] }, session_lengths: [180] }, 'avail'), false);
  assert.equal(stepFilled({ lane: 'onrequest', free_hours: { 1: [['09:00', '12:00']] }, session_lengths: [180] }, 'avail'), true);
  const s = sessionsFor({ lane: 'course', first_date: '2027-01-08', sessions: 2, starts_at: '20:00', duration_min: 300 });
  assert.equal(s[0].endsAt, '01:00');
  assert.equal(s[0].endsOn, '2027-01-09');
});

test('a course whose first date was skipped is judged on its first real session', async () => {
  const { laneBlockers } = await import('../src/domain/lanes.js');
  const today = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
  const skipped = new Date(today); skipped.setUTCDate(skipped.getUTCDate() - 2);
  const offer = { lane: 'course', first_date: iso(skipped), skipped_dates: [iso(skipped)], sessions: 3, starts_at: '09:00', duration_min: 60, visibility: 'invite', who_chosen: true, outcome: 'x', parents: 'stay', venue: 'out_about', venue_label: 'Hall', price_mode: 'free', max_count: 8, what_label: 'Swim', title: 'Swim' };
  assert.ok(!laneBlockers(offer, host()).some((b) => /date has gone/.test(b)), 'the run starts next week, not two days ago');
});

test('decides by is never a day already gone', () => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 3);
  const soon = d.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(decidesOn({ lane: 'oneoff', starts_on: soon, min_count: 5 }), today, 'three days away decides today, not four days ago');
  assert.equal(decidesOn({ lane: 'oneoff', starts_on: today, min_count: 5 }), null, 'starting today, nothing left to decide');
});

test('a per-booking price is one share however many come', async () => {
  const { priceFor } = await import('../src/domain/hosting.js');
  assert.equal(priceFor({ price_mode: 'same_each', price_pence: 5000, per: 'booking' }, { heads: 3 }).pence, 5000);
  assert.equal(priceFor({ price_mode: 'same_each', price_pence: 5000, per: 'person' }, { heads: 3 }).pence, 15000);
});

test('on-request slots are listed by the host’s own date', async () => {
  const { anytimeSlots } = await import('../src/domain/hosting.js');
  // 02:00 UTC on Tuesday is still Monday 22:00 in New York: Monday's late slot is open.
  const slots = anytimeSlots({ lane: 'onrequest', time_zone: 'America/New_York', free_hours: { 1: [['22:00', '23:30']] }, session_lengths: [60], notice_hours: 0 }, { from: new Date('2026-10-13T01:30:00Z'), days: 0 });
  assert.deepEqual(slots, [{ date: '2026-10-12', times: ['22:00'] }]);
});
