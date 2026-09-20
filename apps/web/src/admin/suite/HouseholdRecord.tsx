/**
 * One household's record — the drill off Customers.
 *
 * Four stat tiles, two charts, seven panels. Three consistency requirements
 * from the handoff are the reason it is laid out this way rather than as one
 * long list of facts:
 *
 *  · **Lifetime and ninety-day figures are labelled and never mixed inside one
 *    panel.** "Searches" means nothing without the window it counts.
 *  · **A booking split sums to its own total.** Hotels + activities + events is
 *    the number of bookings, because both come from the same rows.
 *  · **Ratings under thirty are counts** — "7 of 9" — not a percentage.
 *
 * And one more: the lifetime subscription figure agrees with the plan history,
 * so a household that upgraded pays the old price for its earlier months. Where
 * there is no history to walk it says the figure is estimated rather than
 * implying a precision the table has not got.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { Gap, Kv, KvAction, Spark, SuiteHead, SuitePage, SuitePanel, Trouble, Waiting, WIDE, onDay } from './pieces';
import { useFormatters } from './useSuite';
import { share, type HouseholdRecord, type Suite } from './model';

export function HouseholdRecordView({ record, error, gaps, onBack, controls, kicker, onFilterToFamily, onTrial, trialBusy }: {
  record: HouseholdRecord | null;
  error: string | null;
  /**
   * The estate's named gaps, so a missing figure here says the same thing it
   * says on Money. Passed in rather than read from the whole model: Customers
   * is gated on accounts and never fetches the reporting model (Codex, 20 Sep
   * 2026).
   */
  gaps: Record<string, string>;
  onBack: () => void;
  controls?: React.ReactNode;
  kicker?: string | null;
  onFilterToFamily?: () => void;
  /** Grant or extend a trial. Absent where the reader may not manage accounts. */
  onTrial?: (what: 'grant' | 'extend') => void;
  trialBusy?: 'grant' | 'extend' | null;
}) {
  const { width } = useViewport();
  const fmt = useFormatters(null, null);

  if (error) {
    return (
      <SuitePage>
        <SuiteHead crumb="Customers" onCrumb={onBack} title="A household" right={controls} />
        <Trouble says={error} />
      </SuitePage>
    );
  }
  if (!record) {
    return (
      <SuitePage>
        <SuiteHead crumb="Customers" onCrumb={onBack} title="A household" right={controls} />
        <Waiting says="Reading the record…" />
      </SuitePage>
    );
  }

  const pence = (v: number | null | undefined) => fmt.revenue.money(v, { pence: true });
  const s = record.spend ?? {};

  return (
    <SuitePage>
      <SuiteHead
        crumb="Customers"
        onCrumb={onBack}
        title={`${record.name} household`}
        kicker={kicker}
        right={controls}
      />

      {/* Four stat tiles. The first is lime-topped because "what they are on
          now" is the fact the other three are read against. */}
      <View style={styles.stats}>
        <Stat
          label="Plan now"
          value={record.monthPence ? pence(record.monthPence) : '—'}
          sub={[record.plan, record.status].filter(Boolean).join(' · ')}
          on
        />
        <Stat
          label="Spent with Epic ever"
          value={pence(s.everPence)}
          sub={`${pence(s.subscriptionPence)} subscription · ${pence(s.bookedPence)} booked${s.subscriptionEstimated ? ' · estimated' : ''}`}
        />
        <Stat
          label="Spent last 12 months"
          value={pence(s.yearPence)}
          gap={record.bookingsGap ?? gaps.bookings}
          sub={s.previousYearPence == null ? 'against the year before' : `against ${pence(s.previousYearPence)} the year before`}
        />
        {/*
          Margin, or the reason there isn't one.
          Revenue is contracted in pence and provider cost is what the ledger
          recorded, which is dollars. Subtracting one from the other is a margin
          at an implicit 1:1 rate — a fabricated figure (Codex, 20 Sep 2026) —
          so the two halves are shown in their own currencies and the margin
          waits for somebody to set a rate.
        */}
        <Stat
          label="Margin to Epic"
          value={pence(s.marginPence)}
          gap={s.marginGap}
          sub={s.costUsd == null
            ? `${pence(s.earnedPence)} earned`
            : `${pence(s.earnedPence)} earned · $${s.costUsd.toFixed(2)} to serve`}
        />
      </View>

      {/* Two charts, 150px tall, twelve monthly bars, the last one lime. */}
      <View style={[styles.charts, width < WIDE && { flexDirection: 'column' }]}>
        <RecordChart
          title="What they spend a month"
          series={record.charts?.spend}
          gap={record.charts?.spendGap}
          labels={record.charts?.labels}
          say={(v) => pence(v) ?? '—'}
        />
        <RecordChart
          title="Searches a month"
          series={record.charts?.searches}
          labels={record.charts?.labels}
          say={(v) => fmt.plain.count(v) ?? '—'}
        />
      </View>

      <View style={styles.panels}>
        <SuitePanel title="Inspire · last 90 days">
          <Kv label="Searches" value={fmt.plain.count(record.inspire?.searches90)} />
          <Kv label="Places opened from a search" value={fmt.plain.count(record.inspire?.opened)} />
          <Kv label="Saved from a search" value={fmt.plain.count(record.inspire?.savedFrom)} />
          <Kv label="Top category" value={record.inspire?.topCategory ?? null} gap="Categories are not counted per household yet" />
          <Kv
            label="Search to save"
            value={record.inspire?.searchToSavePct == null ? null : `${record.inspire.searchToSavePct}%`}
            strong
            lime
            last
          />
        </SuitePanel>

        <SuitePanel title="Places · ever">
          <Kv label="Saved in total" value={fmt.plain.count(record.placesPanel?.saved)} />
          <Kv label="Added to a trip" value={fmt.plain.count(record.placesPanel?.addedToTrip)} gap="Stops are not matched back to saved places yet" />
          <Kv label="Actually visited" value={fmt.plain.count(record.placesPanel?.visited)} />
          <Kv label="Added in the last 90 days" value={record.placesPanel?.addedInPeriod == null ? null : `+${record.placesPanel.addedInPeriod}`} />
          <Kv label="Cancel risk at this size" value={record.placesPanel?.cancelRisk ?? null} gap={record.placesPanel?.cancelRiskGap} strong last />
        </SuitePanel>

        <SuitePanel title="Trips · ever">
          <Kv label="Trips" value={fmt.plain.count(record.tripsPanel?.daysSignedOff)} />
          <Kv label="Days out" value={fmt.plain.count(record.tripsPanel?.daysOut)} />
          <Kv label="Trips away, multi-day" value={fmt.plain.count(record.tripsPanel?.away)} />
          <Kv label="A base or hotel added" value={fmt.plain.count(record.tripsPanel?.hotels)} />
          <Kv label="Flights added" value={fmt.plain.count(record.tripsPanel?.flights)} gap="Flights are not a stop kind yet" strong last />
        </SuitePanel>

        <SuitePanel title="Events · ever">
          <Kv label="Attended" value={fmt.plain.count(record.eventsPanel?.attended)} />
          <Kv label="Hosted" value={fmt.plain.count(record.eventsPanel?.hosted)} />
          <Kv label="Ratings given" value={fmt.plain.count(record.eventsPanel?.ratings)} />
          {/* Under thirty this reads "7 of 9", which is the honest form of it. */}
          <Kv label="Rated good" value={share(record.eventsPanel?.ratedGood ?? null, record.eventsPanel?.ratings)} />
          <Kv label="Favourite shape" value={record.eventsPanel?.shape ?? null} gap="Not enough bookings to say" strong last />
        </SuitePanel>

        <SuitePanel title="Subscription history">
          {record.plans?.rows?.length ? (
            record.plans.rows.map((p: any, i: number, all: any[]) => (
              <Kv
                key={`${p.plan}-${p.from}`}
                label={`${onDay(p.from, { year: '2-digit' })} · ${p.plan}`}
                value={p.pence ? pence(p.pence) : 'Free'}
                strong={i === all.length - 1}
                last={i === all.length - 1}
              />
            ))
          ) : record.plans?.soloMonths != null ? (
            <>
              <Kv label={`${onDay(record.joined, { year: '2-digit' }) ?? 'Joined'} · joined`} value={record.plans.soloMonths ? 'Solo £5.99' : `${record.plan} ${pence(record.monthPence)}`} />
              <Kv
                label={record.plans.soloMonths ? `Upgraded after ${record.plans.soloMonths} months` : 'Stayed on the same plan'}
                value={record.plans.soloMonths ? 'Household £8.99' : '—'}
                lime={!!record.plans.soloMonths}
              />
              <Kv label="Live for" value={`${record.lifeMonths} months`} strong last />
            </>
          ) : (
            <>
              <Gap says="No plan history — the table is empty, so the lifetime figure is months × today’s price" />
              <Kv label="Live for" value={`${record.lifeMonths} months`} strong last />
            </>
          )}
        </SuitePanel>

        <SuitePanel title="Bookings and spend · ever">
          <Kv label="Bookings ever" value={fmt.plain.count(record.bookings?.total)} />
          <Kv
            label="Hotels · activities · events"
            value={record.bookings?.hotels == null
              ? null
              : `${record.bookings.hotels} · ${record.bookings.activities} · ${record.bookings.events}`}
            gap={record.bookingsGap}
          />
          <Kv label="Booked through Epic ever" value={pence(record.bookings ? record.spend?.bookedPence : null)} />
          <Kv label="Epic kept" value={pence(record.bookings?.keptPence)} gap={record.spendGap} lime />
          <Kv
            label="Spend against last year"
            value={s.yearPence != null && s.previousYearPence
              ? `${s.yearPence >= s.previousYearPence ? '+' : '−'}${Math.abs(Math.round((s.yearPence / s.previousYearPence - 1) * 100))}%`
              : null}
            gap={gaps.bookings}
            strong
            lime
            last
          />
        </SuitePanel>

        {/* Actions. Two of these are navigations and work; two need an endpoint
            that does not exist, and say so rather than pretending to fire. */}
        <SuitePanel title="Actions">
          {/* A trial is a plan and a date on the household's own account, which
              `PATCH /api/accounts/:id` already sets and already writes a plan
              history row for — so these are real, and `canManage` decides
              whether they are controls or a sentence saying what is missing. */}
          {onTrial ? (
            <>
              <KvAction
                label="Grant a 30-day trial"
                action={trialBusy === 'grant' ? 'Granting…' : 'Grant'}
                disabled={!!trialBusy}
                onPress={() => onTrial('grant')}
              />
              <KvAction
                label="Extend the current trial"
                action={record.status === 'active' && record.monthPence === 0
                  ? (trialBusy === 'extend' ? 'Extending…' : 'Extend by 30 days')
                  : 'Not on trial'}
                done={!(record.status === 'active' && record.monthPence === 0) || !!trialBusy}
                onPress={() => onTrial('extend')}
              />
            </>
          ) : (
            <>
              <Kv label="Granting a trial" value={null} gap="Needs manage_accounts" />
              <Kv label="Extending a trial" value={null} gap="Needs manage_accounts" />
            </>
          )}
          {/* What it can honestly do: filter the customer list. Scoping
              Overview, Money and Behaviour to one household needs a per-
              household variant of every section — it is named as an open
              question rather than promised by a button. */}
          <KvAction label="Filter the customer list to this family" action="Apply" onPress={() => onFilterToFamily?.()} />
          <Kv
            label="Open their chat history"
            value={null}
            gap="Chat belongs to a trip or an offer, not to a household"
            last
          />
        </SuitePanel>
      </View>
    </SuitePage>
  );
}

