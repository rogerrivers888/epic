/**
 * Money — where it comes from, and what margin survives.
 *
 * Four streams rather than one revenue figure, because the streams behave
 * nothing like each other: subscriptions carry the whole cost of search,
 * planning and routing — that is what a subscription buys — so their margin is
 * a third, and everything else is over ninety per cent. One blended figure
 * would hide the only thing on this screen worth knowing.
 *
 * Three rules from the handoff are structural here rather than cosmetic.
 *
 *  · **GMV is never revenue.** Epic is an agent under IFRS 15 and recognises
 *    the commission only. Gross bookings appear as a memo figure in the
 *    standing row and never share an axis with revenue.
 *  · **Refunds are a visible contra**, never netted into a stream silently.
 *  · **Per subscriber is a formatting context**, applied once at the top and
 *    passed down, so it converts every money value on the screen — tiles,
 *    panels, standing row and table — rather than the ones somebody remembered.
 */

import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { asOneOf, useQueryState, useStickyQuery } from '../../router';
import { BORDER, colors, spacing, type } from '../../theme';
import { Press } from '../../components/press';
import {
  Band, Bars, Cell, Gap, Kv, MeasureTile, Seg, Standing, SuiteHead, SuitePage, SuitePanel, SuiteTable,
  TileGrid, Trouble, Waiting, type Col,
} from './pieces';
import { SuiteControls, suiteKicker, useFormatters, useSuite, useSuiteControls } from './useSuite';
import { MetricDrill } from './MetricDrill';
import type { Row, Stream, Suite } from './model';

const STREAMS = ['subscriptions', 'hotel', 'hosting', 'activity'] as const;
type StreamKey = typeof STREAMS[number];

