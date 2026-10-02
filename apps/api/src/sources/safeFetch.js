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
const PRIVATE_V4 = [
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^(22[4-9]|2[3-5]\d)\./, // multicast and reserved
  /^192\.0\.0\./, /^198\.1[89]\./,
];

/** An IPv6 address as its eight 16-bit groups, or null. */
function groups6(ip) {
  let s = String(ip).toLowerCase().split('%')[0];
  // A trailing dotted IPv4 (::ffff:127.0.0.1) becomes its two hex groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const o = dotted[1].split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, -dotted[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : null;
  const all = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (all.length !== 8) return null;
  const nums = all.map((g) => parseInt(g || '0', 16));
  return nums.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff) ? null : nums;
}

/**
 * Whether an address is one this server must never be made to ask: loopback,
 * private, link-local, carrier-grade, multicast — in IPv4 and IPv6, and an IPv4
 * address dressed as IPv6 in any form, hex or dotted (::ffff:7f00:1 is
 * 127.0.0.1; Codex, 2 Oct 2026).
 */
export const isPrivate = (ip) => {
  const v = net.isIP(String(ip));
  if (v === 4) return PRIVATE_V4.some((re) => re.test(ip));
  if (v !== 6) return true; // not an address we can judge: refuse it
  const g = groups6(ip);
  if (!g) return true;
  const zeroTo = (n) => g.slice(0, n).every((x) => x === 0);
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible) carry an IPv4 inside.
  if (zeroTo(5) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    if (g[5] === 0xffff || g[6] !== 0 || g[7] > 1) return PRIVATE_V4.some((re) => re.test(v4)) || v4 === '0.0.0.0';
  }
  if (g.every((x) => x === 0)) return true;                    // ::
  if (zeroTo(7) && g[7] === 1) return true;                    // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true;                 // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                 // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true;                 // ff00::/8 multicast
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;            // 64:ff9b::/96 NAT64, may reach v4 inside
  return false;
};

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
export function requestPinned({ url, address, family }, { accept = 'text/html', maxBytes = BODY_MAX } = {}) {
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
      res.on('data', (c) => { size += c.length; if (size > maxBytes) req.destroy(new Error('page too large')); else chunks.push(c); });
      res.on('end', () => { const raw = Buffer.concat(chunks); resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null, type: String(res.headers['content-type'] ?? ''), body: raw.toString('utf8'), raw }); });
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


/**
 * One picture from an address somebody else supplied — an Openverse result, a
 * venue's page — public addresses only, pinned, every redirect re-checked,
 * capped as it arrives (Codex, 2 Oct 2026). Returns the same shape as
 * pictureBytes.fetchPicture, or null.
 */
export async function fetchPublicPicture(raw, { maxBytes = 8_000_000, resolve = publicAddress, request = requestPinned } = {}) {
  const { sniff, dimensions } = await import('./pictureBytes.js');
  let at = await resolve(raw);
  for (let hop = 0; at && hop < 5; hop += 1) {
    let res;
    try { res = await request(at, { accept: 'image/*', maxBytes }); } catch { return null; }
    if (res.status >= 300 && res.status < 400 && res.location) {
      let next;
      try { next = new URL(res.location, at.url).toString(); } catch { return null; }
      at = await resolve(next);
      continue;
    }
    if (res.status < 200 || res.status >= 300 || !res.raw?.length) return null;
    const mime = sniff(res.raw);
    if (!mime) return null;
    const { width, height } = dimensions(res.raw, mime);
    return { body: res.raw, mime, bytes: res.raw.length, width, height, url: at.url.toString() };
  }
  return null;
}
