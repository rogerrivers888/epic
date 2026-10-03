/**
 * Back office › Hosting › Reports (hosting v4, BO8n · BO8o · BO8p), each a
 * link (?rview=funnel|money|dac7):
 *  · funnel — drafts started, sent, live and booked, by Kind and by how the
 *    host answered step 1 (typed / said / uploaded), with the conversion;
 *  · money by month — twelve months, with the breakdown by Kind the handover
 *    adds (§3.9);
 *  · DAC7 — per host for a year, masked on screen; the file holds the full
 *    tax reference and address, so producing it is the owner's, personally,
 *    and logged. Anyone else is told, in the server's own words, to file it
 *    for approval.
 *
 * Each filter appears only on the view it changes: the money report is read
 * by Kind, the funnel by Visibility and dates, DAC7 by year. A filter that
 * moved nothing would be a control that lies.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../../api';
import { colors, type } from '../../theme';
import { useQueryState, asOneOf } from '../../router';
import { Dropdown, FilterRow } from '../kit';
import { Ladder, Num, Word, Blank, Act, Stat, Bar, type Col } from '../table';
import { Explain } from '../explain';
import { KIND_OPTIONS, KIND_WORDS, useLoad, useSorted, gbp } from './kit';
import { Band, Loading, Pct, Pounds, Said, TableHead, ViewSwitch, amber, red, pct, tip, useSortParam, monthOf, monthWords } from './Money';

type Step = { key: string; started: number; sent: number; live: number; booked: number };
type Funnel = { byKind: Step[]; byRoute: Step[] };
type MoneyRow = { month: string; lane: string; value: number; epic: number; host: number; n: number };
type Dac7 = { year: number; rows: { hostId: string; host: string; tax: string | null; considerationPence: number; feesPence: number; tipsPence: number; activities: number }[] };

const VIEWS = ['funnel', 'money', 'dac7'] as const;
type RView = typeof VIEWS[number];
const VIEW_WORDS = [{ key: 'funnel', label: 'Hosting funnel' }, { key: 'money', label: 'Money by month' }, { key: 'dac7', label: 'DAC7 export' }] as const;
const KINDS = ['oneoff', 'weekly', 'course', 'onrequest'] as const;

export function ReportsTab() {
  const [view, setView] = useQueryState<RView>('rview', 'funnel', asOneOf(VIEWS, 'funnel'));
  return (
    <View>
      <ViewSwitch value={view} options={VIEW_WORDS} onPick={(v) => setView(v, { replace: false })} />
      {view === 'funnel' ? <FunnelView /> : null}
      {view === 'money' ? <MoneyView /> : null}
      {view === 'dac7' ? <Dac7View /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// BO8n — the funnel
// ---------------------------------------------------------------------------

const VIS = ['all', 'public', 'private'] as const;
const VIS_WORDS: Record<string, string> = { all: 'All', public: 'Public', private: 'Private' };
const DATES = ['all', '30d', '90d', 'year', 'lastyear'] as const;
type Dates = typeof DATES[number];
const DATE_WORDS: Record<Dates, string> = { all: 'All time', '30d': 'Last 30 days', '90d': 'Last 90 days', year: 'This year', lastyear: 'Last year' };
const ROUTE_WORDS: Record<string, string> = { typed: 'Typed', said: 'Said', uploaded: 'Uploaded', upload: 'Uploaded', photo: 'Uploaded' };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** A range as the server reads it: `from` inclusive, `to` exclusive, both YYYY-MM-DD. */
function rangeOf(d: Dates): { from: string | null; to: string | null } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const tomorrow = ymd(new Date(now.getTime() + 86_400_000));
  if (d === '30d') return { from: ymd(new Date(now.getTime() - 30 * 86_400_000)), to: tomorrow };
  if (d === '90d') return { from: ymd(new Date(now.getTime() - 90 * 86_400_000)), to: tomorrow };
  if (d === 'year') return { from: `${y}-01-01`, to: tomorrow };
  if (d === 'lastyear') return { from: `${y - 1}-01-01`, to: `${y}-01-01` };
  return { from: null, to: null };
}

type FunnelRow = Step & { label: string; total?: boolean };

