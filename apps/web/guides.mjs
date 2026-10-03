/**
 * The subcategory guides, server side (Epic Events on the web › Subcategory
 * guides, 3 Oct 2026): the head a crawler reads for /{locale}/events/{slug} —
 * title, description, canonical, and schema.org BreadcrumbList, Article and
 * FAQPage — written into the shell so none of it waits on JavaScript.
 *
 * Read from src/site/guides/guides.json, the file the page draws from, so the
 * FAQPage is the FAQs a person sees and Article's dateModified is the "Last
 * reviewed" date on the page. Plain functions, tested without a server.
 */

import { promises as fs } from 'node:fs';

export async function loadGuides() {
  const all = JSON.parse(await fs.readFile(new URL('./src/site/guides/guides.json', import.meta.url), 'utf8'));
  delete all['//'];
  return all;
}

/**
 * The head for one guide. An unpublished guide is drawn (so it can be reviewed
 * on the deployed site) but noindex and out of the sitemap, until its brief's
 * "Before go-live" list is done and `published` is set.
 */
export function guideHead(g, { appUrl, locale, slug }) {
  const path = `/${locale}/events/${slug}`;
  const url = `${appUrl}${path}`;
  const headline = `${g.h1a} ${g.h1b}`;
  const image = g.photos.find((p) => p.src)?.src;
  // Events and the category have no page yet (the hub and category pages wait on
  // their design), so they are named without a link rather than pointing a crawler
  // at a 404. Give them `item` once /{locale}/events and its categories exist.
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Events' },
      { '@type': 'ListItem', position: 2, name: g.category.name },
      { '@type': 'ListItem', position: 3, name: g.name, item: url },
    ],
  };
  const epic = { '@type': 'Organization', name: 'Epic', url: appUrl };
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description: g.description,
    datePublished: g.reviewed,
    dateModified: g.reviewed,
    mainEntityOfPage: url,
    author: epic,
    publisher: epic,
    ...(image ? { image: `${appUrl}${image}` } : {}),
  };
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: g.faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
  return {
    path,
    title: g.title,
    description: g.description,
    canonical: url,
    type: 'article',
    image: image ? `${appUrl}${image}` : null,
    robots: g.published ? null : 'noindex',
    jsonld: [breadcrumbs, article, faq],
  };
}

/** The published guides' sitemap entries, `lastmod` the "Last reviewed" date. */
export function guideSitemapEntries(guides, locales) {
  return locales.flatMap((l) => Object.entries(guides)
    .filter(([, g]) => g.published)
    .map(([slug, g]) => ({ path: `/${l}/events/${slug}`, lastmod: g.reviewed })));
}
