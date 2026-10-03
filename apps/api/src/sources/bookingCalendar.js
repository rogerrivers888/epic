/**
 * The emailed calendar invite (guest build order (b), Roger, 3 Oct 2026): a booking's sessions as a
 * calendar file, attached to the "You're booked" email and again to "has moved", so a guest's
 * calendar holds the dates they are booked on and follows a host's change of date.
 *
 * Made here from what Epic holds — the booked sessions, the event's title and its time zone — the
 * same facts the booking page shows. The place is the area until the booking is confirmed, and the
 * exact address only once it is (or when the host never hid it), as on the booking page. Nothing
 * rented is ever in it.
 *
 * Each session keeps one UID for good (`<booking>-<session>@epic.day`), and SEQUENCE rises with
 * each file, so a calendar that already holds the event updates it rather than adding a second.
 */

import { query } from '../db.js';
import { localInstant } from '../domain/lanes.js';

const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const hm = (t) => (t ? String(t).slice(0, 5) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RFC 5545 text: backslash, comma and semicolon escaped, new lines as \n, lines folded at 75 octets. */
const esc = (s) => String(s ?? '').replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\r\n|\r|\n/g, '\\n');
function fold(line) {
  const out = [];
  let rest = Buffer.from(line, 'utf8');
  let first = true;
  while (rest.length > (first ? 75 : 74)) {
    let cut = first ? 75 : 74;
    // Never split a UTF-8 character.
    while (cut > 0 && (rest[cut] & 0xc0) === 0x80) cut -= 1;
    out.push((first ? '' : ' ') + rest.subarray(0, cut).toString('utf8'));
    rest = rest.subarray(cut);
    first = false;
  }
  out.push((first ? '' : ' ') + rest.toString('utf8'));
  return out.join('\r\n');
}
const stamp = (date, time) => `${date.replace(/-/g, '')}T${(time ?? '09:00').replace(':', '')}00`;
const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dayAfter = (date) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return ymd(d); };

/** The calendar file for one booking, or null when it has no session still to come. */
export async function bookingCalendar(bookingId, { now = new Date(), appUrl = '' } = {}) {
  if (!UUID.test(String(bookingId ?? ''))) return null;
  const { rows: [b] } = await query(
    `select b.id, b.state, o.title, o.venue_label, o.venue_area, o.address_hidden, o.time_zone, o.duration_min, o.lane
       from experience_bookings b join host_offers o on o.id = b.offer_id where b.id = $1`,
    [bookingId],
  );
  if (!b || b.state === 'cancelled') return null;
  const { rows } = await query(
    `select s.id, s.on_date, s.ends_on, s.starts_at, s.ends_at from booking_sessions bs join offer_sessions s on s.id = bs.session_id
      where bs.booking_id = $1 and bs.state = 'booked' and s.state = 'scheduled' and coalesce(s.ends_on, s.on_date) >= $2::date - 1
      order by s.on_date, s.starts_at nulls first`,
    [b.id, ymd(now)],
  );
  const tz = b.time_zone || 'Europe/London';
  // Still to come where the event is, not by the UTC date (Codex, 3 Oct 2026): a session without an end time runs to
  // the end of its last day.
  const endOf = (s) => {
    const last = ymd(s.ends_on) ?? ymd(s.on_date);
    return hm(s.ends_at) ? localInstant(last, hm(s.ends_at), tz) : localInstant(dayAfter(last), '00:00', tz);
  };
  const sessions = rows.filter((s) => endOf(s) > now);
  if (!sessions.length) return null;
  const where = (b.address_hidden === false || ['confirmed', 'attended'].includes(b.state) ? b.venue_label : null) ?? b.venue_area ?? null;
  // Rises with every file sent, so a calendar keeps the newest.
  const sequence = Math.floor(now.getTime() / 1000);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Epic//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const s of sessions) {
    const date = ymd(s.on_date);
    const endDate = ymd(s.ends_on) ?? date;
    const start = hm(s.starts_at);
    const end = hm(s.ends_at);
    lines.push('BEGIN:VEVENT', `UID:${b.id}-${s.id}@epic.day`, `SEQUENCE:${sequence}`, `DTSTAMP:${utcStamp(now)}`);
    // A one-off over several days is stored a day a session: the first day has only its start, the last only its
    // end, the days between neither (lanes.js sessionsFor). Each runs to or from midnight (Codex, 3 Oct 2026).
    if (start && end) {
      lines.push(`DTSTART;TZID=${tz}:${stamp(date, start)}`, `DTEND;TZID=${tz}:${stamp(endDate, end)}`);
    } else if (start) {
      lines.push(`DTSTART;TZID=${tz}:${stamp(date, start)}`);
      if (b.lane === 'oneoff') lines.push(`DTEND;TZID=${tz}:${stamp(dayAfter(endDate), '00:00')}`);
      else lines.push(`DURATION:PT${Math.max(15, Number(b.duration_min) || 60)}M`);
    } else if (end) {
      lines.push(`DTSTART;TZID=${tz}:${stamp(date, '00:00')}`, `DTEND;TZID=${tz}:${stamp(endDate, end)}`);
    } else {
      // No time either end: an all-day entry on its date(s).
      lines.push(`DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${dayAfter(endDate).replace(/-/g, '')}`);
    }
    lines.push(`SUMMARY:${esc(b.title ?? 'Epic')}`);
    if (where) lines.push(`LOCATION:${esc(where)}`);
    if (appUrl) lines.push(`URL:${appUrl}/bookings/${b.id}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const name = `${String(b.title ?? 'epic').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'epic'}.ics`;
  return { name, content: lines.map(fold).join('\r\n') + '\r\n', contentType: 'text/calendar; charset=utf-8; method=PUBLISH' };
}

/** The booking a notification is about, from its link (`/bookings/<id>`). */
export function bookingOfLink(link) {
  const m = /^\/bookings\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(String(link ?? ''));
  return m ? m[1] : null;
}
