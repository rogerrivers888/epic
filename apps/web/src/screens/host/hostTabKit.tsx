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

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** The session dates a series runs on — computed by the server (publicOffer.dates), never re-derived here. */
const seriesDatesOf = (offer: OwnOffer): string[] => (Array.isArray(offer.dates) ? offer.dates : []);

/** The calendar date one of this offer's bookings sits on. */
export const dateOf = (offer: OwnOffer, occ: string | null): string | null =>
  offer.shape === 'oneoff' ? offer.startsOn
    : offer.shape === 'series' ? (occ && occ !== 'whole' ? occ.slice(0, 10) : offer.firstDate)
      : occ ? occ.slice(0, 10) : null;

export type DateGroup = { on: string | null; heads: number; bookings: number; pence: number };

/**
 * This offer's place-holding bookings, folded by the date they run on. A
 * waitlisted request holds no place and earns nothing, so it is outside the
 * fold entirely — otherwise an over-capacity waitlist inflates the booked
 * count, the guests and the money (Codex; /host/money keeps the same rule).
 * A whole-series booking sits on EVERY remaining session, exactly as the
 * server holds it active through the run, so it stays in Upcoming after the
 * first session rather than vanishing (Codex).
 */
export function offerDateGroups(offer: OwnOffer): DateGroup[] {
  const live = offer.bookings.filter((b) => b.state !== 'cancelled' && b.state !== 'waitlisted');
  const by = new Map<string, DateGroup>();
  const fold = (on: string | null, b: OwnOffer['bookings'][number], countMoney: boolean) => {
    const key = on ?? 'tbd';
    const g = by.get(key) ?? { on, heads: 0, bookings: 0, pence: 0 };
    g.heads += b.heads;
    g.bookings += 1;
    // A whole-run booking's money is one sum for the run; count it once (on the
    // first session) rather than once per session.
    if (countMoney) g.pence += b.paymentStatus !== 'refunded' ? b.amountPence : 0;
    by.set(key, g);
  };
  for (const b of live) {
    if (offer.shape === 'series' && b.occurrence === 'whole') {
      const dates = seriesDatesOf(offer);
      if (dates.length) { dates.forEach((on, i) => fold(on, b, i === 0)); continue; }
    }
    fold(dateOf(offer, b.occurrence), b, true);
  }
  return [...by.values()].sort((a, z) => (a.on ?? '').localeCompare(z.on ?? ''));
}

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
export function Section({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={kit.section}>
      <Text style={kit.sectionText}>{title}</Text>
      {right ?? null}
    </View>
  );
}

/** An 11px kicker over a group. */
export function Kicker({ children }: { children: React.ReactNode }) {
  return <Text style={kit.kicker}>{children}</Text>;
}

/** Equal summary cells with a 26px number and a label (SX15 Dates·Booked·Collected). */
export function SummaryCells({ cells }: { cells: { n: string; label: string }[] }) {
  return (
    <View style={kit.cells}>
      {cells.map((c, i) => (
        <View key={i} style={kit.cell}>
          <Text style={kit.cellN} numberOfLines={1}>{c.n}</Text>
          <Text style={kit.cellLabel} numberOfLines={1}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** A 2×2 grid of labelled numbers (SX12, SX13b all-time). */
export function Grid2({ cells }: { cells: { n: string; label: string }[] }) {
  return (
    <View style={kit.grid}>
      {cells.map((c, i) => (
        <View key={i} style={kit.gridCell}>
          <Text style={kit.gridN} numberOfLines={1}>{c.n}</Text>
          <Text style={kit.cellLabel} numberOfLines={1}>{c.label}</Text>
        </View>
      ))}
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
  cells: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, backgroundColor: colors.surfaceMuted, paddingVertical: 12, paddingHorizontal: 10, minWidth: 0 },
  cellN: { fontFamily: fonts.heading, fontSize: 26, fontWeight: '800', letterSpacing: -0.6, color: colors.ink, lineHeight: 30 },
  cellLabel: { fontFamily: fonts.body, fontSize: 11.5, fontWeight: '600', color: colors.inkMuted, lineHeight: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridCell: { width: '48%' as any, flexGrow: 1, backgroundColor: colors.surfaceMuted, paddingVertical: 14, paddingHorizontal: 12, minWidth: 0 },
  gridN: { fontFamily: fonts.heading, fontSize: 28, fontWeight: '800', letterSpacing: -0.7, color: colors.ink, lineHeight: 32 },
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
