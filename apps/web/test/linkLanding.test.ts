/**
 * Where a sign-in link lands (G21; Codex, 3 Oct 2026): the page the link
 * carries wins over the page this device remembered, which wins over the
 * role's landing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { linkLanding } from '../src/linkLanding.ts';

test("the link's own page wins over the device's remembered one", () => {
  assert.equal(linkLanding('/experiences/e1/book', '/plans', '/account'), '/experiences/e1/book');
});

test('with no page on the link, the remembered one; with neither, the role decides', () => {
  assert.equal(linkLanding(null, '/plans', '/account'), '/plans');
  assert.equal(linkLanding(null, null, '/account'), '/account');
});
