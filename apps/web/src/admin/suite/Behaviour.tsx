/**
 * Behaviour — what a household actually does.
 *
 * Six measures, each a **rate**: how much one household does in a month. The
 * scope switch multiplies by the number of active households to give the
 * estate total, and it travels into the drill, because "0.18 trips away" and
 * "155 trips away" are the same measurement asked two different ways and a
 * drill that silently changed which one you were looking at would be worse than
 * no drill.
 *
 * The sixth rule is why the scope switch is the only arithmetic on the screen:
 * money per household, engagement per person, and never a ratio across the two.
 * Nothing here is divided by a money figure.
 *
 * The closing band — how often a household came back — is a share of **every**
 * household, including the ones that never opened Epic at all. That is the
 * point of it: a retention figure over the people who came back is a tautology.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { asOneOf, useQueryState, useStickyQuery } from '../../router';
import { BORDER, colors, spacing, type } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import {
  Band, Bar, Bars, Gap, Kv, MeasureTile, Seg, SuiteHead, SuitePage, SuitePanel, TileGrid, Trouble, Waiting,
} from './pieces';
import { SuiteControls, suiteKicker, useFormatters, useSuite, useSuiteControls } from './useSuite';
import { MetricDrill } from './MetricDrill';
import type { Row, Suite } from './model';

const MEASURES = ['searches', 'saves', 'out', 'trips', 'attended', 'hosted'] as const;
type BMeasure = typeof MEASURES[number];

export function Behaviour() {
  const { period, setPeriod, source, setSource } = useSuiteControls();
  // A separate field from Overview's `measure`, deliberately: the handoff calls
  // a shared one out by name — "separate fields; a shared one leaves a tab with
  // no selection" — and these live in different addresses anyway.
  useStickyQuery('admin.suite.behaviour', ['measure', 'scope']);
  const [measure, setMeasure] = useQueryState<BMeasure>('measure', 'searches', asOneOf(MEASURES, 'searches'));
  const [scope, setScope] = useQueryState<'household' | 'estate'>('scope', 'household', asOneOf(['household', 'estate'] as const, 'household'));
  const [chart, setChart] = useQueryState<boolean>('chart', false, { read: (r) => r === '1', write: (v) => (v ? '1' : null) });

  const { suite, error, reading, reload } = useSuite(period, source);
  const fmt = useFormatters(suite, null);

  const scopeSwitch = (
    <Seg
      label="Per household or the whole estate"
      value={scope}
      options={[{ value: 'household', label: 'Per household' }, { value: 'estate', label: 'Estate total' }]}
      onChange={setScope}
    />
  );
  const controls = (
    <SuiteControls period={period} setPeriod={setPeriod} source={source} setSource={setSource}>
      {scopeSwitch}
    </SuiteControls>
  );

  if (error) {
    return <SuitePage><SuiteHead title="Behaviour" right={controls} /><Trouble says={error} onRetry={reload} /></SuitePage>;
  }
  if (!suite) {
    return <SuitePage><SuiteHead title="Behaviour" right={controls} /><Waiting says={reading ? 'Reading what households did…' : undefined} /></SuitePage>;
  }

  const estate = scope === 'estate';
  const base = suite.behaviour.base || 1;
  const selected = suite.behaviour.measures.find((m) => m.key === measure) ?? suite.behaviour.measures[0];

  /** A rate becomes an estate total by multiplying by the households it is a rate over. */
  const scaled = (v: number | null) => (v == null ? null : estate ? Math.round(v * base) : v);
  const say = (v: number | null) => (v == null ? null : estate ? fmt.plain.count(v) : fmt.plain.count(v, 2));

  if (chart) {
    return (
      <MetricDrill
        suite={suite}
        metric={measure}
        series={estate
          ? (suite.history.series[measure] ?? null)
          : (suite.history.series[measure] ?? null)?.map((v) => Math.round((v / base) * 100) / 100) ?? null}
        title={`${selected?.label ?? 'Searches'} · ${estate ? 'estate total' : 'per household'}`}
        unit="count"
        crumb="Behaviour"
        onBack={() => setChart(false)}
        period={period}
        controls={<SuiteControls period={period} setPeriod={setPeriod} source={source} setSource={setSource} />}
        scope={scopeSwitch}
        kicker={suiteKicker(source, period)}
      />
    );
  }

  const panel = suite.behaviour.panels[measure];

  return (
    <SuitePage>
      <SuiteHead title="Behaviour" kicker={suiteKicker(source, period)} right={controls} />

      {/* Six tiles, each the value and its change in lime, nothing else. */}
      {/* The denominator, under the figures it belongs to rather than as a
          paragraph at the foot after an unrelated band. */}
      <Text style={type.tiny}>
        {estate
          ? `The rate a household does, times the ${base.toLocaleString()} ${base === 1 ? 'household' : 'households'} that did anything in the period.`
          : `A month, over the ${base.toLocaleString()} ${base === 1 ? 'household' : 'households'} that did anything in the period.`}
      </Text>

      <TileGrid min={190}>
        {suite.behaviour.measures.map((m) => (
          <MeasureTile
            key={m.key}
            label={m.label}
            value={say(scaled(m.value))}
            delta={fmt.plain.delta(m.delta)}
            deltaDown={(m.delta ?? 0) < 0}
            series={m.series}
            selected={m.key === measure}
            onPress={() => setMeasure(m.key as BMeasure)}
          />
        ))}
      </TileGrid>

      <Band title={selected?.label ?? 'Searches'} onOpenChart={() => setChart(true)}>
        <Panels measure={measure} panel={panel} suite={suite} fmt={fmt} />
      </Band>

      <ReturnBand suite={suite} />

    </SuitePage>
  );
}