export function Money({ canSeeMoney }: { canSeeMoney: boolean }) {
  const { period, setPeriod, source, setSource } = useSuiteControls();
  useStickyQuery('admin.suite.money', ['stream', 'lens', 'per']);
  const [stream, setStream] = useQueryState<StreamKey>('stream', 'subscriptions', asOneOf(STREAMS, 'subscriptions'));
  const [lens, setLens] = useQueryState<'streams' | 'table'>('lens', 'streams', asOneOf(['streams', 'table'] as const, 'streams'));
  const [per, setPer] = useQueryState<'total' | 'subscriber'>('per', 'total', asOneOf(['total', 'subscriber'] as const, 'total'));
  const [chart, setChart] = useQueryState<boolean>('chart', false, { read: (r) => r === '1', write: (v) => (v ? '1' : null) });

  const { suite, error, reading, reload } = useSuite(period, source);

  // Per subscriber divides by the number of paying subscriptions there actually
  // are, which is a stock and therefore the same figure whatever the window.
  const perSub = per === 'subscriber' ? (suite?.money.subscribers || null) : null;
  const fmt = useFormatters(suite, perSub);

  const controls = (
    <SuiteControls period={period} setPeriod={setPeriod} source={source} setSource={setSource}>
      <Seg
        label="Total or per subscriber"
        value={per}
        options={[{ value: 'total', label: 'Total' }, { value: 'subscriber', label: 'Per subscriber' }]}
        onChange={setPer}
      />
      <Seg
        label="Streams or a table"
        value={lens}
        options={[{ value: 'streams', label: 'Streams' }, { value: 'table', label: 'Table' }]}
        onChange={setLens}
      />
    </SuiteControls>
  );

  if (!canSeeMoney) {
    return (
      <SuitePage>
        <SuiteHead title="Money" right={<SuiteControls period={period} setPeriod={setPeriod} source={source} setSource={setSource} />} />
        <Trouble says="Money is not yours to see. Ask an administrator for view_financials." />
      </SuitePage>
    );
  }
  if (error) {
    return <SuitePage><SuiteHead title="Money" right={controls} /><Trouble says={error} onRetry={reload} /></SuitePage>;
  }
  if (!suite) {
    return <SuitePage><SuiteHead title="Money" right={controls} /><Waiting says={reading ? 'Reading the ledger…' : undefined} /></SuitePage>;
  }

  const current = suite.money.streams.find((s) => s.key === stream) ?? suite.money.streams[0];

  if (chart) {
    return (
      <MetricDrill
        suite={suite}
        metric={stream}
        title={current?.label ?? 'Revenue'}
        unit="money"
        crumb="Money"
        onBack={() => setChart(false)}
        period={period}
        controls={controls}
        kicker={suiteKicker(source, period)}
      />
    );
  }

  const bandTitle = per === 'subscriber'
    ? `${current?.label ?? 'Money'} · per subscriber a month`
    : (current?.label ?? 'Money');

  return (
    <SuitePage>
      <SuiteHead title="Money" kicker={suiteKicker(source, period)} right={controls} />

      {lens === 'streams' ? (
        <TileGrid>
          {suite.money.streams.map((s) => (
            <MeasureTile
              key={s.key}
              label={s.label}
              value={fmt.revenue.money(s.revenue)}
              gap={s.gap}
              delta={fmt.revenue.delta(s.growth)}
              deltaDown={(s.growth ?? 0) < 0}
              sub={s.estimated ? 'contracted · estimated from the plan' : 'on the window before'}
              series={s.series}
              selected={s.key === stream}
              onPress={() => setStream(s.key as StreamKey)}
              footLabel="Margin"
              foot={s.margin == null
                ? null
                : per === 'subscriber'
                  ? fmt.revenue.money(s.margin)
                  : `${s.marginPct}% · ${fmt.revenue.money(s.margin)}`}
            />
          ))}
        </TileGrid>
      ) : (
        <StreamTable suite={suite} fmt={fmt} stream={stream} onStream={(k) => setStream(k)} per={per} />
      )}

      <MarginBand suite={suite} fmt={fmt} stream={stream} onStream={(k) => setStream(k)} per={per} />

      {/* The band, and with it "Open the chart", is drawn in both lenses. It
          used to belong to the Streams layout alone, so half of Money's states
          could not reach the metric drill at all (20 Sep 2026). In the Table
          lens it is the heading over the selected stream's breakdown. */}
      <Band title={bandTitle} onOpenChart={() => setChart(true)}>
        <Breakdown suite={suite} fmt={fmt} stream={stream} />
      </Band>

      <Standing
        items={[
          {
            label: 'Gross bookings · memo only',
            value: fmt.revenue.money(suite.money.grossBookings),
            gap: suite.gaps.bookings,
            delta: fmt.revenue.delta(suite.money.grossBookingsDelta ?? null) ?? undefined,
            sub: 'never revenue — Epic is an agent and keeps the commission inside it',
          },
          {
            label: 'Refunds',
            value: suite.money.refunds == null ? null : `−${fmt.revenue.money(suite.money.refunds)}`,
            gap: suite.gaps.bookings,
            sub: 'a visible contra, never netted into a stream',
          },
          {
            label: 'Cost to serve',
            value: fmt.cost.money(suite.money.costToServe.total),
            delta: fmt.cost.delta(suite.money.costToServe.delta ?? null) ?? undefined,
            /**
             * Every class, or the sentence does not add up to the figure above
             * it. "$0 allocated · $21.57 research" under a total of $99.58 left
             * library and office unnamed, which reads as arithmetic that has
             * gone wrong (epic-59's visual pass, 20 Sep 2026).
             */
            sub: suite.money.costToServe.byClass?.length
              ? suite.money.costToServe.byClass
                .filter((c) => typeof c.value === 'number' && c.value > 0)
                .map((c) => `${fmt.cost.money(c.value as number)} ${c.label.toLowerCase()}`)
                .join(' · ') || undefined
              : undefined,
          },
        ]}
      />

      {fmt.mixed ? (
        // Said once, at the foot, rather than a currency mark on every figure:
        // revenue is contracted in pence and provider cost is what the ledger
        // recorded, which is dollars. Converting would mean inventing a rate.
        <Text style={type.tiny}>
          Revenue is in pounds and provider cost in dollars — the units each is measured in. Nothing here is converted.
        </Text>
      ) : null}
    </SuitePage>
  );
}

