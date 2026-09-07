import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, spacing, BORDER, TARGET } from '../theme';
import { Icon, IconName } from './Icon';
import { Wordmark } from './Wordmark';

/**
 * The head of the Inspire tab (Inspire rework, 7 Sep 2026, screens 8a/8b/8d).
 *
 * Four things stacked, and each one is a control rather than a heading: who and
 * where you are, which half of the app you are in, which category inside it,
 * and how far you will go. They are here rather than in the screen because 8b
 * and 8e draw the same head over a different body, and two copies of a header
 * is how the two stop matching.
 *
 * The centred switch and its strip are the one exception to the pack's
 * flush-left rule, and the handoff says so explicitly.
 */

const HEADER_TOP = 60;
const GUTTER = 20;

/** Row 1: the mark, and where we are looking. */
export function InspireTop({ where, onWhere }: { where: string; onWhere: () => void }) {
  return (
    <View style={styles.top}>
      <Wordmark height={30} ground={colors.bg} />
      <Pressable
        onPress={onWhere}
        style={styles.where}
        accessibilityRole="button"
        accessibilityLabel={`Near ${where}. Change where you are looking, or search for a place`}
      >
        <Icon name="address" size={14} color={colors.ink} />
        <Text numberOfLines={1} style={styles.whereText}>{where}</Text>
        <Icon name="search" size={16} color={colors.inkMuted} />
      </Pressable>
    </View>
  );
}

/**
 * Activities | Food. No gap between them and no radius: they are two halves of
 * one control, and the lime fill is what says which half you are in.
 */
