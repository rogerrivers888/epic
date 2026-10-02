// What a place says about itself, on its own page.
//
// This is the best-licensed source there is and nobody sells it: the venue
// publishes it, for machines, on purpose. Most restaurants and attractions
// carry a schema.org JSON-LD block — the same one that puts their hours and
// address into a Google result — and that block has the telephone number, the
// street address, the opening hours, the cuisine, the price band and often the
// menu URL. Reading it is one request to their own public page, so like the
// menu lookup (sources/menuLink.js) it is free and is not a provider call.
//
// What is taken is facts a business publishes to be republished: how to reach
// them, where they are, when they open, how to book; and the meta description,
// which exists solely to be quoted by other people's software and is stored
// with their own URL beside it — the lead a place page shows.
//
// Their paragraphs are kept too, as the body, by the owner's decision (26 Sep
// 2026: "Yes, store fuller prose. Owned text, allowed … keep the lead
// separately from the body rather than replacing it. The lead is what a place
// page shows; the body is what the extractor reads"). The body is capped, sits
// in place_facts with its source URL, is never a place_records column, and so
// never reaches a device or a page; it is read to find features and to quote
// the sentence that evidences one.
//
// Same manners as the menu lookup: identify ourselves, one page, five seconds,
// one megabyte, and never follow the site into a crawl.

import { findMenuUrl } from './menuLink.js';
import { phoneOf } from '../domain/contact.js';
import { userAgent } from '../origins.js';
import { beforeFetching } from './politeness.js';
import { fetchFollowing } from './follow.js';

const TIMEOUT_MS = 6000;
const MAX_BYTES = 1_500_000;
const UA = userAgent('household place record');

