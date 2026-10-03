/**
 * Booking, one screen then pay (guest handoff G6–G10, G24 on the web, G26 and
 * G27 when paying goes wrong). Only what the host turned on:
 *
 *   When            by lane — fixed (One-off) · Drop in or Book ahead (Weekly) ·
 *                   the whole run (Course) · a day and a time (On request)
 *   Who's going     household ticks; greyed with the reason when someone can't
 *                   go; no more than the places left; + Add someone; a child's
 *                   emergency contact on a drop off; "I'm 18 or over" on an
 *                   adults-only event
 *   What the host   dietary ticks, bring something, a plus-one, a night's stay
 *   asked
 *   Your free       signed out only — no subscription is asked for
 *   account
 *   Pay             the lines (adults, children, the group discount, the total),
 *                   the depends-on-numbers or card-hold notice, then Apple Pay ·
 *                   Google Pay · Card
 *
 * The footer stays grey ("Choose who's going") until someone is ticked, and for
 * On request until a day and a time are picked. A free event is booked at once.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type Experience, type GuestBookBody, type GuestOptions, type HouseholdResponse, type Member } from '../../api';
import { CompactBand } from '../../components/Band';
import { BirthdayPicker } from '../../components/BirthdayPicker';
import { paths, withQuery } from '../../routes';
import { useRouter } from '../../router';
import { signedIn } from '../../session';
import {
  AMBER, AMBER_DARK, Buttons, Chips, DEEP_GREEN, Facts, Field, Foot, GuestPage, GuestSheet, INK_MUTED, Kick, LIME_TINT, MOSS, MonthPicker, Notice, Para,
  People, PriceLines, Rows, Seg, Waiting, dayWords, firstName, gbp, useToast, type PriceLine,
} from './kit';
import { CardBox, confirmWithCard, finishWithBank, loadStripe, payWithWallet, prepareWallet, walletKind, type PayOutcome } from './pay';
import { whenWords } from './EventPage';

type Who = { key: string; name: string; adult: boolean; age: number | null; dob: string | null; memberId: string | null; line: string };
const DIET: Record<string, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', gluten_free: 'Gluten free', nut_allergy: 'Nut allergy', dairy_free: 'Dairy free', halal: 'Halal' };

/** A person's age on the day, from their age or date of birth; null when the household never said. */
const ageOf = (w: Who, onDay: string | null): number | null => {
  if (w.age != null) return w.age;
  if (!w.dob) return null;
  const [y, m, d] = w.dob.split('-').map(Number);
  const [Y, M, D] = (onDay ?? new Date().toISOString().slice(0, 10)).split('-').map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
};

function fromMember(m: Member, me: string | null): Who {
  const adult = !m.isMinor;
  return {
    key: m.id, name: m.name, adult, age: m.age ?? null, dob: m.birthDate ?? null, memberId: m.id,
    line: m.id === me ? 'You' : adult ? 'Adult' : m.age != null ? `Age ${m.age} · from your household` : 'Child · from your household',
  };
}