export function ModeSwitch({ mode, onMode }: { mode: 'activities' | 'food'; onMode: (m: 'activities' | 'food') => void }) {
  return (
    <View style={styles.switchRow}>
      {(['activities', 'food'] as const).map((m) => {
        const on = m === mode;
        return (
          <Pressable
            key={m}
            onPress={() => onMode(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.switchCell, on ? styles.switchOn : styles.switchOff]}
          >
            <Text style={[styles.switchText, { color: on ? colors.ink : colors.inkMuted }]}>
              {m === 'activities' ? 'Activities' : 'Food'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type StripItem = { key: string; label: string };

/**
 * The category strip, sitting on the 2px ink rule that closes the switch block.
 *
 * The selected item is moss with a moss underline that lands *on* that rule
 * rather than above it, which is what makes the strip read as part of the block
 * instead of a row floating under it.
 */
export function CategoryStrip({ items, value, onPick }: {
  items: StripItem[]; value: string; onPick: (key: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} onPress={() => onPick(it.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <View style={[styles.stripItem, on && styles.stripItemOn]}>
              <Text numberOfLines={1} style={[styles.stripText, { color: on ? colors.accent : colors.inkMuted }]}>{it.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * The drawers inside the open category (8b). The whole row is moss — it belongs
 * to the category above it, and colouring only the selected item would make it
 * read as a second strip of equals.
 */
export function SubStrip({ items, value, onPick, allLabel }: {
  items: StripItem[]; value: string; onPick: (key: string) => void; allLabel: string;
}) {
  const all: StripItem[] = [{ key: 'all', label: allLabel }, ...items];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subStrip}>
      {all.map((it) => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} onPress={() => onPick(it.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <View style={[styles.subItem, on && styles.subItemOn]}>
              <Text numberOfLines={1} style={[styles.subText, on ? styles.subTextOn : styles.subTextOff]}>{it.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * How far, how much, and — in Food — whether it is open. The first is ink
 * because it is the one that is always set; the rest are grey until they are.
 */
export function FilterRow({ children, count }: { children: React.ReactNode; count?: string | null }) {
  return (
    <View style={styles.filters}>
      <View style={styles.filterItems}>{children}</View>
      {count ? <Text style={styles.count}>{count}</Text> : null}
    </View>
  );
}

export function FilterButton({ label, icon, strong, on, onPress, toggle }: {
  label: string;
  icon?: IconName;
  /** The travel filter, which always has a value and so is always ink. */
  strong?: boolean;
  /** A toggle that is currently on (Open now). */
  on?: boolean;
  onPress: () => void;
  /** A toggle has no chevron: there is no sheet behind it. */
  toggle?: boolean;
}) {
  const colour = strong || on ? colors.ink : colors.inkMuted;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={toggle ? { checked: !!on } : undefined} style={styles.filterBtn}>
      {icon ? <Icon name={icon} size={18} color={colour} /> : null}
      <Text style={[styles.filterText, { color: colour, fontWeight: on ? '700' : '600' }]}>{label}</Text>
      {toggle ? null : <Icon name="expand" size={12} color={colour} />}
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  top: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, paddingHorizontal: GUTTER,
    /**
     * The design's 60 from the top of the screen — which has to *include* the
     * status bar, not sit under it. On a phone with a notch the inset is around
     * 59, so adding 60 to it put the wordmark 119px down; `max` takes whichever
     * is the larger and adds a little breathing room over the clock.
     */
    paddingTop: (Platform.OS === 'web' ? `max(${HEADER_TOP}px, calc(env(safe-area-inset-top) + 12px))` : HEADER_TOP) as any,
  },
  where: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12,
    borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surface, flexShrink: 1,
  },
  whereText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.ink, flexShrink: 1 },

  // The switch block: the pair, the strip, and the one ink rule under both.
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl },
  switchCell: { paddingHorizontal: 14, paddingVertical: 6 },
  switchOn: { backgroundColor: colors.selected },
  switchOff: { backgroundColor: colors.accentSoft },
  switchText: { fontFamily: fonts.heading, fontSize: 26, fontWeight: '800', letterSpacing: -0.78 },

  strip: { flexGrow: 1, justifyContent: 'center', gap: 18, paddingTop: 6, paddingHorizontal: GUTTER },
  /**
   * The selected item's marker sits inside its own box rather than being pulled
   * down onto the block's rule with a negative margin: the strip is a scroller,
   * a scroller clips what hangs outside it, and the marker was being clipped
   * away entirely — so nothing on the row looked chosen (owner, 7 Sep 2026:
   * "you've got no active 1").
   */
  stripItem: { paddingTop: 6, paddingBottom: 6, borderBottomWidth: BORDER, borderBottomColor: 'transparent' },
  stripItemOn: { borderBottomColor: colors.accent },
  stripText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600' },

  subStrip: { flexGrow: 1, gap: 18, paddingTop: 8, paddingBottom: 6, paddingHorizontal: GUTTER },
  subItem: { paddingBottom: 4, borderBottomWidth: BORDER, borderBottomColor: 'transparent' },
  subItemOn: { borderBottomColor: colors.accent },
  // One size up: at 13 the drawers under an open category were the smallest
  // thing on the screen and the hardest to hit (owner, 7 Sep 2026).
  subText: { fontFamily: fonts.body, fontSize: 15, color: colors.accent },
  subTextOn: { fontWeight: '600' },
  subTextOff: { fontWeight: '400', opacity: 0.75 },

  filters: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, paddingHorizontal: GUTTER, paddingTop: 12, minHeight: TARGET,
  },
  // The filters wrap rather than run under the count: three of them plus
  // "14 places" does not fit 390px on one line, and the count is the thing you
  // read to decide whether to change them.
  filterItems: { flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 1, flexWrap: 'wrap' },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  filterText: { fontFamily: fonts.body, fontSize: 13 },
  count: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, flexShrink: 0 },
});

export const HEADER = { top: HEADER_TOP, gutter: GUTTER };

/**
 * The 2px rule the switch block closes with.
 *
 * `line`, not `ink`: in dark mode `ink` is the *type* colour, cream, and a
 * full-width cream band was the brightest thing on the screen (owner, 7 Sep
 * 2026: "the menu item line looks too bright"). `line` is ink on cream and a
 * warm mid-grey on ink, so the rule reads as a rule in both.
 */
export const blockRule = { borderBottomWidth: BORDER, borderBottomColor: colors.line } as const;
