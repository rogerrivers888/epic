/**
 * The reporting suite's own pieces.
 *
 * **Why these are not the admin kit's.** The kit deliberately has no boxes —
 * the owner, 12 Sep 2026, on the first Categories screen: "I hate this design,
 * hate it: these big white boxes." That complaint was about bordered cards on
 * cream, and the kit's answer was right: a section is a heading over a rule.
 *
 * The reporting design (handoff, 20 Sep 2026) draws bordered tiles and panels,
 * and it is signed off. The two are reconcilable because the design is a **dark
 * canvas**: its surface is one shade off the ground and its border is a
 * hairline, so a "tile" reads as a faint separation rather than a white box.
 * Every colour here comes from `theme.ts` rather than the design's own hexes
 * (CLAUDE.md), which is also what makes the back office's light mode work —
 * there the same components draw as cream on cream with a hairline, which is
 * the kit's grammar rather than the thing he hated.
 *
 * Nothing here reads the window. Width comes from `useViewport()`, so the whole
 * suite works inside the shell's 390px phone frame.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon, IconName } from '../../components/Icon';
import { BORDER, colors, spacing, type } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { Explain } from '../explain';
import type { TipKey } from '../tips';
import type { Row } from './model';

/** The breakpoint the suite's tables and two-up charts fold at. */
export const WIDE = 1000;

/**
 * A text input with no focus ring.
 *
 * `outlineStyle` is a web property and is not in React Native's `TextStyle`,
 * so it cannot sit in a `StyleSheet.create` — the checker rejects the whole
 * sheet. Spelled once here and applied at the element, which is the only place
 * it does anything anyway. The suite's inputs are a rule underneath rather than
 * a box round, and the rule turning lime is the focus signal.
 */
export const NO_OUTLINE = { outlineStyle: 'none' } as any;

// ---------------------------------------------------------------------------
// a gap, said out loud
// ---------------------------------------------------------------------------

/**
 * A figure that is not there, and why.
 *
 * The seventh non-negotiable: "Gaps say what they are. 'No payment provider',
 * not '£0'." So a missing figure is this and never a zero — a zero is a
 * measurement, and reading one where nothing was measured is the single most
 * expensive mistake a reporting screen can cause.
 */
export function Gap({ says, small, width }: { says: string | null | undefined; small?: boolean; width?: number }) {
  return (
    <Text
      // Bounded where it sits in a row, so a long reason wraps to a second line
      // instead of running off the panel's right edge — which is what "Turn
      // mock data off to change anything" did in a 96px value column (20 Sep
      // 2026, opening the screen).
      style={[small ? styles.gapSmall : styles.gap, width ? { width, flexShrink: 0 } : null]}
      numberOfLines={3}
    >
      {says || 'Not measured'}
    </Text>
  );
}

/** A figure, or the reason there isn't one. */
export function Figure({ value, gap, style }: { value: string | null | undefined; gap?: string | null; style?: any }) {
  if (value == null) return <Gap says={gap} small />;
  return <Text style={style}>{value}</Text>;
}

// ---------------------------------------------------------------------------
// the header controls
// ---------------------------------------------------------------------------

/**
 * A segmented control — the design's, which is smaller and tighter than the
 * kit's full-width one because these sit in a header beside three others.
 */
export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <View style={styles.seg} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Press
            key={o.value}
            effect="none"
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segItem, on && styles.segItemOn]}
          >
            <Text numberOfLines={1} style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/**
 * The period dropdown.
 *
 * Its own control rather than the kit's `Dropdown` because it is the one thing
 * on every screen of the suite and the design fixes its width at 176px: the
 * five options are all a different length, and a control that changes width when
 * you change the period moves everything beside it.
 */
