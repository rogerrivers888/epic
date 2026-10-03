/**
 * The subcategory guides (src/site/guides/guides.json): one file read by the
 * page and by the web server (guides.mjs), so these hold the rules the brief
 * sets for every guide — and the two halves — in step.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE_SLUGS, GUIDE_TITLES, parseRoute, titleOf } from '../src/routes.ts';
import { consentFor, reviewedWords, type Guide } from '../src/site/guides/index.ts';
// @ts-ignore -- a plain .mjs helper shared with server.mjs, no types
import { guideHead, guideSitemapEntries, loadGuides } from '../guides.mjs';

const raw = JSON.parse(readFileSync(new URL('../src/site/guides/guides.json', import.meta.url), 'utf8'));
delete raw['//'];
const GUIDES = raw as Record<string, Guide>;

test('the routes and the copy name the same guides', () => {
  assert.deepEqual(Object.keys(GUIDES).sort(), [...GUIDE_SLUGS].sort());
  // The tab (titleOf) and the HTML the server writes say the same title.
  for (const slug of GUIDE_SLUGS) {
    assert.equal(GUIDE_TITLES[slug], GUIDES[slug].title);
    assert.equal(titleOf(parseRoute(`/en-gb/events/${slug}`)), GUIDES[slug].title);
  }
});

test('the API keeps exactly the consent sentence each guide shows', () => {
  const api = JSON.parse(readFileSync(new URL('../../api/src/sources/consentWordings.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(api.guide).sort(), [...GUIDE_SLUGS].sort());
  for (const slug of GUIDE_SLUGS) assert.equal(api.guide[slug], consentFor(GUIDES[slug]), `${slug}: update apps/api/src/sources/consentWordings.json`);
});

test('no prices, events or host names on a launch guide', () => {
  for (const [slug, g] of Object.entries(GUIDES)) {
    const text = JSON.stringify(g);
    assert.doesNotMatch(text, /£|\$\d|€|\bper (person|session|child)\b|\bfrom £/i, `${slug} quotes a price`);
    assert.doesNotMatch(text, /Example host/i, `${slug} names an invented host`);
  }
});

test('the SEO the brief fixes, the FAQ counts, and a review date', () => {
  assert.equal(GUIDES.pottery.title, 'Pottery classes: what to expect and how to start · Epic Events');
  assert.equal(GUIDES['fossil-hunting'].title, 'Fossil hunting in the UK: where, when and how · Epic Events');
  assert.equal(`${GUIDES.pottery.h1a} ${GUIDES.pottery.h1b}`, 'Pottery classes');
  assert.equal(`${GUIDES['fossil-hunting'].h1a} ${GUIDES['fossil-hunting'].h1b}`, 'Fossil hunting');
  assert.equal(GUIDES.pottery.faqs.length, 8);
  assert.equal(GUIDES['fossil-hunting'].faqs.length, 7);
  for (const g of Object.values(GUIDES)) {
    assert.match(g.reviewed, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(g.description.length >= 100 && g.description.length <= 160, `${g.name}: description is ${g.description.length}`);
    assert.equal(new Set(g.blocks.map((b) => b.id)).size, g.blocks.length, `${g.name}: section anchors are unique`);
  }
  assert.equal(reviewedWords('2026-10-03'), '3 October 2026');
});

test('every guide is its own words: no paragraph is shared between two', () => {
  const seen = new Map<string, string>();
  for (const [slug, g] of Object.entries(GUIDES)) {
    for (const b of g.blocks) for (const p of [...(b.p ?? []), ...(b.p2 ?? [])]) {
      assert.ok(!seen.has(p) || seen.get(p) === slug, `"${p.slice(0, 40)}…" is in ${seen.get(p)} and ${slug}`);
      seen.set(p, slug);
    }
  }
});

test('the server writes the head from the same words: title, FAQPage = the FAQs, Article dated by the review', async () => {
  const all = await loadGuides();
  const h = guideHead(all.pottery, { appUrl: 'https://epic.day', locale: 'en-gb', slug: 'pottery' });
  assert.equal(h.title, GUIDES.pottery.title);
  assert.equal(h.canonical, 'https://epic.day/en-gb/events/pottery');
  const [crumbs, article, faq] = h.jsonld as any[];
  assert.deepEqual(crumbs.itemListElement.map((i: { name: string }) => i.name), ['Events', 'Culture', 'Pottery']);
  assert.equal(article['@type'], 'Article');
  assert.equal(article.dateModified, GUIDES.pottery.reviewed);
  assert.deepEqual(faq.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text]), GUIDES.pottery.faqs);
  // Unpublished: drawn for review, but noindex and out of the sitemap.
  for (const slug of GUIDE_SLUGS) {
    const head = guideHead({ ...all[slug], published: false }, { appUrl: 'https://epic.day', locale: 'en-gb', slug });
    assert.equal(head.robots, 'noindex');
  }
  assert.deepEqual(guideSitemapEntries({ pottery: { ...all.pottery, published: false } }, ['en-gb']), []);
  assert.deepEqual(guideSitemapEntries({ pottery: { ...all.pottery, published: true } }, ['en-gb']), [{ path: '/en-gb/events/pottery', lastmod: all.pottery.reviewed }]);
  assert.equal(guideHead({ ...all.pottery, published: true }, { appUrl: 'https://epic.day', locale: 'en-gb', slug: 'pottery' }).robots, null);
});
