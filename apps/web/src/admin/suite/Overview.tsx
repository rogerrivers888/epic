/**
 * Overview — is the business growing.
 *
 * Four measures, and selecting one rebuilds the band beneath it. That is the
 * whole screen: the tiles say how big each thing is and which way it is going,
 * and the band says what the selected one is made of. A row of three standing
 * figures at the foot is what is true whichever tile is chosen.
 *
 * The selected measure is in the address (`?measure=revenue`), because a layer
 * inside a screen is still somewhere you can send somebody (CLAUDE.md).
 */

import React from 'react';
import { asOneOf, useQueryState, useStickyQuery } from '../../router';
import {
  Band, Bar, Bars, Gap, Kv, MeasureTile, Standing, SuiteHead, SuitePage, SuitePanel, TileGrid, Trouble, Waiting,
} from './pieces';
import { SuiteControls, suiteKicker, useFormatters, useSuite, useSuiteControls } from './useSuite';
import { onSite, onSiteDelta, share } from './model';
import { MetricDrill } from './MetricDrill';

const MEASURES = ['signups', 'revenue', 'engagement', 'events'] as const;
type MeasureKey = typeof MEASURES[number];

export function Overview() {
  const { period, setPeriod, source, setSource } = useSuiteControls();
  useStickyQuery('admin.suite.overview', ['measure']);
  const [measure, setMeasure] = useQueryState<MeasureKey>('measure', 'signups', asOneOf(MEASURES, 'signups'));
  const [chart, setChart] = useQueryState<boolean>('chart', false, {
    read: (raw) => raw === '1', write: (v) => (v ? '1' : null),
  });

  const { suite, error, reading, reload } = useSuite(period, source);
  const fmt = useFormatters(suite, null);

  const controls = (
    <SuiteControls period={period} setPeriod={setPeriod} source={source} setSource={setSource} />
  );

  if (error) {
    return (
      <SuitePage>
        <SuiteHead title="Overview" right={controls} />
        <Trouble says={error} onRetry={reload} />
      </SuitePage>
    );
  }
  if (!suite) {
    return (
      <SuitePage>
        <SuiteHead title="Overview" right={controls} />
        <Waiting says={reading ? 'Reading the estate…' : undefined} />
      </SuitePage>
    );
  }

  const selected = suite.overview.measures.find((m) => m.key === measure) ?? suite.overview.measures[0];

  // The chart is a layer inside this screen rather than a screen of its own:
  // the crumb goes back to the tile that was open, which is what the back
  // chevron is for.
  if (chart) {
    return (
      <MetricDrill
        suite={suite}
        metric={measure}
        title={selected?.label ?? 'Revenue'}
        unit={selected?.unit === 'money' ? 'money' : 'count'}
        crumb="Overview"
        onBack={() => setChart(false)}
        period={period}
        controls={controls}
        kicker={suiteKicker(source, period)}
      />
    );
  }

  return (
    <SuitePage>
      <SuiteHead title="Overview" kicker={suiteKicker(source, period)} right={controls} />

      <TileGrid>
        {suite.overview.measures.map((m) => (
          <MeasureTile
            key={m.key}
            label={m.label}
            value={m.unit === 'money' ? fmt.revenue.money(m.value) : fmt.revenue.count(m.value)}
            delta={fmt.revenue.delta(m.delta)}
            deltaDown={(m.delta ?? 0) < 0}
            sub={m.sub && m.expected != null ? m.sub.replace('{expected}', fmt.revenue.count(m.expected) ?? '—') : m.sub}
            series={m.series}
            selected={m.key === measure}
            onPress={() => setMeasure(m.key as MeasureKey)}
          />
        ))}
      </TileGrid>

      <Band
        title={selected?.label ?? 'Overview'}
        onOpenChart={() => setChart(true)}
      >
        {measure === 'signups' ? <Signups suite={suite} fmt={fmt} /> : null}
        {measure === 'revenue' ? <Revenue suite={suite} fmt={fmt} /> : null}
        {measure === 'engagement' ? <Engagement suite={suite} fmt={fmt} /> : null}
        {measure === 'events' ? <Events suite={suite} fmt={fmt} /> : null}
      </Band>

      <Standing
        items={[
          {
            label: 'Direct bookings',
            value: fmt.revenue.count(suite.overview.standing.directBookings),
            sub: 'hotels, restaurants, activities, events',
          },
          {
            label: 'Time on site',
            value: onSite(suite.overview.standing.timeOnSiteSeconds),
            delta: onSiteDelta(suite.overview.standing.timeOnSiteDelta) ?? undefined,
            sub: 'a visit',
          },
          {
            label: 'Satisfaction',
            value: suite.overview.standing.satisfactionPct == null ? null : `${suite.overview.standing.satisfactionPct}%`,
            gap: suite.overview.standing.satisfactionGap,
            sub: 'rated their day out good',
          },
        ]}
      />
    </SuitePage>
  );
}