export function Book({ id, webPage, linkToken, inviteToken }: { id: string; webPage: boolean; linkToken?: string | null; inviteToken?: string | null }) {
  const { navigate, back } = useRouter();
  const toast = useToast();
  const [offer, setOffer] = useState<Experience | null>(null);
  const [opt, setOpt] = useState<GuestOptions | null>(null);
  const [hh, setHh] = useState<HouseholdResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payReady, setPayReady] = useState<boolean | null>(null);
  const [wallet, setWallet] = useState<'apple' | 'google' | null>(null);
  const stripe = useRef<any>(null);
  const card = useRef<any>(null);
  // The wallet's sheet is built before the tap, so the tap itself can open it (browsers refuse it after a wait).
  const walletReq = useRef<any>(null);

  // the form
  const [mode, setMode] = useState<'drop_in' | 'book_ahead'>('drop_in');
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [month, setMonth] = useState<number>(0);
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<Who[]>([]);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [over18, setOver18] = useState(false);
  const [diet, setDiet] = useState<Set<string>>(new Set());
  const [bring, setBring] = useState<string | null>(null);
  const [plusOne, setPlusOne] = useState(false);
  const [stay, setStay] = useState<string | null>(null);
  const [method, setMethod] = useState<'wallet' | 'card'>('card');
  const [sheet, setSheet] = useState<null | { kind: 'add' } | { kind: 'contact'; key: string } | { kind: 'declined' | 'failed'; message: string } | { kind: 'bank' }>(null);
  const [busy, setBusy] = useState(false);
  // An unpaid booking already made: paying again confirms the same one, never books twice (G26).
  const [pending, setPending] = useState<{ bookingId: string; clientSecret: string } | null>(null);

  useEffect(() => {
    api.experience(id, inviteToken, linkToken).then((r) => setOffer(r.offer)).catch((e) => setError(e?.message ?? 'That event didn’t load.'));
    api.guestOptions(id, { l: linkToken, i: inviteToken }).then(setOpt).catch((e) => setError(e?.message ?? 'That event isn’t taking bookings.'));
    if (signedIn() && !webPage) api.household().then(setHh).catch(() => setHh({ me: null, household: null as any, members: [] } as unknown as HouseholdResponse));
    loadStripe().then(async (s) => {
      stripe.current = s; setPayReady(Boolean(s));
      const prepared = s ? prepareWallet(s, 'Epic', 100) : null;
      walletReq.current = prepared?.request ?? null;
      const w = prepared ? await prepared.kind : await walletKind(s);
      setWallet(w); if (w) setMethod('wallet');
    });
  }, [id, linkToken, inviteToken, webPage]);

  // Who can be ticked: the household (members and subscribers), or just you (the web, and anyone without a household yet).
  const people: Who[] = useMemo(() => {
    // You first, then the other grown-ups, then the children — as the household reads.
    const rank = (w: Who) => (w.line === 'You' ? 0 : w.adult ? 1 : 2);
    const base: Who[] = hh?.members?.length ? hh.members.map((m) => fromMember(m, hh.me)).sort((x, y) => rank(x) - rank(y)) : [{ key: 'you', name: 'You', adult: true, age: null, dob: null, memberId: null, line: 'You' }];
    return [...base, ...extra];
  }, [hh, extra]);
  // You start ticked, once who can go is known — after the household has loaded, when there is one —
  // unless this is a drop off (children only) or for children alone.
  const started = useRef(false);
  const peopleKnown = !signedIn() || webPage || hh != null;
  useEffect(() => {
    if (started.current || !opt || !peopleKnown) return;
    started.current = true;
    const you = people.find((p) => p.line === 'You');
    if (you && !opt.who.dropOff && !(opt.who.ageMax != null && opt.who.ageMax < 18)) setTicked(new Set([you.key]));
  }, [people, opt, peopleKnown]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start on a way of booking the host actually offers (a book-ahead-only class has no drop in; Codex, 3 Oct 2026).
  useEffect(() => { if (opt && opt.lane === 'weekly' && !opt.kinds.includes(mode)) setMode(opt.kinds.includes('drop_in') ? 'drop_in' : 'book_ahead'); }, [opt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offer || !opt) return <Waiting error={error} />;

  const lane = offer.lane ?? 'oneoff';
  const host = offer.host;
  const first = firstName(host?.name);
  const ask = lane === 'onrequest';
  const sessions = opt.sessions;
  const onDay = lane === 'onrequest' ? day : sessions[0]?.date ?? offer.startsOn;
  const who = opt.who;
  const why = (p: Who): string | null => {
    const age = ageOf(p, onDay);
    if (who.adultsOnly && !p.adult) return 'Adults only';
    if (who.dropOff && p.adult) return 'Drop off · children only';
    if (!p.adult && age != null && ((who.ageMin != null && age < who.ageMin) || (who.ageMax != null && age > who.ageMax))) {
      return `Age ${age} · this is for ages ${who.ageMin ?? 0}${who.ageMax != null ? `–${who.ageMax}` : ' and up'}`;
    }
    if (p.adult && who.ageMax != null && who.ageMax < 18 && !who.dropOff) return null;
    return null;
  };
  const chosen = people.filter((p) => ticked.has(p.key) && !why(p));
  const adults = chosen.filter((p) => p.adult);
  const kids = chosen.filter((p) => !p.adult);

  // The places this booking can take: the fewest left on what it covers, and never past the most per household.
  const covered = lane === 'weekly' ? (mode === 'drop_in' ? sessions.slice(0, 1) : sessions.filter((x) => picks.has(x.id))) : lane === 'onrequest' ? [] : sessions;
  const lefts = covered.map((x) => x.placesLeft).filter((n): n is number => n != null);
  const left = lefts.length ? Math.min(...lefts) : null;
  const cap = Math.min(left ?? Infinity, who.partyMax ?? Infinity);
  const capWords = left != null && left <= 3 ? `${left} ${left === 1 ? 'place' : 'places'} left` : ask ? `Up to ${who.partyMax ?? 2} people` : `Up to ${who.partyMax ?? 4} from one household`;

  const flip = (p: Who) => {
    if (why(p)) return;
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(p.key)) { n.delete(p.key); return n; }
      if (chosen.length >= cap) { toast.show(cap === 1 ? 'Only 1 place left' : `Only ${cap} places left`); return t; }
      n.add(p.key);
      return n;
    });
  };

  // ---- the price, worked out the way the server does (domain/money.js priceBooking)
  const p = opt.price;
  // Free only when nothing is priced — a weekly class can be priced by drop in or book ahead alone (Codex, 3 Oct 2026).
  const free = p.mode === 'free' || !(p.pence || p.totalPence || p.dropInPence || p.bookAheadPence);
  // Paid to the host directly: booked here, paid there — no card asked for (Codex, 3 Oct 2026).
  const direct = !free && !p.throughEpic;
  const sessN = lane === 'weekly' && mode === 'book_ahead' ? Math.max(1, picks.size) : 1;
  // As the server prices it (guestBookings.weeklyEach): a weekly kind's own price, or the one price of an older offer.
  const oneOnly = p.dropInPence == null && p.bookAheadPence == null;
  const each = p.mode === 'by_numbers' ? p.nowEach ?? 0 : lane === 'weekly' ? ((mode === 'drop_in' ? p.dropInPence : p.bookAheadPence) ?? (oneOnly ? p.pence : 0) ?? 0) : p.pence ?? 0;
  const childEach = p.childPence ?? each;
  const lines: PriceLine[] = [];
  let gross = 0;
  if (p.per === 'booking') { gross = each * sessN; lines.push({ label: `A booking${sessN > 1 ? ` × ${sessN} sessions` : ''}`, value: gbp(gross) }); }
  else {
    const sx = sessN > 1 ? ` × ${sessN} sessions` : '';
    if (adults.length) { const v = each * adults.length * sessN; gross += v; lines.push({ label: `Adults · ${gbp(each)} × ${adults.length}${sx}`, value: gbp(v) }); }
    if (kids.length) { const v = childEach * kids.length * sessN; gross += v; lines.push({ label: `Children · ${gbp(childEach)} × ${kids.length}${sx}`, value: gbp(v) }); }
  }
  const group = lane === 'weekly' ? (mode === 'drop_in' ? p.groups.dropIn : p.groups.bookAhead) : null;
  const discount = group && chosen.length >= group.min ? Math.round((gross * group.pct) / 100) : 0;
  if (discount) lines.push({ label: `Group of ${group!.min} or more · ${group!.pct}% off`, value: `−${gbp(discount)}`, color: DEEP_GREEN });
  const total = gross - discount;
  // The prepared wallet sheet shows the total as it stands.
  if (walletReq.current && total > 0) { try { walletReq.current.update({ total: { label: offer.title ?? 'Epic', amount: total } }); } catch { /* updated next render */ } }
  lines.push({ label: 'Total', value: gbp(total), bold: true });

  // ---- ready to book?
  const whenOk = lane !== 'onrequest' || Boolean(day && time);
  const contactsOk = !who.dropOff || kids.every((k) => (contacts[k.key] ?? '').trim().length >= 9);
  const adultOk = !who.adultsOnly || over18;
  const ok = chosen.length > 0 && whenOk && (lane !== 'weekly' || mode === 'drop_in' || picks.size > 0);
  const label = !chosen.length ? 'Choose who’s going' : !whenOk ? 'Pick a day and a time' : free || direct ? (ask ? 'Ask to book' : 'Book') : ask ? `Ask to book · ${gbp(total)} held` : `Pay ${gbp(total)}`;

  const here = withQuery(paths.experienceBook(offer.id), { l: linkToken ?? null, i: inviteToken ?? null });
  const logIn = () => navigate(`${paths.login()}?next=${encodeURIComponent(here)}`);

  const body = (): GuestBookBody => ({
    when: lane === 'onrequest' ? { kind: 'request', date: day!, time: time!, lengthMin: opt.slots.find((s) => s.date === day)?.lengths[0] }
      : lane === 'weekly' ? { kind: mode, sessionIds: mode === 'drop_in' ? (sessions[0] ? [sessions[0].id] : []) : [...picks] }
        : { kind: 'whole' },
    party: {
      adults: adults.length,
      children: kids.map((k) => ({ name: k.name, age: k.age ?? undefined, dob: k.age == null ? k.dob : undefined, emergencyContact: who.dropOff ? (contacts[k.key] ?? '').trim() : undefined, memberId: k.memberId })),
      adultConfirmed: who.adultsOnly ? over18 : undefined,
    },
    answers: {
      ...(diet.size ? { dietary: [...diet].map((d) => DIET[d] ?? d) } : {}),
      ...(bring ? { bring } : {}), ...(plusOne ? { plusOne: true } : {}), ...(stay ? { stay } : {}),
    },
    linkToken: linkToken ?? null, inviteToken: inviteToken ?? null,
  });

  const done = (bookingId: string) => navigate(withQuery(paths.booking(bookingId), { done: '1' }), { replace: true });

  const settle = async (bookingId: string, out: PayOutcome, secret: string) => {
    if (out.state === 'paid') { await api.guestPaid(bookingId, out.paymentIntent).catch(() => null); done(bookingId); return; }
    if (out.state === 'bank') { setPending({ bookingId, clientSecret: secret }); setSheet({ kind: 'bank' }); return; }
    // A decline ends that booking on the server (its places go back), so Try again makes a fresh one with every
    // answer still filled in — never a second go at the payment of a booking that's gone (Codex, 3 Oct 2026).
    // Tell the server now, so the declined booking lets its places go before the next try (Codex, 3 Oct 2026).
    await api.guestPaid(bookingId, '').catch(() => null);
    setPending(null);
    setSheet({ kind: out.state, message: out.message });
  };

  const make = async (): Promise<{ bookingId: string; secret: string | null } | null> => {
    if (pending) return { bookingId: pending.bookingId, secret: pending.clientSecret };
    const r = await api.guestBook(offer.id, host?.id ?? null, body());
    if (!r.pay) { done(r.booking.id); return null; }
    if (!r.pay.clientSecret) throw new Error('Paying isn’t ready yet.');
    setPending({ bookingId: r.booking.id, clientSecret: r.pay.clientSecret });
    return { bookingId: r.booking.id, secret: r.pay.clientSecret };
  };

  const go = async () => {
    if (!ok || busy) return;
    if (!signedIn()) { toast.show('Make your free account first'); return; }
    if (!contactsOk) { toast.show('Add an emergency contact for each child'); return; }
    if (!adultOk) { toast.show('Tick to say you’re 18 or over'); return; }
    setBusy(true);
    try {
      if (free || direct) { await make(); return; }
      if (!stripe.current) { toast.show('Card payments aren’t switched on yet'); return; }
      if (method === 'wallet' && wallet && !pending && walletReq.current) {
        let made: { bookingId: string; secret: string | null } | null = null;
        const out = await payWithWallet(stripe.current, walletReq.current, { start: async () => { made = await make(); return made?.secret ?? null; } });
        if (out && made) await settle((made as { bookingId: string }).bookingId, out, (made as { secret: string }).secret);
        else if (!out) toast.show('Use a card instead');
        return;
      }
      if (!card.current) { toast.show('Add your card'); return; }
      const made = await make();
      if (!made?.secret) return;
      await settle(made.bookingId, await confirmWithCard(stripe.current, made.secret, card.current), made.secret);
    } catch (e: any) {
      toast.show(e instanceof ApiError ? e.message : e?.message ?? 'That didn’t go through.');
    } finally { setBusy(false); }
  };

  // ---- blocks
  const blocks: React.ReactNode[] = [];
  if (lane === 'oneoff') blocks.push(<Kick key="w">When</Kick>, <Facts key="wf" items={[{ label: 'Date', value: whenWords(offer, opt) }]} />);
  if (lane === 'weekly') {
    blocks.push(<Kick key="w">When</Kick>, <Seg key="ws" items={[
      { label: 'Drop in', sub: sessions[0] ? `This week · ${dayWords(sessions[0].date)}` : 'This week', on: mode === 'drop_in', onPress: () => setMode('drop_in') },
      { label: 'Book ahead', sub: 'Pick sessions', on: mode === 'book_ahead', onPress: () => setMode('book_ahead') },
    ].filter((c) => opt.kinds.includes(c.label === 'Drop in' ? 'drop_in' : 'book_ahead'))} />);
    if (mode === 'book_ahead') {
      blocks.push(<Chips key="wp" items={sessions.map((x) => ({
        key: x.id, label: `${dayWords(x.date)}${x.placesLeft === 0 ? ' · full' : ''}`, on: picks.has(x.id), disabled: x.placesLeft === 0,
        onPress: () => setPicks((s) => { const n = new Set(s); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; }),
      }))} />);
    }
  }
  if (lane === 'course') {
    blocks.push(<Kick key="w">{`The whole run · ${sessions.length} sessions`}</Kick>, <Rows key="wr" items={sessions.map((x, i) => ({ key: x.id, title: dayWords(x.date), value: x.topic ?? offer.weeks?.[i]?.title ?? '', valueColor: INK_MUTED }))} />);
  }
  if (lane === 'onrequest') {
    const days = new Set(opt.slots.map((s) => s.date));
    const now = new Date();
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + month, 1));
    blocks.push(<Kick key="d">Pick a day</Kick>, <MonthPicker key="cal" month={base} days={days} picked={day} onPick={(d) => { setDay(d); setTime(null); }}
      onPrev={month > 0 ? () => setMonth(month - 1) : null} onNext={month < 2 ? () => setMonth(month + 1) : null} />);
    if (day) blocks.push(<Kick key="t">Pick a time</Kick>, <Chips key="tc" items={(opt.slots.find((s) => s.date === day)?.times ?? []).map((t) => ({ label: t, on: time === t, onPress: () => setTime(t) }))} />);
  }

  blocks.push(
    <Kick key="who" top={6}>{who.dropOff ? 'Who’s going · children' : 'Who’s going'}</Kick>,
    <People key="ppl" items={people.map((pp) => {
      const w = why(pp); const on = ticked.has(pp.key) && !w;
      const phone = contacts[pp.key];
      return {
        key: pp.key, name: pp.name, line: w ?? pp.line, on, disabled: Boolean(w), onPress: () => flip(pp),
        extra: on && who.dropOff && !pp.adult ? [{ label: phone ? `Emergency contact · ${phone}` : 'Add an emergency contact', color: phone ? undefined : MOSS, onPress: () => setSheet({ kind: 'contact', key: pp.key }) }] : null,
      };
    })} />,
    <Rows key="add" items={[{ title: '+ Add someone', sub: 'Someone outside your household', weight: '700', onPress: () => setSheet({ kind: 'add' }) }]} />,
    <Para key="cap" color={left != null && left <= 3 ? AMBER_DARK : INK_MUTED}>{capWords}</Para>,
  );
  if (who.adultsOnly) blocks.push(<People key="18" items={[{ key: '18', name: 'I’m 18 or over', line: 'Everyone on this booking', on: over18, onPress: () => setOver18(!over18) }]} />);
  if (who.dropOff && offer.endsAt) blocks.push(<Notice key="collect" bg={AMBER} weight="700">{`Collect at ${offer.endsAt}`}</Notice>);

  const q = opt.questions ?? {};
  const asks = Boolean(q.diet?.on || q.bring?.on || q.plusOne?.on || q.stay?.on);
  if (asks) {
    blocks.push(<Kick key="qa" top={6}>{`What ${first} asked`}</Kick>);
    if (q.diet?.on) blocks.push(<Chips key="diet" items={(q.diet.ticks?.length ? q.diet.ticks : Object.keys(DIET)).map((k: string) => ({ key: k, label: DIET[k] ?? k, on: diet.has(k), onPress: () => setDiet((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }) }))} />);
    if (q.plusOne?.on) blocks.push(<Chips key="plus" items={[{ label: 'Bringing someone', on: plusOne, onPress: () => setPlusOne(!plusOne) }]} />);
    if (q.bring?.on && q.bring.items?.length) blocks.push(<Para key="bt">Bring something</Para>, <Chips key="bring" items={q.bring.items.map((it: { id: string; name: string }) => ({ key: it.id, label: it.name, on: bring === it.name, onPress: () => setBring(bring === it.name ? null : it.name) }))} />);
    if (q.stay?.on && q.stay.places?.length) blocks.push(<Para key="st">Stay over</Para>, <Chips key="stay" items={q.stay.places.map((pl: { id: string; name: string }) => ({ key: pl.id, label: pl.name, on: stay === pl.name, onPress: () => setStay(stay === pl.name ? null : pl.name) }))} />);
  }

  if (!signedIn()) {
    blocks.push(<Kick key="acct" top={6}>Your free account</Kick>, <Para key="acct-l" color={INK_MUTED}>Just so we can send your booking. No subscription.</Para>,
      <Buttons key="acct-b" items={[{ label: 'Continue with Google', onPress: logIn }, { label: 'Use my email', onPress: logIn }]} />);
  }

  if (!free) {
    blocks.push(<Kick key="pay" top={6}>Pay</Kick>, <PriceLines key="lines" items={lines} />);
    if (p.mode === 'by_numbers') blocks.push(<Notice key="nums" bg={LIME_TINT}>{`You pay ${gbp(total)} now. If more people book, you get the difference back${offer.goingAhead?.decidesOn ? ` on ${dayWords(offer.goingAhead.decidesOn)}` : ''}.`}</Notice>);
    if (ask) blocks.push(<Notice key="hold" bg={LIME_TINT}>{`Your card is held, not charged, until ${first} accepts${opt.askWindowHours ? ` (within ${opt.askWindowHours} hours)` : ''}.`}</Notice>);
    if (direct) blocks.push(<Notice key="direct">{`You pay ${first} directly.`}</Notice>);
    else if (payReady === false) blocks.push(<Notice key="np">Card payments aren’t switched on yet.</Notice>);
    else {
      blocks.push(<Seg key="method" items={[
        ...(wallet ? [{ label: wallet === 'apple' ? 'Apple Pay' : 'Google Pay', on: method === 'wallet', onPress: () => setMethod('wallet') }] : []),
        { label: 'Card', on: method === 'card', onPress: () => setMethod('card') },
      ]} />);
      if (method === 'card' || !wallet) blocks.push(<CardBox key="card" stripe={stripe.current} onReady={(c) => { card.current = c; }} />);
    }
  }

  // ---- sheets
  const sheets = sheet?.kind === 'add' ? <AddSomeone onClose={() => setSheet(null)} onAdd={(w) => { setExtra((x) => [...x, w]); setTicked((t) => new Set([...t, w.key])); setSheet(null); }} />
    : sheet?.kind === 'contact' ? <ContactSheet initial={contacts[sheet.key] ?? (hh?.members.find((m) => m.id === hh.me)?.mobile ?? '')} onClose={() => setSheet(null)} onSave={(v) => { setContacts((c) => ({ ...c, [sheet.key]: v })); setSheet(null); }} />
      : sheet?.kind === 'bank' ? (
        <GuestSheet title="Confirm with your bank" onClose={() => setSheet(null)}>
          <Para>Your bank wants to check it’s you. Approve the payment in your banking app, then come back.</Para>
          <Notice bg={LIME_TINT} weight="700">Waiting for your bank…</Notice>
          <Buttons items={[
            { label: 'I’ve approved it', tone: 'ink', onPress: async () => { if (!pending || !stripe.current) return; setSheet(null); await settle(pending.bookingId, await finishWithBank(stripe.current, pending.clientSecret), pending.clientSecret); } },
            { label: 'Use another card', onPress: () => { setSheet(null); setMethod('card'); } },
          ]} />
        </GuestSheet>
      ) : sheet?.kind === 'declined' || sheet?.kind === 'failed' ? (
        <GuestSheet title={sheet.kind === 'declined' ? 'Your card was declined' : 'Payment didn’t go through'} onClose={() => setSheet(null)}>
          <Para>{sheet.kind === 'declined' ? 'Your bank said no. Nothing was taken. Try another card or Apple Pay.' : 'Something went wrong on our side. Nothing was taken.'}</Para>
          <Notice>Everything you filled in is kept.</Notice>
          <Buttons items={[
            { label: 'Try again', tone: 'ink', onPress: () => { setSheet(null); void go(); } },
            { label: 'Use another card', onPress: () => { setSheet(null); setMethod('card'); card.current?.clear?.(); } },
          ]} />
        </GuestSheet>
      ) : null;

  return (
    <GuestPage
      head={<CompactBand title={ask ? 'Ask to book' : 'Book'} context={webPage ? `epic.day · ${offer.title ?? ''}` : offer.title ?? ''}
                         onBack={() => back(withQuery(paths.experience(offer.id), { l: linkToken ?? null, i: inviteToken ?? null }))} />}
      foot={<Foot label={busy ? '…' : label} disabled={!ok || busy} onPress={go} />}
      overlay={<>{toast.node}{sheets}</>}>
      {blocks}
    </GuestPage>
  );
}

