/**
 * Secrets on the device — web.
 *
 * The session token and the group-trip join credential are keys to the API, not
 * ordinary state, so they live apart from `storage`. On the web there is no
 * keychain, so this is the same `localStorage` the token has always used (it is
 * revocable from Settings on any device and sits beside the household's own
 * offline data); on the phone the twin (`secureStorage.ts`) is
 * expo-secure-store, the Keychain / Keystore.
 *
 * The interface is synchronous so the token can be read on the first request,
 * before anything has had a chance to await. On native that is made possible by
 * hydrating a cache at boot; here every read is already synchronous, so
 * `hydrate` is a no-op and the async variants just wrap the sync ones.
 */

export type SecureStore = {
  /** Sync read. On native, valid for a key once `hydrate` has loaded it. */
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Load these keys into the sync cache (native); a no-op on the web. */
  hydrate(keys: string[]): Promise<void>;
  /** For keys not known at boot (a join token's credential). */
  getAsync(key: string): Promise<string | null>;
  setAsync(key: string, value: string): Promise<void>;
  removeAsync(key: string): Promise<void>;
};

const backing = typeof localStorage !== 'undefined' ? localStorage : null;

const get = (key: string): string | null => {
  try { return backing?.getItem(key) ?? null; } catch { return null; }
};
const set = (key: string, value: string): void => {
  try { backing?.setItem(key, value); } catch { /* private mode: nothing to keep */ }
};
const remove = (key: string): void => {
  try { backing?.removeItem(key); } catch { /* noop */ }
};

export const secureStorage: SecureStore = {
  getItem: get,
  setItem: set,
  removeItem: remove,
  hydrate: async () => { /* already synchronous on the web */ },
  getAsync: async (key) => get(key),
  setAsync: async (key, value) => set(key, value),
  removeAsync: async (key) => remove(key),
};
