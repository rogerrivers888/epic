/**
 * Epic Events on the web (brief, 3 Oct 2026): what a public event page and a
 * host page say to anybody, signed in or not, and to Google.
 *
 *   GET /api/public/events/:code    an event's page: status, the safe facts, its host as "Hannah R."
 *   GET /api/public/hosts/:code     a host's page: their events and reviews
 *   GET /api/public/sitemap         every indexable event and host, with lastmod
 *   GET /api/public/media/:id       a photo, only while it belongs to a page shown here
 *
 * Mounted outside the session door and admitted by the launch gate: nothing
 * here needs an account, nothing here spends, and nothing here writes (not even
 * an Insights view — crawlers would make it up). What is never published: a
 * host's home address or coordinates, an exact venue before booking, guest
 * names, children's details, and anything from Google (brief §4, §5).
 *
 * Status of an event (brief §1):
 *   live        public, live (or paused by the host for a while), still to come
 *   finished    its last date passed in the last 90 days — "This has finished"
 *   called_off  called off in the last 30 days — shown with alternatives
 *   expired     past those windows: still shown, noindex, until its subcategory page exists — then
 *               a 301 there (EPIC_EVENT_CATEGORY_PAGES). Never a 410: the page may have had traffic (Roger, 3 Oct 2026)
 *   gone        its host paused or stopped; the same as expired
 * `ended` says why it is over — finished, called_off or host — so the page can say so.
 * Drafts, events in review, private and link-only events are a 404 — they are
 * not on the web at all (a private event is only ever at /in/{token}).
 */

import { Router } from 'express';
import { query } from '../db.js';
import * as repo from '../repositories/hosting.js';
import { localDay, perPersonAt, refundWords, hostingConfig } from '../domain/lanes.js';
import { moodOf } from './guestBookings.js';

const router = Router();
export default router;

const CODE = /^[a-z0-9]{6}$/;
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const hm = (t) => (t ? String(t).slice(0, 5) : null);
const FINISHED_DAYS = 90;
const CALLED_OFF_DAYS = 30;
const KIND_WORDS = { oneoff: 'One-off', weekly: 'Weekly', course: 'Course', onrequest: 'On request' };

