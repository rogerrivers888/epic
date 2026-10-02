/**
 * The money engine's rules (domain/money.js) and the settings they read
 * (domain/hostingSettings.js) — hosting v4 handover §5, §7. Pure: no database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  settingsMap, ratedRate, ladderProgress, introState, feeFor, tipFee, refundFor,
  numbersSettlement, payoutDecision, isLate, priceBooking, feeWords,
} from '../src/domain/money.js';
import { checkSetting, configOverlay, settingWords } from '../src/domain/hostingSettings.js';
import { hostingConfig, useSettingsOverlay, DEFAULT_CONFIG } from '../src/domain/lanes.js';

// The seeded rows of migration 366, as the table holds them.
const ROWS = [
  { key: 'private_event_fee', value: 1000, unit: 'pence' },
  { key: 'pro_monthly', value: 1299, unit: 'pence' },
  { key: 'private_payment_fee', value: 3, unit: 'percent' },
  { key: 'public_commission', value: [{ pct: 20 }, { pct: 15, ratedEvents: 5, avgAtLeast: 4.5 }, { pct: 10, ratedEvents: 10, avgAtLeast: 4.8 }], unit: 'ladder' },
  { key: 'intro_zero', value: { days: 90, bookings: 10 }, unit: 'intro' },
  { key: 'host_link_rate', value: 5, unit: 'percent' },
  { key: 'minimum_fee', value: 150, unit: 'pence' },
  { key: 'tip_admin_fee', value: { pct: 3, minPence: 30 }, unit: 'tip' },
  { key: 'refund_terms', value: { flexible: { fullHoursBefore: 24 }, moderate: { fullHoursBefore: 120 }, strict: { partHoursBefore: 168, partPct: 50 } }, unit: 'refunds' },
  { key: 'late_change_window', value: 48, unit: 'hours' },
  { key: 'payout_release', value: 72, unit: 'hours' },
  { key: 'payout_early_on_confirm', value: true, unit: 'switch' },
  { key: 'decides_by_default', value: 7, unit: 'days' },
  { key: 'weekly_session_decides', value: 24, unit: 'hours' },
  { key: 'on_request_limits', value: { noticeHours: 48, perWeek: 3 }, unit: 'on_request' },
  { key: 'ask_to_book_window', value: 24, unit: 'hours' },
  { key: 'review_window', value: 48, unit: 'hours' },
  { key: 'guarantee_pool', value: null, unit: 'pence' },
];
const S = settingsMap(ROWS);
const LADDER = S.public_commission;
const OLD_HOST = { hostStartedAt: '2025-01-01', bookingsSoFar: 40 };
const NOW = new Date('2026-10-02T12:00:00Z');

test('Epic’s share is earned by rating, never by the number of events', () => {
  assert.equal(ratedRate(LADDER, {}), 20, 'a new host starts at 20%');
  assert.equal(ratedRate(LADDER, { ratedEvents: 4, avg: 5 }), 20, 'four rated events is not five');
  assert.equal(ratedRate(LADDER, { ratedEvents: 5, avg: 4.5 }), 15);
  assert.equal(ratedRate(LADDER, { ratedEvents: 30, avg: 4.4 }), 20, 'thirty events under 4.5 stay at 20%: count alone earns nothing');
  assert.equal(ratedRate(LADDER, { ratedEvents: 10, avg: 4.8 }), 10);
  assert.equal(ratedRate(LADDER, { ratedEvents: 10, avg: 4.7 }), 15, 'ten events at 4.7 is the middle step');
  assert.equal(ratedRate(null, {}), null, 'no ladder: can’t speak');
  const p = ladderProgress(LADDER, { ratedEvents: 8, avg: 4.9 });
  assert.equal(p.rate, 15);
  assert.deepEqual([p.next.pct, p.next.eventsToGo, p.next.avgOk], [10, 2, true], '“8 of 10 rated events to 10%”');
  assert.equal(ladderProgress(LADDER, { ratedEvents: 12, avg: 4.9 }).next, null, 'the last step has nothing after it');
});

test('the intro is 0% while both its days and its bookings last', () => {
  const intro = S.intro_zero;
  assert.equal(introState(intro, { hostStartedAt: '2026-09-01', bookingsSoFar: 3, now: NOW }).active, true);
  assert.equal(introState(intro, { hostStartedAt: '2026-09-01', bookingsSoFar: 10, now: NOW }).active, false, 'ten bookings ends it early');
  assert.equal(introState(intro, { hostStartedAt: '2026-06-01', bookingsSoFar: 1, now: NOW }).active, false, 'ninety days ends it');
  assert.equal(introState(null, { hostStartedAt: '2026-09-01', now: NOW }).active, false, 'switched off: never');
});

test('the fee on a booking: intro, override, own link, rated rate, the minimum', () => {
  const pub = (valuePence, extra = {}) => ({ visibility: 'public', valuePence, ...extra });
  assert.deepEqual(feeFor(pub(4000), { ...OLD_HOST, rating: { ratedEvents: 0 } }, S, NOW), { ratePct: 20, reason: 'standard', feePence: 800, hostPence: 3200 });
  assert.deepEqual(feeFor(pub(4000), { ...OLD_HOST, rating: { ratedEvents: 6, avg: 4.6 } }, S, NOW), { ratePct: 15, reason: 'standard', feePence: 600, hostPence: 3400 });
  assert.deepEqual(feeFor(pub(4000, { viaHostLink: true }), { ...OLD_HOST, rating: { ratedEvents: 10, avg: 5 } }, S, NOW), { ratePct: 5, reason: 'host_link', feePence: 200, hostPence: 3800 });
  assert.deepEqual(feeFor(pub(500), { ...OLD_HOST }, S, NOW), { ratePct: 20, reason: 'minimum', feePence: 150, hostPence: 350 }, '20% of £5 is £1, under the £1.50 minimum');
  assert.deepEqual(feeFor(pub(100), { ...OLD_HOST }, S, NOW), { ratePct: 20, reason: 'minimum', feePence: 100, hostPence: 0 }, 'the minimum is never more than the booking');
  const intro = feeFor(pub(500), { hostStartedAt: '2026-09-20', bookingsSoFar: 2 }, S, NOW);
  assert.deepEqual(intro, { ratePct: 0, reason: 'intro', feePence: 0, hostPence: 500 }, 'never the minimum in the intro');
  assert.equal(feeFor(pub(4000), { ...OLD_HOST, feeOverridePct: 12 }, S, NOW).reason, 'override');
  assert.deepEqual(feeFor({ visibility: 'private', valuePence: 10000 }, OLD_HOST, S, NOW), { ratePct: 3, reason: 'private_payment', feePence: 300, hostPence: 9700 });
  assert.deepEqual(feeFor({ visibility: 'public', valuePence: 0 }, OLD_HOST, S, NOW), { ratePct: 0, reason: 'free', feePence: 0, hostPence: 0 });
  assert.equal(feeFor({ visibility: 'private', valuePence: 5000, throughEpic: false }, OLD_HOST, S, NOW).reason, 'free', 'paid to the host directly: nothing');
  // Switched off: the minimum and the link fall away; the rated rate stands.
  const off = settingsMap(ROWS.map((r) => (['minimum_fee', 'host_link_rate', 'intro_zero'].includes(r.key) ? { ...r, is_on: false } : r)));
  assert.deepEqual(feeFor(pub(500, { viaHostLink: true }), { hostStartedAt: '2026-09-20', bookingsSoFar: 0 }, off, NOW), { ratePct: 20, reason: 'standard', feePence: 100, hostPence: 400 });
  // A setting still to set: the fee refuses to guess.
  const unset = settingsMap(ROWS.map((r) => (r.key === 'public_commission' ? { ...r, value: null } : r)));
  assert.equal(feeFor(pub(4000), OLD_HOST, unset, NOW).reason, 'not_set');
  assert.equal(feeWords({ ratePct: 5, reason: 'host_link', feePence: 200 }), "Epic's fee 5% · your link");
});

test('a tip: the host keeps it all, the guest pays 3% on top with a 30p floor', () => {
  assert.equal(tipFee(500, S), 30, '3% of £5 is 15p; the floor is 30p');
  assert.equal(tipFee(5000, S), 150);
  assert.equal(tipFee(500, {}), null, 'not set: can’t speak');
});

test('refunds: the policy’s windows, a started course, and the causes that always refund in full', () => {
  const r = (policy, h, extra = {}) => refundFor({ policy, paidPence: 4000, hoursBefore: h, ...extra }, S);
  assert.equal(r('flexible', 25), 4000);
  assert.equal(r('flexible', 23), 0);
  assert.equal(r('moderate', 120), 4000, 'five days is in');
  assert.equal(r('moderate', 119), 0);
  assert.equal(r('strict', 200), 2000, 'strict: half, up to seven days');
  assert.equal(r('strict', 100), 0);
  assert.equal(r('strict', 1, { cause: 'host_cancelled' }), 4000);
  assert.equal(r('strict', 1, { cause: 'called_off' }), 4000);
  assert.equal(r('strict', 1, { cause: 'date_changed' }), 4000, 'a guest leaving after the host moved the date');
  assert.equal(r('flexible', 500, { courseStarted: true }), 0, 'a course that has started refunds nothing');
  assert.equal(r('mystery', 500), null, 'an unknown policy: a person decides');
});

test('depends on numbers: everyone pays the minimum price, and the difference comes back', () => {
  assert.deepEqual(numbersSettlement({ totalPence: 30000, minCount: 6, heads: 10 }), { paidEach: 5000, finalEach: 3000, backEach: 2000 });
  assert.deepEqual(numbersSettlement({ totalPence: 30000, minCount: 6, heads: 6 }), { paidEach: 5000, finalEach: 5000, backEach: 0 });
  assert.deepEqual(numbersSettlement({ totalPence: 1000, minCount: 3, heads: 7 }), { paidEach: 334, finalEach: 143, backEach: 191 }, 'rounded up: the host is never short');
});

test('a payout: 72 hours after the session, earlier on a guest’s yes, held by a complaint, never by the host’s own marks', () => {
  const endsAt = '2026-10-01T18:00:00Z';
  const at = (h) => new Date(new Date(endsAt).getTime() + h * 3_600_000);
  assert.deepEqual(payoutDecision({ endsAt, now: at(71) }, S), { state: 'wait', releaseAt: at(72) });
  assert.deepEqual(payoutDecision({ endsAt, now: at(72) }, S), { state: 'release', by: 'time' });
  assert.deepEqual(payoutDecision({ endsAt, now: at(2), guestConfirmed: true }, S), { state: 'release', by: 'guest_confirmed' });
  assert.deepEqual(payoutDecision({ endsAt, now: at(2), reviewed: true }, S), { state: 'release', by: 'review' });
  assert.equal(payoutDecision({ endsAt, now: at(2), guestConfirmed: true }, { ...S, payout_early_on_confirm: false }).state, 'wait', 'the early release is a setting');
  assert.equal(payoutDecision({ endsAt, now: at(-1), guestConfirmed: true }, S).state, 'wait', 'never before the session ends');
  assert.deepEqual(payoutDecision({ endsAt, now: at(500), complaintOpen: true }, S), { state: 'held', reason: 'complaint' });
  assert.deepEqual(payoutDecision({ endsAt, now: at(500), taxMissing: true }, S), { state: 'held', reason: 'tax_details' });
  assert.deepEqual(payoutDecision({ endsAt, now: at(500), stripeReady: false }, S), { state: 'held', reason: 'stripe_incomplete' });
  assert.deepEqual(payoutDecision({ endsAt, now: at(500) }, { ...S, payout_release: null }), { state: 'held', reason: 'not_set' });
  assert.equal(payoutDecision({ endsAt, now: at(2), attended: true, present: 12 }, S).state, 'wait', 'the host marking everyone in releases nothing');
});

test('a change inside 48 hours counts against the host', () => {
  assert.equal(isLate('2026-10-03T12:00:00Z', S, NOW), true);
  assert.equal(isLate('2026-10-05T12:00:00Z', S, NOW), false);
  assert.equal(isLate('2026-10-05T12:00:00Z', {}, NOW), null);
});

test('the price of a booking: per person, children, one price a booking, a group discount', () => {
  assert.deepEqual(priceBooking({ pricePence: 2000, childPence: 1000, adults: 2, children: 3 }).valuePence, 7000);
  const g = priceBooking({ pricePence: 2000, adults: 6, groupPct: 10, groupMin: 6 });
  assert.deepEqual([g.grossPence, g.discountPence, g.valuePence], [12000, 1200, 10800]);
  assert.equal(priceBooking({ pricePence: 2000, adults: 5, groupPct: 10, groupMin: 6 }).discountPence, 0);
  assert.deepEqual(priceBooking({ pricePence: 9000, adults: 4, per: 'booking' }).valuePence, 9000, 'On request: one price a booking');
});

test('a setting is checked against its unit before it is written', () => {
  const row = (key, unit, label = key) => ({ key, unit, label });
  assert.equal(checkSetting(row('minimum_fee', 'pence'), { value: 200 }).ok, true);
  assert.equal(checkSetting(row('minimum_fee', 'pence'), { value: 1.5 }).ok, false, 'pence are whole');
  assert.equal(checkSetting(row('minimum_fee', 'pence'), { value: null }).ok, false, 'only a to-set value may be null');
  assert.equal(checkSetting(row('guarantee_pool', 'pence'), { value: null }).ok, true);
  assert.equal(checkSetting(row('minimum_fee', 'pence'), { isOn: false }).ok, true, 'the minimum has a switch');
  assert.equal(checkSetting(row('payout_release', 'hours'), { isOn: false }).ok, false, 'payout release does not');
  assert.equal(checkSetting(row('public_commission', 'ladder'), { value: [{ pct: 20 }, { pct: 25, ratedEvents: 5, avgAtLeast: 4.5 }] }).ok, false, 'a step is cheaper, never dearer');
  assert.equal(checkSetting(row('public_commission', 'ladder'), { value: S.public_commission }).ok, true);
  assert.equal(checkSetting(row('refund_terms', 'refunds'), { value: { flexible: { fullHoursBefore: 24 } } }).ok, false, 'all three policies');
  assert.equal(checkSetting(row('refund_terms', 'refunds'), { value: S.refund_terms }).ok, true);
  assert.equal(checkSetting(row('payout_early_on_confirm', 'switch'), { value: 'yes' }).ok, false);
  assert.equal(settingWords({ unit: 'refunds', value: S.refund_terms }), 'Flexible 24h · Moderate 5 days · Strict 50% to 7 days');
  assert.equal(settingWords({ unit: 'pence', value: null }), '—', 'still to set: a dash');
});

test('the settings are laid over the lanes’ config, last, and a bad layer is ignored', () => {
  try {
    useSettingsOverlay(configOverlay({ ...S, pro_monthly: 1499, ask_to_book_window: 12 }));
    const cfg = hostingConfig({});
    assert.equal(cfg.proMonthlyPence, 1499);
    assert.equal(cfg.onRequest.respondHours, 12);
    assert.equal(cfg.onRequest.noticeHours, 48);
    assert.deepEqual(cfg.onRequest.lengths, DEFAULT_CONFIG.onRequest.lengths, 'what the settings do not own stays');
    useSettingsOverlay({ publicShare: 'nonsense' });
    assert.deepEqual(hostingConfig({}).publicShare, DEFAULT_CONFIG.publicShare, 'malformed: ignored, never half-applied');
  } finally { useSettingsOverlay(null); }
});
