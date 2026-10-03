/**
 * The guest booking rows' and booking page's words (screens/guest/bookingWords.ts):
 * who it's for (G14), Who's going with the grown-ups named, the waiting-list
 * place (G4, G30), Other times with Kate (G28), a booking's receipt (G22), and
 * What you told the host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { answersOf, cardExtra, dietChoices, formOf, monthOffset, namesWords, paymentsFor, presetSlot, waitPosition, whoGoingWords } from '../src/screens/guest/bookingWords.ts';

test('who it’s for, by name: one, two, three, then "and 2 more"; nobody named says nothing', () => {
  assert.equal(namesWords(['Ava']), 'Ava');
  assert.equal(namesWords(['Ava', 'Ravi']), 'Ava and Ravi');
  assert.equal(namesWords(['Priya', 'Ava', 'Ravi']), 'Priya, Ava and Ravi');
  assert.equal(namesWords(['Priya', 'Dev', 'Ava', 'Ravi']), 'Priya, Dev and 2 more');
  assert.equal(namesWords([' ', '']), null);
  assert.equal(namesWords(undefined), null);
});

test('a Plans row’s extra: the state that matters first, then who it’s for', () => {
  const now = Date.parse('2026-10-03T10:00:00Z');
  const base = { chip: 'on', who: ['Ava', 'Ravi'] };
  assert.equal(cardExtra(base, now), 'Ava and Ravi');
  assert.equal(cardExtra({ ...base, offered: { expiresAt: '2026-10-03T21:00:00Z' } }, now), '11 h left');
  assert.equal(cardExtra({ ...base, chip: 'waiting', numbers: { booked: 3, min: 4 } }, now), '3 of 4');
  assert.equal(cardExtra({ ...base, chip: 'not_this_time', holdReleased: true }, now), 'Hold released');
  assert.equal(cardExtra({ ...base, chip: 'called_off', refunded: true }, now), 'Refunded');
  assert.equal(cardExtra({ chip: 'on' }, now), null, 'an older booking with no names: no extra');
});

test('Who’s going names the grown-ups too; an older booking’s unnamed adults are counted', () => {
  assert.deepEqual(whoGoingWords({ heads: 4, adults: [{ name: 'Priya' }, { name: 'Dev' }], children: [{ name: 'Ava', age: 7 }, { name: 'Ravi', age: 4 }] }),
    { title: 'Priya, Dev, Ava · age 7, Ravi · age 4', sub: '4 people' });
  assert.deepEqual(whoGoingWords({ heads: 3, adults: [{ name: null }], children: [{ name: 'Ava', age: 7 }, { name: null, age: null }] }),
    { title: 'Ava · age 7, A child, 1 adult', sub: '3 people' });
  assert.equal(whoGoingWords({ heads: 3, adults: [{ name: 'Priya' }], children: [] }).title, 'Priya, 2 more adults');
  assert.deepEqual(whoGoingWords({ heads: 2, children: [] }), { title: '2 people', sub: '' }, 'nobody named: the count alone');
});

test('the waiting list: "You’re #3" for the list it would join, never another session’s', () => {
  const mine = [{ sessionId: null, position: 3, state: 'waiting' }];
  assert.equal(waitPosition(mine, null), 3);
  assert.equal(waitPosition(mine, 's1'), null);
  assert.equal(waitPosition([{ sessionId: 's1', position: 2, state: 'waiting' }], 's1'), 2);
  assert.equal(waitPosition([{ sessionId: null, position: 1, state: 'offered' }], null), null, 'offered: Book, not a place in line');
  assert.equal(waitPosition(undefined, null), null);
});

test('Other times with Kate: the time is picked on Book only while the host is still free then', () => {
  const now = new Date('2026-10-03T10:00:00Z');
  const slots = [{ date: '2026-10-10', times: ['13:00', '14:00'] }, { date: '2026-11-07', times: ['10:00'] }];
  assert.deepEqual(presetSlot(slots, '2026-10-10', '14:00', now), { month: 0, day: '2026-10-10', time: '14:00' });
  assert.deepEqual(presetSlot(slots, '2026-11-07', '13:00', now), { month: 1, day: '2026-11-07', time: null }, 'the day, not a time gone');
  assert.equal(presetSlot(slots, '2026-10-11', '13:00', now), null, 'not free that day');
  assert.equal(presetSlot(slots, null, null, now), null);
  assert.equal(monthOffset(now, '2027-01-02'), null, 'past the calendar’s three months');
  assert.equal(monthOffset(now, '2026-12-31'), 2);
});

test('a booking’s receipt: only that booking’s payments', () => {
  const rows = [{ id: 'p1', bookingId: 'b1' }, { id: 'p2', bookingId: 'b2' }, { id: 'p3', bookingId: null }];
  assert.deepEqual(paymentsFor(rows, 'b1').map((p) => p.id), ['p1']);
  assert.equal(paymentsFor(rows, null).length, 3);
});

test('What you told the host: the host’s own diet list, and only the questions asked are sent', () => {
  assert.deepEqual(dietChoices({ diet: { on: true, ticks: ['vegan', 'halal'] } }), ['Vegan', 'Halal']);
  assert.equal(dietChoices({}).length, 6, 'none set: the usual six');
  const asked = { diet: { on: true }, plusOne: { on: true }, bring: { on: true, items: [{ name: 'Salad' }] }, stay: { on: false } };
  const form = formOf({ dietary: 'Vegan', note: 'Hi', stay: 'The barn', needs: ['cot'] });
  assert.deepEqual(form, { diet: ['Vegan'], note: 'Hi', bring: null, stay: 'The barn', plusOne: false });
  assert.deepEqual(answersOf({ ...form, plusOne: true, bring: 'Salad', note: '  ' }, asked, { dietary: 'Vegan', needs: ['cot'], stay: 'The barn' }),
    { needs: ['cot'], dietary: ['Vegan'], plusOne: true, bring: 'Salad' }, 'stay was not asked; an empty note is no note; needs kept');
  assert.deepEqual(answersOf({ diet: ['Vegan'], note: '', bring: null, stay: null, plusOne: true }, { diet: { on: false } }, {}), {}, 'nothing asked: nothing sent but a note');
});
