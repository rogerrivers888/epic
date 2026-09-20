/**
 * The band rule, made loud.
 *
 * The owner, 20 Sep 2026: "if I ask for 30 minutes, nothing over 30 minutes
 * appears on screen, in any list, on any card, ever. Not one. Make that a test
 * that would fail loudly, not a behaviour that happens to be right today."
 *
 * So this file fails on the rule itself, not on an implementation detail: it
 * checks the fence, it checks that the fence and the card agree to the minute,
 * and it checks that the two ways a screen composes a list both go through it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withinBand, fenceToBand, minutesTo } from '../src/domain/band.js';
import { estimateTravelMinutes } from '../src/domain/travel.js';

const SUNNINGDALE = { lat: 51.39447, lng: -0.63244 };
// 27.8 km away, and 39 minutes by our own estimator: the spa in Chiswick.
const CHISWICK = { lat: 51.4938, lng: -0.2650 };
const WINDSOR = { lat: 51.4839, lng: -0.6044 };

test('nothing over the band, on any list, ever', () => {
  const asked = 30;
  assert.equal(withinBand(CHISWICK, { from: SUNNINGDALE, minutes: asked }), false,
    'forty minutes away is not inside thirty minutes, whatever the finder offered');
  assert.equal(withinBand(WINDSOR, { from: SUNNINGDALE, minutes: asked }), true);

  const kept = fenceToBand([CHISWICK, WINDSOR], { from: SUNNINGDALE, minutes: asked });
  assert.deepEqual(kept, [WINDSOR]);
});

test('the fence and the card are the same number', () => {
  // A screen that fences on one measurement and prints another contradicts
  // itself at the edge — two cards said "31 min drive" on a thirty-minute ring.
  const mine = minutesTo(SUNNINGDALE, CHISWICK, 'driving');
  const card = estimateTravelMinutes(SUNNINGDALE, CHISWICK, 'driving');
  assert.equal(mine, card);
});

test('exactly on the band is inside it, and a minute over is not', () => {
  // Built rather than guessed: walk out from the origin until the estimator
  // says thirty, then take the next step.
  let at = null;
  for (let km = 1; km < 60; km += 0.1) {
    const p = { lat: SUNNINGDALE.lat + km / 111.32, lng: SUNNINGDALE.lng };
    if (estimateTravelMinutes(SUNNINGDALE, p, 'driving') === 30) { at = p; break; }
  }
  assert.ok(at, 'there is a place exactly thirty minutes out');
  assert.equal(withinBand(at, { from: SUNNINGDALE, minutes: 30 }), true);
  const further = { lat: at.lat + 0.03, lng: at.lng };
  assert.ok(estimateTravelMinutes(SUNNINGDALE, further, 'driving') > 30);
  assert.equal(withinBand(further, { from: SUNNINGDALE, minutes: 30 }), false);
});

test('a place we cannot measure is a place we cannot show', () => {
  // No benefit of the doubt: the doubt is exactly how a forty-minute spa
  // reached a thirty-minute screen.
  assert.equal(withinBand({ lat: null, lng: null }, { from: SUNNINGDALE, minutes: 30 }), false);
  assert.equal(withinBand(WINDSOR, { from: null, minutes: 30 }), false);
  assert.equal(withinBand(WINDSOR, { from: SUNNINGDALE, minutes: undefined }), false);
});

test('the finder’s allowance never reaches a household screen', () => {
  // The rule in the shape it was broken: the matrix offers ten minutes past the
  // band, and every one of those must be put back before anybody sees it.
  const offered = [WINDSOR, CHISWICK];
  for (const asked of [5, 15, 30, 60, 90]) {
    const shown = fenceToBand(offered, { from: SUNNINGDALE, minutes: asked });
    for (const p of shown) {
      assert.ok(minutesTo(SUNNINGDALE, p) <= asked,
        `a place ${minutesTo(SUNNINGDALE, p)} minutes away was shown on a ${asked}-minute band`);
    }
  }
});

test('every screen composes its list through the one fence', () => {
  // The fence was written twice and the second copy drifted. This reads the
  // route rather than trusting it: if a new list is composed there, it has to
  // go through `withinBand`/`fenceToBand` like the others.
  const src = readFileSync(new URL('../src/routes/inspire.js', import.meta.url), 'utf8');
  assert.ok(/from '\.\.\/domain\/band\.js'/.test(src), 'inspire must use the shared band fence');
  assert.ok(!/estimateTravelMinutes\([^)]*\)\s*<=/.test(src),
    'a second, hand-rolled fence has appeared in the route — there must be one');
});
