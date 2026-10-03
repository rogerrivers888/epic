/**
 * Epic Events on the web, server side (brief, 3 Oct 2026): the addresses of
 * public event and host pages, what each one answers, and the head a crawler
 * reads — written into the shell so nothing it needs waits on JavaScript.
 *
 *   /en-gb/event/{slug}-{code}   an event      (301 to the current slug when the title has changed)
 *   /en-gb/hosts/{slug}-{code}   a host
 *   /e/{code}                    the short share link: 301 to the event
 *   /photos/{id}                 a photo on one of those pages, from the API's public door
 *   /{locale}/sitemap-events.xml and /{locale}/sitemap-hosts.xml
 *
 * Plain functions over the API's /api/public answers (apps/api/src/routes/
 * publicPages.js), so they can be tested without a server.
 */

const CODE = '[a-z0-9]{6}';
const EVENT = new RegExp(`^/([a-z]{2}-[a-z]{2})/event/([^/]+)-(${CODE})$`);
const HOST = new RegExp(`^/([a-z]{2}-[a-z]{2})/hosts/([^/]+)-(${CODE})$`);
const SHORT = new RegExp(`^/e/(${CODE})$`);
const PHOTO = /^\/photos\/([0-9a-f-]{36})$/i;
const SITEMAP = /^\/([a-z]{2}-[a-z]{2})\/sitemap-(events|hosts)\.xml$/;

/** Which public page an address is, or null. Case and a trailing slash are read through and then 301'd away. */
export function publicAddress(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  const lower = p.toLowerCase().replace(/\/+$/, '');
  let m;
  if ((m = EVENT.exec(lower))) return { kind: 'event', locale: m[1], code: m[3], asked: pathname };
  if ((m = HOST.exec(lower))) return { kind: 'host', locale: m[1], code: m[3], asked: pathname };
  if ((m = SHORT.exec(lower))) return { kind: 'short', code: m[1], asked: pathname };
  if ((m = PHOTO.exec(p))) return { kind: 'photo', id: m[1].toLowerCase() };
  if ((m = SITEMAP.exec(lower))) return { kind: 'sitemap', locale: m[1], which: m[2] };
  return null;
}

const MOOD_SLUG = { fun: 'fun', food: 'food-and-drink', culture: 'culture', educational: 'educational', sport: 'sport', activity: 'active', adrenaline: 'adrenaline', relaxing: 'relaxing', outdoors: 'outdoors' };
const slug = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Where an event that has left the web goes (brief §1): its subcategory page, or its category page.
 * Those pages wait on Claude Design; until `EPIC_EVENT_CATEGORY_PAGES` is on there is nowhere to send it,
 * so it is a 410 rather than a 301 to a page that is not there.
 */
export function leftTheWeb(ev, locale, categoryPagesOn) {
  if (!categoryPagesOn) return { status: 410 };
  const sub = ev.subcategory ? slug(ev.subcategory) : null;
  return { status: 301, location: `/${locale}/events/${sub || MOOD_SLUG[ev.mood] || ''}`.replace(/\/$/, '') };
}

const attr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t; };
/** A photo on a public page, from epic.day itself so a crawler may fetch it (robots.txt keeps /api/ out). */
export const photoUrl = (appUrl, apiPath) => { const id = /\/api\/public\/media\/([0-9a-f-]{36})$/i.exec(String(apiPath ?? ''))?.[1]; return id ? `${appUrl}/photos/${id}` : null; };

const KIND_PRICE = (p) => {
  if (!p || p.mode === 'free') return 0;
  if (p.nowEach != null) return p.nowEach;
  if (p.pence) return p.pence;
  const k = [p.dropInPence, p.bookAheadPence].filter((n) => typeof n === 'number' && n > 0);
  return k.length ? Math.min(...k) : 0;
};

