/**
 * admissionFrom's free-entry guard (sources/site.js). A free claim counts only when
 * nothing qualifies it on EITHER side — "Members enjoy free admission" and "free entry
 * for children" are somebody's free, not everybody's. Confidently wrong is worse than
 * no price (owner; the Dover Castle bug), and the owned cost row now trusts this to
 * show Free, so the guard must hold both ways (Codex).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { admissionFrom } from '../src/sources/site.js';

const free = (html) => admissionFrom(html, {})?.free === true;

test('an unqualified free claim is free', () => {
  assert.equal(free('<p>Admission is free.</p>'), true);
  assert.equal(free('<p>Free entry to the gardens, open all year.</p>'), true);
  assert.equal(free('<p>There is no admission charge.</p>'), true);
});

test('a qualifier before the free claim disqualifies it', () => {
  assert.equal(free('<p>Members enjoy free admission all year.</p>'), false, 'members-only free is not universal');
  assert.equal(free('<p>Students get free entry with a valid card.</p>'), false);
});

test('a qualifier in an earlier sentence does not disqualify a free claim', () => {
  // flatten() drops the element boundary, so the leading check must stop at the
  // sentence terminator — the "Children" clause is not about the free admission.
  assert.equal(free('<p>Children can explore the play area.</p><p>Admission is free.</p>'), true);
  assert.equal(free('Students welcome. Entry is free.'), true);
});

test('a qualifier after the free claim disqualifies it', () => {
  assert.equal(free('<p>Free entry for children under 5.</p>'), false);
  assert.equal(free('<p>Free admission for NHS staff.</p>'), false);
});

test('a time-limited free claim is not universally free', () => {
  assert.equal(free('<p>Admission is free on Sundays.</p>'), false);
  assert.equal(free('<p>Free entry after 4pm.</p>'), false);
  assert.equal(free('<p>Free admission during term time.</p>'), false);
  // But a genuinely universal free claim is not caught by the temporal guard.
  assert.equal(free('<p>Free entry every day of the year.</p>'), true);
  assert.equal(free('<p>Admission is free.</p>'), true);
});

test('a colon introduces the restriction, not a new sentence', () => {
  // A colon must not be treated as a boundary, or the qualifier it introduces is lost.
  assert.equal(free('<p>Free entry: members only.</p>'), false);
  assert.equal(free('<p>Members: free admission all year.</p>'), false);
  // But a real prior sentence with a colon list does not qualify a later free claim.
  assert.equal(free('<p>Opening times: 9 to 5. Admission is free.</p>'), true);
});

test('a qualifier in the next sentence does not disqualify a free claim', () => {
  // The trailing check stops at the sentence boundary too, not only the leading one.
  assert.equal(free('<p>Admission is free.</p><p>Children can explore the play area.</p>'), true);
  assert.equal(free('Entry is free. Students are welcome.'), true);
});

test('a printed adult price is not free', () => {
  const a = admissionFrom('<p>Adults £12.00, children £6.00.</p>', {});
  assert.equal(a?.free, false, 'a place that charges is not free');
  assert.equal(a?.adult, '£12.00');
});
