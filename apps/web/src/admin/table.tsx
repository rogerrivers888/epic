/**
 * The ladder — the one table every Places board draws.
 *
 * The design package's laws about figures, in one component so they cannot be
 * kept in one table and forgotten in the next:
 *
 *  · **A blank is never a zero.** An empty cell is an em dash in the blank
 *    colour. A source that was never asked says *not asked*; a source that was
 *    asked and found nothing says *no match*; a fact this kind of place is not
 *    judged on says *n/a*. Four different states, four different words.
 *  · **Numeric columns are right-aligned** so magnitudes line up; ticks and
 *    words are centred; header alignment always matches its own column.
 *  · **Every cell is a doorway.** A cell that represents a row of work opens the
 *    queue at its own address, so a piece of work is a link you can send.
 *  · **Shade is a hint, never the information** — every tinted cell prints its
 *    own number, and the tint is one lime at varying strength. No red-to-green.
 *  · **Every figure explains itself**: the tip lives on the column and the cell
 *    inherits it, so a column cannot ship with unexplained figures under it.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/press';
import { colors, spacing, type, BORDER } from '../theme';
import { Icon } from '../components/Icon';
import { Explain, type Tip, type TipKey } from './explain';

export type Align = 'left' | 'right' | 'centre';

export type Col<T> = {
  key: string;
  /** The header's own words. */
  label: string;
  /** The second line under a header — "30 days", "of those searches". */
  note?: string;
  /** What this column means. Inherited by every cell under it. */
  tip?: TipKey | Tip | null;
  width?: number;
  /** The one column that takes the slack. Exactly one per ladder, usually the first. */
  grow?: boolean;
  align?: Align;
  /** Sortable columns say so, and the sorted one says it is. */
  sort?: string;
  /**
   * A fact this kind of place is not judged on. The board greys the *header* as
   * well as the cells, so you can tell at a glance which columns count.
   */
  muted?: boolean;
  cell: (row: T, i: number) => React.ReactNode;
  /** A cell that explains only itself — a source that says "not asked". */
  cellTip?: (row: T) => TipKey | Tip | null;
  /**
   * A cell that holds something of its own to press — a tick box, a *Collect*
   * button, a chevron. It sits **outside** the row's own doorway rather than
   * inside it: a button inside a button is invalid, and the browser will not
   * deliver the inner press reliably. Only ever the first columns or the last.
   */
  stops?: boolean;
};

const alignOf = (a: Align | undefined) =>
  (a === 'right' ? 'flex-end' : a === 'centre' ? 'center' : 'flex-start');
const textAlign = (a: Align | undefined) => (a === 'right' ? 'right' : a === 'centre' ? 'center' : 'left');

