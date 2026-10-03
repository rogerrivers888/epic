/**
 * Hosting › Events (hosting v4): BO8e the list, with the drafts counted by the
 * step where hosts stopped; and with ?event=<id> one event — BO8f when its
 * price depends on numbers, BO8g once it is called off, with the refunds made.
 *
 * Kind (One-off · Weekly · Course · On request) replaces the artboards' "Host
 * type", and a private event has none — a dash (handover §3.4). When the host
 * is paid is the setting's number, read from the server; a dash when it is not
 * set. No prose: every column and figure explains itself on hover.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../../api';
import { useQueryState, asOneOf, asText, useRouter } from '../../router';
import { colors, spacing, type, BORDER } from '../../theme';
import { SHORT } from '../../screens/host/v7/model';
import { Ladder, Num, Word, Blank, Kicker, type Col } from '../table';
import { FilterRow, Dropdown } from '../kit';
import { Explain } from '../explain';
import { KIND_WORDS, KIND_OPTIONS, useLoad, useSorted, gbp, when } from './kit';
import { tip, optionsOf, labelOf, useSortState, Said, SearchBox, Fact, Block, Back, Band, Failed, Waiting, stateWord, stateTone } from './Hosts';

// ---------------------------------------------------------------------------
// payloads
// ---------------------------------------------------------------------------

type EventRow = {
  id: string; title: string; host: string; kind: string | null; lane: string; state: string; visibility: 'Public' | 'Private';
  booked: number; min: number | null; max: number | null; decidesBy: string | null; next: string | null; priceMode: string | null; waitingOn?: string[] | null;
};
type EventsPayload = { rows: EventRow[]; draftsByStep: Record<string, { step: string; n: number }[]>; capped: boolean };

type Session = { id: string; n: number | null; date: string | null; time: string | null; booked: number; state: string; decided: 'on' | 'called_off' | null; decidesAt: string | null; confirmedBy: number; payout: string | null; late: boolean | null };
type Refund = { booking: string; bookingId: string; household: string; heads: number | null; pence: number; cause: string | null; state: string; stripe: 'pending' | 'matched' | 'mismatch' | 'not_checked' | null; at: string };
type EventDetail = {
  event: {
    id: string; title: string; host: string | null; hostId: string; kind: string | null; state: string; visibility: string;
    min: number | null; max: number | null; priceMode: string | null; pricePence: number | null; totalPence: number | null;
    refundPolicy: string | null; heldPence: number; bookings: number; waitingOn?: string[] | null;
  };
  numbers: { priceNowEach: number; heldFromEach: number; dueBackPence: number } | null;
  hostIsPaid: { hours: number; earlyOnConfirm: boolean } | null;
  sessions: Session[];
  refunds: Refund[];
};

// ---------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------

const STATUS = [
  { key: 'all', label: 'All' }, { key: 'in_review', label: 'In review' }, { key: 'approved', label: 'Approved · waiting' },
  { key: 'live', label: 'Live' }, { key: 'paused', label: 'Paused' }, { key: 'called_off', label: 'Called off' }, { key: 'ended', label: 'Ended' },
];
const VISIBILITY = [{ key: 'all', label: 'All' }, { key: 'public', label: 'Public' }, { key: 'private', label: 'Private' }];
const KIND_KEYS = KIND_OPTIONS.map((o) => o.key);
const EVENT_SORTS = ['title', 'host', 'kind', 'state', 'booked', 'min', 'decides', 'next'] as const;

const PRICE_WORD: Record<string, string> = { free: 'Free', same_each: 'Same for each', by_numbers: 'Depends on numbers' };
const REFUND_WORD: Record<string, string> = { flexible: 'Flexible · 24 hours', moderate: 'Moderate · 5 days', strict: 'Strict · 50% to 7 days' };
const SESSION_WORD: Record<string, string> = { scheduled: 'Scheduled', called_off: 'Called off', cancelled: 'Cancelled', done: 'Finished' };
const PAYOUT_WORD: Record<string, string> = { scheduled: 'Scheduled', held: 'Held', released: 'Released', paid: 'Paid', failed: 'Failed' };
const CAUSE_WORD: Record<string, string> = {
  guest_cancelled: 'Guest cancelled', host_cancelled: 'Host cancelled', called_off: 'Called off', date_changed: 'Date changed',
  numbers_settled: 'Numbers settled', declined: 'Declined', lapsed: 'Lapsed', complaint: 'Complaint',
};
const STRIPE_WORD: Record<string, string> = { matched: 'Matched', mismatch: 'Mismatch', pending: 'Pending', not_checked: 'Not checked' };

const each = (p: number | null | undefined) => (p == null ? '—' : `${gbp(p)} a person`);
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).replace(/_/g, ' ');

// ---------------------------------------------------------------------------
// BO8e — the list
// ---------------------------------------------------------------------------

export function EventsTab() {
  const [event, setEvent] = useQueryState<string | null>('event', null, asText);
  if (event) return <EventPage id={event} onBack={() => setEvent(null, { replace: false })} />;
  return <EventList onOpen={(id) => setEvent(id, { replace: false })} />;
}

function EventList({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useQueryState('estatus', 'all', asOneOf(STATUS.map((o) => o.key), 'all'));
  const [vis, setVis] = useQueryState('evis', 'all', asOneOf(['all', 'public', 'private'], 'all'));
  const [kind, setKind] = useQueryState('ekind', 'all', asOneOf(KIND_KEYS, 'all'));
  const [q, setQ] = useQueryState<string>('eq', '', asText);
  const { sort, desc, onSort } = useSortState('e', EVENT_SORTS, 'decides');

  // Called off is the server's word for an event with a called-off date, not
  // a stored state, so that one filter is applied here.
  const { data, error } = useLoad<EventsPayload>(() => api.hostingAdmin<EventsPayload>('/events', {
    status: status === 'all' || status === 'called_off' ? null : status,
    visibility: vis === 'all' ? null : vis, kind: kind === 'all' ? null : kind, q: q || null,
  }), [status, vis, kind, q]);

  const filtered = useMemo(() => (data?.rows ?? []).filter((r) => (status === 'called_off' ? r.state === 'called_off' : status === 'all' || r.state === status)), [data, status]);
  const rows = useSorted(filtered, sort, desc, (r, k) => {
    switch (k) {
      case 'title': return r.title;
      case 'host': return r.host;
      case 'kind': return r.kind ? KIND_WORDS[r.kind] ?? r.kind : null;
      case 'state': return stateWord(r.state, r.waitingOn);
      case 'booked': return r.booked;
      case 'min': return r.min;
      case 'decides': return r.decidesBy;
      case 'next': return r.next;
      default: return null;
    }
  });

  const all = data?.rows ?? [];
  const n = (k: number) => (data?.capped ? `${k}+` : String(k));
  const drafts = data ? Object.values(data.draftsByStep).reduce((t, steps) => t + steps.reduce((u, x) => u + x.n, 0), 0) : null;

  const columns: Col<EventRow>[] = [
    { key: 'title', label: 'Event', sort: 'title', grow: true, tip: tip('Event', 'As titled by the host. Opens the event.'), cell: (r) => <Text style={[s.word, s.strong]} numberOfLines={1}>{r.title}</Text> },
    { key: 'host', label: 'Host', sort: 'host', width: 150, tip: tip('Host', 'Who runs it.'), cell: (r) => <Text style={s.word} numberOfLines={1}>{r.host}</Text> },
    { key: 'kind', label: 'Kind', sort: 'kind', width: 96, tip: tip('Kind', 'One-off, weekly, course or on request, public or private.'),
      cell: (r) => (r.kind ? <Word>{KIND_WORDS[r.kind] ?? r.kind}</Word> : <Blank />) },
    { key: 'state', label: 'Status', sort: 'state', width: 270, tip: tip('Status', 'In review, approved and waiting on whatever is still missing, live, paused, called off or ended.'),
      cell: (r) => <Said tone={stateTone(r.state)}>{stateWord(r.state, r.waitingOn)}</Said> },
    { key: 'booked', label: 'Booked', sort: 'booked', width: 86, align: 'right', tip: tip('Booked', 'Guests booked so far, of the maximum.'),
      cell: (r) => (r.booked ? <Text style={s.num}>{r.max ? `${r.booked} of ${r.max}` : String(r.booked)}</Text> : <Blank />) },
    { key: 'min', label: 'Min', sort: 'min', width: 50, align: 'right', tip: tip('Min', 'Below this by decides-by and it is called off.'),
      cell: (r) => <Said tone={r.min != null && r.booked < r.min && r.decidesBy ? 'attention' : 'plain'}>{r.min == null ? '—' : String(r.min)}</Said> },
    { key: 'decides', label: 'Decides by', sort: 'decides', width: 120, align: 'right', tip: tip('Decides by', 'When we decide whether it goes ahead: the next session not yet decided.'),
      cell: (r) => (r.decidesBy ? <Text style={s.num}>{when(r.decidesBy)}</Text> : <Blank />) },
    { key: 'next', label: 'Next', sort: 'next', width: 70, align: 'right', tip: tip('Next', 'The next date it runs.'),
      cell: (r) => (r.next ? <Text style={s.num}>{when(r.next)}</Text> : <Blank />) },
  ];

  return (
    <View style={{ gap: 16 }}>
      <Band kicker="Hosting · Events" title={data ? `${n(all.length)} events` : 'Events'}
            stats={[
              { label: 'Live', value: data ? n(all.filter((r) => r.state === 'live').length) : '—', tip: tip('Live', 'Of the events listed, those bookable now.') },
              { label: 'In review', value: data ? n(all.filter((r) => r.state === 'in_review').length) : '—', tip: tip('In review', 'Of the events listed, those waiting for a person.') },
              { label: 'Approved, waiting', value: data ? n(all.filter((r) => r.state === 'approved').length) : '—', tip: tip('Approved, waiting', 'Approved, and live by itself once what is still missing — Checked, Verified, Payouts — is done.') },
              { label: 'Called off', value: data ? n(all.filter((r) => r.state === 'called_off').length) : '—', tip: tip('Called off', 'Of the events listed, those called off.') },
              { label: 'Drafts', value: drafts == null ? '—' : String(drafts), tip: tip('Drafts', 'Started and not published. Counted only, never who.') },
            ]} />
      <FilterRow>
        <Dropdown label="STATUS" value={labelOf(STATUS, status)} options={optionsOf(STATUS, status)} onPick={(k) => setStatus(k)} width={260} />
        <Dropdown label="VISIBILITY" value={labelOf(VISIBILITY, vis)} options={optionsOf(VISIBILITY, vis)} onPick={(k) => setVis(k)} width={180} />
        <Dropdown label="KIND" value={labelOf(KIND_OPTIONS, kind)} options={optionsOf(KIND_OPTIONS, kind)} onPick={(k) => setKind(k)} width={200} />
        <SearchBox value={q} onCommit={(v) => setQ(v)} placeholder="Event or host" />
      </FilterRow>
      {error ? <Failed>{error}</Failed> : !data ? <Waiting /> : (
        <>
          <Ladder columns={columns} rows={rows} keyOf={(r) => r.id} onRow={(r) => onOpen(r.id)} label={(r) => `Open ${r.title}`}
                  sort={sort} desc={desc} onSort={onSort} dense
                  phoneRow={(r) => ({
                    name: r.title, note: r.host,
                    chips: [
                      { key: 'state', word: stateWord(r.state, r.waitingOn), lead: true, tip: columns[3].tip },
                      ...(r.kind ? [{ key: 'kind', word: KIND_WORDS[r.kind] ?? r.kind, tip: columns[2].tip }] : []),
                      ...(r.booked ? [{ key: 'booked', word: r.max ? `${r.booked} of ${r.max}` : `${r.booked} booked`, tip: columns[4].tip }] : []),
                      ...(r.decidesBy ? [{ key: 'decides', word: `decides ${when(r.decidesBy)}`, tip: columns[6].tip }] : []),
                    ],
                  })}
                  empty={<Word muted>No events match.</Word>} />
          {data.capped ? <Explain tip={tip('The first 1,000', 'The list stops at 1,000 events. Narrow the filters to see the rest.')}><Word muted>First 1,000 only</Word></Explain> : null}
          <Drafts byStep={data.draftsByStep} total={drafts ?? 0} />
        </>
      )}
    </View>
  );
}

/** Drafts by the step where hosts stopped: counts only, never who, one line a kind. */
function Drafts({ byStep, total }: { byStep: EventsPayload['draftsByStep']; total: number }) {
  const kinds = Object.keys(byStep);
  return (
    <View style={{ marginTop: 10 }}>
      <View style={s.blockHead}>
        <Kicker tip={tip('Where hosts stop', 'Drafts by the last step they saved, for each kind. Counts only, never who.')}>{`Drafts · ${total} · where hosts stop`}</Kicker>
      </View>
      {kinds.map((k) => (
        <View key={k} style={s.draftRow}>
          <Text style={[s.word, s.strong, { width: 110 }]} numberOfLines={1}>{KIND_WORDS[k] ?? k}</Text>
          <View style={s.draftSteps}>
            {byStep[k].map((x) => {
              const word = (SHORT as Record<string, string>)[x.step] ?? cap(x.step);
              return (
                <Explain key={x.step} tip={tip(`Stopped at ${word}`, 'Drafts whose last saved step is this one. Counts only, never who.')} style={s.draftStep}>
                  <Text style={s.draftWord} numberOfLines={1}>{word}</Text>
                  {x.n ? <Text style={[s.num, s.strong]}>{String(x.n)}</Text> : <Blank />}
                </Explain>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// BO8f / BO8g — one event
// ---------------------------------------------------------------------------

function EventPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { setQuery } = useRouter();
  const { data, error } = useLoad<EventDetail>(() => api.hostingAdmin<EventDetail>(`/events/${encodeURIComponent(id)}`), [id]);
  const [ssort, setSsort] = React.useState<string | null>(null);
  const [sdesc, setSdesc] = React.useState(false);
  const [rsort, setRsort] = React.useState<string | null>(null);
  const [rdesc, setRdesc] = React.useState(false);
  const sessions = useSorted(data?.sessions, ssort, sdesc, (x, k) => (k === 'n' ? x.n : k === 'date' ? `${x.date ?? ''} ${x.time ?? ''}` : k === 'booked' ? x.booked : k === 'decided' ? x.decided : k === 'confirmed' ? x.confirmedBy : k === 'payout' ? x.payout : k === 'state' ? x.state : null));
  const refunds = useSorted(data?.refunds, rsort, rdesc, (r, k) => (k === 'booking' ? r.booking : k === 'household' ? r.household : k === 'heads' ? r.heads : k === 'amount' ? r.pence : k === 'cause' ? r.cause : k === 'at' ? r.at : k === 'stripe' ? r.stripe : null));

  if (error) return <View style={{ gap: 14 }}><Back label="Events" onPress={onBack} /><Failed>{error}</Failed></View>;
  if (!data) return <View style={{ gap: 14 }}><Back label="Events" onPress={onBack} /><Waiting /></View>;

  const e = data.event;
  const isPublic = e.visibility === 'public';
  const calledOff = e.state === 'called_off';
  const open = data.sessions.find((x) => x.state === 'scheduled' && !x.decided) ?? null;
  const focus = open ?? data.sessions[0] ?? null;
  const decidedOff = data.sessions.find((x) => x.decided === 'called_off') ?? null;
  const refunded = data.refunds.filter((r) => r.state === 'succeeded').reduce((t, r) => t + r.pence, 0);
  const kicker = ['Event', e.host, isPublic && e.kind ? KIND_WORDS[e.kind] ?? e.kind : null, isPublic ? 'Public' : 'Private'].filter(Boolean).join(' · ');
  const byNumbers = e.priceMode === 'by_numbers';
  const paid = data.hostIsPaid
    ? `${data.hostIsPaid.hours}h after each session${data.hostIsPaid.earlyOnConfirm ? ' · earlier on a guest’s yes' : ''}`
    : null;

  const stats = calledOff
    ? [
      { label: 'Booked', value: decidedOff ? String(decidedOff.booked || '—') : '—', tip: tip('Booked', 'Guests booked when it decided.') },
      { label: 'Min', value: e.min == null ? '—' : String(e.min), tip: tip('Min', 'Not reached by decides-by.') },
      { label: 'Decided', value: when(decidedOff?.decidesAt?.slice(0, 10)), tip: tip('Decided', 'Called off on this date.') },
      { label: 'Refunded', value: gbp(refunded || null), tip: tip('Refunded', 'Refunds Stripe took, every booking.') },
      { label: 'Status', value: 'Called off', tip: tip('Status', 'Minimum not reached, or called off by the host.') },
    ]
    : [
      { label: 'Booked', value: focus?.booked ? String(focus.booked) : '—', tip: tip('Booked', 'Guests booked on the next session still to decide.') },
      { label: 'Min', value: e.min == null ? '—' : String(e.min), tip: tip('Min', focus && e.min != null && focus.booked >= e.min ? 'Reached, so it is going ahead.' : 'Below this by decides-by and it is called off.') },
      { label: 'Max', value: e.max == null ? '—' : String(e.max), tip: tip('Max', 'The cap.') },
      { label: 'Decides by', value: when(open?.decidesAt?.slice(0, 10)), tip: tip('Decides by', 'When the next session still to decide is decided.') },
      { label: 'Status', value: stateWord(e.state, e.waitingOn), tip: tip('Status', 'In review, approved and waiting on whatever is still missing, live, paused, called off or ended.') },
    ];

  const sessionCols: Col<Session>[] = [
    { key: 'n', label: 'Session', sort: 'n', width: 76, align: 'right', tip: tip('Session', 'One row per session. Weekly and course events have many.'), cell: (x) => <Num n={x.n} /> },
    { key: 'date', label: 'Date', sort: 'date', grow: true, tip: tip('Date', 'When it runs.'), cell: (x) => (x.date ? <Word>{[when(x.date), x.time].filter(Boolean).join(' · ')}</Word> : <Blank />) },
    { key: 'booked', label: 'Booked', sort: 'booked', width: 90, align: 'right', tip: tip('Booked', 'Guests booked for this session, of the maximum.'),
      cell: (x) => (x.booked ? <Text style={s.num}>{e.max ? `${x.booked} of ${e.max}` : String(x.booked)}</Text> : <Blank />) },
    { key: 'decided', label: 'Decided', sort: 'decided', width: 100, tip: tip('Decided', 'On, or called off, at decides-by. A dash: not yet.'),
      cell: (x) => (x.decided ? <Said tone={x.decided === 'on' ? 'live' : 'refusal'}>{x.decided === 'on' ? 'On' : 'Called off'}</Said> : <Blank />) },
    { key: 'confirmed', label: 'Confirmed by', sort: 'confirmed', width: 110, align: 'right', tip: tip('Confirmed by', 'Guests who said it took place. A yes may release the payout early.'),
      cell: (x) => (x.state === 'scheduled' && !x.confirmedBy ? <Blank /> : <Num n={x.confirmedBy} />) },
    { key: 'payout', label: 'Payout', sort: 'payout', width: 96, tip: tip('Payout', 'This session’s payout: scheduled, held, released, paid or failed.'),
      cell: (x) => (x.payout ? <Said tone={x.payout === 'held' ? 'attention' : x.payout === 'failed' ? 'refusal' : 'plain'}>{PAYOUT_WORD[x.payout] ?? cap(x.payout)}</Said> : <Blank />) },
    { key: 'state', label: 'Status', sort: 'state', width: 100, tip: tip('Status', 'Scheduled, called off, cancelled or finished.'),
      cellTip: (x) => (x.late ? tip('Changed late', 'Changed within 48 hours; it counts against the host.') : null),
      cell: (x) => <Said tone={x.state === 'called_off' || x.state === 'cancelled' ? 'refusal' : x.late ? 'attention' : 'plain'}>{SESSION_WORD[x.state] ?? cap(x.state)}</Said> },
  ];

  const refundCols: Col<Refund>[] = [
    { key: 'booking', label: 'Booking', sort: 'booking', width: 100, tip: tip('Booking', 'The booking’s reference: the first eight characters of its id, as in the ledger.'), cell: (r) => <Text style={s.word} numberOfLines={1}>{r.booking}</Text> },
    { key: 'household', label: 'Household', sort: 'household', grow: true, tip: tip('Household', 'Who booked.'), cell: (r) => <Text style={s.word} numberOfLines={1}>{r.household}</Text> },
    { key: 'heads', label: 'Guests', sort: 'heads', width: 70, align: 'right', tip: tip('Guests', 'People on the booking.'), cell: (r) => <Num n={r.heads} /> },
    { key: 'amount', label: 'Amount', sort: 'amount', width: 96, align: 'right', tip: tip('Amount', 'Refunded.'), cell: (r) => <Text style={s.num}>{gbp(r.pence)}</Text> },
    { key: 'cause', label: 'Cause', sort: 'cause', width: 140, tip: tip('Cause', 'Why it was refunded.'), cell: (r) => (r.cause ? <Word>{CAUSE_WORD[r.cause] ?? cap(r.cause)}</Word> : <Blank />) },
    { key: 'at', label: 'When', sort: 'at', width: 110, tip: tip('When', 'Sent to Stripe.'), cell: (r) => <Word>{when(r.at, true)}</Word> },
    { key: 'stripe', label: 'Stripe', sort: 'stripe', width: 100, tip: tip('Stripe', 'Whether Stripe’s record matches ours at the last reconciliation.'),
      cellTip: (r) => (r.stripe == null ? tip('Stripe', 'No Stripe reference on this refund yet.') : null),
      cell: (r) => (r.stripe ? <Said tone={r.stripe === 'mismatch' ? 'refusal' : r.stripe === 'matched' ? 'plain' : 'attention'}>{STRIPE_WORD[r.stripe] ?? r.stripe}</Said> : <Blank />) },
  ];

  return (
    <View style={{ gap: 16 }}>
      <Back label="Events" onPress={onBack} />
      <Band kicker={kicker} title={e.title} stats={stats} />

      <View style={s.blocks}>
        <Block title={`Price · ${PRICE_WORD[e.priceMode ?? ''] ?? '—'}`} tip={tip('Price', 'How the price is set: free, the same for each, or the whole cost split between those booked.')}>
          {byNumbers ? (
            <>
              <Fact label="Whole cost" tip={tip('Whole cost', 'What the host asks for the whole event, split between everyone booked.')}>{gbp(e.totalPence)}</Fact>
              <Fact label="Price now" tip={tip('Price now', `The whole cost split between the ${focus?.booked ?? 0} booked, or the minimum if fewer.`)}>{each(data.numbers?.priceNowEach)}</Fact>
              <Fact label="Held from each" tip={tip('Held from each', 'The price if only the minimum came. Taken at booking.')}>{gbp(data.numbers?.heldFromEach)}</Fact>
              <Fact label="Due back at decides-by" tip={tip('Due back at decides-by', 'The difference, refunded to everyone booked when it decides. Grows if more book.')}>
                {data.numbers && data.numbers.dueBackPence ? `${gbp(data.numbers.heldFromEach - data.numbers.priceNowEach)} each · ${gbp(data.numbers.dueBackPence)}` : '—'}
              </Fact>
            </>
          ) : (
            <Fact label="Price" tip={tip('Price', 'What each guest pays.')}>{e.priceMode === 'free' ? 'Free' : each(e.pricePence)}</Fact>
          )}
        </Block>
        <Block title="Terms and payout">
          <Fact label="Refund policy" tip={tip('Refund policy', 'Flexible: full to 24 hours before. Moderate: full to 5 days. Strict: 50% to 7 days, none after. Always full if the host cancels or it is called off.')}>
            {e.refundPolicy ? REFUND_WORD[e.refundPolicy] ?? cap(e.refundPolicy) : '—'}
          </Fact>
          <Fact label="Bookings" tip={tip('Bookings', 'Bookings charged, and what is held from them now.')}>
            {e.bookings ? `${e.bookings} · ${gbp(e.heldPence)} held` : '—'}
          </Fact>
          <Fact label="Host is paid" tip={tip('Host is paid', paid ? 'Released after each session at this time if nobody has complained; a guest’s yes or a review may release it earlier. A complaint holds it. The number is the setting’s.' : 'When a host is paid is not set in Settings yet.')}>
            {paid ?? '—'}
          </Fact>
          <Fact label="Host" tip={tip('Host', 'Who runs it. Opens her page.')}>
            <Text style={s.link} numberOfLines={1} onPress={() => setQuery({ tab: 'hosts', host: e.hostId, event: null }, { replace: false })}>{e.host ?? '—'}</Text>
          </Fact>
        </Block>
      </View>

      <View>
        <View style={s.blockHead}><Kicker tip={tip('Sessions', 'Every session of this event, in date order.')}>{`Sessions · ${data.sessions.length}`}</Kicker></View>
        <Ladder columns={sessionCols} rows={sessions} keyOf={(x) => x.id} dense sort={ssort} desc={sdesc}
                onSort={(k) => { if (ssort === k) setSdesc(!sdesc); else { setSsort(k); setSdesc(false); } }}
                empty={<Word muted>No sessions.</Word>} />
      </View>

      {data.refunds.length || calledOff ? (
        <View>
          <View style={s.blockHead}><Kicker tip={tip('Refunds made', 'Each refund and release on this event, and whether Stripe agrees.')}>{`Refunds made · ${data.refunds.length}`}</Kicker></View>
          <Ladder columns={refundCols} rows={refunds} keyOf={(r, i) => `${r.at}-${i}`} dense sort={rsort} desc={rdesc}
                  onSort={(k) => { if (rsort === k) setRdesc(!rdesc); else { setRsort(k); setRdesc(false); } }}
                  empty={<Word muted>No refunds.</Word>} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  word: { ...type.body, fontSize: 13.5, color: colors.ink },
  strong: { fontWeight: '700' },
  num: { ...type.body, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'], textAlign: 'right' },
  link: { ...type.body, fontSize: 13.5, color: colors.ink, textDecorationLine: 'underline' },
  blocks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 36, rowGap: 24, alignItems: 'flex-start' },
  blockHead: { paddingBottom: 8, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted },
  draftRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  draftSteps: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', columnGap: 26, rowGap: 6 },
  draftStep: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  draftWord: { ...type.small, color: colors.inkMuted },
});
