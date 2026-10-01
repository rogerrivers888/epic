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

test('seasonal and date-bounded free entry is not universally free', () => {
  // The case that matters most: free in the months families do not go, read as free
  // all year, sends a family to a gate expecting not to pay (owner, 1 Oct 2026).
  assert.equal(free('<p>Free admission from November until March.</p>'), false);
  assert.equal(free('<p>Free admission during winter.</p>'), false);
  assert.equal(free('<p>Free entry in May.</p>'), false);
  assert.equal(free('<p>Free entry over Christmas.</p>'), false);
  assert.equal(free('<p>Free admission until 31st October.</p>'), false);
  assert.equal(free('<p>Free entry till 5pm.</p>'), false);
  // A free claim with anything else in its sentence is ambiguous and falls back to
  // Google — even a harmless "you may bring a picnic". Its own sentence is fine.
  assert.equal(free('<p>Admission is free and you may bring a picnic.</p>'), false);
  assert.equal(free('<p>Admission is free. You may bring a picnic.</p>'), true);
});

test('a zero-priced offer for one ticket type is not a free place', () => {
  const a = admissionFrom('<p></p>', { offers: [{ price: 0, name: 'Child' }, { price: 20, name: 'Family' }] });
  assert.equal(a?.free, false, 'a free child ticket beside a paid family one');
  assert.equal(a?.family, '£20');
  const b = admissionFrom('<p></p>', { offers: [{ price: 0, name: 'Child' }] });
  assert.notEqual(b?.free, true, 'a free child ticket alone does not make the place free');
  const c = admissionFrom('<p></p>', { offers: [{ price: 0, name: 'General admission' }] });
  assert.equal(c?.free, true, 'a free general ticket does');
});

test('a qualifier anywhere in the same sentence disqualifies the claim', () => {
  // Not a fixed window either side: the qualifier can sit a long way off (Codex).
  assert.equal(free('<p>Members of the National Trust and English Heritage currently receive free admission.</p>'), false);
  assert.equal(free('<p>Free admission to the house and the walled gardens and the woodland walks with an annual pass.</p>'), false);
  // The neighbouring sentence still does not count.
  assert.equal(free('<p>Members of the National Trust and English Heritage can park here. Admission is free.</p>'), true);
});

test('a short-lived free offer is not a standing free entry', () => {
  assert.equal(free('<p>Admission is free today only.</p>'), false);
  assert.equal(free('<p>Free admission tomorrow.</p>'), false);
  assert.equal(free('<p>Free admission for one day only.</p>'), false);
  assert.equal(free('<p>Free entry this weekend.</p>'), false);
  assert.equal(free('<p>Free entry on our open day.</p>'), false);
  assert.equal(free('<p>Free entry every day of the year.</p>'), true, 'a standing claim survives');
});

test('an audience the guard has never heard of still bars the claim', () => {
  // The lead is an allowlist: anybody named before the claim makes it somebody's free.
  assert.equal(free('<p>Disabled visitors receive free admission.</p>'), false);
  assert.equal(free('<p>Competition winners receive free admission.</p>'), false);
  assert.equal(free('<p>Free entry for disabled visitors.</p>'), false);
  assert.equal(free('<p>There is free entry for everyone.</p>'), true);
  assert.equal(free('<p>The museum and gardens: free entry, all year round.</p>'), true);
});

test('an exception or a narrower "all" in the sentence bars the claim', () => {
  assert.equal(free('<p>Admission is free except for ticketed exhibitions.</p>'), false);
  assert.equal(free('<p>Free admission for all military personnel.</p>'), false);
  assert.equal(free('<p>Free admission for all ages, every day of the year.</p>'), true);
  assert.equal(free('<p>Free entry to the gardens, open all year round.</p>'), true);
});
