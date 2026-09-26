/**
 * Being a good guest on somebody else's website.
 *
 * Brief §5.5, settled 20 September 2026: enrichment reads venue pages, and two
 * limits keep that from being a crawler — "only places actually returned to a
 * household, never a sweep" (that one is `enrichmentQueue`), and "**respect
 * `robots.txt`, a per-domain crawl delay and a descriptive User-Agent with a
 * contact address, set centrally in the client**".
 *
 * Centrally is the word that matters. Epic reads a venue's own page from three
 * places already — the owned-record research, the menu ladder, the enrichment
 * pass — and a politeness rule that lives in one of them is a rule the other
 * two break. So it lives here and `sources/site.js` asks before every fetch.
 *
 * What this is not: a robots.txt parser for search engines. Epic fetches one
 * or two pages of a business's own site on behalf of a household that is
 * looking at that business. The rules honoured are the ones that would make a
 * site owner object — a `Disallow` that covers the path, and a `Crawl-delay`.
 *
 * The User-Agent is `origins.js userAgent()`, which already carries the site
 * address and a contact address, so a site owner who sees Epic in their logs
 * can find us. That was true before this module; the rest was not.
 */

import { userAgent } from '../origins.js';

const UA = userAgent('politeness');
/** Our own name in a robots.txt, lower-cased as the file's matching is. */
const ME = 'epicbot';

/** How long a robots.txt is believed. A day is what most crawlers use. */
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
/** What to wait between two requests to one host when the site does not say. */
export const DEFAULT_DELAY_MS = Number(process.env.EPIC_CRAWL_DELAY_MS || 1000);
/** The longest a site's own Crawl-delay is honoured before it is simply refused. */
const MAX_DELAY_MS = 10_000;
const ROBOTS_TIMEOUT_MS = 5000;

const robots = new Map();   // host -> { rules, delayMs, at }
const lastFetch = new Map(); // host -> timestamp

/** Forget everything, for the tests. */
export const forget = () => { robots.clear(); lastFetch.clear(); };

/**
 * A site that does not answer is a site that has not said no.
 *
 * A 404 means there is no robots.txt, which means everything is allowed — the
 * standard is explicit about that. A timeout or a 500 is the same from where
 * we stand: we may not invent a prohibition, and refusing to read a venue's
 * own page because their server was slow would lose real facts for no reason.
 * A 401 or a 403 on robots.txt *is* a refusal, and is treated as one.
 */
async function robotsFor(host, scheme = 'https') {
  const held = robots.get(host);
  if (held && Date.now() - held.at < ROBOTS_TTL_MS) return held;
  let parsed = { rules: [], delayMs: DEFAULT_DELAY_MS, at: Date.now() };
  try {
    const res = await fetch(`${scheme}://${host}/robots.txt`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      headers: { 'user-agent': UA, accept: 'text/plain' },
    });
    if (res.status === 401 || res.status === 403) parsed = { rules: [{ allow: false, path: '/' }], delayMs: DEFAULT_DELAY_MS, at: Date.now() };
    else if (res.ok) parsed = { ...parse(await res.text()), at: Date.now() };
  } catch { /* no answer is not a refusal */ }
  robots.set(host, parsed);
  return parsed;
}

/**
 * The rules that apply to us.
 *
 * A robots.txt is groups of user-agent lines followed by rules. Ours are the
 * group naming EpicBot if there is one, and the `*` group otherwise — never
 * both, because a site that writes a specific group for us has said what it
 * wants and the wildcard is then somebody else's instruction.
 */
export function parse(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const key = field.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      const agent = value.toLowerCase();
      if (current?.fresh) current.agents.push(agent);
      else { current = { agents: [agent], rules: [], delayMs: null, fresh: true }; groups.push(current); }
      continue;
    }
    if (!current) continue;
    current.fresh = false;
    if (key === 'disallow') current.rules.push({ allow: false, path: value });
    else if (key === 'allow') current.rules.push({ allow: true, path: value });
    else if (key === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds > 0) current.delayMs = Math.min(seconds * 1000, MAX_DELAY_MS);
    }
  }
  // Our own name, or the one we answered to before the rebrand: a site that
  // wrote a rule for RoamBot meant this crawler (Codex, 26 Sep 2026).
  const mine = groups.find((g) => g.agents.some((a) => a.includes(ME) || a.includes('roambot')))
    ?? groups.find((g) => g.agents.includes('*'));
  return { rules: mine?.rules ?? [], delayMs: mine?.delayMs ?? DEFAULT_DELAY_MS };
}

/**
 * Whether a path is allowed, by the longest matching rule.
 *
 * Longest-match-wins is the rule every major crawler follows and it is the one
 * that makes `Disallow: /` with `Allow: /menu` mean what its author meant. An
 * empty `Disallow:` is the standard's way of saying "nothing is disallowed"
 * and matches nothing.
 */
export function allowedBy(rules, path) {
  let best = null;
  for (const rule of rules) {
    if (!rule.path) continue;
    if (!matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length) best = rule;
  }
  return best ? best.allow : true;
}

/** `*` stands for anything and `$` pins the end; everything else is a prefix. */
function matches(pattern, path) {
  if (!pattern.includes('*') && !pattern.endsWith('$')) return path.startsWith(pattern);
  const source = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\\\$$/, '$');
  try { return new RegExp(`^${source}`).test(path); } catch { return path.startsWith(pattern.split('*')[0]); }
}

/**
 * May we fetch this, and how long must we wait first?
 *
 * Returns `{ ok, waitMs, why }`. The caller waits and fetches, or does not
 * fetch at all — and `why` is a token rather than a sentence, because it ends
 * up in a run's report and a reason is not content.
 */
export async function mayFetch(url) {
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { return { ok: false, waitMs: 0, why: 'bad_url' }; }
  if (!/^https?:$/.test(parsedUrl.protocol)) return { ok: false, waitMs: 0, why: 'not_http' };
  const host = parsedUrl.host;
  const { rules, delayMs } = await robotsFor(host, parsedUrl.protocol.replace(':', ''));
  if (!allowedBy(rules, `${parsedUrl.pathname}${parsedUrl.search}`)) {
    return { ok: false, waitMs: 0, why: 'robots' };
  }
  const since = Date.now() - (lastFetch.get(host) ?? 0);
  return { ok: true, waitMs: Math.max(0, delayMs - since), why: null };
}

/** Note that we have just fetched from this host, so the next one waits. */
export const noteFetch = (url) => {
  try { lastFetch.set(new URL(url).host, Date.now()); } catch { /* not a URL we tracked */ }
};

/**
 * The whole rule in one call: wait if we must, refuse if we are told to.
 *
 * `sources/site.js` calls this immediately before every fetch, which is what
 * makes the rule central rather than a thing each caller remembers.
 */
export async function beforeFetching(url) {
  const verdict = await mayFetch(url);
  if (!verdict.ok) return verdict;
  if (verdict.waitMs > 0) await new Promise((r) => { setTimeout(r, verdict.waitMs); });
  noteFetch(url);
  return verdict;
}
