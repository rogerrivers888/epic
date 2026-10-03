/**
 * A booking, as the guest has it (guest handoff G15–G19, G28, G29; G11 straight
 * after booking; G20 once it has happened).
 *
 * The top of the page says what needs saying now — the next session of a course
 * (G15), a date the host moved with Keep my place · Cancel · full refund (G16),
 * called off and refunded (G17), the host couldn't make it and the hold is
 * released (G28), Going ahead? and what is due back (G29), a drop off's
 * collection and contact — and every booking page then carries: Where · Who's
 * going · What you told the host · Message · Add to calendar · Share · Receipt ·
 * Manage (book more sessions · change how many are going · cancel, with the
 * refund shown before confirming, G19).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Share } from 'react-native';
import { api, ApiError, type GuestBooking as Booking, type GuestOptions } from '../../api';
import { CompactBand } from '../../components/Band';
import { mediaUrl } from '../../components/hosting';
import { paths, withQuery, type Route } from '../../routes';
import { useRouter } from '../../router';
import { BookingScreen } from '../BookingScreen';
import { Booked, addToCalendar } from './Booked';
import {
  AMBER, Buttons, Chips, DEEP_GREEN, Field, Foot, GoingAhead, GUEST_RED, GuestPage, GuestSheet, INACTIVE, INK, INK_MUTED, Kick, LIME, LIME_TINT, Notice, Para,
  PriceLines, Rows, Seg, Stars, Waiting, dayWords, firstName, gbp, shortDay, useToast,
} from './kit';
import { CardBox, confirmWithCard, finishWithBank, loadStripe, type PayOutcome } from './pay';
import { lastRefundAt } from './whoGoing';

const POLICY: Record<string, string> = { flexible: 'Flexible', moderate: 'Moderate', strict: 'Strict' };
const at = (d: string, t: string | null) => `${dayWords(d)}${t ? ` · ${t}` : ''}`;

/** `/bookings/<id>`: Booked after booking, the guest pages for a lane booking, the older page for anything else. */
export function GuestBooking({ route }: { route: Extract<Route, { name: 'booking' }> }) {
  const { query } = useRouter();
  const [lane, setLane] = useState<string | null | undefined>(undefined);
  useEffect(() => { setLane(undefined); api.guestBooking(route.id).then((r) => setLane(r.booking.event.lane ?? null)).catch(() => setLane(null)); }, [route.id]);
  if (route.chat) return <BookingScreen route={route} />;
  if (lane === undefined) return <Waiting />;
  if (!lane) return <BookingScreen route={route} />;
  if (query.get('done') === '1') return <Booked id={route.id} />;
  if (route.rate) return <After id={route.id} />;
  return <BookingPage id={route.id} />;
}

/**
 * TEMPORARY until Claude Design's screen: the payment a booking far ahead owes after its saved card was refused
 * (register L4), from the kit's own pieces — the card field, a line, one button. Stripe confirms it in the browser;
 * the server reads it back.
 */
function PayDue({ id, pence, onPaid }: { id: string; pence: number; onPaid: () => void }) {
  const toast = useToast();
  const stripe = useRef<any>(null);
  const card = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const pending = useRef<{ clientSecret: string; paymentIntent: string } | null>(null);
  useEffect(() => { void loadStripe().then((s) => { stripe.current = s; setReady(Boolean(s)); }); }, []);
  const pay = async () => {
    if (!stripe.current || !card.current) { toast.show('Add your card'); return; }
    try {
      if (!pending.current) {
        const r = await api.guestPayNow(id);
        if (!r.pay.clientSecret) { toast.show('Paying isn’t ready yet'); return; }
        pending.current = { clientSecret: r.pay.clientSecret, paymentIntent: r.pay.paymentIntent };
      }
      let out: PayOutcome = await confirmWithCard(stripe.current, pending.current.clientSecret, card.current);
      if (out.state === 'bank') out = await finishWithBank(stripe.current, pending.current.clientSecret);
      if (out.state !== 'paid') { if (out.state === 'declined' || out.state === 'failed') pending.current = null; toast.show(out.state === 'processing' ? 'Your bank is still processing it' : out.state === 'bank' ? 'Approve it in your banking app, then pay again' : out.message); return; }
      await api.guestPaid(id, pending.current.paymentIntent).catch(() => null);
      toast.show('Paid · your place is kept');
      onPaid();
    } catch (e: any) { toast.show(e?.message ?? 'That didn’t go through.'); }
  };
  return (
    <>
      <Notice bg={AMBER} weight="700">{`Your card was declined · ${gbp(pence)} is due now. Your place is kept.`}</Notice>
      {ready ? <CardBox stripe={stripe.current} onReady={(c) => { card.current = c; }} /> : null}
      <Buttons row={false} items={[{ label: `Pay ${gbp(pence)}`, tone: 'ink', onPress: () => { void pay(); } }]} />
    </>
  );
}

