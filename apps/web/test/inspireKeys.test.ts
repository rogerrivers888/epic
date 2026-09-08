import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * What the Inspire tab is allowed to remember between visits.
 *
 * One of these settings can empty the screen on its own. An hour's walk holds
 * four places around Sunningdale where an hour's drive holds a hundred and
 * seventy-two — Thorpe Park is twenty minutes by car and nearly two hours on
 * foot — so a `by=walk` remembered from a tap somebody made once means opening
 * the app days later to almost nothing, with no clue why.
 *
 * It is still in the address, so it follows you around while you are here. It
 * just must not outlive the visit until Settings has somewhere deliberate to
 * put a standing choice.
 */
const src = readFileSync(new URL('../src/screens/InspireScreen.tsx', import.meta.url), 'utf8');
const KEYS = (() => {
  const m = src.match(/const KEYS = \[([^\]]*)\]/);
  assert.ok(m, 'KEYS not found');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();

test('how you are travelling is not remembered between visits', () => {
  assert.ok(!KEYS.includes('by'), '`by` is sticky again — a remembered "walk" empties the screen');
});

test('nor is an open drawer, or a sub-category of a category you have left', () => {
  assert.ok(!KEYS.includes('place'), 'a drawer is open over a page, not a way of being set');
  assert.ok(!KEYS.includes('within'), 'a drawer of Culture means nothing in Sport');
});

test('but where you are looking, and how far, still are', () => {
  for (const k of ['at', 'where', 'locality', 'travel', 'rating', 'price', 'sort']) {
    assert.ok(KEYS.includes(k), `${k} should survive a visit — it describes how you look, not what is open`);
  }
});