type Fmt = ReturnType<typeof useFormatters>;

// ---------------------------------------------------------------------------

/**
 * The book of subscriptions, how they arrived, and where from.
 *
 * The book is the one panel a reader checks the arithmetic of, so it is set out
 * as a book: opening, plus new, minus gone, equals live now.
 */
function Signups({ suite, fmt }: { suite: NonNullable<Parameters<typeof MetricDrill>[0]['suite']>; fmt: Fmt }) {
  const s = suite.overview.subscriptions;
  return (
    <>
      <SuitePanel title="The book of subscriptions">
        <Kv label="Live at the start of the period" value={fmt.plain.count(s.opening)} />
        <Kv label="New this period" value={s.added == null ? null : `+${fmt.plain.count(s.added)}`} lime />
        <Kv label="Unsubscribed" value={s.lost == null ? null : `−${fmt.plain.count(s.lost)}`} />
        <Kv label="Live now" value={fmt.plain.count(s.live)} strong />
        <Kv
          label={s.wasChurnPct == null ? 'Churn a month' : `Churn a month · was ${s.wasChurnPct}%`}
          value={s.churnPct == null ? null : `${s.churnPct}%`}
          gap={s.churnGap}
          last
        />
      </SuitePanel>

      <SuitePanel title="How they arrived" note={s.arrivalsNote ?? undefined}>
        <Bars rows={s.arrivals} format={(v) => fmt.plain.count(typeof v === 'number' ? v : null)} />
      </SuitePanel>

      <SuitePanel title="Where they came from">
        <Bars rows={s.sources} gap={s.sourcesGap} format={(v) => fmt.plain.count(typeof v === 'number' ? v : null)} />
      </SuitePanel>
    </>
  );
}

/**
 * Where revenue comes from, what MRR is made of, and what next month looks
 * like with its assumptions on the face of it.
 *
 * The forecast's three steps are shown rather than folded into the total,
 * because a forecast whose assumptions are invisible is a number nobody can
 * argue with and therefore nobody can use.
 */
function Revenue({ suite, fmt }: { suite: any; fmt: Fmt }) {
  const r = suite.overview.revenue;
  return (
    <>
      <SuitePanel title="Where it comes from" note={r.byStreamNote ?? undefined}>
        <Bars rows={r.byStream} gap={r.byStreamGap} format={(v) => fmt.revenue.money(typeof v === 'number' ? v : null)} />
      </SuitePanel>

      <SuitePanel title="MRR by plan">
        {r.mrrByPlan.map((p: any) => <Kv key={p.label} label={p.label} value={fmt.revenue.money(p.value)} />)}
        <Kv label="MRR" value={fmt.revenue.money(r.mrr)} strong last />
      </SuitePanel>

      <SuitePanel title="Forecast MRR · next month">
        {r.forecast ? (
          <>
            <Kv label="MRR today" value={fmt.revenue.money(r.forecast.today)} />
            {r.forecast.steps.map((step: any) => (
              <Kv
                key={step.label}
                label={step.label}
                value={step.value == null ? null : `${step.value >= 0 ? '+' : '−'}${fmt.revenue.money(Math.abs(step.value))}`}
                lime={step.value >= 0}
              />
            ))}
            <Kv label="Forecast" value={fmt.revenue.money(r.forecast.total)} strong lime last />
          </>
        ) : <Gap says={r.forecastGap} />}
      </SuitePanel>
    </>
  );
}

