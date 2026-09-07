import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, spacing, BORDER, TARGET } from '../theme';
import { Icon, IconName } from './Icon';
import { PanelKicker } from './InspireHeader';

/**
 * "How far will you go?" — and, since v2, from where (handoff, "Filter line
 * v2"; screens/v2/…/inspire-drive-filter-open).
 *
 * This was a bottom sheet up to 7 Sep 2026 (8c). It is a panel hanging off the
 * filter line now, for the reason the sheet was wrong: a sheet covers the list
 * you are filtering, and every one of these controls is a question about that
 * list. The mode control lost its three icon tiles with it — beside "HOW FAR"
 * the way of travelling is a word in the sentence, not a third of the panel.
 *
 * The counts are still the point. They say what each answer would actually get
 * you before you choose it, so "up to 2 hours" is a decision rather than a
 * guess, and they change with the mode.
 */

export type TravelMode = 'drive' | 'transit' | 'walk';
/** null is "anywhere" — no ceiling at all, not a very large one. */
export type TravelMinutes = 20 | 30 | 60 | 120 | null;

// `short` is the word the v2 panel uses: three of them share one line beside
// "HOW FAR", where "Public transport" would take the line on its own.
const MODES: { key: TravelMode; label: string; short: string; icon: IconName }[] = [
  { key: 'drive', label: 'Drive', short: 'Drive', icon: 'driving' },
  { key: 'transit', label: 'Public transport', short: 'Transit', icon: 'transit' },
  { key: 'walk', label: 'Walk', short: 'Walk', icon: 'walking' },
];

const OPTIONS: { minutes: TravelMinutes; label: string }[] = [
  { minutes: 20, label: 'Up to 20 minutes' },
  { minutes: 30, label: 'Up to 30 minutes' },
  { minutes: 60, label: 'Up to 1 hour' },
  { minutes: 120, label: 'Up to 2 hours' },
  { minutes: null, label: 'Anywhere' },
];

/**
 * The same filter as one chip: how far, and from where (v2).
 *
 * "The first chip carries both origin and range" - because twenty minutes is
 * not a fact until you say twenty minutes from what, and the town used to sit
 * in the opposite corner of the screen from the hour it belonged to.
 */
export function travelChipLabel(mode: TravelMode, minutes: TravelMinutes, from: string | null): string {
  // "Within an hour of Sunningdale" rather than "Up to 1 hr from near
  // Sunningdale" (owner, 8 Sep 2026: "it\'s a bit shorter"). The way of
  // travelling is the icon in front of it, not a third clause.
  if (minutes == null) return from ? `Anywhere near ${from}` : 'Anywhere';
  const time = minutes >= 60 ? `${minutes / 60} hour${minutes >= 120 ? 's' : ''}` : `${minutes} min`;
  const how = mode === 'transit' ? ' by transport' : mode === 'walk' ? ' on foot' : '';
  return from ? `Within ${time} of ${from}${how}` : `Within ${time}${how}`;
}

/** How this filter reads where there is no room for the town: "Up to 1 hr drive". */
export function travelLabel(mode: TravelMode, minutes: TravelMinutes): string {
  const how = mode === 'drive' ? 'drive' : mode === 'transit' ? 'by transport' : 'walk';
  if (minutes == null) return `Anywhere · ${how}`;
  const time = minutes >= 60 ? `${minutes / 60} hr` : `${minutes} min`;
  return `Up to ${time} ${how}`;
}



/**
 * How far, and from where - the panel the first filter chip opens (v2,
 * screens/v2/…/inspire-drive-filter-open).
 *
 * Two questions in one place, in the order they are asked: *from* is the thing
 * the numbers below it depend on, so it sits above them, and changing it
 * changes every count. The counts are still the point of the panel - they say
 * what an answer would actually get you before you pick it, so "up to 2 hours"
 * is a decision rather than a guess.
 */