function FunnelView() {
  const [vis, setVis] = useQueryState<typeof VIS[number]>('rvis', 'all', asOneOf(VIS, 'all'));
  const [dates, setDates] = useQueryState<Dates>('rdates', 'all', asOneOf(DATES, 'all'));
  const { from, to } = rangeOf(dates);
  const { data, error, reload } = useLoad(() => api.hostingAdmin<Funnel>('/reports/funnel', { visibility: vis === 'all' ? null : vis, from, to }), [vis, from, to]);
  const k = useSortParam('fksort');
  const r = useSortParam('frsort');
  const value = (x: FunnelRow, key: string) => (key === 'label' ? x.label : key === 'conv' ? pct(x.booked, x.started) : (x as any)[key] as number);
  const byKind = useSorted<FunnelRow>(data?.byKind.map((x) => ({ ...x, label: KIND_WORDS[x.key] ?? x.key })), k.sort, k.desc, value);
  const byRoute = useSorted<FunnelRow>(data?.byRoute.map((x) => ({ ...x, label: ROUTE_WORDS[x.key] ?? x.key })), r.sort, r.desc, value);

  const all = (rows: Step[]): FunnelRow => ({
    key: 'total', label: 'All', total: true,
    started: rows.reduce((t, x) => t + x.started, 0), sent: rows.reduce((t, x) => t + x.sent, 0),
    live: rows.reduce((t, x) => t + x.live, 0), booked: rows.reduce((t, x) => t + x.booked, 0),
  });
  const total = data ? all(data.byKind) : null;

  const cols = (first: string, firstTip: string): Col<FunnelRow>[] => [
    { key: 'label', label: first, sort: 'label', grow: true, tip: tip(first, firstTip), cell: (x) => <Word strong={x.total}>{x.label}</Word> },
    { key: 'started', label: 'Started', sort: 'started', width: 110, align: 'right', tip: tip('Started', 'Drafts started: opened the wizard and saved step 1.'), cell: (x) => <Num n={x.started} strong={x.total} /> },
    { key: 'sent', label: 'Sent', sort: 'sent', width: 110, align: 'right', tip: tip('Sent', 'Sent for review.'),
      cell: (x) => <Num n={x.sent} strong={x.total} />, cellTip: (x) => stepTip('Sent', x.sent, x.started, 'of started') },
    { key: 'live', label: 'Live', sort: 'live', width: 110, align: 'right', tip: tip('Live', 'Went live.'),
      cell: (x) => <Num n={x.live} strong={x.total} />, cellTip: (x) => stepTip('Live', x.live, x.sent, 'of sent') },
    { key: 'booked', label: 'Booked', sort: 'booked', width: 110, align: 'right', tip: tip('Booked', 'Got at least one confirmed booking.'),
      cell: (x) => <Num n={x.booked} strong={x.total} />, cellTip: (x) => stepTip('Booked', x.booked, x.live, 'of live') },
    { key: 'conv', label: 'Started to booked', sort: 'conv', width: 160, align: 'right', tip: tip('Started to booked', 'Booked divided by started.'),
      cell: (x) => <Pct v={pct(x.booked, x.started)} strong={x.total} /> },
  ];

  return (
    <View style={{ gap: 18 }}>
      <Band kicker={`Hosting · Reports · ${DATE_WORDS[dates]}${vis === 'all' ? '' : ` · ${VIS_WORDS[vis]}`}`} title="Hosting funnel">
        <Stat label="Drafts started" value={total ? total.started.toLocaleString() : '—'} tip={tip('Drafts started', 'Opened the wizard and saved step 1.')} />
        <Stat label="Live" value={total ? total.live.toLocaleString() : '—'}
              tip={tip('Live', total && pct(total.live, total.started) != null ? `${pct(total.live, total.started)}% of drafts started.` : 'Went live.')} />
        <Stat label="Booked" value={total ? total.booked.toLocaleString() : '—'}
              tip={tip('Booked', total && pct(total.booked, total.live) != null ? `${pct(total.booked, total.live)}% of live.` : 'Got at least one confirmed booking.')} />
      </Band>
      <FilterRow>
        <Dropdown label="VISIBILITY" value={VIS_WORDS[vis]} width={180} options={VIS.map((v) => ({ key: v, label: VIS_WORDS[v], on: v === vis }))} onPick={(v) => setVis(v as typeof VIS[number])} />
        <Dropdown label="DATES" value={DATE_WORDS[dates]} width={200} options={DATES.map((d) => ({ key: d, label: DATE_WORDS[d], on: d === dates }))} onPick={(d) => setDates(d as Dates)} />
      </FilterRow>
      {!data || !total ? <Loading error={error} reload={reload} /> : (
        <View style={{ gap: 26 }}>
          <View>
            <TableHead tip={tip('By Kind', 'One-off, Weekly, Course or On request.')}>By Kind</TableHead>
            <Ladder columns={cols('Kind', 'One-off, Weekly, Course or On request.')} rows={data.byKind.length ? [...byKind, total] : []}
                    keyOf={(x) => x.key} sort={k.sort} desc={k.desc} onSort={k.onSort} empty={<Blank />} />
          </View>
          <View>
            <TableHead tip={tip('By step 1 route', 'How the host answered the first step: typed it, said it, or uploaded it.')}>By step 1 route</TableHead>
            <Ladder columns={cols('Route', 'How the host answered the first step.')} rows={data.byRoute.length ? [...byRoute, all(data.byRoute)] : []}
                    keyOf={(x) => x.key} sort={r.sort} desc={r.desc} onSort={r.onSort} empty={<Blank />} />
          </View>
        </View>
      )}
    </View>
  );
}

