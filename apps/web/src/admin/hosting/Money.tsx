/**
 * Back office › Hosting › Money (hosting v4, BO8h · BO8i · BO8j).
 *
 * Three views on one tab, each a link you can send (?mview=streams|ledger|payouts):
 *  · streams — each way Epic earns, counted on its own and never blended, with
 *    the Stripe reconciliation above and the guarantee pool below the total as
 *    a cost, because it is paid from Epic's share;
 *  · ledger — one row per movement, mismatches first (the server orders them);
 *  · payouts — waiting for confirmation, held with the reason, failed, refunds
 *    by cause, and ask-to-book card holds with the host's reply deadline.
 *
 * Payout rule (handover §5, which overrides the design's 48 hours): released
 * 72 hours after each session when nobody has complained, earlier on a guest's
 * "Yes, it happened" or a review (a setting, on); a complaint holds it; the
 * host's own attendance marks never release it.
 *
 * Every rate is the one stored on the booking at the time; nothing here
 * recomputes history from today's settings. Explanations live in hover tips
 * (§1); an empty cell is a dash.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { colors, desk, AMBER_DARK, getAdminThemePref, type, BORDER } from '../../theme';
import { useQueryState, asOneOf, asText } from '../../router';
import { Dropdown, FilterRow, Choice, TextAction } from '../kit';
import { Explain, type Tip } from '../explain';
import { Act, Ladder, Num, Word, Blank, Kicker, Stat, type Col } from '../table';
import { KIND_OPTIONS, amberTone, ownerAct, useLoad, useSorted, gbp, when } from './kit';
import { SearchBox } from './Hosts';

// ---------------------------------------------------------------------------
// shared by the Money, Safety and Reports tabs
// ---------------------------------------------------------------------------

/** A tip written in place. */
export const tip = (title: string, body: string): Tip => [title, body] as const;

/** Attention. The back office is dark by default; the light amber is unreadable on cream, so light mode takes the dark one. */
export const amber = amberTone;
/** Overdue, mismatch, refusal — and nothing else. */
export const red = () => colors.overrun;

/**
 * A column sort kept in the query as one value — `key` or `-key` — so a sorted
 * table is a link, and clicking the same header again reverses it.
 */
export function useSortParam(name: string) {
  const [raw, setRaw] = useQueryState<string>(name, '', asText);
  const desc = raw.startsWith('-');
  const sort = raw ? raw.replace(/^-/, '') : null;
  const onSort = (k: string) => setRaw(sort === k ? (desc ? k : `-${k}`) : k);
  return { sort, desc, onSort };
}

/** A figure in pounds, right-aligned; a dash for nothing. */
export const Pounds = ({ p, strong, colour, negative }: { p: number | null | undefined; strong?: boolean; colour?: string; negative?: boolean }) =>
  (p == null
    ? <Blank />
    : <Text style={[s.num, strong && s.strong, colour ? { color: colour } : null]}>{negative && p > 0 ? `−${gbp(p)}` : p < 0 ? `−${gbp(-p)}` : gbp(p)}</Text>);

/** A word in a colour that means something: amber attention, red refusal. */
export const Said = ({ children, colour, strong }: { children: React.ReactNode; colour?: string; strong?: boolean }) =>
  <Text style={[s.word, strong && s.strong, colour ? { color: colour, fontWeight: '700' } : null]}>{children}</Text>;

/** A share, one decimal; a dash when there is nothing to divide by. */
export const pct = (part: number | null | undefined, whole: number | null | undefined) =>
  (part == null || !whole ? null : Math.round((part / whole) * 1000) / 10);
export const Pct = ({ v, strong }: { v: number | null | undefined; strong?: boolean }) =>
  (v == null ? <Blank /> : <Text style={[s.num, strong && s.strong]}>{`${v}%`}</Text>);

/** The heading over a table: an uppercase kicker that explains itself, and a 2px rule. */
export function TableHead({ children, tip: t, right }: { children: string; tip?: Tip; right?: React.ReactNode }) {
  return (
    <View style={s.tableHead}>
      <Kicker tip={t}>{children}</Kicker>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

/** The band at the top of a view: kicker, the title, the figures to the right. */
export function Band({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <View style={s.band}>
      <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 5 }}>
        <Kicker>{kicker}</Kicker>
        <Text style={s.title}>{title}</Text>
      </View>
      {children ? <View style={s.stats}>{children}</View> : null}
    </View>
  );
}

/** A view switch: words on one line, the one you are in flat lime. */
export function ViewSwitch<K extends string>({ value, options, onPick }: { value: K; options: readonly { key: K; label: string }[]; onPick: (k: K) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
      {options.map((o) => <Choice key={o.key} label={o.label} on={value === o.key} onPress={() => onPick(o.key)} />)}
    </View>
  );
}

/** Loading, or why it did not: plain words, and a way to try again. */
export function Loading({ error, reload }: { error: string | null; reload: () => void }) {
  if (!error) return <View style={{ paddingVertical: 24 }}><ActivityIndicator color={colors.inkMuted} /></View>;
  return (
    <View style={s.error}>
      <Text style={[type.small, { color: colors.inkMuted }]}>{/^HTTP \d+$/.test(error) ? 'That didn’t load.' : `That didn’t load: ${error}`}</Text>
      <TextAction label="Try again" onPress={reload} />
    </View>
  );
}

/** The last twelve months, newest first, as `YYYY-MM`. */
export function lastMonths(n = 12) {
  const now = new Date();
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: monthWords(d) });
  }
  return out;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthWords = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const monthOf = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, 1)); };
