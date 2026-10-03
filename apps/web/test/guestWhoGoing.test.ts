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
