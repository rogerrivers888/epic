import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, HouseholdResponse, OwnedImage, Place, TripDetail, VenuePhotoRef } from '../api';
import { colors, fonts, memberPastel, BORDER, ON_LIME, TARGET } from '../theme';
import { Icon } from '../components/Icon';
import { MonthCalendar, DatesCaption, nightsBetween, ymd } from '../components/MonthCalendar';
import { StatusLine } from '../components/ui';
import { VenueThumb } from '../components/VenueThumb';
import { Wheel, slots, timeLabel } from '../components/TimePicker';
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
 * Everything derived is derived here and shown as it changes: "Leave home 08:55
 * · a 5 min drive" is the arrival minus the drive from home, so moving the
 * arrival moves it. Nothing on this screen costs a provider call — the drive is
 * Epic's own arithmetic (`/api/trips/from-home`) and the photograph is ours
 * (`/api/trips/picture`).
 */

/** What the trip is being made *from* — a venue somebody tapped, or a place they searched. */
export type CreateSeed = {
  place?: Place | null;
  placeText?: string;
  countryCode?: string;
  /** A venue: the trip is for it, so it is the title, the picture and the first stop. */
  venue?: {
    venueRef: string; name: string; lat?: number | null; lng?: number | null;
    category?: string | null; dwellMinutes?: number | null;
    /**
     * The picture, as the drawer already had it. Ours travels as `image`; a
     * provider's travels as `photos`, is shown live and is never written down
     * (Technical Constraints §4) — `VenueThumb` knows the difference.
     */
    image?: OwnedImage | null;
    photos?: VenuePhotoRef[] | null;
  } | null;
  /** What the search screen thought this was. The dates still decide. */
  kind?: 'day' | 'holiday';
};

/** The photograph at the top, at the handoff's height. */
const PHOTO = 150;

