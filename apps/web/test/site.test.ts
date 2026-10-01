/**
 * The public website's two halves agree: the web server (server.mjs) writes
 * titles, hreflang and status codes from src/site/seo.json; the app routes and
 * titles pages from routes.ts. If either moves alone, a crawler and a person
 * would see two different sites — so this holds them in step.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOME_DESIGNS, LIVE_SITE_LOCALES, SITE_LOCALES, SITE_PAGES, parseRoute, siteTitleOf } from '../src/routes.ts';

const seo = JSON.parse(readFileSync(new URL('../src/site/seo.json', import.meta.url), 'utf8'));

test('the server and the app agree on the locales, pages and designs', () => {
  assert.deepEqual(seo.locales, [...SITE_LOCALES]);
  assert.deepEqual(seo.liveLocales, [...LIVE_SITE_LOCALES]);
  assert.deepEqual(seo.pages, [...SITE_PAGES]);
  assert.deepEqual(seo.designs, [...HOME_DESIGNS]);
});

test('every public page has a title the app and the server agree on, inside the limits', () => {
  for (const locale of LIVE_SITE_LOCALES) {
    for (const page of ['home', ...SITE_PAGES]) {
      const copy = seo.copy[locale][page];
      assert.ok(copy, `${locale} ${page} has SEO copy`);
      const route = parseRoute(page === 'home' ? `/${locale}/` : `/${locale}/${page}`);
      assert.equal(route.name, 'site');
      assert.equal(siteTitleOf(route as never), copy.title, `${locale} ${page}: the tab and the HTML say the same title`);
      assert.ok(copy.title.startsWith('Epic'), `${page} title leads with the brand (J7)`);
      assert.ok(copy.title.length <= 60, `${page} title is ${copy.title.length} characters`);
      assert.ok(copy.description.length >= 140 && copy.description.length <= 155, `${page} description is ${copy.description.length} characters`);
    }
  }
});

test('every built locale has its own words, even while it is switched off', () => {
  for (const locale of SITE_LOCALES) for (const page of ['home', ...SITE_PAGES]) assert.ok(seo.copy[locale]?.[page]?.title, `${locale} ${page}`);
});
