/**
 * One supplier's record — what the integration is for, whether the pipe is
 * plugged in, and how it has behaved over the window. Then its spend chart, in
 * the standard drill shape.
 *
 * Also an editing screen (handoff §5a): the rate can be corrected or confirmed,
 * the credential rotated, and the adapter turned off. Four things worth saying
 * about how that is done.
 *
 *  · **Correcting a rate and confirming one are different acts.** A correction
 *    writes a new rate row with today's date; a confirmation stamps the row in
 *    force and writes nothing new. That is the whole reason both exist — "this
 *    changed six months ago" and "nobody has checked this in six months" are
 *    different facts, and the register can say either.
 *  · **"Rotate the credential" never touches the key.** It records the masked
 *    reminder and the date. The secret goes into Doppler by hand, which is the
 *    owner's to do (CLAUDE.md), and the API refuses anything that looks like a
 *    whole key rather than truncating it — truncating would mean it had been in
 *    a request body and a log already.
 *  · **Disable is the screen's one red control.** Red means danger here rather
 *    than brand, which is the one exception the pack keeps.
 *  · **Failures and response time are absent, not nought.** Nothing records
 *    whether a provider call came back or how long it took. A zero on a health
 *    panel would read as "nothing has ever failed", which is the most dangerous
 *    zero in the suite.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useViewport } from '../../hooks/useViewport';
import { api, ApiError } from '../../api';
import { colors, spacing, type } from '../../theme';
import { Gap, Kv, KvAction, KvField, Seg, SuiteHead, SuitePage, SuitePanel, Trouble, Waiting, onDay } from './pieces';
import { Plot } from './MetricDrill';
import { buildDrill, type DrillView, type RunRate } from './drill';
import { asOneOf, useQueryState } from '../../router';
import { useFormatters } from './useSuite';
import { formatter, type Currency, type PeriodKey, type Suite, type SupplierRecord as Record_ } from './model';

/**
 * The counterparties that are search sources, and therefore have an estate
 * switch behind them (`sources/index.js`).
 *
 * Held here as well as on the server because the *label* has to be right before
 * the button is pressed: the server's answer says whether the calls stopped,
 * which is one press too late to stop somebody believing they will.
 */
const SEARCH_SOURCES = new Set(['google-places', 'google-routes', 'tripadvisor', 'osm', 'openai']);

const WORDS: globalThis.Record<string, string> = {
  live: 'Live', degraded: 'Degraded', trial: 'Trial', off: 'Off',
  approved: 'Approved', evaluating: 'Evaluating', declined: 'Declined', retired: 'Retired',
  none: 'Not built', built: 'Built, not wired', wired: 'Wired, not live', enabled: 'Enabled',
  serve: 'serve', library: 'library', office: 'office', research: 'research',
};

const since = (iso: string | null | undefined) => {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  return months < 24 ? `${months} month${months === 1 ? '' : 's'} ago` : `${Math.round(months / 12)} years ago`;
};

