/**
 * Whether the server sent this document as a page of the website.
 *
 * While the launch gate is up the server asks for the gate's password before it
 * sends a website page (gate.mjs › siteLock), and every page it does send carries
 * `<meta name="epic-page" content="site">` (server.mjs › withSiteHead). The app
 * shell at `/login` or `/inspire` carries no such mark, and the whole site is in
 * the same bundle — so a site address reached *inside* the app, by history or by
 * the service worker's offline shell, would draw the site without the server
 * ever being asked (Codex, 2 Oct 2026). Then the page is fetched for real, once:
 * the server decides, and a refusal is the server's own 401/404. Once per address
 * per tab, so a page that cannot be fetched (offline) does not reload forever.
 *
 * A deliberate document load — the one place the website leaves the router, as
 * the Google hand-off does — so it reads `window.location` here and nowhere else.
 */
import { Platform } from 'react-native';

export function servedAsSite(): boolean {
  // The Expo dev server sends the shell for every address and writes no head; in
  // development the gate is not what is being looked at.
  if (__DEV__) return true;
  if (Platform.OS !== 'web' || typeof document === 'undefined') return true;
  return Boolean(document.querySelector('meta[name="epic-page"][content="site"]'));
}

/** Ask the server for this address as a document, once per address per tab. Returns whether it did. */
export function fetchFromServerOnce(path: string): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const key = `epic-site-load:${path}`;
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, '1');
  } catch { return false; }
  window.location.replace(window.location.href);
  return true;
}
