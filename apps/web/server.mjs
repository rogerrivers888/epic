/**
 * The web service: static files, one address.
 *
 * This replaces `serve`, which cannot do the one thing the domain move needs —
 * a redirect that depends on the *host*. A `*.up.railway.app` bookmark and a
 * `www.` both have to land on https://epic.day, and Cloudflare cannot do it for
 * the Railway hostnames because it never sees them: they are the origin, not
 * the edge. So the app has to answer for itself.
 *
 * Everything else it does, `serve -s` did too: hashed assets cached forever,
 * `sw.js` never cached, and any path that is not a file falls through to
 * index.html, because the address bar is the app's state (Technical Constraints
 * §13.14) and `/trips/<id>/day/<dayId>` has to survive a reload.
 *
 * No dependency: it is one `http.createServer` and a content-type table, which
 * is less to read than the options of the package it replaces.
 */
import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteGateOn } from './gate.mjs';
import { loadSite, localeFor as localeOf, siteAddress as addressOf } from './site.mjs';
import { eventHead, hostHead, leftTheWeb, publicAddress, sitemapOf, withHead } from './events.mjs';

// The built app; a test points it at a folder of its own.
const ROOT = resolve(process.env.EPIC_WEB_ROOT || fileURLToPath(new URL('./dist', import.meta.url)));
const PORT = Number(process.env.PORT || 8080);

const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
const APP_URL = clean(process.env.EPIC_APP_URL || process.env.APP_URL) || 'https://epic.day';
// Where the web server asks the API for a public event or host page (events.mjs). The bundle's own
// EXPO_PUBLIC_API_URL is the same address, set on this service; EPIC_API_URL may point it elsewhere.
const API_URL = clean(process.env.EPIC_API_URL || process.env.EXPO_PUBLIC_API_URL) || 'https://api.epic.day';
// Category and subcategory pages wait on Claude Design; until they are on, an event that has left the web is a 410.
const CATEGORY_PAGES = ['on', '1', 'true', 'yes'].includes(String(process.env.EPIC_EVENT_CATEGORY_PAGES || '').trim().toLowerCase());
const APP_HOST = (() => { try { return new URL(APP_URL).host.toLowerCase(); } catch { return 'epic.day'; } })();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.xml': 'application/xml; charset=utf-8',
};

/**
 * Expo fingerprints what it builds, so those may be cached for a year. Nothing
 * else may: `index.html` names the current bundle, and a cached one points at a
 * file that is no longer there — which is a white screen, not a stale page.
 * `sw.js` is the worst of all to cache, because it is what decides how long
 * everything else lives.
 */
function cacheFor(pathname) {
  if (pathname === '/sw.js') return 'no-cache, no-store, must-revalidate';
  if (pathname.startsWith('/_expo/')) return 'public, max-age=31536000, immutable';
  // Self-hosted type: the version is in the file name (public/fonts), so it never changes in place.
  if (/^\/fonts\/[^/]+-v\d+-[^/]+\.woff2$/.test(pathname)) return 'public, max-age=31536000, immutable';
  if (pathname === '/' || pathname.endsWith('.html')) return 'no-cache';
  return 'public, max-age=3600';
}

/** Where this request should have gone, or null if it is already there. */
function redirectTo(req) {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  // Railway's own health check arrives on an internal hostname over plain HTTP.
  // Bouncing it would fail every deployment.
  if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.railway.internal')) return null;
  if (host === APP_HOST && proto !== 'http') return null;
  return `${APP_URL}${req.url || '/'}`;
}

/**
 * Is this somebody opening a page, or a file that should have been there?
 *
 * Only a navigation falls through to the app shell. A missing `/_expo/…js`
 * must 404 rather than be answered with HTML: a browser that asks for a script
 * and is handed a page fails somewhere far away from the cause, and "the
 * bundle index.html names is not deployed" is exactly the kind of thing that
 * needs to say so at the point it happens.
 */