const clampClock = (mins: number) => ((mins % 1440) + 1440) % 1440;
const toClock = (mins: number) => `${String(Math.floor(clampClock(mins) / 60)).padStart(2, '0')}:${String(clampClock(mins) % 60).padStart(2, '0')}`;
const fromClock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
};
const hoursWords = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`);

/**
 * How long to allow, as a wheel rather than a pair of arrows.
 *
 * Quarter hours up to two and a half, where the difference is worth having,
 * then half hours: nobody allows 4h15 at a theme park, and a wheel of
 * ninety-six near-identical rows is not one anybody can land on.
 */
const ALLOW_OPTIONS = [
  ...Array.from({ length: 9 }, (_, i) => String(30 + i * 15)),
  ...Array.from({ length: 20 }, (_, i) => String(180 + i * 30)),
];

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
   * flight* opens on a range rather than on one day — the dates still decide,
   * and either can be changed with a tap.
   */
  const [end, setEnd] = useState<string | null>(
    seed?.kind === 'holiday' ? ymd(new Date(Date.now() + 3 * 86_400_000)) : null,
  );

  const [arrive, setArrive] = useState(fromClock('10:00'));
  const [allow, setAllow] = useState(seed?.venue?.dwellMinutes ?? 240);
  /** Which of the two wheels is open, if either. Only ever one at a time. */
  const [open, setOpen] = useState<'arrive' | 'allow' | null>(null);
  /**
   * A wheel that opens below the fold is a wheel nobody can reach: "Save trip"
   * is pinned to the bottom and was cutting it in half. The panel says where it
   * is, and the page scrolls it up to meet you.
   */
  const scroller = useRef<ScrollView>(null);
  const panelY = useRef(0);

  const [attending, setAttending] = useState<Set<string>>(new Set(members.map((m) => m.id)));
  const [whoOpen, setWhoOpen] = useState(false);
  const [stayText, setStayText] = useState('');
  const [stayOpen, setStayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The photograph of where the trip is going.
   *
   * The drawer already had one when somebody tapped "Create trip", so that one
   * is used straight away and nothing is fetched. A trip begun from the search
   * has only a name, so the library is asked for the area's own picture — ours
   * either way, and never a provider's.
   */
  const [found, setFound] = useState<OwnedImage | null>(null);
  const haveOwn = seed?.venue?.image ?? null;
  const havePhotos = seed?.venue?.photos ?? null;
  const venueRef = seed?.venue?.venueRef ?? null;
  const country = seed?.countryCode ?? seed?.place?.countryCode ?? null;
  const locality = seed?.place?.locality ?? seed?.placeText ?? null;
  useEffect(() => {
    let live = true;
    if (haveOwn || havePhotos?.length) { setFound(null); return () => { live = false; }; }
    api.tripPicture({ venueRef, country, locality })
      .then((r) => { if (live) setFound(r.image); })
      .catch(() => { if (live) setFound(null); });
    return () => { live = false; };
  }, [venueRef, country, locality, haveOwn, havePhotos?.length]);

  /** The drive from home to where the trip is going. One read, no provider. */
  const point = seed?.venue?.lat != null ? { lat: seed.venue.lat, lng: seed.venue.lng ?? 0 } : seed?.place?.lat != null ? { lat: seed.place.lat, lng: seed.place.lng } : null;
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
      });
      if (then === 'travel' && onGettingThere) onGettingThere(created.trip.id);
      else await onCreated(created);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const image = haveOwn ?? found;

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <ScrollView ref={scroller} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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

          {/* The place the trip is for, full-bleed past the gutter — the one
              thing on this screen that does (5a/5b). `VenueThumb` puts ours
              first and falls back to a provider's, which is shown and never
              written down; with neither, it draws the category. */}
          <View style={styles.photoWrap}>
            <VenueThumb
              name={seed?.venue?.name ?? title}
              image={image}
              photos={havePhotos}
              category={seed?.venue?.category ?? null}
              width={wide ? 720 : Math.max(320, width)}
              height={PHOTO}
              rounded={0}
              credit={false}
            />
          </View>
        </View>

        <View style={styles.body}>
          <MonthCalendar start={start} end={end} onChange={(next) => { setStart(next.start); setEnd(next.end); }} />

          {/*
            A range says what it comes to, in Moss — "Thu 15 – Mon 19 October ·
            4 nights" (5b). One day says nothing: "tap another date for a longer
            trip" was an instruction nobody needed twice (owner, 7 Sep 2026),
            and the gap it left stays, so nothing below it moves up.
          */}
          <View style={styles.captionRow}>{holiday ? <DatesCaption start={start} end={end} /> : null}</View>

          {!holiday ? (
            /*
              Arrive and Allow (5a). The label sits *above* its number, because
              the two are one thing (owner, 7 Sep 2026: "Arrive and Allow need
              to be above the numbers, since they directly relate to the
              numbers"), and the number is tapped rather than nudged: "I don't
              want to hit arrows to move it in increments of 15 minutes." So the
              arrows are gone and the wheel Epic already uses for a time opens
              underneath — the same control as the day window and a booking.
            */
            <>
              <View style={styles.pair}>
                <Field
                  label="Arrive"
                  value={timeLabel(toClock(arrive))}
                  hint={leaveHome ? `Leave home ${timeLabel(leaveHome)} · a ${hoursWords(drive!)} drive` : 'When you want to be there'}
                  hintOn={Boolean(leaveHome)}
                  open={open === 'arrive'}
                  onPress={() => setOpen(open === 'arrive' ? null : 'arrive')}
                  divider
                />
                <Field
                  label="Allow"
                  value={hoursWords(allow)}
                  hint={`Usually about ${hoursWords(seed?.venue?.dwellMinutes ?? 240)}`}
                  open={open === 'allow'}
                  onPress={() => setOpen(open === 'allow' ? null : 'allow')}
                />
              </View>
              {open ? (
                <View
                  style={styles.wheelPanel}
                  onLayout={(e) => {
                    panelY.current = e.nativeEvent.layout.y;
                    scroller.current?.scrollTo({ y: Math.max(0, panelY.current - 90), animated: true });
                  }}
                >
                  {open === 'arrive' ? (
                    <Wheel
                      label="Arrive"
                      value={toClock(arrive)}
                      options={slots(15, '05:00', '23:00')}
                      onChange={(v) => setArrive(fromClock(v))}
                    />
                  ) : (
                    <Wheel
                      label="Allow"
                      value={String(allow)}
                      options={ALLOW_OPTIONS}
                      format={(v) => hoursWords(Number(v))}
                      onChange={(v) => setAllow(Number(v))}
                    />
                  )}
                  <Pressable onPress={() => setOpen(null)} style={styles.done} accessibilityRole="button">
                    <Text style={styles.doneText}>Done</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
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
            <Icon name="household" size={22} color={colors.ink} strokeWidth={2.2} />
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
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
 * One of the pair: the word above, the number under it, and the line that says
 * what the number means. The whole cell is the target — there is nothing small
 * to hit, and nothing to hit repeatedly.
 */
function Field({ label, value, hint, hintOn, open, onPress, divider }: {
  label: string; value: string; hint: string; hintOn?: boolean;
  open: boolean; onPress: () => void; divider?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.cell, divider && styles.cellDivider]}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}: ${value}. ${hint}`}
    >
      <Text style={styles.cellLabel}>{label}</Text>
      {/* Open is a lime fill, and a lime fill carries ink type in both
          palettes — `colors.ink` is the *type* colour and turns cream in the
          dark, which is 1.25:1 on lime and forbidden by the pack. */}
      <View style={[styles.cellValue, open && styles.cellValueOn]}>
        <Text style={[styles.cellValueText, open && styles.onLime]}>{value}</Text>
        <Icon name={open ? 'collapse' : 'expand'} size={14} color={open ? ON_LIME : colors.ink} />
      </View>
      <Text style={[styles.cellHint, hintOn && styles.cellHintOn]}>{hint}</Text>
    </Pressable>
  );
}