/**
 * What households did, how often they came, and on which surface.
 *
 * The shares are of *active* households, and each is said as honestly as its
 * denominator allows: under thirty it reads "7 of 9" rather than "78%", because
 * a percentage of nine claims a precision nine households cannot carry.
 */
function Engagement({ suite, fmt }: { suite: any; fmt: Fmt }) {
  const e = suite.overview.engagement;
  return (
    <>
      <SuitePanel title="Share of active households who">
        {e.shares.map((row: any, i: number) => {
          // Said as honestly as the denominator allows, and with the change in
          // points beside it where there is one — a share that moved four
          // points is the fact, not the share.
          const said = share(typeof row.value === 'number' ? row.value : null, row.of ?? suite.estate.active);
          const delta = e.shareDeltas ? e.shareDeltas[i] : null;
          return (
            <Bar
              key={row.label}
              label={row.label}
              value={said == null ? null : delta == null ? said : `${said} ${delta >= 0 ? '+' : '−'}${Math.abs(delta)}pt`}
              pct={row.pct}
              high={i === 0}
            />
          );
        })}
      </SuitePanel>

      <SuitePanel title="Visits">
        <Kv label="Visits" value={fmt.plain.count(e.visits)} />
        <Kv label="New households" value={fmt.plain.count(e.newVisits)} />
        <Kv label="Returning" value={fmt.plain.count(e.returningVisits)} />
        <Kv label="Time on site" value={onSite(e.timeOnSiteSeconds)} lime />
        <Kv
          label="Active weeks a quarter"
          value={e.activeWeeksPerQuarter == null ? null : `${e.activeWeeksPerQuarter} of 13`}
          gap="On the Behaviour screen"
          strong
          last
        />
      </SuitePanel>

      <SuitePanel title="By surface">
        <Bars rows={e.bySurface} format={(v) => fmt.plain.count(typeof v === 'number' ? v : null)} />
      </SuitePanel>
    </>
  );
}

/** What ran, who hosts, and how it sold. */
function Events({ suite, fmt }: { suite: any; fmt: Fmt }) {
  const e = suite.overview.events;
  return (
    <>
      <SuitePanel title="What ran">
        <Kv label="Events run in the period" value={fmt.plain.count(e.ran)} />
        <Kv label="Scheduled next 60 days" value={fmt.plain.count(e.scheduled60)} />
        <Kv label="Guests" value={fmt.plain.count(e.guests)} />
        <Kv label="Average party" value={e.averageParty == null ? null : String(e.averageParty)} />
        <Kv label="Fill rate" value={e.fillPct == null ? null : `${e.fillPct}%`} gap="No capacity against attendance yet" strong last />
      </SuitePanel>

      <SuitePanel title="Hosts">
        <Bars rows={e.hosts} format={(v) => fmt.plain.count(typeof v === 'number' ? v : null)} />
      </SuitePanel>

      <SuitePanel title="How they sell">
        {e.selling
          ? e.selling.map((row: any) => <Kv key={row.label} label={row.label} value={fmt.revenue.money(row.value)} />)
          : <Gap says={e.sellingGap} />}
        <Kv label="Average ticket" value={fmt.revenue.money(e.averageTicket)} />
        <Kv label="Rated good" value={e.ratedGoodPct == null ? null : `${e.ratedGoodPct}%`} gap={suite.overview.standing.satisfactionGap} strong lime last />
      </SuitePanel>
    </>
  );
}
