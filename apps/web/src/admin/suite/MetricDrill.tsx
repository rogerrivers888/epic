/**
 * The metric drill — the chart, and it is the same chart everywhere.
 *
 * "This is the signed-off shape — use it for every metric drill" (handoff §7).
 * Reached from "Open the chart" on Overview, Money and Behaviour, and from any
 * supplier row, and it draws the same three tiles and the same two plots each
 * time. The arithmetic is all in `drill.ts`, which is why it can be: the only
 * thing that differs between one drill and the next is a twelve-month array, a
 * unit, and a title.
 *
 * Two plots side by side with a rule between them, not one plot with dashed
 * bars at the end: history and forecast are different kinds of claim, and a
 * single axis running through both invites reading the forecast as measured.
 * The axis is fixed by the faster of the two run rates, so switching the run
 * rate redraws the forecast and leaves the history exactly where it was.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, type } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { asOneOf, useQueryState } from '../../router';
import { PLOT, buildDrill, type Bar as BarShape, type DrillView, type RunRate } from './drill';
import { Gap, Seg, SuiteHead, SuitePage } from './pieces';

/**
 * When the two plots sit side by side.
 *
 * Higher than the suite's own 1000px breakpoint on purpose: side by side at
 * 1000px gives each plot about 350px, which is twelve bars in 25px slots, and
 * the change above each bar — which the design says every bar carries — came
 * out as "−11...." (epic-59's visual pass, 20 Sep 2026). Stacked, each plot has
 * the whole content width and every change fits.
 */
const TWO_UP = 1280;
import { useFormatters } from './useSuite';
import type { PeriodKey, Suite } from './model';