/** "hannah-r", "fossil-hunting-with-a-geologist": lowercase, hyphens, nothing else, no more than 60 characters. */
export function slugOf(words) {
  const s = String(words ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (s.slice(0, 60).replace(/-+$/, '') || 'event');
}

/** First name and surname initial on public pages (brief §5): "Hannah Robinson" → "Hannah R.". */
export function publicName(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'An Epic host';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export const eventPath = (o, locale = 'en-gb') => `/${locale}/event/${slugOf(o.title)}-${o.public_code}`;
export const hostPath = (h, locale = 'en-gb') => `/${locale}/hosts/${slugOf(publicName(h.name))}-${h.public_code}`;
const media = (id) => (id ? `/api/public/media/${id}` : null);
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86_400_000);

/** The offers that are on the web at all: a public event from the four lanes, past review. */
const LISTED = `o.lane is not null and o.visibility = 'public' and o.state in ('live', 'paused', 'ended')`;

/** What an event's status is today, from its sessions and its host (see the file header). */
export function eventStatus(o, host, sessions, today) {
  if (!host || host.paused || host.stopped_at) return { status: 'gone', ended: 'host' };
  // Only a session that is on counts: one called off for numbers, or cancelled, is neither next nor last (Codex, 3 Oct 2026).
  const live = sessions.filter((s) => s.state === 'scheduled' || s.state === 'done');
  // Called off for numbers, or every remaining session cancelled by the host: called off, either way (Codex, 3 Oct 2026).
  if (o.called_off_at || o.cancelled_at) {
    const on = ymd(o.called_off_at ?? o.cancelled_at);
    return { status: daysBetween(on, today) > CALLED_OFF_DAYS ? 'expired' : 'called_off', on, ended: 'called_off' };
  }
  const last = live.length ? ymd(live[live.length - 1].ends_on ?? live[live.length - 1].on_date) : null;
  // Nothing left on, and what was left was called off for numbers (a Weekly's remaining sessions, say): called off,
  // not finished — the offer itself carries no called_off_at then (Roger, 3 Oct 2026).
  const offAfter = sessions.filter((s) => s.state === 'called_off' && (!last || ymd(s.on_date) > last));
  if (o.lane !== 'onrequest' && !live.some((s) => s.state === 'scheduled' && ymd(s.ends_on ?? s.on_date) >= today) && offAfter.length) {
    // From when it was called off, not the date it would have run (Codex, 3 Oct 2026).
    const at = offAfter.map((s) => s.called_off_at).filter(Boolean).sort().pop();
    const on = ymd(at ?? offAfter[offAfter.length - 1].on_date);
    return { status: daysBetween(on, today) > CALLED_OFF_DAYS ? 'expired' : 'called_off', on, ended: 'called_off' };
  }
  const ahead = live.some((s) => s.state === 'scheduled' && ymd(s.ends_on ?? s.on_date) >= today);
  // Dated, and nothing on still to come (every session past, called off or cancelled): over.
  const ended = o.state === 'ended' || (o.lane !== 'onrequest' && sessions.length > 0 && !ahead);
  if (!ended) return { status: 'live' };
  const on = last ?? ymd(o.updated_at) ?? today;
  return { status: daysBetween(on, today) > FINISHED_DAYS ? 'expired' : 'finished', on, ended: 'finished' };
}

function priceOf(o) {
  return {
    mode: o.price_mode ?? 'free', pence: o.price_pence, childPence: o.child_pence, dropInPence: o.drop_in_pence, bookAheadPence: o.book_ahead_pence,
    nowEach: o.price_mode === 'by_numbers' && o.total_pence && o.min_count ? perPersonAt(o.total_pence, o.min_count) : null,
  };
}

async function sessionsOf(ids) {
  if (!ids.length) return new Map();
  const { rows } = await query(
    `select offer_id, on_date, ends_on, starts_at, ends_at, state, called_off_at from offer_sessions where offer_id = any($1::uuid[]) order by on_date, starts_at nulls first`,
    [ids],
  );
  const by = new Map();
  for (const r of rows) { const l = by.get(r.offer_id) ?? []; l.push(r); by.set(r.offer_id, l); }
  return by;
}

/** A card for another event: more from this host, or more like this. */
function cardOf(o, sessions, today) {
  const next = sessions.find((s) => s.state === 'scheduled' && ymd(s.on_date) >= today) ?? null;
  return { code: o.public_code, path: eventPath(o), offerId: o.id, title: o.title, lane: o.lane, kind: KIND_WORDS[o.lane] ?? null, photo: media(o.photo_ids?.[0]), area: o.venue_area ?? null, date: next ? ymd(next.on_date) : null, time: next ? hm(next.starts_at) : null, price: priceOf(o) };
}

/** Live, listed events, with their sessions — for "More from" and "More like this". */
async function liveCards(where, params, today, limit = 4) {
  const { rows } = await query(
    `select o.* from host_offers o join hosts h on h.id = o.host_id
      where ${LISTED} and o.state = 'live' and o.called_off_at is null and o.cancelled_at is null and not coalesce(h.paused, false) and h.stopped_at is null and ${where}
      order by o.updated_at desc limit 40`,
    params,
  );
  const by = await sessionsOf(rows.map((r) => r.id));
  const host = { paused: false, stopped_at: null };
  return rows
    .filter((o) => eventStatus(o, host, by.get(o.id) ?? [], today).status === 'live')
    .slice(0, limit)
    .map((o) => cardOf(o, by.get(o.id) ?? [], today));
}

/**
 * Live public events like this one from other hosts — the same subcategory or category. "More like this" on the
 * public page; on a booking that didn't happen, "Similar, nearby" (guest handoff G17) and "Similar hosts nearby"
 * (G28), where `nearKm` keeps them within reach of where this one was (a straight line, as Events near you
 * estimates it). With no point to measure from, nothing is called near: an empty list, never a guess. An event
 * with neither a subcategory nor a category is like nothing.
 */
export async function similarEvents(o, today, { nearKm = null, limit = 4 } = {}) {
  if (!o.what_label && !o.what_category) return [];
  const params = [o.id, o.host_id, o.what_label ?? '', o.what_category ?? ''];
  let where = `o.id <> $1 and o.host_id <> $2 and (($3 <> '' and lower(coalesce(o.what_label, '')) = lower($3)) or ($4 <> '' and o.what_category = $4))`;
  if (nearKm != null) {
    const { rows: [at] } = await query('select coalesce($2::float8, h.lat) as lat, coalesce($3::float8, h.lng) as lng from hosts h where h.id = $1', [o.host_id, o.venue_lat ?? null, o.venue_lng ?? null]);
    if (at?.lat == null || at?.lng == null) return [];
    params.push(at.lat, at.lng, nearKm);
    const lat = 'coalesce(o.venue_lat, h.lat)'; const lng = 'coalesce(o.venue_lng, h.lng)';
    where += ` and ${lat} is not null and ${lng} is not null
      and (6371 * acos(least(1, cos(radians($5)) * cos(radians(${lat})) * cos(radians(${lng}) - radians($6)) + sin(radians($5)) * sin(radians(${lat}))))) <= $7`;
  }
  return liveCards(where, params, today, limit);
}

async function reviewsOf(hostId) {
  // The rating over every published review, not the newest fifty the list carries (Codex, 3 Oct 2026).
  const [rows, total, all] = await Promise.all([repo.publishedReviews(hostId), repo.publishedReviewCount(hostId), repo.ratingOf(hostId)]);
  return {
    total,
    rating: all.rating == null ? null : Math.round(all.rating * 10) / 10,
    // The reviewer by first name only; the host's reply beside it.
    items: rows.slice(0, 6).map((r) => ({ stars: r.stars, text: r.text, who: r.who || null, on: ymd(r.publish_on), reply: r.reply ?? null })),
  };
}

router.get('/events/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code ?? '').toLowerCase();
    if (!CODE.test(code)) return res.status(404).json({ error: 'not_found' });
    const { rows: [o] } = await query(`select o.* from host_offers o where o.public_code = $1 and ${LISTED}`, [code]);
    if (!o) return res.status(404).json({ error: 'not_found' });
    const { rows: [h] } = await query('select * from hosts where id = $1', [o.host_id]);
    const today = localDay(new Date(), o.time_zone ?? 'Europe/London');
    const sessions = (await sessionsOf([o.id])).get(o.id) ?? [];
    const st = eventStatus(o, h, sessions, today);
    const mood = moodOf(o.what_category, `${o.what_label ?? ''} ${o.title ?? ''}`);
    // Every status gets the whole page: a page that has left the index stays readable (Roger, 3 Oct 2026).
    const base = { code: o.public_code, path: eventPath(o), status: st.status, ended: st.ended ?? null, on: st.on ?? null, mood, subcategory: o.what_label ?? null };
    // Every session still to come (a course runs to 20), and the count, so the page never says 12 of 20 (Codex, 3 Oct 2026).
    const ahead = sessions.filter((s) => s.state === 'scheduled' && ymd(s.ends_on ?? s.on_date) >= today).slice(0, 40);
    const [reviews, moreFromHost, similar] = await Promise.all([
      reviewsOf(h.id),
      liveCards('o.host_id = $1 and o.id <> $2', [h.id, o.id], today),
      similarEvents(o, today),
    ]);
    const cfg = hostingConfig();
    res.json({
      ...base,
      offerId: o.id, title: o.title, summary: o.summary ?? null, description: o.description ?? null,
      // Live and taking bookings — a host may pause a listing for a while; its page stays, its Book does not (Codex, 3 Oct 2026).
      bookable: st.status === 'live' && o.state === 'live',
      lane: o.lane, kind: KIND_WORDS[o.lane] ?? null, category: o.what_category ?? null,
      photos: (o.photo_ids ?? []).slice(0, 8).map(media),
      // The town and the area only — the exact place is for those who book (brief §5).
      where: { area: o.venue_area ?? null, online: o.venue === 'online' },
      when: {
        sessions: ahead.map((s) => ({ date: ymd(s.on_date), endsOn: ymd(s.ends_on), time: hm(s.starts_at), endsAt: hm(s.ends_at) })),
        first: sessions[0] ? ymd(sessions[0].on_date) : null, last: sessions.length ? ymd(sessions[sessions.length - 1].ends_on ?? sessions[sessions.length - 1].on_date) : null,
        startsAt: hm(o.starts_at), endsAt: hm(o.ends_at), timeZone: o.time_zone ?? 'Europe/London',
      },
      price: priceOf(o),
      who: { ageMin: o.age_min, ageMax: o.age_max, dropOff: o.parents === 'drop_off', checked: h.checked_state === 'passed' },
      refundWords: o.refund_policy && o.price_mode && o.price_mode !== 'free' ? refundWords(o.refund_policy, cfg) : null,
      host: { code: h.public_code, path: hostPath(h), name: publicName(h.name), photo: media(h.photo_id), checked: h.checked_state === 'passed', since: ymd(h.created_at) },
      reviews, moreFromHost, similar,
      updatedAt: o.updated_at,
    });
  } catch (err) { next(err); }
});

