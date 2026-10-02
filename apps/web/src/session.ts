/**
 * The token this device signs in with.
 *
 * One passcode opens the household's Epic (api/src/auth.js); what comes back is
 * a token that lasts ninety days, so the family types the passcode about four
 * times a year rather than every morning.
 *
 * It has to be readable synchronously on the very first request the app makes,
 * before IndexedDB has opened. On the web that is `localStorage`; on the phone
 * it is the Keychain / Keystore (`secureStorage`), which is asynchronous, so the
 * token is loaded into memory once at boot (`hydrateSession`) and read
 * synchronously thereafter. It is a key to this API — revocable from Settings on
 * any device — so it lives in the secure store, not beside ordinary state.
 */

import { Platform } from 'react-native';
import { storage } from './storage';
import { secureStorage } from './secureStorage';

export const TOKEN_KEY = 'epic.session';

// Web: read synchronously now. Native: null until `hydrateSession` awaits the
// Keychain at boot (the secure cache is empty until then).
let token: string | null = secureStorage.getItem(TOKEN_KEY);

const listeners = new Set<(t: string | null) => void>();

export const sessionToken = () => token;
export const signedIn = () => Boolean(token);

/**
 * Load the token from the device's secure store into memory. Resolves at once on
 * the web (already read); on the phone the app awaits this once at boot, before
 * it makes an authenticated request, and every `sessionToken()` after is sync.
 */
export async function hydrateSession(): Promise<void> {
  await secureStorage.hydrate([TOKEN_KEY]);
  const loaded = secureStorage.getItem(TOKEN_KEY);
  if (loaded !== token) { token = loaded; listeners.forEach((fn) => fn(token)); }
}

export function setSessionToken(next: string | null) {
  if (token === next) return;
  token = next;
  if (next) secureStorage.setItem(TOKEN_KEY, next);
  else secureStorage.removeItem(TOKEN_KEY);
  markSignedIn(Boolean(next));
  listeners.forEach((fn) => fn(token));
}

/**
 * `epic_app=1` on epic.day while this browser holds a session — nothing else, never
 * the token. The token lives in storage the server cannot read, and the server
 * has to decide what epic.day/ is before any script runs: with this cookie it is
 * the app, without it the website (owner, 2 Oct 2026: "epic.day/ with a valid
 * session → go straight to the app"). Crawlers never carry it. A stale one costs
 * a trip through /login, which sends a signed-in person straight on anyway.
 */
export const APP_COOKIE = 'epic_app';
export function markSignedIn(on: boolean) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.cookie = on
    ? `${APP_COOKIE}=1; Max-Age=${90 * 24 * 3600}; Path=/; SameSite=Lax; Secure`
    : `${APP_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
}
// A browser already signed in before this cookie existed gets it on its next load.
markSignedIn(Boolean(token));

/**
 * Called when the API says the token is no longer good. Separate from signing
 * out on purpose: the app needs to tell "you asked to leave" from "you were
 * away too long", because the second one has to keep whatever is in the outbox
 * and send it once they are back in.
 */
export const sessionExpired = () => setSessionToken(null);

export function onSessionChange(fn: (t: string | null) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** What this device calls itself in Settings › Devices. Never anything identifying. */
export function deviceLabel(): string {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return Platform.OS;
  const ua = navigator.userAgent || '';
  const kind = /iPhone|Android.*Mobile/.test(ua) ? 'Phone' : /iPad|Tablet/.test(ua) ? 'Tablet' : 'Computer';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  return `${kind} · ${browser}`;
}


/**
 * Whose data the device's saved copy is.
 *
 * Signing out deliberately keeps the offline copy — it is the same household's
 * data and they will sign back in. With accounts that reasoning only holds while
 * it is the *same* household: a friend signing in on a browser the owner used
 * would otherwise be served the owner's atlas out of IndexedDB, with no request
 * to the API to refuse it.
 *
 * So the copy is stamped with who it belongs to, and a sign-in by anybody else
 * throws it away before the first screen is drawn. The owner on the shared
 * passcode is 'owner', and stays 'owner' when he later claims an account row,
 * so claiming does not cost him the copy on his phone.
 */
const HOLDER_KEY = 'epic.copyHolder';

// Which household the offline copy belongs to — an id or 'owner', not a secret,
// so ordinary device storage, beside the copy it guards.
export const copyHolder = (): string | null => storage.getItem(HOLDER_KEY);

export function setCopyHolder(holder: string) {
  storage.setItem(HOLDER_KEY, holder);
}

/** Who a signed-in session's saved copy belongs to: the account, or the owner. */
export const holderOf = (account: { id: string; role: string } | null | undefined): string =>
  (!account || account.role === 'owner' ? 'owner' : account.id);
