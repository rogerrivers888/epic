/**
 * Hosting's three plain records (K15 §3, Roger, 3 Oct 2026: "every table is
 * clickable"): a booking and a payout on Money (`?tab=money&booking=<id>`,
 * `?tab=money&payout=<id>`), a complaint on Safety (`?tab=safety&complaint=<id>`).
 * The query keys are spelled in routes.ts (`HOSTING_RECORDS`).
 *
 * Read-only and not designed yet — a redesign is coming — so each is the event
 * record's own parts: a band, blocks of facts, and the tables under them. Every
 * name opens what it names: host, event, household, booking, payout. Stripe's
 * references never reach the screen; a record says whether Stripe agrees.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../../api';
import { paths } from '../../routes';
import { colors, type, BORDER } from '../../theme';
import { Ladder, Num, Word, Blank, Kicker, type Col } from '../table';
import { Explain, type Tip } from '../explain';
import { KIND_WORDS, Opens, useOpen, useLoad, useSorted, gbp, when } from './kit';
import { tip, Fact, Block, Back, Band, Failed, Waiting, Said, type Tone } from './Hosts';
import { compact } from './Changes';

// ---------------------------------------------------------------------------
// payloads (routes/hostingAdmin.js › Records)
// ---------------------------------------------------------------------------

type Change = { id: string; subjectKind: string; subjectId: string; field: string | null; before: unknown; after: unknown; why: string | null; by: string | null; approvalId: string | null; at: string };
type Payment = {
  id: string; kind: string; pence: number; epicPence: number | null; hostPence: number | null; ratePct: number | null; cause: string | null; reason: string | null;
  state: string; stripe: string | null; payoutId: string | null; bookingId: string | null; at: string; voided: boolean;
};
type SessionRef = { id: string; n: number | null; date: string | null; time: string | null };

type BookingRecordPayload = {
  booking: {
    id: string; state: string; kind: string | null; heads: number | null; madeAt: string;
    hostId: string | null; host: string | null; offerId: string | null; event: string | null; lane: string | null; visibility: string | null;
    householdId: string | null; household: string | null; request: string | null; replyBy: string | null;
    payment: string | null; valuePence: number | null; ratePct: number | null; feeReason: string | null; epicPence: number | null; hostPence: number | null;
    heldPence: number | null; chargedPence: number | null; refundedPence: number | null; refundPolicy: string | null;
    cancelledAt: string | null; cancelCause: string | null; cancelledBy: string | null; happened: string | null; dispute: string | null; voided: boolean; viaHostLink: boolean;
  };
  sessions: (SessionRef & { state: string; booked: string; payoutId: string | null })[];
  payments: Payment[];
  payouts: { id: string; state: string; releaseAt: string; holdReason: string | null; pence: number; part: 'share' | 'tip' }[];
  complaints: { id: string; kind: string; state: string; reason: string | null; pence: number | null; at: string; resolvedAt: string | null }[];
  changes: Change[]; changesCapped: boolean;
};

type PayoutRecordPayload = {
  payout: {
    id: string; state: string; hostId: string; host: string; offerId: string | null; event: string | null; session: SessionRef | null;
    pence: number; sharePence: number; tipsPence: number; releaseAt: string; tookPlace: string | null; confirmedBy: number;
    holdReason: string | null; releasedBy: string | null; sent: boolean; attempt: number | null; mode: string; madeAt: string; updatedAt: string;
  };
  lines: { bookingId: string; pence: number; heads: number | null; state: string | null; householdId: string | null; household: string | null }[];
  tips: { id: string; bookingId: string; pence: number; state: string; at: string; householdId: string | null; household: string | null }[];
  complaints: { id: string; kind: string; state: string; bookingId: string | null; householdId: string | null; household: string | null; at: string; resolvedAt: string | null }[];
  payments: Payment[];
  changes: Change[]; changesCapped: boolean;
};

type ComplaintRecordPayload = {
  complaint: {
    id: string; kind: string; state: string; reason: string | null; pence: number | null; at: string; resolvedAt: string | null;
    hostId: string | null; host: string | null; offerId: string | null; event: string | null; householdId: string | null; household: string | null;
    bookingId: string | null; session: SessionRef | null;
  };
  payouts: { id: string; state: string; holdReason: string | null; pence: number; releaseAt: string }[];
  changes: Change[]; changesCapped: boolean;
};

// ---------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------

const cap = (w: string | null | undefined) => (w ? w.charAt(0).toUpperCase() + w.slice(1).replace(/_/g, ' ') : '—');
const ref = (id: string | null | undefined) => (id ? id.slice(0, 8) : null);
const PAYOUT_WORD: Record<string, string> = { scheduled: 'Scheduled', held: 'Held', released: 'Released', paid: 'Paid', failed: 'Failed', void: 'Void' };
const HOLD_WORD: Record<string, string> = {
  complaint: 'A complaint is open', tax_details: 'No tax details on file', stripe_incomplete: 'Stripe set-up incomplete',
  not_set: 'Waiting on a setting', no_end: 'Session has no end time',
};
const COMPLAINT_WORD: Record<string, string> = { complaint: 'Complaint', guarantee_claim: 'Guarantee claim', host_no_show: 'Host no-show' };
const TYPE_WORD: Record<string, string> = {
  charge: 'Booking', refund: 'Refund', payout: 'Payout', hold: 'Card hold', release: 'Hold released', private_fee: 'Private event fee', pro: 'Pro', tip: 'Tip', tip_refund: 'Tip refunded',
};
const STRIPE_WORD: Record<string, string> = { matched: 'Matched', mismatch: 'Mismatch', pending: 'Pending', not_checked: 'Not checked' };
const toneOf = (st: string): Tone => (st === 'failed' || st === 'mismatch' ? 'refusal' : st === 'held' || st === 'open' || st === 'pending' ? 'attention' : 'plain');

/** A sort kept on the record itself: two tables on one record never share it, and it is not worth a link. */
function useLocalSort() {
  const [sort, setSort] = useState<string | null>(null);
  const [desc, setDesc] = useState(false);
  return { sort, desc, onSort: (k: string) => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(false); } } };
}