export function PeriodPicker({ value, options, onChange }: {
  value: string;
  options: { key: string; label: string }[];
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const now = options.find((o) => o.key === value) ?? options[1] ?? options[0];
  return (
    <View style={styles.pickerWrap}>
      <Press
        effect="none"
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Period — ${now?.label ?? ''}`}
        style={styles.picker}
      >
        <Text style={styles.pickerText} numberOfLines={1}>{now?.label ?? 'This month'}</Text>
        <Icon name={open ? 'collapse' : 'expand'} size={13} color={colors.inkMuted} />
      </Press>
      {open ? (
        <View style={styles.pickerPanel}>
          {options.map((o) => {
            const on = o.key === value;
            return (
              <Press
                key={o.key}
                effect="none"
                onPress={() => { onChange(o.key); setOpen(false); }}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: on }}
                style={[styles.pickerOption, on && styles.pickerOptionOn]}
              >
                <Text style={[styles.pickerOptionText, on && styles.pickerOptionTextOn]}>{o.label}</Text>
              </Press>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The header of a suite screen: an optional crumb, the name, and the controls.
 *
 * Sticky in the design; here it simply sits at the top of the page, because the
 * back office scrolls its content and a position: sticky inside a React Native
 * ScrollView is not a thing the other screens do either.
 */
export function SuiteHead({ crumb, onCrumb, title, kicker, right }: {
  crumb?: string | null;
  onCrumb?: () => void;
  title: string;
  kicker?: string | null;
  right?: React.ReactNode;
}) {
  const { width } = useViewport();
  return (
    <View style={[styles.head, width < WIDE && styles.headNarrow]}>
      <View style={{ flexGrow: 1, flexBasis: 220, minWidth: 0, gap: 3 }}>
        {crumb ? (
          <Press effect="none" onPress={onCrumb} accessibilityRole="link" style={styles.crumb}>
            <Icon name="back" size={14} color={colors.inkMuted} />
            <Text style={styles.crumbText}>{crumb}</Text>
          </Press>
        ) : null}
        {kicker ? <Text style={styles.kickerLime}>{kicker}</Text> : null}
        <Text style={[styles.title, width < 900 && styles.titlePhone]} numberOfLines={2}>{title}</Text>
      </View>
      {/*
        Below 900 the controls are a row of their own across the whole frame
        rather than a row beside the title.
        On a 390px frame there are four of them — two segmented switches, the
        source switch and the 176px period dropdown — and `flexWrap` on a row
        that also holds a 220px title left the period picker off the right edge
        and unreachable (epic-59's visual pass, 20 Sep 2026). Nothing is allowed
        to overflow the frame horizontally (CLAUDE.md).
      */}
      {right ? <View style={[styles.headRight, width < 900 && styles.headRightOwnRow]}>{right}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// the measure tile
// ---------------------------------------------------------------------------

/**
 * A sparkline: twelve bars, 34px tall, the last one lime when the tile is on.
 *
 * Bars rather than a curve everywhere in this suite — the design's charts
 * section says so in as many words, and a curve between twelve monthly totals
 * implies values between the months that were never measured.
 */
export function Spark({ values, selected, height = 34 }: { values: number[] | null | undefined; selected?: boolean; height?: number }) {
  if (!values || !values.length) return <View style={{ height }} />;
  /**
   * The series' own maximum, and only a fallback when it is nought.
   *
   * `Math.max(…values, 1)` looked like a divide-by-zero guard and was a bug:
   * every per-household series is below 1 — 0.05 events hosted a month — so a
   * floor of 1 drew all twelve bars at the 2px minimum and the sparkline said
   * nothing at all (seen on Behaviour, 20 Sep 2026).
   */
  const peak = Math.max(...values);
  // Nothing has happened, so there is nothing to draw. A row of 2px stubs reads
  // as a chart that failed rather than as a measure at nought.
  if (peak <= 0) return <View style={{ height }} />;
  const max = peak;
  return (
    <View style={[styles.spark, { height }]}>
      {values.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: Math.max(2, Math.round((v / max) * height)),
            backgroundColor: i === values.length - 1 && selected ? colors.lime : colors.ruleMuted,
          }}
        />
      ))}
    </View>
  );
}

/**
 * One measure: a kicker, a big figure, a change and its supporting text, a
 * sparkline, and — on Money — a margin footer.
 *
 * The change is lime and the supporting text is grey, deliberately in that
 * order: the change is what somebody is looking for and the sentence is what
 * tells them what it is a change in.
 */
export function MeasureTile({ label, value, gap, delta, deltaDown, sub, series, selected, onPress, footLabel, foot }: {
  label: string;
  value: string | null;
  gap?: string | null;
  delta?: string | null;
  deltaDown?: boolean;
  sub?: string | null;
  series?: number[] | null;
  selected?: boolean;
  onPress?: () => void;
  footLabel?: string | null;
  foot?: string | null;
}) {
  const body = (
    <View style={[styles.tile, selected && styles.tileOn]}>
      <Text style={[styles.tileKicker, selected && { color: colors.accent }]}>{label.toUpperCase()}</Text>
      {value == null
        ? <View style={{ paddingVertical: 6 }}><Gap says={gap} /></View>
        : <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>}
      {delta || sub ? (
        <View style={styles.tileMeta}>
          {delta ? <Text style={[styles.tileDelta, deltaDown && styles.tileDeltaDown]}>{delta}</Text> : null}
          {sub ? <Text style={styles.tileSub} numberOfLines={2}>{sub}</Text> : null}
        </View>
      ) : null}
      <Spark values={series} selected={selected} />
      {footLabel ? (
        <View style={styles.tileFoot}>
          <Text style={styles.tileFootLabel}>{footLabel}</Text>
          <Text style={styles.tileFootValue}>{foot ?? '—'}</Text>
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return <View style={styles.tileSlot}>{body}</View>;
  return (
    <Press
      effect="none"
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      style={styles.tileSlot}
    >
      {body}
    </Press>
  );
}

/** The auto-fitting row the tiles live in: two look right and six do too. */
export function TileGrid({ children, min = 210 }: { children: React.ReactNode; min?: number }) {
  return <View style={[styles.tileGrid, { ['--suite-tile-min' as any]: `${min}px` }]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// the breakdown band
// ---------------------------------------------------------------------------

/**
 * The band under the tiles: a 2px lime rule, the measure's own name in lime,
 * and "Open the chart" on the right.
 *
 * The heading reads only the measure name because the tiles above it are what
 * says which one is selected — a second sentence explaining the selection is
 * the prose the owner has asked twice not to be given (feedback, "no prose on
 * a UI").
 */
export function Band({ title, tip, onOpenChart, chartLabel = 'Open the chart', right, children }: {
  title: string;
  tip?: TipKey;
  onOpenChart?: () => void;
  chartLabel?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const heading = <Text style={styles.bandTitle}>{title.toUpperCase()}</Text>;
  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.band}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {tip ? <Explain tip={tip} cursor="help">{heading}</Explain> : heading}
        </View>
        {right}
        {onOpenChart ? (
          <Press effect="none" onPress={onOpenChart} accessibilityRole="link" style={styles.bandAction}>
            <Text style={styles.bandActionText}>{chartLabel}</Text>
          </Press>
        ) : null}
      </View>
      <View style={styles.panels}>{children}</View>
    </View>
  );
}

/** One panel inside a band. */
export function SuitePanel({ title, children, note, grow = 1 }: {
  title: string;
  children: React.ReactNode;
  note?: string | null;
  grow?: number;
}) {
  return (
    <View style={[styles.panel, { flexGrow: grow }]}>
      <Text style={styles.panelTitle}>{title.toUpperCase()}</Text>
      <View>{children}</View>
      {note ? <Text style={styles.panelNote}>{note}</Text> : null}
    </View>
  );
}

/**
 * A key and a figure, on a hairline.
 *
 * `strong` is the last row of a panel — the total — which gets the 2px rule and
 * a 17px figure; `lime` is a figure that is the point of the panel.
 */
export function Kv({ label, value, gap, strong, lime, last, onPress, action, wide }: {
  label: string;
  value: string | null;
  gap?: string | null;
  strong?: boolean;
  lime?: boolean;
  last?: boolean;
  onPress?: () => void;
  action?: string;
  /**
   * A 190px value column instead of 96.
   *
   * The supplier record's values are sentences rather than figures — a used-by
   * list, a masked credential, an allowance — and the handoff fixes the column
   * at 190px for exactly that reason: "long values must not wrap to a second
   * line", because a wrapped value pushes every figure below it out of line.
   */
  wide?: boolean;
}) {
  const inner = (
    <View style={[styles.row, strong && styles.rowStrong, last && styles.rowLast]}>
      <Text style={[styles.rowLabel, strong && styles.rowLabelStrong]} numberOfLines={2}>{label}</Text>
      {value == null
        ? <Gap says={gap} small width={wide ? 190 : 120} />
        : (
          <Text
            style={[styles.rowValue, wide && styles.rowValueWide, strong && styles.rowValueStrong, lime && { color: colors.accent }]}
            numberOfLines={1}
          >
            {value}
          </Text>
        )}
      {action ? <Text style={styles.rowAction}>{action}</Text> : null}
    </View>
  );
  if (!onPress) return inner;
  return <Press effect="none" onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>{inner}</Press>;
}

/**
 * A row whose value is a field.
 *
 * The editable screens — Subscriptions and the supplier record — are rows like
 * every other panel, with an input where the figure would be. An input with a
 * rule under it rather than a box round it, which is the back office's own
 * grammar (owner, 12 Sep 2026: "the buttons with white boxes around them…
 * extremely ugly").
 *
 * `prefix` is for money — the £ sits outside the field so the value somebody
 * types is the number and nothing else.
 */
export function KvField({ label, value, onChange, onBlur, prefix, suffix, width = 96, last, keyboard = 'decimal-pad', placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  prefix?: string;
  suffix?: string;
  width?: number;
  last?: boolean;
  keyboard?: 'decimal-pad' | 'default';
  placeholder?: string;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel} numberOfLines={2}>{label}</Text>
      <View style={[styles.field, { width }]}>
        {prefix ? <Text style={styles.fieldFix}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.inkMuted}
          keyboardType={keyboard === 'decimal-pad' ? 'decimal-pad' : 'default'}
          accessibilityLabel={label}
          style={styles.fieldInput as any}
        />
        {suffix ? <Text style={styles.fieldFix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

/**
 * A row whose value is a control: "Edit", "Confirm today", "Publish".
 *
 * An underlined word rather than a button, and lime because it is the one thing
 * on the row you can do. `danger` is the exception the brand keeps — a red that
 * means danger rather than colour, which on the supplier record is the single
 * control that turns an integration off.
 */
export function KvAction({ label, action, onPress, danger, done, last, disabled }: {
  label: string;
  action: string;
  onPress: () => void;
  danger?: boolean;
  /** Already done — the word goes quiet and stops being a control. */
  done?: boolean;
  last?: boolean;
  disabled?: boolean;
}) {
  const quiet = done || disabled;
  const word = (
    <Text
      numberOfLines={1}
      style={[
        styles.rowAction,
        danger && !quiet && { color: colors.overrun },
        quiet && { color: colors.inkMuted, textDecorationLine: 'none' },
      ]}
    >
      {action}
    </Text>
  );
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel} numberOfLines={2}>{label}</Text>
      {quiet ? word : (
        <Press effect="none" onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} — ${action}`}>
          {word}
        </Press>
      )}
    </View>
  );
}