/** A host is indexable with at least one live public event or a review (brief §4); paused or stopped is 410. */
async function hostPayload(h, today) {
  const { rows: offers } = await query(`select o.* from host_offers o where o.host_id = $1 and ${LISTED} order by o.updated_at desc`, [h.id]);
  const by = await sessionsOf(offers.map((o) => o.id));
  const shown = offers.filter((o) => ['live', 'finished'].includes(eventStatus(o, h, by.get(o.id) ?? [], today).status));
  const live = shown.filter((o) => eventStatus(o, h, by.get(o.id) ?? [], today).status === 'live');
  const reviews = await reviewsOf(h.id);
  // Their main subcategory and town, from their own events (owned facts; never their home).
  const count = (xs) => { const m = new Map(); for (const x of xs.filter(Boolean)) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
  return {
    code: h.public_code, path: hostPath(h), status: 'live', indexable: live.length > 0 || reviews.total > 0,
    name: publicName(h.name), photo: media(h.photo_id), intro: h.intro_text ?? null, checked: h.checked_state === 'passed', since: ymd(h.created_at),
    subcategory: count(offers.map((o) => o.what_label)), town: count(offers.map((o) => o.venue_area)),
    events: live.map((o) => cardOf(o, by.get(o.id) ?? [], today)),
    finished: shown.filter((o) => !live.includes(o)).slice(0, 6).map((o) => cardOf(o, by.get(o.id) ?? [], today)),
    reviews, updatedAt: h.updated_at ?? null,
  };
}

/** A host with nothing listed and nothing reviewed has no public page at all. */
const hostShown = (out) => out.events.length > 0 || out.finished.length > 0 || out.reviews.total > 0;

router.get('/hosts/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code ?? '').toLowerCase();
    if (!CODE.test(code)) return res.status(404).json({ error: 'not_found' });
    const { rows: [h] } = await query('select * from hosts where public_code = $1', [code]);
    if (!h) return res.status(404).json({ error: 'not_found' });
    if (h.paused || h.stopped_at) return res.json({ code: h.public_code, path: hostPath(h), status: 'gone' });
    const out = await hostPayload(h, localDay(new Date(), 'Europe/London'));
    if (!hostShown(out)) return res.status(404).json({ error: 'not_found' });
    res.json(out);
  } catch (err) { next(err); }
});

