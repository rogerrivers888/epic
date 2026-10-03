/**
 * The guest booking screen's rules (screens/guest/whoGoing.ts): a child's age or
 * date of birth, the places-left cap on ticking and on + Add someone, the G26
 * sheet's title on a second decline, and G17's refund day.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ageAnswer, capToast, lastRefundAt, payProblemTitle, roomForOneMore } from '../src/screens/guest/whoGoing.ts';

test('age or date of birth: a whole number 0–17, or a date — nothing empty passes as nought', () => {
  assert.deepEqual(ageAnswer({ byDob: false, age: '7', dob: '' }), { age: 7, dob: null });
  assert.deepEqual(ageAnswer({ byDob: false, age: '0', dob: '' }), { age: 0, dob: null });
  assert.equal(ageAnswer({ byDob: false, age: '', dob: '' }), null);
  assert.equal(ageAnswer({ byDob: false, age: '18', dob: '' }), null);
  assert.equal(ageAnswer({ byDob: false, age: '4.5', dob: '' }), null);
  assert.deepEqual(ageAnswer({ byDob: true, age: '7', dob: '2019-05-02' }), { age: null, dob: '2019-05-02' });
  assert.equal(ageAnswer({ byDob: true, age: '7', dob: '' }), null);
});

test('the cap: no tick past the places left, and the toast says how many', () => {
  assert.equal(roomForOneMore(1, 2), true);
  assert.equal(roomForOneMore(2, 2), false);
  assert.equal(roomForOneMore(3, Infinity), true);
  assert.equal(capToast(1), 'Only 1 place left');
  assert.equal(capToast(2), 'Only 2 places left');
});

test('G26: the first decline is "Your card was declined"; declined again, "Payment didn’t go through"', () => {
  assert.equal(payProblemTitle('declined', 1), 'Your card was declined');
  assert.equal(payProblemTitle('declined', 2), 'Payment didn’t go through');
  assert.equal(payProblemTitle('failed', 0), 'Payment didn’t go through');
});

test('G17: the day the money went back is the latest refund’s', () => {
  assert.equal(lastRefundAt([]), null);
  assert.equal(lastRefundAt([{ at: '2026-09-21T09:00:00.000Z' }, { at: '2026-09-20T09:00:00.000Z' }]), '2026-09-21T09:00:00.000Z');
  assert.equal(lastRefundAt([{ at: null }]), null);
});

// --- Change how many are going (guest side batch C) --------------------------
import { cannotGo, partyBody, partyCap, partyCapToast, partyPeople, partyQuoteWords, type Who } from '../src/screens/guest/whoGoing.ts';

const rules = { ageMin: 6, ageMax: 10, partyMax: 4, dropOff: false, adultsOnly: false };
const pounds = (p: number) => `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`;

test('who can go on a change reads as it does on Book: greyed with the reason', () => {
  const kid = (age: number): Who => ({ key: 'k', name: 'Sam', adult: false, age, dob: null, memberId: null, line: '' });
  assert.equal(cannotGo(kid(4), rules, '2026-10-10'), 'Age 4 · this is for ages 6–10');
  assert.equal(cannotGo(kid(7), rules, '2026-10-10'), null);
  assert.equal(cannotGo({ ...kid(7), adult: true }, { ...rules, dropOff: true }, null), 'Drop off · children only');
  assert.equal(cannotGo(kid(7), { ...rules, adultsOnly: true }, null), 'Adults only');
  // A date of birth is read on the day of the session, not today.
  assert.equal(cannotGo({ ...kid(0), age: null, dob: '2016-10-11' }, rules, '2026-10-10'), null);
  assert.equal(cannotGo({ ...kid(0), age: null, dob: '2015-10-09' }, rules, '2026-10-10'), 'Age 11 · this is for ages 6–10');
});

test('the booking as it stands comes first, ticked, matched to the household by name; the rest of the household after', () => {
  const members = [
    { id: 'm-me', name: 'Roger', isMinor: false },
    { id: 'm-gina', name: 'Gina', isMinor: false },
    { id: 'm-sam', name: 'Sam', age: 8 },
    { id: 'm-ted', name: 'Ted', age: 5 },
  ];
  const { people, onBooking } = partyPeople({ heads: 3, adults: [{ name: null }, { name: 'Pat' }], children: [{ name: 'sam', age: 8, dob: null, needs: ['nuts'], emergencyContact: '07700 900000' }] }, members, 'm-me');
  // Pat is named, not in the household; the unnamed grown-up is you; Sam is the household's Sam, as booked.
  assert.deepEqual(onBooking, ['b-a-0', 'm-me', 'm-sam']);
  assert.deepEqual(people.map((p) => p.name), ['Pat', 'Roger', 'Sam', 'Gina', 'Ted']);
  const sam = people.find((p) => p.key === 'm-sam')!;
  assert.deepEqual([sam.age, sam.needs, sam.emergencyContact], [8, ['nuts'], '07700 900000']);
  // An older booking with a head count only: grown-ups it can't name are "A grown-up", never dropped.
  const old = partyPeople({ heads: 2, children: [] }, [], null);
  assert.deepEqual(old.people.map((p) => p.name), ['A grown-up', 'A grown-up']);
  assert.equal(old.onBooking.length, 2);
});

test('the cap on a change: what it holds now plus the fewest places left, never past the most from one household', () => {
  assert.equal(partyCap(2, [3, 1], 6), 3);
  assert.equal(partyCap(2, [5], 4), 4);
  // Places left unknown: only the household cap, and with none the server decides.
  assert.equal(partyCap(2, [null], 4), 4);
  assert.equal(partyCap(2, [null], null), Infinity);
  assert.equal(partyCapToast(2, 1, 3), 'Only 1 more place left');
  assert.equal(partyCapToast(2, 0, 2), 'No places left');
  assert.equal(partyCapToast(2, 5, 4), 'Up to 4 on one booking');
});

test('the party as the API takes it: grown-ups counted and named, each child with what the booking holds', () => {
  const chosen: Who[] = [
    { key: 'b-a-0', name: 'A grown-up', adult: true, age: null, dob: null, memberId: null, line: '' },
    { key: 'm-gina', name: 'Gina', adult: true, age: null, dob: null, memberId: 'm-gina', line: '' },
    { key: 'm-sam', name: 'Sam', adult: false, age: 8, dob: null, memberId: 'm-sam', line: '', needs: ['nuts'], emergencyContact: '07700 900000' },
    { key: 'x1', name: 'Kit', adult: false, age: null, dob: '2018-01-02', memberId: null, line: '' },
  ];
  const body = partyBody(chosen, { dropOff: true, contacts: { x1: ' 07700 900001 ' }, adultConfirmed: false });
  assert.equal(body.adults, 2);
  assert.deepEqual(body.adultNames, [null, 'Gina']);
  assert.deepEqual(body.children, [
    { name: 'Sam', age: 8, dob: undefined, needs: ['nuts'], emergencyContact: '07700 900000' },
    { name: 'Kit', age: undefined, dob: '2018-01-02', needs: [], emergencyContact: '07700 900001' },
  ]);
});

test('the lime line before confirming says what the change costs or gives back, from the quote', () => {
  const q = { fromHeads: 2, toHeads: 3, chargePence: 1200, refundPence: 0, feeKeptPence: 0, later: false };
  assert.equal(partyQuoteWords(q, 'moderate', pounds), 'You’ll pay £12 more');
  assert.equal(partyQuoteWords({ ...q, later: true }, null, pounds, 'Sat 1 Nov'), 'You’ll pay £12 more · taken on Sat 1 Nov');
  const fewer = { fromHeads: 3, toHeads: 2, chargePence: 0, refundPence: 800, feeKeptPence: 0, later: false };
  assert.equal(partyQuoteWords(fewer, 'moderate', pounds), 'You’ll get £8 back · Moderate policy');
  assert.equal(partyQuoteWords({ ...fewer, feeKeptPence: 50 }, 'flexible', pounds), 'You’ll get £8 back · Flexible policy · £0.50 cancellation fee kept');
  // Fewer and nothing back: the policy says why, never "no change".
  assert.equal(partyQuoteWords({ ...fewer, refundPence: 0 }, 'strict', pounds), 'Nothing comes back · Strict policy');
  assert.equal(partyQuoteWords({ ...q, chargePence: 0 }, null, pounds), 'No change to what you pay');
});