/** A label, a track with a fill, and the figure — the design's bar row. */
export function Bar({ label, value, pct, gap, high }: {
  label: string;
  value: string | null;
  pct?: number | null;
  gap?: string | null;
  high?: boolean;
}) {
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={2}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, height: 14, backgroundColor: high ? colors.lime : colors.decor }} />
      </View>
      {value == null ? <Gap says={gap} small /> : <Text style={styles.barValue} numberOfLines={1}>{value}</Text>}
    </View>
  );
}

/** A list of bar rows from the model's own shape, biggest highlighted. */
export function Bars({ rows, gap, highlight, format }: {
  rows: Row[] | null | undefined;
  gap?: string | null;
  /** Which row is the lime one. `-1` for none; defaults to the first. */
  highlight?: number;
  format?: (v: number | string | null) => string | null;
}) {
  if (!rows) return <Gap says={gap} />;
  const hi = highlight === undefined ? 0 : highlight;
  return (
    <>
      {rows.map((r, i) => (
        <Bar
          key={`${r.label}-${i}`}
          label={r.label}
          value={format ? format(r.value) : r.value == null ? null : String(r.value)}
          pct={r.pct}
          gap={gap}
          high={i === hi}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// the standing row
// ---------------------------------------------------------------------------

/**
 * The three figures at the foot of a screen — what is true whichever tile is
 * selected. Figure plus change only: the handoff asks for "no sentences" on the
 * supplier one, and there is no reason the other two should be chattier.
 */
export function Standing({ items }: {
  items: { label: string; value: string | null; gap?: string | null; delta?: string | null; sub?: string | null }[];
}) {
  return (
    <View style={styles.standing}>
      {items.map((s) => (
        <View key={s.label} style={styles.standingItem}>
          <Text style={styles.tileKicker}>{s.label.toUpperCase()}</Text>
          <View style={styles.standingLine}>
            {s.value == null
              // The reason wraps inside the column it sits in rather than
              // running into the figure beside it: "No payment provider" was
              // clipped to "No payment provide" (20 Sep 2026).
              ? <View style={{ flexShrink: 1, minWidth: 0 }}><Gap says={s.gap} /></View>
              : <Text style={styles.standingValue}>{s.value}</Text>}
            {s.delta ? <Text style={styles.tileDelta}>{s.delta}</Text> : null}
          </View>
          {s.sub ? <Text style={styles.tileSub} numberOfLines={2}>{s.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------

export type Col<T> = {
  key: string;
  label: string;
  /** Fixed width in pixels; the one column with `grow` fills what is left. */
  width?: number;
  grow?: boolean;
  align?: 'left' | 'right';
  /** What this column sorts on. Absent means the header is not a control. */
  sort?: keyof T & string;
  cell: (row: T) => React.ReactNode;
  /** Only drawn on a wide screen — a phone gets the columns that matter. */
  wideOnly?: boolean;
  /**
   * Extra space before this column, where two alignments meet.
   *
   * A right-aligned figure beside a left-aligned word reads as one string — "9"
   * and "Live" became "9 Live" on Customers — and the table's own 10px row gap
   * is not enough to separate them (20 Sep 2026, opening the screen).
   */
  pad?: number;
};

/**
 * A table whose every header sorts.
 *
 * Click toggles direction, the active header is lime and carries ↓ or ↑. The
 * arrows are characters here rather than icons because they sit inside the
 * header's own text run at 9.5px, where an SVG beside the word would not share
 * its baseline — the icon rule is about glyphs standing in for pictures (★ ♥ ✕),
 * and a sort direction is punctuation.
 */
export function SuiteTable<T extends { id?: string }>({ columns, rows, sort, dir, onSort, onRow, foot, empty }: {
  columns: Col<T>[];
  rows: T[];
  sort?: string | null;
  dir?: 1 | -1;
  onSort?: (key: string) => void;
  onRow?: (row: T) => void;
  /**
   * The totals row, keyed by column rather than positional: a phone drops the
   * `wideOnly` columns, and a positional footer then puts the margin under
   * "churn" (which is how a totals row comes to be quietly wrong).
   */
  foot?: Record<string, React.ReactNode>;
  empty?: string;
}) {
  const { width } = useViewport();
  const cols = columns.filter((c) => !c.wideOnly || width >= WIDE);
  // A growing column still has an alignment. Without this the supplier name —
  // the widest column on Suppliers — sat hard against the column beside it,
  // because the cell text inherits `textAlign: right` from the table's own
  // style (20 Sep 2026).
  const cellStyle = (c: Col<T>) => (c.grow
    ? { flexGrow: 1, flexBasis: 140, minWidth: 0, paddingLeft: c.pad ?? 0 }
    : { width: c.width ?? 80, flexShrink: 0, paddingLeft: c.pad ?? 0 });

  const body = (
    <View style={{ minWidth: width >= WIDE ? undefined : 720 }}>
      <View style={styles.thead}>
        {cols.map((c) => {
          const on = !!c.sort && sort === c.sort;
          const label = `${c.label.toUpperCase()}${on ? (dir === -1 ? ' ↓' : ' ↑') : ''}`;
          const text = (
            <Text
              numberOfLines={1}
              style={[styles.th, on && { color: colors.accent }, c.align === 'left' && { textAlign: 'left' }]}
            >
              {label}
            </Text>
          );
          if (!c.sort || !onSort) return <View key={c.key} style={cellStyle(c)}>{text}</View>;
          return (
            <Press
              key={c.key}
              effect="none"
              onPress={() => onSort(c.sort!)}
              // A header that sorts is a button. `columnheader` is the ARIA
              // role and reads better, but it is not in this React Native
              // version's `AccessibilityRole`, and a cast to get it past the
              // compiler would land an invalid role on the element.
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${c.label}`}
              style={cellStyle(c)}
            >
              {text}
            </Press>
          );
        })}
      </View>

      {rows.length === 0 ? <Text style={styles.emptyText}>{empty ?? 'Nothing here.'}</Text> : null}

      {rows.map((r, i) => {
        const line = (
          <View style={styles.tr}>
            {cols.map((c) => <View key={c.key} style={cellStyle(c)}>{c.cell(r)}</View>)}
          </View>
        );
        const key = r.id ?? String(i);
        if (!onRow) return <View key={key}>{line}</View>;
        return <Press key={key} effect="none" onPress={() => onRow(r)} accessibilityRole="button">{line}</Press>;
      })}

      {foot ? (
        <View style={styles.tfoot}>
          {cols.map((c) => <View key={c.key} style={cellStyle(c)}>{foot[c.key] ?? null}</View>)}
        </View>
      ) : null}
    </View>
  );

  // A back office on a phone is somebody checking one number on a train, so a
  // ten-column table scrolls sideways rather than being folded into cards
  // nobody can compare.
  if (width >= WIDE) return body;
  return <ScrollView horizontal showsHorizontalScrollIndicator>{body}</ScrollView>;
}

/** A cell's text, in the table's own weights. */
export function Cell({ children, strong, muted, lime, alarm, gap, left }: {
  children: string | null | undefined;
  strong?: boolean; muted?: boolean; lime?: boolean; alarm?: boolean; gap?: string | null;
  /** A column the table declared `align: 'left'` — a name, a plan, a status. */
  left?: boolean;
}) {
  if (children == null) return <Gap says={gap} small />;
  return (
    <Text
      numberOfLines={1}
      style={[
        styles.td,
        left && styles.tdLeft,
        strong && { fontWeight: '700', color: colors.ink },
        muted && { color: colors.inkMuted },
        lime && { color: colors.accent, fontWeight: '700' },
        alarm && { color: colors.overrun, fontWeight: '700' },
      ]}
    >
      {children}
    </Text>
  );
}

/** Two lines in one cell — a household's name over its area. */
export function TwoLine({ top, bottom }: { top: string; bottom?: string | null }) {
  return (
    // Always left: this is the row's name, and a name is the one thing on a
    // table that a reader scans down rather than compares across.
    <View style={{ minWidth: 0, width: '100%' }}>
      <Text numberOfLines={1} style={[styles.td, styles.tdLeft, { fontWeight: '700', color: colors.ink }]}>{top}</Text>
      {bottom ? <Text numberOfLines={1} style={[styles.tdSub, styles.tdLeft]}>{bottom}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// filters
// ---------------------------------------------------------------------------

/** A chip: an outline, or a flat lime block with ink type when it is chosen. */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Press
      effect="none"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Press>
  );
}

/** A labelled group of chips. */
export function ChipGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <View style={styles.chipGroup}>
      {label ? <Text style={styles.chipGroupLabel}>{label}</Text> : null}
      {children}
    </View>
  );
}

/** The search box: a magnifier and a rule underneath, never a box round. */
export function SearchBox({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <View style={styles.search}>
      <Icon name="search" size={14} color={colors.inkMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? 'Search'}
        placeholderTextColor={colors.inkMuted}
        // `outlineStyle` is web-only and not in React Native's TextStyle, so
        // it sits here rather than in the sheet, where it fails the checker.
        style={[styles.searchInput, NO_OUTLINE]}
        accessibilityLabel={placeholder ?? 'Search'}
      />
      {value ? (
        <Press effect="none" onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel="Clear">
          <Icon name="close" size={13} color={colors.inkMuted} />
        </Press>
      ) : null}
    </View>
  );
}

/** A row of filters with a count on the right. */
export function FilterBar({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.filterBar}>
      {children}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

/** The scrolling page every suite screen sits in. */
export function SuitePage({ children }: { children: React.ReactNode }) {
  const { width } = useViewport();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.page, width < 900 && styles.pagePhone]}
      showsVerticalScrollIndicator
    >
      {children}
    </ScrollView>
  );
}

/**
 * "19 Sep 2026" — a date, with three letters of month.
 *
 * `toLocaleDateString('en-GB', { month: 'short' })` gives "Sept" for September
 * alone, which in a column of dates is the one that is a different width.
 */
export function onDay(iso: string | null | undefined, opts: { year?: 'numeric' | '2-digit' } = {}): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3);
  const year = opts.year === '2-digit' ? String(d.getFullYear()).slice(2) : String(d.getFullYear());
  return `${d.getDate()} ${month} ${year}`;
}

/** "Reading the estate…", and a failure said in plain words. */
export function Waiting({ says }: { says?: string }) {
  return <Text style={[type.small, { padding: spacing.lg }]}>{says ?? 'Reading the estate…'}</Text>;
}

export function Trouble({ says, onRetry }: { says: string; onRetry?: () => void }) {
  return (
    <View style={styles.trouble}>
      <Icon name="alert" size={15} color={colors.overrun} />
      <Text style={[type.small, { flex: 1, color: colors.ink }]}>{says}</Text>
      {onRetry ? (
        <Press effect="none" onPress={onRetry} accessibilityRole="button">
          <Text style={styles.bandActionText}>Try again</Text>
        </Press>
      ) : null}
    </View>
  );
}

/** An information icon that says what a heading means, and nothing on the face. */
export function Why({ tip, children }: { tip: TipKey; children: React.ReactNode }) {
  return <Explain tip={tip} cursor="help">{children}</Explain>;
}

export const PanelIcon = ({ name }: { name: IconName }) => <Icon name={name} size={13} color={colors.inkMuted} />;

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: { padding: 26, gap: 22, paddingBottom: 80 },
  pagePhone: { padding: spacing.md, gap: spacing.lg },

  // --- the header ---------------------------------------------------------
  head: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md,
    paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
    flexWrap: 'wrap',
  },
  headNarrow: { alignItems: 'flex-start' },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  /** Its own line, full width, so four controls wrap inside the frame. */
  headRightOwnRow: { flexBasis: '100%', minWidth: 0, marginTop: spacing.sm },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  crumbText: { ...type.small, fontSize: 13 },
  title: { fontFamily: type.title.fontFamily, fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.66 },
  titlePhone: { fontSize: 19, letterSpacing: -0.5 },
  kickerLime: { fontFamily: type.title.fontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.accent, textTransform: 'uppercase' },

  // --- the segmented control ---------------------------------------------
  // `flexShrink` so a row of switches gives way inside a 390px frame rather
  // than pushing the control beside it off the edge.
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: colors.ruleMuted, flexShrink: 1, minWidth: 0 },
  segItem: { paddingVertical: 5, paddingHorizontal: 11, flexShrink: 1, minWidth: 0 },
  segItemOn: { backgroundColor: colors.selected },
  segText: { ...type.small, fontSize: 12.5, color: colors.inkMuted },
  segTextOn: { color: colors.selectedFg, fontWeight: '800' },

  // --- the period dropdown -----------------------------------------------
  // 176px is the design's width; `maxWidth` is what keeps it inside a frame
  // narrower than the row it sits in.
  pickerWrap: { width: 176, maxWidth: '100%', flexShrink: 1, zIndex: 20 },
  picker: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.ruleMuted, paddingVertical: 6, paddingHorizontal: 11,
  },
  pickerText: { ...type.small, fontSize: 12.5, color: colors.ink, flex: 1 },
  pickerPanel: {
    position: 'absolute', top: 34, left: 0, right: 0,
    backgroundColor: colors.panelWarm, borderWidth: 1, borderColor: colors.ruleMuted, zIndex: 30,
  },
  pickerOption: { paddingVertical: 8, paddingHorizontal: 11, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  pickerOptionOn: { backgroundColor: colors.selected },
  pickerOptionText: { ...type.small, fontSize: 12.5, color: colors.mutedOnInk },
  pickerOptionTextOn: { color: colors.selectedFg, fontWeight: '800' },

  // --- tiles --------------------------------------------------------------
  // `gridTemplateColumns` with `auto-fit` is the design's own rule and is what
  // makes four tiles fill a wide screen and one fill a phone. react-native-web
  // passes it through; on native the row simply wraps, which is the same shape.
  tileGrid: {
    display: 'grid' as any,
    gridTemplateColumns: 'repeat(auto-fit, minmax(var(--suite-tile-min, 210px), 1fr))' as any,
    gap: 14,
  } as any,
  tileSlot: { minWidth: 0 },
  tile: {
    borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface,
    paddingTop: 18, paddingHorizontal: 19, paddingBottom: 16, gap: 10, minWidth: 0, height: '100%',
  },
  tileOn: {
    borderColor: colors.lime, borderTopWidth: 3, borderTopColor: colors.lime,
    backgroundColor: colors.panelWarm, paddingTop: 16,
  },
  tileKicker: { fontFamily: type.title.fontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.inkMuted },
  tileValue: { fontFamily: type.title.fontFamily, fontSize: 34, lineHeight: 38, fontWeight: '800', color: colors.ink, letterSpacing: -1.3 },
  tileMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  tileDelta: { fontFamily: type.title.fontFamily, fontSize: 12.5, fontWeight: '700', color: colors.accent },
  tileDeltaDown: { color: colors.inkMuted },
  tileSub: { ...type.small, fontSize: 12, flexShrink: 1, minWidth: 0 },
  tileFoot: { flexDirection: 'row', alignItems: 'baseline', gap: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 9 },
  tileFootLabel: { ...type.tiny, flex: 1 },
  tileFootValue: { ...type.small, fontSize: 12.5, color: colors.ink, fontWeight: '700' },

  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },

  // --- the band -----------------------------------------------------------
  band: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md,
    borderTopWidth: BORDER, borderTopColor: colors.accent, paddingTop: 9,
  },
  bandTitle: { fontFamily: type.title.fontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.accent },
  bandAction: { borderBottomWidth: 1.5, borderBottomColor: colors.accent },
  bandActionText: { ...type.small, fontSize: 12.5, color: colors.accent, fontWeight: '700' },

  panels: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' },
  panel: {
    flexBasis: 260, minWidth: 260, borderWidth: 1, borderColor: colors.lineSoft,
    backgroundColor: colors.surface, paddingVertical: 17, paddingHorizontal: 18, gap: 12,
  },
  panelTitle: { fontFamily: type.title.fontFamily, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.inkMuted },
  panelNote: { ...type.tiny, fontSize: 11.5, lineHeight: 16 },

  // --- rows ---------------------------------------------------------------
  row: {
    // `flex-start`, not `center`: a gap that wraps to two lines would otherwise
    // drag its label down half a line and the panel's rows stop lining up.
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  rowStrong: { borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { ...type.small, fontSize: 13, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  rowLabelStrong: { color: colors.ink, fontWeight: '700' },
  /**
   * `minWidth` rather than `width`: the column is 96px so a panel of figures
   * lines up, and grows for the ones that are words — "12.2 months", "£100 web
   * · £112 App Store", "11% · covers a 15% cut". Fixed at 96 it truncated them
   * to "12.2 mon…", which is a figure nobody can read (20 Sep 2026).
   */
  rowValue: { ...type.small, fontSize: 13, color: colors.ink, fontWeight: '700', minWidth: 96, flexShrink: 0, textAlign: 'right' },
  rowValueWide: { width: 190, flexShrink: 0 },
  rowValueStrong: { fontFamily: type.title.fontFamily, fontSize: 17, fontWeight: '800' },
  rowAction: { ...type.small, fontSize: 12.5, color: colors.accent, fontWeight: '700', textDecorationLine: 'underline' },

  // A field is a rule underneath, never a box round (owner, 12 Sep 2026).
  field: {
    flexDirection: 'row', alignItems: 'baseline', gap: 3,
    borderBottomWidth: 1, borderBottomColor: colors.ruleMuted, paddingBottom: 3,
  },
  fieldFix: { ...type.small, fontSize: 13, color: colors.inkMuted },
  fieldInput: {
    flex: 1, minWidth: 0, textAlign: 'right', backgroundColor: 'transparent', borderWidth: 0,
    color: colors.ink, fontFamily: type.body.fontFamily, fontSize: 13, fontWeight: '700',
  },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  barLabel: { ...type.small, fontSize: 13, width: 132, flexShrink: 0 },
  barTrack: { flex: 1, minWidth: 40, height: 14, backgroundColor: colors.lineSoft },
  barValue: { ...type.small, fontSize: 13, color: colors.ink, fontWeight: '700', width: 66, textAlign: 'right' },

  // --- the standing row ---------------------------------------------------
  standing: {
    display: 'grid' as any,
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' as any,
    gap: 14, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: spacing.lg,
  } as any,
  standingItem: { gap: 5, minWidth: 0 },
  standingLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  standingValue: { fontFamily: type.title.fontFamily, fontSize: 24, fontWeight: '800', color: colors.ink, letterSpacing: -0.9 },

  // --- tables -------------------------------------------------------------
  thead: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-end',
    paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.ruleMuted,
  },
  th: { fontFamily: type.title.fontFamily, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.76, color: colors.inkMuted, textAlign: 'right' },
  tr: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    paddingVertical: 10, paddingRight: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  tfoot: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 12, paddingRight: 8 },
  td: { ...type.small, fontSize: 13.5, color: colors.mutedOnInk, textAlign: 'right' },
  /** Figures are compared across, so they read right. Names are scanned down. */
  tdLeft: { textAlign: 'left', width: '100%' },
  tdSub: { ...type.tiny, fontSize: 11.5 },
  emptyText: { ...type.small, paddingVertical: spacing.lg },

  // --- filters ------------------------------------------------------------
  filterBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  chipGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chipGroupLabel: { ...type.tiny, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginRight: 2 },
  chip: { borderWidth: 1, borderColor: colors.ruleMuted, paddingVertical: 4, paddingHorizontal: 10 },
  chipOn: { borderColor: colors.lime, backgroundColor: colors.selected },
  chipText: { ...type.small, fontSize: 12.5, color: colors.mutedOnInk },
  chipTextOn: { color: colors.selectedFg, fontWeight: '800' },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8, width: 250, maxWidth: '100%',
    borderBottomWidth: 1, borderBottomColor: colors.ruleMuted, paddingBottom: 5,
  },
  searchInput: {
    flex: 1, minWidth: 0, backgroundColor: 'transparent', borderWidth: 0,
    color: colors.ink, fontFamily: type.body.fontFamily, fontSize: 12.5,
  },

  // --- gaps and trouble ---------------------------------------------------
  gap: { ...type.small, fontSize: 12.5, color: colors.inkMuted, fontStyle: 'italic', flexShrink: 1, minWidth: 0 },
  gapSmall: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted, fontStyle: 'italic', textAlign: 'right', flexShrink: 1, minWidth: 0 },
  trouble: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderLeftWidth: BORDER, borderLeftColor: colors.overrun, paddingLeft: spacing.md, paddingVertical: spacing.sm,
  },
});
