import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { Icon } from './Icon';
import { nextRange, nightsBetween } from './dateRange';

/**
 * The month, on the create-trip screen (trip rebuild, 7 Sep 2026, 5a/5b).
 *
 * One control for both shapes of trip, because the household is never asked
 * which they are making: "one date = day trip; a range = multi-day". Tapping a
 * date sets it; tapping a second one makes a range; tapping the start again
 * takes the range back to one day. That is the whole interaction, and it is why
 * this is not the existing `DateRangePicker` — that one asks for a start and an
 * end in two fields, which is a different question.
 *
 * Weeks run Monday first, which is how a British week is drawn and how the
 * mock-up draws it. The past is dimmed rather than removed: a trip somebody is
 * writing down after the fact is a real thing, so a past day is still tappable.
 */

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => new Date(`${s}T12:00:00`);
const today = () => ymd(new Date());

/** Monday-first weekday index: Mon 0 … Sun 6. */
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

export function monthTitle(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

// The decision a tap makes, and the nights it comes to, both live next door so
// they can be tested without a React tree (`test/dates.test.ts`).
export { nightsBetween } from './dateRange';

export function MonthCalendar({ start, end, onChange, minMonth }: {
  /** The first date, or null for a calendar nobody has touched. */
  start: string | null;
  /** The last, when the household has tapped a second date. Null is one day. */
  end: string | null;
  /** `start` comes back null when the one chosen date is tapped again. */
  onChange: (next: { start: string | null; end: string | null }) => void;
  /** The earliest month worth showing; the arrows stop here. Defaults to this one. */
  minMonth?: { year: number; month: number };
}) {
  const first = start ? parse(start) : new Date();
  const [{ year, month }, setMonth] = useState({ year: first.getFullYear(), month: first.getMonth() });

  const floor = minMonth ?? { year: new Date().getFullYear(), month: new Date().getMonth() };
  const atFloor = year < floor.year || (year === floor.year && month <= floor.month);

  const step = (by: number) => {
    const d = new Date(year, month + by, 1);
    if (by < 0 && atFloor) return;
    setMonth({ year: d.getFullYear(), month: d.getMonth() });
  };

  /**
   * A swipe across the grid changes the month, which is the handoff's "swipe or
   * tap". It is a pan responder rather than a scroll view because the grid has
   * to stay one tree — a horizontal scroller of months would lose the tap
   * targets to the scroller's own gesture on the web.
   */
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_e, g) => { if (g.dx < -40) step(1); else if (g.dx > 40) step(-1); },
  })).current;

  const now = today();

  const cells = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const lead = mondayIndex(firstOfMonth);
    const days = new Date(year, month + 1, 0).getDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= days; d += 1) out.push(ymd(new Date(year, month, d)));
    while (out.length % 7 !== 0) out.push(null);

    /**
     * A week that is entirely behind us is not shown (owner, 7 Sep 2026: "if we
     * finish the first week, then the month should start on the 7th today, and
     * the first row should be removed. It just creates more room").
     *
     * Whole weeks only, so the grid keeps its Monday-to-Sunday columns — and
     * only leading ones, so a month you have paged back to is still whole.
     */
    const weeks: (string | null)[][] = [];
    for (let i = 0; i < out.length; i += 7) weeks.push(out.slice(i, i + 7));
    while (weeks.length > 1 && weeks[0].every((d) => d == null || d < now)) weeks.shift();
    return weeks.flat();
  }, [year, month, now]);

  const pick = (date: string) => onChange(nextRange({ start, end }, date));

  return (
    <View>
      <View style={styles.monthRow}>
        <Text style={styles.monthName}>{monthTitle(year, month)}</Text>
        <View style={styles.monthNav}>
          <Text style={styles.hint}>swipe or tap</Text>
          <Pressable
            onPress={() => step(-1)}
            style={[styles.arrow, atFloor && { opacity: 0.35 }]}
            accessibilityRole="button"
            accessibilityLabel="The month before"
            disabled={atFloor}
          >
            <Icon name="previous" size={16} color={colors.ink} strokeWidth={2.4} />
          </Pressable>
          <Pressable onPress={() => step(1)} style={styles.arrow} accessibilityRole="button" accessibilityLabel="The month after">
            <Icon name="more" size={16} color={colors.ink} strokeWidth={2.4} />
          </Pressable>
        </View>
      </View>

      <View style={styles.letters}>
        {DAY_LETTERS.map((l, i) => <Text key={i} style={styles.letter}>{l}</Text>)}
      </View>

      <View style={styles.grid} {...swipe.panHandlers}>
        {cells.map((date, i) => {
          if (!date) return <View key={`gap-${i}`} style={styles.cell} />;
          const isStart = date === start;
          const isEnd = end != null && date === end;
          const inside = start != null && end != null && date > start && date < end;
          const past = date < now;
          return (
            <Pressable
              key={date}
              onPress={() => pick(date)}
              style={[styles.cell, inside && styles.inside, (isStart || isEnd) && styles.endpoint]}
              accessibilityRole="button"
              accessibilityState={{ selected: isStart || isEnd }}
              accessibilityLabel={parse(date).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
            >
              <Text style={[
                styles.date,
                past && !isStart && !isEnd && !inside && { color: colors.decor },
                (isStart || isEnd) && styles.dateOn,
              ]}>
                {Number(date.slice(8, 10))}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** "Saturday 12 September · tap another date for a longer trip", or the range in Moss. */
export function DatesCaption({ start, end }: { start: string | null; end: string | null }) {
  if (!start) return <Text style={styles.caption}>Tap a date · tap a second one for a longer trip</Text>;
  if (!end) {
    return (
      <Text style={styles.caption}>
        {parse(start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · tap another date for a longer trip
      </Text>
    );
  }
  const nights = nightsBetween(start, end);
  const a = parse(start);
  const b = parse(end);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString([], { weekday: 'short', day: 'numeric', ...(sameMonth ? {} : { month: 'long' }) });
  const right = b.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'long' });
  return <Text style={[styles.caption, styles.captionOn]}>{`${left} – ${right} · ${nights} night${nights === 1 ? '' : 's'}`}</Text>;
}

const styles = StyleSheet.create({
  monthRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  monthName: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, marginRight: 6 },
  arrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  letters: { flexDirection: 'row', paddingTop: 10, paddingBottom: 2 },
  letter: { flex: 1, textAlign: 'center', fontFamily: fonts.body, fontSize: 11, fontWeight: '600', color: colors.inkMuted },

  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 2 },
  // Seven to a row, and the width is a seventh rather than a flex, so a month
  // that starts on a Sunday does not stretch its one cell across the week.
  cell: { width: `${100 / 7}%`, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  // Square corners, like everything else: the endpoints are a lime fill and the
  // nights between them are the tint (Epic pack §07).
  endpoint: { backgroundColor: colors.selected },
  inside: { backgroundColor: colors.accentSoft },
  date: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  dateOn: { fontWeight: '600', color: colors.selectedFg },

  caption: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, paddingTop: 6, paddingBottom: 10 },
  captionOn: { color: colors.accent, fontWeight: '600' },
});

export { ymd, parse as parseDate };
