import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, HouseholdResponse, Place, TripDetail } from '../api';
import { colors, fonts, memberPastel, BORDER, ON_LIME, TARGET, type } from '../theme';
import { Icon } from '../components/Icon';
import { MonthCalendar, DatesCaption, nightsBetween, ymd } from '../components/MonthCalendar';
import { StatusLine } from '../components/ui';
import { useViewport } from '../hooks/useViewport';
import { TOP_INSET } from '../components/InspireHeader';
import { firstName } from '../components/Faces';

/**
 * Making a trip (trip rebuild, 7 Sep 2026, screens 5a and 5b).
 *
 * One screen, no tabs, and it never asks what kind of trip this is. Tap one
 * date and it is a day out — Arrive and Allow appear, and the times either side
 * are worked out. Tap a second and it is a holiday — those two give way to
 * Where you're staying and Getting there. That is the whole difference between
 * 5a and 5b, and it is why they are one component: two would have to agree
 * about the calendar, the title and the people, and would not.
 *
 * Everything derived is derived here and shown as it changes: "Leave home
 * 08:55 · 5 min" is the arrival minus the drive from home, so moving the
 * arrival moves it. Nothing on this screen costs a provider call — the drive is
 * Epic's own arithmetic (`/api/trips/from-home`).
 */

/** What the trip is being made *from* — a venue somebody tapped, or a place they searched. */
export type CreateSeed = {
  place?: Place | null;
  placeText?: string;
  countryCode?: string;
  /** A venue: the trip is for it, so it is the title, the picture and the first stop. */
  venue?: { venueRef: string; name: string; lat?: number | null; lng?: number | null; category?: string | null; image?: string | null; dwellMinutes?: number | null } | null;
  /** What the search screen thought this was. The dates still decide. */
  kind?: 'day' | 'holiday';
};

const ARRIVE_STEP = 15;
const ALLOW_STEP = 30;

