/**
 * The device's synchronous key–value store — iOS and Android.
 *
 * The web twin (`storage.web.ts`) is `localStorage`; this one is MMKV, which is
 * synchronous too, so every call site reads and writes the same way on both
 * platforms and none of the sync-at-first-render code had to become async.
 *
 * MMKV v3 is a New-Architecture (TurboModule) native module — Expo SDK 57 / RN
 * 0.86 run the New Architecture by default, so it autolinks into a dev build
 * (`npx expo run:ios` / `run:android`); it is not in Expo Go. The `require` is
 * lazy and this file is never in the web bundle (Metro picks `.web.ts` there),
 * so the web build never pulls the native module in.
 *
 * Non-sensitive state only. Secrets go through `secureStorage`.
 */

import type { SyncStore } from './storage.web';

export type { SyncStore } from './storage.web';

let mmkv: { getString(k: string): string | undefined; set(k: string, v: string): void; delete(k: string): void } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MMKV } = require('react-native-mmkv');
  mmkv = new MMKV({ id: 'epic' });
} catch {
  // The dev build has not linked it yet (or it is Expo Go): fall back to nothing
  // rather than crash. State simply does not persist until a dev build is run.
  mmkv = null;
}

export const storage: SyncStore = {
  getItem(key) {
    try { const v = mmkv?.getString(key); return v === undefined || v === null ? null : v; } catch { return null; }
  },
  setItem(key, value) {
    try { mmkv?.set(key, value); } catch { /* noop */ }
  },
  removeItem(key) {
    try { mmkv?.delete(key); } catch { /* noop */ }
  },
};
