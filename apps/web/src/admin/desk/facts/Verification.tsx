/**
 * Verification: a health check (README v2 "Verification"; prototype `isQueue`).
 *
 * Its only job is to show that checking is running and flowing. A status line
 * (or a red banner when it has stalled or never run — and then nothing below
 * it), three chart cards, one line of secondary numbers, and the Sources
 * table, which is the only thing here that should ever need action. Every
 * number opens its drill-down. No button starts a job. The word is "Backlog",
 * never "Waiting".
 */

import React from 'react';
import { Text, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { Press } from '../../../components/press';
import { useViewport } from '../../../hooks/useViewport';
import { useCrumbs, useDeskGo, useDeskParam } from '../Desk';
import {
  AMBER, Dropdown, InfoTip, Kicker, LIME, Muted, ON_LIME, PageTitle, RED, T, TCell, THead, TRow, Table,
  ago, desk, fonts, n, tableWidth, tabular, type TCol,
} from '../kit';
import { DeskLineChart, countScale } from './Chart';
import { BackLink, Dot, FactTabs, LoadLine, SRC_NAME, Title, dur, plural, useDesk, weekday } from './shared';

// ---------------------------------------------------------------------------
// Shapes (apps/api/src/desk/verification.js)
// ---------------------------------------------------------------------------

type Point = { at: string; n: number };
type Status = { state: 'never' | 'stalled' | 'idle' | 'running'; lastAt: string | null; backlog: number; hours?: number };
type Source = {
  source: string; label: string; checked: number; answered: number; failingPct: number | null; status: string;
  /** Why Failing % cannot speak, where it is null. */
  failingWhy?: string | null;
  /** A quiet word beside a "—" status ("no family answers this week"). */
  note?: string | null;
};
type VerifResp = {
  status: Status;
  period: '24h' | '7d';
  backlog?: { now: number; oldestDays: number | null; oldestAt: string | null; series: Point[]; amber: boolean };
  confirmed?: { total: number; series: Point[]; amber: boolean };
  dropped?: { month: number; thisWeek: number; weekBefore: number; series: Point[]; amber: boolean };
  numbers?: { checked: number; notThere: number; nothingFound: number; conflicts: number };
  sources?: Source[];
};
type Item = { ref: string; feature: string; place: string | null; area: string | null; county: string | null; country: string | null; outcome: string; source: string | null; at: string };
type ItemsResp = { rows: Item[]; total: number; counties: string[]; countries: string[]; features: string[] };

type Period = '24h' | '7d';
/** A drill-down may also be this calendar month — Fact automations' header opens those. */
type DrillPeriod = Period | 'month';
const periodOf = (raw: string): Period => (raw === '24h' ? '24h' : '7d');
const drillPeriodOf = (raw: string): DrillPeriod => (raw === 'month' ? 'month' : periodOf(raw));

/** A drill-down's title and the line under it. */
function drillWords(view: string, src: string, period: DrillPeriod): { title: string; sub: string } {
  const p = period === 'month' ? 'this month' : period === '24h' ? 'last 24 hours' : 'last 7 days';
  if (src) {
    const name = SRC_NAME[src] ?? src;
    return view === 'answered'
      ? { title: `${name} · answered`, sub: 'Last 7 days · confirmed or not there' }
      : { title: `${name} · checked`, sub: 'Last 7 days' };
  }
  switch (view) {
    case 'backlog': return { title: 'Backlog', sub: 'Not yet checked · oldest first' };
    case 'confirmed': return { title: 'Confirmed', sub: period === 'month' ? 'This month' : `The ${p}` };
    case 'dropped': return { title: 'Dropped at 30 days', sub: 'This month · never confirmed or ruled out' };
    case 'checked': return { title: 'Checked', sub: `The ${p}` };
    case 'notThere': return { title: 'Not there', sub: `The ${p}` };
    case 'nothingFound': return { title: 'Nothing found', sub: period === 'month' ? 'This month' : `The ${p}` };
    default: return { title: 'Conflicts', sub: 'Our own sources disagree' };
  }
}

export function Verification() {
  const [view] = useDeskParam('view');
  const [src] = useDeskParam('src');
  const [periodRaw] = useDeskParam('period');
  const go = useDeskGo();
  // The trail ends at the state it shows: "Facts / Verification / Conflicts"
  // for a drill-down, as the prototype's does (audit CH.13).
  const drillTitle = view ? drillWords(view, src, drillPeriodOf(periodRaw)).title : null;
  useCrumbs(drillTitle
    ? [{ name: 'Facts', go: () => go('facts') }, { name: 'Verification', go: () => go('facts', { ftab: 'verification' }) }, { name: drillTitle }]
    : [{ name: 'Facts', go: () => go('facts') }, { name: 'Verification' }], [drillTitle]);
  return (
    <>
      <FactTabs on="verification" />
      {view ? <Drill view={view} src={src} period={drillPeriodOf(periodRaw)} /> : <Health period={periodOf(periodRaw)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// The health page
// ---------------------------------------------------------------------------

function Health({ period }: { period: Period }) {
  const go = useDeskGo();
  const narrow = useViewport().width < 900;
  const load = useDesk<VerifResp>('/verification', { period });
  const v = load.data;
  const open = (view: string, extra: Record<string, string | null> = {}) =>
    go('facts', { ftab: 'verification', view, period: period === '7d' ? null : period, ...extra });

  const st = v?.status;
  const line = !st ? '' : st.state === 'never' ? 'Never run · verification hasn’t checked anything yet'
    : st.state === 'stalled' ? `Stalled · nothing checked for ${plural(st.hours ?? 0, 'hour')}`
      : st.state === 'idle' ? `Idle · nothing to check · last checked ${ago(st.lastAt)}`
        : `Running · last checked ${ago(st.lastAt)}`;

  return (
    <>
      <View style={{ gap: 10, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18, zIndex: 20 }}>
        <PageTitle tipWidth={340} tip="Suggestions from searches are checked against our own sources automatically. This page shows it’s running and flowing. If something’s wrong, it goes red.">Verification</PageTitle>
        {st?.state === 'running' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Dot color={desk.link} size={9} />
            <Text style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: '800', color: desk.link }}>{line}</Text>
          </View>
        ) : st?.state === 'idle' ? (
          // Nothing waiting and nothing checked lately: quiet, not broken —
          // grey, and no banner (audit CH.3).
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Dot color={desk.inkDim} size={9} />
            <Text style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: desk.inkMuted }}>{line}</Text>
          </View>
        ) : null}
      </View>
      {!v ? <LoadLine load={load} what="Verification" /> : null}
      {st && (st.state === 'never' || st.state === 'stalled') ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: RED, paddingVertical: 14, paddingHorizontal: 18 }}>
          <Icon name="warning" size={18} color={ON_LIME} />
          <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 15, fontWeight: '800', color: ON_LIME }}>{line}</Text>
        </View>
      ) : null}
      {v && st && st.state !== 'never' && v.backlog && v.confirmed && v.dropped && v.numbers ? (
        <>
          <View style={{ gap: 12, marginTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <Kicker>Health</Kicker>
              <SmallSeg
                options={[{ key: '24h', name: 'Last 24 hours' }, { key: '7d', name: 'Last 7 days' }]}
                value={period}
                onChange={(p) => go('facts', { ftab: 'verification', period: p === '7d' ? null : p }, true)}
              />
            </View>
            <View style={{
              flexDirection: narrow ? 'column' : 'row', gap: 1, backgroundColor: desk.rule, borderWidth: 1, borderColor: desk.rule,
            }}>
              <Card
                label="Backlog" big={n(v.backlog.now)} warn={v.backlog.amber}
                sub={v.backlog.now && v.backlog.oldestAt ? `oldest ${dur((Date.now() - new Date(v.backlog.oldestAt).getTime()) / 60000)}` : ''}
                series={v.backlog.series.map((p) => p.n)} unit="in backlog" period={period} onBig={() => open('backlog')}
              />
              <Card
                label="Confirmed" big={n(v.confirmed.total)} warn={v.confirmed.amber} sub=""
                series={v.confirmed.series.map((p) => p.n)} unit="confirmed" period={period} onBig={() => open('confirmed')}
              />
              <Card
                label="Dropped at 30 days" big={n(v.dropped.month)} warn={v.dropped.amber}
                sub={`${v.dropped.thisWeek} this week · ${v.dropped.weekBefore} the week before`}
                series={v.dropped.series.map((p) => p.n)} unit="dropped" period={period} onBig={() => open('dropped')}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 18, flexWrap: 'wrap' }}>
              {([['Checked', 'checked', v.numbers.checked], ['Not there', 'notThere', v.numbers.notThere], ['Nothing found', 'nothingFound', v.numbers.nothingFound]] as const).map(([label, key, k]) => (
                <Press key={key} effect="none" onPress={() => open(key)}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>
                    {`${label} `}<Text style={[{ fontWeight: '700', color: desk.inkMuted }, tabular]}>{n(k)}</Text>
                  </Text>
                </Press>
              ))}
            </View>
          </View>
          <View style={{ marginTop: 12 }}>
            <View style={{ paddingBottom: 8 }}><Kicker>Sources</Kicker></View>
            <SourcesTable rows={v.sources ?? []} onOpen={(key, kind) => open(kind, { src: key, period: null })} />
          </View>
        </>
      ) : null}
    </>
  );
}

