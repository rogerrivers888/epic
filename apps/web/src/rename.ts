/**
 * Carrying a device across the rebrand.
 *
 * Every key this app keeps in `localStorage` moved from `roam.*` to `epic.*`
 * when Roam became Epic (owner, 7 Sep 2026). One of them is the session token,
 * so doing nothing would have signed every household out on the morning of the
 * release for no reason they could see; the rest are the small settled choices
 * — which view the owner is in, whether replies are spoken, what was searched
 * for last — that are not worth losing either.
 *
 * Runs on import, not on call: `session.ts` and `theme.ts` read their keys at
 * module scope, and an ES module body runs after every one of its imports has
 * been evaluated — so the only way to be first is to be imported first. That is
 * what the bare `import './src/rename'` at the top of `App.tsx` and `index.ts`
 * is for; do not reorder it below the others.
 *
 * It copies any `roam.` key that has no `epic.` counterpart, then removes the
 * old one. An `epic.` key that already
 * exists is the newer truth and is left alone, so running this twice does
 * nothing. The offline database moves separately, in `offline/store.ts`, because
 * its outbox can hold writes the server has never seen.
 */

const OLD = 'roam.';
const NEW = 'epic.';

export function adoptOldKeys(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const old: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(OLD)) old.push(k);
    }
    for (const k of old) {
      const next = NEW + k.slice(OLD.length);
      const value = localStorage.getItem(k);
      if (value !== null && localStorage.getItem(next) === null) localStorage.setItem(next, value);
      localStorage.removeItem(k);
    }
  } catch {
    // A browser with storage switched off has nothing to carry over, and the
    // app has to open anyway.
  }
}

adoptOldKeys();
