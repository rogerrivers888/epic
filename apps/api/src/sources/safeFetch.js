// Fetching a page from an address somebody else supplied — a venue's website
// from a provider or the open map, which is to say from anybody.
//
// Moved here from sources/curate.js (2 Oct 2026) so every reader of venue
// pages uses the one guard: the saved-place pictures (sources/venueImages.js)
// as well as the curation.

import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { userAgent } from '../origins.js';

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
export const isPrivate = (ip) => PRIVATE.some((re) => re.test(ip));

/** The address, resolved once and checked — and then the one the request is made to, so a second answer cannot differ (DNS rebinding; Codex, 12 Sep 2026). */
export async function publicAddress(raw) {
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
export function requestPinned({ url, address, family }, { accept = 'text/html' } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      host: address, family, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      servername: url.protocol === 'https:' ? url.hostname : undefined,
      path: `${url.pathname}${url.search}`, method: 'GET',
      headers: { host: url.host, 'user-agent': userAgent(), accept },
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