export function SupplierRecord({
  suiteKey, period, source, crumb, onBack, controls, kicker, canManage, history,
}: {
  suiteKey: string;
  period: PeriodKey;
  source: 'real' | 'mock';
  crumb: string;
  onBack: () => void;
  controls?: React.ReactNode;
  kicker?: string | null;
  canManage: boolean;
  /** The twelve month labels and keys, which the chart needs and the record does not hold. */
  history: Suite['history'];
}) {
  // Never the window: the frame tells a screen it is 390px wide through this
  // hook, and anything reading `window` shows the desktop layout inside the
  // shell's phone frame (CLAUDE.md).
  const { width } = useViewport();
  const [record, setRecord] = useState<Record_ | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [rateEdit, setRateEdit] = useState<string | null>(null);
  const [credEdit, setCredEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [view, setView] = useQueryState<DrillView>('view', 'monthly', asOneOf(['monthly', 'quarterly'] as const, 'monthly'));
  const [runRate, setRunRate] = useQueryState<RunRate>('rate', '12', asOneOf(['3', '12'] as const, '12'));

  const load = useCallback(async () => {
    try {
      setRecord(await api.adminSuiteSupplier(suiteKey, { period, data: source }));
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof ApiError && e.status === 404 ? 'No such supplier.' : 'Could not reach Epic.');
    }
  }, [suiteKey, period, source]);
  useEffect(() => { void load(); }, [load]);

  const guard = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setTrouble(null);
    try { await work(); await load(); } catch (e: unknown) {
      setTrouble(e instanceof ApiError ? e.message : 'Could not reach Epic.');
    } finally { setBusy(false); }
  };

  const fmt = useFormatters(null, null);

  if (error) {
    return <SuitePage><SuiteHead crumb={crumb} onCrumb={onBack} title="Supplier" right={controls} /><Trouble says={error} onRetry={load} /></SuitePage>;
  }
  if (!record) {
    return <SuitePage><SuiteHead crumb={crumb} onCrumb={onBack} title="Supplier" right={controls} /><Waiting says="Reading the register…" /></SuitePage>;
  }

  const s = record.supplier;
  const h = record.health;
  // The health panel's own currency: metered spend is in dollars because that is
  // what the ledger recorded, and the mock estate is a British business in pounds.
  const spend = formatter({ currency: (h.currency ?? 'gbp') as Currency, perSub: null });

  const drill = buildDrill({
    series: record.series,
    labels: history.labels,
    keys: history.keys,
    view,
    runRate,
    period,
    unit: 'money',
  });
  const sign = h.currency === 'usd' ? '$' : '£';
  // Thousands abbreviate; below that it is whole units, because an axis label
  // of £879.94 is pence leaking onto a gridline (20 Sep 2026).
  const short = (v: number) => (v >= 1000
    ? `${sign}${(v / 1000).toFixed(1)}k`
    : `${sign}${Math.round(v).toLocaleString()}`);

  /**
   * Whether a change fits above a bar — the same rule as the metric drill, for
   * the same reason: a number cut in half is worse than no number. The record's
   * chart sits in a page that already has the rail and its own padding.
   */
  const plotWidth = (width - (width >= 900 ? 196 : 0) - (width >= 900 ? 52 : 24) - 54)
    / (width >= 1280 ? 2 : 1);
  const roomForChanges = plotWidth / Math.max(1, drill.past.bars.length) >= 38;

  const editable = canManage && source === 'real';
  /**
   * Whether turning the adapter off stops anything.
   *
   * True only where the counterparty is one of the search sources the estate
   * has a switch for. Everything else is an invoice, and no button in a back
   * office stops an invoice.
   */
  const stopsCalls = SEARCH_SOURCES.has(s.key);

  return (
    <SuitePage>
      <SuiteHead crumb={crumb} onCrumb={onBack} title={s.name} kicker={kicker} right={controls} />

      <View style={styles.panels}>
        {/* What it is for. The purpose is the panel's note rather than a row,
            because it is a sentence and a sentence in a value column wraps to
            four lines and pushes every figure below it out of line. */}
        <SuitePanel title="What it is for" note={s.purpose ?? undefined} grow={1.1}>
          <Kv label="Used by" value={s.usedBy} gap="Nobody has said" wide />
          <Kv label="Cost class" value={s.costClass ? WORDS[s.costClass] ?? s.costClass : null} gap="Not classified" wide />
          <Kv label="A unit is" value={s.unitName} gap="Not recorded" wide />
          {rateEdit == null
            ? <Kv label="Rate" value={s.rate?.says ?? null} gap="No rate recorded" strong wide />
            : <KvField label="Rate" value={rateEdit} onChange={setRateEdit} width={150} keyboard="default" placeholder="£0.26 each" />}
          <Kv
            label="Rate confirmed"
            value={s.rate?.confirmedAt ? `${since(s.rate.confirmedAt)}${s.rate.confirmedBy ? ` · ${s.rate.confirmedBy}` : ''}` : null}
            gap="Never confirmed"
            wide
          />
          {editable ? (
            rateEdit == null ? (
              <>
                <KvAction label="Edit the rate" action="Edit" onPress={() => setRateEdit(s.rate?.says ?? '')} />
                <KvAction
                  label="Confirm it is still right"
                  action={since(s.rate?.confirmedAt) === 'today' ? 'Confirmed today' : 'Confirm today'}
                  done={since(s.rate?.confirmedAt) === 'today' || busy}
                  onPress={() => guard(() => api.adminConfirmSupplierRate(s.key))}
                  last
                />
              </>
            ) : (
              <>
                <KvAction
                  label="Write a new rate row"
                  action={busy ? 'Saving…' : 'Save the rate'}
                  disabled={busy || !rateEdit.trim()}
                  onPress={() => guard(async () => {
                    await api.adminSetSupplierRate(s.key, { says: rateEdit.trim() });
                    setRateEdit(null);
                  })}
                />
                <KvAction label="Leave it as it was" action="Cancel" onPress={() => setRateEdit(null)} done last />
              </>
            )
          ) : (
            <Kv
              label="Changing the rate"
              value={null}
              gap={source === 'mock' ? 'Turn mock data off to change anything' : 'Needs manage_settings'}
              last
            />
          )}
        </SuitePanel>

        {/* Connection. */}
        <SuitePanel title="Connection" grow={1.1}>
          <Kv label="Status" value={WORDS[s.status] ?? s.status} strong lime={s.status === 'live'} wide />
          <Kv label="Adapter" value={WORDS[s.adapterState] ?? s.adapterState} wide />
          {credEdit == null
            ? <Kv label="Credential" value={s.credentialMasked} gap="None recorded" wide />
            : <KvField label="Credential, masked" value={credEdit} onChange={setCredEdit} width={170} keyboard="default" placeholder="sk-…9f2c" />}
          <Kv label="Expiry" value={s.credentialExpiry} gap="Not recorded" wide />
          <Kv label="Allowance" value={s.allowanceNote} gap="Not recorded" wide />
          {s.rotatedAt ? <Kv label="Last rotated" value={since(s.rotatedAt)} /> : null}

          {editable ? (
            credEdit == null ? (
              <>
                <KvAction label="Rotate the credential" action="Rotate" onPress={() => setCredEdit(s.credentialMasked ?? '')} />
                {/*
                  The label says what turning it off actually does, which is not
                  the same for every counterparty.

                  A search source — Google, OSM, TripAdvisor, the event feeds —
                  has an estate switch behind it, so off stops the calls. Fly.io,
                  Neon, Stripe and the app stores do not: off records that the
                  register says off, and the bill keeps arriving. Saying "stop
                  the calls" over the second kind is the lie this control used to
                  tell (20 Sep 2026).
                */}
                <KvAction
                  label={s.adapterState === 'enabled'
                    ? (stopsCalls ? 'Turn it off and stop the calls' : 'Mark the adapter off')
                    : (stopsCalls ? 'Turn it on and allow the calls' : 'Mark the adapter on')}
                  action={s.adapterState === 'enabled' ? 'Disable' : 'Enable'}
                  danger={s.adapterState === 'enabled'}
                  disabled={busy}
                  onPress={() => guard(() => api.adminSetSupplierAdapter(s.key, s.adapterState !== 'enabled'))}
                  last
                />
              </>
            ) : (
              <>
                <KvAction
                  label="Record the rotation"
                  action={busy ? 'Saving…' : 'Save'}
                  disabled={busy || !credEdit.trim()}
                  onPress={() => guard(async () => {
                    await api.adminRotateSupplierCredential(s.key, { masked: credEdit.trim() });
                    setCredEdit(null);
                  })}
                />
                <KvAction label="Leave it as it was" action="Cancel" onPress={() => setCredEdit(null)} done last />
              </>
            )
          ) : null}

          {credEdit != null ? (
            // The one place on this screen that needs a sentence, because the
            // field looks like somewhere to paste a key and must not be.
            <Text style={type.tiny}>
              The masked reminder only — the key itself goes in Doppler.
            </Text>
          ) : null}
        </SuitePanel>

        {/* Health and spend over the selected window. */}
        <SuitePanel title={`Health and spend · ${labelOf(period)}`}>
          <Kv label="Calls" value={fmt.plain.count(h.calls)} gap={h.gap ?? 'Not metered'} />
          <Kv
            label="Failed"
            // Of the calls whose outcome was actually watched, which is a
            // smaller number than the calls made until every adapter is
            // instrumented — so the row says which denominator it is over.
            value={h.failures == null
              ? null
              : `${h.failures.toLocaleString()} of ${(h.observed ?? h.calls ?? 0).toLocaleString()} · ${h.failurePct ?? 0}%`}
            gap={h.healthGap}
          />
          <Kv label="Response time" value={h.latency} gap={h.healthGap} />
          {h.lastFault ? <Kv label="Last fault" value={h.lastFault} /> : null}
          {h.unobserved ? (
            // Said plainly: this adapter has not been instrumented, so some of
            // its calls are simply not watched. Not the same as "they worked".
            <Kv
              label="Not watched"
              value={`${h.unobserved.toLocaleString()} ${h.unobserved === 1 ? 'call' : 'calls'}`}
            />
          ) : null}
          <Kv label="Spend" value={spend.money(h.spend)} gap={h.gap} strong />
          <Kv label="Expected" value={spend.money(h.expected)} gap={h.gap} />
          <Kv
            label="Variance"
            value={h.variance == null ? null : `${h.variance < 0 ? '−' : ''}${spend.money(Math.abs(h.variance))} (${h.variancePct == null ? '—' : `${h.variancePct < 0 ? '−' : ''}${Math.abs(h.variancePct)}%`})`}
            gap={h.varianceGap ?? h.gap}
            lime={(h.variancePct ?? 0) >= 15}
            last
          />
        </SuitePanel>
      </View>

      {trouble ? <Text style={styles.trouble}>{trouble}</Text> : null}

      {/* The spend chart, in the standard drill shape (§7). */}
      {drill.ok ? (
        <>
          {/* The three tiles §7 calls "the signed-off shape … use it for every
              metric drill": the selected period, and the two run rates. They
              were being computed and thrown away here, so the one drill reached
              from a table row was the only one without them (20 Sep 2026). */}
          <View style={styles.tiles}>
            {drill.tiles.map((t, i) => (
              <View key={t.label} style={[styles.tile, t.selected && styles.tileOn]}>
                <Text style={[styles.tileKicker, t.selected && { color: colors.accent }]}>{t.label.toUpperCase()}</Text>
                <Text style={styles.tileValue} numberOfLines={1}>
                  {i === 0
                    ? spend.money(t.value) ?? '—'
                    : `${t.value >= 0 ? '+' : '−'}${Math.abs(t.value).toFixed(i === 1 ? 1 : 2)}% ${view === 'quarterly' ? '/ qtr' : '/ mo'}`}
                </Text>
                {t.change ? <Text style={[styles.tileDelta, t.down && { color: colors.inkMuted }]}>{t.change}</Text> : null}
              </View>
            ))}
          </View>

          <View style={styles.rateRow}>
            <Text style={styles.kicker}>SPEND · {s.unitName?.toUpperCase() ?? 'PROVIDER CALL'}</Text>
            <View style={{ flex: 1 }} />
            <Seg
              label="How the months are grouped"
              value={view}
              options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }]}
              onChange={setView}
            />
            <Seg
              label="Which run rate the forecast uses"
              value={runRate}
              options={[{ value: '3', label: drill.rateLabels[0] }, { value: '12', label: drill.rateLabels[1] }]}
              onChange={setRunRate}
            />
          </View>
          <View style={[styles.charts, width < 1280 && { flexDirection: 'column' }]}>
            <Plot title={drill.past.title} bars={drill.past.bars} axis={drill.axis} label={short} withAxis changes={roomForChanges} />
            <View style={width < 1280 ? styles.ruleH : styles.rule} />
            <Plot title={drill.future.title} bars={drill.future.bars} axis={drill.axis} label={short} dashed changes={roomForChanges} />
          </View>
        </>
      ) : (
        <Gap says={h.gap ?? 'No spend has been recorded for this supplier yet.'} />
      )}

      {s.history.length > 1 ? (
        <SuitePanel title="Every rate it has been on">
          {s.history.map((r, i) => (
            <Kv
              key={`${r.from}-${i}`}
              label={`${on(r.from)}${r.to ? ` to ${on(r.to)}` : ' · in force'}`}
              value={r.says}
              strong={i === 0}
              last={i === s.history.length - 1}
            />
          ))}
        </SuitePanel>
      ) : null}
    </SuitePage>
  );
}

