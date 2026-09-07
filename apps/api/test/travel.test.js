/**
 * Getting there (trip rebuild, 7 Sep 2026, screen 5d).
 *
 * The three pieces of arithmetic on that screen that nobody would notice being
 * wrong until they had missed a flight, plus the one thing Epic promises about
 * a flight number it cannot look up: that it says so rather than guessing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { airlineName, leaveHomeBy, money, parseFlightNumber, transferEstimates } from '../src/sources/flights.js';

test('a flight number is two letters and up to four digits, however it is typed', () => {
  assert.deepEqual(parseFlightNumber('BA548'), { airlineCode: 'BA', number: '548', normalised: 'BA 548' });
  assert.deepEqual(parseFlightNumber('ba 548'), { airlineCode: 'BA', number: '548', normalised: 'BA 548' });
  assert.deepEqual(parseFlightNumber('ba-548'), { airlineCode: 'BA', number: '548', normalised: 'BA 548' });
  // A designator can carry a digit — easyJet is U2, Norwegian Air Sweden is D8.
  assert.equal(parseFlightNumber('U2 8021').normalised, 'U2 8021');
  assert.equal(parseFlightNumber('EZY8021').airlineCode, 'EZY');
  // And what is not one comes back null rather than being half-read.
  assert.equal(parseFlightNumber(''), null);
  assert.equal(parseFlightNumber('Ryanair to Rome'), null);
  assert.equal(parseFlightNumber('12345678'), null);
});

test('an airline we do not know is answered with nothing, not with a guess', () => {
  assert.equal(airlineName('BA'), 'British Airways');
  assert.equal(airlineName('ba'), 'British Airways');
  assert.equal(airlineName('ZZ'), null);
  assert.equal(airlineName(undefined), null);
});

/**
 * "flight 'leave home by' = departure − 2h − drive" (the handoff's own rule).
 *
 * The case worth pinning is the early flight: a 06:00 departure from an hour
 * away is a 03:00 start, and a 05:00 departure from two hours away is the night
 * before — which the screen has to be able to say, rather than clamping to
 * midnight and telling somebody to leave after the plane has gone.
 */
test('when to leave home is the departure minus the airport minus the drive', () => {
  assert.deepEqual(leaveHomeBy('07:35', 40), { time: '04:55', dayBefore: false });
  assert.deepEqual(leaveHomeBy('06:00', 60), { time: '03:00', dayBefore: false });
  // Before midnight: the answer is a time on the previous day, and it says so.
  assert.deepEqual(leaveHomeBy('01:30', 45), { time: '22:45', dayBefore: true });
  // A station wants forty minutes, not two hours — the caller sets it.
  assert.deepEqual(leaveHomeBy('09:04', 20, { atTerminalMinutes: 30 }), { time: '08:14', dayBefore: false });
  // Nothing to work from is null, not a wrong time.
  assert.equal(leaveHomeBy(null, 40), null);
  assert.equal(leaveHomeBy('07:35', null), null);
});

test('the transfer at the far end is three estimates, and a train only where there is one', () => {
  const fco = { lat: 41.8003, lng: 12.2389 };
  const trastevere = { lat: 41.8869, lng: 12.4695 };

  const withRail = transferEstimates({ from: fco, to: trastevere, party: 4, currency: 'EUR', hasRail: true, nights: 4 });
  assert.deepEqual(withRail.map((o) => o.mode), ['train', 'taxi', 'hire']);
  // A train is quicker than a taxi over that distance, which is the whole
  // reason the cell is worth drawing.
  assert.ok(withRail[0].minutes < withRail[1].minutes);
  // The fare is per head, so four people costs more than two.
  const two = transferEstimates({ from: fco, to: trastevere, party: 2, currency: 'EUR', hasRail: true, nights: 4 });
  assert.ok(withRail[0].estCostPence > two[0].estCostPence);
  // The hire car is priced by the nights, so a longer trip costs more.
  const week = transferEstimates({ from: fco, to: trastevere, party: 4, currency: 'EUR', hasRail: true, nights: 7 });
  assert.ok(week[2].estCostPence > withRail[2].estCostPence);

  // An airport with no rail link into the city offers no train, rather than
  // inventing a Leonardo Express that does not run.
  const noRail = transferEstimates({ from: fco, to: trastevere, party: 4, currency: 'EUR', hasRail: false, nights: 4 });
  assert.deepEqual(noRail.map((o) => o.mode), ['taxi', 'hire']);

  // Nowhere to go is no estimates, not three zeroes.
  assert.deepEqual(transferEstimates({ from: null, to: trastevere, party: 2 }), []);
  assert.deepEqual(transferEstimates({ from: fco, to: null, party: 2 }), []);
});

test('a fare is said in the currency of where they landed', () => {
  assert.equal(money(5600, 'EUR'), '€56');
  assert.equal(money(5500, 'GBP'), '£55');
  assert.equal(money(12000, 'USD'), '$120');
});