/** The period toggle and the like: the smaller segmented control (7px × 14px, 12.5px). */
export function SmallSeg<K extends string>({ options, value, onChange, padV = 7, padH = 14, size = 12.5 }: {
  options: { key: K; name: string }[]; value: K; onChange: (k: K) => void; padV?: number; padH?: number; size?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: desk.ruleStrong, alignSelf: 'flex-start' }}>
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <Press key={o.key} effect="none" onPress={() => onChange(o.key)}>
            <Text style={{
              paddingVertical: padV, paddingHorizontal: padH, fontFamily: fonts.body, fontSize: size, fontWeight: on ? '700' : '600',
              backgroundColor: on ? LIME : 'transparent', color: on ? ON_LIME : desk.inkDim, borderLeftWidth: i ? 1 : 0, borderLeftColor: desk.ruleStrong,
            }}>{o.name}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/** One chart card: the number that opens its drill-down, a line under it, the chart. */
function Card({ label, big, sub, warn, series, unit, period, onBig }: {
  label: string; big: string; sub: string; warn: boolean; series: number[]; unit: string; period: Period; onBig: () => void;
}) {
  const k = series.length;
  const now = new Date();
  const labels = series.map((_, i) => {
    if (period === '24h') {
      const hr = (now.getHours() - (k - 1 - i) + 48) % 24;
      return i % 6 === (k - 1) % 6 ? `${String(hr).padStart(2, '0')}:00` : '';
    }
    return i === k - 1 ? 'Today' : weekday(new Date(now.getTime() - (k - 1 - i) * 86400_000));
  });
  const when = (i: number) => (period === '24h'
    ? (i === k - 1 ? 'this hour' : `${k - 1 - i}h ago`)
    : (i === k - 1 ? 'today' : labels[i]));
  const scale = countScale(series);
  return (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: desk.ground, paddingTop: 16, paddingHorizontal: 18, paddingBottom: 12, gap: 10 }}>
      <Press effect="none" onPress={onBig}>
        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }}>{label}</Text>
          <Text style={[{ fontFamily: fonts.heading, fontSize: 34, fontWeight: '800', letterSpacing: -1.02, lineHeight: 34, color: warn ? AMBER : desk.ink }, tabular]}>{big}</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: warn ? AMBER : desk.inkDim, minHeight: 16 }}>{sub}</Text>
        </View>
      </Press>
      <DeskLineChart
        series={series} labels={labels} color={warn ? AMBER : desk.link} lo={scale.lo} hi={scale.hi}
        tip={(i) => `${series[i]} ${unit} · ${when(i)}`} height={96} axisWidth={24} gap={10}
      />
    </View>
  );
}