const on = (iso: string) => onDay(iso, { year: '2-digit' }) ?? '—';

const LABELS: globalThis.Record<PeriodKey, string> = {
  'last-30-days': 'Last 30 days', 'this-month': 'This month', 'last-month': 'Last month',
  'last-3-months': 'Last 3 months', 'last-12-months': 'Last 12 months',
};
const labelOf = (p: PeriodKey) => LABELS[p] ?? 'This month';

const styles = StyleSheet.create({
  panels: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' },
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
  tileKicker: { fontFamily: type.title.fontFamily, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.86, color: colors.inkMuted },
  tileValue: { fontFamily: type.title.fontFamily, fontSize: 30, lineHeight: 34, fontWeight: '800', color: colors.ink, letterSpacing: -1.1 },
  tileDelta: { fontFamily: type.title.fontFamily, fontSize: 12.5, fontWeight: '700', color: colors.accent },

  rateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  kicker: { fontFamily: type.title.fontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.inkMuted },
  charts: { flexDirection: 'row', gap: 22, alignItems: 'stretch', flexWrap: 'wrap' },
  rule: { width: 1, backgroundColor: colors.ruleMuted },
  ruleH: { height: 1, backgroundColor: colors.ruleMuted },
  trouble: { ...type.small, fontSize: 12.5, color: colors.overrun },
});
