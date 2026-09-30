/**
 * The device's synchronous key–value store — web.
 *
 * Non-sensitive state only: the theme, who the device is set to, where each tab
 * was left, whether the opening has been seen, and a handful of UI flags. It is
 * read synchronously (a lot of it at the very first render), so the store is
 * synchronous on both platforms — `localStorage` here, MMKV on the phone
 * (`storage.ts`). Secrets never go here; they go through `secureStorage`.
 *
 * Every method swallows its own failure: private-mode Safari throws on write and
 * a full store throws on set, and neither is worth taking a screen down for. A
 * read that cannot happen returns null — the same as an absent key.
 */

export type SyncStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const backing = typeof localStorage !== 'undefined' ? localStorage : null;

export const storage: SyncStore = {
  getItem(key) {
    try { return backing?.getItem(key) ?? null; } catch { return null; }
  },
  setItem(key, value) {
    try { backing?.setItem(key, value); } catch { /* private mode or full: forget it */ }
  },
  removeItem(key) {
    try { backing?.removeItem(key); } catch { /* noop */ }
  },
};
