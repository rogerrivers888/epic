/**
 * Curation — our own account of a place, written from what the place says
 * about itself.
 *
 * Owner, 12 Sep 2026: "for the top 20% of the most popular places, we can then
 * go on a journey where I can actually click to use Claude code to scrape
 * those websites, extract the information that we need, and summarise it…
 * start training the AI to be able to curate its own information on those
 * particular locations which are highly rated. That way, we then own the data."
 *
 * What is read: the venue's own pages — the front page and the handful that
 * say what it is, how to visit, what it costs — and the open encyclopedia
 * summary the owned record already holds. What is *not* read: Google's or
 * Tripadvisor's reviews. Words written from rented reviews are not ours to
 * keep, and the whole point of this is to keep them (Technical Constraints
 * §13.10). The two providers decide *which* places are worth the trouble;
 * they do not write the account.
 *
 * What is written: four short paragraphs — what it is, who it suits, why you
 * would go, and the practical things — with the pages they came from, into
 * `place_records.curation`. It is a first draft for the owner to read against
 * Google's record in the back office, not copy for a household yet.
 */

import { z } from 'zod/v4';
import { parseStructured, MODEL } from '../claude.js';
import { visibleText } from './menuRead.js';
import { userAgent } from '../origins.js';
import { query } from '../db.js';
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

/** Pages worth reading beyond the front page, by what their path says. */
const WORTH = /about|visit|plan|what|experience|attraction|things|families|family|kids|children|open|price|ticket|admission|explore|discover|our-story|history|facilities/i;
const PAGE_CHARS = 6000;
const TOTAL_CHARS = 20000;
const PAGES = 5;

const SYSTEM = `You write short, plain, honest accounts of places for a family day-planning app in Britain. You are given the text of a place's own web pages and, sometimes, an encyclopedia summary. Write only from what is in front of you.

Rules:
- British English. No marketing voice, no superlatives that the pages do not earn, no exclamation marks.
- Never invent prices, hours, ages or facilities. If the pages do not say, write "not stated on their site".
- "what": what the place is, in 40–80 words, as a friend would explain it.
- "who": who it suits — ages, interests, mobility, weather — in 30–60 words.
- "why": why somebody would choose to go, in 30–60 words. Concrete, from the pages.
- "practical": opening, booking, prices, parking, food on site, dogs, how long to allow — only what the pages state, in 40–90 words.
- "kinds": up to four words from this list that fit: family, outdoors, indoors, heritage, museum, arts, animals, active, food, adults, free, seasonal.
- "confidence": high if the pages plainly describe the place; medium if thin; low if the pages barely say what it is.
- "pagesUsed": the URLs you actually drew on.`;

const Curation = z.object({
  what: z.string(),
  who: z.string(),
  why: z.string(),
  practical: z.string(),
  kinds: z.array(z.string()).max(4),
  confidence: z.enum(['high', 'medium', 'low']),
  pagesUsed: z.array(z.string()),
});

/**
 * A venue's website comes from a provider or the open map, which is to say
 * from anybody. Only a public web address is fetched — never localhost, a
 * private range or a link-local one — and every redirect is checked the same
 * way before it is followed (Codex, 12 Sep 2026).
 */
const PRIVATE = [
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/, /^fc/i, /^fd/i, /^fe80:/i, /^::ffff:(127|10|192\.168|169\.254)\./i,
];
const isPrivate = (ip) => PRIVATE.some((re) => re.test(ip));

/** The address, resolved once and checked — and then the one the request is made to, so a second answer cannot differ (DNS rebinding; Codex, 12 Sep 2026). */
async function publicAddress(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  let address = host;
  let family = net.isIP(host);
  if (!family) {
    let addresses;
    try { addresses = await dns.lookup(host, { all: true }); } catch { return null; }
    if (!addresses.length || addresses.some((a) => isPrivate(a.address))) return null;
    address = addresses[0].address;
    family = addresses[0].family;
  } else if (isPrivate(host)) return null;
  return { url: u, address, family };
}