const clampClock = (mins: number) => ((mins % 1440) + 1440) % 1440;
const toClock = (mins: number) => `${String(Math.floor(clampClock(mins) / 60)).padStart(2, '0')}:${String(clampClock(mins) % 60).padStart(2, '0')}`;
const fromClock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
};
const hoursWords = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`);

export function CreateTripScreen({ household, seed, onClose, onCreated, onGettingThere }: {
  household: HouseholdResponse;
  seed: CreateSeed | null;
  onClose: () => void;
  onCreated: (t: TripDetail) => Promise<void> | void;
  /**
   * "Getting there" before the trip exists. The screen saves first and pushes
   * the travel page on the new trip, because a flight belongs to a trip and
   * there is nothing to hang it on until there is one.
   */
  onGettingThere?: (tripId: string) => void;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const members = household.members ?? [];

  const suggested = seed?.venue?.name ?? seed?.place?.label ?? seed?.placeText ?? 'A new trip';
  const [title, setTitle] = useState(suggested);
  const [renaming, setRenaming] = useState(false);

  const [start, setStart] = useState<string | null>(ymd(new Date()));
  /**
   * A second date is what makes it a holiday, and the search screen has already
   * said which it thinks this is (3a). So a row labelled *Holiday · 2h 30m
   * flight* opens on a range rather than on one day and a caption that says
   * "tap another date for a longer trip" — the dates still decide, and either
   * can be changed with a tap.
   */
  const [end, setEnd] = useState<string | null>(
    seed?.kind === 'holiday' ? ymd(new Date(Date.now() + 3 * 86_400_000)) : null,
  );

  const [arrive, setArrive] = useState(fromClock('10:00'));
  const [allow, setAllow] = useState(seed?.venue?.dwellMinutes ?? 240);

  const [attending, setAttending] = useState<Set<string>>(new Set(members.map((m) => m.id)));
  const [whoOpen, setWhoOpen] = useState(false);
  const [stayText, setStayText] = useState('');
  const [stayOpen, setStayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * An idea rather than a plan (1a, the third strip on the Trips list).
   *
   * The handoff draws Ideas but never says how a trip gets there, and a strip
   * that can only ever be empty is worse than no strip. This is the one line
   * that fills it: the dates stay as a placeholder, and the row says "Date not
   * fixed" until somebody fixes one from the ⋯ menu.
   */
  const [idea, setIdea] = useState(false);

  /** The drive from home to where the trip is going. One read, no provider. */
  const point = seed?.venue?.lat != null ? { lat: seed.venue.lat!, lng: seed.venue.lng ?? 0 } : seed?.place?.lat != null ? { lat: seed.place.lat, lng: seed.place.lng } : null;
  const [drive, setDrive] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    if (!point) { setDrive(null); return () => { live = false; }; }
    api.fromHome({ lat: point.lat, lng: point.lng })
      .then((r) => { if (live) setDrive(r.minutes); })
      .catch(() => { if (live) setDrive(null); });
    return () => { live = false; };
  }, [point?.lat, point?.lng]);

  const nights = start && end ? nightsBetween(start, end) : 0;
  const holiday = nights > 0;

  const leaveHome = drive != null ? toClock(arrive - drive) : null;

  const chosen = members.filter((m) => attending.has(m.id));
  const whoWords = !chosen.length ? 'Nobody yet'
    : chosen.length === members.length && members.length > 1 ? members.map((m) => firstName(m.name)).join(', ')
      : chosen.length === 1 ? 'Just you so far'
        : chosen.map((m) => firstName(m.name)).join(', ');

  /**
   * Save, and then either open the trip or push Getting there onto it.
   *
   * A flight belongs to a trip, and on 5b "Getting there" is offered before the
   * trip exists — so the row saves first and pushes the travel page on what it
   * just made, rather than refusing or holding a leg in memory with nowhere to
   * put it.
   */
  const save = async (then: 'trip' | 'travel' = 'trip') => {
    if (busy || !start) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createTripV3({
        kind: holiday ? 'holiday' : 'day',
        title: title.trim() || undefined,
        ...(holiday
          ? { startDate: start, endDate: end! }
          : { date: start, arriveAt: toClock(arrive), allowMinutes: allow }),
        ...(seed?.place ? { place: seed.place } : seed?.placeText ? { placeText: seed.placeText } : {}),
        ...(seed?.venue
          ? {
            destination: {
              ref: seed.venue.venueRef, label: seed.venue.name,
              lat: seed.venue.lat ?? 0, lng: seed.venue.lng ?? 0,
            } as any,
          }
          : seed?.place && !holiday ? { destination: seed.place as any } : {}),
        ...(holiday && stayText.trim() ? { baseText: stayText.trim(), baseKind: 'hotel' } : {}),
        attendingMemberIds: [...attending],
        ...(idea ? { datesFixed: false } : {}),
      });
      if (then === 'travel' && onGettingThere) onGettingThere(created.trip.id);
      else await onCreated(created);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View style={styles.titleRow}>
            {renaming ? (
              <TextInput
                value={title}
                onChangeText={setTitle}
                onBlur={() => setRenaming(false)}
                onSubmitEditing={() => setRenaming(false)}
                autoFocus
                selectTextOnFocus
                style={[styles.title, styles.titleField]}
                accessibilityLabel="The trip's name"
              />
            ) : (
              <Pressable onPress={() => setRenaming(true)} style={styles.titleTap} accessibilityRole="button" accessibilityLabel="Rename this trip">
                <Text style={styles.title} numberOfLines={2}>{title}</Text>
                <Icon name="edit" size={18} color={colors.inkMuted} strokeWidth={2.2} />
              </Pressable>
            )}
            <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={20} color={colors.ink} strokeWidth={2.4} />
            </Pressable>
          </View>
          {seed?.venue?.image ? (
            <Image source={{ uri: seed.venue.image }} style={styles.photo} accessibilityIgnoresInvertColors />
          ) : null}
        </View>

        <View style={styles.body}>
          <MonthCalendar start={start} end={end} onChange={(next) => { setStart(next.start); setEnd(next.end); }} />
          <View style={styles.captionRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              {idea
                ? <Text style={styles.ideaCaption}>Saved without a date · it waits under Ideas</Text>
                : <DatesCaption start={start} end={end} />}
            </View>
            <Pressable
              onPress={() => setIdea((v) => !v)}
              style={[styles.ideaBtn, idea && styles.ideaBtnOn]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: idea }}
              accessibilityLabel="Save without a date"
            >
              <Text style={[styles.ideaText, idea && { color: colors.selectedFg }]}>{idea ? 'Pick a date' : 'No date yet'}</Text>
            </Pressable>
          </View>

          {!holiday ? (
            /* Arrive and Allow, side by side inside one pair of 1px rules (5a). */
            <View style={styles.pair}>
              <View style={[styles.cell, styles.cellLeft]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cellLabel}>Arrive</Text>
                  <Text style={[styles.cellHint, leaveHome ? styles.cellHintOn : null]} numberOfLines={2}>
                    {leaveHome ? `Leave home ${leaveHome} · ${hoursWords(drive!)}` : 'When you want to be there'}
                  </Text>
                </View>
                <Nudge
                  value={toClock(arrive)}
                  onDown={() => setArrive((a) => a - ARRIVE_STEP)}
                  onUp={() => setArrive((a) => a + ARRIVE_STEP)}
                  label="When you want to arrive"
                />
              </View>
              <View style={styles.cell}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cellLabel}>Allow</Text>
                  <Text style={styles.cellHint} numberOfLines={1}>{`Average visit ${hoursWords(seed?.venue?.dwellMinutes ?? 240)}`}</Text>
                </View>
                <Nudge
                  value={hoursWords(allow)}
                  onDown={() => setAllow((a) => Math.max(30, a - ALLOW_STEP))}
                  onUp={() => setAllow((a) => Math.min(12 * 60, a + ALLOW_STEP))}
                  label="How long to allow"
                />
              </View>
            </View>
          ) : (
            <>
              <FormRow
                icon="hotel"
                title="Where you're staying"
                sub={stayText.trim() || 'Add a hotel or address · optional'}
                action={stayText.trim() ? 'Change' : 'Add'}
                onPress={() => setStayOpen((o) => !o)}
              />
              {stayOpen ? (
                <TextInput
                  value={stayText}
                  onChangeText={setStayText}
                  placeholder="Hotel name or an address"
                  placeholderTextColor={colors.inkMuted}
                  style={styles.input}
                  autoFocus
                  accessibilityLabel="Where you're staying"
                />
              ) : null}
              <FormRow
                icon="transit"
                title="Getting there"
                sub="Flights, train or drive · optional"
                action="Add"
                onPress={() => save('travel')}
              />
            </>
          )}

          <Pressable onPress={() => setWhoOpen((o) => !o)} style={styles.whoRow} accessibilityRole="button" accessibilityState={{ expanded: whoOpen }}>
            <Icon name="household" size={20} color={colors.ink} strokeWidth={2.2} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rowTitle}>Who's coming</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{whoWords}</Text>
            </View>
            <View style={styles.stack}>
              {chosen.slice(0, 3).map((m, i) => (
                <View key={m.id} style={[styles.face, i === 0 ? styles.faceMe : { backgroundColor: memberPastel(i), marginLeft: -4 }]}>
                  <Text style={styles.faceText}>{firstName(m.name).charAt(0).toUpperCase()}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.rowAction}>{`${chosen.length} ›`}</Text>
          </Pressable>
          {whoOpen ? (
            <View style={styles.ticks}>
              {members.map((m) => {
                const on = attending.has(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setAttending((was) => {
                      const next = new Set(was);
                      if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                      return next;
                    })}
                    style={[styles.tick, on && styles.tickOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    {on ? <Icon name="check" size={13} color={colors.selectedFg} strokeWidth={2.6} /> : null}
                    <Text style={[styles.tickText, on && { color: colors.selectedFg }]}>{firstName(m.name)}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
        </View>
      </ScrollView>

      <View style={styles.foot}>
        <Pressable onPress={() => save('trip')} style={styles.primary} accessibilityRole="button" disabled={busy || !start}>
          <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save trip'}</Text>
          <Icon name="forward" size={18} color={colors.primaryFg} strokeWidth={2.4} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * A value with a ‹ › either side of it (5a).
 *
 * The owner's standing rule is that a *number* is typed rather than nudged
 * ("I never want to see a plus/minus sign on a number… just click into the box
 * and type your number", 4 Sep 2026). A clock in quarter-hours is the case that
 * rule was not about — nobody types 09:15 — and the handoff draws the arrows,
 * so this is arrows. It is two taps to move half an hour, which is the whole
 * range anybody moves an arrival by.
 */
function Nudge({ value, onDown, onUp, label }: { value: string; onDown: () => void; onUp: () => void; label: string }) {
  return (
    <View style={styles.nudge} accessibilityLabel={label}>
      <Pressable onPress={onDown} style={styles.nudgeBtn} accessibilityRole="button" accessibilityLabel={`${label}: earlier`}>
        <Icon name="previous" size={14} color={colors.ink} strokeWidth={2.4} />
      </Pressable>
      <Text style={styles.nudgeValue}>{value}</Text>
      <Pressable onPress={onUp} style={styles.nudgeBtn} accessibilityRole="button" accessibilityLabel={`${label}: later`}>
        <Icon name="more" size={14} color={colors.ink} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

function FormRow({ icon, title, sub, action, onPress }: {
  icon: 'hotel' | 'transit'; title: string; sub: string; action: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.formRow} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`}>
      <Icon name={icon} size={20} color={colors.ink} strokeWidth={2.2} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>
      </View>
      <Text style={styles.rowAction}>{`${action} ›`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  scroll: { paddingBottom: 12 },
  head: { paddingHorizontal: 20, paddingTop: TOP_INSET, gap: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleTap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flexShrink: 1, fontFamily: fonts.heading, fontSize: 32, fontWeight: '800', letterSpacing: -0.96, lineHeight: 34, color: colors.ink },
  titleField: { flex: 1, borderBottomWidth: BORDER, borderBottomColor: colors.ink, paddingBottom: 2 },
  close: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  // Full-bleed: the picture runs past the gutter, which is the one place on the
  // screen anything does.
  photo: { height: 150, marginHorizontal: -20, backgroundColor: colors.surfaceMuted },

  body: { paddingHorizontal: 20, paddingTop: 4, gap: 0 },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ideaCaption: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, paddingTop: 6, paddingBottom: 10 },
  ideaBtn: { paddingHorizontal: 10, minHeight: 30, justifyContent: 'center', borderWidth: 1, borderColor: colors.lineSoft, flexShrink: 0 },
  ideaBtnOn: { backgroundColor: colors.selected, borderColor: colors.ink },
  ideaText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.inkMuted },

  pair: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.lineSoft },
  cell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  cellLeft: { borderRightWidth: 1, borderRightColor: colors.lineSoft, paddingRight: 12 },
  cellLabel: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  cellHint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  cellHintOn: { color: colors.accent, fontWeight: '600' },

  nudge: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  nudgeBtn: { width: 28, height: 32, alignItems: 'center', justifyContent: 'center' },
  nudgeValue: {
    fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink,
    paddingVertical: 6, paddingHorizontal: 8, backgroundColor: colors.surfaceMuted,
  },

  formRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft, minHeight: TARGET,
  },
  whoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft, minHeight: TARGET,
  },
  rowTitle: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  rowSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  rowAction: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.ink },

  stack: { flexDirection: 'row', flexShrink: 0 },
  face: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  faceMe: { backgroundColor: colors.selected },
  // Lime and the pastels are light grounds in both palettes, so the initial is
  // ink — `colors.ink` is the type colour and turns cream in the dark.
  faceText: { fontFamily: fonts.heading, fontSize: 11, fontWeight: '800', color: ON_LIME },

  ticks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  tick: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, minHeight: 34, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  tickOn: { backgroundColor: colors.selected, borderColor: colors.ink },
  tickText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },

  input: {
    height: 48, paddingHorizontal: 14, marginTop: 10, marginBottom: 4,
    borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surface,
    fontFamily: fonts.body, fontSize: 15, color: colors.ink,
  },

  foot: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.primary, paddingVertical: 16, paddingHorizontal: 18,
  },
  primaryText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.primaryFg },
});
