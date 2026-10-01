/**
 * The public website's addresses on the server (site.mjs): one canonical
 * spelling of every page, a real 404 for a locale that is built but off and for
 * a page that is not there, and epic.day/ sending a visitor only ever to a live
 * locale (Technical Foundations › URL conventions; Decisions J2–J3).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// @ts-ignore -- a plain .mjs helper shared with server.mjs, no types
import { loadSite, localeFor, siteAddress } from '../site.mjs';

const req = (headers: Record<string, string>) => ({ headers });

test('every page has one spelling, and the others are 301s to it', async () => {
  const SITE = await loadSite();
  assert.deepEqual(siteAddress(SITE, '/en-gb/'), { locale: 'en-gb', page: 'home', landing: null, canonical: '/en-gb/' });
  assert.deepEqual(siteAddress(SITE, '/en-gb/host'), { locale: 'en-gb', page: 'host', landing: null, canonical: '/en-gb/host' });
  assert.deepEqual(siteAddress(SITE, '/en-gb/go/crew'), { locale: 'en-gb', page: 'home', landing: 'crew', canonical: '/en-gb/go/crew' });
  assert.deepEqual(siteAddress(SITE, '/en-gb'), { redirect: '/en-gb/' });
  assert.deepEqual(siteAddress(SITE, '/EN-GB/Host'), { redirect: '/en-gb/host' });
  assert.deepEqual(siteAddress(SITE, '/en-gb/host/'), { redirect: '/en-gb/host' });
  assert.deepEqual(siteAddress(SITE, '/en-gb//privacy'), { redirect: '/en-gb/privacy' });
});

test('a locale that is off, and a page that is not there, are 404s — never a soft 404', async () => {
  const SITE = await loadSite();
  assert.equal(siteAddress(SITE, '/en-us/')?.status, 404);
  assert.equal(siteAddress(SITE, '/en-us/host')?.status, 404);
  assert.equal(siteAddress(SITE, '/en-gb/nope')?.status, 404);
  assert.equal(siteAddress(SITE, '/en-gb/go/nope')?.status, 404);
  assert.equal(siteAddress(SITE, '/en-gb/host/more')?.status, 404);
});

test('an address outside a locale is the app, not the site', async () => {
  const SITE = await loadSite();
  for (const p of ['/', '/login', '/inspire', '/admin', '/in/abc', '/fr/', '/%E0%A4%A']) assert.equal(siteAddress(SITE, p), null, p);
});

test('epic.day/ sends a visitor to a live locale: saved choice, then language, then country', async () => {
  const SITE = await loadSite();
  assert.equal(localeFor(SITE, req({})), 'en-gb');
  assert.equal(localeFor(SITE, req({ cookie: 'a=1; epic_locale=en-gb' })), 'en-gb');
  // en-us is built but off: never a destination, whatever asks for it.
  assert.equal(localeFor(SITE, req({ cookie: 'epic_locale=en-us' })), 'en-gb');
  assert.equal(localeFor(SITE, req({ 'accept-language': 'en-US,en;q=0.9' })), 'en-gb');
  assert.equal(localeFor(SITE, req({ 'cf-ipcountry': 'US' })), 'en-gb');
  assert.equal(localeFor(SITE, req({ 'accept-language': 'fr-FR, en-GB;q=0.8' })), 'en-gb');
  assert.equal(localeFor(SITE, req({ 'cf-ipcountry': 'GB' })), 'en-gb');
});
