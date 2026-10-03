/**
 * Plans › Events (guest handoff G14) — under the signed-off Plans home (4c), the
 * third tab of the ink bar: Upcoming, Invites, Past. Each row is the booking as
 * a card: 60px photo, title, date line, status chip and a deep-green extra (who
 * it's for — "Ava and Ravi" — "3 of 4", "11 h left", "Reply", "Refunded", "Hold released"). Past
 * rows still waiting for a rating say Rate it.
 *
 * And Messages (G31): one thread per booking and per question, newest first,
 * unread in bold with a count — each opening where its messages already live.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, type GuestBookedList, type GuestCard } from '../../api';
import { CompactBand } from '../../components/Band';
import { mediaUrl } from '../../components/hosting';
import { paths, withQuery } from '../../routes';
import { useRouter } from '../../router';
import { storage } from '../../storage';
import { cardExtra } from './bookingWords';
import { BookingRows, CHIP_BG, Promo, GuestPage, INACTIVE, INK_MUTED, Kick, LIME, Para, Rows, Waiting, dayWords, shortDay, tx, type BookingCard } from './kit';

// Under the epic.screen family the cookie notice already names.
const PROMO_KEY = 'epic.screen.guestPromo';

function cardOf(c: GuestCard, navigate: (h: string) => void): BookingCard {
  const date = c.date ? `${dayWords(c.date)}${c.time ? ` · ${c.time}` : ''}` : '';
  const line = c.session ? `Session ${c.session.n} of ${c.session.of}${c.date ? ` · ${dayWords(c.date)}` : ''}` : date;
  const chip = c.rateIt ? 'Rate it' : c.chipWords;
  const chipBg = c.rateIt ? LIME : c.offered ? LIME : CHIP_BG[c.chip] ?? INACTIVE;
  // "11 h left", "3 of 4", "Hold released", "Refunded" — otherwise who it's for, "Ava and Ravi".
  const extra = cardExtra(c);
  return {
    key: c.id ?? c.waitlistId ?? c.offerId, photo: mediaUrl(c.photo), title: c.title ?? 'An event', line: line || ' ', chip, chipBg, extra,
    dim: c.chip === 'called_off' || c.chip === 'cancelled',
    onPress: () => navigate(c.id ? (c.rateIt ? paths.bookingRate(c.id) : paths.booking(c.id)) : paths.experience(c.offerId)),
  };
}

/** The Events tab's body, under the Plans band and ink bar. */
export function PlansEvents({ guest = false }: { guest?: boolean }) {
  const { navigate } = useRouter();
  // The one gentle prompt (G21): an ink banner, dismissed for good with its ×.
  const [promo, setPromo] = useState(() => guest && storage.getItem(PROMO_KEY) !== 'dismissed');
  const [d, setD] = useState<GuestBookedList | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.guestBooked().then(setD).catch((e) => setError(e?.message ?? 'Your events didn’t load.')); }, []);
  if (!d) return <View style={{ padding: 20 }}><Text style={tx(14, '400', INK_MUTED)}>{error ?? 'Loading…'}</Text></View>;
  const nothing = !d.upcoming.length && !d.invites.length && !d.past.length;
  return (
    <ScrollView contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 22, gap: 14 }}>
      {promo ? <Promo title="Plan your next day out with Epic" line="1 month free, then from £5.99 a month" onPress={() => navigate(paths.inspire())}
                      onClose={() => { storage.setItem(PROMO_KEY, 'dismissed'); setPromo(false); }} /> : null}
      {d.upcoming.length ? <><Kick>Upcoming</Kick><BookingRows items={d.upcoming.map((c) => cardOf(c, navigate))} /></> : null}
      {d.invites.length ? (
        <>
          <Kick top={6}>Invites</Kick>
          <BookingRows items={d.invites.map((i) => ({
            key: i.id, photo: mediaUrl(i.photo), title: i.title ?? 'An invitation', line: `${i.date ? `${dayWords(i.date)} · ` : ''}from ${i.host ?? 'a host'}`,
            chip: 'Invite', chipBg: CHIP_BG.invite, extra: 'Reply', onPress: () => navigate(paths.invited(i.token)),
          }))} />
        </>
      ) : null}
      {d.past.length ? <><Kick top={6}>Past</Kick><BookingRows items={d.past.map((c) => cardOf(c, navigate))} /></> : null}
      {nothing ? <Para color={INK_MUTED}>Nothing booked yet. Events near you are in Inspire.</Para> : null}
    </ScrollView>
  );
}

const when = (iso: string) => {
  const d = new Date(iso); const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return shortDay(iso);
};

/** Messages (G31): the inbox, under the lime sub-page header. */
export function Inbox() {
  const { navigate, back } = useRouter();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.guestMessages>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.guestMessages().then(setD).catch((e) => setError(e?.message ?? 'Messages didn’t load.')); }, []);
  if (!d) return <Waiting error={error} />;
  return (
    <GuestPage head={<CompactBand title="Messages" context={d.unread ? `${d.unread} unread` : undefined} onBack={() => back(paths.trips())} />}>
      {d.threads.length ? (
        <Rows items={d.threads.map((t) => ({
          key: t.offerId, title: `${t.host}${t.unread ? `  ·  ${t.unread} new` : ''}`, sub: `${t.title ?? 'An event'} · ${t.last}`, value: when(t.at), valueColor: INK_MUTED,
          weight: t.unread ? '800' as const : '600' as const,
          onPress: () => navigate(t.bookingId ? paths.bookingChat(t.bookingId) : withQuery(paths.experience(t.offerId), { topic: t.topicId })),
        }))} />
      ) : <Para color={INK_MUTED}>No messages yet. Ask a host something from their event, and it’s here.</Para>}
      {d.capped ? <Para color={INK_MUTED}>The latest 100.</Para> : null}
    </GuestPage>
  );
}
