/**
 * The Host tab's own small pieces (Settings revised v2 · Lane 3, SX7–SX21).
 *
 * The four tabs and everything below them share a handful of shapes — summary
 * cells, a 2×2 grid, a ruled section head, a value row, a date row with its
 * fill bar, the fee line. They live here once so the Upcoming, Stats, Money,
 * Profile and one-activity screens cannot drift apart, and so every size comes
 * from the design tokens (README · Design tokens) rather than a hex in a screen.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon, IconName } from '../../components/Icon';
import { colors, fonts, BORDER, LIME, INK } from '../../theme';
import type { HostFeeLine, OwnOffer } from '../../api';

export { todayIso, dateOf, offerDateGroups } from './hostDates';
export type { DateGroup } from './hostDates';

/** £1,234.50 — and £0, never "Free", because a takings figure of nothing is still a number. */
export const gbp = (pence: number | null | undefined) =>
  pence == null ? '—' : `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: pence % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

/** A 46px date column: weekday kicker, 26px day, month (SX15/SX13b). */
export function DateCol({ iso }: { iso: string }) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return (
    <View style={kit.dateCol}>
      <Text style={kit.dateKicker}>{d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}</Text>
      <Text style={kit.dateDay}>{d.getDate()}</Text>
      <Text style={kit.dateMonth}>{d.toLocaleDateString('en-GB', { month: 'short' })}</Text>
    </View>
  );
}

/** A section head: 19px/800 on a 2px ink rule. */
export function Section({ title, right, flush }: { title: string; right?: React.ReactNode; flush?: boolean }) {
  // `flush`: a table's own header sits straight under the rule (SX12, SX13b).
  return (
    <View style={[kit.section, flush && { marginBottom: 0 }]}>
      <Text style={kit.sectionText}>{title}</Text>
      {right ?? null}
    </View>
  );
}

/** An 11px kicker over a group. */
export function Kicker({ children }: { children: React.ReactNode }) {
  return <Text style={kit.kicker}>{children}</Text>;
}

/**
 * Equal summary cells (SX15 Dates · Booked · Collected), measured from the
 * prototype: no fill — an 11px kicker over a 26px/800 number, 4px apart, each
 * cell ruled 1px underneath and every cell after the first ruled 1px on its
 * left, padded 14 / 10 / 16 with 12px inside that rule.
 */
export function SummaryCells({ cells }: { cells: { n: string; label: string }[] }) {
  return (
    <View style={kit.cells}>
      {cells.map((c, i) => (
        <View key={i} style={[kit.cell, i > 0 && kit.cellNext]}>
          <Text style={kit.kicker} numberOfLines={1}>{c.label}</Text>
          <Text style={kit.cellN} numberOfLines={1}>{c.n}</Text>
        </View>
      ))}
    </View>
  );
}

/** A 2×2 grid of labelled numbers (SX12, SX13b all-time): the same cells at 30px, two to a row. */
export function Grid2({ cells }: { cells: { n: string; label: string }[] }) {
  return (
    <View style={kit.grid}>
      {cells.map((c, i) => (
        <View key={i} style={[kit.gridCell, i % 2 === 1 && kit.gridCellRight]}>
          <Text style={kit.kicker} numberOfLines={1}>{c.label}</Text>
          <Text style={kit.gridN} numberOfLines={1}>{c.n}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A table of equal, left-aligned columns (SX12 By activity, SX13b Past dates):
 * an 11px kicker header over a 1px rule, then 14px rows 12px tall-padded, each
 * on its own 1px rule. The first column is bold; a row that opens something
 * ends its last cell with a faint chevron.
 */
export function EqualTable({ head, rows, size = 14, firstWeight = '700' }: {
  head: string[];
  rows: { key: string; cells: React.ReactNode[]; onPress?: () => void }[];
  size?: number;
  /** SX12's activity names are 700; SX13b's dates are 600. */
  firstWeight?: '600' | '700';
}) {
  return (
    <View>
      <View style={kit.tHead}>
        {head.map((h, i) => <Text key={i} style={[kit.kicker, kit.tCol]} numberOfLines={1}>{h}</Text>)}
      </View>
      {rows.map((r) => {
        const body = (
          <View style={kit.tRow}>
            {r.cells.map((c, i) => {
              const last = i === r.cells.length - 1;
              const text = <Text style={[kit.tCell, { fontSize: size }, i === 0 && [kit.tFirst, { fontWeight: firstWeight }]]}>{c}</Text>;
              return last && r.onPress
                ? <View key={i} style={[kit.tCol, kit.tLast]}>{text}<Icon name="more" size={14} color={colors.inkFaint} strokeWidth={2} /></View>
                : <View key={i} style={kit.tCol}>{text}</View>;
            })}
          </View>
        );
        return r.onPress ? <Press key={r.key} onPress={r.onPress} accessibilityRole="button">{body}</Press> : <View key={r.key}>{body}</View>;
      })}
    </View>
  );
}

/** A row that opens a screen: 16/600 title, a 13px muted value, a chevron. */
export function NavRow({ label, value, onPress, icon, right }: { label: string; value?: string | null; onPress?: () => void; icon?: IconName; right?: React.ReactNode }) {
  const body = (
    <View style={kit.row}>
      {icon ? <View style={kit.rowTile}><Icon name={icon} size={18} color={colors.ink} strokeWidth={2} /></View> : null}
      <Text style={kit.rowLabel} numberOfLines={1}>{label}</Text>
      {value != null ? <Text style={kit.rowValue} numberOfLines={1}>{value}</Text> : null}
      {right ?? (onPress ? <Icon name="more" size={18} color={colors.inkFaint} /> : null)}
    </View>
  );
  return onPress ? <Press onPress={onPress} accessibilityRole="button">{body}</Press> : body;
}

/** A plain two-column money line (SX13b, SX18 detail): a label and a value. */
export function MoneyLine({ label, value, strong }: { label: React.ReactNode; value: string; strong?: boolean }) {
  return (
    <View style={kit.moneyLine}>
      <Text style={[kit.moneyLabel, strong && kit.moneyStrong]} numberOfLines={2}>{label}</Text>
      <Text style={[kit.moneyValue, strong && kit.moneyStrong]}>{value}</Text>
    </View>
  );
}

/** "Epic's fee 15% · Checked" — the engine's own label, one line per rate. */
export function FeeLine({ line }: { line: Pick<HostFeeLine, 'label'> }) {
  return <Text style={kit.fee}>{line.label}</Text>;
}

/** An 8px fill bar: booked ÷ max, a 2px ink tick at the minimum (SX15). */
export function FillBar({ value, max, min, below }: { value: number; max: number | null; min: number | null; below?: boolean }) {
  const ceiling = Math.max(1, max ?? Math.max(value, min ?? 0, 1));
  const pct = (n: number) => `${Math.min(100, Math.round((n / ceiling) * 100))}%` as any;
  return (
    <View style={kit.bar}>
      <View style={[kit.barFill, { width: pct(value) }, below && kit.barFillLow]} />
      {min ? <View style={[kit.barTick, { left: pct(min) }]} /> : null}
    </View>
  );
}

export const kit = StyleSheet.create({
  dateCol: { width: 46, alignItems: 'flex-start' },
  dateKicker: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.inkMuted, lineHeight: 13 },
  dateDay: { fontFamily: fonts.heading, fontSize: 26, fontWeight: '800', letterSpacing: -0.5, color: colors.ink, lineHeight: 28 },
  dateMonth: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, lineHeight: 14 },
  section: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 24, marginBottom: 12, borderBottomWidth: BORDER, borderBottomColor: colors.line, paddingBottom: 6 },
  sectionText: { fontFamily: fonts.heading, fontSize: 19, fontWeight: '800', letterSpacing: -0.38, color: colors.ink },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.88, textTransform: 'uppercase', color: colors.inkMuted },
  cells: { flexDirection: 'row', marginTop: 6 },
  cell: { flex: 1, minWidth: 0, gap: 4, paddingTop: 14, paddingRight: 10, paddingBottom: 16, paddingLeft: 0, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  cellNext: { paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: colors.ruleSoft },
  cellN: { fontFamily: fonts.heading, fontSize: 26, fontWeight: '800', letterSpacing: -0.78, color: colors.ink, lineHeight: 26 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  gridCell: { width: '50%' as any, minWidth: 0, gap: 4, paddingTop: 14, paddingRight: 14, paddingBottom: 16, paddingLeft: 0, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  gridCellRight: { paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: colors.ruleSoft },
  gridN: { fontFamily: fonts.heading, fontSize: 30, fontWeight: '800', letterSpacing: -0.9, color: colors.ink, lineHeight: 30 },
  // equal-column tables (SX12, SX13b)
  tHead: { flexDirection: 'row', gap: 10, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  tRow: { flexDirection: 'row', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft, alignItems: 'baseline' },
  tCol: { flex: 1, minWidth: 0 },
  tLast: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  tCell: { fontFamily: fonts.body, color: colors.ink, textAlign: 'left' },
  tFirst: { lineHeight: 17.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  rowTile: { width: 40, height: 40, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowLabel: { flex: 1, fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  rowValue: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, maxWidth: '45%' as any, textAlign: 'right' },
  moneyLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingVertical: 5 },
  moneyLabel: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted, lineHeight: 19 },
  moneyValue: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.ink },
  moneyStrong: { color: colors.ink, fontWeight: '800' },
  fee: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted, lineHeight: 17 },
  bar: { height: 8, backgroundColor: colors.lineSoft, position: 'relative', overflow: 'visible' },
  barFill: { height: 8, backgroundColor: colors.ink },
  barFillLow: { backgroundColor: colors.ruleMuted },
  barTick: { position: 'absolute', top: -2, width: 2, height: 12, backgroundColor: colors.ink },
});
