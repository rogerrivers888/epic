import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/press';
import { Booking, TripSummary } from '../api';
import { colors, fonts, type } from '../theme';
import { CategoryStrip, MenuBar, ScreenTop, PairSwitch, TopControl } from '../components/InspireHeader';
import { VenueThumb } from '../components/VenueThumb';
import { StatusLine } from '../components/ui';
// The name the household wrote is what a row says (1a: "Windsor Saturday",
// "Thorpe Park with the kids"). `tripTitle` is that name, with the one repair
// it needs: a title auto-made at creation that leads with a council reads as
// the town instead.
import { tripTitle } from './tripName';
import { HostFace, dayShort, durationWords, money } from '../components/hosting';

/**
 * The Trips tab (trip rebuild, 7 Sep 2026, screen 1a).
 *
 * The head is the one every tab has now — the wordmark, and one control on the
 * right, which here is "+ New trip". Under it the menu bar Inspire draws
 * (`MenuBar`, v2, 7 Sep 2026), edge to edge: **Day trips / Holidays** as two
 * equal cells in Archivo 800, and **Upcoming · Past · Ideas** centred on the
 * lime band beneath. Then a count.
 *
 * Then rows. No cards, no boxes: an 84px picture, three lines, and a 1px rule
 * on the 20px gutter — which is the pack's list everywhere else in the app.
 *
 * The filters that used to be here (area, who) are gone from the screen and not
 * from the app: Where was already drawn under Past only, and Who is answered by
 * the people on the trip. Nothing was removed that the owner asked for — the
 * three strips *are* the filter now, and Ideas is the one that is new.
 */

const SPANS = [
  { value: 'day' as const, label: 'Day trips' },
  { value: 'holiday' as const, label: 'Holidays' },
];

/**
 * `hosts` is Booked with hosts (Events v4, G2): the experiences this household
 * has booked, beside its group trips — Upcoming, then Past with a Rate prompt,
 * and refunded ones in red. Bookings are not trips, so they are their own
 * strip rather than rows mixed into the others.
 */
export type TripsWhen = 'upcoming' | 'past' | 'ideas' | 'hosts';
const WHENS: { key: TripsWhen; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'hosts', label: 'Booked with hosts' },
  { key: 'past', label: 'Past' },
  { key: 'ideas', label: 'Ideas' },
];

const MODE_WORD: Record<string, string> = { driving: 'Drive', transit: 'Train', walking: 'Walk', cycling: 'Cycle' };

const startOf = (t: TripSummary) => new Date(t.startDate ? `${t.startDate}T12:00:00` : t.departAt);

/** "Sat 12 Sep", or the range on a holiday. */
function whenWords(t: TripSummary): string {
  if (t.datesFixed === false) return 'No date yet';
  const a = startOf(t);
  const day = (d: Date) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  if (t.nights > 0 && t.endDate) {
    const b = new Date(`${t.endDate}T12:00:00`);
    return `${day(a)} – ${day(b)}`;
  }
  return day(a);
}

/**
 * The third line: how far off it is, in Moss, or why it has no date.
 *
 * "In 5 days" is the thing worth knowing about something coming; a past trip is
 * asked for what it is still owed instead, which is the rating nudge the
 * handover asked for on 5 Sep and which nothing else on this row carries.
 */
function statusWords(t: TripSummary): { text: string; strong: boolean } {
  if (t.datesFixed === false) return { text: 'Date not fixed', strong: false };
  const days = Math.round((+startOf(t) - +new Date(new Date().toDateString())) / 86_400_000);
  if (t.isPast) {
    if (t.unratedCount) return { text: `${t.unratedCount} still to rate`, strong: true };
    const back = Math.abs(days);
    return { text: back < 1 ? 'Today' : back === 1 ? 'Yesterday' : back < 14 ? `${back} days ago` : startOf(t).toLocaleDateString([], { month: 'long', year: 'numeric' }), strong: false };
  }
  if (days <= 0) return { text: 'Today', strong: true };
  if (days === 1) return { text: 'Tomorrow', strong: true };
  return { text: `In ${days} days`, strong: true };
}