/** + Add someone: a name, Adult or Child, and for a child their age or date of birth — their choice. */
function AddSomeone({ onClose, onAdd }: { onClose: () => void; onAdd: (w: Who) => void }) {
  const [name, setName] = useState('');
  const [child, setChild] = useState(false);
  const [byDob, setByDob] = useState(false);
  const [age, setAge] = useState('');
  const [dob, setDob] = useState('');
  const n = Number(age);
  const dobOk = /^\d{4}-\d{2}-\d{2}$/.test(dob.trim());
  const ok = name.trim().length > 0 && (!child || (byDob ? dobOk : Number.isInteger(n) && n >= 0 && n <= 17));
  return (
    <GuestSheet title="Add someone" onClose={onClose}>
      <Field label="Name" value={name} onChange={setName} placeholder="Their first name" maxLength={60} />
      <Seg items={[{ label: 'Adult', on: !child, onPress: () => setChild(false) }, { label: 'Child', on: child, onPress: () => setChild(true) }]} />
      {child ? (
        <>
          <Seg items={[{ label: 'Age', on: !byDob, onPress: () => setByDob(false) }, { label: 'Date of birth', on: byDob, onPress: () => setByDob(true) }]} />
          {byDob
            ? <BirthdayPicker value={dob || null} onChange={(v) => setDob(v ?? '')} label="Date of birth" maxAge={17} clearable={false} />
            : <Field value={age} onChange={setAge} placeholder="8" keyboardType="numeric" maxLength={2} />}
        </>
      ) : null}
      <Buttons items={[{
        label: 'Add to this booking', tone: 'ink', onPress: () => {
          if (!ok) return;
          const key = `x${Date.now()}`;
          onAdd(child
            ? { key, name: name.trim(), adult: false, age: byDob ? null : n, dob: byDob ? dob.trim() : null, memberId: null, line: byDob ? 'Child · added' : `Age ${n} · added` }
            : { key, name: name.trim(), adult: true, age: null, dob: null, memberId: null, line: 'Added' });
        },
      }]} />
    </GuestSheet>
  );
}

/** A child's emergency contact on a drop off: filled from the household, changed here if need be. */
function ContactSheet({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  const ok = /^\+?[0-9 ]{9,16}$/.test(v.trim());
  return (
    <GuestSheet title="Emergency contact" onClose={onClose}>
      <Field value={v} onChange={setV} placeholder="A mobile number" keyboardType="phone-pad" maxLength={16} error={v && !ok ? 'A phone number, with the area code' : null} />
      <Buttons items={[{ label: 'Save', tone: 'ink', onPress: () => { if (ok) onSave(v.trim()); } }]} />
    </GuestSheet>
  );
}