type Fmt = ReturnType<typeof useFormatters>;

/** The three panels the selected measure rebuilds. */
function Panels({ measure, panel, suite, fmt }: {
  measure: BMeasure;
  panel: Suite['behaviour']['panels'][string] | undefined;
  suite: Suite;
  fmt: Fmt;
}) {
  if (!panel) return <SuitePanel title="Nothing to show"><Gap says="Nothing has been recorded for this yet" /></SuitePanel>;

  const TITLES: Record<BMeasure, [string, string, string]> = {
    searches: ['What they searched for', 'What the search became', 'Did searching turn into a trip'],
    saves: ['What they save', 'What happens to a saved place', 'The list and whether they stay'],
    out: ['What they did', 'How many activities in a day', 'Was it rated'],
    trips: ['Where they went', 'What they added to the trip', 'How long they went for'],
    attended: ['What they went to', 'What shape the event was', 'What happened after'],
    hosted: ['What they run', 'How it sold', 'Becoming a host'],
  };
  const [a, b, c] = TITLES[measure];
  const said = (v: Row['value']) => (v == null ? null : typeof v === 'number' ? fmt.plain.count(v) : String(v));

  return (
    <>
      <SuitePanel title={a}>
        <Bars rows={panel.asked} format={said} />
      </SuitePanel>

      <SuitePanel title={b}>
        <Bars rows={panel.became} highlight={panel.becameHighlight} format={said} />
        {panel.becameFoot ? <Kv label={panel.becameFoot.label} value={said(panel.becameFoot.value)} strong last /> : null}
      </SuitePanel>

      <SuitePanel title={c}>
        {panel.funnel.map((r, i, all) => (
          <Kv
            key={r.label}
            label={r.label}
            value={said(r.value)}
            gap={panel.funnelGap ?? suite.gaps.churn}
            lime={i === 1}
            strong={i === all.length - 1}
            last={i === all.length - 1}
          />
        ))}
      </SuitePanel>
    </>
  );
}

/**
 * How often a household came back.
 *
 * Six bars drawn upward rather than a row of tracks, because the shape of the
 * distribution is the fact — a hump in the middle is a habit, a spike at the
 * left is a product nobody opened twice.
 */
function ReturnBand({ suite }: { suite: Suite }) {
  const { width } = useViewport();
  const buckets = suite.behaviour.returnBuckets;
  const max = Math.max(1, ...buckets.map((b) => Number(b.pct ?? 0)));
  const share = (b: Row) => (b.pct == null ? null : `${Math.round(Number(b.pct))}%`);

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.band}>
        <Text style={styles.bandTitle}>HOW OFTEN A HOUSEHOLD CAME BACK</Text>
      </View>
      <Text style={type.small}>
        {`Of the 13 weeks in a quarter, how many had at least one visit. Share of all ${suite.behaviour.returnBase.toLocaleString()} households.`}
      </Text>

      {/*
        Six columns on a wide screen, because the *shape* of the distribution is
        the fact — a hump in the middle is a habit, a spike at the left is a
        product nobody opened twice.

        On a phone the same six become rows. Six columns in a 390px frame is
        51px each, and "Opened before, not this quarter" cannot be read in 51px
        however it wraps (20 Sep 2026). A row keeps the label legible and the
        bar comparable, which is the whole of what the band is for.
      */}
      {width >= 900 ? (
        <View style={styles.buckets}>
          {buckets.map((b, i) => (
            <View key={b.label} style={styles.bucket}>
              <Text style={styles.bucketPct}>{share(b) ?? '—'}</Text>
              <View
                style={{
                  width: '100%',
                  height: Math.max(3, Math.round((Number(b.pct ?? 0) / max) * 170)),
                  backgroundColor: i === suite.behaviour.returnHighlight ? colors.lime : colors.decor,
                }}
              />
              <Text style={styles.bucketLabel} numberOfLines={3}>{b.label}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View>
          {buckets.map((b, i) => (
            <Bar
              key={b.label}
              label={b.label}
              value={share(b)}
              pct={max ? (Number(b.pct ?? 0) / max) * 100 : 0}
              high={i === suite.behaviour.returnHighlight}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { borderTopWidth: BORDER, borderTopColor: colors.lime, paddingTop: 9 },
  bandTitle: { fontFamily: type.title.fontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.lime },
  buckets: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  // `alignItems: stretch` rather than `center`: centred, the label shrank to
  // its own content width and then had nowhere to wrap to, so at 390px
  // "Opened before, not this quarter" was cut off mid-word (20 Sep 2026).
  bucket: { flex: 1, minWidth: 0, alignItems: 'stretch', gap: 6 },
  bucketPct: { fontFamily: type.title.fontFamily, fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  bucketLabel: { ...type.tiny, fontSize: 11, textAlign: 'center' },
});