export function MetricDrill({
  suite, metric, title, unit, crumb, onBack, period, controls, kicker, series: given, scope, headless,
}: {
  suite: Suite;
  /** Which of the model's twelve-month series to draw. */
  metric: string;
  title: string;
  unit: 'money' | 'count';
  crumb: string;
  onBack: () => void;
  period: PeriodKey;
  controls?: React.ReactNode;
  kicker?: string | null;
  /** A series the source screen already holds — a supplier's spend, say. */
  series?: number[] | null;
  /** The scope switch, where the screen that opened this has one. */
  scope?: React.ReactNode;
  /**
   * Drawn as a block inside a page that already has a header, rather than as a
   * page of its own — which is how the supplier record carries its spend chart
   * beneath its three panels. Same chart, no second heading.
   */
  headless?: boolean;
}) {
  const { width } = useViewport();
  const [view, setView] = useQueryState<DrillView>('view', 'monthly', asOneOf(['monthly', 'quarterly'] as const, 'monthly'));
  const [runRate, setRunRate] = useQueryState<RunRate>('rate', '12', asOneOf(['3', '12'] as const, '12'));

  const series = given ?? suite.history.series[metric] ?? null;
  const fmt = useFormatters(suite, null);
  const money = unit === 'money';

  const drill = buildDrill({
    series,
    labels: suite.history.labels,
    keys: suite.history.keys,
    view,
    runRate,
    period,
    unit,
  });

  /** The period tile's figure, in full — it is the one number on the screen. */
  const say = (v: number) => (money ? fmt.revenue.money(v) : fmt.revenue.count(v)) ?? '—';
  // Axis labels are short so twelve of them fit: £9.2k rather than £9,244.
  /**
   * An axis label, short enough that three of them fit in a 46px gutter.
   *
   * Thousands abbreviate; below that a money label is whole units and a count
   * keeps two decimals only where the whole series is small (0.76 days out a
   * month is the measure). `£879.94` on an axis was the pence leaking through
   * (epic-59's visual pass, 20 Sep 2026).
   */
  const sign = fmt.revenue.currency === 'usd' ? '$' : '£';
  const short = (v: number) => {
    if (v >= 1000) return `${money ? sign : ''}${(v / 1000).toFixed(1)}k`;
    if (money) return `${sign}${Math.round(v).toLocaleString()}`;
    // A per-household series never reaches 10, so its axis needs its decimals.
    return drill.max < 10 ? v.toFixed(2) : Math.round(v).toLocaleString();
  };

  /**
   * Whether a change fits above a bar.
   *
   * The design has every bar carry its change, and on a desktop back office
   * there is room for twelve of them. On a 390px frame each slot is 26px and
   * "−10.6%" needs about 40, so it came out as "−11...." — and a number cut in
   * half is worse than no number (epic-59's visual pass, 20 Sep 2026). So it is
   * drawn where it fits and omitted where it does not, which is the same rule
   * the chart already follows for a bar with no comparator.
   *
   * Worked from the frame rather than measured: the rail is 196px on a wide
   * screen and nothing on a narrow one, the page pads 26 or 12 each side, and
   * the history's axis takes a 54px gutter.
   */
  const plotWidth = (width - (width >= 900 ? 196 : 0) - (width >= 900 ? 52 : 24) - 54)
    / (width >= TWO_UP ? 2 : 1);
  const roomForChanges = plotWidth / Math.max(1, drill.past.bars.length) >= 38;

  const head = (
    <SuiteHead
      crumb={crumb}
      onCrumb={onBack}
      title={title}
      kicker={kicker}
      right={(
        <>
          {scope}
          <Seg
            label="How the months are grouped"
            value={view}
            options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }]}
            onChange={setView}
          />
          {controls}
        </>
      )}
    />
  );

  // A page of its own, or a block inside one that already has a header.
  const Frame = ({ children }: { children: React.ReactNode }) => (headless
    ? <View style={{ gap: 22 }}>{children}</View>
    : <SuitePage>{head}{children}</SuitePage>);

  if (!drill.ok) {
    return (
      <Frame>
        <View style={{ paddingVertical: spacing.lg }}>
          <Gap says={`${title} has no history to draw. ${suite.mock ? '' : 'Nothing has been recorded for it yet.'}`.trim()} />
        </View>
      </Frame>
    );
  }

  return (
    <Frame>
      {/* Three tiles, no supporting sentences: the selected period and the two
          run rates. The first is lime-topped because it is the figure the
          picker is set to. */}
      <View style={styles.tiles}>
        {drill.tiles.map((t, i) => (
          <View key={t.label} style={[styles.tile, t.selected && styles.tileOn]}>
            <Text style={[styles.kicker, t.selected && { color: colors.lime }]}>{t.label.toUpperCase()}</Text>
            <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
              {i === 0
                ? say(t.value)
                : `${t.value >= 0 ? '+' : '−'}${Math.abs(t.value).toFixed(i === 1 ? 1 : 2)}% ${view === 'quarterly' ? '/ qtr' : '/ mo'}`}
            </Text>
            {t.change ? <Text style={[styles.delta, t.down && { color: colors.inkMuted }]}>{t.change}</Text> : null}
          </View>
        ))}
      </View>

      {/* The run-rate switch belongs to the forecast, so it sits with the
          charts rather than in the page header with the things that change
          what is being measured. */}
      <View style={styles.rateRow}>
        <Text style={styles.rateLabel}>RUN RATE</Text>
        <Seg
          label="Which run rate the forecast uses"
          value={runRate}
          options={[{ value: '3', label: drill.rateLabels[0] }, { value: '12', label: drill.rateLabels[1] }]}
          onChange={setRunRate}
        />
      </View>

      <View style={[styles.charts, width < TWO_UP && styles.chartsNarrow]}>
        <Plot title={drill.past.title} bars={drill.past.bars} axis={drill.axis} label={short} withAxis changes={roomForChanges} />
        <View style={width < TWO_UP ? styles.ruleH : styles.ruleV} />
        <Plot title={drill.future.title} bars={drill.future.bars} axis={drill.axis} label={short} dashed changes={roomForChanges} />
      </View>
    </Frame>
  );
}

/**
 * One plot: a title, a 336px box, bars scaled to 300px inside it, and the
 * month labels under them.
 *
 * Only the history carries the axis; the forecast shares its scale, and two
 * sets of identical labels either side of a rule would suggest two scales.
 */