/** The heading over a table on a record: a kicker over a 2px rule. */
const Head = ({ children, t }: { children: string; t: Tip }) => <View style={s.blockHead}><Kicker tip={t}>{children}</Kicker></View>;

// ---------------------------------------------------------------------------
// shared tables
// ---------------------------------------------------------------------------

/** The money movements on a booking or a payout, each opening the booking or payout it belongs to. */
function Payments({ rows, by }: { rows: Payment[]; by: 'booking' | 'payout' }) {
  const open = useOpen();
  const sort = useLocalSort();
  const sorted = useSorted(rows, sort.sort, sort.desc, (r, k) => (k === 'at' ? r.at : k === 'type' ? TYPE_WORD[r.kind] ?? r.kind : k === 'amount' ? r.pence : k === 'state' ? r.state : k === 'stripe' ? r.stripe : null));
  const other = (r: Payment) => (by === 'booking' ? (r.payoutId ? paths.hostingRecord('payout', r.payoutId) : null) : (r.bookingId ? paths.hostingRecord('booking', r.bookingId) : null));
  const columns: Col<Payment>[] = [
    { key: 'at', label: 'When', sort: 'at', width: 120, tip: tip('When', 'When it moved.'), cell: (r) => <Word>{when(r.at, true)}</Word> },
    { key: 'type', label: 'Type', sort: 'type', grow: true, tip: tip('Type', 'Booking, refund, card hold, payout or tip.'), cell: (r) => <Word>{`${TYPE_WORD[r.kind] ?? cap(r.kind)}${r.cause ? ` · ${cap(r.cause)}` : ''}${r.voided ? ' · void' : ''}`}</Word> },
    { key: 'amount', label: 'Amount', sort: 'amount', width: 110, align: 'right', tip: tip('Amount', 'What moved.'), cell: (r) => <Text style={s.num}>{gbp(r.pence)}</Text> },
    { key: 'state', label: 'State', sort: 'state', width: 110, tip: tip('State', 'Whether Stripe has done it. A failed one shows what Stripe said on hover.'),
      cellTip: (r) => (r.state === 'failed' && r.reason ? tip('Stripe said', r.reason) : null), cell: (r) => <Said tone={toneOf(r.state)}>{cap(r.state)}</Said> },
    { key: 'stripe', label: 'Stripe', sort: 'stripe', width: 110, tip: tip('Stripe', 'Whether Stripe’s record matches ours at the last reconciliation. A dash: nothing sent to Stripe yet.'),
      cell: (r) => (r.stripe ? <Said tone={toneOf(r.stripe)}>{STRIPE_WORD[r.stripe] ?? r.stripe}</Said> : <Blank />) },
    { key: 'other', label: by === 'booking' ? 'Payout' : 'Booking', width: 100,
      tip: tip(by === 'booking' ? 'Payout' : 'Booking', by === 'booking' ? 'The payout it was paid out in. Opens it.' : 'The booking it belongs to. Opens it.'),
      cell: (r) => <Opens to={other(r)}>{ref(by === 'booking' ? r.payoutId : r.bookingId)}</Opens> },
  ];
  return (
    <View>
      <Head t={tip('Money movements', 'Every movement on the ledger that belongs to this, oldest first.')}>{`Money movements · ${rows.length}`}</Head>
      <Ladder columns={columns} rows={sorted} keyOf={(r) => r.id} dense {...sort}
              onRow={(r) => { const to = other(r); if (to) open(to); }} label={(r) => `Open what ${TYPE_WORD[r.kind] ?? r.kind} belongs to`}
              empty={<Word muted>Nothing has moved.</Word>} />
    </View>
  );
}

