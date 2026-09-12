/**
 * Passion-led discovery (Events v4 canvas F2): "Who in Florence does what you do?"
 *
 * Keyed off a trip Epic already knows about, or off where the household is
 * looking from. The guest picks what they love doing — Painting · 7 people,
 * Cooking · 12 — and sees *people*, with faces and type chips, not a catalogue.
 * The family variant asks "what do you all like doing?" and leads with
 * Local · Family hosts.
 *
 * `/inspire/people?trip=<id>&love=painting`. A page of Inspire: it keeps the
 * tab bar and draws its own head.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/press';
import { api, Experience, ExperiencesNear, HouseholdResponse, TripDetail } from '../api';
import { colors, fonts, spacing, type, BORDER } from '../theme';
import { Row } from '../components/ui';
import { Icon } from '../components/Icon';
import { ScreenTop, TopControl } from '../components/InspireHeader';
import { useViewport } from '../hooks/useViewport';
import { useRouter, useQueryState, asText } from '../router';
import { paths } from '../routes';
import { ExperienceCard } from '../components/hosting';

const WIDE = 900;
const dates = (t: TripDetail | null) => (t?.trip.startDate ? `${new Date(`${t.trip.startDate}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric' })}–${new Date(`${(t.trip.endDate ?? t.trip.startDate)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : null);

export function PeopleScreen({ household }: { household: HouseholdResponse | null }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { navigate, back, query } = useRouter();
  const tripId = query.get('trip');
  const [love, setLove] = useQueryState<string | null>('love', null, { read: (r) => r || null, write: (v) => v || null });
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [near, setNear] = useState<ExperiencesNear | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasKids = (household?.members ?? []).some((m) => m.isMinor);

  useEffect(() => {
    if (!tripId) { setTrip(null); return; }
    api.trip(tripId).then(setTrip).catch(() => setTrip(null));
  }, [tripId]);

  // Where to look: the trip's destination, else home, else the browser's fix is Inspire's job.
  const centre = useMemo(() => {
    const t: any = trip?.trip;
    if (t?.destination?.lat != null) return { lat: t.destination.lat, lng: t.destination.lng, label: (t.placeLabel ?? t.destination.label ?? '').split(',')[0] };
    if (t?.origin?.lat != null) return { lat: t.origin.lat, lng: t.origin.lng, label: (t.placeLabel ?? t.origin.label ?? '').split(',')[0] };
    const home = household?.household.home;
    if (home) return { lat: home.lat, lng: home.lng, label: home.locality ?? home.label.split(',')[0] };
    return null;
  }, [trip, household]);

  const load = useCallback(async () => {
    if (!centre) { setLoading(false); return; }
    setLoading(true);
    try { setNear(await api.experiencesNear({ lat: centre.lat, lng: centre.lng, km: tripId ? 60 : 40, love })); setError(null); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [centre?.lat, centre?.lng, love, tripId]);
  useEffect(() => { void load(); }, [load]);

  const place = centre?.label || 'here';
  const shown = near?.cards ?? [];
  // The family variant leads with Local · Family hosts.
  const ordered = hasKids && !love ? [...shown].sort((a, b) => Number(b.host?.localKind === 'family') - Number(a.host?.localKind === 'family')) : shown;
  const top = (near?.passions ?? []).slice(0, 4);
  const rest = (near?.allPassions ?? []).filter((p) => !top.some((t) => t.key === p.key));
  const [more, setMore] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={wide ? styles.wide : undefined}>
        <ScreenTop>
          <TopControl label={place} icon="address" onPress={() => back(paths.inspire())} accessibilityLabel="Back to Inspire" />
        </ScreenTop>
      </View>
      <ScrollView contentContainerStyle={[styles.body, wide && styles.wide]}>
        <Text style={type.title}>{hasKids ? `What do you all like doing?` : `Who in ${place} does what you do?`}</Text>
        <Text style={[type.small, { marginTop: 4 }]}>
          {trip ? `You are there ${dates(trip) ?? 'soon'}. ` : ''}Pick what you are into and meet the people near {trip ? 'your trip' : 'you'} who do it too.
        </Text>

        {/* The passions with somebody behind them, big; the rest as a row. */}
        {top.length ? (
          <Row style={{ flexWrap: 'wrap', marginTop: spacing.lg }}>
            {top.map((p) => {
              const on = love === p.key;
              return (
                <Press key={p.key} onPress={() => setLove(on ? null : p.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.bigChip, on && styles.bigChipOn]}>
                  <Text style={[type.h3, on && { color: colors.selectedFg }]}>{p.label}</Text>
                  <Text style={[type.small, on && { color: colors.selectedFg }]}>{p.people} {p.people === 1 ? 'person' : 'people'}</Text>
                </Press>
              );
            })}
          </Row>
        ) : null}
        <Row style={{ flexWrap: 'wrap', marginTop: spacing.sm, gap: 6 }}>
          {(more ? rest : rest.slice(0, 6)).map((p) => {
            const on = love === p.key;
            return (
              <Press key={p.key} onPress={() => setLove(on ? null : p.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.smallChip, on && styles.bigChipOn]}>
                <Text style={[styles.smallChipText, on && { color: colors.selectedFg }]}>{p.label}</Text>
              </Press>
            );
          })}
          {!more && rest.length > 6 ? <Press onPress={() => setMore(true)} accessibilityRole="button" style={styles.smallChip}><Text style={styles.smallChipText}>+ more</Text></Press> : null}
        </Row>

        <View style={styles.head}>
          <Text style={type.h2}>{love ? `${near?.allPassions.find((p) => p.key === love)?.label ?? love} in ${place}` : `People in ${place}`}{shown.length ? ` · ${new Set(shown.map((s) => s.hostId)).size}` : ''}</Text>
          {trip ? <Text style={type.small}>While you are there</Text> : null}
        </View>

        {loading ? <Row style={{ paddingVertical: spacing.lg }}><ActivityIndicator color={colors.icon} /><Text style={type.small}>Looking around {place}…</Text></Row> : null}
        {!centre && !loading ? <Text style={type.small}>Epic needs somewhere to look from. Set your home in Settings, or open this from a trip.</Text> : null}
        {error ? <Text style={type.small}>{error}</Text> : null}
        {!loading && centre && !ordered.length ? (
          <View style={styles.empty}>
            <Icon name="host" size={22} color={colors.inkMuted} />
            <Text style={type.h3}>Nobody hosting {love ? 'that ' : ''}near {place} yet</Text>
            <Text style={type.small}>Hosts are new on Epic. Know somebody there who should be? The Host tab is how they start.</Text>
          </View>
        ) : null}

        <View style={[styles.grid, wide && styles.gridWide]}>
          {ordered.map((c: Experience) => (
            <View key={c.id} style={[styles.cell, wide && styles.cellWide]}>
              <ExperienceCard item={c} onOpen={() => navigate(paths.experience(c.id))} />
              {c.host ? (
                <Press onPress={() => navigate(paths.hostProfile(c.host!.id))} accessibilityRole="button" style={{ paddingVertical: 4 }}>
                  <Text style={styles.who}>{c.host.name} · {c.host.location ?? place}{c.host.localKind === 'family' && c.host.childrenAges.length ? ` · kids ${c.host.childrenAges.join(' and ')}` : ''}</Text>
                </Press>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wide: { maxWidth: 860, alignSelf: 'center', width: '100%' },
  body: { paddingHorizontal: 20, paddingTop: spacing.md, paddingBottom: 40 },
  bigChip: { minWidth: 150, flexGrow: 1, padding: spacing.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, gap: 2 },
  bigChipOn: { backgroundColor: colors.selected },
  smallChip: { paddingHorizontal: 10, height: 32, justifyContent: 'center', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  smallChipText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
  head: { marginTop: spacing.xl, paddingBottom: spacing.sm, borderBottomWidth: BORDER, borderBottomColor: colors.line, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' },
  empty: { alignItems: 'center', gap: 6, paddingVertical: spacing.xl },
  grid: { gap: spacing.lg, paddingTop: spacing.md },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '100%' },
  cellWide: { width: '48%' },
  who: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.accent },
});
