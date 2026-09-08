/**
 * The door, tested at the level where getting it wrong is silent.
 *
 * A passcode check that returns true for the wrong length, a "public" list that
 * quietly matches more than it means to, an origin allowlist that lets anything
 * through — none of these break a screen. They just stop protecting anything,
 * and nobody notices until it matters.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const withPasscode = async (value, fn) => {
  const before = process.env.EPIC_PASSCODE;
  if (value === null) delete process.env.EPIC_PASSCODE; else process.env.EPIC_PASSCODE = value;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.EPIC_PASSCODE; else process.env.EPIC_PASSCODE = before;
  }
};

const { authConfigured, isPublicPath, originAllowed, passcodeMatches } = await import('../src/auth.js');

test('the right passcode opens it and nothing else does', async () => {
  await withPasscode('correct horse battery staple', () => {
    assert.equal(passcodeMatches('correct horse battery staple'), true);
    assert.equal(passcodeMatches('correct horse battery stapl'), false, 'one character short');
    assert.equal(passcodeMatches('correct horse battery staple '), false, 'one character long');
    assert.equal(passcodeMatches('CORRECT HORSE BATTERY STAPLE'), false, 'case matters');
    assert.equal(passcodeMatches(''), false);
    assert.equal(passcodeMatches(undefined), false);
    assert.equal(passcodeMatches(null), false);
  });
});

test('a passcode of a different length is refused rather than throwing', async () => {
  // timingSafeEqual throws on a length mismatch; the guard around it is the
  // difference between "wrong passcode" and a 500 that tells you the length.
  await withPasscode('short', () => {
    assert.doesNotThrow(() => passcodeMatches('a much longer guess entirely'));
    assert.equal(passcodeMatches('a much longer guess entirely'), false);
  });
});

test('with no passcode set, nothing matches at all', async () => {
  await withPasscode(null, () => {
    const configured = authConfigured();
    // Locally there is a development fallback; deployed there is not. Either
    // way the empty string must never be the passcode.
    assert.equal(passcodeMatches(''), false);
    assert.equal(passcodeMatches(undefined), false);
    if (!configured) assert.equal(passcodeMatches('epic-dev'), false);
  });
});

test('the kinds of path that answer without a session', () => {
  const open = (method, path) => isPublicPath({ method, path });

  assert.equal(open('GET', '/health'), true);
  assert.equal(open('GET', '/robots.txt'), true);
  assert.equal(open('POST', '/api/session'), true);
  assert.equal(open('GET', '/api/join/abc123'), true);
  assert.equal(open('POST', '/api/join/abc123/items/xyz'), true);
  // The code on a restaurant table: one sitting's dishes, for the waiter.
  assert.equal(open('GET', '/api/order/abc123'), true);

  // Everything the household owns is behind the door.
  for (const path of [
    '/api/household', '/api/household/export', '/api/trips', '/api/atlas/places',
    '/api/visits', '/api/plan', '/api/sessions', '/api/photos/google', '/api/orders',
    // The ticket is one order behind one token, and nothing above or below it.
    '/api/order', '/api/order/abc123/anything', '/api/orders/abc123',
  ]) assert.equal(open('GET', path), false, `${path} must need a session`);
});

/**
 * A photograph carries its own key (sources/photoLinks.js).
 *
 * An `<img>` cannot send a header, and the session cookie is third-party
 * between the site and the API — blocked by Safari, going in Chrome — so every
 * rented picture came back 401 and every tile fell back to its icon (owner,
 * 8 Sep 2026). The link proves Epic issued it instead. What must stay true is
 * that only a *good* link gets through.
 */
test('a photograph is let through by its own signature, and by nothing less', async () => {
  const { stampPhoto } = await import('../src/sources/photoLinks.js');
  const name = 'places/ChIJexample/photos/AXQxyz';
  const { sig, exp } = stampPhoto({ ref: name });

  const ask = (query) => isPublicPath({ method: 'GET', path: '/api/photos/google', query });

  // The wire form — what `VenueThumb` actually puts in the URL.
  assert.equal(ask({ name, s: sig, e: exp }), true, 'a good link opens it');
  // And the long names, which is what stampPhoto calls them on the object.
  assert.equal(ask({ name, sig, exp }), true);

  // Nothing less does.
  assert.equal(ask({}), false, 'no link at all');
  assert.equal(ask({ name }), false, 'a name on its own');
  assert.equal(ask({ name, s: sig, e: Date.now() - 1000 }), false, 'expired');
  assert.equal(ask({ name, s: 'not-the-signature', e: exp }), false, 'a made-up signature');
  // A signature is good for the one photograph it was made for.
  assert.equal(ask({ name: 'places/ChIJother/photos/AXQzzz', s: sig, e: exp }), false, 'lifted onto another picture');
  // And a POST is never a picture.
  assert.equal(isPublicPath({ method: 'POST', path: '/api/photos/google', query: { name, s: sig, e: exp } }), false);
});

test('a path that merely starts with a public one is not public', () => {
  // The join test is a prefix match, so this is the shape that would let
  // `/api/joinery` or `/api/sessionsecret` through if it were written loosely.
  assert.equal(isPublicPath({ method: 'GET', path: '/api/joinery' }), false);
  assert.equal(isPublicPath({ method: 'GET', path: '/api/sessions' }), false);
  assert.equal(isPublicPath({ method: 'GET', path: '/health/secret' }), false);
});

test('the origin list, when the owner has set one', () => {
  const before = process.env.EPIC_WEB_ORIGIN;
  try {
    process.env.EPIC_WEB_ORIGIN = 'https://epic.example.com, https://epic-web.up.railway.app/';
    assert.equal(originAllowed('https://epic.example.com'), true);
    assert.equal(originAllowed('https://epic-web.up.railway.app'), true, 'a trailing slash is the same origin');
    assert.equal(originAllowed('https://epic.example.com.evil.test'), false);
    assert.equal(originAllowed('http://epic.example.com'), false, 'scheme is part of an origin');
    assert.equal(originAllowed(undefined), true, 'no Origin header at all: curl, a native app, same-origin');

    process.env.EPIC_WEB_ORIGIN = '';
    assert.equal(originAllowed('https://anything.test'), true, 'unset: the passcode is the guard');
  } finally {
    if (before === undefined) delete process.env.EPIC_WEB_ORIGIN; else process.env.EPIC_WEB_ORIGIN = before;
  }
});