const stepTip = (title: string, n: number, of: number, words: string) => {
  const p = pct(n, of);
  return p == null ? null : tip(title, `${p}% ${words}.`);
};

// ---------------------------------------------------------------------------
// BO8o — money by month, with the breakdown by Kind
// ---------------------------------------------------------------------------

type MonthRow = { key: string; label: string; total?: boolean; n: number; value: number; epic: number; host: number; byKind: Record<string, number> };

/** The mix bar's strengths: one lime, darkest first, in KINDS order. */
const MIX_ALPHA = [0.95, 0.65, 0.4, 0.2];

function MoneyView() {
  const [kind, setKind] = useQueryState<string>('rkind', 'all', asOneOf(KIND_OPTIONS.map((x) => x.key), 'all'));
  const { data, error, reload } = useLoad(() => api.hostingAdmin<{ rows: MoneyRow[] }>('/reports/money', { kind: kind === 'all' ? null : kind }), [kind]);
  const m = useSortParam('omsort');
  const kk = useSortParam('oksort');

  const months: MonthRow[] = [];
  const kinds: MonthRow[] = [];
  for (const r of data?.rows ?? []) {
    let mo = months.find((x) => x.key === r.month);
    if (!mo) { mo = { key: r.month, label: monthWords(monthOf(r.month)), n: 0, value: 0, epic: 0, host: 0, byKind: {} }; months.push(mo); }
    let kd = kinds.find((x) => x.key === r.lane);
    if (!kd) { kd = { key: r.lane, label: KIND_WORDS[r.lane] ?? r.lane, n: 0, value: 0, epic: 0, host: 0, byKind: {} }; kinds.push(kd); }
    for (const row of [mo, kd]) { row.n += r.n; row.value += r.value; row.epic += r.epic; row.host += r.host; }
    mo.byKind[r.lane] = (mo.byKind[r.lane] ?? 0) + r.value;
  }
  const value = (x: MonthRow, key: string) => (key === 'label' ? x.key : key === 'rate' ? pct(x.epic, x.value) : key === 'mix' ? null : (x as any)[key] as number);
  const sortedMonths = useSorted(months, m.sort ?? 'label', m.sort ? m.desc : true, value);
  const sortedKinds = useSorted(kinds, kk.sort, kk.desc, (x, key) => (key === 'label' ? x.label : value(x, key)));
  const total: MonthRow = {
    key: 'total', label: 'Twelve months', total: true, byKind: {},
    n: months.reduce((t, x) => t + x.n, 0), value: months.reduce((t, x) => t + x.value, 0), epic: months.reduce((t, x) => t + x.epic, 0), host: months.reduce((t, x) => t + x.host, 0),
  };

  const figures = (first: string, firstTip: string, mix: boolean): Col<MonthRow>[] => [
    { key: 'label', label: first, sort: 'label', grow: true, tip: tip(first, firstTip), cell: (x) => <Word strong={x.total}>{x.label}</Word> },
    { key: 'n', label: 'Bookings', sort: 'n', width: 100, align: 'right', tip: tip('Bookings', 'Paid bookings made in the month, refunded ones included.'), cell: (x) => <Num n={x.n} strong={x.total} /> },
    { key: 'value', label: 'Booking value', sort: 'value', width: 140, align: 'right', tip: tip('Booking value', 'What guests paid.'), cell: (x) => <Pounds p={x.value} strong={x.total} /> },
    { key: 'epic', label: 'Epic took', sort: 'epic', width: 130, align: 'right', tip: tip('Epic took', 'Fees and commission on those bookings, at the rate stored on each.'), cell: (x) => <Pounds p={x.epic} strong={x.total} /> },
    { key: 'rate', label: 'Take rate', sort: 'rate', width: 100, align: 'right', tip: tip('Take rate', 'Epic took divided by booking value.'), cell: (x) => <Pct v={pct(x.epic, x.value)} strong={x.total} /> },
    { key: 'host', label: 'To hosts', sort: 'host', width: 130, align: 'right', tip: tip('To hosts', 'The hosts’ share of those bookings.'), cell: (x) => <Pounds p={x.host} strong={x.total} /> },
    ...(mix ? [{
      key: 'mix', label: 'By Kind', width: 180, tip: tip('By Kind', 'Booking value split by Kind: One-off darkest, then Weekly, Course, On request lightest. Hover a bar for the figures.'),
      cell: (x: MonthRow) => (x.total || !x.value ? <Blank /> : (
        <View style={{ width: '100%' }}>
          <Bar height={12} parts={KINDS.map((k, i) => ({ key: k, share: (x.byKind[k] ?? 0) / x.value, alpha: MIX_ALPHA[i] }))} />
        </View>
      )),
      cellTip: (x: MonthRow) => (x.total || !x.value ? null
        : tip(x.label, KINDS.filter((k) => x.byKind[k]).map((k) => `${KIND_WORDS[k]} ${gbp(x.byKind[k])}`).join(' · '))),
    }] : []),
  ];

  return (
    <View style={{ gap: 18 }}>
      <Band kicker={`Hosting · Reports · Last twelve months${kind === 'all' ? '' : ` · ${KIND_WORDS[kind]}`}`} title="Money by month">
        <Stat label="Booking value" value={data ? gbp(total.value) : '—'} tip={tip('Booking value', 'Twelve months.')} />
        <Stat label="Epic took" value={data ? gbp(total.epic) : '—'} tip={tip('Epic took', 'Twelve months.')} />
        <Stat label="Take rate" value={data && pct(total.epic, total.value) != null ? `${pct(total.epic, total.value)}%` : '—'} tip={tip('Take rate', 'Epic took divided by booking value.')} />
      </Band>
      <FilterRow>
        <Dropdown label="KIND" value={KIND_OPTIONS.find((x) => x.key === kind)?.label ?? 'All'} width={200}
                  options={KIND_OPTIONS.map((x) => ({ key: x.key, label: x.label, on: x.key === kind }))} onPick={setKind} />
      </FilterRow>
      {!data ? <Loading error={error} reload={reload} /> : (
        <View style={{ gap: 26 }}>
          <View>
            <TableHead tip={tip('By month', 'Calendar months, bookings by the day they were made.')}>By month</TableHead>
            <Ladder columns={figures('Month', 'Calendar month.', true)} rows={months.length ? [...sortedMonths, total] : []}
                    keyOf={(x) => x.key} sort={m.sort ?? 'label'} desc={m.sort ? m.desc : true} onSort={m.onSort} empty={<Blank />} />
          </View>
          <View>
            <TableHead tip={tip('By Kind', 'The same twelve months, by Kind.')}>By Kind</TableHead>
            <Ladder columns={figures('Kind', 'One-off, Weekly, Course or On request.', false)} rows={kinds.length ? [...sortedKinds, total] : []}
                    keyOf={(x) => x.key} sort={kk.sort} desc={kk.desc} onSort={kk.onSort} empty={<Blank />} />
          </View>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// BO8p — DAC7
// ---------------------------------------------------------------------------

type Dac7Row = Dac7['rows'][number] & { total?: boolean };

function Dac7View() {
  const thisYear = new Date().getUTCFullYear();
  // The server refuses a file before 2024.
  const years = Array.from({ length: Math.max(1, thisYear - 2024 + 1) }, (_, i) => String(thisYear - i));
  const [year, setYear] = useQueryState<string>('ryear', years[0], asOneOf(years, years[0]));
  const { data, error, reload } = useLoad(() => api.hostingAdmin<Dac7>('/reports/dac7', { year }), [year]);
  const d = useSortParam('dsort');
  const rows = useSorted<Dac7Row>(data?.rows, d.sort, d.desc, (x, k) => (
    k === 'host' ? x.host : k === 'tax' ? x.tax : k === 'consideration' ? x.considerationPence : k === 'fees' ? x.feesPence : k === 'tips' ? x.tipsPence : k === 'activities' ? x.activities : null));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; refused: boolean } | null>(null);

  const produce = async () => {
    setBusy(true); setSaid(null);
    try {
      await api.hostingDac7(Number(year));
      setSaid({ text: `epic-dac7-${year}.csv`, refused: false });
    } catch (e) {
      // The file holds tax numbers in full and downloads to whoever produces it, so it is never sent to Approvals:
      // a replay there would produce it, log it and lose it (Codex, 3 Oct 2026).
      if (e instanceof ApiError && e.code === 'needs_personal_sign_in') {
        setSaid({ text: 'Only the owner, signed in personally, can produce this file.', refused: true });
      } else setSaid({ text: e instanceof ApiError ? e.message : 'That didn’t produce the file.', refused: true });
    } finally { setBusy(false); }
  };

  const total: Dac7Row | null = data && data.rows.length ? {
    hostId: 'total', host: 'Total', tax: null, total: true,
    considerationPence: data.rows.reduce((t, x) => t + x.considerationPence, 0), feesPence: data.rows.reduce((t, x) => t + x.feesPence, 0),
    tipsPence: data.rows.reduce((t, x) => t + x.tipsPence, 0), activities: data.rows.reduce((t, x) => t + x.activities, 0),
  } : null;
  const missing = data ? data.rows.filter((x) => !x.tax).length : null;

  const cols: Col<Dac7Row>[] = [
    { key: 'host', label: 'Host', sort: 'host', grow: true, tip: tip('Host', 'Paid through Epic at least once in the year.'), cell: (x) => <Word strong={x.total}>{x.host}</Word> },
    { key: 'tax', label: 'Tax reference', sort: 'tax', width: 160, tip: tip('Tax reference', 'National Insurance number or UTR. Masked here, in full in the file.'),
      cell: (x) => (x.total ? <Blank /> : x.tax ? <Word>{x.tax}</Word> : <Said colour={amber()}>Missing</Said>) },
    { key: 'consideration', label: 'Paid by guests', sort: 'consideration', width: 150, align: 'right', tip: tip('Paid by guests', 'What guests paid for this host’s events in the year, less refunds.'),
      cell: (x) => <Pounds p={x.considerationPence} strong={x.total} /> },
    { key: 'fees', label: 'Fees and commissions', sort: 'fees', width: 180, align: 'right', tip: tip('Fees and commissions', 'What Epic kept from this host.'), cell: (x) => <Pounds p={x.feesPence} strong={x.total} /> },
    { key: 'tips', label: 'Tips', sort: 'tips', width: 110, align: 'right', tip: tip('Tips', 'Tips the host received, all of them theirs.'), cell: (x) => <Pounds p={x.tipsPence} strong={x.total} /> },
    { key: 'activities', label: 'Activities', sort: 'activities', width: 110, align: 'right', tip: tip('Activities', 'Paid bookings in the year.'), cell: (x) => <Num n={x.activities} strong={x.total} /> },
  ];

  return (
    <View style={{ gap: 18 }}>
      <Band kicker={`Hosting · Reports · Calendar year ${year}`} title="DAC7 export">
        <Stat label="Hosts" value={data ? data.rows.length.toLocaleString() : '—'} tip={tip('Hosts', 'Paid through Epic at least once in the year.')} />
        <Stat label="Missing tax details" value={missing == null ? '—' : <Text style={missing ? { color: amber() } : null}>{missing.toLocaleString()}</Text>}
              tip={tip('Missing tax details', 'Can’t be filed until each host adds them.')} />
        <Stat label="Paid by guests" value={total ? gbp(total.considerationPence) : '—'} tip={tip('Paid by guests', 'The year, less refunds.')} />
      </Band>
      <View style={s.bar}>
        <FilterRow>
          <Dropdown label="YEAR" value={year} width={140} options={years.map((y) => ({ key: y, label: y, on: y === year }))} onPick={setYear} />
        </FilterRow>
        <View style={{ flex: 1 }} />
        <Explain tip={tip('Produce CSV for HMRC', 'Only the owner, signed in personally: the file downloads to whoever produces it. The file holds tax numbers and addresses in full, and producing it is logged in Changes.')}>
          <Act label={busy ? 'Producing…' : 'Produce CSV for HMRC'} icon="locked" onPress={produce} disabled={busy || !data} />
        </Explain>
      </View>
      {said ? <Text style={[type.small, { color: said.refused ? red() : colors.inkMuted }]}>{said.text}</Text> : null}
      {!data ? <Loading error={error} reload={reload} />
        : <Ladder columns={cols} rows={total ? [...rows, total] : []} keyOf={(x) => x.hostId} sort={d.sort} desc={d.desc} onSort={d.onSort} empty={<Blank />} />}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
});