/** The record's own changes: who, when, before → after, why. A row opens every change to that thing on Changes. */
function Changes({ rows, capped }: { rows: Change[]; capped: boolean }) {
  const open = useOpen();
  const sort = useLocalSort();
  const sorted = useSorted(rows, sort.sort, sort.desc, (c, k) => (k === 'at' ? c.at : k === 'field' ? c.field : k === 'why' ? c.why : k === 'by' ? c.by : null));
  const change = (c: Change) => (c.before == null ? compact(c.after) : `${compact(c.before)} → ${compact(c.after)}`);
  const columns: Col<Change>[] = [
    { key: 'at', label: 'When', sort: 'at', width: 120, tip: tip('When', 'When it was changed.'), cell: (c) => <Word>{when(c.at, true)}</Word> },
    { key: 'field', label: 'What', sort: 'field', width: 150, tip: tip('What', 'The part that changed.'), cell: (c) => <Word strong>{cap(c.field)}</Word> },
    { key: 'change', label: 'Before → After', grow: true, tip: tip('Before → After', 'What it was, and what it became.'), cellTip: (c) => tip('Before → After', change(c)),
      cell: (c) => <Text style={s.word} numberOfLines={1}>{change(c)}</Text> },
    { key: 'why', label: 'Why', sort: 'why', width: 220, tip: tip('Why', 'The reason given.'), cellTip: (c) => (c.why ? tip('Why', c.why) : null),
      cell: (c) => (c.why ? <Text style={s.word} numberOfLines={1}>{c.why}</Text> : <Blank />) },
    { key: 'by', label: 'By', sort: 'by', width: 170, tip: tip('By', 'Who changed it, or Epic when a rule did.'), cellTip: (c) => (c.approvalId ? tip('Approval', c.approvalId) : null),
      cell: (c) => (c.by ? <Text style={s.word} numberOfLines={1}>{c.by === 'epic' ? 'Epic' : c.by}</Text> : <Blank />) },
  ];
  return (
    <View>
      <Head t={tip('Changes', 'Everything changed about it, newest first. A row opens every change to that thing on Changes.')}>{`Changes · ${rows.length}${capped ? '+' : ''}`}</Head>
      <Ladder columns={columns} rows={sorted} keyOf={(c) => c.id} dense {...sort}
              onRow={(c) => open(paths.hosting('changes', { what: c.subjectKind, subject: c.subjectId }))} label={(c) => `Every change to ${c.subjectKind} ${c.subjectId}`}
              empty={<Blank />} />
      {capped ? <Explain tip={tip('Newest only', 'The newest 100. Changes has the rest.')}><Word muted>Newest 100 only</Word></Explain> : null}
    </View>
  );
}

/** Loading, refused or missing: the way back stays on screen. */
function Shell({ back, onBack, error, children }: { back: string; onBack: () => void; error: string | null; children: React.ReactNode | null }) {
  if (error) return <View style={{ gap: 14 }}><Back label={back} onPress={onBack} /><Failed>{error}</Failed></View>;
  if (!children) return <View style={{ gap: 14 }}><Back label={back} onPress={onBack} /><Waiting /></View>;
  return <View style={{ gap: 16 }}><Back label={back} onPress={onBack} />{children}</View>;
}

const sessionWords = (x: SessionRef | null) => (x ? [x.n ? `Session ${x.n}` : null, when(x.date), x.time].filter(Boolean).join(' · ') : '—');

// ---------------------------------------------------------------------------
// a booking
// ---------------------------------------------------------------------------

