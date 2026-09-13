import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/press';
import { TripDetail, TripPlace } from '../api';
import { colors, fonts, BORDER, TARGET } from '../theme';
import { Icon } from '../components/Icon';
import { Stars } from '../components/Icon';
import { TopicList } from '../components/chat/TopicList';
import { tripDoor } from '../components/chat/door';
import { useRouter } from '../router';
import { paths } from '../routes';
import { VenueThumb } from '../components/VenueThumb';
import { useViewport } from '../hooks/useViewport';
import { TOP_INSET } from '../components/InspireHeader';

/**
 * One stop, opened from inside a trip, on its Ask tab (trip rebuild, 7 Sep
 * 2026, screen 3d).
 *
 * The Ask tab is the trip's list of questions filtered to this stop's tag
 * (Chat screens README §3: "the Ask thread *is* the topic list filtered to one
 * tag") — one conversation, two windows onto it. Asking from here opens the
 * composer with the stop already picked.
 *
 * Overview and Reviews are the tabs the handoff draws beside it, and the
 * handoff also says Reviews is "not designed yet". So Overview is what Epic
 * already knows about the stop — the day it is on, how long is allowed, the
 * household's own rating — and Reviews is a signpost into the place's own
 * drawer rather than a screen invented here.
 */

const mins = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`);

export function StopAskScreen({ trip, venueRef, place, onClose, onOpenPlace }: {
  trip: TripDetail;
  venueRef: string;
  /** What the trip already knows about this stop; null while it is loading. */
  place: TripPlace | null;
  onClose: () => void;
  /** The full drawer, which is where reviews and everything else about a place live. */
  onOpenPlace?: (venueRef: string) => void;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const id = trip.trip.id;
  const { navigate } = useRouter();
  const [tab, setTab] = useState<'overview' | 'reviews' | 'ask'>('ask');
  const door = useMemo(() => tripDoor(id), [id]);
  const [asks, setAsks] = useState<number | null>(null);

  const stop = trip.days
    .flatMap((d) => d.slots.flatMap((s) => s.stops.map((st) => ({ ...st, date: d.date }))))
    .find((s) => s.venueRef === venueRef) ?? null;

  const name = place?.name ?? stop?.name ?? 'This stop';
  const about = `stop:${venueRef}`;

  const kicker = [
    trip.trip.title ?? trip.trip.place?.label ?? trip.trip.locality,
    stop?.startTime,
  ].filter(Boolean).join(' · ');

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.head}>
        <View style={styles.topRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {kicker ? <Text style={styles.kicker}>{kicker.toUpperCase()}</Text> : null}
            <Text style={styles.title} numberOfLines={2}>{name}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[place?.category, stop?.dwellMinutes ? mins(stop.dwellMinutes) : null].filter(Boolean).join(' · ') || 'On this trip'}
            </Text>
          </View>
          <Press onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={20} color={colors.ink} strokeWidth={2.4} />
          </Press>
        </View>

        {/* The same photograph as the card that was tapped: inside the gutter,
            3:2, rounded (owner, 9 Sep 2026). It was a full-width 180px band
            with square corners. */}
        {place?.image ? (
          <View style={{ paddingHorizontal: 20 }}>
            <VenueThumb name={name} image={place.image} category={place.category} fill credit={false} />
          </View>
        ) : null}

        <View style={styles.tabs}>
          {([
            { key: 'overview' as const, label: 'Overview' },
            { key: 'reviews' as const, label: 'Reviews' },
            { key: 'ask' as const, label: asks ? `Ask · ${asks}` : 'Ask' },
          ]).map((t) => {
            const on = t.key === tab;
            return (
              <Press key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <View style={[styles.tab, on && styles.tabOn]}>
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
                </View>
              </Press>
            );
          })}
        </View>
      </View>

      {tab === 'ask' ? (
        <>
          <TopicList
            door={door}
            embedded
            fixedAbout={about}
            onOpen={(topicId) => navigate(paths.tripChatTopic(id, topicId))}
            onAsk={() => navigate(paths.tripChatAsk(id, about))}
            onCount={setAsks}
          />
          <View style={styles.askFoot}>
            <Press onPress={() => navigate(paths.tripChatAsk(id, about))} style={styles.askBtn} accessibilityRole="button">
              <Text style={styles.askBtnText}>Ask about this stop</Text>
              <Icon name="add" size={18} color={colors.primaryFg} strokeWidth={2.4} />
            </Press>
          </View>
        </>
      ) : null}

      {tab === 'overview' ? (
        <View style={styles.panel}>
          <Line label="On the day" value={stop?.startTime ? `${stop.startTime}${stop.dwellMinutes ? ` · ${mins(stop.dwellMinutes)}` : ''}` : 'Not timed yet'} />
          {place?.day ? <Line label="When" value={place.day} /> : null}
          {place?.phone ? <Line label="Ring ahead" value={place.phone} /> : null}
          {place?.score != null ? (
            <View style={styles.line}>
              <Text style={styles.lineLabel}>What we thought</Text>
              <Stars value={place.score}>{` ${place.score.toFixed(1)}`}</Stars>
            </View>
          ) : null}
          {onOpenPlace ? (
            <Press onPress={() => onOpenPlace(venueRef)} style={styles.link} accessibilityRole="button">
              <Text style={styles.linkText}>Everything about this place</Text>
              <Icon name="more" size={15} color={colors.accent} strokeWidth={2.4} />
            </Press>
          ) : null}
        </View>
      ) : null}

      {tab === 'reviews' ? (
        <View style={styles.panel}>
          <Text style={styles.body}>
            What other people made of this place is rented, not ours — it is fetched when it is shown and never
            written down (Technical Constraints §4). It lives in the place's own drawer, with the household's own
            marks beside it.
          </Text>
          {onOpenPlace ? (
            <Press onPress={() => onOpenPlace(venueRef)} style={styles.link} accessibilityRole="button">
              <Text style={styles.linkText}>Open the reviews</Text>
              <Icon name="more" size={15} color={colors.accent} strokeWidth={2.4} />
            </Press>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  head: { paddingTop: TOP_INSET, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20 },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88, textTransform: 'uppercase', color: colors.accent },
  title: { fontFamily: fonts.heading, fontSize: 32, fontWeight: '800', letterSpacing: -0.96, lineHeight: 34, color: colors.ink, marginTop: 4 },
  meta: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted, marginTop: 6 },
  close: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  tabs: { flexDirection: 'row', gap: 18, marginHorizontal: 20, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  tab: { paddingVertical: 6, borderBottomWidth: BORDER, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.ink },
  tabText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.inkMuted },
  tabTextOn: { color: colors.ink },

  panel: { padding: 20, gap: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  lineLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, width: 130 },
  lineValue: { flex: 1, fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, lineHeight: 19 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 14, minHeight: TARGET },
  linkText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.accent },
  askFoot: { paddingHorizontal: 20, paddingVertical: 10 },
  askBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primary, paddingHorizontal: 18, minHeight: 52 },
  askBtnText: { fontFamily: fonts.heading, fontSize: 16, fontWeight: '800', letterSpacing: -0.32, color: colors.primaryFg },
});