export function Ladder<T>({
  columns, rows, keyOf, onRow, highlight, sort, desc, onSort, empty, dense = false, label, groupOf,
}: {
  columns: Col<T>[];
  rows: T[];
  keyOf: (row: T, i: number) => string;
  onRow?: (row: T) => void;
  /** The row the board is standing on — a lime tint, never a colour change. */
  highlight?: (row: T) => boolean;
  sort?: string | null;
  desc?: boolean;
  onSort?: (key: string) => void;
  empty?: React.ReactNode;
  dense?: boolean;
  /** What a screen reader calls the row's doorway. */
  label?: (row: T) => string;
  /** A heading row above a run of rows — "FAMILY · 9 SUBCATEGORIES". */
  groupOf?: (row: T, prev: T | null) => React.ReactNode;
}) {
  // The doorway is the middle of the row: everything between the leading cells
  // that hold their own control and the trailing ones that do.
  const first = columns.findIndex((c) => !c.stops);
  const last = columns.length - 1 - [...columns].reverse().findIndex((c) => !c.stops);
  const lead = first <= 0 ? [] : columns.slice(0, first);
  const middle = first < 0 ? columns : columns.slice(first, last + 1);
  const tail = first < 0 || last >= columns.length - 1 ? [] : columns.slice(last + 1);

  return (
    <View>
      <View style={styles.head}>
        {columns.map((c) => (
          <Explain key={c.key} tip={c.tip}
                   style={[cellStyle(c), { alignItems: alignOf(c.align), justifyContent: 'center' }]}>
            {c.sort && onSort ? (
              <Press effect="none" onPress={() => onSort(c.sort!)} accessibilityRole="button"
                     accessibilityLabel={`Sort by ${c.label}`}
                     style={[styles.headSort, { justifyContent: alignOf(c.align) }]}>
                <Text style={[styles.headLabel, c.muted && styles.headLabelMuted, sort === c.sort && styles.headLabelOn, { textAlign: textAlign(c.align) }]}>{c.label}</Text>
                {sort === c.sort ? <Icon name={desc ? 'expand' : 'collapse'} size={11} strokeWidth={2.6} color={colors.ink} /> : null}
              </Press>
            ) : (
              <Text style={[styles.headLabel, c.muted && styles.headLabelMuted, { textAlign: textAlign(c.align) }]}>{c.label}</Text>
            )}
            {c.note ? <Text style={[styles.headNote, { textAlign: textAlign(c.align) }]}>{c.note}</Text> : null}
          </Explain>
        ))}
      </View>

      {rows.length === 0 && empty ? <View style={styles.empty}>{empty}</View> : null}

      {rows.map((row, i) => {
        const group = groupOf?.(row, i ? rows[i - 1] : null);
        const draw = (c: Col<T>) => (
          // The cell inherits its column's explanation unless it carries one of
          // its own. This is the whole of law 2.
          <Explain key={c.key} tip={c.cellTip?.(row) ?? c.tip}
                   style={[cellStyle(c), { alignItems: alignOf(c.align), justifyContent: 'center' }]}
                   cursor={onRow && !c.stops ? 'pointer' : 'help'}>
            {c.cell(row, i)}
          </Explain>
        );
        const on = highlight?.(row);
        const style = [styles.row, dense && styles.rowDense, i === rows.length - 1 && styles.rowLast];
        // The tint is a wash behind the row rather than a fill on it, so it can
        // be the 7% the design sets without needing a colour of its own.
        const wash = on ? <View style={[StyleSheet.absoluteFill, styles.wash]} pointerEvents="none" /> : null;
        const body = onRow
          ? (
            <View style={style}>
              {wash}
              {lead.map(draw)}
              <Press effect="none" onPress={() => onRow(row)} accessibilityRole="button"
                     accessibilityLabel={label?.(row)} style={styles.doorway}>
                {middle.map(draw)}
              </Press>
              {tail.map(draw)}
            </View>
          )
          : <View style={style}>{wash}{columns.map(draw)}</View>;
        return (
          <React.Fragment key={keyOf(row, i)}>
            {group ? <View style={styles.group}>{group}</View> : null}
            {body}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const cellStyle = (c: Col<any>) => (c.grow ? { flex: 1, minWidth: 0 } : { width: c.width ?? 100 });

// ---------------------------------------------------------------------------
// what goes in a cell
// ---------------------------------------------------------------------------

/** A plain figure, right-aligned, tabular so columns of them line up. */
export const Num = ({ n, strong, accent }: { n: number | null | undefined; strong?: boolean; accent?: boolean }) =>
  (n == null
    ? <Blank />
    : <Text style={[styles.num, strong && styles.strong, accent && { color: colors.accent }]}>{n.toLocaleString()}</Text>);

/** A word, left or centred. */
export const Word = ({ children, strong, muted, accent }: { children: React.ReactNode; strong?: boolean; muted?: boolean; accent?: boolean }) => (
  <Text style={[styles.word, strong && styles.strong, muted && { color: colors.inkMuted }, accent && { color: colors.accent }]}>{children}</Text>
);

/**
 * A blank. **Never a zero** — an em dash in the blank colour, because "we hold
 * none" and "we hold nought" are different facts and a screen that prints 0 for
 * both makes the first invisible.
 */
export const Blank = () => <Text style={styles.blank}>—</Text>;

/** A source that was never asked. Different from one that was asked and found nothing. */
export const NotAsked = () => <Text style={styles.said}>not asked</Text>;
export const NoMatch = () => <Text style={styles.said}>no match</Text>;

/**
 * A fact this kind of place is not judged on.
 *
 * "Recorded is not the same as required. A playground holds a price but is not
 * judged on one." So it reads `n/a`, not a dash.
 */
export const Na = ({ tip }: { tip?: TipKey | Tip }) => (
  <Explain tip={tip ?? 'notCounted'}><Text style={styles.na}>n/a</Text></Explain>
);

/** Held, or not. A tick or a short dash, centred. */
export const Tick = ({ on }: { on: boolean }) =>
  (on ? <Icon name="check" size={15} strokeWidth={2.2} color={colors.ink} /> : <Text style={styles.blank}>–</Text>);

/**
 * A percentage, with the tint as a hint and the number as the information.
 *
 * The fill is one lime at a strength that follows the figure; the figure itself
 * is always printed at full contrast on top of it. There is no red-to-green ramp
 * anywhere in this system, and shade alone never carries a meaning.
 */
export function Pct({ v, strong, min = 44 }: { v: number | null | undefined; strong?: boolean; min?: number }) {
  if (v == null) return <Blank />;
  const alpha = 0.05 + Math.max(0, Math.min(100, v)) / 100 * 0.35;
  return (
    <View style={[styles.pct, { minWidth: min }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.selected, opacity: alpha }]} pointerEvents="none" />
      <Text style={[styles.num, strong && styles.strong]}>{v}%</Text>
    </View>
  );
}

/**
 * A score out of a hundred, tinted the same way a share is — but **printed as a
 * figure**, because the band above it prints 52 and a column that printed 52%
 * would be a second meaning for the same number (Codex, 17 Sep 2026).
 */
export function ScoreCell({ v, strong }: { v: number | null | undefined; strong?: boolean }) {
  if (v == null) return <Blank />;
  const alpha = 0.05 + Math.max(0, Math.min(100, v)) / 100 * 0.35;
  return (
    <View style={[styles.pct, { minWidth: 40 }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.selected, opacity: alpha }]} pointerEvents="none" />
      <Text style={[styles.num, strong && styles.strong]}>{v}</Text>
    </View>
  );
}

/** A bar that is a share of a whole, drawn the way BO4a draws its three faults. */
export function Bar({ parts, height = 16 }: { parts: { key: string; share: number; alpha: number }[]; height?: number }) {
  return (
    <View style={[styles.bar, { height }]}>
      {parts.map((p) => (
        <View key={p.key} style={{ flex: Math.max(0, p.share), backgroundColor: colors.selected, opacity: p.alpha }} />
      ))}
      <View style={{ flex: Math.max(0, 1 - parts.reduce((n, p) => n + p.share, 0)), backgroundColor: colors.lineSoft }} />
    </View>
  );
}

/** A progress rule under a run's state. */
export const Progress = ({ of, height = 4 }: { of: number; height?: number }) => (
  <View style={{ height, backgroundColor: colors.lineSoft }}>
    <View style={{ width: `${Math.round(Math.max(0, Math.min(1, of)) * 100)}%`, height, backgroundColor: colors.selected }} />
  </View>
);

/** The lime-outline button that fills on hover — the primary action on these boards. */
export function Act({ label, icon, onPress, tone = 'primary', small, disabled }: {
  label: string; icon?: any; onPress: () => void; tone?: 'primary' | 'secondary' | 'solid'; small?: boolean; disabled?: boolean;
}) {
  return (
    <Press effect="none" onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
           style={({ hovered }: any) => [
             styles.act, small && styles.actSmall,
             tone === 'secondary' ? styles.actSecondary : tone === 'solid' ? styles.actSolid : styles.actPrimary,
             hovered && !disabled && (tone === 'secondary' ? styles.actSecondaryOn : styles.actOn),
             disabled && { opacity: 0.4 },
           ]}>
      {({ hovered }: any) => (
        <>
          {icon ? <Icon name={icon} size={13} strokeWidth={2}
                        color={tone === 'solid' || hovered ? colors.selectedFg : tone === 'secondary' ? colors.ink : colors.accent} /> : null}
          <Text style={[
            styles.actLabel, small && { fontSize: 11.5 },
            tone === 'solid' ? { color: colors.selectedFg } : tone === 'secondary' ? { color: colors.ink } : { color: colors.accent },
            hovered && !disabled && tone !== 'secondary' && { color: colors.selectedFg },
          ]}>{label}</Text>
        </>
      )}
    </Press>
  );
}

/** The footer every board ends in: a rule, then the actions on the right. */
export const Footer = ({ children, left }: { children: React.ReactNode; left?: React.ReactNode }) => (
  <View style={styles.footer}>
    {left ? <View style={{ flex: 1, minWidth: 0 }}>{left}</View> : <View style={{ flex: 1 }} />}
    <View style={styles.footerActs}>{children}</View>
  </View>
);

/** The uppercase label over a block. A label, never a sentence. */
export const Kicker = ({ children, accent }: { children: React.ReactNode; accent?: boolean }) => (
  <Text style={[styles.kicker, accent && { color: colors.accent }]}>{children}</Text>
);

/** One of the five numbers at the top of every level. */
export function Stat({ label, value, tip, accent, big, mark = false }: {
  label: string; value: React.ReactNode; tip?: TipKey | Tip | null; accent?: boolean; big?: boolean;
  /**
   * The little info circle. The boards draw it on the figures whose definition
   * is genuinely arguable — ready, the average score, the three faults — and
   * leave it off the ones a word already explains. Every stat still explains
   * itself on hover either way.
   */
  mark?: boolean;
}) {
  return (
    <Explain tip={tip} style={{ gap: 2 }}>
      <View style={styles.statLabelRow}>
        <Text style={[styles.kicker, accent && { color: colors.accent }]}>{label}</Text>
        {tip && mark ? <Icon name="info" size={11} strokeWidth={2.2} color={colors.inkMuted} /> : null}
      </View>
      <Text style={[styles.statValue, big && { fontSize: 30 }, accent && { color: colors.accent }]}>{value}</Text>
    </Explain>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md,
    paddingBottom: 9, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted,
  },
  headSort: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headLabel: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.inkMuted },
  headLabelOn: { color: colors.ink, fontWeight: '700' },
  headLabelMuted: { color: colors.decor },
  headNote: { ...type.tiny, fontSize: 10.5, color: colors.inkMuted },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  rowDense: { paddingVertical: 9 },
  /** The pressable middle of a row: it grows, and it carries the row's own gap. */
  doorway: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowLast: { borderBottomWidth: 0 },
  // The design's token table: "Lime tints — / 0.07 row highlight". `surfaceMuted`
  // is the *panel* tint and is four times that, which turned a board of empty
  // subcategories into a green page (Codex, 17 Sep 2026).
  rowOn: { backgroundColor: 'transparent' },
  wash: { backgroundColor: colors.selected, opacity: 0.07 },
  group: { paddingTop: 6 },
  empty: { paddingVertical: spacing.lg },

  num: { ...type.body, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'], textAlign: 'right' },
  word: { ...type.body, fontSize: 13.5, color: colors.ink },
  strong: { fontWeight: '700' },
  blank: { ...type.body, fontSize: 14, color: colors.decor },
  said: { ...type.small, fontSize: 12.5, color: colors.inkMuted },
  na: { ...type.tiny, fontSize: 11, color: colors.decor },

  pct: { paddingHorizontal: 9, paddingVertical: 5, alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' },
  bar: { flexDirection: 'row', width: '100%', overflow: 'hidden' },

  act: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1 },
  actSmall: { paddingHorizontal: 11, paddingVertical: 5 },
  actPrimary: { borderColor: colors.accent },
  actSecondary: { borderColor: colors.ruleMuted },
  actSolid: { borderColor: colors.selected, backgroundColor: colors.selected },
  actOn: { backgroundColor: colors.selected, borderColor: colors.selected },
  actSecondaryOn: { backgroundColor: colors.surfaceMuted, borderColor: colors.ink },
  actLabel: { ...type.small, fontSize: 12.5, fontWeight: '700' },

  footer: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xl,
    borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: 15, marginTop: 'auto',
  },
  footerActs: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },

  kicker: { ...type.tiny, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.inkMuted },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statValue: { ...type.title, fontSize: 22, fontWeight: '800', letterSpacing: -0.44, color: colors.ink, fontVariant: ['tabular-nums'] },
});