const BOOKING_HOSTS = /opentable|resdiary|sevenrooms|bookatable|quandoo|thefork|exploretock|tock\.|resy\.|dishcult|collinsbookings|designmynight|eveve|tablepath|now-book-it|obee|guestline|toasttab|booking\.resos/i;
const SOCIAL = {
  instagram: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[^"'\s?#]+/i,
  facebook: /(?:https?:\/\/)?(?:www\.)?facebook\.com\/[^"'\s?#]+/i,
  x: /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/[^"'\s?#]+/i,
  tiktok: /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[^"'\s?#]+/i,
};

const text = (v) => (typeof v === 'string' ? v.trim() : null);

/** The most of a page's own words that is kept. */
export const BODY_MAX = 6000;

/**
 * The page's paragraphs, as the body the extractor reads.
 *
 * The meta description is the lead a place page shows; the paragraphs are
 * what the venue actually says about itself — the room, the garden, the
 * wave machine — and were thrown away (owner, 26 Sep 2026). Scripts, styles
 * and the furniture of a page are dropped; a paragraph is kept when it is a
 * sentence or two rather than a menu item or a button.
 */
export function paragraphsOf(html) {
  if (!html) return null;
  const cleaned = String(html)
    .replace(/<(script|style|noscript|svg|nav|header|footer|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const out = [];
  let total = 0;
  for (const [, inner] of cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = inner.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length < 60 || !/[.!?]/.test(t)) continue;
    out.push(t);
    total += t.length;
    if (total >= BODY_MAX) break;
  }
  return out.length ? out.join(' ').slice(0, BODY_MAX) : null;
}

/** Every JSON-LD object on the page, including the ones nested in @graph. */
function jsonLd(html) {
  const out = [];
  for (const [, block] of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed;
    // Sites emit trailing commas and stray HTML comments in these blocks often
    // enough that one bad block must not lose the others.
    try { parsed = JSON.parse(block.replace(/<!--[\s\S]*?-->/g, '').trim()); } catch { continue; }
    const push = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(push); return; }
      out.push(node);
      if (node['@graph']) push(node['@graph']);
    };
    push(parsed);
  }
  return out;
}

const BUSINESS = /Restaurant|LocalBusiness|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|Museum|TouristAttraction|Hotel|LodgingBusiness|Place|Organization|EntertainmentBusiness|AmusementPark|Zoo|Aquarium|ArtGallery|Winery|Brewery/i;

/** The business node, if the page has one — the most specific type wins over a bare Organization. */
function business(nodes) {
  const typed = nodes.filter((n) => {
    const t = [].concat(n['@type'] ?? []).join(' ');
    return BUSINESS.test(t);
  });
  if (!typed.length) return null;
  const generic = (n) => /^(Place|Organization)$/i.test([].concat(n['@type'] ?? [])[0] ?? '');
  return typed.find((n) => !generic(n)) ?? typed[0];
}

/** schema.org openingHours in any of its three shapes, as one line. */
function hoursFrom(node) {
  const spec = node.openingHoursSpecification;
  if (Array.isArray(spec) && spec.length) {
    const parts = spec.map((s) => {
      const days = [].concat(s.dayOfWeek ?? []).map((d) => String(d).split('/').pop().slice(0, 3)).join(', ');
      if (!days) return null;
      return s.opens && s.closes ? `${days} ${s.opens}–${s.closes}` : `${days} closed`;
    }).filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  const plain = [].concat(node.openingHours ?? []).filter((h) => typeof h === 'string');
  return plain.length ? plain.join(' · ') : null;
}

function addressFrom(node) {
  const a = node.address;
  if (typeof a === 'string') return { address: a.trim(), postcode: null };
  if (!a || typeof a !== 'object') return { address: null, postcode: null };
  const line = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].map(text).filter(Boolean).join(', ');
  return { address: line || null, postcode: text(a.postalCode) };
}

/**
 * A telephone number a place prints on its page but does not mark up.
 *
 * Plenty of small restaurants publish no schema.org block and no `tel:` link —
 * the number is simply typed into the footer. It is a fact they publish in
 * order to be rung, so it is worth reading, but only when we can be reasonably
 * sure it is a phone number and not a date, a price or a company number. So:
 * it has to look like one, and it has to sit near a word that introduces one.
 */
export function printedPhone(html) {
  const flat = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;?/gi, ' ').replace(/\s+/g, ' ');
  // +44 20 7946 0958 · 020 7946 0958 · 01225 460705 — nine to eleven digits,
  // in the groupings people actually write.
  const pattern = /(?:\+\d{1,3}[\s(]?)?(?:\(?0\)?[\s-]?)?\d[\d\s().-]{8,16}\d/g;
  for (const m of flat.matchAll(pattern)) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) continue;
    // A year, a price, a VAT number or a run of dates is not a phone number.
    if (/^\d{4}\s?[-–]\s?\d{4}$/.test(raw)) continue;
    const before = flat.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    if (!/(tel|phone|call|reservations?|bookings?|contact|enquir)/.test(before)) continue;
    return raw.replace(/[().]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return null;
}

/**
 * One page of a venue's own site.
 *
 * Every fetch asks `sources/politeness.js` first: robots.txt, and a per-domain
 * crawl delay. The brief settled 20 September 2026 requires it of the
 * enrichment pass, and this is the client that pass uses — along with the
 * owned-record research and the menu ladder, which should be equally polite
 * and were not.
 *
 * A site that disallows us simply yields nothing, exactly as an unreachable
 * one does. That is a real cost: a venue whose robots.txt is written for
 * search engines may lose us a phone number. It is the cost of being able to
 * say, honestly, that Epic asks before it reads.
 */
async function fetchPage(url) {
  // Every hop asks first, and each hop's timeout starts after the politeness
  // wait (C11 and Codex, 26 Sep 2026): see sources/follow.js.
  const forbids = async (at) => !(await beforeFetching(at)).ok;
  try {
    const { res, url: at } = await fetchFollowing(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' } }, { forbids, timeoutMs: TIMEOUT_MS });
    if (!res || !res.ok) return null;
    if (!/text\/html|xhtml/i.test(res.headers.get('content-type') || '')) return null;
    return { url: at, html: (await res.text()).slice(0, MAX_BYTES) };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// what it costs to walk in
// ---------------------------------------------------------------------------

// Who a ticket is for, and every word a UK attraction actually prints for them.
// Ordered longest-first inside each group so "adult" does not match first in
// "adult carer" and mislabel a concession as the full price.
const TICKETS = [
  ['adult', /\b(?:adults?(?:\s*\(\s*1[6-8]\+?\s*\))?|grown[- ]ups?)\b/i],
  ['child', /\b(?:child(?:ren)?|kids?|juniors?|under[- ]?1[0-8]s?)\b/i],
  ['family', /\bfamily(?:\s*(?:ticket|of\s*\d))?\b/i],
  ['concession', /\b(?:concessions?|seniors?|students?|over[- ]?60s?|65\+)\b/i],
];

// £14, £14.50, £14 per adult. Not "£14m", not a year, not a phone number.
const MONEY = /£\s?\d{1,3}(?:\.\d{2})?(?!\d|\s?(?:m\b|bn\b|k\b|million|billion))/;
const FREE = /\b(?:free\s+(?:admission|entry|entrance|to\s+enter|of\s+charge)|admission\s+(?:is\s+)?free|entry\s+(?:is\s+)?free|no\s+admission\s+charge)\b/gi;

// What turns "free entry" into somebody else's free entry. English Heritage's
// Dover Castle page says "FREE ENTRY FOR UP TO SIX CHILDREN … accompanied by an
// adult member", and read without this the atlas told a family that a £26 day
// out cost nothing. A price that is confidently wrong is worse than no price,
// so a free claim counts only when nothing qualifies it.
const QUALIFIED = /\b(?:members?|membership|subscriber|annual pass|children|child|under[- ]?\d|accompanied|carers?|when you|if you|with (?:a|an|any|your)|for (?:up to|the first)|residents?|students?|locals?|nhs|blue light)\b/i;

// "Free on Sundays", "free entry after 4pm", "free during term time" — a time-limited
// free entry is not a universally free place, and storing it as one shows a paid venue
// as Free (Codex). A day name, a time, or a season near the claim disqualifies it;
// conservative on purpose — a genuinely free place that merely mentions a day nearby
// falls back to Google rather than being confidently wrong.
const TEMPORAL = new RegExp([
  // days and parts of the week
  'mondays?', 'tuesdays?', 'wednesdays?', 'thursdays?', 'fridays?', 'saturdays?', 'sundays?',
  'weekdays?', 'weekends?', 'bank\\s+holidays?', 'term\\s+time', 'school\\s+holidays?', 'half[- ]term',
  // times of day
  'after\\s+\\d', 'before\\s+\\d', '\\d\\s?(?:am|pm)\\b',
  // months — "may" only where it is plainly the month, never the verb ("you may book")
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  '(?:jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\b\\.?',
  '(?:in|from|until|till|to|through|between|during|throughout)\\s+may\\b', 'may\\s*(?:to|until|till|-|\\u2013)',
  // seasons and dated periods
  'winter', 'spring', 'summer', 'autumn', 'seasonal', 'season', 'off[- ]peak', 'peak\\s+times?',
  'christmas', 'easter', 'new\\s+year', 'holiday\\s+period',
  // date ranges and limits
  'until', 'till', 'between', 'from\\s+\\d', '\\d{1,2}(?:st|nd|rd|th)\\b', '\\b20\\d\\d\\b', 'limited\\s+time', 'for\\s+a\\s+limited',
  // short-lived offers — "free today only", "free admission tomorrow", "for one day
  // only", "this weekend" (Codex): a promotion stored as a standing Free is the wrong
  // Free the owner warned of, so "only" after a claim bars it too
  'today', 'tonight', 'tomorrow', 'this\\s+(?:week|weekend|month|year)', 'one\\s+day', 'one[- ]off',
  'only', 'special\\s+offer', 'promotion', 'open\\s+days?', 'launch',
].map((p) => `(?:${p})`).join('|').replace(/^/, '\\b(?:').concat(')'), 'i');

// A structured offer label that names the general ticket.
const GENERAL_OFFER = /\b(?:general|standard|admission|entry|entrance)\b/i; // not 'adult': an adult ticket is not everyone's

// The words that may stand before a free claim in its own sentence (see admissionFrom).
const LEAD_WORDS = new Set([
  'there', 'is', 'are', 'it', "it's", 'its', 'the', 'our', 'this', 'general', 'standard', 'and', 'to',
  'entry', 'admission', 'entrance', 'all', 'always', 'everyone', 'everybody', 'visitors', 'visitor',
  'completely', 'totally', 'entirely', 'absolutely', 'still', 'also', 'yes', 'good', 'news',
  'park', 'parks', 'garden', 'gardens', 'museum', 'gallery', 'galleries', 'house', 'grounds', 'site',
  'castle', 'church', 'cathedral', 'abbey', 'reserve', 'nature', 'wood', 'woods', 'woodland', 'beach',
  'country', 'exhibition', 'exhibitions', 'collection', 'collections', 'permanent', 'main',
]);
// And the words that may follow it: the same, plus "all year round", "every day of
// the year", "for everyone", "open daily".
const TAIL_WORDS = new Set([...LEAD_WORDS,
  'for', 'year', 'round', 'every', 'day', 'days', 'of', 'open', 'daily', 'ages', 'welcome', 'charge', 'no',
]);

// A block element ends a sentence for the free-entry scan: "Plan your visit" in the
// heading above <p>Admission is free.</p> is not part of the claim, and with the
// lead held to an allowlist, a heading bleeding into it rejected every ordinary free
// page (Codex). Only the free scan reads this — price extraction keeps `flatten`, so
// "Adults</td><td>£12" is not split.
const BLOCK_END = /<\/?(?:p|h[1-6]|li|ul|ol|div|section|article|header|footer|nav|aside|main|table|tr|td|th|dt|dd|blockquote|figcaption|br|hr)\b[^>]*>/gi;
const flattenBlocks = (html) => flatten(String(html)
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(BLOCK_END, ' . '));

const flatten = (html) => String(html)
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;?/gi, ' ').replace(/&amp;/gi, '&').replace(/&pound;/gi, '£')
  .replace(/\s+/g, ' ');

/**
 * What a place charges to get in, from the page it publishes to be read.
 *
 * The one fact about an attraction that nobody gives away and everybody needs.
 * Wikidata does not carry it, OpenStreetMap carries only whether there is a fee
 * at all, and a licensed provider's copy would be theirs and not ours. The
 * venue's own ticket page is the source that is both authoritative and free to
 * use, for the same reason as the rest of this module: they publish it in order
 * to be read.
 *
 * Two ways, in order of how much they can be trusted:
 *
 *   1. The `offers` block, where a site has one. Marked up by the site itself
 *      for exactly this purpose, so the number and what it is for are already
 *      separated and there is nothing to infer.
 *   2. The printed price, read the way `printedPhone` reads a phone number: the
 *      shape has to be right *and* it has to sit next to a word that says what
 *      it is. A bare £14 on a page is as likely to be a gift shop mug.
 *
 * The prices are kept as they are written, not parsed to numbers. "£14.00
 * online, £16.50 on the day" is the true answer to what it costs, and rounding
 * that to 14 would put a price on the screen that nobody charges.
 *
 * Never guesses. Everything null and `free` null means the page did not say,
 * which is a different and more useful answer than a wrong £14.
 */
export function admissionFrom(html, node = {}) {
  const found = { free: null, adult: null, child: null, family: null, concession: null, note: null };

  // 1. What they marked up.
  if (node.isAccessibleForFree === true || node.isAccessibleForFree === 'true') found.free = true;
  for (const offer of [].concat(node.offers ?? []).flatMap((o) => [].concat(o?.offers ?? o))) {
    if (!offer || typeof offer !== 'object') continue;
    const price = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price;
    if (price == null || price === '') continue;
    const currency = offer.priceCurrency ?? offer.priceSpecification?.priceCurrency ?? 'GBP';
    const shown = currency === 'GBP' ? `£${price}` : `${price} ${currency}`;
    const label = String(offer.name ?? offer.category ?? '');
    const slot = TICKETS.find(([, re]) => re.test(label))?.[0] ?? 'adult';
    // A zero-priced offer is free entry only when its label says it is the general
    // ticket. A free child ticket beside a paid family one is not a free place, and
    // an unlabelled or unknown label — "Members", "Carer" — defaulted to the adult
    // slot and read as free for everyone (Codex). So free needs a general label and
    // nothing in it that names an audience or a date.
    // And only a fixed nought: an AggregateOffer from £0 to £20 reached here as its
    // lowPrice and read as free while its £20 was never seen (Codex). A range that
    // starts at nought is a paid place's cheapest ticket.
    const fixedZero = Number(offer.price ?? offer.priceSpecification?.price) === 0
      && !(Number(offer.highPrice) > 0) && offer['@type'] !== 'AggregateOffer';
    if (Number(price) === 0) {
      if (fixedZero && GENERAL_OFFER.test(label) && !QUALIFIED.test(label) && !TEMPORAL.test(label)) found.free = true;
      else if (Number(offer.highPrice) > 0) found[slot] ??= currency === 'GBP' ? `£${offer.highPrice}` : `${offer.highPrice} ${currency}`;
      continue;
    }
    found[slot] ??= shown;
  }

  const flat = flatten(html);

  // 2. What they printed. Either side of the word, because sites write it both
  // ways round — "Adults £32.00" and "£14.50 per adult" — and the nearer of the
  // two wins, so a list does not hand each label its neighbour's price.
  //
  // What may sit between a label and its price is the whole test. Only glue:
  // punctuation, and the handful of words that join a thing to its cost. An
  // "and" or a comma is not glue, it is the start of the next ticket, which is
  // the difference between reading "£14.50 per adult and £7.25 per child" right
  // and giving the grown-ups the child's price.
  // The bracketed aside is allowed because half of them write the age range
  // there — "Children (4-15) £24.00" — and refusing it loses the child price on
  // exactly the sites that were clearest about who it was for.
  const GLUE = /^[\s:.\u2013\u2014-]*(?:\([^)]{0,24}\))?[\s:.\u2013\u2014-]*(?:(?:from|only|just|each|per|price[sd]?|ticket[s]?|entry|admission|is|are|at|costs?|of|=)[\s:.\u2013\u2014-]*)*$/i;
  for (const [slot, re] of TICKETS) {
    if (found[slot]) continue;
    let best = null;
    for (const m of flat.matchAll(new RegExp(re.source, 'gi'))) {
      const end = m.index + m[0].length;
      const after = flat.slice(end, end + 40).match(MONEY);
      if (after && GLUE.test(flat.slice(end, end + after.index))) {
        best = { gap: after.index, price: after[0] };
      }
      const window = flat.slice(Math.max(0, m.index - 40), m.index);
      for (const b of window.matchAll(new RegExp(MONEY.source, 'gi'))) {
        const gap = window.length - (b.index + b[0].length);
        if (!GLUE.test(window.slice(b.index + b[0].length))) continue;
        if (!best || gap < best.gap) best = { gap, price: b[0] };
      }
      if (best) break;
    }
    if (best) found[slot] = best.price.replace(/\s/g, '');
  }

  if (found.free === null && !found.adult) {
    const flat = flattenBlocks(html); // sentence-bounded by blocks too; see BLOCK_END
    for (const m of flat.matchAll(FREE)) {
      // A qualifier on either side disqualifies the claim: "free admission all year"
      // is universal, but "Members enjoy free admission" and "free entry for children"
      // are somebody's free, not everybody's. The after-window alone missed the
      // qualifier that leads — "Members enjoy …" — and stored an unconditional Free
      // over a paid place (Codex). Confidently wrong is worse than no price.
      // Both checks are bound to the claim's own sentence: flatten() drops element and
      // sentence boundaries, so a qualifier in a neighbouring sentence must not count.
      // "Children can explore the play area. Admission is free." is free; "Admission is
      // free. Children can explore …" is free; only "free entry for children" or
      // "Members enjoy free admission" — same clause — are somebody's free (Codex).
      // Only a full stop, question or exclamation ends a sentence here. A colon or
      // semicolon INTRODUCES the restriction — "Free entry: members only", "Members:
      // free admission" — so it must stay inside the window or the qualifier is lost
      // and a paid venue reads Free (Codex). Terminators are . ! ? alone.
      // And the whole sentence, not a fixed window: "Members of the National Trust and
      // English Heritage currently receive free admission" puts its qualifier 60
      // characters ahead, and a 40-character lead read it as universal (Codex). A
      // page with no terminators at all makes the sentence long, which only ever
      // bars more — the conservative side, since a missed Free falls back to Google.
      const tail = flat.slice(m.index + m[0].length);
      const afterEnd = tail.search(/[.!?]/);
      const after = afterEnd >= 0 ? tail.slice(0, afterEnd) : tail;
      const lead = flat.slice(0, m.index);
      const before = lead.slice(lead.search(/[.!?][^.!?]*$/) + 1);
      const barred = (x) => QUALIFIED.test(x) || TEMPORAL.test(x);
      // Who gets it is said before the claim, and that list has no end — "Disabled
      // visitors receive free admission", "Competition winners receive free
      // admission" (Codex). So the lead is an allowlist, not a denylist: only words
      // that name the place or say it is open to all may stand before the claim in
      // its sentence; anything else and it is somebody's free, and Google's level
      // stands. A free place named only by its proper name ("Kew is free") falls
      // back too — the cheap side of being wrong.
      // The rest of the sentence is held to the same rule: "Admission is free except
      // for ticketed exhibitions", "Free admission for all military personnel" each
      // slipped a denylist (Codex), and that list has no end either. So the whole
      // sentence must be the claim and words that only name the place or say it is
      // open to everyone, all year; any other word and the claim is ambiguous, and an
      // ambiguous claim falls back to Google — it costs nothing (owner, 1 Oct 2026).
      const only = (x, ok) => (x.toLowerCase().match(/[a-z']+/g) ?? []).every((w) => ok.has(w));
      if (only(before, LEAD_WORDS) && only(after, TAIL_WORDS) && !barred(after) && !barred(before)) { found.free = true; break; }
    }
  }
  // A place that charges is not free, whatever a "free parking" line elsewhere
  // on the page said — and that holds for any paid ticket, not only the adult one:
  // a printed family or concession price means somebody pays at the gate (Codex).
  if (found.adult || found.child || found.family || found.concession) found.free = false;

  const said = Object.entries(found).filter(([, v]) => v !== null && v !== false);
  if (!said.length) return null;
  return { ...found, currency: 'GBP' };
}

/**
 * Read one venue's own page.
 *
 * Returns `{ phone, email, address, postcode, openingHours, cuisines,
 * priceRange, bookingUrl, socials, summary, menu, how }` — every field null
 * when the page does not say. Never throws: a site that is down simply gives us
 * nothing this time, and the record stays as it was.
 */
export async function siteFacts({ website, name = '', category = null, locality = null, knownAddress = null } = {}) {
  const url = String(website ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const [page, menu] = await Promise.all([
    fetchPage(url),
    // The menu lookup already knows how to follow their site; for somewhere you
    // eat it runs beside this read rather than after it.
    ['restaurant', 'cafe', 'bar', 'pub'].includes(category) ? findMenuUrl({ website: url, name, locality, address: knownAddress }).catch(() => null) : Promise.resolve(null),
  ]);
  if (!page) return menu?.url ? { menu, how: 'Their site did not answer, but the menu lookup found a page.' } : null;

  const { html } = page;
  const node = business(jsonLd(html)) ?? {};
  const { address, postcode } = addressFrom(node);

  const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const socials = {};
  for (const [key, re] of Object.entries(SOCIAL)) {
    const hit = links.find((h) => re.test(h));
    if (hit) { try { socials[key] = new URL(hit, page.url).toString().split('?')[0]; } catch { /* skip */ } }
  }
  const booking = links.find((h) => BOOKING_HOSTS.test(h));
  const linked = (scheme) => {
    const hit = links.find((h) => scheme.test(h));
    return hit ? hit.replace(scheme, '').split('?')[0].trim() || null : null;
  };
  // Through the one gate, wherever it came from. A `tel:` link carries what a
  // URL carries — `tel:+44%20(0)20%208564%208492` — and it reached the record,
  // and the screen, exactly like that (owner, 20 Sep 2026).
  const tel = phoneOf(text(node.telephone) ?? linked(/^tel:/i) ?? printedPhone(html));
  const mail = text(node.email) ?? linked(/^mailto:/i);

  // The one piece of their prose that is written to be quoted elsewhere.
  const meta = (html.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']{20,400})["']/i)
    || html.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']{20,400})["']/i) || [])[1] ?? null;

  const cuisines = [].concat(node.servesCuisine ?? []).map((c) => String(c).toLowerCase().trim()).filter(Boolean);

  return {
    phone: tel,
    email: mail && /@/.test(mail) ? mail : null,
    address,
    postcode,
    openingHours: hoursFrom(node),
    cuisines,
    priceRange: text(node.priceRange),
    admission: admissionFrom(html, node),
    bookingUrl: booking ? (() => { try { return new URL(booking, page.url).toString(); } catch { return null; } })() : null,
    socials,
    summary: meta ? meta.replace(/\s+/g, ' ').trim() : null,
    body: paragraphsOf(html),
    menu: menu ?? null,
    sourceUrl: page.url,
    how: node['@type'] ? `Read the ${[].concat(node['@type'])[0]} details they publish on ${new URL(page.url).hostname}.` : `Read ${new URL(page.url).hostname}.`,
  };
}