function FormRow({ icon, title, sub, action, onPress }: {
  icon: 'hotel' | 'transit'; title: string; sub: string; action: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.formRow} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`}>
      <Icon name={icon} size={22} color={colors.ink} strokeWidth={2.2} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
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
  head: { paddingTop: TOP_INSET, gap: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20 },
  titleTap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flexShrink: 1, fontFamily: fonts.heading, fontSize: 32, fontWeight: '800', letterSpacing: -0.96, lineHeight: 36, color: colors.ink },
  titleField: { flex: 1, borderBottomWidth: BORDER, borderBottomColor: colors.ink, paddingBottom: 2 },
  close: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  // Full-bleed: the picture runs past the gutter, which is the one place on
  // this screen anything does. The wrapper clips it on a wide window.
  photoWrap: { height: PHOTO, overflow: 'hidden', backgroundColor: colors.surfaceMuted },

  body: { paddingHorizontal: 20, paddingTop: 14 },

  /**
   * The gap the single-day caption used to fill. Deliberately still here
   * (owner, 7 Sep 2026: "you can remove the text… but don't move anything up.
   * Leave that spacing between the calendar and the section below").
   */
  captionRow: { minHeight: 34, justifyContent: 'center' },

  pair: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.lineSoft },
  // Taller, and stacked: the word, the number, then what the number means.
  cell: { flex: 1, minWidth: 0, gap: 8, paddingVertical: 16, paddingRight: 12 },
  cellDivider: { borderRightWidth: 1, borderRightColor: colors.lineSoft, paddingRight: 16, marginRight: 4 },
  cellLabel: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  cellValue: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    alignSelf: 'flex-start', minWidth: 96, minHeight: 40, paddingHorizontal: 12,
    backgroundColor: colors.surfaceMuted, borderBottomWidth: BORDER, borderBottomColor: colors.ink,
  },
  cellValueOn: { backgroundColor: colors.selected },
  cellValueText: { fontFamily: fonts.body, fontSize: 17, fontWeight: '700', color: colors.ink },
  onLime: { color: ON_LIME },
  // Two lines, so "Leave home 08:55 · a 5 min drive" is said rather than cut.
  cellHint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.inkMuted },
  cellHintOn: { color: colors.accent, fontWeight: '600' },

  wheelPanel: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  done: { paddingHorizontal: 16, minHeight: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  doneText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: colors.primaryFg },

  formRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft, minHeight: 68,
  },
  whoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft, minHeight: 68,
  },
  rowTitle: { fontFamily: fonts.body, fontSize: 17, fontWeight: '600', color: colors.ink },
  rowSub: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted },
  rowAction: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },

  stack: { flexDirection: 'row', flexShrink: 0 },
  face: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  faceMe: { backgroundColor: colors.selected },
  // Lime and the pastels are light grounds in both palettes, so the initial is
  // ink — `colors.ink` is the type colour and turns cream in the dark.
  faceText: { fontFamily: fonts.heading, fontSize: 12, fontWeight: '800', color: ON_LIME },

  ticks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 14 },
  tick: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, minHeight: 36, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  tickOn: { backgroundColor: colors.selected, borderColor: colors.ink },
  tickText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.ink },

  input: {
    height: 48, paddingHorizontal: 14, marginTop: 12, marginBottom: 4,
    borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surface,
    fontFamily: fonts.body, fontSize: 15, color: colors.ink,
  },

  foot: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.primary, paddingVertical: 18, paddingHorizontal: 18,
  },
  primaryText: { fontFamily: fonts.body, fontSize: 17, fontWeight: '600', color: colors.primaryFg },
});
