/**
 * Booked (guest handoff G11): "It's in your Plans" in lime, the booking as a
 * card with its chip, then Add to calendar · Message the host, and See it in
 * Plans. An Ask to book says the host has a day to answer and the card is held.
 * Reached as `/bookings/<id>?done=1` straight after booking or paying. A free guest account (not a
 * member) also reads "We've emailed a confirmation with a calendar invite." — the "You're booked"
 * email carries the calendar file (api/src/sources/bookingCalendar.js); the booking says `guest`.
 */

import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { api, type GuestBooking } from '../../api';
import { CompactBand } from '../../components/Band';
import { mediaUrl } from '../../components/hosting';
import { paths } from '../../routes';
import { useRouter } from '../../router';
import { AMBER, BookingRows, Buttons, CHIP_BG, Foot, GuestPage, LIME, Notice, Para, Waiting, dayWords, firstName, useToast } from './kit';

/** A calendar file for the sessions booked, made on the phone; nothing is sent anywhere. */
/** An Ask to book in its own terms: the host's real deadline, and a hold only when there is one (Codex, 3 Oct 2026). */
function askedWords(b: GuestBooking, host: string): string {
  const by = b.request?.respondBy ? new Date(b.request.respondBy) : null;
  const hours = by ? Math.max(1, Math.round((by.getTime() - Date.now()) / 3_600_000)) : null;
  const when = hours == null ? 'has a little while' : hours >= 48 ? `has until ${dayWords(b.request!.respondBy!.slice(0, 10))}` : `has ${hours} hour${hours === 1 ? '' : 's'}`;
  const held = (b.money.heldPence ?? 0) > 0;
  return `${host} ${when} to say yes.${held ? ' Your card is held, not charged.' : ''}`;
}

export function calendarFile(b: GuestBooking): string {
  const stamp = (d: string, t: string | null) => `${d.replace(/-/g, '')}T${(t ?? '09:00').replace(':', '')}00`;
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const events = b.sessions.filter((s) => s.booked && s.state === 'scheduled').map((s) => [
    'BEGIN:VEVENT', `UID:${b.id}-${s.id}@epic.day`, `DTSTART;TZID=Europe/London:${stamp(s.date, s.time)}`,
    `DTEND;TZID=Europe/London:${stamp(s.date, s.endsAt ?? s.time)}`, `SUMMARY:${esc(b.event.title ?? 'Epic')}`,
    ...(b.where.label ? [`LOCATION:${esc(b.where.label)}`] : []), 'END:VEVENT',
  ].join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Epic//Guest//EN', ...events, 'END:VCALENDAR'].join('\r\n');
}

export function addToCalendar(b: GuestBooking): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([calendarFile(b)], { type: 'text/calendar' }));
  const a = document.createElement('a'); a.href = url; a.download = `${(b.event.title ?? 'epic').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  return true;
}

export function Booked({ id }: { id: string }) {
  const { navigate } = useRouter();
  const toast = useToast();
  const [b, setB] = useState<GuestBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.guestBooking(id).then((r) => setB(r.booking)).catch((e) => setError(e?.message ?? 'That booking didn’t load.')); }, [id]);
  if (!b) return <Waiting error={error} />;

  const asked = b.request?.state === 'asked';
  const host = firstName(b.event.host.name);
  const next = b.sessions.find((s) => s.booked && !s.finished) ?? b.sessions[0];
  const line = b.request ? `${b.request.date ? dayWords(b.request.date) : ''}${b.request.time ? ` · ${b.request.time}` : ''}` : next ? `${dayWords(next.date)}${next.time ? ` · ${next.time}` : ''}` : '';
  const extra = b.goingAhead && b.chip === 'waiting' ? `${b.goingAhead.booked} of ${b.goingAhead.min}${b.goingAhead.decidesOn ? ` · decided ${dayWords(b.goingAhead.decidesOn)}` : ''}` : null;

  return (
    <GuestPage
      head={<CompactBand title={asked ? 'Request sent' : 'You’re booked'} context={b.event.title ?? ''} onBack={() => navigate(paths.trips())} />}
      foot={<Foot label="See it in Plans" onPress={() => navigate(paths.trips())} />}
      overlay={toast.node}>
      <Notice bg={LIME} weight="700">{asked ? askedWords(b, host) : 'It’s in your Plans.'}</Notice>
      {b.guest && !asked ? <Para>We’ve emailed a confirmation with a calendar invite.</Para> : null}
      <BookingRows items={[{ key: b.id, photo: mediaUrl(b.event.photo), title: b.event.title ?? 'Your booking', line, chip: b.chipWords, chipBg: CHIP_BG[b.chip] ?? AMBER, extra, onPress: () => navigate(paths.booking(b.id)) }]} />
      <Buttons items={[
        // Nothing to put in a calendar until there's a session: an Ask to book has one only once the host accepts.
        ...(b.sessions.some((s) => s.booked) ? [{ label: 'Add to calendar', icon: 'calendar' as const, onPress: () => { if (addToCalendar(b)) toast.show('Added to your calendar'); } }] : []),
        { label: 'Message the host', icon: 'message', onPress: () => navigate(paths.bookingChat(b.id)) },
      ]} />
    </GuestPage>
  );
}
