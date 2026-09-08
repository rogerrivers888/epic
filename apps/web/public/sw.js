/*
 * Epic's service worker: the part that makes the app open at all with no signal.
 *
 * The device's copy of the household's data lives in IndexedDB and is managed
 * by the app (src/offline/cache.ts). This file is only about the app itself —
 * the bundle, the fonts, the icons — because none of that is any use in a
 * pocket if the page cannot load in the first place.
 *
 * Two rules it must not break:
 *   • Nothing from /api is cached here. Every API answer is subject to a licence
 *     (Technical Constraints §4) and the decision about which ones may be kept
 *     is made in one place, offline/policy.ts, not twice.
 *   • Place photos are licensed content streamed through the API and are never
 *     stored, here or anywhere.
 */

const VERSION = 'epic-shell-v2';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// The document itself, so a cold start with no signal still has something to
// open. Everything else is cached as it is first used. The icons are *not* here:
// they are network-first now, and a SHELL copy would shadow the live one again.
const PRECACHE = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.allSettled(PRECACHE.map((p) => c.add(new Request(p, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isAsset = (url) =>
  /\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)
  || url.hostname === 'fonts.googleapis.com'
  || url.hostname === 'fonts.gstatic.com';

/*
 * The handful of assets whose names never change but whose contents do.
 *
 * Everything Expo emits carries a hash in its name, so serving a cached copy of
 * it can never be wrong. These do not: the icon set and the manifest keep the
 * names the browser and the platform look them up by, and a redraw replaces the
 * bytes underneath. Cached-first, they are frozen at whatever the device saw the
 * first time — which is exactly what happened to the tab icon on 8 Sep 2026,
 * with `/favicon.svg` precached into SHELL *and* matched here, so `caches.match`
 * kept answering out of SHELL while the refresh quietly wrote to ASSETS.
 *
 * So they go to the network first and only fall back to the copy, which costs
 * one small request on a cold start and nothing at all offline.
 */
const isMutable = (url) => url.origin === self.location.origin
  && (/^\/(favicon|apple-touch-icon)/.test(url.pathname) || url.pathname === '/manifest.json');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // Anything the API says is the app's business, not the shell's.
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  // The page itself: try the network so a deploy is picked up, fall back to the
  // copy so a tunnel is not a blank screen.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/', { ignoreSearch: true }).then((hit) => hit || Response.error())),
    );
    return;
  }

  // The icons and the manifest: the network decides, because a redraw changes
  // the bytes without changing the name. The copy is only the offline floor.
  if (isMutable(url)) {
    const live = fetch(request);
    // The clone is taken synchronously, in the first callback on `live` — not
    // after `caches.open` resolves, by which time respondWith has handed the
    // same response to the browser and reading its body makes the clone throw.
    // The write is handed to waitUntil so the worker cannot shut down mid-put
    // and leave these with no offline copy at all.
    event.waitUntil(
      live.then((res) => {
        if (!res || !res.ok) return undefined;
        const copy = res.clone();
        return caches.open(ASSETS).then((c) => c.put(request, copy));
      }).catch(() => {}),
    );
    event.respondWith(
      live.catch(() => caches.match(request).then((hit) => hit || Response.error())),
    );
    return;
  }

  // The bundle and the fonts: serve what we have and quietly refresh it,
  // because the file names carry their own hash and never change underneath us.
  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const live = fetch(request)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(request, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => hit);
        return hit || live;
      }),
    );
  }
});

// The app asks for the newest worker when the household taps "update".
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
