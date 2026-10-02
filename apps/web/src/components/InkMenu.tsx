import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { LIME, INK, CREAM, TAB_UNSELECTED, fonts } from '../theme';

/**
 * The ink menu (New navigation, owner 30 Sep 2026, §5): the one treatment for
 * every set of sibling views — a trip's Activities · Food · Stays · Shortlist,
 * Inspire's Activities · Food & drink, a place's Overview · Reviews · Visit, an
 * offer's Bookings · Questions. It replaces the old lime switch cells and the
 * lime category strip; there is never a second menu on a screen.
 *
 * It sits flush under the band, edge to edge, with no margins and no gap. The
 * bar is ink in either mode; a bold grey label reads as disabled, so unselected
 * tabs are regular-weight grey and *bold* is what says "you are here" (rule 5c).
 *
 * `selected == null` is the "nothing selected" state (a trip on arrival, 6a):
 * every cell is cream at one weight with no marker, so all options read as
 * equal. Tapping the selected tab again is the caller's job — pass `null` back.
 *
 * No rule between the cells (owner, 2 Oct 2026): the README's 1px × 20px
 * divider is dropped to match the Settings revised v2 menus, which draw none.
 */
export type InkTab<T extends string> = { key: T; label: string; count?: number };

export function InkMenu<T extends string>({ tabs, selected, onSelect, flyToKey }: {
  tabs: InkTab<T>[];
  selected: T | null;
  onSelect: (key: T) => void;
  /** The tab a flown heart lands on (the trip's Shortlist): its cell carries the
   *  `[data-fly-to]` marker `flyHeart` reaches for, so hearting a card in the
   *  drawer still flies to it now the old feed Shortlist button is gone. */
  flyToKey?: T;
}) {
  // §5: 2 tabs at 16px, 3–4 tabs at 15px.
  const fs = tabs.length <= 2 ? 16 : 15;
  const nothing = selected == null;
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = !nothing && t.key === selected;
        // A count shows only while a tab is not the selected one — "Shortlist · 5"
        // — and drops when selected, because the bold label needs the room and the
        // drawer header already carries it (§5, Counts).
        const label = t.count != null && !on ? `${t.label} · ${t.count}` : t.label;
        return (
          <Press
            key={t.key}
            onPress={() => onSelect(t.key)}
            style={[styles.cell, nothing ? styles.cellFlat : (on ? styles.cellOn : styles.cellOff)]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { fontSize: fs, letterSpacing: fs * (on && tabs.length <= 2 ? -0.02 : -0.01) },
                nothing ? styles.labelFlat : (on ? styles.labelOn : styles.labelOff),
              ]}
            >
              {label}
            </Text>
            {t.key === flyToKey ? <View {...({ dataSet: { flyTo: '1' } } as object)} pointerEvents="none" style={styles.flyMark} /> : null}
          </Press>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: INK, width: '100%' },
  // §5: flex 1, centred, 15 above, 12 below, a 4px transparent marker line.
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, paddingTop: 15, paddingBottom: 12, borderBottomWidth: 4, borderBottomColor: 'transparent' },
  cellOn: { borderBottomColor: LIME },
  cellOff: {},
  // Nothing selected: no marker at all, so the bottom pad takes the 4px back.
  cellFlat: { paddingBottom: 15, borderBottomWidth: 0 },
  // A zero-size marker centred in the cell for the heart-fly to land on.
  flyMark: { position: 'absolute', top: '50%', left: '50%', width: 1, height: 1 },
  label: { fontFamily: fonts.heading, textAlign: 'center' },
  labelOn: { fontWeight: '800', color: CREAM },
  labelOff: { fontWeight: '500', color: TAB_UNSELECTED },
  labelFlat: { fontWeight: '600', color: CREAM },
});