function wantsApp(req, pathname) {
  if (pathname.startsWith('/_expo/')) return false;
  if (extname(pathname)) return false;
  return String(req.headers.accept || '').includes('text/html') || !req.headers.accept;
}

/** Resolve a URL path to a file inside dist, or null if it escapes or is missing. */
async function fileFor(pathname) {
  // A malformed escape (`/%E0%A4%A`) is not a file; it must never throw out of
  // the request and take the process with it (Codex, 1 Oct 2026).
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const wanted = resolve(join(ROOT, normalize(decoded)));
  // `normalize` collapses `..`, but a path that still starts outside dist is a
  // traversal attempt and gets nothing.
  if (wanted !== ROOT && !wanted.startsWith(ROOT + sep)) return null;
  try {
    const stat = await fs.stat(wanted);
    if (stat.isFile()) return { path: wanted, size: stat.size };
    if (stat.isDirectory()) return fileFor(join(pathname, 'index.html'));
  } catch { /* not there: the caller falls back to the app shell */ }
  return null;
}

/**
 * The first segment of an address as the app's router reads it (routes.ts ›
 * splitHref): empty segments dropped, each one decoded — so `//login` and
 * `/%6cogin` are the login page here exactly as they are in the browser
 * (Codex, 1 Oct 2026).
 */
function firstSegment(pathname) {
  for (const raw of pathname.split('/')) {
    if (!raw) continue;
    try { return decodeURIComponent(raw).toLowerCase(); } catch { return raw.toLowerCase(); }
  }
  return '';
}
/** The pages never for an index: the sign-in doors, the account page, the back office. */
const PRIVATE_FIRST = new Set(['login', 'account', 'admin', 'in']);

// --- the public website (Website & Registration) -----------------------------
// Which locale and page an address is, and where epic.day/ sends a visitor, live
// in site.mjs beside its tests; the head written into the shell is here.
const SITE = await loadSite();
/** The website is closed while the launch gate is up, unless it has been published on its own (seo.json › public). */
const siteClosed = () => siteGateOn() && SITE.public !== true;
/** The query keys the app itself reads at `/` (App.tsx › Routed, routes.ts › legacyHref). */
const APP_ROOT_PARAMS = ['signin', 'join', 'tab'];

let shell = null;
let shellAt = 0;
/** dist/index.html, read once per build. */
async function shellHtml() {
  const file = join(ROOT, 'index.html');
  const stat = await fs.stat(file);
  if (!shell || stat.mtimeMs !== shellAt) { shell = await fs.readFile(file, 'utf8'); shellAt = stat.mtimeMs; }
  return shell;
}
const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The shell with this page's head written in — lang, title, description,
 * canonical, hreflang for every live locale plus x-default, Open Graph — so
 * nothing a crawler reads waits on JavaScript (Technical Foundations › SEO). A
 * landing page is noindex and carries no alternates (J10).
 */
function withSiteHead(html, site) {
  const copy = SITE.copy[site.locale][site.page];
  const url = `${APP_URL}${site.canonical}`;
  const extra = site.landing
    ? ['<meta name="robots" content="noindex" />']
    : [
      ...SITE.liveLocales.map((l) => `<link rel="alternate" hreflang="${SITE.htmlLang[l]}" href="${attr(APP_URL + (site.page === 'home' ? `/${l}/` : `/${l}/${site.page}`))}" />`),
      `<link rel="alternate" hreflang="x-default" href="${attr(APP_URL)}/" />`,
    ];
  extra.push('<meta name="twitter:card" content="summary" />');
  // Whether the launch gate is up, so the app can draw the page at once when it
  // is down and ask for a sign-in only while it is up (src/site/SiteScreen.tsx).
  extra.push(`<meta name="epic-gate" content="${siteClosed() ? 'on' : 'off'}" />`);
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${SITE.htmlLang[site.locale]}"`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${attr(copy.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${attr(copy.description)}" />`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${attr(url)}" />`)
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${attr(url)}" />`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${attr(copy.title)}" />`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${attr(copy.description)}" />`)
    .replace('</head>', `  ${extra.join('\n    ')}\n  </head>`);
}