const prevMonth = (key: string) => { const d = monthOf(key); const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}`; };

// ---------------------------------------------------------------------------
// payloads (routes/hostingAdmin.js)
// ---------------------------------------------------------------------------

type Stream = { key: string; stream: string; bookingValuePence: number | null; ratePct: number | null; count: number; epicPence: number; toHostsPence: number };
type Streams = {
  period: string;
  streams: Stream[];
  total: { epicPence: number; toHostsPence: number; count: number };
  guaranteePool: { pence: number } | null;
  refunded?: { count: number; pence: number };
  guaranteeClaims?: { count: number; pence: number };
  reconciliation: { ranAt: string; checked: number; mismatched: number } | null;
};
type Movement = {
  id: string; when: string; type: string; event: string | null; bookingId: string | null; ratePct: number | null;
  epicPence: number | null; toHostPence: number | null; amountPence: number; reason: string | null; state: string;
  stripe: 'matched' | 'mismatch' | 'pending' | 'not_checked' | null;
};
type Ledger = { rows: Movement[]; capped: boolean };
type Payout = { id: string; host: string; event: string | null; pence: number; releaseAt: string; tookPlace: string | null; confirmedBy: number; state: string; holdReason: string | null; since: string | null; releasedBy: string | null };
type Payouts = {
  capped: boolean; paid30: { count: number; pence: number };
  waitingForConfirmation: Payout[]; held: Payout[]; failed: Payout[];
  refundsByCause: { cause: string | null; state: string; count: number; pence: number }[];
  cardHolds: { bookingId: string; event: string | null; host: string; household: string; pence: number | null; replyBy: string | null }[];
  refundsNeedingAPerson?: { id: string; event: string | null; pence: number; cause: string | null; stripe: string | null; at: string }[];
};

// ---------------------------------------------------------------------------
// the tab
// ---------------------------------------------------------------------------

const VIEWS = ['streams', 'ledger', 'payouts'] as const;
type View_ = typeof VIEWS[number];
const VIEW_WORDS = [{ key: 'streams', label: 'Streams' }, { key: 'ledger', label: 'Ledger' }, { key: 'payouts', label: 'Payouts, refunds and holds' }] as const;

export function MoneyTab() {
  const [view, setView] = useQueryState<View_>('mview', 'streams', asOneOf(VIEWS, 'streams'));
  return (
    <View>
      <ViewSwitch value={view} options={VIEW_WORDS} onPick={(v) => setView(v, { replace: false })} />
      {view === 'streams' ? <StreamsView onLedger={() => setView('ledger', { replace: false })} /> : null}
      {view === 'ledger' ? <LedgerView /> : null}
      {view === 'payouts' ? <PayoutsView /> : null}
    </View>
  );
}

/** Month and period, shared by Streams and Ledger. */
function usePeriod() {
  const months = React.useMemo(() => lastMonths(12), []);
  const [month, setMonth] = useQueryState<string>('mmonth', months[0].key, asOneOf(months.map((m) => m.key), months[0].key));
  const [period, setPeriod] = useQueryState<'month' | '30d'>('mperiod', 'month', asOneOf(['month', '30d'] as const, 'month'));
  return { months, month, setMonth, period, setPeriod };
}

// ---------------------------------------------------------------------------
// BO8h — the streams
// ---------------------------------------------------------------------------

type StreamRow = Stream & { total?: boolean; last?: number | null; split?: boolean };

/** Streams that are not bookings on an event, so Kind cannot split them. */
const NOT_BY_KIND = new Set(['private_fee', 'pro', 'tips']);

function StreamsView({ onLedger }: { onLedger: () => void }) {
  const { months, month, setMonth, period, setPeriod } = usePeriod();
  const [kind, setKind] = useQueryState<string>('mkind', 'all', asOneOf(KIND_OPTIONS.map((k) => k.key), 'all'));
  const { sort, desc, onSort } = useSortParam('msort');
  const q = { month, period, kind: kind === 'all' ? null : kind };
  const { data, error, reload } = useLoad(() => api.hostingAdmin<Streams>('/money/streams', q), [month, period, kind]);
  const before = period === 'month' ? prevMonth(month) : null;
  const last = useLoad(() => (before ? api.hostingAdmin<Streams>('/money/streams', { ...q, month: before, period: 'month' }) : Promise.resolve(null)), [before, kind]);
  const beforeName = before ? MONTHS[monthOf(before).getUTCMonth()] : null;

  const byKind = kind !== 'all';
  const rows: StreamRow[] = (data?.streams ?? []).map((x) => {
    const split = byKind && NOT_BY_KIND.has(x.key);
    const prev = last.data?.streams.find((y) => y.key === x.key);
    return { ...x, split, last: split ? null : prev?.epicPence ?? null };
  });
  const sorted = useSorted(rows, sort, desc, (r, k) => (
    k === 'stream' ? r.stream : k === 'value' ? r.bookingValuePence : k === 'rate' ? r.ratePct : k === 'count' ? (r.split ? null : r.count)
      : k === 'epic' ? (r.split ? null : r.epicPence) : k === 'hosts' ? (r.split ? null : r.toHostsPence) : k === 'last' ? r.last : null));
  const counted = rows.filter((r) => !r.split);
  const sum = (f: (r: StreamRow) => number | null | undefined) => counted.reduce((t, r) => t + (f(r) ?? 0), 0);
  const value = sum((r) => r.bookingValuePence);
  const epic = sum((r) => r.epicPence);
  const hosts = sum((r) => r.toHostsPence);
  const total: StreamRow = {
    key: 'total', stream: 'Total', total: true, bookingValuePence: value, ratePct: pct(epic, value), count: sum((r) => r.count),
    epicPence: epic, toHostsPence: hosts, last: last.data ? sum((r) => r.last) : null,
  };

  const notByKind = tip('Not split by Kind', 'This stream is not a booking on an event, so Kind cannot divide it. Choose All to see it; it is left out of the total here.');
  const columns: Col<StreamRow>[] = [
    { key: 'stream', label: 'Stream', sort: 'stream', grow: true, tip: tip('Stream', 'Each way Epic earns, counted on its own and never blended.'),
      cell: (r) => <Word strong={r.total}>{r.stream}</Word> },
    { key: 'value', label: 'Booking value', sort: 'value', width: 140, align: 'right', tip: tip('Booking value', 'What guests paid that the rate applies to.'),
      cell: (r) => <Pounds p={r.split ? null : r.bookingValuePence} strong={r.total} />, cellTip: (r) => (r.split ? notByKind : null) },
    { key: 'rate', label: 'Rate', sort: 'rate', width: 200, align: 'right',
      tip: tip('Rate', 'Stored on each booking at the time it was made, never recomputed from today’s settings.'),
      cell: (r) => <Word strong={r.total}>{rateWords(r)}</Word>,
      cellTip: (r) => (r.split ? notByKind : r.key === 'public' ? tip('Each host’s own rate', 'Every host has their own rate, by rating: 20% to start, 15% after 5 rated events averaging 4.5+, 10% after 10 rated events averaging 4.8+; 5% on host-link bookings. This is the average across the period.')
        : r.total ? tip('Take rate', 'Epic took divided by booking value.') : null) },
    { key: 'count', label: 'Count', sort: 'count', width: 90, align: 'right', tip: tip('Count', 'How many charges.'),
      cell: (r) => <Num n={r.split ? null : r.count} strong={r.total} />, cellTip: (r) => (r.split ? notByKind : null) },
    { key: 'epic', label: 'Epic took', sort: 'epic', width: 130, align: 'right', tip: tip('Epic took', 'What Epic kept in the period.'),
      cell: (r) => <Pounds p={r.split ? null : r.epicPence} strong={r.total} />, cellTip: (r) => (r.split ? notByKind : null) },
    { key: 'hosts', label: 'To hosts', sort: 'hosts', width: 130, align: 'right', tip: tip('To hosts', 'What went to hosts from these bookings.'),
      // A fee or a subscription has no host side: a dash, not £0.00.
      cell: (r) => <Pounds p={r.split || r.key === 'private_fee' || r.key === 'pro' ? null : r.toHostsPence} strong={r.total} />,
      cellTip: (r) => (r.split ? notByKind : null) },
    ...(beforeName ? [{
      key: 'last', label: beforeName, sort: 'last', width: 120, align: 'right' as const, tip: tip(beforeName, `Epic took, ${beforeName}.`),
      cell: (r: StreamRow) => <Pounds p={r.last} strong={r.total} />,
    }] : []),
  ];

  const pool = data?.guaranteePool ?? null;
  const claims = data?.guaranteeClaims ?? null;
  const poolColumns: Col<{ key: string }>[] = [
    { key: 'stream', label: 'Stream', grow: true, tip: tip('Guarantee pool', 'Paid from Epic’s share, so it is a cost and sits under the total.'), cell: () => <Word>Guarantee pool</Word> },
    { key: 'value', label: 'Booking value', width: 140, align: 'right', tip: tip('Booking value', 'Not a booking.'), cell: () => <Blank /> },
    { key: 'rate', label: 'Rate', width: 200, align: 'right', tip: tip('Guarantee pool', 'Set in Settings. Anything that depends on it shows a dash until it is set.'),
      cell: () => (pool ? <Blank /> : <Said colour={amber()}>To set</Said>) },
    { key: 'count', label: 'Count', width: 90, align: 'right', tip: tip('Count', 'Guarantee claims paid in the period.'), cell: () => (claims?.count ? <Num n={claims.count} /> : <Blank />) },
    { key: 'epic', label: 'Epic took', width: 130, align: 'right', tip: tip('Guarantee pool', 'Claims paid to guests in the period, from Epic’s share.'),
      cell: () => <Pounds p={claims?.count ? claims.pence : null} negative /> },
    { key: 'hosts', label: 'To hosts', width: 130, align: 'right', tip: tip('To hosts', 'Claims are paid to guests, not hosts.'), cell: () => <Blank /> },
    ...(beforeName ? [{ key: 'last', label: beforeName, width: 120, align: 'right' as const, tip: tip(beforeName, 'Not recorded by month.'), cell: () => <Blank /> }] : []),
  ];

  const periodName = period === '30d' ? 'Last 30 days' : months.find((m) => m.key === month)?.label ?? month;
  return (
    <View style={{ gap: 18 }}>
      <Band kicker={`Hosting · Money · ${periodName}`} title={data ? `${gbp(epic)} to Epic` : 'Money'}>
        <Stat label="Booking value" value={data ? gbp(value) : '—'} tip={tip('Booking value', 'Everything guests paid for hosted events in the period.')} />
        <Stat label="Epic took" value={data ? gbp(epic) : '—'} tip={tip('Epic took', 'Fees and commission Epic kept.')} />
        <Stat label="Take rate" value={total.ratePct == null || !data ? '—' : `${total.ratePct}%`} tip={tip('Take rate', 'Epic took divided by booking value.')} />
        <Stat label="To hosts" value={data ? gbp(hosts) : '—'} tip={tip('To hosts', 'What went to hosts from these bookings.')} />
        <Stat label="Refunded" value={data?.refunded?.count ? gbp(data.refunded.pence) : '—'} tip={tip('Refunded', `${data?.refunded?.count ?? 0} refunds Stripe made in the period, every cause.`)} />
      </Band>

      <FilterRow>
        {period === 'month'
          ? <Dropdown label="MONTH" value={periodName} width={220} options={months.map((m) => ({ key: m.key, label: m.label, on: m.key === month }))} onPick={setMonth} />
          : null}
        <Dropdown label="PERIOD" value={period === '30d' ? '30 days' : 'Monthly'} width={180}
                  options={[{ key: 'month', label: 'Monthly', on: period === 'month' }, { key: '30d', label: '30 days', on: period === '30d' }]}
                  onPick={(k) => setPeriod(k as 'month' | '30d')} />
        <Dropdown label="KIND" value={KIND_OPTIONS.find((k) => k.key === kind)?.label ?? 'All'} width={200}
                  options={KIND_OPTIONS.map((k) => ({ key: k.key, label: k.label, on: k.key === kind }))} onPick={setKind} />
      </FilterRow>

      <Reconciliation rec={data?.reconciliation} loaded={Boolean(data)} onLedger={onLedger} />

      {!data ? <Loading error={error} reload={reload} /> : (
        <View>
          <Ladder columns={columns} rows={[...sorted, total]} keyOf={(r) => r.key} sort={sort} desc={desc} onSort={onSort} />
          <View style={{ marginTop: 22 }}>
            <TableHead tip={tip('Cost · paid from Epic’s share', 'The guarantee pool is paid from what Epic took, so it is a cost, not a stream.')}>Cost · paid from Epic’s share</TableHead>
            <Ladder columns={poolColumns} rows={[{ key: 'pool' }]} keyOf={(r) => r.key} />
          </View>
        </View>
      )}
    </View>
  );
}

function rateWords(r: StreamRow): React.ReactNode {
  if (r.split) return <Blank />;
  if (r.total) return r.ratePct == null ? <Blank /> : `${r.ratePct}%`;
  if (r.key === 'public') return r.ratePct == null ? 'Each host’s own' : `Each host’s own · avg ${r.ratePct}%`;
  // A fee charged per event or per month: what it came to each, from the rows themselves.
  if (r.key === 'private_fee') return r.count ? `${gbp(Math.round(r.epicPence / r.count))} an event` : <Blank />;
  if (r.key === 'pro') return r.count ? `${gbp(Math.round(r.epicPence / r.count))} a month` : <Blank />;
  return r.ratePct == null ? <Blank /> : `${r.ratePct}%`;
}

/** Our ledger against Stripe, the latest daily run. Red when anything is mismatched; a dash when it has never run. */
function Reconciliation({ rec, loaded, onLedger }: { rec: Streams['reconciliation'] | undefined; loaded: boolean; onLedger: () => void }) {
  const bad = (rec?.mismatched ?? 0) > 0;
  return (
    <View style={[s.strip, bad && { borderTopColor: red(), borderBottomColor: red() }]}>
      <Kicker tip={tip('Reconciliation', 'Our ledger against Stripe, every day. Stripe is the source of truth.')}>
        {rec ? `Stripe · ${when(rec.ranAt, true)}` : 'Stripe'}
      </Kicker>
      {!loaded ? null : !rec ? (
        <Explain tip={tip('Reconciliation', 'It has not run yet, so nothing has been checked.')}><Blank /></Explain>
      ) : (
        <>
          <Explain tip={tip('Matched', 'Movements the last run found the same in Stripe.')}>
            <Text style={s.stripWord}>{`Matched ${Math.max(0, rec.checked - rec.mismatched).toLocaleString()}`}</Text>
          </Explain>
          <Explain tip={tip('Mismatch', 'Different in Stripe. Stripe wins.')}>
            <Text style={[s.stripWord, bad && { color: red(), fontWeight: '700' }]}>{`Mismatch ${rec.mismatched.toLocaleString()}`}</Text>
          </Explain>
          {bad ? <TextAction label={`See the ${rec.mismatched.toLocaleString()}`} onPress={onLedger} /> : null}
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// BO8i — the ledger
// ---------------------------------------------------------------------------

const TYPE_WORDS: Record<string, string> = {
  charge: 'Booking', refund: 'Refund', payout: 'Payout', hold: 'Card hold', release: 'Hold released',
  private_fee: 'Private event fee', pro: 'Pro', tip: 'Tip',
};
const TYPE_OPTIONS = [{ key: 'all', label: 'All' }, ...Object.entries(TYPE_WORDS).map(([key, label]) => ({ key, label }))];
const REASON_WORDS: Record<string, string> = {
  standard: 'Host’s own rate', override: 'Fee override', minimum: 'Minimum fee', host_link: 'Host link', intro: 'Intro 0%',
  private_payment: 'Private payment fee', free: 'Free',
  guest_cancelled: 'Guest cancelled', host_cancelled: 'Host cancelled', called_off: 'Called off', date_changed: 'Date changed',
  numbers_settled: 'Depends-on-numbers difference', declined: 'Ask to book declined', lapsed: 'Ask to book not answered', complaint: 'Complaint',
};
export const reasonWords = (r: string | null | undefined) => (r ? REASON_WORDS[r] ?? r.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null);
const STRIPE_WORDS: Record<string, string> = { matched: 'Matched', mismatch: 'Mismatch', pending: 'Pending', not_checked: 'Not checked' };

function LedgerView() {
  const { months, month, setMonth, period, setPeriod } = usePeriod();
  const [typ, setTyp] = useQueryState<string>('mtype', 'all', asOneOf(TYPE_OPTIONS.map((t) => t.key), 'all'));
  const [match, setMatch] = useQueryState<string>('mstripe', 'all', asOneOf(['all', 'mismatch', 'matched'], 'all'));
  const [q, setQ] = useQueryState<string>('mq', '', asText);
  const { sort, desc, onSort } = useSortParam('lsort');
  const { data, error, reload } = useLoad(() => api.hostingAdmin<Ledger>('/money/ledger', { month, period, type: typ === 'all' ? null : typ, stripe: match === 'all' ? null : match, q: q || null }), [month, period, typ, match, q]);
  const sorted = useSorted(data?.rows, sort, desc, (r, k) => (
    k === 'when' ? r.when : k === 'type' ? TYPE_WORDS[r.type] ?? r.type : k === 'event' ? r.event : k === 'booking' ? bookingOf(r) : k === 'rate' ? r.ratePct
      : k === 'epic' ? r.epicPence : k === 'host' ? hostOf(r) : k === 'reason' ? reasonWords(r.reason) : k === 'stripe' ? r.stripe : null));
  const matched = data?.rows.filter((r) => r.stripe === 'matched').length ?? null;
  const mismatched = data?.rows.filter((r) => r.stripe === 'mismatch').length ?? null;

  const columns: Col<Movement>[] = [
    { key: 'when', label: 'When', sort: 'when', width: 120, tip: tip('When', 'When it moved.'), cell: (r) => <Word>{when(r.when, true)}</Word> },
    { key: 'type', label: 'Type', sort: 'type', width: 140, tip: tip('Type', 'Booking, refund, payout, card hold, fee, Pro or tip.'),
      cell: (r) => <Word>{TYPE_WORDS[r.type] ?? r.type}</Word> },
    { key: 'event', label: 'Event', sort: 'event', grow: true, tip: tip('Event', 'Which event.'), cell: (r) => (r.event ? <Word>{r.event}</Word> : <Blank />) },
    { key: 'booking', label: 'Booking', sort: 'booking', width: 110, align: 'right', tip: tip('Booking', 'What the guest paid, or what went back to them.'),
      cell: (r) => <Pounds p={bookingOf(r)} /> },
    { key: 'rate', label: 'Rate', sort: 'rate', width: 70, align: 'right', tip: tip('Rate', 'The host’s rate on this booking, stored when it was made.'),
      cell: (r) => (r.ratePct == null ? <Blank /> : <Text style={s.num}>{`${r.ratePct}%`}</Text>) },
    { key: 'epic', label: 'Epic took', sort: 'epic', width: 110, align: 'right', tip: tip('Epic took', 'What Epic kept from it.'),
      cell: (r) => <Pounds p={r.epicPence ?? (r.type === 'private_fee' || r.type === 'pro' ? r.amountPence : null)} /> },
    { key: 'host', label: 'To host', sort: 'host', width: 110, align: 'right', tip: tip('To host', 'What the host gets from it.'), cell: (r) => <Pounds p={hostOf(r)} /> },
    { key: 'reason', label: 'Reason', sort: 'reason', width: 220, tip: tip('Reason', 'Why it moved.'),
      cell: (r) => (reasonWords(r.reason) ? <Word>{reasonWords(r.reason)}</Word> : <Blank />) },
    { key: 'stripe', label: 'Stripe', sort: 'stripe', width: 110, tip: tip('Stripe', 'Whether Stripe shows the same movement. A dash when nothing was sent to Stripe.'),
      cell: (r) => (r.stripe == null ? <Blank />
        : <Said colour={r.stripe === 'mismatch' ? red() : r.stripe === 'pending' ? amber() : undefined}>{STRIPE_WORDS[r.stripe] ?? r.stripe}</Said>) },
  ];

  const periodName = period === '30d' ? 'Last 30 days' : months.find((m) => m.key === month)?.label ?? month;
  return (
    <View style={{ gap: 18 }}>
      <Band kicker={`Hosting · Money · Ledger · ${periodName}`} title="Every movement">
        <Stat label="Movements" value={data ? `${data.rows.length.toLocaleString()}${data.capped ? '+' : ''}` : '—'}
              tip={tip('Movements', data?.capped ? 'The first 1,000 in the period; there are more.' : 'In the period.')} />
        <Stat label="Matched" value={matched == null ? '—' : matched.toLocaleString()} tip={tip('Matched', 'Same amount, same time, in Stripe.')} />
        <Stat label="Mismatch" value={mismatched == null ? '—' : <Text style={mismatched ? { color: red() } : null}>{mismatched.toLocaleString()}</Text>}
              tip={tip('Mismatch', 'Different in Stripe. Stripe wins.')} />
      </Band>
      <FilterRow>
        <Dropdown label="TYPE" value={TYPE_OPTIONS.find((t) => t.key === typ)?.label ?? 'All'} width={220}
                  options={TYPE_OPTIONS.map((t) => ({ key: t.key, label: t.label, on: t.key === typ }))} onPick={setTyp} />
        <Dropdown label="STRIPE" value={match === 'all' ? 'All' : STRIPE_WORDS[match]} width={180}
                  options={[{ key: 'all', label: 'All', on: match === 'all' }, { key: 'mismatch', label: 'Mismatch', on: match === 'mismatch' }, { key: 'matched', label: 'Matched', on: match === 'matched' }]} onPick={setMatch} />
        {period === 'month'
          ? <Dropdown label="MONTH" value={periodName} width={220} options={months.map((m) => ({ key: m.key, label: m.label, on: m.key === month }))} onPick={setMonth} />
          : null}
        <Dropdown label="PERIOD" value={period === '30d' ? '30 days' : 'Monthly'} width={180}
                  options={[{ key: 'month', label: 'Monthly', on: period === 'month' }, { key: '30d', label: '30 days', on: period === '30d' }]}
                  onPick={(k) => setPeriod(k as 'month' | '30d')} />
        <SearchBox value={q} onCommit={(v) => setQ(v)} placeholder="Event, host or booking" />
      </FilterRow>
      {!data ? <Loading error={error} reload={reload} />
        : <Ladder columns={columns} rows={sorted} keyOf={(r) => r.id} sort={sort} desc={desc} onSort={onSort} dense empty={<Blank />} />}
    </View>
  );
}

/** A guest's side of a movement: paid in, or sent back (negative). */
function bookingOf(r: Movement): number | null {
  if (r.type === 'charge' || r.type === 'hold') return r.amountPence;
  if (r.type === 'refund' || r.type === 'release') return -r.amountPence;
  return null;
}
/** The host's side: their share, or the payout itself. */
function hostOf(r: Movement): number | null {
  if (r.toHostPence != null) return r.toHostPence;
  if (r.type === 'payout') return r.amountPence;
  return null;
}

// ---------------------------------------------------------------------------
// BO8j — payouts, refunds and card holds
// ---------------------------------------------------------------------------

const PAYOUT_RULE = 'Released 72 hours after the session if nobody has complained; earlier when a guest says “Yes, it happened” or leaves a review. A complaint holds it. The host’s own attendance marks never release it.';
const HOLD_WORDS: Record<string, string> = {
  complaint: 'A complaint is open', tax_details: 'No tax details on file', stripe_incomplete: 'Stripe set-up incomplete',
  not_set: 'Waiting on a setting', no_end: 'Session has no end time',
};
const REFUND_STATE: Record<string, string> = { succeeded: 'Refunded', pending: 'Pending', failed: 'Failed', cancelled: 'Cancelled' };

function PayoutsView() {
  const { data, error, reload } = useLoad(() => api.hostingAdmin<Payouts>('/money/payouts'), []);
  const [said, setSaid] = React.useState<{ ok: boolean; words: string } | null>(null);
  const [releasing, setReleasing] = React.useState<Payout | null>(null);
  const [why, setWhy] = React.useState('');
  const n = useSortParam('nsort');
  type Stuck = NonNullable<Payouts['refundsNeedingAPerson']>[number];
  const stuck = useSorted<Stuck>(data?.refundsNeedingAPerson, n.sort, n.desc, (x, k) => (k === 'event' ? x.event : k === 'amount' ? x.pence : k === 'stripe' ? x.stripe : k === 'when' ? x.at : null));
  const act = (p: Promise<'done' | 'filed'>, done: string) => {
    setSaid(null);
    p.then((out) => { setSaid({ ok: true, words: out === 'filed' ? 'Sent to Approvals' : done }); setReleasing(null); setWhy(''); reload(); })
      .catch((e) => setSaid({ ok: false, words: e?.message ?? 'That didn’t go through.' }));
  };
  const w = useSortParam('wsort');
  const h = useSortParam('hsort');
  const f = useSortParam('fsort');
  const r = useSortParam('rsort');
  const c = useSortParam('csort');
  const payVal = (p: Payout, k: string) => (k === 'host' ? p.host : k === 'event' ? p.event : k === 'amount' ? p.pence : k === 'pays' ? p.releaseAt : k === 'took' ? p.tookPlace : k === 'since' ? p.since : k === 'confirmed' ? p.confirmedBy : k === 'reason' ? HOLD_WORDS[p.holdReason ?? ''] ?? p.holdReason : null);
  const waiting = useSorted(data?.waitingForConfirmation, w.sort, w.desc, payVal);
  const held = useSorted(data?.held, h.sort, h.desc, payVal);
  const failed = useSorted(data?.failed, f.sort, f.desc, payVal);
  type RefundRow = Payouts['refundsByCause'][number] & { total?: boolean };
  const refunds = useSorted<RefundRow>(data?.refundsByCause, r.sort, r.desc, (x, k) => (k === 'cause' ? reasonWords(x.cause) : k === 'state' ? x.state : k === 'count' ? x.count : k === 'amount' ? x.pence : null));
  const holds = useSorted(data?.cardHolds, c.sort, c.desc, (x, k) => (k === 'event' ? x.event : k === 'host' ? x.host : k === 'household' ? x.household : k === 'held' ? x.pence : k === 'by' ? x.replyBy : null));
  const now = Date.now();

  if (!data) return <Loading error={error} reload={reload} />;

  const host: Col<Payout> = { key: 'host', label: 'Host', sort: 'host', width: 190, tip: tip('Host', 'Whose payout.'), cell: (p) => <Word>{p.host}</Word> };
  const event: Col<Payout> = { key: 'event', label: 'Event', sort: 'event', grow: true, tip: tip('Event', 'Which event.'), cell: (p) => (p.event ? <Word>{p.event}</Word> : <Blank />) };
  const amount = (t: string): Col<Payout> => ({ key: 'amount', label: 'Amount', sort: 'amount', width: 120, align: 'right', tip: tip('Amount', t), cell: (p) => <Pounds p={p.pence} /> });

  const waitingCols: Col<Payout>[] = [
    host, event,
    { key: 'took', label: 'Took place', sort: 'took', width: 140, tip: tip('Took place', 'When the session ended.'), cell: (p) => (p.tookPlace ? <Word>{when(p.tookPlace, true)}</Word> : <Blank />) },
    { key: 'confirmed', label: 'Confirmed by', sort: 'confirmed', width: 130, align: 'right', tip: tip('Confirmed by', 'Guests who said it happened. One is enough to release it early; a dash is nobody yet.'), cell: (p) => (p.confirmedBy ? <Num n={p.confirmedBy} /> : <Blank />) },
    { key: 'pays', label: 'Pays', sort: 'pays', width: 220, tip: tip('Pays', PAYOUT_RULE),
      cell: (p) => <Word>{`${when(p.releaseAt, true)}, if no complaint`}</Word> },
    amount('Due to the host, tips included.'),
  ];
  const heldCols: Col<Payout>[] = [
    host, event,
    { key: 'reason', label: 'Reason', sort: 'reason', width: 220, tip: tip('Reason', 'Why it is held. A complaint holds it until resolved; missing tax details or an incomplete Stripe set-up hold it until the host adds them.'),
      cell: (p) => (p.holdReason ? <Said colour={amber()}>{HOLD_WORDS[p.holdReason] ?? reasonWords(p.holdReason)}</Said> : <Blank />) },
    { key: 'since', label: 'Since', sort: 'since', width: 130, tip: tip('Since', 'When the hold began: the complaint, or the payout falling due.'), cell: (p) => (p.since ? <Word>{when(p.since, true)}</Word> : <Blank />) },
    { key: 'pays', label: 'Was due', sort: 'pays', width: 130, tip: tip('Was due', 'When it would have been released.'), cell: (p) => <Word>{when(p.releaseAt, true)}</Word> },
    amount('Held, tips included.'),
    { key: 'release', label: '', width: 120, tip: tip('Release', 'Pays it now, over a complaint’s hold. Money moves, so it needs the owner signed in; anyone else’s press goes to Approvals. Missing tax details or Stripe set-up still hold it.'),
      cell: (p) => (p.holdReason === 'tax_details' || p.holdReason === 'stripe_incomplete' ? <Blank />
        : <Act label="Release" icon="locked" tone="secondary" small onPress={() => { setReleasing(p); setWhy(''); setSaid(null); }} />) },
  ];
  const failedCols: Col<Payout>[] = [
    host, event,
    { key: 'state', label: 'Stripe', width: 110, tip: tip('Stripe', 'The transfer failed at Stripe.'), cell: () => <Said colour={red()}>Failed</Said> },
    { key: 'pays', label: 'Was due', sort: 'pays', width: 130, tip: tip('Was due', 'When it was released.'), cell: (p) => <Word>{when(p.releaseAt, true)}</Word> },
    amount('Not paid, tips included.'),
    { key: 'retry', label: '', width: 110, tip: tip('Retry', 'Back into the queue once the reason is fixed. Money moves, so it needs the owner signed in; anyone else is told to file it for approval.'),
      cell: (p) => <TextAction label="Retry" onPress={() => act(ownerAct('POST', `/money/payouts/${p.id}/retry`, {}, { change: `Send ${p.host}’s ${gbp(p.pence)} payout to Stripe again`, why: 'Stripe refused the transfer; the reason has been fixed.', affected: { count: 1, unit: 'payouts' } }), 'Back in the queue')} /> },
  ];
  const refundCols: Col<RefundRow>[] = [
    { key: 'cause', label: 'Cause', sort: 'cause', grow: true, tip: tip('Cause', 'Why the money went back.'), cell: (x) => <Word strong={x.total}>{x.total ? 'Total' : reasonWords(x.cause) ?? '—'}</Word> },
    { key: 'state', label: 'State', sort: 'state', width: 130, tip: tip('State', 'Whether Stripe has done it.'),
      cell: (x) => (x.total ? <Blank /> : <Said colour={x.state === 'failed' ? red() : x.state === 'pending' ? amber() : undefined}>{REFUND_STATE[x.state] ?? x.state}</Said>) },
    { key: 'count', label: 'Count', sort: 'count', width: 90, align: 'right', tip: tip('Count', 'Refunds.'), cell: (x) => <Num n={x.count} strong={x.total} /> },
    { key: 'amount', label: 'Amount', sort: 'amount', width: 130, align: 'right', tip: tip('Amount', 'Last 30 days.'), cell: (x) => <Pounds p={x.pence} strong={x.total} /> },
  ];
  const refundTotal: RefundRow = { cause: null, state: '', total: true, count: data.refundsByCause.reduce((t, x) => t + x.count, 0), pence: data.refundsByCause.reduce((t, x) => t + x.pence, 0) };
  type Hold = Payouts['cardHolds'][number];
  const holdCols: Col<Hold>[] = [
    { key: 'event', label: 'Event', sort: 'event', grow: true, tip: tip('Event', 'The On request event.'), cell: (x) => (x.event ? <Word>{x.event}</Word> : <Blank />) },
    { key: 'host', label: 'Host', sort: 'host', width: 180, tip: tip('Host', 'Who has to answer.'), cell: (x) => <Word>{x.host}</Word> },
    { key: 'household', label: 'Household', sort: 'household', width: 180, tip: tip('Household', 'Who asked.'), cell: (x) => <Word>{x.household}</Word> },
    { key: 'held', label: 'Held', sort: 'held', width: 110, align: 'right', tip: tip('Held', 'On the card, not charged.'), cell: (x) => <Pounds p={x.pence} /> },
    { key: 'by', label: 'Host replies by', sort: 'by', width: 160, tip: tip('Host replies by', 'The host’s reply window from the request (Settings). Accepted, it is charged; declined or unanswered, the hold is released. Amber under 6 hours; red once past.'),
      cell: (x) => {
        if (!x.replyBy) return <Blank />;
        const left = new Date(x.replyBy).getTime() - now;
        return <Said colour={left < 0 ? red() : left < 6 * 3_600_000 ? amber() : undefined}>{when(x.replyBy, true)}</Said>;
      } },
  ];

  const heldPence = data.held.reduce((t, p) => t + p.pence, 0);
  return (
    <View style={{ gap: 26 }}>
      {said ? <Text style={[s.word, { color: said.ok ? colors.ink : red() }]}>{said.words}</Text> : null}
      <Band kicker="Hosting · Money" title="Payouts, refunds and holds">
        <Stat label="Waiting to confirm" value={data.waitingForConfirmation.length.toLocaleString()} tip={tip('Waiting to confirm', PAYOUT_RULE)} />
        <Stat label="Held" value={data.held.length ? gbp(heldPence) : '—'} tip={tip('Held', `${data.held.length} payouts held, each with its reason.`)} />
        <Stat label="Paid · 30 days" value={data.paid30.count ? gbp(data.paid30.pence) : '—'} tip={tip('Paid · 30 days', `${data.paid30.count} payouts paid in the last 30 days, tips included.`)} />
        <Stat label="Failed" value={<Text style={data.failed.length ? { color: red() } : null}>{data.failed.length.toLocaleString()}</Text>} tip={tip('Failed', 'Transfers Stripe refused.')} />
        <Stat label="Open holds" value={data.cardHolds.length.toLocaleString()} tip={tip('Open holds', 'Card holds waiting for the host to accept.')} />
      </Band>

      <View>
        <TableHead tip={tip('Waiting for confirmation', PAYOUT_RULE)}>Waiting for confirmation</TableHead>
        <Ladder columns={waitingCols} rows={waiting} keyOf={(p) => p.id} sort={w.sort} desc={w.desc} onSort={w.onSort} empty={<Blank />} />
      </View>
      <View>
        <TableHead tip={tip('Held payouts', 'Each with its reason. Releasing one by hand needs the owner signed in and goes to Approvals.')}>Held payouts</TableHead>
        <Ladder columns={heldCols} rows={held} keyOf={(p) => p.id} sort={h.sort} desc={h.desc} onSort={h.onSort} empty={<Blank />} />
        {releasing ? (
          <View style={s.form}>
            <Text style={s.word}>{`Release ${gbp(releasing.pence)} to ${releasing.host}`}</Text>
            <TextInput value={why} onChangeText={setWhy} placeholder="Why" placeholderTextColor={colors.inkMuted} accessibilityLabel="Why" maxLength={500} style={s.input} />
            <Act label="Release" tone="solid" small disabled={!why.trim()}
                 onPress={() => act(ownerAct('POST', `/money/payouts/${releasing.id}/release`, { why: why.trim() }, { change: `Release ${releasing.host}’s held payout of ${gbp(releasing.pence)} now`, why: why.trim(), affected: { count: 1, unit: 'payouts' } }), 'Released')} />
            <TextAction label="Cancel" tone="muted" onPress={() => setReleasing(null)} />
          </View>
        ) : null}
      </View>
      <View>
        <TableHead tip={tip('Failed', 'Released, and the transfer did not go through.')}>Failed payouts</TableHead>
        <Ladder columns={failedCols} rows={failed} keyOf={(p) => p.id} sort={f.sort} desc={f.desc} onSort={f.onSort} empty={<Blank />} />
      </View>
      <View>
        <TableHead tip={tip('Refunds by cause', 'Last 30 days.')}>Refunds by cause · 30 days</TableHead>
        <Ladder columns={refundCols} rows={data.refundsByCause.length ? [...refunds, refundTotal] : []} keyOf={(x, i) => (x.total ? 'total' : `${x.cause}:${x.state}:${i}`)}
                sort={r.sort} desc={r.desc} onSort={r.onSort} empty={<Blank />} />
      </View>
      {data.refundsNeedingAPerson?.length ? (
        <View>
          <TableHead tip={tip('Refunds needing a person', 'Stripe refused these. The money stays owed to the guest until someone retries or settles it.')}>Refunds needing a person</TableHead>
          <Ladder<Stuck>
            columns={[
              { key: 'event', label: 'Event', sort: 'event', grow: true, tip: tip('Event', 'Whose booking the refund is for.'), cell: (x) => (x.event ? <Word>{x.event}</Word> : <Blank />) },
              { key: 'amount', label: 'Amount', sort: 'amount', width: 120, align: 'right', tip: tip('Amount', 'Owed back to the guest.'), cell: (x) => <Pounds p={x.pence} /> },
              { key: 'stripe', label: 'Stripe said', sort: 'stripe', width: 220, tip: tip('Stripe said', 'Stripe’s own code for the refusal.'), cell: (x) => (x.stripe ? <Word>{x.stripe}</Word> : <Blank />) },
              { key: 'when', label: 'When', sort: 'when', width: 110, tip: tip('When', 'When the refund was owed.'), cell: (x) => <Word>{when(x.at)}</Word> },
              { key: 'retry', label: '', width: 90, tip: tip('Retry', 'Sends it to Stripe again with the same key, so it can never be paid twice.'),
                cell: (x) => <TextAction label="Retry" onPress={() => act(api.hostingAdminPost(`/money/refunds/${x.id}/retry`, {}).then(() => 'done' as const), 'Sent again')} /> },
            ]}
            rows={stuck} keyOf={(x) => x.id} sort={n.sort} desc={n.desc} onSort={n.onSort} />
        </View>
      ) : null}
      <View>
        <TableHead tip={tip('Card holds · Ask to book', 'On request bookings: the card is held, not charged, until the host answers.')}>Card holds · Ask to book</TableHead>
        <Ladder columns={holdCols} rows={holds} keyOf={(x) => x.bookingId} sort={c.sort} desc={c.desc} onSort={c.onSort} empty={<Blank />} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  num: { ...type.body, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'], textAlign: 'right' },
  word: { ...type.body, fontSize: 13.5, color: colors.ink },
  strong: { fontWeight: '700' },
  title: { ...type.title, fontSize: 29, fontWeight: '800', letterSpacing: -0.9, lineHeight: 32, color: colors.ink },
  band: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 16 },
  stats: { flexDirection: 'row', alignItems: 'flex-end', gap: 34, flexWrap: 'wrap' },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 22, flexWrap: 'wrap', paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderTopColor: colors.lineSoft, borderBottomColor: colors.lineSoft },
  stripWord: { ...type.small, fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  error: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 16 },
  form: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 12 },
  input: { ...type.body, fontSize: 13.5, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, paddingVertical: 6, minWidth: 260, flexGrow: 1 },
});
