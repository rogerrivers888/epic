import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, spacing, BORDER, TARGET } from '../theme';
import { useViewport } from '../hooks/useViewport';
import { Icon, IconName } from './Icon';

/**
 * "How far will you go?" (Inspire rework, screen 8c).
 *
 * A modal sheet rather than the map's draggable one: there is nothing behind it
 * worth peering at, and every option is one tap. The scrim is the pack's ink at
 * 45%, and the sheet has no top border — the design is explicit about that,
 * because a rule there would read as the top of a page rather than the edge of
 * something lifted over one.
 *
 * The counts are the point of the screen. They say what each answer would
 * actually get you before you choose it, so "up to 2 hours" is a decision
 * rather than a guess, and they change with the mode.
 */

export type TravelMode = 'drive' | 'transit' | 'walk';
/** null is "anywhere" — no ceiling at all, not a very large one. */
export type TravelMinutes = 20 | 30 | 60 | 120 | null;

const MODES: { key: TravelMode; label: string; icon: IconName }[] = [
  { key: 'drive', label: 'Drive', icon: 'driving' },
  { key: 'transit', label: 'Public transport', icon: 'transit' },
  { key: 'walk', label: 'Walk', icon: 'walking' },
];

const OPTIONS: { minutes: TravelMinutes; label: string }[] = [
  { minutes: 20, label: 'Up to 20 minutes' },
  { minutes: 30, label: 'Up to 30 minutes' },
  { minutes: 60, label: 'Up to 1 hour' },
  { minutes: 120, label: 'Up to 2 hours' },
  { minutes: null, label: 'Anywhere' },
];

/** How this filter reads on the row that opens it: "Up to 1 hr drive". */
export function travelLabel(mode: TravelMode, minutes: TravelMinutes): string {
  const how = mode === 'drive' ? 'drive' : mode === 'transit' ? 'by transport' : 'walk';
  if (minutes == null) return `Anywhere · ${how}`;
  const time = minutes >= 60 ? `${minutes / 60} hr` : `${minutes} min`;
  return `Up to ${time} ${how}`;
}

export function TravelSheet({ from, mode, minutes, counts, total, onMode, onMinutes, onClose }: {
  /** Where the times are measured from — named, because "20 minutes" from where matters. */
  from: string;
  mode: TravelMode;
  minutes: TravelMinutes;
  /** How many places each ceiling would give, for the mode now chosen. */
  counts: (m: TravelMinutes) => number | null;
  /** What the button will show — the count for what is currently picked. */
  total: number | null;
  onMode: (m: TravelMode) => void;
  onMinutes: (m: TravelMinutes) => void;
  onClose: () => void;
}) {
  const { width, height, framed, origin } = useViewport();
  // Inside the shell's phone frame the Modal still portals to the whole window,
  // so the sheet is pinned to the frame rather than to the browser (CLAUDE.md).
  const frameBox = framed && origin
    ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height }
    : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.fill, frameBox]}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>How far will you go?</Text>
              <Text style={styles.sub}>Travel time from {from}, one way.</Text>
            </View>
            <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={20} color={colors.ink} />
            </Pressable>
          </View>

          {/* Three equal cells in one soft outline, divided by the same rule. */}
          <View style={styles.modes}>
            {MODES.map((m, i) => {
              const on = m.key === mode;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => onMode(m.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.mode, i > 0 && styles.modeDivider, on && styles.modeOn]}
                >
                  <Icon name={m.icon} size={22} color={on ? colors.selectedFg : colors.ink} />
                  <Text style={[styles.modeText, on && { color: colors.selectedFg }]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView style={styles.options} contentContainerStyle={{ paddingBottom: spacing.sm }}>
            {OPTIONS.map((o) => {
              const on = o.minutes === minutes;
              const n = counts(o.minutes);
              return (
                <Pressable
                  key={String(o.minutes)}
                  onPress={() => onMinutes(o.minutes)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.option, on && styles.optionOn]}
                >
                  <Text style={[styles.optionText, on && styles.optionTextOn]}>{o.label}</Text>
                  <Text style={[styles.optionCount, on && styles.optionTextOn]}>
                    {o.minutes == null ? 'All' : n == null ? '' : `${n.toLocaleString()} place${n === 1 ? '' : 's'}`}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable onPress={onClose} style={styles.go} accessibilityRole="button">
            <Text style={styles.goText}>{total == null ? 'Show places' : `Show ${total.toLocaleString()} place${total === 1 ? '' : 's'}`}</Text>
            <Icon name="forward" size={18} color={colors.primaryFg} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  // The handoff gives the scrim two values; `var()` resolves whichever mode is
  // on, the same way every other colour here does.
  scrim: { ...(StyleSheet.absoluteFill as object), backgroundColor: colors.scrim },
  // No top border: the design is explicit, and the scrim is what separates it.
  sheet: { backgroundColor: colors.surface, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 44, gap: 18, maxHeight: '88%' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.44, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted, marginTop: 4 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  modes: { flexDirection: 'row', borderWidth: 1, borderColor: colors.lineSoft },
  mode: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 8, minHeight: 72 },
  modeDivider: { borderLeftWidth: 1, borderLeftColor: colors.lineSoft },
  modeOn: { backgroundColor: colors.selected },
  modeText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink, textAlign: 'center' },

  options: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  /**
   * The rows bleed 12px into the gutter so a selected row's lime fill runs the
   * same width as the rules above and below it; inset, it would read as a
   * button that had been dropped into a list.
   */
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    minHeight: TARGET, paddingVertical: 14, paddingHorizontal: 12, marginHorizontal: -12,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  optionOn: { backgroundColor: colors.selected, borderBottomColor: colors.selected },
  optionText: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  optionCount: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  optionTextOn: { fontWeight: '600', color: colors.selectedFg },

  go: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.primary, paddingVertical: 16, paddingHorizontal: 18, minHeight: TARGET,
  },
  goText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.primaryFg },
});

export { OPTIONS as TRAVEL_OPTIONS, MODES as TRAVEL_MODES };