type Fmt = ReturnType<typeof useFormatters>;

// ---------------------------------------------------------------------------

/**
 * The margin band — always visible, whichever lens is on.
 *
 * The whole-estate percentage on the left at 52px, and the four segment
 * margins on the right, each clickable and each with a bar. It is always on
 * screen because margin is the question the screen exists to answer, and
 * putting it inside one of the two lenses would mean half the screen's states
 * do not answer it.
 */
function MarginBand({ suite, fmt, stream, onStream, per }: {
  suite: Suite; fmt: Fmt; stream: string; onStream: (k: StreamKey) => void; per: 'total' | 'subscriber';
}) {
  const t = suite.money.total;
  return (
    <View style={styles.marginBand}>
      <View style={styles.marginLeft}>
        <Text style={styles.marginKicker}>
          {per === 'subscriber' ? 'PROFIT MARGIN · PER SUBSCRIBER' : 'PROFIT MARGIN · ALL STREAMS'}
        </Text>
        {t.marginPct == null
          ? <Gap says={suite.money.totalGap} />
          : <Text style={styles.marginPct}>{t.marginPct}%</Text>}
        {/* The sub-line only exists where there is a margin to describe. The
            gap above it has already said why there is not, and a dash under a
            sentence reads as a second, emptier fact. */}
        {(() => {
          const said = per === 'subscriber'
            ? (t.perSubKept == null || t.perSub == null
              ? null
              : `${fmt.plain.money(t.perSubKept)} kept from ${fmt.plain.money(t.perSub)} a month`)
            : (t.margin == null || t.revenue == null
              ? null
              : `${fmt.revenue.money(t.margin)} kept from ${fmt.revenue.money(t.revenue)}`);
          return said ? <Text style={type.small}>{said}</Text> : null;
        })()}
        {t.marginDelta != null ? <Text style={styles.marginDelta}>{fmt.revenue.delta(t.marginDelta)} on the window before</Text> : null}
      </View>

      <View style={styles.segments}>
        {suite.money.streams.map((s) => {
          const on = s.key === stream;
          return (
            <Press
              key={s.key}
              effect="none"
              onPress={() => onStream(s.key as StreamKey)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={styles.segment}
            >
              <Text style={[styles.segmentKicker, on && { color: colors.accent }]}>{s.label.toUpperCase()}</Text>
              {s.marginPct == null ? (
                // Left and wrapping: it is a sentence in a 150px column, and a
                // right-aligned one-liner was cut off at the edge (20 Sep 2026).
                <Text style={styles.segmentGap}>{s.gap ?? suite.money.totalGap}</Text>
              ) : (
                <>
                  <Text style={styles.segmentValue}>
                    {per === 'subscriber' ? fmt.revenue.money(s.margin) : `${s.marginPct}%`}
                  </Text>
                  <Text style={type.tiny}>
                    {per === 'subscriber' ? `${s.marginPct}%` : fmt.revenue.money(s.margin)}
                  </Text>
                  <View style={styles.segmentTrack}>
                    <View style={{ width: `${Math.min(100, s.marginPct)}%`, height: 10, backgroundColor: on ? colors.lime : colors.decor }} />
                  </View>
                </>
              )}
            </Press>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The four streams as a table.
 *
 * Detail rows deliberately carry no margin: cost only allocates at stream
 * level, and a margin against a detail row would be an apportionment nobody
 * asked for.
 */
/**
 * A row of the table: a stream, one of its detail rows, or the research line.
 *
 * `detail` is indented and carries no cost and no margin — cost allocates at
 * stream level only, and a margin against a channel would be an apportionment
 * nobody asked for (handoff §2). `unallocated` is the research class, which has
 * a cost and no revenue and is why the cost column adds to £2,926 rather than
 * to the £2,864 the four streams account for (rule 1).
 */
type TableRow = {
  id: string;
  key: string;
  label: string;
  units: number | null;
  revenue: number | null;
  avgUnit: number | null;
  churn: string | null;
  cost: number | null;
  margin: number | null;
  marginPct: number | null;
  perSub: number | null;
  growth: number | null;
  gap?: string | null;
  detail?: boolean;
  memo?: string | null;
};

function StreamTable({ suite, fmt, stream, onStream, per }: {
  suite: Suite; fmt: Fmt; stream: string; onStream: (k: StreamKey) => void; per: 'total' | 'subscriber';
}) {
  const columns: Col<TableRow>[] = [
    {
      key: 'stream', label: 'Stream', grow: true, align: 'left',
      cell: (r) => (
        <Cell strong={!r.detail} muted={r.detail} left>
          {r.memo ? `${r.label} · ${r.memo}` : r.label}
        </Cell>
      ),
    },
    { key: 'units', label: 'Units', width: 70, cell: (r) => <Cell muted>{r.units == null ? '—' : fmt.plain.count(r.units)}</Cell> },
    { key: 'revenue', label: 'Revenue', width: 90, cell: (r) => <Cell strong={!r.detail} gap={r.gap}>{fmt.revenue.money(r.revenue)}</Cell> },
    // A number, so Per subscriber converts it and the period restates it — the
    // stock/flow rule's second consequence, which a pre-formatted "£17.77"
    // quietly broke.
    { key: 'avg', label: 'Avg unit', width: 80, cell: (r) => <Cell muted gap={r.gap}>{fmt.plain.money(r.avgUnit)}</Cell> },
    { key: 'churn', label: 'Churn', width: 64, cell: (r) => <Cell muted gap={r.detail ? undefined : suite.gaps.churn}>{r.churn ?? (r.detail ? '—' : null)}</Cell> },
    { key: 'cost', label: 'Cost', width: 80, cell: (r) => <Cell gap={r.detail ? undefined : suite.money.totalGap}>{r.detail ? '—' : fmt.cost.money(r.cost)}</Cell> },
    { key: 'margin', label: 'Margin', width: 90, cell: (r) => <Cell gap={r.detail ? undefined : suite.money.totalGap}>{r.detail ? '—' : fmt.revenue.money(r.margin)}</Cell> },
    {
      key: 'marginPct', label: 'Margin %', width: 74,
      cell: (r) => <Cell gap={r.detail ? undefined : suite.money.totalGap}>{r.detail ? '—' : r.marginPct == null ? null : `${r.marginPct}%`}</Cell>,
    },
    { key: 'perSub', label: 'Per sub', width: 70, cell: (r) => <Cell muted gap={r.detail ? undefined : r.gap}>{r.perSub == null ? '—' : fmt.plain.money(r.perSub)}</Cell> },
    { key: 'growth', label: 'Growth', width: 70, cell: (r) => <Cell lime>{fmt.revenue.delta(r.growth) ?? '—'}</Cell> },
  ];

  const t = suite.money.total;
  const research = suite.money.costToServe.research;

  const rows: TableRow[] = [];
  for (const s of suite.money.streams) {
    rows.push({ ...s, id: s.key, key: s.key });
    for (const d of s.details ?? []) {
      rows.push({
        id: `${s.key}:${d.label}`,
        key: s.key,
        label: d.label,
        units: d.units,
        revenue: d.revenue,
        avgUnit: d.avgUnit,
        churn: null, cost: null, margin: null, marginPct: null, perSub: null,
        growth: d.growth ?? null,
        memo: d.memo ?? null,
        detail: true,
      });
    }
  }
  // The research class: a cost charged to no household, and the reason the cost
  // column adds to more than the four streams do (rule 1).
  if (research) {
    rows.push({
      id: 'research', key: 'research', label: 'Research · unallocated',
      units: null, revenue: null, avgUnit: null, churn: null,
      cost: research, margin: -research, marginPct: null, perSub: null, growth: null,
    });
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {per === 'subscriber' ? <Text style={styles.tableNote}>EVERY MONEY COLUMN IS PER SUBSCRIBER A MONTH</Text> : null}
      <SuiteTable
        columns={columns}
        rows={rows}
        indent={(r) => (r.detail ? 16 : 0)}
        foot={{
          stream: <Text style={styles.footStrong}>All streams</Text>,
          revenue: <Cell strong>{fmt.revenue.money(t.revenue)}</Cell>,
          cost: <Cell gap={suite.money.totalGap}>{fmt.cost.money(t.cost)}</Cell>,
          margin: <Cell lime gap={suite.money.totalGap}>{fmt.revenue.money(t.margin)}</Cell>,
          marginPct: <Cell strong gap={suite.money.totalGap}>{t.marginPct == null ? null : `${t.marginPct}%`}</Cell>,
          perSub: <Cell muted>{t.perSub == null ? null : fmt.plain.money(t.perSub)}</Cell>,
          growth: <Cell lime>{fmt.revenue.delta(t.growth)}</Cell>,
        }}
        onRow={(r) => onStream(r.key as StreamKey)}
        empty="No streams."
      />
      <Text style={type.tiny}>
        A detail row carries no cost and no margin: cost allocates at stream level only.
      </Text>
    </View>
  );
}

/** What the selected stream is made of. */
function Breakdown({ suite, fmt, stream }: { suite: Suite; fmt: Fmt; stream: string }) {
  const b = (suite.money.breakdown as Record<string, any>)[stream] ?? {};
  const rows = (key: string): Row[] | null => (Array.isArray(b[key]) ? b[key] : null);

  // A stream with no provider at all is one panel saying so, not three empty
  // ones: three boxes of "No hotel booking provider" is the same sentence three
  // times, which reads as a broken screen rather than an honest one.
  if (b.gap && !rows('bookings') && !rows('costs')) {
    return <SuitePanel title="Nothing to show"><Gap says={b.gap} /></SuitePanel>;
  }

  const money = (v: number | string | null) => (typeof v === 'number' ? fmt.revenue.money(v) : v == null ? null : String(v));
  const signed = (v: number | string | null) => {
    if (typeof v !== 'number') return v == null ? null : String(v);
    return v < 0 ? `−${fmt.revenue.money(Math.abs(v))}` : fmt.revenue.money(v);
  };
  /**
   * A movement, which carries its sign.
   *
   * The handoff's "no plus signs" is about the variance *column*, where the
   * figure is a level. Inside "how MRR moved" every row is a step — +£512 of
   * new subscriptions, −£143 of churn — and a step without its sign is not
   * readable as one.
   */
  const movement = (v: number | string | null) => {
    if (typeof v !== 'number') return v == null ? null : String(v);
    return `${v < 0 ? '−' : '+'}${fmt.revenue.money(Math.abs(v))}`;
  };

  return (
    <>
      {rows('mrrMoved') ? (
        <SuitePanel title="How MRR moved">
          {rows('mrrMoved')!.map((r, i, all) => {
            // The opening and the closing are levels; everything between them
            // is a movement and is signed.
            const step = i > 0 && i < all.length - 1;
            return (
              <Kv
                key={r.label}
                label={r.label}
                value={step ? movement(r.value) : signed(r.value)}
                lime={step && typeof r.value === 'number' && r.value > 0}
                strong={i === all.length - 1}
                last={i === all.length - 1}
              />
            );
          })}
        </SuitePanel>
      ) : b.mrrMovedGap ? (
        <SuitePanel title="How MRR moved"><Gap says={b.mrrMovedGap} /></SuitePanel>
      ) : null}

      {rows('channels') ? (
        <SuitePanel title="Who it was booked through">
          <Bars rows={rows('channels')} format={money} />
          {b.blendedRate ? <Kv label="Blended rate" value={String(b.blendedRate)} strong last /> : null}
        </SuitePanel>
      ) : null}

      {rows('ownVsThird') ? (
        <SuitePanel title="Epic hosts against third parties" note={b.ownVsThirdNote ?? undefined}>
          {rows('ownVsThird')!.map((r, i) => (
            <Kv key={r.label} label={r.label} value={money(r.value)} lime={i < 3} strong={i === 2 || i === 5} last={i === 5} />
          ))}
        </SuitePanel>
      ) : null}

      {rows('bookings') ? (
        <SuitePanel title="Bookings recorded">
          {rows('bookings')!.map((r, i, all) => (
            <Kv key={r.label} label={r.label} value={signed(r.value)} gap={b.bookingsGap} last={i === all.length - 1} />
          ))}
        </SuitePanel>
      ) : null}

      {rows('drivers') ? (
        <SuitePanel title="What drives it" note={b.driversNote ?? undefined}>
          {rows('drivers')!.map((r, i, all) => (
            <Kv key={r.label} label={r.label} value={money(r.value)} strong={i === all.length - 1} last={i === all.length - 1} />
          ))}
        </SuitePanel>
      ) : null}

      {rows('forecast') ? (
        <SuitePanel title="Forecast and runway" note={b.forecastNote ?? undefined}>
          {rows('forecast')!.map((r, i, all) => (
            <Kv key={r.label} label={r.label} value={money(r.value)} lime={i === 1 || i === 3} strong={i >= all.length - 2} last={i === all.length - 1} />
          ))}
        </SuitePanel>
      ) : b.forecastGap ? (
        <SuitePanel title="Forecast and runway"><Gap says={b.forecastGap} /></SuitePanel>
      ) : null}

      {rows('selling') ? (
        <SuitePanel title="How own hosts sell">
          <Bars rows={rows('selling')} format={money} />
        </SuitePanel>
      ) : null}

      {rows('costs') ? (
        <SuitePanel title="What it costs">
          {rows('costs')!.map((r, i, all) => (
            <Kv
              key={r.label}
              label={r.label}
              value={typeof r.value === 'number' ? fmt.cost.money(r.value) : money(r.value)}
              strong={i === all.length - 1}
              lime={i === all.length - 1}
              last={i === all.length - 1}
            />
          ))}
        </SuitePanel>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  marginBand: {
    flexDirection: 'row', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start',
    borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: spacing.lg,
  },
  marginLeft: { width: 250, minWidth: 220, flexGrow: 1, flexBasis: 220, gap: 4 },
  marginKicker: { fontFamily: type.title.fontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.inkMuted },
  marginPct: { fontFamily: type.title.fontFamily, fontSize: 52, lineHeight: 54, fontWeight: '800', color: colors.ink, letterSpacing: -2.3 },
  marginDelta: { ...type.small, fontSize: 12.5, color: colors.accent, fontWeight: '700' },

  segments: {
    flexGrow: 3, flexBasis: 420, minWidth: 0,
    display: 'grid' as any,
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' as any,
    gap: 14,
  } as any,
  segment: { gap: 4, minWidth: 0 },
  segmentKicker: { fontFamily: type.title.fontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: colors.inkMuted },
  segmentValue: { fontFamily: type.title.fontFamily, fontSize: 21, fontWeight: '800', color: colors.ink, letterSpacing: -0.7 },
  segmentTrack: { height: 10, backgroundColor: colors.lineSoft, marginTop: 3 },
  segmentGap: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted, fontStyle: 'italic', lineHeight: 15 },

  tableNote: { fontFamily: type.title.fontFamily, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.86, color: colors.accent },
  footStrong: { fontFamily: type.title.fontFamily, fontSize: 15, fontWeight: '800', color: colors.ink },
});
