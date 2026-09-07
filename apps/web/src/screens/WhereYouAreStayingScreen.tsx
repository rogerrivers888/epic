import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Place } from '../api';
import { colors, fonts, BORDER, TARGET } from '../theme';
import { Icon } from '../components/Icon';
import { TOP_INSET } from '../components/InspireHeader';
import { useViewport } from '../hooks/useViewport';

/**
 * Where you're staying (trip redesign, 7 Sep 2026, screen 5f).
 *
 * A screen of its own, pushed from the create screen's row, rather than a box
 * that searched nothing — which is what it was, and what the owner found:
 * "searching for the Hilton, for example, brings up nothing."
 *
 * Three answers, in the order somebody actually has them:
 *
 *   1. **they have booked** — type the name, pick it off the list
 *   2. **they know where but not the record** — "Use '…' as typed", and add the
 *      booking reference later
 *   3. **they have not booked at all**, which is most people this early — the
 *      signpost, which sends them to Stays on the trip map once there is
 *      something on the trip for a hotel to be *near*
 *
 * The third is the one worth having. A hotel picked before you know what you
 * are doing is a hotel picked against nothing.
 */

export type StayChoice =
  | { kind: 'place'; place: Place }
  | { kind: 'typed'; text: string }
  | { kind: 'later' };

export function WhereYouAreStayingScreen({ where, meta, initial, onClose, onDone }: {
  /** The city the trip is in — what the search is biased to, and what the kicker names. */
  where: Place | null;
  /** "Thu 15 – Mon 19 Oct · 4 nights · 4 people". */
  meta: string;
  initial?: string;
  onClose: () => void;
  onDone: (choice: StayChoice) => void;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [text, setText] = useState(initial ?? '');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);

  // The last search wins: typing "Hass" fires three, and they do not come back
  // in the order they went out.
  const seq = useRef(0);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 3) { setResults([]); setBusy(false); return; }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.geocode(q, 6, { near: where, country: where?.countryCode ?? null, kind: 'lodging' });
        if (seq.current === mine) setResults(r.results);
      } catch {
        if (seq.current === mine) setResults([]);
      } finally {
        if (seq.current === mine) setBusy(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [text, where?.lat, where?.lng, where?.countryCode]);

  const city = where?.locality ?? where?.label ?? null;

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.head}>
        <View style={styles.topRow}>
          <Pressable onPress={onClose} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="previous" size={16} color={colors.ink} strokeWidth={2.4} />
            <Text style={styles.backText} numberOfLines={1}>{city ?? 'Back'}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={20} color={colors.ink} strokeWidth={2.2} />
          </Pressable>
        </View>
        <View>
          <Text style={styles.title}>Where you're staying</Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>
        <View style={styles.field}>
          <Icon name="search" size={18} color={colors.ink} strokeWidth={2.2} />
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            placeholder="Hotel or address"
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            accessibilityLabel="Hotel or address"
          />
          {busy ? <ActivityIndicator size="small" color={colors.inkMuted} /> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {results.length ? <Text style={styles.kicker}>{city ? `Matches in ${city}` : 'Matches'}</Text> : null}
        {results.map((p) => (
          <Pressable
            key={`${p.label}|${p.lat}|${p.lng}`}
            onPress={() => onDone({ kind: 'place', place: p })}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={`Choose ${p.name ?? p.label}`}
          >
            <View style={styles.tile}><Icon name="hotel" size={18} color={colors.ink} strokeWidth={2.2} /></View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              {/* The letters they have typed, lit up in the name — which is how
                  you can tell at a glance why a row is in the list. */}
              <Highlighted text={p.name ?? p.label} match={text.trim()} />
              <Text style={styles.rowSub} numberOfLines={1}>
                {[p.address?.line1, p.address?.town ?? p.locality].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Text style={styles.select}>Select ›</Text>
          </Pressable>
        ))}

        {/* Not on the map, or not findable by name: their words are the answer. */}
        {text.trim().length >= 3 ? (
          <Pressable onPress={() => onDone({ kind: 'typed', text: text.trim() })} style={styles.row} accessibilityRole="button">
            <View style={[styles.tile, styles.tileOutline]}><Icon name="add" size={18} color={colors.ink} strokeWidth={2.4} /></View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={styles.rowName} numberOfLines={1}>{`Use “${text.trim()}” as typed`}</Text>
              <Text style={styles.rowSub}>Add a booking reference later</Text>
            </View>
          </Pressable>
        ) : null}

        {/*
          The honest answer for most people at this point in a trip. A hotel
          chosen now is chosen against nothing; chosen from the map, it is
          chosen against everything they have decided to do.
        */}
        <View style={styles.signpost}>
          <View style={styles.signpostHead}>
            <Icon name="address" size={14} color={colors.accent} strokeWidth={2.2} />
            <Text style={styles.signpostKicker}>Not booked yet?</Text>
          </View>
          <Text style={styles.signpostBody}>
            Save the trip first, add what you want to do, then find hotels close to your plans from the trip map —{' '}
            <Text style={styles.signpostStrong}>Stays</Text> sits beside Activities and Food &amp; drink.
          </Text>
          <Pressable onPress={() => onDone({ kind: 'later' })} style={styles.skip} accessibilityRole="button">
            <Text style={styles.skipText}>Skip for now — find stays on the map</Text>
            <Icon name="forward" size={16} color={colors.primaryFg} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={styles.links}>
          <Text style={styles.linkOn}>Forward booking email</Text>
          <Pressable onPress={() => onDone({ kind: 'typed', text: 'Staying with friends' })} accessibilityRole="button">
            <Text style={styles.link}>Staying with friends</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={styles.foot}>
        <Pressable onPress={onClose} style={styles.primary} accessibilityRole="button">
          <Text style={styles.primaryText}>Done</Text>
          <Icon name="forward" size={18} color={colors.primaryFg} strokeWidth={2.4} />
        </Pressable>
      </View>
    </View>
  );
}

