import React from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
 * The middle two are the v2 menu bar ("Trips home page redesign menu bar",
 * 7 Sep 2026), which supersedes the centred switch and underlined strip the
 * pack shipped with: one bar that bleeds to both edges, in three flat fields -
 * the pair, the lime category band, and the paler drawer row that opens under
 * a chosen category. Nothing in it is centred by exception any more; the bar
 * is centred type on a full-width field, which is a different thing.
 */

const HEADER_TOP = 60;
const GUTTER = 20;

/**
 * Just clear of the status bar, and no further.
 *
 * The handoff's 60 is measured on a drawing whose status bar is part of the
 * picture; taken as padding *under* a real one it left the better part of a
 * centimetre of nothing above the wordmark (owner, 7 Sep 2026). The clock needs
 * clearing and nothing else does, so this is the inset plus a gap, with a floor
 * for a phone that reports no inset at all.
 *
 * Exported because every screen that draws its own head has to take the status
 * bar into its own first row (`ownsHeader`, routes.ts) — the Trips list, the
 * new-trip search, the create screen, Getting there and a stop's Ask all do.
 */
export const TOP_INSET = (Platform.OS === 'web' ? 'max(16px, calc(var(--epic-sat) + 10px))' : 16) as any;

/**
 * Row 1 on Inspire: the mark, and nothing else.
 *
 * The where-box that used to sit here has moved into the filter line (handoff
 * v2, "Filter line v2"), where it reads as one answer with the range it is
 * measured over - "Up to 1 hr from Sunningdale" - instead of a town in one
 * corner and an hour in another with nothing joining them. The row keeps its
 * 40px height so the bar below does not ride up when the field goes.
 */
export function InspireTop() {
  return (
    <View style={[styles.top, styles.topAlone]}>
      <Wordmark height={30} ground={colors.bg} />
    </View>
  );
}

/**
 * The head's right-hand control, whichever tab it is on.
 *
 * "Header wordmark and right-hand control sit in the same place on every tab;
 * only the control changes" (trip rebuild, behaviour summary) — Inspire's is
 * where you are looking, Trips' is "+ New trip". Both are a 40px box with a 2px
 * ink rule, so they are one component with a different label in it.
 */
export function TopControl({ label, icon, trailing, onPress, accessibilityLabel }: {
  label: string;
  /** Drawn before the label — the plus on "+ New trip", the pin on a location. */
  icon?: IconName;
  /** Drawn after it — the magnifier on Inspire's where-box. */
  trailing?: IconName;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.where} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}>
      {icon ? <Icon name={icon} size={16} color={colors.ink} strokeWidth={2.6} /> : null}
      <Text numberOfLines={1} style={styles.whereText}>{label}</Text>
      {trailing ? <Icon name={trailing} size={16} color={colors.inkMuted} /> : null}
    </Pressable>
  );
}

/** The mark on the left, one control on the right. Every tab's first row. */
export function ScreenTop({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.top}>
      <Wordmark height={30} ground={colors.bg} />
      {children}
    </View>
  );
}

/**
 * Two words, joined, edge to edge: Activities | Food on Inspire, Day trips |
 * Holidays on Trips.
 *
 * The v2 menu bar (handoff "Shared header - v2", 7 Sep 2026) replaces the
 * centred pair the pack shipped with. Two equal cells that bleed to both edges,
 * no gap, no radius and no rule under them - the lime fill is the whole of the
 * signal, and the half you are not in takes a warm grey rather than the lime
 * tint, because the tint means *selected* everywhere else in the app.
 */