// ---------------------------------------------------------------------------

function Stat({ label, value, sub, gap, on }: {
  label: string; value: string | null; sub?: string | null; gap?: string | null; on?: boolean;
}) {
  return (
    <View style={[styles.stat, on && styles.statOn]}>
      <Text style={[styles.statKicker, on && { color: colors.accent }]}>{label.toUpperCase()}</Text>
      {value == null ? <Gap says={gap} /> : <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>}
      {sub ? <Text style={type.tiny} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
}

/**
 * One of the record's two charts: a title, the latest figure and its change,
 * then twelve bars 150px tall.
 *
 * The change is the last three months compounded rather than month on month,
 * because one household's month is noisy enough that a single step says more
 * about when they happened to book than about a trend.
 */
function RecordChart({ title, series, labels, say, gap }: {
  title: string;
  series: number[] | null | undefined;
  labels: string[] | undefined;
  say: (v: number) => string;
  gap?: string | null;
}) {
  const ok = !!series?.length;
  const latest = ok ? series![series!.length - 1] : null;
  const three = ok ? series![Math.max(0, series!.length - 4)] : null;
  const delta = ok && three && three > 0 ? Math.round((latest! / three - 1) * 100) : null;
  return (
    <View style={styles.chart}>
      <View style={styles.chartHead}>
        <Text style={styles.statKicker}>{title.toUpperCase()}</Text>
        <View style={{ flex: 1 }} />
        {latest != null ? <Text style={styles.chartValue}>{say(latest)}</Text> : null}
        {delta != null ? (
          <Text style={[styles.chartDelta, delta < 0 && { color: colors.inkMuted }]}>
            {`${delta >= 0 ? '+' : '−'}${Math.abs(delta)}%`}
          </Text>
        ) : null}
      </View>
      {ok ? <Spark values={series} selected height={150} /> : <Gap says={gap} />}
      {ok && labels?.length ? (
        <View style={styles.chartLabels}>
          {labels.map((l, i) => (
            <Text key={`${l}-${i}`} numberOfLines={1} style={styles.chartTick}>{l}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stats: {
    display: 'grid' as any,
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' as any,
    gap: 14,
  } as any,
  stat: {
    borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface,
    paddingVertical: 15, paddingHorizontal: 16, gap: 6, minWidth: 0,
  },
  statOn: {
    borderColor: colors.lime, borderTopWidth: 3, borderTopColor: colors.lime,
    backgroundColor: colors.panelWarm, paddingTop: 13,
  },
  statKicker: { fontFamily: type.title.fontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 0.9, color: colors.inkMuted },
  statValue: { fontFamily: type.title.fontFamily, fontSize: 26, lineHeight: 30, fontWeight: '800', color: colors.ink, letterSpacing: -1 },

  charts: { flexDirection: 'row', gap: 12 },
  chart: {
    flexGrow: 1, flexBasis: 300, minWidth: 0,
    borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface,
    paddingVertical: 16, paddingHorizontal: 17, gap: 10,
  },
  chartHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  chartValue: { fontFamily: type.title.fontFamily, fontSize: 17, fontWeight: '800', color: colors.ink },
  chartDelta: { fontFamily: type.title.fontFamily, fontSize: 12.5, fontWeight: '700', color: colors.accent },
  chartLabels: { flexDirection: 'row', gap: 2 },
  chartTick: { flex: 1, minWidth: 0, textAlign: 'center', ...type.tiny, fontSize: 9.5 },

  panels: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' },
});