/** Every indexable page, for the per-locale sitemaps: live, finished (90 days) and called-off (30 days) events; hosts with something to show. */
router.get('/sitemap', async (_req, res, next) => {
  try {
    const { rows: offers } = await query(
      `select o.*, h.paused as host_paused, h.stopped_at as host_stopped from host_offers o join hosts h on h.id = o.host_id where ${LISTED} order by o.updated_at desc limit 50000`,
    );
    const by = await sessionsOf(offers.map((o) => o.id));
    const events = [];
    const hostIds = new Set();
    for (const o of offers) {
      const st = eventStatus(o, { paused: o.host_paused, stopped_at: o.host_stopped }, by.get(o.id) ?? [], localDay(new Date(), o.time_zone ?? 'Europe/London'));
      if (!['live', 'finished', 'called_off'].includes(st.status)) continue;
      events.push({ path: eventPath(o), lastmod: (o.updated_at instanceof Date ? o.updated_at : new Date(o.updated_at ?? Date.now())).toISOString().slice(0, 10) });
      if (st.status === 'live') hostIds.add(o.host_id);
    }
    const { rows: reviewed } = await query(
      `select distinct host_id from host_reviews where side = 'guest' and not hidden and publish_on <= current_date`,
    );
    for (const r of reviewed) hostIds.add(r.host_id);
    const { rows: hosts } = hostIds.size ? await query(
      'select * from hosts where id = any($1::uuid[]) and not coalesce(paused, false) and stopped_at is null', [[...hostIds]],
    ) : { rows: [] };
    res.json({
      events,
      hosts: hosts.map((h) => ({ path: hostPath(h), lastmod: (h.updated_at instanceof Date ? h.updated_at : new Date(h.updated_at ?? Date.now())).toISOString().slice(0, 10) })),
      capped: offers.length === 50000,
    });
  } catch (err) { next(err); }
});

/**
 * A photo on a public page, and only while it is on one: an event's photo while its page is up (every listed
 * event's page stays up), a host's photo while their page is. Only the host's own uploads (host_media) — never
 * a video, a document, anything private, or anything from Google (J8).
 */
router.get('/media/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).end();
    const { rows: offers } = await query(
      `select o.*, h.paused as host_paused, h.stopped_at as host_stopped from host_offers o join hosts h on h.id = o.host_id
        where ${LISTED} and o.photo_ids @> to_jsonb(array[$1::text])`,
      [id],
    );
    let allowed = offers.length > 0;
    if (!allowed) {
      // A host's photo exactly when their page is shown — the same test the page itself makes (Codex, 3 Oct 2026).
      const { rows: [h] } = await query(`select * from hosts where photo_id::text = $1 and not coalesce(paused, false) and stopped_at is null`, [id]);
      if (h) allowed = hostShown(await hostPayload(h, localDay(new Date(), 'Europe/London')));
    }
    if (!allowed) return res.status(404).end();
    const m = await repo.mediaById(id);
    // Never a row the household marked private (identity evidence, a document), whatever an offer points at (Codex, 3 Oct 2026).
    if (!m || m.is_private || m.kind !== 'photo' || !String(m.mime ?? '').startsWith('image/')) return res.status(404).end();
    res.setHeader('content-type', m.mime);
    // A day, not a year: a photo leaves the web when its page does.
    res.setHeader('cache-control', 'public, max-age=86400');
    res.setHeader('content-length', m.size);
    res.end(m.bytes);
  } catch (err) { next(err); }
});
