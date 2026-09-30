import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { Icon, IconName } from './Icon';
import { colors, fonts, TARGET } from '../theme';

/**
 * The two rows below the ink menu (New navigation, owner 30 Sep 2026, §6).
 *
 * They are chrome, not body: the context row that narrows the list, and the
 * section header that names a slice of it. Named here so Inspire, a trip's
 * browse and Places-drilled-in draw the same ones.
 */

/**
 * §6 context row: a single control on the left (a range, a detour) with a
 * leading icon and a chevron, and "Filters" on the right. `padding: 10px 20px
 * 0`. The car is Lucide `car`, side-on. The control is regular weight — it is a
 * setting, not a heading.
 */
export function ContextRow({ label, spoken, icon = 'driving', onPress, onFilters, filtersLabel = 'Filters', filtersActive = false }: {
  label: string;
  /** What a screen reader hears, where the visual label is an abbreviation —
   *  "Within 30 min of Sunningdale, driving" for "30 min · Sunningdale". */
  spoken?: string;
  /** A leading icon, or `null` for none (the "Been and liked ▾" list dropdown). */
  icon?: IconName | null;
  onPress: () => void;
  onFilters: () => void;
  /** e.g. "Filters (2)" when some are set — so an active filter is never silent. */
  filtersLabel?: string;
  /** Set away from the default: the control turns moss, like every other "set" control. */
  filtersActive?: boolean;
}) {
  // Below-band controls sit on the screen ground (cream in light, dark in
  // dark), so their colours are palette-aware — not the band's fixed light
  // constants, which would vanish in dark mode (Codex).
  const filtersColour = filtersActive ? colors.accent : colors.inkMuted;
  return (
    <View style={styles.ctxRow}>
      {/* A thin row by design, but each control is a full 44px to the finger
          (minHeight on the press), with a little slop besides (Codex). */}
      <Press onPress={onPress} style={styles.ctl} accessibilityRole="button" accessibilityLabel={spoken ?? label} hitSlop={{ top: 8, bottom: 8, left: 4, right: 6 }}>
        {icon ? <Icon name={icon} size={17} color={colors.ink} strokeWidth={2} /> : null}
        <Text numberOfLines={1} style={styles.ctlText}>{label}</Text>
        <Icon name="expand" size={14} color={colors.inkMuted} strokeWidth={2.4} />
      </Press>
      <Press onPress={onFilters} style={styles.filters} accessibilityRole="button" accessibilityLabel={filtersLabel} hitSlop={{ top: 14, bottom: 14, left: 6, right: 4 }}>
        <Icon name="filters" size={15} color={filtersColour} strokeWidth={2} />
        <Text style={[styles.filtersText, { color: filtersColour }]}>{filtersLabel}</Text>
      </Press>
    </View>
  );
}

/**
 * §6 section header: title case (not caps), Archivo 800 20px, the count at
 * 13px/600 muted with an 8px gap, and an optional "See all ›" right-aligned in
 * moss. Replaces the old 11px uppercase kicker everywhere it named a section.
 */
export function SectionHeader({ title, count, onSeeAll }: {
  title: string;
  count?: number | string;
  onSeeAll?: () => void;
}) {
  return (
    <View style={styles.secRow}>
      <View style={styles.secLeft}>
        <Text style={styles.secTitle}>{title}</Text>
        {count != null ? <Text style={styles.secCount}>{count}</Text> : null}
      </View>
      {onSeeAll ? (
        <Press onPress={onSeeAll} accessibilityRole="button" accessibilityLabel={`See all ${title}`}>
          <Text style={styles.seeAll}>See all ›</Text>
        </Press>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // §6 draws a thin row, but the controls are a full 44px to the finger (the
  // pack's TARGET, as the row it replaced was) — the height is on the presses,
  // so the text still reads at the top (Codex).
  ctxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 20, paddingTop: 6 },
  ctl: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1, minHeight: TARGET },
  ctlText: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '400', color: colors.ink },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TARGET },
  filtersText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted },
  // Gutter-agnostic: it inherits its parent's horizontal padding (the list
  // body's 20px gutter), so it lines up with the rows under it. §6 puts 24px
  // between the context row and the first header — the caller owns that gap.
  secRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  secLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  secTitle: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  secCount: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted },
  seeAll: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: colors.accent },
});
