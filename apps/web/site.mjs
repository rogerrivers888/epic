/**
 * The public website's addresses, server side (server.mjs).
 *
 * Plain functions over src/site/seo.json — the same file routes.ts is tested
 * against — so the server and the app read one description of the site.
 */

import { promises as fs } from 'node:fs';

// Locales, pages and each page's title and description come from one file that
// the app's routes are tested against (src/site/seo.json; test/site.test.ts), so
// the server and the app cannot describe two different sites.
export async function loadSite() {
  return JSON.parse(await fs.readFile(new URL('./src/site/seo.json', import.meta.url), 'utf8'));
}

/**
 * Where epic.day/ sends a visitor (Decisions J3): their saved choice, then their
 * browser's language, then the country the CDN saw; en-gb otherwise — only ever a
 * live locale. Inside a locale nothing redirects; the locale bar suggests instead.
 */
export function localeFor(SITE, req) {
  const saved = /(?:^|;\s*)epic_locale=([a-z-]+)/i.exec(String(req.headers.cookie || ''))?.[1]?.toLowerCase();
  if (saved && SITE.liveLocales.includes(saved)) return saved;
  for (const part of String(req.headers['accept-language'] || '').split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase();
    if (SITE.liveLocales.includes(tag)) return tag;
  }
  const country = String(req.headers['cf-ipcountry'] || '').trim().toLowerCase();
  return SITE.liveLocales.find((l) => country && l.endsWith(`-${country}`)) || 'en-gb';
}

/**
 * A public page's address, read the way routes.ts reads it, or null for one
 * that is not under a locale. A built-but-off locale or an unknown page is a
 * real 404 — no soft 404s — and any other spelling of a page (case, a missing or
 * extra slash, an escaped letter) is a 301 to its one canonical form
 * (Technical Foundations › URL conventions).
 */
export function siteAddress(SITE, pathname) {
  let segs;
  try { segs = pathname.split('/').filter(Boolean).map((x) => decodeURIComponent(x).toLowerCase()); } catch {
    // A malformed escape under a locale is a page that is not there — a real
    // 404, not the app shell answering 200 (Codex, 1 Oct 2026).
    const first = (pathname.split('/').find(Boolean) || '').toLowerCase();
    return SITE.locales.includes(first) ? { locale: first, status: 404 } : null;
  }
  const [locale, a, b, c] = segs;
  if (!SITE.locales.includes(locale)) return null;
  if (!SITE.liveLocales.includes(locale)) return { locale, status: 404 };
  let page; let landing = null; let canonical;
  if (!a) { page = 'home'; canonical = `/${locale}/`; }
  else if (a === 'go' && b && !c && SITE.designs.includes(b)) { page = 'home'; landing = b; canonical = `/${locale}/go/${b}`; }
  else if (!b && SITE.pages.includes(a)) { page = a; canonical = `/${locale}/${a}`; }
  else return { locale, status: 404 };
  if (pathname !== canonical) return { redirect: canonical };
  return { locale, page, landing, canonical };
}