/** The event's head: title, description, canonical, its picture, and schema.org Event (Service for On request) with a BreadcrumbList. */
export function eventHead(ev, { appUrl, locale = 'en-gb', categoryPagesOn = false }) {
  const url = `${appUrl}${ev.path}`;
  const town = ev.where?.area;
  const title = `${ev.title}${town ? ` · ${town}` : ''} · Epic Events`;
  const description = clip(ev.summary || ev.description || `${ev.kind ?? 'An event'}${town ? ` in ${town}` : ''}, hosted by ${ev.host?.name ?? 'an Epic host'}.`, 155);
  const image = photoUrl(appUrl, ev.photos?.[0]);
  const s0 = ev.when?.sessions?.[0];
  const startDate = s0 ? `${s0.date}${s0.time ? `T${s0.time}` : ''}` : ev.when?.first ?? undefined;
  const offers = { '@type': 'Offer', price: (KIND_PRICE(ev.price) / 100).toFixed(2), priceCurrency: 'GBP', url, availability: ev.status === 'live' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut' };
  const organizer = { '@type': 'Person', name: ev.host?.name, url: ev.host?.path ? `${appUrl}${ev.host.path}` : undefined };
  // The area, never the address (brief §4).
  const place = ev.where?.online
    ? { '@type': 'VirtualLocation', url }
    : { '@type': 'Place', name: town ?? 'To be confirmed', address: { '@type': 'PostalAddress', addressLocality: town ?? undefined, addressCountry: 'GB' } };
  const thing = ev.lane === 'onrequest'
    ? { '@context': 'https://schema.org', '@type': 'Service', name: ev.title, description, url, image: image ?? undefined, provider: organizer, areaServed: town ?? undefined, offers }
    : {
      '@context': 'https://schema.org', '@type': 'Event', name: ev.title, description, url, image: image ?? undefined,
      startDate, endDate: ev.when?.last ?? undefined,
      eventStatus: ev.status === 'called_off' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
      eventAttendanceMode: ev.where?.online ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
      location: place, organizer, offers,
    };
  // Events › Category › Subcategory once those pages exist; Epic › the event until then.
  const crumbs = categoryPagesOn
    ? [{ name: 'Events', item: `${appUrl}/${locale}/events` }, ...(ev.mood ? [{ name: ev.category ?? ev.mood, item: `${appUrl}/${locale}/events/${MOOD_SLUG[ev.mood] ?? ev.mood}` }] : []),
      ...(ev.subcategory ? [{ name: ev.subcategory, item: `${appUrl}/${locale}/events/${slug(ev.subcategory)}` }] : []), { name: ev.title, item: url }]
    : [{ name: 'Epic', item: `${appUrl}/${locale}/` }, { name: ev.title, item: url }];
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })) };
  return { title, description, canonical: url, image, type: 'website', robots: null, jsonld: [thing, breadcrumb] };
}

/** The host's head: "{name} · {main subcategory} in {town} · Epic Hosts", indexed with a live event or a review. */
export function hostHead(h, { appUrl, locale = 'en-gb' }) {
  const url = `${appUrl}${h.path}`;
  const what = [h.subcategory, h.town ? `in ${h.town}` : null].filter(Boolean).join(' ');
  const title = `${h.name}${what ? ` · ${what}` : ''} · Epic Hosts`;
  const description = clip(h.intro || `${h.name} hosts ${h.subcategory ? h.subcategory.toLowerCase() : 'events'}${h.town ? ` in ${h.town}` : ''} on Epic.`, 155);
  const image = photoUrl(appUrl, h.photo);
  const person = { '@context': 'https://schema.org', '@type': 'Person', name: h.name, url, image: image ?? undefined, description };
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Epic', item: `${appUrl}/${locale}/` },
    { '@type': 'ListItem', position: 2, name: h.name, item: url },
  ] };
  return { title, description, canonical: url, image, type: 'profile', robots: h.indexable ? null : 'noindex', jsonld: [person, breadcrumb] };
}

/** The shell with a page's own head written in. JSON-LD is escaped so a title can never close the script. */
export function withHead(html, head, lang = 'en-GB') {
  const ld = (head.jsonld ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`);
  const extra = [
    ...(head.robots ? [`<meta name="robots" content="${attr(head.robots)}" />`] : []),
    '<meta name="twitter:card" content="summary_large_image" />',
    ...ld,
  ];
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${attr(lang)}"`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${attr(head.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${attr(head.description)}" />`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${attr(head.canonical)}" />`)
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${attr(head.canonical)}" />`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${attr(head.title)}" />`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${attr(head.description)}" />`)
    .replace(/<meta property="og:type"[^>]*>/, `<meta property="og:type" content="${attr(head.type ?? 'website')}" />`)
    .replace(/<meta property="og:image"[^>]*>/, (tag) => (head.image ? `<meta property="og:image" content="${attr(head.image)}" />` : tag))
    .replace('</head>', `  ${extra.join('\n    ')}\n  </head>`);
}

/** A per-locale sitemap of event or host pages, from the API's list. */
export function sitemapOf(appUrl, entries) {
  const urls = entries.map((e) => `  <url>\n    <loc>${attr(appUrl + e.path)}</loc>\n    <lastmod>${attr(e.lastmod)}</lastmod>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
