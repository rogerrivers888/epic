/**
 * The host page, v6 "Four ways to host" with the v3 cards (signed off 2 Oct 2026): the four kinds
 * by how often they run, the cards' storyboard from start to end state, and the
 * picker offering the same four the waitlist API accepts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS } from '../src/site/pages/HostLanding.strings.ts';
import { stripAt } from '../src/site/pages/hostStrip.ts';

const gb = STRINGS['en-gb'];

test('four kinds, by how often they run, with the design\'s words', () => {
  assert.deepEqual(gb.kinds.map((k) => k.tag), ['One-off', 'Weekly', 'Course', 'On request']);
  assert.equal(gb.kinds[0].title, 'A private or\npublic event.', 'the One-off break is forced after "or"');
  // The v3 handoff's cards (2 Oct 2026).
  assert.deepEqual(gb.kinds.map((k) => k.card), ['Fossil hunting with a geologist', 'Weekly pottery workshop', 'Learn to swim, ages 5–\u20608', 'A Thai cooking lesson at yours']);
  assert.equal(gb.kinds[2].kicker, '8 Saturdays · 10 Jan – 7 Mar');
  assert.deepEqual(gb.kinds[2].pills, ['£96 per child']);
  assert.deepEqual(gb.kinds[3].pills, ['In your kitchen']);
  assert.deepEqual(gb.kinds[0].eg, ['Birthday party', 'Wedding', 'Quiz night', 'Craft fair']);
  for (const k of gb.kinds) assert.equal(k.eg.length, 4);
  assert.match(gb.intro, /a weekly club, a ten-week course\.$/);
  assert.equal(gb.invite.title, 'Private');
  assert.equal(gb.open.title, 'Public');
  assert.equal(gb.steps[0].d, 'A one-off, something weekly, a course, or time people book. Add a title, a photo and where it happens.');
});

test('the picker offers the four the waitlist accepts, one-off first', () => {
  assert.deepEqual(gb.close.kinds.map((k) => k.value), ['one-off', 'weekly', 'course', 'on-request']);
  assert.deepEqual(STRINGS['en-us'].close.kinds.map((k) => k.value), ['one-off', 'weekly', 'course', 'on-request']);
});

test('each card rolls from its start to its end state, never snapping', () => {
  const at = (kind: Parameters<typeof stripAt>[0], t: number) => stripAt(kind, t, false, gb.strip);
  assert.equal(at('one-off', 0).status, 'Min 5 · 4 booked');
  assert.equal(at('one-off', 4600).status, 'Min 5 · 5 booked');
  assert.equal(at('one-off', 0).pct, 80);
  assert.equal(at('one-off', 4600).pct, 100);
  assert.equal(at('one-off', 4600).full, true);
  assert.equal(at('weekly', 0).money, '£108');
  assert.equal(at('weekly', 4600).money, '£126');
  assert.equal(at('weekly', 4600).status, '7 of 8 booked');
  const mid = at('weekly', 1950).money!;
  assert.ok(mid !== '£108' && mid !== '£126', `the figure rolls through the middle (${mid})`);
  assert.equal(at('course', 0).status, '14 of 16');
  assert.equal(at('course', 4600).status, '15 of 16');
  assert.equal(at('on-request', 0).progress, '9 of 10 rated events at 4.8+');
  assert.equal(at('on-request', 4600).progress, '10 of 10 rated events at 4.8+');
  assert.equal(at('on-request', 4600).pct, 100);
  // The chip has dropped in and the result has risen by the end; neither at the start.
  assert.equal(at('one-off', 0).chip, 0);
  assert.equal(at('one-off', 4600).chip, 1);
  assert.equal(at('one-off', 0).rise, 0);
  assert.equal(at('one-off', 4600).rise, 1);
  // The strip dips to 30% at the loop's end and fades back in.
  assert.ok(Math.abs(at('one-off', 5800).stripOpacity - 0.3) < 1e-9);
  assert.ok(Math.abs(stripAt('one-off', 0, true, gb.strip).stripOpacity - 0.3) < 1e-9);
});

test('the fee is earned by rating, never by a count of events (Host v3 RULINGS › Charges)', () => {
  for (const l of ['en-gb', 'en-us'] as const) {
    const w = STRINGS[l].strip.onRequest;
    const all = [w.status, w.statusSaid, w.progress(9), ...w.result, w.resultSaid].join(' ');
    assert.doesNotMatch(all, /Epic Trusted|25 events|of 25/);
    assert.match(w.progress(9), /rated events/);
  }
});

test('no glyph stands in for an icon in a strip', () => {
  for (const l of ['en-gb', 'en-us'] as const) {
    const w = STRINGS[l].strip;
    const all = [w.oneOff.result, w.weekly.result, w.course.result, w.onRequest.status, ...w.onRequest.result].join(' ');
    assert.doesNotMatch(all, /[✓★↑→]/);
  }
});

test('the US page prices in dollars', () => {
  const us = STRINGS['en-us'];
  assert.equal(stripAt('weekly', 4600, false, us.strip).money, '$126');
  assert.deepEqual(us.kinds[1].pills, ['$18 a session']);
  assert.deepEqual(us.kinds[2].pills, ['$96 per child']);
  assert.equal(us.kinds[2].kicker, '8 Saturdays · Jan 10 – Mar 7');
});