const SRC_COLS: TCol[] = [
  { key: 'name', name: 'Source', width: 200 }, { key: 'checked', name: 'Checked · 7 days', width: 150 },
  { key: 'answered', name: 'Answered', width: 150 }, { key: 'failing', name: 'Failing', width: 150 }, { key: 'status', name: 'Status', width: 150 },
];
/**
 * On a phone Status comes second, so the one column that may need action is
 * in view without scrolling the table sideways (audit, 28 Sep 2026).
 */
const SRC_COLS_PHONE: TCol[] = [
  { key: 'name', name: 'Source', width: 130 }, { key: 'status', name: 'Status', width: 150 },
  { key: 'checked', name: 'Checked · 7 days', width: 130 }, { key: 'answered', name: 'Answered', width: 100 }, { key: 'failing', name: 'Failing', width: 100 },
];

function SourcesTable({ rows, onOpen }: { rows: Source[]; onOpen: (source: string, kind: 'checked' | 'answered') => void }) {
  const phone = useViewport().width < 600;
  const cols = phone ? SRC_COLS_PHONE : SRC_COLS;
  const w = (key: string) => cols.find((x) => x.key === key)!.width;
  const tone = (s: string) => (s === 'Healthy' ? desk.link : s === 'Slow' ? AMBER : s === 'Failing' ? RED : desk.inkDim);
  return (
    <Table width={tableWidth(cols, 24)}>
      <THead cols={cols} gap={24} />
      {rows.map((r) => {
        const c = tone(r.status);
        const status = (
          <TCell key="status" width={w('status')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {r.status === '—' ? null : <Dot color={c} />}
              <T size={13} weight={r.status === '—' ? '500' : '800'} tone={c}>{r.status}</T>
            </View>
            {r.note ? <T size={12} tone={desk.inkDim}>{r.note}</T> : null}
          </TCell>
        );
        return (
          <TRow key={r.source} gap={24} vpad={12}>
            <TCell width={w('name')}><T weight="700">{SRC_NAME[r.source] ?? r.label}</T></TCell>
            {phone ? status : null}
            <TCell width={w('checked')}><Press effect="none" onPress={() => onOpen(r.source, 'checked')}><T num>{n(r.checked)}</T></Press></TCell>
            <TCell width={w('answered')}><Press effect="none" onPress={() => onOpen(r.source, 'answered')}><T num>{n(r.answered)}</T></Press></TCell>
            <TCell width={w('failing')}>
              {r.failingPct == null ? (
                // Can't speak: the check fetched nothing from this source, so
                // there is no failure rate to give — "—" and the reason.
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T num tone={desk.inkDim}>—</T>
                  {r.failingWhy ? <InfoTip text={r.failingWhy} size={13} width={260} /> : null}
                </View>
              ) : (
                <Press effect="none" onPress={() => onOpen(r.source, 'checked')}>
                  <T num weight={r.status === 'Healthy' ? '500' : '800'} tone={c}>{`${r.failingPct}%`}</T>
                </Press>
              )}
            </TCell>
            {phone ? null : status}
          </TRow>
        );
      })}
    </Table>
  );
}

// ---------------------------------------------------------------------------
// A drill-down
// ---------------------------------------------------------------------------

const DRILL_COLS: TCol[] = [
  { key: 'fact', name: 'Fact', width: 180 }, { key: 'place', name: 'Place', width: 230 }, { key: 'area', name: 'Area', width: 170 },
  { key: 'outcome', name: 'Outcome', width: 150 }, { key: 'when', name: 'When', width: 160 },
];

function Drill({ view, src, period }: { view: string; src: string; period: DrillPeriod }) {
  const go = useDeskGo();
  // The filters are part of the address (a filter replaces, never pushes).
  const [country, setCountryQ] = useDeskParam('country');
  const [county, setCountyQ] = useDeskParam('county');
  const [feature, setFeatureQ] = useDeskParam('feature');
  const setCountry = (v: string) => setCountryQ(v, { replace: true });
  const setCounty = (v: string) => setCountyQ(v, { replace: true });
  const setFeature = (v: string) => setFeatureQ(v, { replace: true });
  const load = useDesk<ItemsResp>('/verification/items', {
    kind: view, source: src || null, period: src ? '7d' : period,
    country: country || null, county: county || null, feature: feature || null,
  });
  const d = load.data;
  const words = drillWords(view, src, period);
  const tone = (o: string) => (o === 'Confirmed' ? desk.link : o === 'Nothing found' ? desk.inkDim : o === 'Backlog' ? desk.inkMuted : o === 'Dropped at 30 days' ? AMBER : desk.ink);
  return (
    <>
      <View style={{ gap: 8, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18 }}>
        <BackLink label="Verification" onPress={() => go('facts', { ftab: 'verification', period: period === '24h' ? period : null })} />
        <Title>{words.title}</Title>
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{d ? `${words.sub} · ${plural(d.total, 'item')}` : words.sub}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', zIndex: 15 }}>
        <Dropdown label={country || 'All countries'} value={country} options={[{ key: '', name: 'All countries' }, ...(d?.countries ?? []).map((x) => ({ key: x, name: x }))]} onChange={setCountry} maxHeight={300} />
        <Dropdown label={county || 'All counties'} value={county} options={[{ key: '', name: 'All counties' }, ...(d?.counties ?? []).map((x) => ({ key: x, name: x }))]} onChange={setCounty} maxHeight={300} />
        <Dropdown label={feature || 'All features'} value={feature} options={[{ key: '', name: 'All features' }, ...(d?.features ?? []).map((x) => ({ key: x, name: x }))]} onChange={setFeature} maxHeight={300} />
      </View>
      {!d ? <LoadLine load={load} what="These items" /> : (
        <Table width={tableWidth(DRILL_COLS)}>
          <THead cols={DRILL_COLS} />
          {d.rows.length === 0 ? <Muted>Nothing matches.</Muted> : d.rows.map((r, i) => (
            <TRow key={`${r.ref}|${r.feature}|${i}`}>
              <TCell width={180}><T weight="700">{r.feature}</T></TCell>
              <TCell width={230}><T size={13} tone={desk.inkMuted}>{r.place ?? 'A place we cannot name'}</T></TCell>
              <TCell width={170}><T size={13} tone={desk.inkMuted}>{r.area ?? '—'}</T></TCell>
              <TCell width={150}><T size={13} weight="700" tone={tone(r.outcome)}>{r.outcome}</T></TCell>
              <TCell width={160}><T size={12.5} tone={desk.inkDim}>{r.outcome === 'Backlog' ? `in backlog ${dur((Date.now() - new Date(r.at).getTime()) / 60000)}` : ago(r.at)}</T></TCell>
            </TRow>
          ))}
          {d.total > d.rows.length ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, paddingTop: 8 }}>{`The first ${n(d.rows.length)} of ${n(d.total)}`}</Text>
          ) : null}
        </Table>
      )}
    </>
  );
}
