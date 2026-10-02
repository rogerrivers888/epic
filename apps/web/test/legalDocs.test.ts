/**
 * The legal pages are the owner's legal pack, sections 1–3 (owner, 2 Oct 2026),
 * with the company's details filled in and nothing of the drafting left showing
 * except the square-bracket placeholders he has still to fill.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIES, PRIVACY, TERMS, LAST_UPDATED } from '../src/site/pages/legal/legalDocs.ts';
import { parseLegal } from '../src/site/pages/legal/legalParse.ts';

test('the company is named as it is registered, and the contact is support@', () => {
  assert.match(TERMS, /MAKE IT EPIC LIMITED, a company registered in England and Wales under number 17445225, registered office 124 City Road, London EC1V 2NX/);
  assert.match(PRIVACY, /MAKE IT EPIC LIMITED \("Epic"\) is the controller/);
  for (const doc of [TERMS, PRIVACY, COOKIES]) {
    assert.doesNotMatch(doc, /\bLtd\b|Capital Office|124-128|privacy@epic\.day|\[company number\]|\[date\]/);
  }
  assert.equal(LAST_UPDATED, '2 October 2026');
  assert.match(PRIVACY, /ICO registration number: C2049207\b/);
});

test('nothing marked for deletion before publishing is published', () => {
  assert.doesNotMatch(COOKIES, /Implementation note|delete before publishing/i);
});

test('nothing in square brackets goes public, and the owner fills are in', () => {
  for (const doc of [TERMS, PRIVACY, COOKIES]) assert.doesNotMatch(doc, /\[[^\]]*\]/);
  assert.match(TERMS, /New subscribers get one month free\./);
  assert.match(TERMS, /at least 3 days before the trial ends/);
  assert.match(TERMS, /Settings › My Account/);
  assert.match(PRIVACY, /payment \(Stripe, for subscriptions and host payouts\)/);
  assert.match(PRIVACY, /analytics \(Google Analytics and Google Ads, only if you accept analytics and advertising cookies\)/);
  assert.match(PRIVACY, /If you are unhappy, contact support@epic\.day\./);
  assert.match(PRIVACY, /within 30 days/);
  assert.match(COOKIES, /use the Cookie settings link in the footer of any page/);
});

test('the cookie list is what epic.day stores, and nothing for analytics while the banner is off', () => {
  for (const name of ['epic.session', 'epic_session', 'epic_oauth', 'epic_locale', 'epic-offline', 'epic.after-sign-in']) {
    assert.ok(COOKIES.includes(name), `${name} is listed`);
  }
  assert.doesNotMatch(COOKIES, /\b_ga\b|_gcl|epic_consent/, 'no GA4/Ads or consent cookie until the banner is on');
});

test('the Markdown the pack uses is all understood: headings, lists, tables', () => {
  const blocks = parseLegal(PRIVACY);
  assert.ok(blocks.some((b) => b.kind === 'h' && b.text === 'Who we are'));
  const table = blocks.find((b) => b.kind === 'table');
  assert.ok(table && table.kind === 'table' && table.head.length === 3 && table.rows.length >= 10, 'the what-we-collect table, header and rows');
  assert.ok(blocks.some((b) => b.kind === 'ul'), 'the who-we-share-with list');
  assert.ok(!blocks.some((b) => b.kind === 'p' && /^\|/.test(b.text)), 'no table row left as a paragraph');
});
