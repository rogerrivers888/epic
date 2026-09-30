/**
 * Secrets on the device — iOS and Android.
 *
 * expo-secure-store is the Keychain (iOS) and the Keystore-backed store
 * (Android). It is asynchronous, but the session token has to be readable
 * synchronously on the first request, so a small in-memory cache sits in front:
 * `hydrate` loads the boot-critical keys once at startup (App awaits it before
 * it makes an authenticated call), and every later read is a synchronous cache
 * hit. Writes update the cache at once and persist in the background.
 *
 * Keys not known at boot — a join token's per-token credential — use the async
 * getters, which read through to the store and warm the cache.
 *
 * This file is never in the web bundle (Metro picks `.web.ts`), so the web build
 * never imports expo-secure-store.
 */

import type { SecureStore } from './secureStorage.web';

export type { SecureStore } from './secureStorage.web';

let SecureStoreModule: {
  getItemAsync(k: string): Promise<string | null>;
  setItemAsync(k: string, v: string): Promise<void>;
  deleteItemAsync(k: string): Promise<void>;
} | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SecureStoreModule = require('expo-secure-store');
} catch {
  SecureStoreModule = null;
}

// The synchronous face of the store: a cache the reads come from.
const cache = new Map<string, string | null>();

// One mutation at a time per key, in call order. Sign-in then sign-out fire two
// async Keychain writes back to back; without ordering the earlier set could
// land after the delete and leave the token on disk, so it comes back after a
// restart. Chaining each key's writes makes the last call the last to persist.
// Errors are swallowed inside the chain so one failure never stalls the next.
const chains = new Map<string, Promise<void>>();
const enqueue = (key: string, op: () => Promise<unknown>): Promise<void> => {
  const next = (chains.get(key) ?? Promise.resolve()).then(() => op().then(() => {}, () => {}));
  chains.set(key, next);
  return next;
};

export const secureStorage: SecureStore = {
  getItem(key) {
    return cache.has(key) ? (cache.get(key) ?? null) : null;
  },
  setItem(key, value) {
    cache.set(key, value);
    if (SecureStoreModule) void enqueue(key, () => SecureStoreModule!.setItemAsync(key, value));
  },
  removeItem(key) {
    cache.set(key, null);
    if (SecureStoreModule) void enqueue(key, () => SecureStoreModule!.deleteItemAsync(key));
  },
  async hydrate(keys) {
    if (!SecureStoreModule) return;
    await Promise.all(keys.map(async (key) => {
      try { cache.set(key, await SecureStoreModule!.getItemAsync(key)); } catch { cache.set(key, null); }
    }));
  },
  async getAsync(key) {
    if (cache.has(key)) return cache.get(key) ?? null;
    if (!SecureStoreModule) return null;
    try { const v = await SecureStoreModule.getItemAsync(key); cache.set(key, v); return v; } catch { return null; }
  },
  async setAsync(key, value) {
    cache.set(key, value);
    if (SecureStoreModule) await enqueue(key, () => SecureStoreModule!.setItemAsync(key, value));
  },
  async removeAsync(key) {
    cache.set(key, null);
    if (SecureStoreModule) await enqueue(key, () => SecureStoreModule!.deleteItemAsync(key));
  },
};
