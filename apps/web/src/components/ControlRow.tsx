import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, spacing, TARGET } from '../theme';
import { Icon, IconName } from './Icon';
import { useViewport } from '../hooks/useViewport';

/**
 * The control row and what hangs off it (handover v8, 8 Sep 2026, §1):
 *
 * > "Control rows are plain text with chevrons, never boxed buttons: left
 * > control, centred control, right control. Popovers are anchored panels with
 * > 1px rules and a 12/28 shadow; a full-width transparent scrim closes them."
 *
 * Inspire draws Where · Filters · Sort on it, Places draws Type · Mood · Sort,
 * and the two must not drift apart, so the row, the control and the panel are
 * one set of components here rather than a copy in each screen.
 *
 * A control is ink until it is set to something other than its default, when it
 * turns moss — the same signal the band uses for "this is narrowing the list".
 * The chevron turns over while its panel is open.
 *
 * The shadow is the one exception to the pack's "no shadows": a panel floating
 * over the list it is filtering needs an edge to read against, and the handover
 * names the value. Everything else in it is a 1px rule.
 */

const GUTTER = 20;

export function ControlRow({ left, centre, right, onLayout }: {
  left?: React.ReactNode; centre?: React.ReactNode; right?: React.ReactNode;
  onLayout?: (e: any) => void;
}) {
  return (
    <View style={styles.row} onLayout={onLayout}>
      <View style={styles.side}>{left}</View>
      {/* Centred in what the two sides leave, which is the handover's own
          `margin: 0 auto` — and what keeps the middle control from jumping
          when the left one changes length. */}
      <View style={styles.middle}>{centre}</View>
      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

export function ControlButton({ label, icon, set, open, onPress, spoken }: {
  label: string;
  /** Drawn before the label in ink — the car on Where. */
  icon?: IconName;
  /** Set away from its default, and therefore narrowing the list: moss. */
  set?: boolean;
  /** Its panel is open: the chevron turns over. */
  open?: boolean;
  onPress: () => void;
  /** What a screen reader hears, where the label alone is not the whole setting. */
  spoken?: string;
}) {
  const colour = set ? colors.accent : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ expanded: !!open }}
      style={styles.ctl}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
    >
      {icon ? <Icon name={icon} size={15} color={colors.ink} strokeWidth={2.2} /> : null}
      <Text numberOfLines={1} style={[styles.ctlText, { color: colour }]}>{label}</Text>
      <Icon name={open ? 'collapse' : 'expand'} size={12} color={colour} strokeWidth={2.6} />
    </Pressable>
  );
}

/**
 * The anchored panel a control opens.
 *
 * Absolutely positioned inside the screen's own container at `top` — the
 * measured foot of the head, never a guessed number — with a transparent
 * full-screen scrim behind it, so a tap anywhere else closes it. On a wide
 * window the panel keeps to 520px and sits under the control that opened it;
 * on a phone it runs gutter to gutter.
 */
