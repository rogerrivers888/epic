import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import { api, HouseholdResponse, OwnedImage, Place, TripDetail, VenuePhotoRef } from '../api';
import { colors, fonts, memberPastel, BORDER, ON_LIME, TARGET } from '../theme';
import { Icon } from '../components/Icon';
import { MonthCalendar, DatesCaption, nightsBetween, ymd } from '../components/MonthCalendar';
import { StatusLine } from '../components/ui';
import { VenueThumb } from '../components/VenueThumb';
import { useViewport } from '../hooks/useViewport';
import { TOP_INSET } from '../components/InspireHeader';
import { firstName } from '../components/Faces';
import { WhereYouAreStayingScreen, StayChoice } from './WhereYouAreStayingScreen';

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
/** One row of the drop-down, so the list can be opened on the value that is set. */
const DROP_ROW = 38;

const clampClock = (mins: number) => ((mins % 1440) + 1440) % 1440;
const toClock = (mins: number) => `${String(Math.floor(clampClock(mins) / 60)).padStart(2, '0')}:${String(clampClock(mins) % 60).padStart(2, '0')}`;
const fromClock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
};
const hoursWords = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`);

/** Half-hour steps, which is what the handoff draws and how anybody says a time. */
const ARRIVE_OPTIONS = Array.from({ length: 37 }, (_, i) => {
  const t = 5 * 60 + i * 30;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
});

/** How long to stay, in the same half hours, from half an hour to a whole day. */
const ALLOW_OPTIONS = Array.from({ length: 23 }, (_, i) => String(30 + i * 30));

/** "4 hours", "90 minutes", "1 hour" — how somebody says a length, not how a clock does. */
const stayWords = (m: number) => {
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const hours = `${h} hour${h === 1 ? '' : 's'}`;
  return rest ? `${hours} ${rest}m` : hours;
};

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

  /**
   * Nothing is chosen until somebody chooses it (owner, 7 Sep 2026: "there
   * should be no date selected"). Opening on today made today the start of
   * every trip and put a range nobody asked for on the calendar the moment a
   * second date was tapped.
   */
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);

  const [arrive, setArrive] = useState(fromClock('10:00'));
  const [allow, setAllow] = useState(seed?.venue?.dwellMinutes ?? 240);
  /** Which of the two wheels is open, if either. Only ever one at a time. */
  const [open, setOpen] = useState<'arrive' | 'allow' | null>(null);

  const [attending, setAttending] = useState<Set<string>>(new Set(members.map((m) => m.id)));
  const [whoOpen, setWhoOpen] = useState(false);
  /**
   * Where they are staying (5f). Its own pushed screen now, not a box on this
   * one — a hotel search needs room for matches, for "use what I typed", and
   * for the answer most people actually have at this point, which is that they
   * have not booked anything yet.
   */
  const [stay, setStay] = useState<Place | null>(null);
  const [stayText, setStayText] = useState('');
  const [stayOpen, setStayOpen] = useState(false);
  const stayWhere = stay?.name ?? stay?.label ?? (stayText.trim() || null);
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

  /**
   * Where the trip is going, as a point.
   *
   * A trip begun in the app carries one; a link somebody was sent carries only
   * a name ("/trips/new?place=Rome"), and without a point two things quietly
   * stopped working — the drive from home, and the bias on the hotel search,
   * which is why "Hilton" for Rome answered with Venice (owner, 7 Sep 2026).
   * So a name is resolved once, in area mode, and both use the answer.
   */
  const [resolved, setResolved] = useState<Place | null>(null);
  useEffect(() => {
    let live = true;
    if (seed?.place?.lat != null || !seed?.placeText) { setResolved(null); return () => { live = false; }; }
    api.geocode(seed.placeText, 1, { country: seed.countryCode ?? null, kind: 'area' })
      .then((r) => { if (live) setResolved(r.results[0] ?? null); })
      .catch(() => { if (live) setResolved(null); });
    return () => { live = false; };
  }, [seed?.place?.lat, seed?.placeText, seed?.countryCode]);
  const where = seed?.place?.lat != null ? seed.place : resolved;

  /** The drive from home to where the trip is going. One read, no provider. */
  const point = seed?.venue?.lat != null ? { lat: seed.venue.lat, lng: seed.venue.lng ?? 0 } : where?.lat != null ? { lat: where.lat, lng: where.lng } : null;
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
  /** Back through the front door: the arrival, plus the stay, plus the way home. */
  const homeBy = toClock(arrive + allow + (drive ?? 0));
  const travelIcon: 'driving' | 'transit' | 'walking' = 'driving';
  const travelWord = 'Drive';

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
        // `where` rather than `seed.place`: arriving on a cold URL
        // (`/trips/new?place=Rome`) the seed carries only the words, and the
        // screen resolves them into a real place — which is what drew the
        // picture and the drive. Sending the words on would have saved a trip
        // with no destination and no first stop, against a form that had been
        // showing Rome all along (Codex, 8 Sep 2026).
        ...(where ? { place: where } : seed?.placeText ? { placeText: seed.placeText } : {}),
        ...(seed?.venue
          ? {
            destination: {
              ref: seed.venue.venueRef, label: seed.venue.name,
              lat: seed.venue.lat ?? 0, lng: seed.venue.lng ?? 0,
            } as any,
          }
          : where && !holiday ? { destination: where as any } : {}),
        // A picked hotel travels with its coordinates; a name nobody picked is
        // still sent, and the API geocodes it in lodging mode as it always has.
        ...(holiday && stay ? { base: stay, baseKind: 'hotel' } : {}),
        ...(holiday && !stay && stayText.trim() ? { baseText: stayText.trim(), baseKind: 'hotel' } : {}),
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
              <Press onPress={() => setRenaming(true)} style={styles.titleTap} accessibilityRole="button" accessibilityLabel="Rename this trip">
                <Text style={styles.title} numberOfLines={2}>{title}</Text>
                <Icon name="edit" size={18} color={colors.inkMuted} strokeWidth={2.2} />
              </Press>
            )}
            <Press onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={20} color={colors.ink} strokeWidth={2.4} />
            </Press>
          </View>

          {/* The place the trip is for. It bled past the gutter with square
              corners (5a/5b); it is now the photograph every other screen
              draws — inside the gutter, 3:2, rounded — because the owner asked
              for one shape wherever a place's picture is clicked through to
              (9 Sep 2026). `VenueThumb` puts ours first and falls back to a
              provider's, which is shown and never written down; with neither,
              it draws the category. */}
          <View style={styles.photoWrap}>
            <VenueThumb
              name={seed?.venue?.name ?? title}
              image={image}
              photos={havePhotos}
              category={seed?.venue?.category ?? null}
              fill
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
          <View style={styles.captionRow}>{holiday || !start ? <DatesCaption start={start} end={end} /> : null}</View>

          {!start ? null : !holiday ? (
            /*
              Arrive and Stay for (5a, round 5).
              
              Two columns flush on the gutter: a small grey kicker over the
              value in Archivo 800, with a chevron. No box, no underline, no
              steppers — the owner asked for the arrows to go, and the handoff
              draws a plain list dropping straight under the value instead.
            */
            <>
              <View style={styles.pair}>
                <Field
                  label="Arrive"
                  value={toClock(arrive)}
                  open={open === 'arrive'}
                  onPress={() => setOpen(open === 'arrive' ? null : 'arrive')}
                  options={ARRIVE_OPTIONS.map((v) => ({ value: v, label: v }))}
                  onPick={(v) => { setArrive(fromClock(v)); setOpen(null); }}
                />
                <Field
                  label="Stay for"
                  value={stayWords(allow)}
                  open={open === 'allow'}
                  onPress={() => setOpen(open === 'allow' ? null : 'allow')}
                  options={ALLOW_OPTIONS.map((v) => ({ value: v, label: stayWords(Number(v)) }))}
                  onPick={(v) => { setAllow(Number(v)); setOpen(null); }}
                />
              </View>

              {/*
                The line that ties the two together: how you are getting there,
                when to walk out of the door, and when you are back. All three
                are derived, so any change to either column moves them.
              */}
              <View style={styles.travelLine}>
                <Icon name={travelIcon} size={16} color={colors.ink} strokeWidth={2.2} />
                <Text style={styles.travelText}>
                  {drive != null ? `${travelWord} ${hoursWords(drive)}` : travelWord}
                </Text>
                {leaveHome ? (
                  <>
                    <Text style={styles.travelDot}>·</Text>
                    <Text style={styles.travelText}>Leave home <Text style={styles.travelStrong}>{leaveHome}</Text></Text>
                  </>
                ) : null}
                <Text style={styles.travelDot}>·</Text>
                <Text style={styles.travelText}>Home by <Text style={styles.travelStrong}>{homeBy}</Text></Text>
              </View>
            </>
          ) : (
            <>
              <FormRow
                icon="hotel"
                title="Where you're staying"
                sub={stayWhere ?? 'Add a hotel or address · optional'}
                action={stayWhere ? 'Change' : 'Add'}
                onPress={() => setStayOpen(true)}
              />
              <FormRow
                icon="transit"
                title="Getting there"
                sub="Flights, train or drive · optional"
                action="Add"
                onPress={() => save('travel')}
              />
            </>
          )}

          <Press onPress={() => setWhoOpen((o) => !o)} style={styles.whoRow} accessibilityRole="button" accessibilityState={{ expanded: whoOpen }}>
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
          </Press>
          {whoOpen ? (
            <View style={styles.ticks}>
              {members.map((m) => {
                const on = attending.has(m.id);
                return (
                  <Press
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
                  </Press>
                );
              })}
            </View>
          ) : null}

          {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
        </View>
      </ScrollView>

      {/*
        Pushed *over* the form rather than navigated to, so everything already
        filled in is still here when it closes. It has an address of its own all
        the same (`/trips/new?stay=1`), which is the rule for a layer opened on
        top of a page.
      */}
      {stayOpen ? (
        <View style={styles.layer}>
          <WhereYouAreStayingScreen
            where={where}
            meta={[
              start && end ? `${new Date(`${start}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric' })} – ${new Date(`${end}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}` : null,
              nights ? `${nights} night${nights === 1 ? '' : 's'}` : null,
              chosen.length ? `${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}` : null,
            ].filter(Boolean).join(' · ')}
            initial={stayText}
            onClose={() => setStayOpen(false)}
            onDone={(choice: StayChoice) => {
              if (choice.kind === 'place') { setStay(choice.place); setStayText(''); }
              if (choice.kind === 'typed') { setStay(null); setStayText(choice.text); }
              if (choice.kind === 'later') { setStay(null); setStayText(''); }
              setStayOpen(false);
            }}
          />
        </View>
      ) : null}

      <View style={styles.foot}>
        <Press onPress={() => save('trip')} style={styles.primary} accessibilityRole="button" disabled={busy || !start}>
          <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save trip'}</Text>
          <Icon name="forward" size={18} color={colors.primaryFg} strokeWidth={2.4} />
        </Press>
      </View>
    </View>
  );
}

/**
 * One of the pair: a small grey kicker over the value, and a plain list that
 * drops straight beneath it when the value is tapped (5a/5g).
 *
 * No box, no underline, no steppers — the owner, 7 Sep 2026: "I don't want to
 * hit arrows to move it in increments of 15 minutes." The list is positioned
 * absolutely so it opens *over* what is below rather than pushing the screen
 * around, which is what the handoff draws.
 */
function Field({ label, value, open, onPress, options, onPick }: {
  label: string;
  value: string;
  open: boolean;
  onPress: () => void;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  const list = useRef<ScrollView>(null);
  const at = Math.max(0, options.findIndex((o) => o.value === value || o.label === value));
  // Open on what is set, two rows up so there is something above it to scroll
  // back to — a list that opens at five in the morning is a list to be scrolled.
  useEffect(() => {
    if (open) requestAnimationFrame(() => list.current?.scrollTo({ y: Math.max(0, (at - 2) * DROP_ROW), animated: false }));
  }, [open, at]);
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Press
        onPress={onPress}
        style={styles.cellValue}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}: ${value}`}
      >
        <Text style={styles.cellValueText}>{value}</Text>
        <Icon name={open ? 'collapse' : 'expand'} size={14} color={colors.ink} strokeWidth={2.6} />
      </Press>
      {open ? (
        <View style={styles.drop}>
          <ScrollView ref={list} style={{ maxHeight: DROP_ROW * 5 }} showsVerticalScrollIndicator={false}>
            {options.map((o) => {
              const on = o.value === value || o.label === value;
              return (
                <Press
                  key={o.value}
                  onPress={() => onPick(o.value)}
                  style={[styles.dropRow, on && styles.dropRowOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.dropText, on && styles.dropTextOn]}>{o.label}</Text>
                </Press>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function FormRow({ icon, title, sub, action, onPress }: {
  icon: 'hotel' | 'transit'; title: string; sub: string; action: string; onPress: () => void;
}) {
  return (
    <Press onPress={onPress} style={styles.formRow} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`}>
      <Icon name={icon} size={22} color={colors.ink} strokeWidth={2.2} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>
      </View>
      <Text style={styles.rowAction}>{`${action} ›`}</Text>
    </Press>
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
  photoWrap: { paddingHorizontal: 20 },

  body: { paddingHorizontal: 20, paddingTop: 14 },

  /**
   * The gap the single-day caption used to fill. Deliberately still here
   * (owner, 7 Sep 2026: "you can remove the text… but don't move anything up.
   * Leave that spacing between the calendar and the section below").
   */
  captionRow: { minHeight: 34, justifyContent: 'center' },

  // Two columns flush on the gutter, under a light rule (5a).
  /**
   * `zIndex` matters here: the list drops out of this row and over the travel
   * line and Who's coming, which come *after* it in the tree and would
   * otherwise paint on top of it — which they did, and the list was see-through.
   */
  pair: {
    flexDirection: 'row', gap: 12, paddingTop: 24, paddingBottom: 4, marginTop: 12,
    borderTopWidth: 1, borderTopColor: colors.lineSoft, zIndex: 20,
  },
  cell: { flex: 1, minWidth: 0, gap: 5, alignItems: 'flex-start' },
  cellLabel: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88,
    textTransform: 'uppercase', color: colors.inkMuted,
  },
  // The value is the loud thing: Archivo 800 at 22, with a chevron and no box.
  cellValue: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34 },
  cellValueText: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.66, color: colors.ink },

  /**
   * The list, dropped straight under the value it belongs to. Absolute, so it
   * covers what is below rather than shoving the screen down; a 1px soft rule
   * rather than the handoff's shadow, because the pack retires shadows and a
   * rule does the same job on a cream ground.
   */
  drop: {
    position: 'absolute', left: 0, top: '100%', marginTop: 8, minWidth: 132, zIndex: 30,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft,
  },
  dropRow: { height: DROP_ROW, justifyContent: 'center', paddingHorizontal: 12 },
  dropRowOn: { backgroundColor: colors.accentSoft },
  dropText: { fontFamily: fonts.body, fontSize: 16, color: colors.inkMuted },
  dropTextOn: { color: colors.ink, fontWeight: '600' },

  // How you get there, when you leave and when you are back — one grey line.
  travelLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 10, paddingBottom: 14, zIndex: 0 },
  travelText: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  travelStrong: { fontWeight: '600', color: colors.ink },
  travelDot: { fontFamily: fonts.body, fontSize: 13, color: colors.lineSoft },

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

  /** A screen pushed over this one, so the half-filled form underneath survives. */
  layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, zIndex: 10 },

  foot: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.primary, paddingVertical: 18, paddingHorizontal: 18,
  },
  primaryText: { fontFamily: fonts.body, fontSize: 17, fontWeight: '600', color: colors.primaryFg },
});