export function BookingPage({ id }: { id: string }) {
  const { navigate, back } = useRouter();
  const toast = useToast();
  const [b, setB] = useState<Booking | null>(null);
  const [opt, setOpt] = useState<GuestOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  // quote: null while it is worked out, 'failed' when it couldn't be — Cancel waits for a real one (Codex, 3 Oct 2026).
  const [cancelling, setCancelling] = useState<null | { whole: boolean; quote: { pence: number | null; words: string | null; policy: string | null } | null | 'failed' }>(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => api.guestBooking(id).then((r) => { setB(r.booking); return r.booking; }).catch((e) => { setError(e?.message ?? 'That booking didn’t load.'); return null; }), [id]);
  useEffect(() => { void load().then((bk) => { if (bk) api.guestOptions(bk.event.id).then(setOpt).catch(() => setOpt(null)); }); }, [load]);
  if (!b) return <Waiting error={error} />;

  const lane = b.event.lane;
  const host = firstName(b.event.host.name);
  const live = b.sessions.filter((s) => s.booked && s.state === 'scheduled');
  const next = live.find((s) => !s.finished) ?? null;
  const declined = b.request && (b.request.state === 'declined' || b.request.state === 'lapsed');
  const calledOff = b.chip === 'called_off';
  const cancelled = b.state === 'cancelled';
  const when = b.request?.date ? at(b.request.date, b.request.time) : next ? at(next.date, next.time) : b.sessions[0] ? at(b.sessions[0].date, b.sessions[0].time) : '';
  const blocks: React.ReactNode[] = [];

  // ---- what needs saying now
  if (b.dateChange) {
    const ch = b.dateChange.sessions[0];
    blocks.push(
      <Notice key="moved" bg={AMBER} weight="700">{`${host} moved this to ${at(ch.to.date, ch.to.time)}. It was ${dayWords(ch.from.date)}${ch.from.time && ch.from.time !== ch.to.time ? ` · ${ch.from.time}` : ''}.`}</Notice>,
      <Buttons key="moved-b" row items={[
        { label: 'Keep my place', tone: 'ink', onPress: async () => { try { await api.guestKeep(b.id); toast.show(`Kept · see you ${dayWords(ch.to.date).split(' ')[0]}`); void load(); } catch (e: any) { toast.show(e?.message ?? 'That didn’t save.'); } } },
        { label: 'Cancel · full refund', tone: 'redText', onPress: async () => {
          try { const r = await api.guestCancel(b.id, b.dateChange!.sessions.map((x) => x.id)); toast.show(`Cancelled · ${gbp(r.refundPence)} back to your card${r.feeKeptPence ? ` (${gbp(r.feeKeptPence)} cancellation fee kept)` : ''}`); void load(); }
          catch (e: any) { toast.show(e?.message ?? 'That didn’t go through.'); }
        } },
      ]} />,
    );
  }
  // A booking far ahead whose later charge the card refused (L4): pay it here and keep the place.
  if (!cancelled && b.money.later?.failed) blocks.push(<PayDue key="due" id={b.id} pence={b.money.later.pence} onPaid={() => { void load(); }} />);
  if (declined) {
    blocks.push(
      <Notice key="no" weight="800">{`${host} can’t make ${b.request!.date ? dayWords(b.request!.date) : 'that time'}`}</Notice>,
      <Para key="no-l" color={INK_MUTED}>{`Your card hold of ${gbp(b.money.heldPence ?? b.money.valuePence ?? 0)} has been released. You weren’t charged.`}</Para>,
    );
    const others = (opt?.slots ?? []).flatMap((s) => s.times.map((t) => ({ date: s.date, time: t }))).slice(0, 6);
    if (others.length) blocks.push(<Kick key="other-k">{`Other times with ${host}`}</Kick>, <Chips key="other" items={others.map((o) => ({ key: `${o.date}${o.time}`, label: at(o.date, o.time), on: false, onPress: () => navigate(paths.experienceBook(b.event.id)) }))} />);
  } else if (calledOff) {
    const gone = b.money.refunds.filter((r) => r.state === 'succeeded');
    const back = gone.reduce((n, r) => n + r.pence, 0);
    // The day the money went back: when the latest refund went through, in the screen's own "21 Sep".
    const backOn = lastRefundAt(gone.map((r) => ({ at: r.doneAt ?? null })));
    const ga = b.goingAhead;
    blocks.push(<Notice key="off">{`Called off.${ga ? ` It needed ${ga.min}${ga.decidesOn ? ` by ${dayWords(ga.decidesOn)}` : ''} and had ${ga.booked}.` : ''}${back ? ` ${gbp(back)} went back to your card${backOn ? ` on ${shortDay(backOn)}` : ''}.` : ''}`}</Notice>);
  } else if (b.request?.state === 'asked') {
    blocks.push(<Notice key="ask" bg={AMBER} weight="700">{`Requested · ${host} has until ${b.request.respondBy ? new Date(b.request.respondBy).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'tomorrow'} to say yes. Your card is held, not charged.`}</Notice>);
  } else if (!cancelled && lane === 'course' && next) {
    const idx = b.sessions.indexOf(next);
    blocks.push(
      <Notice key="run" bg={LIME} weight="700">{`Session ${idx + 1} of ${b.sessions.length} · ${dayWords(next.date)}${next.time ? `, ${next.time}` : ''}${next.topic ? ` · ${next.topic}` : ''}`}</Notice>,
      <Kick key="run-k">Your sessions</Kick>,
      <Rows key="run-r" items={b.sessions.map((s, i) => ({ key: s.id, title: `${dayWords(s.date)}${s.topic ? ` · ${s.topic}` : ''}`, value: s.finished ? 'Done' : i === idx ? 'Next' : '', valueColor: s.finished ? DEEP_GREEN : INK, weight: i === idx ? '800' as const : '600' as const }))} />,
    );
  } else if (!cancelled && b.goingAhead && b.chip === 'waiting') {
    const ga = b.goingAhead;
    blocks.push(<GoingAhead key="ga" boxes={[{ label: 'Needs', value: String(ga.min) }, { label: 'Booked so far', value: String(ga.booked) }, { label: 'Decided', value: ga.decidesOn ? dayWords(ga.decidesOn) : '—' }]} line="If it falls short it’s called off and everything comes back." />);
  } else if (!cancelled && next && !b.dateChange) {
    blocks.push(<Notice key="on" bg={LIME} weight="700">{`${b.chipWords} · ${dayWords(next.date)}${next.time ? `, ${next.time}` : ''}${b.dropOff ? ' · drop off' : ''}`}</Notice>);
  }
  if (b.numbers && !cancelled && !calledOff) {
    const n = b.numbers;
    const lines = [
      { label: `You paid · ${n.heads} ${n.heads === 1 ? 'person' : 'people'}`, value: gbp(n.paidEach * n.heads) },
      { label: `Price now · if ${Math.max(n.minCount, b.goingAhead?.booked ?? 0)} come`, value: `${gbp(n.nowEach)} each` },
      ...(n.atMost ? [{ label: `If ${n.atMost.count} come`, value: `${gbp(n.atMost.each)} each` }] : []),
      ...(n.atMost ? [{ label: `Due back if ${n.atMost.count} come${b.goingAhead?.decidesOn ? ` · on ${dayWords(b.goingAhead.decidesOn)}` : ''}`, value: gbp(n.atMost.dueBackPence), color: DEEP_GREEN, bold: true }] : []),
    ];
    blocks.push(<Kick key="money-k">Your money</Kick>, <PriceLines key="money" items={lines} />);
  }
  if (!cancelled && !declined && lane === 'weekly' && live.length > 1) {
    blocks.push(<Kick key="ss-k">Your sessions</Kick>, <Rows key="ss" items={live.map((s) => ({ key: s.id, title: at(s.date, s.time), value: s.finished ? 'Done' : '', valueColor: DEEP_GREEN }))} />);
  }
  if (!cancelled && b.dropOff) {
    const kids = b.who.children;
    blocks.push(<Kick key="drop-k" top={4}>Drop off</Kick>, <Rows key="drop" items={[
      ...(b.event.endsAt ? [{ title: `Collect at ${b.event.endsAt}` }] : []),
      ...kids.filter((k) => k.emergencyContact).map((k, i) => ({ key: `ec${i}`, title: 'Emergency contact', sub: `${k.name ?? 'Your child'} · ${k.emergencyContact}` })),
    ]} />);
  }
  if (b.after && !b.after.rated && b.state !== 'cancelled') {
    blocks.push(<Rows key="after" items={[{ title: 'How was it?', sub: 'Did it happen, rate it, leave a tip', weight: '700', onPress: () => navigate(paths.bookingRate(b.id)) }]} />);
  }

  // ---- what every booking page carries (not on a called-off or declined one: there is nothing left to go to)
  if (!calledOff && !declined && !cancelled) {
    const maps = b.where.lat != null && b.where.lng != null ? `https://maps.google.com/?q=${b.where.lat},${b.where.lng}` : b.where.label ? `https://maps.google.com/?q=${encodeURIComponent(b.where.label)}` : null;
    const people = [...b.who.children.map((k) => `${k.name ?? 'A child'}${k.age != null ? ` · age ${k.age}` : ''}`)];
    const answered = [...(Array.isArray(b.answers.dietary) ? b.answers.dietary : []), b.answers.bring ? `Bringing ${b.answers.bring}` : null, b.answers.plusOne ? 'Bringing someone' : null, b.answers.stay ? `Staying · ${b.answers.stay}` : null, b.answers.note ?? null].filter(Boolean) as string[];
    blocks.push(
      <Kick key="where-k" top={4}>Where</Kick>,
      <Rows key="where" items={[{ title: b.where.label ?? 'Where it happens is shared once you’re booked', sub: maps ? 'Directions' : null, onPress: maps ? () => { void Linking.openURL(maps); } : undefined }]} />,
      <Kick key="who-k" top={4}>Who’s going</Kick>,
      <Rows key="who" items={[{ title: people.length ? people.join(', ') : `${b.heads} ${b.heads === 1 ? 'person' : 'people'}`, sub: people.length ? `${b.heads} ${b.heads === 1 ? 'person' : 'people'}` : null }]} />,
      <Kick key="told-k" top={4}>{`What you told ${host}`}</Kick>,
      <Rows key="told" items={[{ title: answered.length ? answered.join(' · ') : 'Nothing yet', sub: b.answersEditable ? 'You can change this until 24 hours before' : null, onPress: b.answersEditable ? () => setEditing(true) : undefined }]} />,
      <Rows key="acts" items={[
        { title: `Message ${host}`, onPress: () => navigate(paths.bookingChat(b.id)) },
        ...(b.sessions.some((s) => s.booked) ? [{ title: 'Add to calendar', onPress: () => { if (addToCalendar(b)) toast.show('Added'); } }] : []),
        // A private event's bare address opens for nobody else: share it only when it is public (Codex, 3 Oct 2026).
        ...(b.event.visibility && b.event.visibility !== 'public' ? [] : [{ title: 'Share with someone going', onPress: async () => {
          const url = Platform.OS === 'web' && typeof location !== 'undefined' ? `${location.origin}${paths.experience(b.event.id)}` : paths.experience(b.event.id);
          try { if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) { await navigator.clipboard.writeText(url); toast.show('Link copied'); } else await Share.share({ message: url }); } catch { /* closed */ }
        } }]),
        { title: 'Receipt', onPress: () => navigate(paths.settings('payments')) },
      ]} />,
      <Kick key="manage-k" top={4}>Manage</Kick>,
      <Rows key="manage" items={[
        ...(lane === 'weekly' ? [{ title: 'Book more sessions', onPress: () => navigate(paths.experienceBook(b.event.id)) }] : []),
        // "Change how many are going" waits for a way to change a booking in place: opening Book here would make a second one (Codex, 3 Oct 2026).
        { title: 'Cancel', weight: '700' as const, valueColor: GUEST_RED, onPress: async () => {
          setCancelling({ whole: lane !== 'weekly', quote: null });
          const q = await api.guestCancelQuote(b.id, lane === 'weekly' && next ? [next.id] : null).catch(() => 'failed' as const);
          setCancelling({ whole: lane !== 'weekly', quote: q });
        } },
      ]} />,
    );
  }

  const quoteFor = async (whole: boolean) => {
    setCancelling({ whole, quote: null });
    const q = await api.guestCancelQuote(b.id, whole || !next ? null : [next.id]).catch(() => 'failed' as const);
    setCancelling({ whole, quote: q });
  };
  const confirmCancel = async () => {
    if (!cancelling || cancelling.quote == null || cancelling.quote === 'failed') return;
    try {
      const r = await api.guestCancel(b.id, cancelling.whole || !next ? null : [next.id]);
      setCancelling(null); toast.show(r.refundPence ? `Cancelled · ${gbp(r.refundPence)} back to your card${r.feeKeptPence ? ` (${gbp(r.feeKeptPence)} cancellation fee kept)` : ''}` : 'Cancelled'); void load();
    } catch (e: any) { toast.show(e instanceof ApiError ? e.message : 'That didn’t go through.'); }
  };
  const sheet = cancelling ? (
    <GuestSheet title="Cancel" onClose={() => setCancelling(null)}>
      {lane === 'weekly' && next && live.length > 1 ? (
        <Seg items={[
          { label: 'This session only', on: !cancelling.whole, onPress: () => { void quoteFor(false); } },
          { label: `All ${live.length} sessions`, on: cancelling.whole, onPress: () => { void quoteFor(true); } },
        ]} />
      ) : null}
      <Notice bg={LIME} weight="800">{cancelling.quote == null ? 'Working out your refund…' : cancelling.quote === 'failed' ? 'Your refund couldn’t be worked out just now. Try again in a moment.' : cancelling.quote.pence == null ? 'Epic will look at this one and come back to you' : `You’ll get ${gbp(cancelling.quote.pence)} back${cancelling.quote.policy ? ` · ${POLICY[cancelling.quote.policy] ?? cancelling.quote.policy} policy` : ''}`}</Notice>
      <Buttons row items={[
        { label: 'Keep it', onPress: () => setCancelling(null) },
        { label: lane === 'weekly' && next && !cancelling.whole && live.length > 1 ? `Cancel ${dayWords(next.date)}` : live.length > 1 ? `Cancel all ${live.length}` : 'Cancel', tone: 'red', onPress: confirmCancel, disabled: cancelling.quote == null || cancelling.quote === 'failed' },
      ]} />
    </GuestSheet>
  ) : editing ? (
    <EditAnswers booking={b} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast.show('Saved'); void load(); }} />
  ) : null;

  return (
    <GuestPage head={<CompactBand title={b.event.title ?? 'Your booking'} titleLines={2} context={when} onBack={() => back(paths.trips())} />} overlay={<>{toast.node}{sheet}</>}>
      {blocks}
    </GuestPage>
  );
  void INACTIVE; void LIME_TINT; void mediaUrl; void withQuery;
}