export function TravelPanel({
  from, mode, minutes, counts, total,
  onEditFrom, onHere, onHome, homeLabel, atHome, onMode, onMinutes, openNow, onOpenNow, onDone,
}: {
  /** Where the times are measured from, named. */
  from: string;
  mode: TravelMode;
  minutes: TravelMinutes;
  counts: (m: TravelMinutes) => number | null;
  total: number | null;
  /** Tap the field: the location search, where any town can be typed. */
  onEditFrom: () => void;
  /** Where the phone is, when the browser will say. Absent when it will not. */
  onHere: (() => void) | null;
  /** The household's home address, when one is set. */
  onHome: (() => void) | null;
  homeLabel: string;
  atHome: boolean;
  onMode: (m: TravelMode) => void;
  onMinutes: (m: TravelMinutes) => void;
  /** Whether only open places count. `null` where the question does not apply. */
  openNow?: boolean | null;
  onOpenNow?: (v: boolean) => void;
  onDone: () => void;
}) {
  return (
    <View>
      <View style={panel.fromHead}><PanelKicker>From</PanelKicker></View>

      {/* The field is a button: what it holds is a place, and places are picked
          on the search screen rather than typed into a filter. */}
      <Pressable onPress={onEditFrom} style={panel.field} accessibilityRole="button" accessibilityLabel={`Measuring from ${from}. Change it`}>
        <Icon name="address" size={14} color={colors.ink} />
        <Text numberOfLines={1} style={panel.fieldText}>{from}</Text>
        <Icon name="edit" size={16} color={colors.inkMuted} />
      </Pressable>

      {/* The origins that need no typing. Work is not one of them: the
          household has a home address and nothing else, and a shortcut to an
          address nobody has ever given would do nothing when tapped. */}
      <View style={panel.quick}>
        {onHere ? (
          <Pressable onPress={onHere} accessibilityRole="button" style={panel.quickHit}>
            <Text style={[panel.quickText, panel.quickHere]}>Use my location</Text>
          </Pressable>
        ) : null}
        {onHome ? (
          <Pressable onPress={onHome} accessibilityRole="button" accessibilityState={{ selected: atHome }} style={panel.quickHit}>
            <Text style={[panel.quickText, atHome && panel.quickOn]}>{homeLabel}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* "How far" and the way of getting there on one line: the mode is what
          the minutes below are measured in, not a filter of its own. */}
      <View style={panel.howFar}>
        <PanelKicker>How far</PanelKicker>
        <View style={panel.ways}>
          {MODES.map((m) => {
            const on = m.key === mode;
            return (
              <Pressable key={m.key} onPress={() => onMode(m.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <View style={[panel.way, on && panel.wayOn]}>
                  <Text style={[panel.wayText, on && panel.wayTextOn]}>{m.short}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={panel.rows}>
        {OPTIONS.map((o) => {
          const on = o.minutes === minutes;
          const n = counts(o.minutes);
          return (
            <Pressable
              key={String(o.minutes)}
              onPress={() => onMinutes(o.minutes)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[panel.row, on && panel.rowOn]}
            >
              <Text style={[panel.rowText, on && panel.rowTextOn]}>{o.label}</Text>
              <Text style={panel.rowCount}>{o.minutes == null ? 'All' : n == null ? '' : n.toLocaleString()}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Whether they would actually be open when you got there — the same
          question as how far, which is why it is here and not a chip of its
          own (owner, 8 Sep 2026). A check, not a chevron: it settles here. */}
      {openNow == null ? null : (
        <Pressable
          onPress={() => onOpenNow?.(!openNow)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: openNow }}
          style={[panel.row, panel.openRow, openNow && panel.rowOn]}
        >
          <Text style={[panel.rowText, openNow && panel.rowTextOn]}>Open now</Text>
          <Icon name={openNow ? 'check' : 'hours'} size={18} color={openNow ? colors.ink : colors.inkMuted} />
        </Pressable>
      )}

      <Pressable onPress={onDone} style={panel.show} accessibilityRole="button">
        <Text style={panel.showText}>{total == null ? 'Show places' : `Show ${total.toLocaleString()} place${total === 1 ? '' : 's'}`}</Text>
        <Icon name="forward" size={18} color={colors.primaryFg} />
      </Pressable>
    </View>
  );
}

/**
 * One list of choices under its own chip - Budget, on the travel panel's
 * pattern.
 *
 * The pack draws the travel panel only, but the two chips sit side by side on
 * the same line: one dropping down while its neighbour slid up from the bottom
 * of the screen would read as two unrelated controls. Same rows, same selected
 * fill, no From block.
 */
export function ChoicePanel({ sub, options, value, onPick }: {
  sub?: string | null;
  options: { key: string; label: string; count?: number | null }[];
  value: string;
  onPick: (key: string) => void;
}) {
  return (
    <View>
      {sub ? <Text style={panel.sub}>{sub}</Text> : null}
      <View style={[panel.rows, !sub && panel.rowsTop]}>
        {options.map((o) => {
          const on = o.key === value;
          return (
            <Pressable
              key={o.key}
              onPress={() => onPick(o.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[panel.row, on && panel.rowOn]}
            >
              <Text style={[panel.rowText, on && panel.rowTextOn]}>{o.label}</Text>
              <Text style={panel.rowCount}>{o.count == null ? '' : o.count.toLocaleString()}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const panel = StyleSheet.create({
  fromHead: { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 8 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20,
    paddingVertical: 12, paddingHorizontal: 14, minHeight: TARGET,
    borderWidth: 1, borderColor: colors.lineSoft,
  },
  fieldText: { flex: 1, fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },

  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingHorizontal: 20, paddingTop: 4 },
  quickHit: { paddingVertical: 10 },
  quickText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted },
  // The one green thing in the panel: it is the only row that goes and asks
  // something (the browser) rather than setting a value we already hold.
  quickHere: { color: colors.accent },
  quickOn: { color: colors.ink },

  howFar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6,
  },
  ways: { flexDirection: 'row', gap: 14 },
  // A text switch, not three boxes: the mode is a word in a sentence about the
  // minutes below it, and the underline is what marks the one in force.
  way: { paddingTop: 10, paddingBottom: 2, borderBottomWidth: BORDER, borderBottomColor: 'transparent' },
  wayOn: { borderBottomColor: colors.ink },
  wayText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted },
  wayTextOn: { color: colors.ink },

  rows: { marginHorizontal: 6 },
  rowsTop: { marginTop: 14 },
  // Sits under the ceilings but is not one of them, so it takes a rule rather
  // than joining the list it is not a member of.
  openRow: { marginHorizontal: 6, marginTop: 6, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    paddingVertical: 12, paddingHorizontal: 14, minHeight: TARGET,
  },
  // The lime *tint*, not lime: the chip that opened this panel is already full
  // lime, and two of those in one glance is two selections.
  rowOn: { backgroundColor: colors.bandSub },
  rowText: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  rowTextOn: { fontWeight: '600' },
  rowCount: { fontFamily: fonts.body, fontSize: 15, fontWeight: '400', color: colors.inkMuted },

  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, paddingHorizontal: 20, paddingTop: 14, lineHeight: 18 },

  show: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 10, marginHorizontal: 20, backgroundColor: colors.primary,
    paddingVertical: 16, paddingHorizontal: 18, minHeight: TARGET,
  },
  showText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.primaryFg },
});

export { OPTIONS as TRAVEL_OPTIONS, MODES as TRAVEL_MODES };