export function PairSwitch<T extends string>({ value, options, onPick }: {
  value: T; options: { value: T; label: string }[]; onPick: (v: T) => void;
}) {
  return (
    <View style={styles.switchRow}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onPick(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.switchCell, on ? styles.switchOn : styles.switchOff]}
          >
            {/* Ink on lime, in both modes: `colors.ink` is the *type* colour
                and turns cream in the dark, which is white-on-lime at 1.25:1
                (owner, 7 Sep 2026: "the text and icons inside the green squares
                are white, not black"). */}
            <Text numberOfLines={1} style={[styles.switchText, { color: on ? colors.selectedFg : colors.inkMuted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Activities | Food & Drink, as the one pair Inspire draws.
 *
 * "Food" until 8 Sep 2026, when the strip beneath it gained bars — and a half
 * of the app called Food with Bars in it is telling you the wrong thing. The
 * full-width cell the v2 bar gave us is what made the longer word fit (owner:
 * "maybe we've got room for Drink now as well").
 */
export function ModeSwitch({ mode, onMode }: { mode: 'activities' | 'food'; onMode: (m: 'activities' | 'food') => void }) {
  return (
    <PairSwitch
      value={mode}
      options={[{ value: 'activities' as const, label: 'Activities' }, { value: 'food' as const, label: 'Food & Drink' }]}
      onPick={onMode}
    />
  );
}

export type StripItem = { key: string; label: string };

/**
 * The category band: a lime field directly under the switch, with the
 * categories centred on it.
 *
 * v2 drops the moss underline the pack shipped with. On a lime ground an
 * underline is a third green line under two green blocks, and it was the thing
 * that made the head read as a stack of rows rather than one bar; weight alone
 * does the work now - the chosen word is ink at 800, the rest sit back in a
 * green that is a shade of the band itself.
 */
export function CategoryStrip({ items, value, onPick }: {
  items: StripItem[]; value: string; onPick: (key: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.band}
      contentContainerStyle={styles.strip}
    >
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} onPress={() => onPick(it.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <View style={styles.stripItem}>
              <Text
                numberOfLines={1}
                style={[styles.stripText, on ? styles.stripTextOn : styles.stripTextOff]}
              >{it.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * The drawers inside the open category (8b), on a band of their own.
 *
 * A paler shade of the same green says "inside the thing above" without
 * repeating its colour, and it only exists while a category is open - so it
 * slides down out of the band rather than appearing, which is the difference
 * between the head growing and the head jumping.
 */
export function SubStrip({ items, value, onPick, allLabel }: {
  items: StripItem[]; value: string; onPick: (key: string) => void; allLabel: string;
}) {
  const all: StripItem[] = [{ key: 'all', label: allLabel }, ...items];
  return (
    <Reveal>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subBand} contentContainerStyle={styles.subStrip}>
        {all.map((it) => {
          const on = it.key === value;
          return (
            <Pressable key={it.key} onPress={() => onPick(it.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <View style={styles.subItem}>
                <Text numberOfLines={1} style={[styles.subText, on ? styles.subTextOn : styles.subTextOff]}>{it.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Reveal>
  );
}

/**
 * 150ms, ease-out, and nothing else moves.
 *
 * The handoff asks the sub-row to slide in. It is a band under a band, so the
 * honest version of that is the row sliding out from behind the one above it -
 * hence the clip, and hence the translate rather than a height animation, which
 * would need the row measured before it could be drawn.
 */
function Reveal({ children }: { children: React.ReactNode }) {
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [anim]);
  return (
    <View style={styles.reveal}>
      <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

/**
 * The whole menu bar: the pair, the band, and the drawers when one is open.
 *
 * It bleeds to both edges, so it is the one part of the head that takes no
 * gutter. Screens hand it their strip rather than drawing three components in
 * the right order themselves - that order *is* the design, and it is the thing
 * that would drift between Inspire and Trips first.
 */
export function MenuBar({ children }: { children: React.ReactNode }) {
  return <View style={styles.bar}>{children}</View>;
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

/**
 * What a filter chip opens: a panel hanging off the bottom of the bar.
 *
 * v2 moves the filters out of a bottom sheet and under the line that owns them
 * (handoff, "Filter line v2"). The difference is not decoration - a sheet
 * covers the list you are filtering, and this does not: it drops over the top
 * of it behind a light veil, so the thing you are about to change is still
 * there while you change it.
 *
 * `top` is where the head ends, measured rather than assumed, because the head
 * is a different height with a sub-band open than without one.
 */
export function FilterPanel({ top, onClose, children }: {
  top: number; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.panelScrim]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <View style={[styles.panel, { top }]}>
        {/* On a wide window the rows line up with the list they are filtering
            rather than running the full width of the pane. */}
        <View style={styles.panelInner}>{children}</View>
      </View>
    </>
  );
}

/** The small caps that name a group inside a panel: FROM, HOW FAR. */
export function PanelKicker({ children }: { children: React.ReactNode }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

export function FilterButton({ label, icon, on, narrowed, open, onPress, toggle }: {
  label: string;
  icon?: IconName;
  /** A toggle that is currently on (Open now). */
  on?: boolean;
  /**
   * Set to something other than its default, and therefore cutting the list
   * down. A filter that is quietly doing that should look like it is: the
   * alternative is a screen with nothing on it and three small grey words as
   * the only explanation.
   */
  narrowed?: boolean;
  /** Its panel is hanging open below the line. Lime, and the chevron turns over. */
  open?: boolean;
  onPress: () => void;
  /** A toggle has no chevron: there is no sheet behind it. */
  toggle?: boolean;
}) {
  /**
   * Ink, whatever it is set to (v2). The line used to grey out anything left at
   * its default, which made "Any budget" look disabled rather than open; the
   * icon in front of each one is what tells them apart now.
   */
  const colour = open ? colors.selectedFg : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={toggle ? { checked: !!on } : { expanded: !!open }}
      style={[styles.filterBtn, narrowed && !open && styles.filterNarrowed, open && styles.filterOpen]}
    >
      {icon ? <Icon name={icon} size={16} color={colour} strokeWidth={2.2} /> : null}
      <Text style={[styles.filterText, { color: colour, fontWeight: on ? '700' : '600' }]}>{label}</Text>
      {toggle ? null : <Icon name={open ? 'collapse' : 'expand'} size={12} color={colour} strokeWidth={2.6} />}
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  top: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, paddingHorizontal: GUTTER,
    paddingTop: TOP_INSET,
  },
  // The wordmark on its own still stands the row up to the height the box used
  // to give it, so the bar sits where it does on every other tab.
  topAlone: { minHeight: 40 },
  where: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12,
    borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surface, flexShrink: 1,
  },
  whereText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.ink, flexShrink: 1 },

  /**
   * The menu bar (v2). Edge to edge, which on a phone means no gutter at all -
   * every screen that draws it puts its own padding on the rows above and
   * below instead, so the bar is the only thing touching both sides.
   */
  bar: { marginTop: 20 },

  switchRow: { flexDirection: 'row' },
  switchCell: { flex: 1, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  switchOn: { backgroundColor: colors.selected },
  switchOff: { backgroundColor: colors.switchOff },
  switchText: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.6, lineHeight: 24, textAlign: 'center' },

  // The band, and the row of words centred on it. `flexGrow` is what centres a
  // short list and still lets a long one scroll from the left edge.
  band: { backgroundColor: colors.lime },
  strip: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 18, paddingHorizontal: 12 },
  stripItem: { paddingTop: 9, paddingBottom: 7 },
  stripText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 18 },
  stripTextOn: { fontWeight: '800', color: colors.selectedFg },
  stripTextOff: { fontWeight: '500', color: colors.onLimeMuted },

  subBand: { backgroundColor: colors.bandSub },
  subStrip: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 16, paddingHorizontal: 12 },
  subItem: { paddingTop: 8, paddingBottom: 6 },
  subText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17 },
  subTextOn: { fontWeight: '800', color: colors.ink },
  subTextOff: { fontWeight: '500', color: colors.inkMuted },
  // The band above is what the drawers slide out from, so what leaves the top
  // of this box has to be cut off rather than drawn over it - and the box
  // itself takes the band's colour, or the twelve pixels the row has not
  // reached yet flash cream.
  reveal: { overflow: 'hidden', backgroundColor: colors.bandSub },

  filters: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, paddingHorizontal: GUTTER, paddingTop: 12, minHeight: TARGET,
  },
  // The filters wrap rather than run under the count: three of them plus
  // "14 places" does not fit 390px on one line, and the count is the thing you
  // read to decide whether to change them.
  filterItems: { flexDirection: 'row', alignItems: 'center', gap: 16, rowGap: 8, flexShrink: 1, flexWrap: 'wrap' },
  /**
   * The chip's fill bleeds back out of its own padding (the handoff's
   * `padding:6px 8px; margin:-6px -8px`), so an open chip grows a lime block
   * around the words without the line above it moving.
   */
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 8, marginVertical: -6, marginHorizontal: -8 },
  filterOpen: { backgroundColor: colors.selected },
  // Narrowed but not open: the tint, so a filter cutting the list down still
  // says so without claiming to be the thing you have just tapped.
  filterNarrowed: { backgroundColor: colors.accentSoft },
  filterText: { fontFamily: fonts.body, fontSize: 13 },

  // The panel a chip opens. Two ink rules and the ground: it is a drawer pulled
  // out of the bar, not a card, so it takes the full width and has no shadow.
  panelScrim: { backgroundColor: colors.scrimSoft },
  panel: {
    position: 'absolute', left: 0, right: 0, backgroundColor: colors.bg, paddingBottom: 14,
    borderTopWidth: BORDER, borderBottomWidth: BORDER, borderColor: colors.line,
  },
  panelInner: { width: '100%', maxWidth: 1120, alignSelf: 'center' },
  kicker: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88,
    textTransform: 'uppercase', color: colors.inkMuted,
  },
  count: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, flexShrink: 0 },
});

export const HEADER = { top: HEADER_TOP, gutter: GUTTER };