/** What you told the host: dietary and a note, until 24 hours before. */
function EditAnswers({ booking, onClose, onSaved }: { booking: Booking; onClose: () => void; onSaved: () => void }) {
  const [diet, setDiet] = useState<Set<string>>(new Set(Array.isArray(booking.answers.dietary) ? booking.answers.dietary : []));
  const [note, setNote] = useState<string>(typeof booking.answers.note === 'string' ? booking.answers.note : '');
  const DIET = ['Vegetarian', 'Vegan', 'Gluten free', 'Nut allergy', 'Dairy free', 'Halal'];
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <GuestSheet title={`What you told ${firstName(booking.event.host.name)}`} onClose={onClose}>
      <Chips items={DIET.map((d) => ({ label: d, on: diet.has(d), onPress: () => setDiet((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; }) }))} />
      <Field value={note} onChange={setNote} placeholder="Anything else" height={72} maxLength={500} />
      {failed ? <Para>{failed}</Para> : null}
      <Buttons items={[{ label: 'Save', tone: 'ink', onPress: async () => {
        // Saved only when it was: a failure stays here and says so (Codex, 3 Oct 2026).
        try { await api.guestAnswers(booking.id, { ...booking.answers, dietary: [...diet], note: note.trim() || undefined }); onSaved(); }
        catch (e: any) { setFailed(e instanceof ApiError ? e.message : 'That didn’t save. Try again.'); }
      } }]} />
    </GuestSheet>
  );
}