export function Plot({ title, bars, axis, label, withAxis, dashed, changes = true }: {
  title: string;
  bars: BarShape[];
  axis: { value: number; top: number }[];
  label: (v: number) => string;
  withAxis?: boolean;
  dashed?: boolean;
  /** Whether each bar's change fits above it at this width. */
  changes?: boolean;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
      <Text style={styles.plotTitle}>{title.toUpperCase()}</Text>
      <View style={styles.plotRow}>
        {withAxis ? (
          <View style={styles.axis}>
            {axis.map((a) => (
              <Text key={a.value} style={[styles.axisLabel, { top: Math.max(0, a.top - 7) }]} numberOfLines={1}>
                {label(a.value)}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={styles.plot}>
          {/* Gridlines from the same maximum the bars use, so a label always
              sits where a bar of that value would end. */}
          {axis.map((a) => (
            <View key={a.value} style={[styles.grid, { top: a.top, backgroundColor: a.value === 0 ? colors.ruleMuted : colors.lineSoft }]} />
          ))}
          <View style={styles.bars}>
            {bars.map((b, i) => (
              <View key={`${b.label}-${i}`} style={styles.barSlot}>
                {changes && b.change ? (
                  <Text style={[styles.barChange, b.down && { color: colors.inkMuted }]} numberOfLines={1}>{b.change}</Text>
                ) : null}
                <View
                  style={[
                    { width: '100%', height: b.height },
                    dashed
                      ? { borderWidth: 1, borderBottomWidth: 0, borderColor: colors.lime, borderStyle: 'dashed' }
                      : { backgroundColor: b.latest ? colors.lime : colors.ruleMuted },
                  ]}
                />
              </View>
            ))}
          </View>
        </View>
      </View>
      <View style={[styles.labels, withAxis && styles.labelsInset]}>
        {bars.map((b, i) => (
          <Text
            key={`${b.label}-${i}`}
            numberOfLines={1}
            style={[styles.tick, !changes && styles.tickTight, b.latest && { color: colors.lime, fontWeight: '800' }]}
          >
            {/*
              Every third month in a tight frame, and always the last one.
              Twelve three-letter labels in 15px slots cannot be read whatever
              size they are set at, and a quarter's worth of ticks is what a
              chart this narrow can carry (20 Sep 2026).
            */}
            {changes || i % 3 === 0 || b.latest ? b.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: {
    display: 'grid' as any,
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' as any,
    gap: 14,
  } as any,
  tile: {
    borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface,
    paddingVertical: 16, paddingHorizontal: 18, gap: 8, minWidth: 0,
  },
  tileOn: {
    borderColor: colors.lime, borderTopWidth: 3, borderTopColor: colors.lime,
    backgroundColor: colors.panelWarm, paddingTop: 14,
  },
  kicker: { fontFamily: type.title.fontFamily, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.86, color: colors.inkMuted },
  value: { fontFamily: type.title.fontFamily, fontSize: 30, lineHeight: 34, fontWeight: '800', color: colors.ink, letterSpacing: -1.1 },
  delta: { fontFamily: type.title.fontFamily, fontSize: 12.5, fontWeight: '700', color: colors.lime },

  rateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rateLabel: { fontFamily: type.title.fontFamily, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.86, color: colors.inkMuted },

  charts: { flexDirection: 'row', gap: 22, alignItems: 'stretch' },
  chartsNarrow: { flexDirection: 'column' },
  ruleV: { width: 1, backgroundColor: colors.ruleMuted },
  ruleH: { height: 1, backgroundColor: colors.ruleMuted },

  plotTitle: { fontFamily: type.title.fontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.inkMuted },
  plotRow: { flexDirection: 'row', gap: 8 },
  axis: { width: 46, height: PLOT, position: 'relative' },
  axisLabel: { position: 'absolute', right: 0, ...type.tiny, fontSize: 10.5, color: colors.inkMuted },
  plot: { flex: 1, minWidth: 0, height: PLOT, position: 'relative', justifyContent: 'flex-end' },
  grid: { position: 'absolute', left: 0, right: 0, height: 1 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: PLOT },
  barSlot: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'flex-end' },
  barChange: { fontFamily: type.title.fontFamily, fontSize: 10.5, fontWeight: '800', color: colors.lime, marginBottom: 3 },
  labels: { flexDirection: 'row', gap: 4 },
  /** Only the history plot has an axis gutter, so only its ticks are inset by one. */
  labelsInset: { paddingLeft: 54 },
  tick: { flex: 1, minWidth: 0, textAlign: 'center', ...type.tiny, fontSize: 10.5, color: colors.inkMuted },
  /** Twelve three-letter months in a 390px frame have 18px each, not 20. */
  tickTight: { fontSize: 9, letterSpacing: -0.2 },
});
