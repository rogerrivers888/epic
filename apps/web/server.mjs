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

const ROOT = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const PORT = Number(process.env.PORT || 8080);

const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
const APP_URL = clean(process.env.EPIC_APP_URL || process.env.APP_URL) || 'https://epic.day';
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
  const decoded = decodeURIComponent(pathname);
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

const server = http.createServer(async (req, res) => {
  const to = redirectTo(req);
  if (to) { res.writeHead(301, { location: to, 'cache-control': 'no-cache' }); res.end(); return; }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return;
  }

  const pathname = (req.url || '/').split('?')[0].split('#')[0];
  let found = await fileFor(pathname);
  if (!found && wantsApp(req, pathname)) found = await fileFor('/index.html');
  if (!found) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }

  const servedPath = found.path === resolve(join(ROOT, 'index.html')) ? '/index.html' : pathname;
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
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`epic-web serving ${ROOT} on 0.0.0.0:${PORT}, canonical ${APP_URL}`);
});