export function TripsList({ trips, bookings, loading, error, span, when, onSpan, onWhen, onOpen, onHold, onNew, onOpenBooking, wide }: {
  trips: TripSummary[] | null;
  /** What the household has booked with hosts, for the `hosts` strip. */
  bookings?: Booking[] | null;
  onOpenBooking?: (b: Booking) => void;
  loading: boolean;
  error: string | null;
  span: 'day' | 'holiday';
  when: TripsWhen;
  onSpan: (s: 'day' | 'holiday') => void;
  onWhen: (w: TripsWhen) => void;
  onOpen: (t: TripSummary) => void;
  /** Hold a row for rename, share and delete — where the ⋯ went (5h). */
  onHold: (t: TripSummary) => void;
  onNew: () => void;
  wide: boolean;
}) {
  const all = trips ?? [];

  /**
   * A night away is a holiday; everything else is a day out, whatever it calls
   * itself. One rule, and it is the line the switch is drawn on.
   */
  const inSpan = (t: TripSummary) => (span === 'holiday' ? t.nights > 0 : t.nights === 0);
  const inWhen = (t: TripSummary) =>
    (when === 'hosts' ? false
      : when === 'ideas' ? t.datesFixed === false
        : t.datesFixed !== false && (when === 'past' ? t.isPast : !t.isPast));

  const counts = useMemo(() => {
    const mine = all.filter(inSpan);
    return {
      upcoming: mine.filter((t) => t.datesFixed !== false && !t.isPast).length,
      past: mine.filter((t) => t.datesFixed !== false && t.isPast).length,
      ideas: mine.filter((t) => t.datesFixed === false).length,
      hosts: (bookings ?? []).filter((b) => b.state !== 'cancelled' || b.paymentStatus === 'refunded').length,
    };
  }, [all, span, bookings]);

  const shown = all
    .filter((t) => inSpan(t) && inWhen(t))
    .sort((a, b) => (when === 'past' ? +startOf(b) - +startOf(a) : +startOf(a) - +startOf(b)));

  const noun = span === 'holiday' ? 'holiday' : 'day trip';
  const count = counts[when];

  return (
    <View style={{ flex: 1 }}>
      <View style={wide ? styles.wide : undefined}>
        <ScreenTop>
          <TopControl label="New trip" icon="add" onPress={onNew} accessibilityLabel="Start a new trip" />
        </ScreenTop>

        {/* The same menu bar as Inspire, with this tab's two words in it: the
            head is shared so that the tabs cannot drift apart. */}
        <MenuBar>
          <PairSwitch value={span} options={SPANS} onPick={onSpan} />
          <CategoryStrip items={WHENS.map((w) => ({ key: w.key, label: w.label }))} value={when} onPick={(k) => onWhen(k as TripsWhen)} />
        </MenuBar>

        <Text style={styles.count}>
          {when === 'hosts'
            ? (count === 0 ? 'Nothing booked with a host yet' : `${count} booked with hosts`)
            : count === 0
              ? `No ${noun}s ${when === 'ideas' ? 'noted down' : when}`
              : `${count} ${when === 'ideas' ? (count === 1 ? 'idea' : 'ideas') : when}`}
        </Text>
      </View>

      <ScrollView contentContainerStyle={[styles.body, wide && styles.wideBody]} keyboardShouldPersistTaps="handled">
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
        {loading && !trips ? <Text style={type.small}>Loading…</Text> : null}
        {when === 'hosts' ? <BookingRows bookings={bookings ?? []} onOpen={(b) => onOpenBooking?.(b)} /> : null}
        {when !== 'hosts' && trips && !shown.length ? (
          <Text style={styles.blank}>
            {when === 'ideas'
              ? 'Nothing on the list yet. Save a trip without a date and it waits here until you fix one.'
              : when === 'past'
                ? `No ${noun}s behind you yet.`
                : `Nothing coming up. Tap New trip and say where you're going.`}
          </Text>
        ) : null}
        {when !== 'hosts' ? shown.map((t) => <TripRow key={t.id} trip={t} onPress={() => onOpen(t)} onHold={() => onHold(t)} />) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Booked with hosts (G2): upcoming first, then past with the rating prompt.
 * A held booking says so; a called-off one says Refunded, in red, because that
 * is money coming back and nothing else on this screen is red.
 */
function BookingRows({ bookings, onOpen }: { bookings: Booking[]; onOpen: (b: Booking) => void }) {
  const live = bookings.filter((b) => b.state !== 'cancelled' || b.paymentStatus === 'refunded');
  const upcoming = live.filter((b) => !b.isPast && b.state !== 'cancelled').sort((a, b) => (a.on ?? '').localeCompare(b.on ?? ''));
  const past = live.filter((b) => b.isPast || b.state === 'cancelled').sort((a, b) => (b.on ?? '').localeCompare(a.on ?? ''));
  if (!live.length) {
    return <Text style={styles.blank}>Nothing booked with a host yet. Experiences are in Inspire — a painting afternoon, a run club, a day out with another family — and what you book lands here beside your trips.</Text>;
  }
  const row = (b: Booking) => {
    const first = b.host.name.split(' ')[0];
    const status = b.state === 'cancelled' && b.paymentStatus === 'refunded' ? { text: 'Refunded', red: true }
      : b.state === 'cancelled' ? { text: 'Called off', red: false }
        : b.state === 'pending' ? { text: b.minCount ? `needs ${Math.max(0, b.minCount - b.heads)} more · Held` : 'Held', red: false }
          : b.state === 'waitlisted' ? { text: 'Waiting list', red: false }
            : b.isPast ? (['confirmed', 'attended'].includes(b.state) ? { text: b.reviewed ? 'Went' : `Rate ${first} ›`, red: false, strong: !b.reviewed } : { text: 'Not decided in time', red: false })
              : { text: 'Booked', red: false, strong: true };
    return (
      <Press key={b.id} onPress={() => onOpen(b)} accessibilityRole="button" style={styles.row}>
        <HostFace host={b.host} size={44} />
        <View style={styles.rowBody}>
          <Text style={styles.name} numberOfLines={2}>{b.title ?? 'An experience'}</Text>
          <Text style={styles.meta} numberOfLines={1}>{[first, b.on ? dayShort(b.on) : null, b.startsAt, durationWords(b.durationMin), b.heads > 1 ? `${b.heads} of you` : null, b.amountPence ? money(b.amountPence) : null].filter(Boolean).join(' · ')}</Text>
          <Text style={[styles.status, status.strong && styles.statusOn, status.red && { color: colors.overrun, fontWeight: '600' }]} numberOfLines={1}>{status.text}</Text>
        </View>
      </Press>
    );
  };
  return (
    <View>
      {upcoming.map(row)}
      {past.length ? <Text style={[styles.count, { paddingHorizontal: 0, paddingTop: 20 }]}>Past</Text> : null}
      {past.map(row)}
    </View>
  );
}

function TripRow({ trip, onPress, onHold }: { trip: TripSummary; onPress: () => void; onHold: () => void }) {
  const status = statusWords(trip);
  const meta = [
    whenWords(trip),
    trip.placeCount ? `${trip.placeCount} place${trip.placeCount === 1 ? '' : 's'}` : null,
    trip.nights > 0 ? `${trip.nights} night${trip.nights === 1 ? '' : 's'}` : MODE_WORD[trip.travelMode] ?? null,
  ].filter(Boolean).join(' · ');

  return (
    <Press
      onPress={onPress}
      onLongPress={onHold}
      delayLongPress={400}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${tripTitle(trip)}. Hold for rename, share and delete`}
    >
      {/* 84 at 1.6 (owner, 8 Sep 2026: "increase image size 60%", on Trips as
          on Inspire) — a trip is remembered by where it went, and the picture
          is the fastest way to say it. The width is that 134; the shape is the
          one every photograph now has (9 Sep 2026): 3:2 and rounded, not a
          square with square corners. */}
      <VenueThumb name={tripTitle(trip)} image={trip.image} category={null} width={134} height={89} credit={false} />
      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={2}>{tripTitle(trip)}</Text>
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        <Text style={[styles.status, status.strong && styles.statusOn]} numberOfLines={1}>{status.text}</Text>
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  wide: { maxWidth: 860, alignSelf: 'center', width: '100%' },
  wideBody: { maxWidth: 860, alignSelf: 'center', width: '100%' },
  count: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted, paddingHorizontal: 20, paddingTop: 14 },

  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 },
  blank: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, lineHeight: 19, paddingTop: 12 },

  row: { flexDirection: 'row', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  rowBody: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  // Moss for something coming, grey for something that is not — the handoff's
  // two states, and the only two this line has.
  status: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, marginTop: 'auto' },
  statusOn: { color: colors.accent, fontWeight: '600' },
});