/** The API's public door, read-only; a failure is a status the page can answer with, never a throw. */
async function publicApi(path) {
  try {
    const r = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } });
    if (r.status === 404) return { status: 404 };
    if (!r.ok) return { status: 502 };
    return { status: 200, body: await r.json() };
  } catch { return { status: 502 }; }
}

/** The app shell at a status, for a page that is not (or no longer) there: never indexed, and the app says so. */
async function shellWith(res, status, req) {
  let html;
  try { html = await shellHtml(); } catch { res.writeHead(status, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
  res.writeHead(status, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache', 'x-robots-tag': 'noindex', 'content-length': Buffer.byteLength(html) });
  res.end(req.method === 'HEAD' ? undefined : html);
}

/**
 * A public event or host page, its short link, its photos and its sitemaps (Epic Events on the web, 3 Oct 2026).
 * Live public pages are indexed straight away; the app, booking, accounts and the back office stay behind the gate.
 */
async function servePublic(req, res, pub, search) {
  const send = (status, headers, body) => { res.writeHead(status, headers); res.end(req.method === 'HEAD' ? undefined : body); };
  if (pub.kind === 'photo') {
    let r;
    try { r = await fetch(`${API_URL}/api/public/media/${pub.id}`, { signal: AbortSignal.timeout(8000) }); } catch { r = null; }
    if (!r || !r.ok) { send(404, { 'content-type': 'text/plain', 'cache-control': 'no-cache' }, 'Not found'); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) { send(404, { 'content-type': 'text/plain' }, 'Not found'); return; }
    send(200, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' }, buf);
    return;
  }
  const locale = pub.locale ?? 'en-gb';
  if (pub.locale && !SITE.liveLocales.includes(pub.locale)) { await shellWith(res, 404, req); return; }
  const here = (path) => path.replace(/^\/[a-z]{2}-[a-z]{2}\//, `/${locale}/`);
  if (pub.kind === 'sitemap') {
    const r = await publicApi('/api/public/sitemap');
    if (r.status !== 200) { send(503, { 'content-type': 'text/plain', 'retry-after': '300' }, 'Try again shortly'); return; }
    const body = sitemapOf(APP_URL, (r.body[pub.which] ?? []).map((e) => ({ ...e, path: here(e.path) })));
    send(200, { 'content-type': TYPES['.xml'], 'content-length': Buffer.byteLength(body), 'cache-control': 'public, max-age=3600' }, body);
    return;
  }
  const r = await publicApi(pub.kind === 'host' ? `/api/public/hosts/${pub.code}` : `/api/public/events/${pub.code}`);
  if (r.status === 404) { await shellWith(res, 404, req); return; }
  if (r.status !== 200) { await shellWith(res, 503, req); return; }
  const page = r.body;
  const canonical = here(page.path);
  // The short link, an old slug, any other spelling: one 301 to the page's own address.
  if (pub.kind === 'short' || pub.asked !== canonical) {
    if (pub.kind !== 'short' && (page.status === 'gone' || page.status === 'expired')) { /* fall through to its answer below */ } else {
      send(301, { location: canonical + (pub.kind === 'short' ? '' : search), 'cache-control': 'no-cache' }, '');
      return;
    }
  }
  if (pub.kind === 'host' && page.status === 'gone') { await shellWith(res, 410, req); return; }
  if (page.status === 'gone' || page.status === 'expired') {
    const out = leftTheWeb(page, locale, CATEGORY_PAGES);
    if (out.status === 301) { send(301, { location: out.location, 'cache-control': 'no-cache' }, ''); return; }
    await shellWith(res, 410, req);
    return;
  }
  let html;
  try { html = await shellHtml(); } catch { send(404, { 'content-type': 'text/plain' }, 'Not found'); return; }
  const head = pub.kind === 'host' ? hostHead(page, { appUrl: APP_URL, locale }) : eventHead(page, { appUrl: APP_URL, locale, categoryPagesOn: CATEGORY_PAGES });
  const body = withHead(html, head, SITE.htmlLang?.[locale] ?? 'en-GB');
  const headers = { 'content-type': TYPES['.html'], 'content-length': Buffer.byteLength(body), 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' };
  // Indexed straight away while the website is open; the gate's blanket noindex never covers a live public page.
  if (head.robots || siteClosed()) headers['x-robots-tag'] = 'noindex'; else res.removeHeader('x-robots-tag');
  send(200, headers, body);
}

/** sitemap.xml, generated — never by hand: every live locale's indexable pages, each with its alternates. */
function sitemapXml() {
  const day = new Date(shellAt || Date.now()).toISOString().slice(0, 10);
  const href = (l, p) => `${APP_URL}${p === 'home' ? `/${l}/` : `/${l}/${p}`}`;
  const urls = SITE.liveLocales.flatMap((l) => ['home', ...SITE.pages].map((p) => [
    '  <url>',
    `    <loc>${href(l, p)}</loc>`,
    `    <lastmod>${day}</lastmod>`,
    ...SITE.liveLocales.map((x) => `    <xhtml:link rel="alternate" hreflang="${SITE.htmlLang[x]}" href="${href(x, p)}" />`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${APP_URL}/" />`,
    '  </url>',
  ].join('\n')));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * Any request that throws answers 500 and is logged, rather than rejecting a
 * promise nobody awaits — on a Node that ends the process, one bad request
 * would take the whole site down.
 */
const guarded = (handler) => (req, res) => {
  Promise.resolve(handler(req, res)).catch((err) => {
    console.error('epic-web: request failed —', err?.message || err);
    if (!res.headersSent) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('Something went wrong'); } else res.end();
  });
};

const server = http.createServer(guarded(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0].split('#')[0];
  // A health endpoint the deploy can watch — answered FIRST, before the canonical-host
  // redirect, because Railway's probe arrives on a non-canonical host (e.g.
  // healthcheck.railway.app) and a 301 there would fail every deployment (Codex). Railway
  // holds the old container serving until the new one answers this 200, so a deploy never
  // shows users a cold start (owner, 1 Oct 2026). The API has its own /health; this is the
  // web's, so one repo-root railway.json can name /health for both services.
  if (pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : 'ok'); return; }

  // While the launch gate is up, nothing of the unopened site should be indexed.
  // The web bundle itself is still served — the app decides what a logged-out
  // visitor sees, and the API is the wall on the data (apps/api/src/siteGate.js) —
  // but every response says noindex until epic.day opens.
  if (siteGateOn()) res.setHeader('x-robots-tag', 'noindex');

  const to = redirectTo(req);
  if (to) { res.writeHead(301, { location: to, 'cache-control': 'no-cache' }); res.end(); return; }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return;
  }

  // --- the public website ---------------------------------------------------
  const search = (req.url || '').includes('?') ? (req.url || '').slice((req.url || '').indexOf('?')) : '';
  // epic.day/ is Google's x-default: a 302 to the visitor's locale (J3), the
  // query carried along so a campaign's utm_*/gclid/fbclid reach the form. Only
  // the app's own links at the root (`/?signin=…`, `/?join=…`, `/?tab=…`) are
  // left for the app to answer (Codex, 1 Oct 2026).
  // While the gate is up the website is behind it (gate.mjs › siteLock): `/` stays
  // the app it has been, and the site's own pages ask for the gate's password.
  // Somebody signed in on this browser opens the app, not the website (owner,
  // 2 Oct 2026). The app sets `epic_app=1` while it holds a session (src/session.ts);
  // crawlers never carry it, so what they see of epic.day/ does not change.
  if (pathname === '/' && !APP_ROOT_PARAMS.some((k) => new URLSearchParams(search).has(k)) && /(?:^|;\s*)epic_app=1(?:;|$)/.test(String(req.headers.cookie || ''))) {
    res.writeHead(302, { location: `/inspire${search}`, 'cache-control': 'no-store', vary: 'Cookie' });
    res.end();
    return;
  }
  if (!siteClosed() && pathname === '/' && !APP_ROOT_PARAMS.some((k) => new URLSearchParams(search).has(k))) {
    // `epic_root` (one minute) tells the homepage this visit came from epic.day/,
    // so a browser signed in before `epic_app` existed is handed to the app on
    // its first visit too (src/site/SiteScreen.tsx).
    res.setHeader('set-cookie', 'epic_root=1; Max-Age=60; Path=/; SameSite=Lax');
    res.writeHead(302, { location: `/${localeOf(SITE, req)}/${search}`, 'cache-control': 'no-store', vary: 'Accept-Language, Cookie' });
    res.end();
    return;
  }
  // Public event and host pages, their short links, photos and sitemaps — before the site's own pages (events.mjs).
  const pub = publicAddress(pathname);
  if (pub) { await servePublic(req, res, pub, search); return; }
  const site = addressOf(SITE, pathname);
  // While the gate is up there is no public sitemap; the pages themselves are
  // served (noindex, above) and the app draws them only for somebody signed in.
  // No password dialog: a signed-in person must never see one (owner, 2 Oct 2026).
  if (siteClosed() && pathname === '/sitemap.xml') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Not found');
    return;
  }
  if (pathname === '/sitemap.xml') {
    res.removeHeader('x-robots-tag');
    await shellHtml().catch(() => null);
    const body = sitemapXml();
    res.writeHead(200, { 'content-type': TYPES['.xml'], 'content-length': Buffer.byteLength(body), 'cache-control': 'public, max-age=3600' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  if (site?.redirect) { res.writeHead(301, { location: site.redirect + search, 'cache-control': 'no-cache' }); res.end(); return; }
  if (site) {
    let html;
    try { html = await shellHtml(); } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    const status = site.status || 200;
    const body = status === 200 ? withSiteHead(html, site) : html;
    const headers = {
      'content-type': TYPES['.html'], 'content-length': Buffer.byteLength(body), 'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'strict-origin-when-cross-origin',
    };
    // A page that is not there, and a campaign landing page, are never indexed;
    // nor is anything while the site is closed. An open page lifts the launch
    // gate's blanket noindex set above.
    if (status !== 200 || site.landing || siteClosed()) headers['x-robots-tag'] = 'noindex';
    else res.removeHeader('x-robots-tag');
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  let found = await fileFor(pathname);
  if (!found && wantsApp(req, pathname)) found = await fileFor('/index.html');
  if (!found) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }

  const servedPath = found.path === resolve(join(ROOT, 'index.html')) ? '/index.html' : pathname;
  // The sign-in doors, the account page and the back office are never for an
  // index, gate or no gate (Decisions J4) — decided from the address asked for,
  // not the file that renders it, because every SPA route is the same index.html
  // and public pages (a host's profile, an experience, a tag) must stay findable
  // (Codex, 1 Oct 2026). The gate's blanket noindex above comes down with the
  // gate; this one stays.
  if (PRIVATE_FIRST.has(firstSegment(pathname))) res.setHeader('x-robots-tag', 'noindex');
  res.writeHead(200, {
    'content-type': TYPES[extname(found.path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': found.size,
    'cache-control': cacheFor(servedPath),
    // The app is never framed, and a browser should not guess at a type we
    // have already declared.
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'strict-origin-when-cross-origin',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(found.path).pipe(res);
}));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`epic-web serving ${ROOT} on 0.0.0.0:${PORT}, canonical ${APP_URL}`);
});