export function BookingRecord({ id, onBack }: { id: string; onBack: () => void }) {
  const open = useOpen();
  const { data, error } = useLoad<BookingRecordPayload>(() => api.hostingAdmin<BookingRecordPayload>(`/bookings/${encodeURIComponent(id)}`), [id]);
  const ss = useLocalSort();
  const ps = useLocalSort();
  const cs = useLocalSort();
  const sessions = useSorted(data?.sessions, ss.sort, ss.desc, (x, k) => (k === 'date' ? `${x.date ?? ''} ${x.time ?? ''}` : k === 'state' ? x.state : k === 'booked' ? x.booked : null));
  const payouts = useSorted(data?.payouts, ps.sort, ps.desc, (x, k) => (k === 'when' ? x.releaseAt : k === 'amount' ? x.pence : k === 'state' ? x.state : null));
  const complaints = useSorted(data?.complaints, cs.sort, cs.desc, (x, k) => (k === 'at' ? x.at : k === 'kind' ? x.kind : k === 'state' ? x.state : null));
  const b = data?.booking;
  return (
    <Shell back="Money" onBack={onBack} error={error}>
      {data && b ? (
        <>
          <Band kicker={['Booking', ref(b.id), b.lane ? KIND_WORDS[b.lane] ?? b.lane : null, b.visibility === 'public' ? 'Public' : b.visibility ? 'Private' : null].filter(Boolean).join(' · ')}
                title={b.event ?? 'Booking'}
                stats={[
                  { label: 'Paid', value: gbp(b.chargedPence), tip: tip('Paid', 'Charged to the guest’s card.') },
                  { label: 'Refunded', value: gbp(b.refundedPence || null), tip: tip('Refunded', 'Gone back to the guest.') },
                  { label: 'Epic took', value: gbp(b.epicPence), tip: tip('Epic took', 'At the rate stored on the booking when it was made.') },
                  { label: 'To host', value: gbp(b.hostPence), tip: tip('To host', 'The host’s share of it.') },
                  { label: 'Status', value: cap(b.state), tip: tip('Status', 'Pending, confirmed, attended or cancelled.') },
                ]} />
          <View style={s.blocks}>
            <Block title="Who and what">
              <Fact label="Event" tip={tip('Event', 'Opens the event.')}><Opens to={b.offerId ? paths.hostingRecord('event', b.offerId) : null}>{b.event}</Opens></Fact>
              <Fact label="Host" tip={tip('Host', 'Opens the host.')}><Opens to={b.hostId ? paths.hostingRecord('host', b.hostId) : null}>{b.host}</Opens></Fact>
              <Fact label="Household" tip={tip('Household', 'Who booked. Opens their record in Customers.')}><Opens to={b.householdId ? paths.customer(b.householdId) : null}>{b.household}</Opens></Fact>
              <Fact label="Guests" tip={tip('Guests', 'People on the booking.')}>{b.heads == null ? '—' : String(b.heads)}</Fact>
              <Fact label="Made" tip={tip('Made', 'When it was booked.')}>{when(b.madeAt, true)}</Fact>
              <Fact label="Ask to book" tip={tip('Ask to book', 'An On request booking: asked, accepted, declined or lapsed, and when the host must reply by.')}>
                {b.request ? `${cap(b.request)}${b.replyBy ? ` · by ${when(b.replyBy, true)}` : ''}` : '—'}
              </Fact>
            </Block>
            <Block title="Money">
              <Fact label="Payment" tip={tip('Payment', 'Held, charged, partly refunded or refunded.')}>{cap(b.payment)}</Fact>
              <Fact label="Booking value" tip={tip('Booking value', 'What the rate applies to.')}>{gbp(b.valuePence)}</Fact>
              <Fact label="Rate" tip={tip('Rate', 'Stored on the booking when it was made, and why: the host’s own rate, the intro, a host link, an override.')}>
                {b.ratePct == null ? '—' : `${b.ratePct}%${b.feeReason ? ` · ${cap(b.feeReason)}` : ''}`}
              </Fact>
              <Fact label="Held on card" tip={tip('Held on card', 'Held, not charged, while an On request host decides.')}>{gbp(b.heldPence || null)}</Fact>
              <Fact label="Refund policy" tip={tip('Refund policy', 'The terms it was booked on.')}>{cap(b.refundPolicy)}</Fact>
              <Fact label="Dispute" tip={tip('Dispute', 'A chargeback the guest raised with their bank.')}>{b.dispute ? <Said tone={b.dispute === 'open' ? 'attention' : 'plain'}>{cap(b.dispute)}</Said> : '—'}</Fact>
            </Block>
            <Block title="What happened">
              <Fact label="Took place" tip={tip('Took place', 'Whether the guest said it happened.')}>{cap(b.happened)}</Fact>
              <Fact label="Cancelled" tip={tip('Cancelled', 'When, why and by whom.')}>
                {b.cancelledAt ? [when(b.cancelledAt, true), b.cancelCause ? cap(b.cancelCause) : null, b.cancelledBy ? cap(b.cancelledBy) : null].filter(Boolean).join(' · ') : '—'}
              </Fact>
              <Fact label="Voided" tip={tip('Voided', 'Money from before the current payment model, kept and marked rather than deleted.')}>{b.voided ? 'Yes' : '—'}</Fact>
            </Block>
          </View>

          <View>
            <Head t={tip('Sessions', 'The sessions this booking is on. A row opens the payout for that session.')}>{`Sessions · ${data.sessions.length}`}</Head>
            <Ladder<BookingRecordPayload['sessions'][number]>
              columns={[
                { key: 'date', label: 'Session', sort: 'date', grow: true, tip: tip('Session', 'When it runs.'), cell: (x) => <Word>{sessionWords(x)}</Word> },
                { key: 'booked', label: 'On it', sort: 'booked', width: 110, tip: tip('On it', 'Booked, cancelled, moved or forfeited.'), cell: (x) => <Word>{cap(x.booked)}</Word> },
                { key: 'state', label: 'Session', sort: 'state', width: 110, tip: tip('Session', 'Scheduled, called off, cancelled or finished.'), cell: (x) => <Word>{cap(x.state)}</Word> },
                { key: 'payout', label: 'Payout', width: 100, tip: tip('Payout', 'The session’s payout. Opens it.'), cell: (x) => <Opens to={x.payoutId ? paths.hostingRecord('payout', x.payoutId) : null}>{ref(x.payoutId)}</Opens> },
              ]}
              rows={sessions} keyOf={(x) => x.id} dense {...ss}
              onRow={(x) => { if (x.payoutId) open(paths.hostingRecord('payout', x.payoutId)); }} label={(x) => `Open the payout for ${sessionWords(x)}`}
              empty={<Blank />} />
          </View>

          <Payments rows={data.payments} by="booking" />

          <View>
            <Head t={tip('Payouts', 'The payouts that carry this booking’s share, or a tip on it.')}>{`Payouts · ${data.payouts.length}`}</Head>
            <Ladder<BookingRecordPayload['payouts'][number]>
              columns={[
                { key: 'when', label: 'Due', sort: 'when', width: 130, tip: tip('Due', 'When it is released.'), cell: (x) => <Word>{when(x.releaseAt, true)}</Word> },
                { key: 'part', label: 'What', grow: true, tip: tip('What', 'This booking’s share of the session’s payout, or a tip on it.'), cell: (x) => <Word>{x.part === 'tip' ? 'Tip' : 'Share of the session'}</Word> },
                { key: 'amount', label: 'Amount', sort: 'amount', width: 110, align: 'right', tip: tip('Amount', 'This booking’s part of it.'), cell: (x) => <Text style={s.num}>{gbp(x.pence)}</Text> },
                { key: 'state', label: 'State', sort: 'state', width: 200, tip: tip('State', 'Scheduled, held with its reason, released, paid or failed.'),
                  cell: (x) => <Said tone={toneOf(x.state)}>{`${PAYOUT_WORD[x.state] ?? cap(x.state)}${x.state === 'held' && x.holdReason ? ` · ${HOLD_WORD[x.holdReason] ?? cap(x.holdReason)}` : ''}`}</Said> },
              ]}
              rows={payouts} keyOf={(x, i) => `${x.id}-${x.part}-${i}`} dense {...ps}
              onRow={(x) => open(paths.hostingRecord('payout', x.id))} label={() => 'Open the payout'}
              empty={<Blank />} />
          </View>

          <View>
            <Head t={tip('Complaints', 'Complaints and claims raised on this booking.')}>{`Complaints · ${data.complaints.length}`}</Head>
            <Ladder<BookingRecordPayload['complaints'][number]>
              columns={[
                { key: 'at', label: 'When', sort: 'at', width: 120, tip: tip('When', 'When it was raised.'), cell: (x) => <Word>{when(x.at, true)}</Word> },
                { key: 'kind', label: 'What', sort: 'kind', width: 150, tip: tip('What', 'A complaint, a guarantee claim or a host no-show.'), cell: (x) => <Word>{COMPLAINT_WORD[x.kind] ?? cap(x.kind)}</Word> },
                { key: 'reason', label: 'What happened', grow: true, tip: tip('What happened', 'In the household’s words.'), cellTip: (x) => (x.reason ? tip('What happened', x.reason) : null),
                  cell: (x) => (x.reason ? <Text style={s.word} numberOfLines={1}>{x.reason}</Text> : <Blank />) },
                { key: 'state', label: 'State', sort: 'state', width: 110, tip: tip('State', 'Open, resolved, declined or paid.'), cell: (x) => <Said tone={toneOf(x.state)}>{cap(x.state)}</Said> },
              ]}
              rows={complaints} keyOf={(x) => x.id} dense {...cs}
              onRow={(x) => open(paths.hostingRecord('complaint', x.id))} label={() => 'Open the complaint'}
              empty={<Blank />} />
          </View>

          <Changes rows={data.changes} capped={data.changesCapped} />
        </>
      ) : null}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// a payout
// ---------------------------------------------------------------------------

export function PayoutRecord({ id, onBack }: { id: string; onBack: () => void }) {
  const open = useOpen();
  const { data, error } = useLoad<PayoutRecordPayload>(() => api.hostingAdmin<PayoutRecordPayload>(`/payouts/${encodeURIComponent(id)}`), [id]);
  const ls = useLocalSort();
  const ts = useLocalSort();
  const cs = useLocalSort();
  const lines = useSorted(data?.lines, ls.sort, ls.desc, (x, k) => (k === 'household' ? x.household : k === 'heads' ? x.heads : k === 'amount' ? x.pence : null));
  const tips = useSorted(data?.tips, ts.sort, ts.desc, (x, k) => (k === 'household' ? x.household : k === 'amount' ? x.pence : k === 'at' ? x.at : null));
  const complaints = useSorted(data?.complaints, cs.sort, cs.desc, (x, k) => (k === 'at' ? x.at : k === 'kind' ? x.kind : k === 'state' ? x.state : null));
  const p = data?.payout;
  return (
    <Shell back="Money" onBack={onBack} error={error}>
      {data && p ? (
        <>
          <Band kicker={['Payout', ref(p.id), p.host].filter(Boolean).join(' · ')} title={p.event ?? (p.tipsPence && !p.sharePence ? 'Tips' : 'Payout')}
                stats={[
                  { label: 'Amount', value: gbp(p.pence), tip: tip('Amount', 'Due to the host, tips included.') },
                  { label: 'Tips', value: gbp(p.tipsPence || null), tip: tip('Tips', 'Tips in it, all of them the host’s.') },
                  { label: 'Due', value: when(p.releaseAt, true), tip: tip('Due', 'When it is released if nothing holds it.') },
                  { label: 'Status', value: <Said tone={toneOf(p.state)}>{PAYOUT_WORD[p.state] ?? cap(p.state)}</Said>, tip: tip('Status', 'Scheduled, held, released, paid or failed.') },
                ]} />
          <View style={s.blocks}>
            <Block title="Whose and what">
              <Fact label="Host" tip={tip('Host', 'Opens the host.')}><Opens to={paths.hostingRecord('host', p.hostId)}>{p.host}</Opens></Fact>
              <Fact label="Event" tip={tip('Event', 'Opens the event.')}><Opens to={p.offerId ? paths.hostingRecord('event', p.offerId) : null}>{p.event}</Opens></Fact>
              <Fact label="Session" tip={tip('Session', 'The session it pays for. A dash: a payout of tips alone.')}>{sessionWords(p.session)}</Fact>
              <Fact label="Took place" tip={tip('Took place', 'When the session ended.')}>{when(p.tookPlace, true)}</Fact>
              <Fact label="Confirmed by" tip={tip('Confirmed by', 'Guests who said it happened. One may release it early.')}>{p.confirmedBy ? String(p.confirmedBy) : '—'}</Fact>
            </Block>
            <Block title="Release">
              <Fact label="Held" tip={tip('Held', 'Why it is held. A complaint holds it until it is resolved; missing tax details or Stripe set-up hold it until the host adds them.')}>
                {p.state === 'held' && p.holdReason ? <Said tone="attention">{HOLD_WORD[p.holdReason] ?? cap(p.holdReason)}</Said> : '—'}
              </Fact>
              <Fact label="Released by" tip={tip('Released by', 'The owner, when released by hand over a hold. A dash: by the rule.')}>{p.releasedBy ? cap(p.releasedBy) : '—'}</Fact>
              <Fact label="Sent to Stripe" tip={tip('Sent to Stripe', 'Whether a transfer has been made. Stripe’s own reference stays on the server.')}>{p.sent ? 'Yes' : '—'}</Fact>
              <Fact label="Attempts" tip={tip('Attempts', 'Times it has been sent.')}>{p.attempt ? String(p.attempt) : '—'}</Fact>
              <Fact label="Made" tip={tip('Made', 'When the payout was scheduled.')}>{when(p.madeAt, true)}</Fact>
            </Block>
          </View>

          <View>
            <Head t={tip('Bookings in it', 'Each booking’s share of the session that this payout carries. A row opens the booking.')}>{`Bookings in it · ${data.lines.length}`}</Head>
            <Ladder<PayoutRecordPayload['lines'][number]>
              columns={[
                { key: 'booking', label: 'Booking', width: 100, tip: tip('Booking', 'The first eight characters of its id, as in the ledger.'), cell: (x) => <Word>{ref(x.bookingId)}</Word> },
                { key: 'household', label: 'Household', sort: 'household', grow: true, tip: tip('Household', 'Who booked. Opens their record in Customers.'),
                  cell: (x) => <Opens to={x.householdId ? paths.customer(x.householdId) : null}>{x.household}</Opens> },
                { key: 'heads', label: 'Guests', sort: 'heads', width: 80, align: 'right', tip: tip('Guests', 'People on the booking.'), cell: (x) => <Num n={x.heads} /> },
                { key: 'amount', label: 'Share', sort: 'amount', width: 110, align: 'right', tip: tip('Share', 'What this payout carries of it.'), cell: (x) => <Text style={s.num}>{gbp(x.pence)}</Text> },
              ]}
              rows={lines} keyOf={(x) => x.bookingId} dense {...ls}
              onRow={(x) => open(paths.hostingRecord('booking', x.bookingId))} label={(x) => `Open booking ${ref(x.bookingId)}`}
              empty={<Blank />} />
          </View>

          {data.tips.length ? (
            <View>
              <Head t={tip('Tips in it', 'Tips this payout carries. A row opens the booking it was left on.')}>{`Tips in it · ${data.tips.length}`}</Head>
              <Ladder<PayoutRecordPayload['tips'][number]>
                columns={[
                  { key: 'at', label: 'When', sort: 'at', width: 120, tip: tip('When', 'When it was left.'), cell: (x) => <Word>{when(x.at, true)}</Word> },
                  { key: 'household', label: 'Household', sort: 'household', grow: true, tip: tip('Household', 'Who left it. Opens their record in Customers.'),
                    cell: (x) => <Opens to={x.householdId ? paths.customer(x.householdId) : null}>{x.household}</Opens> },
                  { key: 'amount', label: 'Tip', sort: 'amount', width: 110, align: 'right', tip: tip('Tip', 'All of it the host’s.'), cell: (x) => <Text style={s.num}>{gbp(x.pence)}</Text> },
                ]}
                rows={tips} keyOf={(x) => x.id} dense {...ts}
                onRow={(x) => open(paths.hostingRecord('booking', x.bookingId))} label={() => 'Open the booking'}
                empty={<Blank />} />
            </View>
          ) : null}

          <View>
            <Head t={tip('Complaints on the session', 'An open one holds this payout until it is resolved.')}>{`Complaints on the session · ${data.complaints.length}`}</Head>
            <Ladder<PayoutRecordPayload['complaints'][number]>
              columns={[
                { key: 'at', label: 'When', sort: 'at', width: 120, tip: tip('When', 'When it was raised.'), cell: (x) => <Word>{when(x.at, true)}</Word> },
                { key: 'kind', label: 'What', sort: 'kind', width: 150, tip: tip('What', 'A complaint, a guarantee claim or a host no-show.'), cell: (x) => <Word>{COMPLAINT_WORD[x.kind] ?? cap(x.kind)}</Word> },
                { key: 'household', label: 'Raised by', grow: true, tip: tip('Raised by', 'Opens their record in Customers.'),
                  cell: (x) => <Opens to={x.householdId ? paths.customer(x.householdId) : null}>{x.household}</Opens> },
                { key: 'state', label: 'State', sort: 'state', width: 110, tip: tip('State', 'Open, resolved, declined or paid.'), cell: (x) => <Said tone={toneOf(x.state)}>{cap(x.state)}</Said> },
              ]}
              rows={complaints} keyOf={(x) => x.id} dense {...cs}
              onRow={(x) => open(paths.hostingRecord('complaint', x.id))} label={() => 'Open the complaint'}
              empty={<Blank />} />
          </View>

          <Payments rows={data.payments} by="payout" />
          <Changes rows={data.changes} capped={data.changesCapped} />
        </>
      ) : null}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// a complaint
// ---------------------------------------------------------------------------

export function ComplaintRecord({ id, onBack }: { id: string; onBack: () => void }) {
  const open = useOpen();
  const { data, error } = useLoad<ComplaintRecordPayload>(() => api.hostingAdmin<ComplaintRecordPayload>(`/complaints/${encodeURIComponent(id)}`), [id]);
  const ps = useLocalSort();
  const payouts = useSorted(data?.payouts, ps.sort, ps.desc, (x, k) => (k === 'when' ? x.releaseAt : k === 'amount' ? x.pence : k === 'state' ? x.state : null));
  const k = data?.complaint;
  return (
    <Shell back="Safety" onBack={onBack} error={error}>
      {data && k ? (
        <>
          <Band kicker={['Safety', COMPLAINT_WORD[k.kind] ?? cap(k.kind), ref(k.id)].filter(Boolean).join(' · ')} title={k.event ?? COMPLAINT_WORD[k.kind] ?? 'Complaint'}
                stats={[
                  { label: 'Raised', value: when(k.at, true), tip: tip('Raised', 'When it was raised.') },
                  { label: 'Closed', value: when(k.resolvedAt, true), tip: tip('Closed', 'When it was resolved, declined or paid. A dash: still open.') },
                  { label: 'Status', value: <Said tone={toneOf(k.state)}>{cap(k.state)}</Said>, tip: tip('Status', 'Open, resolved, declined or paid. An open one holds the session’s payout.') },
                ]} />
          <View style={s.blocks}>
            <Block title="Who and what">
              <Fact label="Raised by" tip={tip('Raised by', 'Opens their record in Customers.')}><Opens to={k.householdId ? paths.customer(k.householdId) : null}>{k.household}</Opens></Fact>
              <Fact label="Host" tip={tip('Host', 'Opens the host.')}><Opens to={k.hostId ? paths.hostingRecord('host', k.hostId) : null}>{k.host}</Opens></Fact>
              <Fact label="Event" tip={tip('Event', 'Opens the event.')}><Opens to={k.offerId ? paths.hostingRecord('event', k.offerId) : null}>{k.event}</Opens></Fact>
              <Fact label="Booking" tip={tip('Booking', 'Opens the booking.')}><Opens to={k.bookingId ? paths.hostingRecord('booking', k.bookingId) : null}>{ref(k.bookingId)}</Opens></Fact>
              <Fact label="Session" tip={tip('Session', 'The session it is about.')}>{sessionWords(k.session)}</Fact>
              <Fact label="Claimed" tip={tip('Claimed', 'What a guarantee claim asks for. A dash: not a claim, or no amount.')}>{gbp(k.pence)}</Fact>
            </Block>
          </View>
          <View>
            <Head t={tip('What happened', 'In the household’s words.')}>What happened</Head>
            <Text style={[s.word, { paddingVertical: 10 }]}>{k.reason ?? '—'}</Text>
          </View>
          <View>
            <Head t={tip('Payout it holds', 'The session’s payout. An open complaint holds it until it is resolved; nothing is refunded automatically.')}>{`Payout it holds · ${data.payouts.length}`}</Head>
            <Ladder<ComplaintRecordPayload['payouts'][number]>
              columns={[
                { key: 'when', label: 'Due', sort: 'when', width: 130, tip: tip('Due', 'When it would be released.'), cell: (x) => <Word>{when(x.releaseAt, true)}</Word> },
                { key: 'state', label: 'State', sort: 'state', grow: true, tip: tip('State', 'Scheduled, held with its reason, released, paid or failed.'),
                  cell: (x) => <Said tone={toneOf(x.state)}>{`${PAYOUT_WORD[x.state] ?? cap(x.state)}${x.state === 'held' && x.holdReason ? ` · ${HOLD_WORD[x.holdReason] ?? cap(x.holdReason)}` : ''}`}</Said> },
                { key: 'amount', label: 'Amount', sort: 'amount', width: 110, align: 'right', tip: tip('Amount', 'Tips included.'), cell: (x) => <Text style={s.num}>{gbp(x.pence)}</Text> },
              ]}
              rows={payouts} keyOf={(x) => x.id} dense {...ps}
              onRow={(x) => open(paths.hostingRecord('payout', x.id))} label={() => 'Open the payout'}
              empty={<Blank />} />
          </View>
          <Changes rows={data.changes} capped={data.changesCapped} />
        </>
      ) : null}
    </Shell>
  );
}

const s = StyleSheet.create({
  word: { ...type.body, fontSize: 13.5, color: colors.ink },
  num: { ...type.body, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'], textAlign: 'right' },
  blocks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 36, rowGap: 24, alignItems: 'flex-start' },
  blockHead: { paddingBottom: 8, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted },
});
