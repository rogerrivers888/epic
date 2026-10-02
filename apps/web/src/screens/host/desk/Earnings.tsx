/**
 * E9 · Earnings (hosting v4, README E9).
 *
 * Three tabs — Overview · Payouts · Statements — set in the address as
 * `?tab=`. Overview: the month's figure, its change on the month before,
 * Bookings and Tips; six months of bars (tap one to switch `?month=`); By
 * event, each opening a sheet; Booked ahead and the goal side by side.
 * Payouts: the next payout in lime tint, then due, held, paid and failed, and
 * the Stripe account. Statements: a CSV a month and a year, the year's with
 * the DAC7 summary.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { api } from '../../../api';
import { asOneOf, asText, useQueryState, useRouter } from '../../../router';
import { paths } from '../../../routes';
import { DEEP_GREEN, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT, MOSS } from '../../../theme';
import { Bar, Btn, DeskSheet, Empty, Head, Kicker, Loading, Page, Row, Section, Tabs, hx, tx } from './kit';
import { dayWords, gbp, monthWords, type DeskEarnings as Earnings, type Payout } from './model';

const TABS = ['overview', 'payouts', 'statements'] as const;
type Tab = (typeof TABS)[number];

/** "£642.60" and "£459.00": money in a list always carries its pence. */
const pounds = (p: number | null | undefined) => `£${(Number(p ?? 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthBefore = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function DeskEarnings() {
  const { back } = useRouter();
  const [tab, setTab] = useQueryState<Tab>('tab', 'overview', asOneOf(TABS, 'overview'));
  const [month, setMonth] = useQueryState<string | null>('month', null, asText);
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api.deskEarnings(month).then((d) => { if (live) setData(d); }).catch(() => { if (live) setError('Your earnings could not be loaded. Try again in a moment.'); });
    return () => { live = false; };
  }, [month]);

  if (!data) return <Loading error={error} />;
  return (
    <Page>
      <Head back="Host" onBack={() => back(paths.host())} title="Earnings" />
      <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
        <Tabs tabs={[{ key: 'overview', label: 'Overview' }, { key: 'payouts', label: 'Payouts' }, { key: 'statements', label: 'Statements' }]}
          value={tab} onPick={(k) => setTab(k, { replace: true })} />
      </View>
      {error ? <Text style={[tx(13.5, '400', INK_MUTED), { paddingHorizontal: 20, paddingTop: 10 }]}>{error}</Text> : null}
      {tab === 'overview' ? <Overview d={data} onMonth={(m) => setMonth(m === thisMonth() ? null : m, { replace: true })} /> : null}
      {tab === 'payouts' ? <Payouts d={data} /> : null}
      {tab === 'statements' ? <Statements d={data} /> : null}
    </Page>
  );
}

function Overview({ d, onMonth }: { d: Earnings; onMonth: (m: string) => void }) {
  const [open, setOpen] = useState<Earnings['byEvent'][number] | null>(null);
  const current = d.month === thisMonth();
  const selected = Math.max(0, d.bars.findIndex((b) => b.month === d.month));
  return (
    <>
      <View style={{ paddingHorizontal: 20, paddingTop: 18, gap: 6 }}>
        <Text style={tx(13.5, '400', INK_MUTED)}>{current ? `${monthWords(d.month, true)} so far` : monthWords(d.month)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 10 }}>
          <Text style={hx(46)}>{gbp(d.pence)}</Text>
          {d.changePct != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Icon name={d.changePct >= 0 ? 'ascending' : 'descending'} size={14} color={MOSS} />
              <Text style={tx(13.5, '800', MOSS)}>{Math.abs(d.changePct)}% on {monthWords(monthBefore(d.month), true)}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 18, paddingTop: 4 }}>
          <Text style={tx(13.5, '400')}>Bookings <Text style={tx(13.5, '800')}>{gbp(d.bookingsPence)}</Text></Text>
          <Text style={tx(13.5, '400')}>Tips <Text style={tx(13.5, '800')}>{gbp(d.tipsPence)}</Text></Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
        <MonthChart bars={d.bars} selected={selected} onPick={(i) => onMonth(d.bars[i].month)} />
      </View>

      <Section title="By event">
        <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          {d.byEvent.length ? d.byEvent.map((e) => (
            <Row key={e.offerId} title={e.title ?? 'Your event'} right={pounds(e.pence)} onPress={() => setOpen(e)}
              line={[plural(e.sessions, 'session', 'sessions'), e.bookings ? plural(e.bookings, 'booking', 'bookings') : null, e.tipsPence ? `${gbp(e.tipsPence)} tips` : null].filter(Boolean).join(' · ')} />
          )) : <View style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}><Empty>Nothing earned in {monthWords(d.month)}.</Empty></View>}
        </View>
      </Section>

      <View style={{ flexDirection: 'row', gap: 3, paddingHorizontal: 20, paddingTop: 20 }}>
        <Figure kicker="Booked ahead" value={gbp(d.bookedAhead.pence)} sub={`of ${d.bookedAhead.possiblePence == null ? '—' : gbp(d.bookedAhead.possiblePence)} possible`}
          bar={d.bookedAhead.possiblePence ? { value: d.bookedAhead.pence, of: d.bookedAhead.possiblePence, fill: DEEP_GREEN } : null} />
        {d.goal ? (
          <Figure kicker="Goal" value={gbp(d.goal.soFarPence)} sub={`of ${gbp(d.goal.pence)} this month`} bar={{ value: d.goal.soFarPence, of: d.goal.pence, fill: INK }} />
        ) : null}
      </View>

      {open ? (
        <DeskSheet title={open.title ?? 'Your event'} onClose={() => setOpen(null)}>
          <SheetLine label="Collected" value={pounds(open.sheet.collectedPence)} />
          <SheetLine label="Epic fee" value={open.sheet.feePence ? `− ${pounds(open.sheet.feePence)}` : pounds(0)} />
          <SheetLine label="Refunds" value={open.sheet.refundsPence ? `− ${pounds(open.sheet.refundsPence)}` : pounds(0)} />
          <SheetLine label="Tips" value={pounds(open.sheet.tipsPence)} />
          <SheetLine label="Paid to you" value={pounds(open.sheet.paidToYouPence)} strong />
        </DeskSheet>
      ) : null}
    </>
  );
}

/** Six months: the chosen one lime, the rest grey, its month in bold under it. */
function MonthChart({ bars, selected, onPick }: { bars: Earnings['bars']; selected: number; onPick: (i: number) => void }) {
  const height = 104;
  const max = Math.max(1, ...bars.map((b) => b.pence));
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height }}>
        {bars.map((b, i) => (
          <Press key={b.month} onPress={() => onPick(i)} accessibilityRole="button" accessibilityState={{ selected: i === selected }}
            accessibilityLabel={`${monthWords(b.month)}: ${gbp(b.pence)}`} style={{ flex: 1, height, justifyContent: 'flex-end' }}>
            <View style={{ height: Math.max(3, (b.pence / max) * height), backgroundColor: i === selected ? LIME : HAIRLINE }} />
          </Press>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {bars.map((b, i) => (
          <Text key={b.month} style={[tx(11.5, i === selected ? '800' : '500', i === selected ? INK : INK_MUTED), { flex: 1, textAlign: 'center' }]}>{monthWords(b.month, true)}</Text>
        ))}
      </View>
    </View>
  );
}

function Figure({ kicker, value, sub, bar }: { kicker: string; value: string; sub: string; bar: { value: number; of: number; fill: string } | null }) {
  return (
    <View style={{ flex: 1, backgroundColor: INACTIVE, padding: 12, gap: 6 }}>
      <Kicker>{kicker}</Kicker>
      <Text style={hx(22)} numberOfLines={1}>{value}</Text>
      <Text style={tx(12.5, '400', INK_MUTED)}>{sub}</Text>
      <View style={{ paddingTop: 4 }}><Bar value={bar?.value ?? 0} of={bar?.of ?? 0} fill={bar?.fill ?? INK} /></View>
    </View>
  );
}

function SheetLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }, strong && { borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 12 }]}>
      <Text style={tx(14.5, strong ? '800' : '400')}>{label}</Text>
      <Text style={tx(14.5, '800')}>{value}</Text>
    </View>
  );
}

const HOLD_WORDS: Record<string, string> = {
  complaint: 'A guest raised a problem',
  tax_details: 'Add tax details',
  stripe_incomplete: 'Finish Stripe set-up',
};

function Payouts({ d }: { d: Earnings }) {
  const { navigate } = useRouter();
  const p = d.payouts;
  const next = p.next;
  const list = (title: string, rows: Payout[], line: (x: Payout) => string) => (rows.length ? (
    <Section title={title}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
        {rows.map((x) => <Row key={x.id} title={x.title ?? 'Your event'} line={line(x)} right={pounds(x.pence)} rightSub={x.tipsPence ? `${gbp(x.tipsPence)} tips` : null} />)}
      </View>
    </Section>
  ) : null);
  return (
    <>
      <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
        <View style={{ backgroundColor: LIME_TINT, padding: 16, gap: 6 }}>
          <Kicker color={INK}>Next payout</Kicker>
          {next ? (
            <>
              <Text style={hx(36)}>{pounds(next.pence)}</Text>
              <Text style={tx(14, '700')}>{dayWords(next.on?.slice(0, 10))}{next.title ? ` · ${next.title}` : ''}</Text>
            </>
          ) : <Text style={tx(14.5, '700')}>No payout is due.</Text>}
        </View>
      </View>
      {list('Due', p.due, (x) => dayWords(x.on?.slice(0, 10)))}
      {list('Held', p.held, (x) => (x.holdReason ? HOLD_WORDS[x.holdReason] ?? 'Held' : 'Held'))}
      {list('Paid', p.paid, (x) => `Paid ${dayWords(x.on?.slice(0, 10))}`)}
      {list('Failed', p.failed, (x) => `Didn’t go through · ${dayWords(x.on?.slice(0, 10))}`)}
      <Section title="Where it goes">
        <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          <Row title="Stripe account" onPress={() => navigate(paths.hostSettings('settings'))}
            line={p.stripe.ready ? ['Ready', p.stripe.accountId].filter(Boolean).join(' · ') : 'Finish Stripe set-up'} />
        </View>
      </Section>
    </>
  );
}

function Statements({ d }: { d: Earnings }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const get = (period: string) => {
    setBusy(period); setFailed(null);
    api.deskStatement(period)
      .catch(() => setFailed('That statement could not be downloaded. Try again in a moment.'))
      .finally(() => setBusy(null));
  };
  const months = d.statements.filter((s) => s.kind === 'month');
  const years = d.statements.filter((s) => s.kind === 'year');
  const row = (s: Earnings['statements'][number]) => (
    <View key={s.period} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={tx(15.5, '800')}>{s.kind === 'month' ? `${monthWords(s.period)} ${s.period.slice(0, 4)}` : s.period}</Text>
        {s.kind === 'year' ? <Text style={tx(13, '400', INK_MUTED)}>with the DAC7 summary</Text> : null}
      </View>
      <Btn label="CSV" icon="download" kind="grey" disabled={busy === s.period} onPress={() => get(s.period)} />
    </View>
  );
  return (
    <>
      {failed ? <Text style={[tx(13.5, '700'), { paddingHorizontal: 20, paddingTop: 14 }]}>{failed}</Text> : null}
      <Section title="By month">
        <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>{months.length ? months.map(row) : <Empty>No statements yet.</Empty>}</View>
      </Section>
      {years.length ? (
        <Section title="By year">
          <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>{years.map(row)}</View>
        </Section>
      ) : null}
    </>
  );
}
