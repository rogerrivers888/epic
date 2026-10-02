// Pictures on a venue's own website (owner, 2 Oct 2026): "Owned images may
// come from the venue's own website as well as Commons and Openverse. Store
// source URL, date and licence status. Venue-site images have no licence: show
// them only in the back office and in my account until a licence route is
// decided."
//
// So what is kept is the *address* of each picture, the page it was found on,
// when, and that it has no licence — never the bytes. A venue's photographs
// are the venue's copyright; a reference is what lets the owner see them and
// decide, and a licence route ("Get permission") is what would let them be
// stored. Until then they are drawn live from the venue's own server, for the
// back office and the owner's account only (routes/savedEnrich.js).
//
// The venue's server is asked politely, through the same robots.txt and
// per-domain delay as every other read of a venue page (sources/politeness.js).

import { query } from '../db.js';
import { publicAddress, requestPinned } from './safeFetch.js';
import { beforeFetching } from './politeness.js';

const MAX_KEEP = 8;

const hostOf = (u) => {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};
/** The same site: one host, or one a subdomain of the other. */
export const sameSite = (a, b) => {
  const ha = hostOf(a); const hb = hostOf(b);
  return Boolean(ha && hb) && (ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`));
};

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null;
};

const absolute = (src, base) => {
  if (!src || src.startsWith('data:')) return null;
  try {
    const u = new URL(src, base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
};

// Where the common site builders keep a site's own uploaded images.
const BUILDER_HOST = /(^|\.)(squarespace-cdn\.com|wixstatic\.com|cdn\.shopify\.com|ctfassets\.net|website-files\.com|webflow\.com|wp\.com|wordpress\.com|cloudinary\.com|imgix\.net|godaddysites\.com|img1\.wsimg\.com|weebly\.com|editmysite\.com|jimdo\.com|jimcdn\.com|framerusercontent\.com|cargo\.site|myshopify\.com)$/i;

// The furniture of a website rather than a picture of the place: icons, logos,
// sprites, tracking pixels and payment badges.
const FURNITURE = /(logo|icon|sprite|favicon|avatar|badge|pixel|spacer|placeholder|payment|visa|mastercard|tripadvisor|google|facebook|instagram|twitter|social|arrow|button)/i;

/**
 * The pictures a page offers as pictures of itself, in the order worth
 * trusting: what it names as its share image first, then the large pictures
 * in its body. Pure, so it is tested without a network.
 */
export function picturesOnPage(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const add = (src, why) => {
    const url = absolute(src, pageUrl);
    if (!url || seen.has(url)) return;
    // The venue's own pictures: on its own site, or on the image host of the
    // site builder it is made with. A picture from anywhere else on the page —
    // a booking widget, somebody else's gallery, a tracker — is not the venue's
    // (Codex, 2 Oct 2026).
    if (!sameSite(url, pageUrl) && !BUILDER_HOST.test(hostOf(url) ?? '')) return;
    if (FURNITURE.test(url) || /\.svg(\?|$)/i.test(url)) return;
    seen.add(url);
    out.push({ url, why });
  };
  for (const m of String(html ?? '').matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], 'property') ?? attr(m[0], 'name') ?? '').toLowerCase();
    if (key === 'og:image' || key === 'og:image:url' || key === 'twitter:image') add(attr(m[0], 'content'), key);
  }
  for (const m of String(html ?? '').matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const w = Number(attr(tag, 'width'));
    // A picture that declares itself small is decoration; one that says
    // nothing about its size is given the benefit of the doubt.
    if (Number.isFinite(w) && w > 0 && w < 300) continue;
    const srcset = attr(tag, 'srcset') ?? attr(tag, 'data-srcset');
    const best = srcset ? srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop() : null;
    add(best ?? attr(tag, 'data-src') ?? attr(tag, 'src'), 'img');
  }
  return out.slice(0, MAX_KEEP);
}

/**
 * The venue's page, following redirects by hand: each hop is checked before it
 * is fetched — it must stay on the venue's own site, and that host's robots.txt
 * and crawl delay are asked first (Codex, 2 Oct 2026). Returns `{ url, html }`,
 * or `{ refused: why }`.
 */
export async function fetchVenuePage(website, { politeness = beforeFetching, resolve = publicAddress, request = requestPinned, maxHops = 5 } = {}) {
  let url = website;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    if (!sameSite(url, website)) return { refused: 'redirected_off_site' };
    // A public address only — never localhost, a private range or a link-local
    // one — resolved once and then the one the request goes to, so a second
    // DNS answer cannot differ (sources/safeFetch.js; Codex, 2 Oct 2026).
    const at = await resolve(url);
    if (!at) return { refused: 'not_a_public_address' };
    const may = await politeness(url);
    if (!may.ok) return { refused: may.why ?? 'not_allowed' };
    let res;
    // The body is capped as it arrives, not after (safeFetch's BODY_MAX).
    try { res = await request(at, { accept: 'text/html,application/xhtml+xml' }); } catch { return { refused: 'page_unreadable' }; }
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) return { refused: 'page_unreadable' };
      try { url = new URL(res.location, url).href; } catch { return { refused: 'page_unreadable' }; }
      continue;
    }
    if (res.status < 200 || res.status >= 300 || !/text\/html|xhtml/i.test(res.type)) return { refused: 'page_unreadable' };
    return { url, html: res.body };
  }
  return { refused: 'too_many_redirects' };
}

/**
 * Read the venue's home page and keep the addresses of its pictures.
 *
 * Returns `{ ok, kept, why }`. A page that could not be read is `ok: false`
 * with its reason — not "this venue has no pictures".
 */
export async function venuePicturesFor(venueRef, website, { fetchHtmlImpl = null, politeness = beforeFetching, resolve, request } = {}) {
  if (!venueRef || !website) return { ok: false, kept: 0, why: 'no_website' };
  let page;
  if (fetchHtmlImpl) {
    // Tests hand the page in directly; the same checks apply to what it says.
    const may = await politeness(website);
    if (!may.ok) return { ok: false, kept: 0, why: may.why ?? 'not_allowed' };
    page = await fetchHtmlImpl(website);
    if (!page) return { ok: false, kept: 0, why: 'page_unreadable' };
  } else {
    page = await fetchVenuePage(website, { politeness, ...(resolve ? { resolve } : {}), ...(request ? { request } : {}) });
    if (page.refused) return { ok: false, kept: 0, why: page.refused };
  }
  // A redirect off the venue's own site — to Facebook, a booking platform, a
  // parked domain — is somebody else's page: nothing is taken from it, and its
  // own host's robots.txt was never asked (Codex, 2 Oct 2026).
  if (page.url && !sameSite(page.url, website)) return { ok: false, kept: 0, why: 'redirected_off_site' };
  const pics = picturesOnPage(page.html, page.url);
  for (const p of pics) {
    await query(
      `insert into venue_site_images (venue_ref, image_url, page_url, found_how)
       values ($1, $2, $3, $4)
       -- found_at is when the picture was first found, and stays so: a re-run
       -- that sees the same picture has found nothing new (Codex, 2 Oct 2026).
       on conflict (venue_ref, image_url) do update set page_url = excluded.page_url`,
      [venueRef, p.url, page.url, p.why]);
  }
  // The page was read: what it no longer shows is no longer held (Codex,
  // 2 Oct 2026). A page that could not be read never gets here, so a
  // transient failure removes nothing.
  await query(
    `delete from venue_site_images where venue_ref = $1 and not (image_url = any($2::text[]))`,
    [venueRef, pics.map((p) => p.url)]);
  return { ok: true, kept: pics.length, why: null };
}

/** The pictures held by address for a place, newest first. */
export async function venuePicturesOf(venueRef) {
  const { rows } = await query(
    `select image_url, page_url, found_how, found_at, licence_status
       from venue_site_images where venue_ref = $1 order by found_at desc, image_url`, [venueRef]);
  return rows;
}