export function Popover({ open, top, onClose, align = 'left', maxHeight = 380, children }: {
  open: boolean;
  top: number;
  onClose: () => void;
  align?: 'left' | 'centre' | 'right';
  maxHeight?: number;
  children: React.ReactNode;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  if (!open) return null;
  return (
    <>
      {/* The scrim starts where the panel does, not at the top of the screen:
          the control row stays live above it, so tapping Sort while Filters
          is open switches panels in one tap rather than closing one and
          asking for another, and the band still changes category. */}
      <Pressable
        style={[styles.scrim, { top }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <View style={[styles.anchor, { top }]} pointerEvents="box-none">
        <View
          style={[styles.anchorInner, { justifyContent: align === 'centre' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' }]}
          pointerEvents="box-none"
        >
          <View style={[styles.panel, wide && styles.panelWide]} accessibilityRole="menu">
            <ScrollView style={{ maxHeight }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          </View>
        </View>
      </View>
    </>
  );
}

/** A group inside a panel: HOW FAR, FROM, RATING. */
export function PopoverGroup({ title, children }: { title?: string | null; children: React.ReactNode }) {
  return (
    <View>
      {title ? <Text style={styles.kicker}>{title}</Text> : null}
      {children}
    </View>
  );
}

export type PopoverOption = { key: string; label: string; count?: number | string | null; on: boolean };

/**
 * One row of equal boxes — the handover's single-row scales: 20 minutes · 30
 * minutes · 1 hour · 2 hours; Any · £ · ££ · £££ · ££££; Any · 4.5+ · 4.0+ ·
 * 3.5+. Lime when chosen, warm grey otherwise, the count under each label.
 */
export function BoxRow({ options, onPick }: { options: PopoverOption[]; onPick: (key: string) => void }) {
  return (
    <View style={styles.boxes}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onPick(o.key)}
          accessibilityRole="button"
          accessibilityState={{ selected: o.on }}
          style={[styles.box, o.on ? styles.boxOn : styles.boxOff]}
        >
          <Text numberOfLines={1} style={[styles.boxLabel, o.on && styles.boxLabelOn]}>{o.label}</Text>
          {o.count != null && o.count !== '' ? <Text style={styles.boxCount}>{String(o.count)}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** A list inside a panel: label left, count right, the chosen row lime. */
export function PopoverList({ options, onPick, dense }: { options: PopoverOption[]; onPick: (key: string) => void; dense?: boolean }) {
  return (
    <View>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onPick(o.key)}
          accessibilityRole="menuitem"
          accessibilityState={{ selected: o.on }}
          style={[styles.item, dense && styles.itemDense, o.on && styles.itemOn]}
        >
          <Text numberOfLines={1} style={[styles.itemLabel, o.on && styles.itemLabelOn]}>{o.label}</Text>
          {o.count != null && o.count !== '' ? <Text style={styles.itemCount}>{String(o.count)}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** The panel's foot: "Clear filters", in moss, over a rule. */
export function PopoverFooter({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.foot}>
      <Text style={styles.footText}>{label}</Text>
    </Pressable>
  );
}

/**
 * The section title row a drill-down draws once you are inside something: the
 * back arrow on the gutter, the title, and how many are in it on the right —
 * or, in Places, a subtitle under the title instead.
 */
export function CrumbHead({ onBack, backLabel, title, aside, sub, size = 22, trailing }: {
  onBack: () => void;
  backLabel?: string;
  title: string;
  /** "121 places", on the right. */
  aside?: string | null;
  /** "United Kingdom", under the title. */
  sub?: string | null;
  size?: 22 | 24;
  /** Something after the aside — a control that belongs to this level. */
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.crumb}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={backLabel ?? 'Back'} style={styles.crumbBack} hitSlop={6}>
        <Icon name="back" size={20} color={colors.ink} strokeWidth={2} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.crumbTitle, size === 24 && styles.crumbTitle24]}>{title}</Text>
        {sub ? <Text numberOfLines={1} style={styles.crumbSub}>{sub}</Text> : null}
      </View>
      {aside ? <Text style={styles.crumbAside}>{aside}</Text> : null}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: GUTTER, minHeight: TARGET,
  },
  side: { flexShrink: 1, minWidth: 0, flexDirection: 'row' },
  sideRight: { justifyContent: 'flex-end' },
  middle: { flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'center' },
  ctl: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: TARGET - 8, flexShrink: 1, minWidth: 0 },
  ctlText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', flexShrink: 1 },

  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5, backgroundColor: 'transparent' },
  anchor: { position: 'absolute', left: 0, right: 0, zIndex: 6, alignItems: 'center' },
  anchorInner: { width: '100%', maxWidth: 1120, paddingHorizontal: GUTTER, flexDirection: 'row' },
  panel: {
    width: '100%', backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.lineSoft,
    boxShadow: '0 12px 28px rgba(32,30,29,0.14)',
  },
  panelWide: { maxWidth: 520 },

  kicker: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88,
    textTransform: 'uppercase', color: colors.inkMuted, paddingTop: 12, paddingHorizontal: 12, paddingBottom: 6,
  },
  boxes: { flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingBottom: 4 },
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1, paddingVertical: 9, paddingHorizontal: 4, minHeight: TARGET },
  boxOn: { backgroundColor: colors.selected },
  boxOff: { backgroundColor: colors.switchOff },
  boxLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  boxLabelOn: { fontWeight: '700', color: colors.selectedFg },
  boxCount: { fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted },

  item: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    paddingVertical: 11, paddingHorizontal: 12, minHeight: TARGET,
  },
  itemDense: { paddingVertical: 10 },
  itemOn: { backgroundColor: colors.selected },
  itemLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.ink, flexShrink: 1 },
  itemLabelOn: { fontWeight: '600', color: colors.selectedFg },
  itemCount: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted },

  foot: { alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.lineSoft, minHeight: TARGET, justifyContent: 'center' },
  footText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.accent },

  crumb: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: GUTTER, minHeight: TARGET },
  crumbBack: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  crumbTitle: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.44, color: colors.ink },
  crumbTitle24: { fontSize: 24, letterSpacing: -0.72, lineHeight: 26 },
  crumbSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  crumbAside: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
});
