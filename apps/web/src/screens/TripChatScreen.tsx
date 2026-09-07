import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, TripChat, TripDetail } from '../api';
import { colors, fonts, BORDER, ON_LIME } from '../theme';
import { Icon } from '../components/Icon';
import { MapGL, MapMarker, MapRoute } from '../components/MapGL';
import { Thread, Composer } from '../components/Thread';
import { StatusLine } from '../components/ui';
import { useViewport } from '../hooks/useViewport';
import { tripName } from './tripName';
import { firstName } from '../components/Faces';

/**
 * The trip's chat (trip rebuild, 7 Sep 2026, screen 5e).
 *
 * The same trip page with the map collapsed to a 120px strip and the drawer
 * taking the rest. It is a screen of its own rather than a mode of the map
 * screen because the map screen is a sheet you drag: a conversation with a
 * keyboard under it must not also be draggable, and a thread that scrolls
 * inside a sheet that scrolls is two scrollers fighting.
 *
 * Everything in the thread is here — per-stop Asks included, each carrying a
 * Moss pointer back to the stop it was asked on, which is the one thing that
 * keeps the two threads one conversation.
 */

const TABBAR = 70;
const STRIP = 120;

export function TripChatScreen({ trip, onBack, onOpenStop, onPeople }: {
  trip: TripDetail;
  onBack: () => void;
  onOpenStop: (venueRef: string) => void;
  onPeople: () => void;
}) {
  const { width, height } = useViewport();
  const wide = width >= 900;
  const id = trip.trip.id;
  const [data, setData] = useState<TripChat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.tripChat(id)); setError(null); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Opening the chat is reading it. The count on the button behind this screen
  // is what that clears, so it is marked as soon as the thread is on screen.
  useEffect(() => { api.readTripChat(id).catch(() => {}); }, [id, data?.messages.length]);

  /**
   * The strip is the trip's own map, not a picture of one: the stops, and the
   * line home. It is 120px, so nothing is labelled — at that height a chip is
   * bigger than the map it sits on.
   */
  const stops = trip.days.flatMap((d) => d.slots.flatMap((s) => s.stops)).filter((s) => s.lat != null);
  const home = trip.trip.origin;
  const markers: MapMarker[] = [
    ...(home?.lat != null ? [{ id: 'home', lat: home.lat, lng: home.lng, kind: 'home' as const }] : []),
    ...stops.map((s) => ({ id: s.id, lat: s.lat as number, lng: s.lng as number, kind: 'added' as const })),
  ];
  const routes: MapRoute[] = home?.lat != null && stops.length
    ? [{ id: 'route', points: [{ lat: home.lat, lng: home.lng }, ...stops.map((s) => ({ lat: s.lat as number, lng: s.lng as number }))] }]
    : [];

  const people = data?.people;
  const whoLine = people
    ? [
      people.members.map((m) => firstName(m.name)).join(', '),
      people.guests.length ? `${people.guests.map((g) => firstName(g.name)).join(', ')} as guest${people.guests.length === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ')
    : '';

  const send = async (body: string) => {
    setSending(true);
    try { setData(await api.sendTripMessage(id, { body })); setError(null); } catch (e: any) { setError(e.message); } finally { setSending(false); }
  };

  return (
    <View style={styles.page}>
      <View style={{ height: wide ? 180 : STRIP }}>
        <MapGL markers={markers} routes={routes} fitToMarkers fitKey={`chat:${markers.length}`} padding={{ top: 12, bottom: 12, left: 24, right: 24 }} />
      </View>

      <View style={[styles.drawer, wide && styles.drawerWide]}>
        <View style={styles.grabWrap}><View style={styles.grab} /></View>

        <View style={styles.head}>
          <View style={styles.headRow}>
            {/* Bare, like the drawer's (5h): no boxes in here. */}
            <Pressable onPress={onBack} style={styles.backBare} accessibilityRole="button" accessibilityLabel="Back to the trip">
              <Icon name="back" size={20} color={colors.ink} strokeWidth={2} />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>{tripName(trip.trip)}</Text>
            </View>
            <Pressable onPress={onPeople} style={styles.peopleBare} accessibilityRole="button" accessibilityLabel="Who's coming">
              <Icon name="household" size={20} color={colors.ink} strokeWidth={2} />
              <Text style={styles.peopleText}>{people?.count ?? trip.attendees.length}</Text>
            </Pressable>
            {/* Open: the icon sits on a small lime tile, which is the only fill
                in the header and says which of the two you are looking at. */}
            <View style={styles.chatOn}>
              <Icon name="message" size={20} color={ON_LIME} strokeWidth={2} />
            </View>
          </View>
          <View style={styles.chatBar}>
            <Text style={styles.chatTitle}>Chat</Text>
            <Text style={styles.chatWho} numberOfLines={1}>{whoLine}</Text>
          </View>
        </View>

        {error ? <View style={{ paddingHorizontal: 20, paddingTop: 8 }}><StatusLine tone="warn">{error}</StatusLine></View> : null}

        <Thread
          messages={data?.messages ?? []}
          onOpenStop={onOpenStop}
          empty="Nothing said yet. Say what you are thinking and everybody on the trip sees it."
        />
        {/* The tab bar floats over this page (the trip is full-bleed), so the
            composer keeps its own strip clear of it. */}
        <Composer placeholder="Message the group" onSend={send} busy={sending} insetBottom={TABBAR} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  // No top rule (5h): the grab handle is what says the drawer starts here.
  drawer: { flex: 1, minHeight: 0, backgroundColor: colors.bg },
  drawerWide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  grabWrap: { alignItems: 'center', paddingTop: 8 },
  grab: { width: 40, height: 4, backgroundColor: colors.lineSoft },

  head: { paddingHorizontal: 20, paddingTop: 10, gap: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backBare: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: -8 },
  title: { fontFamily: fonts.heading, fontSize: 24, fontWeight: '800', letterSpacing: -0.72, color: colors.ink },
  peopleBare: { height: 32, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  peopleText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
  chatOn: { width: 32, height: 32, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  chatBar: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
    paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  chatTitle: { fontFamily: fonts.heading, fontSize: 18, fontWeight: '800', letterSpacing: -0.36, color: colors.ink },
  chatWho: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, flexShrink: 1 },
});