const BODY_MAX = 1_500_000;
const DEADLINE_MS = 15_000;

/** One request to the checked address, with the site's own name kept for TLS and the Host header. */
function requestPinned({ url, address, family }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      host: address, family, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      servername: url.protocol === 'https:' ? url.hostname : undefined,
      path: `${url.pathname}${url.search}`, method: 'GET',
      headers: { host: url.host, 'user-agent': userAgent(), accept: 'text/html' },
      timeout: 12_000,
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > BODY_MAX) req.destroy(new Error('page too large')); else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    // `timeout` above is socket inactivity; this is the clock on the whole
    // request, so a site trickling a byte at a time cannot hold it open
    // (Codex, 12 Sep 2026).
    const deadline = setTimeout(() => req.destroy(new Error('timed out')), DEADLINE_MS);
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.on('close', () => clearTimeout(deadline));
    req.end();
  });
}

async function fetchPage(url) {
  let at = await publicAddress(url);
  for (let hop = 0; at && hop < 5; hop += 1) {
    const res = await requestPinned(at);
    if (res.status >= 300 && res.status < 400 && res.location) {
      let next;
      try { next = new URL(res.location, at.url).toString(); } catch { return null; }
      at = await publicAddress(next);
      continue;
    }
    if (res.status < 200 || res.status >= 300 || !/text\/html/i.test(res.type)) return null;
    return res.body;
  }
  return null;
}

/** The front page's own links that look like they say what the place is. Same host only. */
function worthReading(html, base) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#?]+)[^"']*["']/gi)) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    if (u.host !== new URL(base).host) continue;
    if (!WORTH.test(u.pathname) || /\.(pdf|jpg|png|gif|svg|zip)$/i.test(u.pathname)) continue;
    const key = u.origin + u.pathname.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= PAGES) break;
  }
  return out;
}

/**
 * Read the place's pages and write the account. Returns what was written, or
 * throws — a budget error from claude.js is thrown as it is, so the route can
 * say it in plain words and the back office can show the raw one.
 */
export async function curate({ venueRef, name, website, summary = null, householdId = null, sessionId = null, meta = null }) {
  if (!website) throw Object.assign(new Error('No website to read: the place has no page of its own on record.'), { code: 'no_website', status: 422 });
  const home = await fetchPage(website);
  if (!home) throw Object.assign(new Error('Their site could not be read.'), { code: 'site_unreadable', status: 502 });
  const pages = [{ url: website, text: visibleText(home).slice(0, PAGE_CHARS) }];
  let total = pages[0].text.length;
  for (const url of worthReading(home, website)) {
    if (total >= TOTAL_CHARS) break;
    const html = await fetchPage(url).catch(() => null);
    if (!html) continue;
    const text = visibleText(html).slice(0, PAGE_CHARS);
    pages.push({ url, text });
    total += text.length;
  }

  const prompt = [
    `Place: ${name}`,
    summary ? `Encyclopedia summary (CC BY-SA): ${summary}` : null,
    ...pages.map((p) => `--- ${p.url}\n${p.text}`),
  ].filter(Boolean).join('\n\n');

  const out = await parseStructured({
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    schema: Curation,
    householdId, sessionId,
    purpose: 'lookup.curate',
    effort: 'medium',
    maxTokens: 2000,
    meta,
  });

  const from = pages.map((p) => p.url);
  await query(
    `update place_records set curation = $2, curated_at = now(), curated_from = $3, curated_model = $4, updated_at = now() where venue_ref = $1`,
    [venueRef, JSON.stringify(out), JSON.stringify(from), MODEL],
  );
  return { curation: out, from, model: MODEL };
}

/** The crowd, as words, kept on the owned record so an activity keeps its standing after the signal goes. */
export async function band(venueRef, { crowd, count, epicScore }) {
  await query(
    'update place_records set crowd_band = $2, count_band = $3, epic_score = $4, banded_at = now(), updated_at = now() where venue_ref = $1',
    [venueRef, crowd ?? null, count ?? null, epicScore ?? null],
  );
}