/** The typed letters, on a lime-tint ground, inside the name they matched. */
function Highlighted({ text, match }: { text: string; match: string }) {
  const at = match ? text.toLowerCase().indexOf(match.toLowerCase()) : -1;
  if (at < 0) return <Text style={styles.rowName} numberOfLines={1}>{text}</Text>;
  return (
    <Text style={styles.rowName} numberOfLines={1}>
      {text.slice(0, at)}
      <Text style={styles.hit}>{text.slice(at, at + match.length)}</Text>
      {text.slice(at + match.length)}
    </Text>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  head: { paddingHorizontal: 20, paddingTop: TOP_INSET, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minHeight: TARGET },
  backText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  close: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.heading, fontSize: 32, fontWeight: '800', letterSpacing: -0.96, lineHeight: 34, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted, marginTop: 6 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14,
    borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surface,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink },

  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32 },
  kicker: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88,
    textTransform: 'uppercase', color: colors.inkMuted, paddingTop: 12, paddingBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft, minHeight: TARGET,
  },
  tile: { width: 40, height: 40, backgroundColor: colors.bubble, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tileOutline: { backgroundColor: 'transparent', borderWidth: BORDER, borderColor: colors.ink },
  rowName: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  hit: { backgroundColor: colors.accentSoft },
  rowSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  select: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink, flexShrink: 0 },

  signpost: { marginTop: 18, backgroundColor: colors.accentSoft, padding: 16, gap: 10 },
  signpostHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  signpostKicker: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88,
    textTransform: 'uppercase', color: colors.accent,
  },
  signpostBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  signpostStrong: { fontWeight: '600' },
  skip: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 14,
  },
  skipText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.primaryFg },

  links: { flexDirection: 'row', gap: 18, paddingVertical: 14 },
  linkOn: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink, textDecorationLine: 'underline' },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted },

  foot: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.primary, paddingVertical: 16, paddingHorizontal: 18,
  },
  primaryText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.primaryFg },
});
