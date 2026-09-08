import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Place, TripSearchAnswer } from '../api';
import { colors, fonts, BORDER, TARGET, type } from '../theme';
import { Icon } from './../components/Icon';
import { useViewport } from '../hooks/useViewport';
import { TOP_INSET } from '../components/InspireHeader';

/**
 * Where are you going? (trip rebuild, 7 Sep 2026, screen 3a).
 *
 * One field and two groups. **Countries** are an answer again — "Italy" is what
 * somebody types before they have decided which city, and the next step asks
 * which — and **Cities and towns** are the ordinary area search, each row
 * pre-labelled with the shape of trip it would be: *Day trip · 55 min drive*,
 * *Holiday · 2h 30m flight*.
 *
 * The labelling is the API's, not this screen's, because it needs the
 * household's home to work out (routes/trips.js). What it is not is a decision:
 * the create screen infers the real answer from the dates, so this says how far
 * away the place is and lets the household disagree.
 */

export function NewTripSearchScreen({ onClose, onPick }: {
  onClose: () => void;
  onPick: (place: Place, kind: 'day' | 'holiday') => void;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<TripSearchAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * A country picked from the first group. It narrows the same field rather
   * than pushing a second screen: the question does not change, only how much
   * of the world is still in the running.
   */
  const [country, setCountry] = useState<{ code: string; name: string } | null>(null);

  // The last search wins. Typing "Ita" fires three of these and they do not
  // come back in order; a sequence number is what stops "It" overwriting "Ita".
  const seq = useRef(0);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) { setAnswer(null); setBusy(false); return; }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const next = await api.searchTrips(q, country?.code ?? null);
        if (seq.current === mine) { setAnswer(next); setError(null); }
      } catch (e: any) {
        if (seq.current === mine) setError(e.message);
      } finally {
        if (seq.current === mine) setBusy(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [text, country?.code]);

  // The country is a bound on the *query* now, not a sieve over its answer —
  // filtering here threw away a capped list and left nothing behind (Codex,
  // 8 Sep 2026). Kept as a guard only, for an answer already in flight when the
  // country was chosen.
  const places = (answer?.places ?? []).filter((p) => !country || String(p.countryCode ?? '').toUpperCase() === country.code);
  const countries = country ? [] : (answer?.countries ?? []);

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>New trip</Text>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={20} color={colors.ink} strokeWidth={2.4} />
          </Pressable>
        </View>
        {country ? (
          <Pressable onPress={() => setCountry(null)} style={styles.crumb} accessibilityRole="button">
            <Icon name="back" size={14} color={colors.accent} strokeWidth={2.4} />
            <Text style={styles.crumbText}>{`In ${country.name} — tap to look anywhere`}</Text>
          </Pressable>
        ) : null}
        <View style={styles.field}>
          <Icon name="search" size={18} color={colors.ink} strokeWidth={2.4} />
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            placeholder={country ? `City or town in ${country.name}` : 'Country, city or town'}
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            accessibilityLabel="Where are you going?"
            returnKeyType="search"
          />
          {busy ? <ActivityIndicator size="small" color={colors.inkMuted} /> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {error ? <Text style={[type.small, { color: colors.overrun }]}>{error}</Text> : null}

        {countries.length ? <Text style={styles.kicker}>Countries</Text> : null}
        {countries.map((c) => (
          <Row
            key={c.code}
            title={c.name}
            says={c.says}
            onPress={() => { setCountry({ code: c.code, name: c.name }); setText(''); }}
          />
        ))}

        {places.length ? <Text style={[styles.kicker, countries.length ? { paddingTop: 22 } : null]}>Cities and towns</Text> : null}
        {places.map((p) => (
          <Row
            key={`${p.label}|${p.lat}|${p.lng}`}
            title={p.where ? `${p.label}, ${p.where}` : p.label}
            says={p.says}
            onPress={() => onPick(p, p.kind)}
          />
        ))}

        {text.trim().length >= 2 && !busy && !places.length && !countries.length ? (
          <Text style={styles.rule}>Nothing by that name. Try the town rather than the village, or the country.</Text>
        ) : null}

        {answer?.rule ? <Text style={styles.rule}>{answer.rule}</Text> : null}
      </ScrollView>
    </View>
  );
}

function Row({ title, says, onPress }: { title: string; says: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row} accessibilityRole="button" accessibilityLabel={`${title}. ${says}`}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.rowName} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSays} numberOfLines={1}>{says}</Text>
      </View>
      <Icon name="more" size={16} color={colors.inkMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  head: { paddingHorizontal: 20, paddingTop: TOP_INSET, gap: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.heading, fontSize: 28, fontWeight: '800', letterSpacing: -0.84, color: colors.ink },
  close: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  crumbText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.accent },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14,
    borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surface,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink },

  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
  kicker: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88,
    textTransform: 'uppercase', color: colors.inkMuted,
    paddingTop: 14, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft, minHeight: TARGET,
  },
  rowName: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  rowSays: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  rule: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, lineHeight: 19, paddingTop: 18 },
});
