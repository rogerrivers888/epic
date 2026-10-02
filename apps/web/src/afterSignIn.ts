/**
 * Where a person was going when they had to sign in, kept for the e-mail link.
 *
 * Google and the password come straight back to `/login?next=…` and land there
 * (LoginScreen). The e-mail link cannot carry `next` — it is one fixed address
 * sent by the API — so the page asked for is kept on this device when the link
 * is requested, and taken back once when that link signs them in (App.tsx ›
 * Gate). For an hour only, and only an in-app path: a stale or foreign one is
 * dropped, never followed.
 */
import { storage } from './storage';

const KEY = 'epic.after-sign-in';
const HOUR = 60 * 60 * 1000;

export function rememberNext(next: string | null): void {
  try {
    if (next) storage.setItem(KEY, JSON.stringify({ next, at: Date.now() }));
    else storage.removeItem(KEY);
  } catch { /* nowhere to keep it: they land by role instead */ }
}

/** The kept page, once — removed as it is read — or null. `safe` vets it. */
export function takeRememberedNext(safe: (v: string | null) => string | null): string | null {
  try {
    const raw = storage.getItem(KEY);
    storage.removeItem(KEY);
    if (!raw) return null;
    const { next, at } = JSON.parse(raw) as { next?: string; at?: number };
    if (!next || !at || Date.now() - at > HOUR) return null;
    return safe(next);
  } catch { return null; }
}
