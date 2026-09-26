/**
 * Fetch a page, following its redirects by hand and asking before every hop.
 *
 * Owner, 26 Sep 2026 (C11): crawling follows robots.txt. A fetch that follows
 * redirects by itself asks robots.txt about the first address only, so a
 * venue's page that redirects to another host was read without asking that
 * host. Every crawler of venue pages — the owned research's page reader and
 * the menu ladder — goes through this, with its own `forbids`: the page reader
 * uses sources/politeness.js, the menu ladder its own reader, which the owner
 * approved on 5 Sep 2026 (an explicit Disallow is a decision; a robots.txt
 * that cannot be read is silence).
 *
 * The timeout is per hop and starts after `forbids` has answered, so a crawl
 * delay the politeness rule waits out does not eat the request's own time.
 */
export const MAX_HOPS = 5;
/** The statuses fetch itself follows; a 300 or a 304 with a Location is not a redirect (Codex, 26 Sep 2026). */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export async function fetchFollowing(url, init, { forbids, timeoutMs, maxHops = MAX_HOPS }) {
  let at = String(url);
  for (let hop = 0; hop <= maxHops; hop += 1) {
    if (await forbids(at)) return { refused: true, url: at, res: null };
    const res = await fetch(at, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (REDIRECTS.has(res.status)) {
      const next = res.headers.get('location');
      if (!next) return { refused: false, url: at, res };
      try { at = new URL(next, at).toString(); } catch { return { refused: false, url: at, res: null }; }
      continue;
    }
    return { refused: false, url: at, res };
  }
  return { refused: false, url: at, res: null };
}