/**
 * After the event (G20), one screen, three steps: Did it happen? (Went wrong
 * holds the payout and opens a complaint) · Rate it (once per booking) · Leave a
 * tip (5% · 10% · 15% · Other on a paid event, £2 · £5 · £10 · Other on a free
 * one; the host keeps all of it, with the fee Epic sets on top). Send appears
 * once Did it happen? is answered; then Book again and More from the host.
 */
export function After({ id }: { id: string }) {
  const { navigate, back } = useRouter();
  const toast = useToast();
  const [b, setB] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hap, setHap] = useState<'yes' | 'no' | 'wrong' | null>(null);
  const [what, setWhat] = useState('');
  const [s1, setS1] = useState(0);
  const [s2, setS2] = useState(0);
  const [review, setReview] = useState('');
  const [tip, setTip] = useState<number | 'other' | null>(null);
  const [other, setOther] = useState('');
  const [sent, setSent] = useState<{ tip: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // What has already been saved this visit, so a retry after a failed tip doesn't send it twice;
  // and the tip's own payment, so trying again confirms the same one rather than asking for a second.
  const done = useRef<{ happened: boolean; rated: boolean; tip: { clientSecret: string; amount: number; taken?: boolean } | null }>({ happened: false, rated: false, tip: null });
  const stripe = useRef<any>(null);
  const card = useRef<any>(null);
  useEffect(() => { api.guestBooking(id).then((r) => setB(r.booking)).catch((e) => setError(e?.message ?? 'That booking didn’t load.')); }, [id]);
  useEffect(() => { void loadStripe().then((s) => { stripe.current = s; }); }, []);
  if (!b) return <Waiting error={error} />;

  const host = firstName(b.event.host.name);
  const paid = (b.money.paidPence ?? 0) > 0;
  // Only choices the server takes: £1 to £500 (Codex, 3 Oct 2026).
  const options = (paid ? [5, 10, 15].map((p) => ({ key: `${p}`, label: `${p}%`, sub: gbp(Math.round(((b.money.paidPence ?? 0) * p) / 100)) as string | null, pence: Math.round(((b.money.paidPence ?? 0) * p) / 100) }))
    : [200, 500, 1000].map((p) => ({ key: `${p}`, label: gbp(p), sub: null as string | null, pence: p }))).filter((o) => o.pence >= 100 && o.pence <= 50_000);
  const amount = tip === 'other' ? Math.round(Number(other.replace(/[£\s]/g, '')) * 100) || 0 : tip ?? 0;
  // The fee as the server works it out, from the rule it sends; none shown when Epic hasn't set one (tips are refused then).
  const rule = b.after?.tipFee ?? null;
  const fee = amount && rule ? Math.max(rule.minPence, Math.round((amount * rule.pct) / 100)) : 0;
  const ruleWords = rule ? `A ${rule.pct}% fee, at least ${rule.minPence < 100 ? `${rule.minPence}p` : gbp(rule.minPence)}, is added on top.` : '';
  const last = b.sessions[b.sessions.length - 1];
  const head = <CompactBand title="How was it?" context={`${b.event.title ?? ''}${last ? ` · ${dayWords(last.date)}` : ''}`} onBack={() => back(paths.booking(b.id))} />;

  if (sent) {
    return (
      <GuestPage head={head}>
        <Notice bg={LIME} weight="700">{`Thanks. ${host} will see your review${sent.tip ? ` and your ${gbp(sent.tip)} tip` : ''}.`}</Notice>
        <Kick>Then</Kick>
        <Buttons items={[
          // Every lane can be booked again: an on-request offer goes straight to Ask to book with the host, the rest to the event.
          ...(b.event.lane ? [{ label: 'Book again', onPress: () => navigate(b.event.lane === 'onrequest' ? paths.experienceBook(b.event.id) : paths.experience(b.event.id)) }] : []),
          { label: `More from ${host}`, onPress: () => navigate(paths.hostProfile(b.event.host.id)) },
        ]} />
      </GuestPage>
    );
  }

  const send = async () => {
    if (!hap || busy) return;
    setBusy(true);
    try {
      if (b.after?.happened == null && !done.current.happened) { await api.guestHappened(b.id, hap, hap === 'wrong' ? what.trim() || null : null); done.current.happened = true; }
      if (s1 && !b.after?.rated && !done.current.rated) { await api.guestRate(b.id, { stars: s1, hostStars: s2 || null, text: review.trim() || null }); done.current.rated = true; }
      if (amount > 0 && b.after?.tipOpen) {
        if (!stripe.current || !card.current) { toast.show('Add your card for the tip'); return; }
        // One tip, one payment: a retry confirms the one already asked for (Codex, 3 Oct 2026).
        if (!done.current.tip || done.current.tip.amount !== amount) {
          const r = await api.guestTip(b.id, amount);
          if (!r.pay.clientSecret) { toast.show('Paying isn’t ready yet'); return; }
          done.current.tip = { clientSecret: r.pay.clientSecret, amount };
        }
        // Already taken by Stripe on an earlier press: only the read-back is left to do.
        let out: PayOutcome = done.current.tip.taken ? { state: 'paid', paymentIntent: '' } : await confirmWithCard(stripe.current, done.current.tip.clientSecret, card.current);
        // A bank that wants to check it's you: Stripe shows its own step, then the payment is read again.
        if (out.state === 'bank') out = await finishWithBank(stripe.current, done.current.tip.clientSecret);
        if (out.state !== 'paid') {
          // Declined: that payment is spent; the next try asks for a fresh one (Codex, 3 Oct 2026).
          if (out.state !== 'bank' && out.state !== 'processing') done.current.tip = null;
          toast.show(out.state === 'bank' ? 'Approve the tip in your banking app, then send again' : out.state === 'processing' ? 'Your bank is still processing the tip' : out.message); return;
        }
        done.current.tip.taken = true;
        // Sent only once Epic has the tip, so the host is credited and told now, not when the webhook arrives (Codex, 3 Oct 2026).
        const r = await api.guestTipPaid(b.id).catch(() => null);
        if (!r || r.state !== 'paid') { toast.show('Paid · we’re confirming the tip'); return; }
      }
      setSent({ tip: amount });
    } catch (e: any) { toast.show(e instanceof ApiError ? e.message : 'That didn’t send.'); } finally { setBusy(false); }
  };

  const blocks: React.ReactNode[] = [
    <Kick key="h">1 · Did it happen?</Kick>,
    <Seg key="hs" items={[{ label: 'Yes', on: hap === 'yes', onPress: () => setHap('yes') }, { label: 'No', on: hap === 'no', onPress: () => setHap('no') }, { label: 'Went wrong', on: hap === 'wrong', onPress: () => setHap('wrong') }]} />,
  ];
  if (hap === 'wrong') blocks.push(<Notice key="w" bg={AMBER}>{`We’ll hold ${host}’s payout and look into it`}</Notice>, <Field key="wf" value={what} onChange={setWhat} placeholder="What went wrong" height={72} maxLength={2000} />);
  if (!b.after?.rated) {
    blocks.push(
      <Kick key="r" top={6}>2 · Rate it</Kick>,
      <Stars key="s1" label="The event" value={s1} onPick={setS1} />,
      <Stars key="s2" label={host} value={s2} onPick={setS2} />,
      <Field key="rv" value={review} onChange={setReview} placeholder="A review, if you’d like · for children, give their view" height={72} maxLength={2000} />,
    );
  }
  if (b.after?.tipOpen) {
    blocks.push(
      <Kick key="t" top={6}>3 · Leave a tip</Kick>,
      <Seg key="ts" items={[...options.map((o) => ({ key: o.key, label: o.label, sub: o.sub, on: tip === o.pence, onPress: () => setTip(tip === o.pence ? null : o.pence) })), { key: 'other', label: 'Other', sub: paid ? ' ' : null, on: tip === 'other', onPress: () => setTip(tip === 'other' ? null : 'other') }]} />,
    );
    if (tip === 'other') blocks.push(<Field key="to" value={other} onChange={setOther} placeholder="£" keyboardType="numeric" maxLength={6} />);
    blocks.push(<Para key="tl" color={amount ? INK : INK_MUTED}>{amount ? `${gbp(amount)} tip + ${fee < 100 ? `${fee}p` : gbp(fee)} fee · ${gbp(amount)} goes to ${host}` : `100% goes to ${host}.${ruleWords ? ` ${ruleWords}` : ''}`}</Para>);
    if (amount > 0) blocks.push(<CardBox key="card" stripe={stripe.current} onReady={(c) => { card.current = c; }} />);
  }
  return (
    <GuestPage head={head} foot={hap ? <Foot label={busy ? '…' : 'Send'} onPress={send} disabled={busy} /> : undefined} overlay={toast.node}>
      {blocks}
    </GuestPage>
  );
}
