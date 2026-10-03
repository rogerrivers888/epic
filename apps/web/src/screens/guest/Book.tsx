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
import { Platform } from 'react-native';
import { api, ApiError, type Experience, type GuestBookBody, type GuestOptions, type HouseholdResponse } from '../../api';
import { CompactBand } from '../../components/Band';
import { BirthdayPicker } from '../../components/BirthdayPicker';
import { paths, withQuery } from '../../routes';
import { useRouter } from '../../router';
import { BOOK_DRAFT_KEY, signedIn } from '../../session';
import {
  AMBER, AMBER_DARK, Buttons, Chips, DEEP_GREEN, Facts, Field, Foot, GuestPage, GuestSheet, INK_MUTED, Kick, LIME_TINT, MOSS, MonthPicker, Notice, Para,
  People, PriceLines, Rows, Seg, Waiting, dayWords, firstName, gbp, useToast, type PriceLine,
} from './kit';
import { CardBox, confirmWithCard, finishWithBank, loadStripe, payWithWallet, prepareWallet, walletKind, type PayOutcome } from './pay';
import { whenWords } from './EventPage';
import { FreeAccount } from './FreeAccount';
import { storage } from '../../storage';
import { ageAnswer, ageOn, cannotGo, capToast, fromMember, householdOrder, payProblemTitle, roomForOneMore, type AgeAnswer, type Who } from './whoGoing';
import { presetSlot } from './bookingWords';


/**
 * What was filled in before leaving to make the free account (G21). Continue
 * with Google leaves the page and an e-mail link opens a new one, so the form
 * is kept on this device — one draft, for one event — for half an hour.
 *
 * It belongs to that one sign-in, never to whoever opens the page next: a
 * random nonce is saved with it and carried in the page the sign-in comes back
 * to (`?draft=`), and the form is restored only when the returning address
 * carries the same nonce. Read once and removed — on restore, on a mismatch,
 * and on sign-out (session.ts) — and never restored on a plain revisit
 * (Codex, 3 Oct 2026).
 */
type Draft = {
  offerId: string; nonce: string; at: number; mode: 'drop_in' | 'book_ahead'; picks: string[]; month: number; day: string | null; time: string | null; length: number | null;
  ticked: string[]; extra: Who[]; contacts: Record<string, string>; over18: boolean; diet: string[]; bring: string | null;
  plusOne: boolean; stay: string | null; dobs: Record<string, string>; ages?: Record<string, number>;
};
function takeDraft(id: string, nonce: string): Draft | null {
  try {
    const raw = storage.getItem(BOOK_DRAFT_KEY);
    storage.removeItem(BOOK_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d && d.offerId === id && d.nonce === nonce && Date.now() - d.at < 30 * 60 * 1000 ? d : null;
  } catch { return null; }
}
/** 24 random characters, the shape the API's next-path check accepts (authGoogle.js guestNext). */
function draftNonce(): string {
  const bytes = new Uint8Array(24);
  const c = (globalThis as any).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes); else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from(bytes, (b) => abc[b % 64]).join('');
}
const DIET: Record<string, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', gluten_free: 'Gluten free', nut_allergy: 'Nut allergy', dairy_free: 'Dairy free', halal: 'Halal' };

/** A person's age on the day, from their age or date of birth; null when the household never said. */
const ageOf = (w: Who, onDay: string | null): number | null => ageOn(w, onDay);

export function Book({ id, webPage, linkToken, inviteToken, initial }: { id: string; webPage: boolean; linkToken?: string | null; inviteToken?: string | null; initial?: Experience | null }) {
  const { navigate, back, query, setQuery } = useRouter();
  const toast = useToast();
  const [offer, setOffer] = useState<Experience | null>(initial?.id === id ? initial : null);
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
  // A waiting-list place for one weekly session (G18): that session, chosen, so the booking is for the place held (Codex, 3 Oct 2026).
  const heldSession = query.get('session');
  useEffect(() => {
    if (!opt || !heldSession || opt.lane !== 'weekly') return;
    if (!opt.sessions.some((x) => x.id === heldSession)) return;
    if (opt.sessions[0]?.id === heldSession && opt.kinds.includes('drop_in')) { setMode('drop_in'); return; }
    if (opt.kinds.includes('book_ahead')) { setMode('book_ahead'); setPicks(new Set([heldSession])); }
  }, [opt, heldSession]);
  const [month, setMonth] = useState<number>(0);
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  // On request with more than one length: the guest picks it; the shortest until they do (the times offered fit it).
  const [length, setLength] = useState<number | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<Who[]>([]);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [over18, setOver18] = useState(false);
  const [diet, setDiet] = useState<Set<string>>(new Set());
  const [bring, setBring] = useState<string | null>(null);
  const [plusOne, setPlusOne] = useState(false);
  const [stay, setStay] = useState<string | null>(null);
  const [method, setMethod] = useState<'wallet' | 'card'>('card');
  // A household child with no age on record: their age or date of birth is asked here, for this booking — their
  // choice which, as for someone added (Codex, 3 Oct 2026; README › Who's going).
  const [dobs, setDobs] = useState<Record<string, string>>({});
  const [ages, setAges] = useState<Record<string, number>>({});
  // The cap stopped a tick (or an added person was left unticked): the line under the list turns amber.
  const [capHit, setCapHit] = useState(false);
  // Declines in a row on this form (G26): a retry declined again reads "Payment didn't go through".
  const [declines, setDeclines] = useState(0);
  const [sheet, setSheet] = useState<null | { kind: 'add' } | { kind: 'contact'; key: string } | { kind: 'dob'; key: string } | { kind: 'declined' | 'failed'; message: string } | { kind: 'bank' }>(null);
  const [busy, setBusy] = useState(false);
  // An unpaid booking already made: paying again confirms the same one, never books twice (G26).
  const [pending, setPending] = useState<{ bookingId: string; clientSecret: string } | null>(null);
  // Back from making the free account: what was filled in before, once (G21).
  const restored = useRef(false);
  const draftTicked = useRef<string[] | null>(null);
  const draftMark = query.get('draft');
  useEffect(() => {
    if (restored.current || !signedIn() || !draftMark) return;
    restored.current = true;
    const d = takeDraft(id, draftMark);
    // The nonce leaves the address once read, whether or not it matched.
    setQuery({ draft: null }, { replace: true });
    if (!d) return;
    setMode(d.mode); setPicks(new Set(d.picks)); setMonth(d.month); setDay(d.day); setTime(d.time); setLength(d.length);
    setExtra(d.extra); setContacts(d.contacts); setOver18(d.over18); setDiet(new Set(d.diet)); setBring(d.bring);
    setPlusOne(d.plusOne); setStay(d.stay); setDobs(d.dobs); setAges(d.ages ?? {});
    // Who was ticked: the people added by hand keep their keys; "You" is whoever you are now.
    setTicked(new Set(d.ticked)); draftTicked.current = d.ticked;
  }, [id, draftMark, setQuery]);

  useEffect(() => {
    if (initial?.id !== id) api.experience(id, inviteToken, linkToken).then((r) => setOffer(r.offer)).catch((e) => setError(e?.message ?? 'That event didn’t load.'));
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
    const rank = householdOrder;
    const base: Who[] = hh?.members?.length ? hh.members.map((m) => fromMember(dobs[m.id] ? { ...m, birthDate: dobs[m.id] } : ages[m.id] != null ? { ...m, age: ages[m.id] } : m, hh.me)).sort((x, y) => rank(x) - rank(y)) : [{ key: 'you', name: 'You', adult: true, age: null, dob: null, memberId: null, line: 'You' }];
    return [...base, ...extra];
  }, [hh, extra, dobs, ages]);
  // You start ticked, once who can go is known — after the household has loaded, when there is one —
  // unless this is a drop off (children only) or for children alone.
  const started = useRef(false);
  const peopleKnown = !signedIn() || webPage || hh != null;
  useEffect(() => {
    if (started.current || !opt || !peopleKnown) return;
    started.current = true;
    const you = people.find((p) => p.line === 'You');
    // A restored form: "you" was ticked before signing in, so tick whoever "You" is now.
    if (draftTicked.current) {
      const keep = draftTicked.current.filter((k) => people.some((p) => p.key === k));
      if (draftTicked.current.includes('you') && you) keep.push(you.key);
      setTicked(new Set(keep));
      return;
    }
    if (you && !opt.who.dropOff && !(opt.who.ageMax != null && opt.who.ageMax < 18)) setTicked(new Set([you.key]));
  }, [people, opt, peopleKnown]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Other times with Kate" (G28): the day and time it was opened with are picked, while the host is still free then —
  // once, and never over a form brought back from making the free account.
  const wantDate = query.get('date');
  const wantTime = query.get('time');
  const preset = useRef(false);
  useEffect(() => {
    if (preset.current || !opt || opt.lane !== 'onrequest' || !wantDate) return;
    preset.current = true;
    if (day) return;
    const p = presetSlot(opt.slots, wantDate, wantTime);
    if (!p) return;
    setMonth(p.month); setDay(p.day); setTime(p.time);
  }, [opt, wantDate, wantTime]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const why = (p: Who): string | null => cannotGo(p, who, onDay);
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
    if (ticked.has(p.key)) { setTicked((t) => { const n = new Set(t); n.delete(p.key); return n; }); setCapHit(false); return; }
    if (!roomForOneMore(chosen.length, cap)) { setCapHit(true); toast.show(capToast(cap)); return; }
    setTicked((t) => new Set([...t, p.key]));
  };
  // + Add someone: added straight away, and ticked when there's room for them; otherwise left unticked, as a tick would be.
  const addSomeone = (w: Who) => {
    setExtra((x) => [...x, w]);
    setSheet(null);
    if (why(w)) return;
    if (!roomForOneMore(chosen.length, cap)) { setCapHit(true); toast.show(capToast(cap)); return; }
    setTicked((t) => new Set([...t, w.key]));
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

  // This page, as it is set — the invitation, the link, a held waiting-list place — to come back to.
  const here = withQuery(paths.experienceBook(offer.id, { session: heldSession, date: wantDate, time: wantTime }), { l: linkToken ?? null, i: inviteToken ?? null });
  const keepDraft = (): string => {
    const youKey = people.find((p) => p.line === 'You')?.key;
    const nonce = draftNonce();
    const d: Draft = {
      offerId: offer.id, nonce, at: Date.now(), mode, picks: [...picks], month, day, time, length, extra, contacts, over18, diet: [...diet], bring, plusOne, stay, dobs, ages,
      ticked: [...ticked].map((k) => (k === youKey ? 'you' : k)),
    };
    try { storage.setItem(BOOK_DRAFT_KEY, JSON.stringify(d)); } catch { return here; /* nowhere to keep it: the form starts afresh */ }
    return withQuery(here, { draft: nonce });
  };

  const body = (): GuestBookBody => ({
    when: lane === 'onrequest' ? { kind: 'request', date: day!, time: time!, lengthMin: length ?? Math.min(...(opt.slots.find((s) => s.date === day)?.lengths ?? [60])) }
      : lane === 'weekly' ? { kind: mode, sessionIds: mode === 'drop_in' ? (sessions[0] ? [sessions[0].id] : []) : [...picks] }
        : { kind: 'whole' },
    party: {
      adults: adults.length,
      // The grown-ups by name, for Who's going and Plans; "You" on the web with no household is no name.
      adultNames: adults.map((a) => (a.memberId || a.key.startsWith('x') ? a.name : null)),
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
    if (out.state === 'paid') {
      // "You're booked" only once Epic has the payment; if that read failed, the booking page says where it stands
      // and the webhook finishes it (Codex, 3 Oct 2026).
      const r = await api.guestPaid(bookingId, out.paymentIntent).catch(() => null);
      if (r && (r.state === 'confirmed' || r.requestState === 'asked')) { done(bookingId); return; }
      setPending(null);
      toast.show('Paid · we’re confirming it with the host');
      navigate(paths.booking(bookingId), { replace: true });
      return;
    }
    // Still with the bank: the booking page says where it stands, never "You're booked" before it is (Codex, 3 Oct 2026).
    if (out.state === 'processing') { toast.show('Your bank is still processing it'); navigate(paths.booking(bookingId), { replace: true }); return; }
    if (out.state === 'bank') { setPending({ bookingId, clientSecret: secret }); setSheet({ kind: 'bank' }); return; }
    // A decline ends that booking on the server (its places go back), so Try again makes a fresh one with every
    // answer still filled in — never a second go at the payment of a booking that's gone (Codex, 3 Oct 2026).
    // Tell the server now, so the declined booking lets its places go before the next try (Codex, 3 Oct 2026).
    // An incomplete card (a validation error) leaves the same booking open: keep it, so Try again pays that one
    // rather than booking a second time (Codex, 3 Oct 2026).
    const r = await api.guestPaid(bookingId, '').catch(() => null);
    if (r && r.state === 'cancelled') setPending(null);
    setDeclines((n) => (out.state === 'declined' ? n + 1 : n));
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
    if (chosen.some((p) => !p.adult && ageOf(p, onDay) == null)) { toast.show('Add each child’s age or date of birth'); return; }
    if (!adultOk) { toast.show('Tick to say you’re 18 or over'); return; }
    setBusy(true);
    try {
      if (free || direct) { await make(); return; }
      // The phone apps have no card form yet: a paid booking is made on epic.day (Codex, 3 Oct 2026).
      if (!stripe.current) { toast.show(Platform.OS === 'web' ? 'Card payments aren’t switched on yet' : 'Book this one on epic.day for now'); return; }
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
    const lengths = [...new Set(opt.slots.flatMap((s) => s.lengths))].sort((a, b) => a - b);
    // A longer session fits fewer starts: changing the length clears a time it no longer fits (Codex, 3 Oct 2026).
    const timesOf = (l: number) => { const s = opt.slots.find((x) => x.date === day); return s?.timesBy?.[String(l)] ?? s?.times ?? []; };
    const len = length ?? lengths[0];
    if (lengths.length > 1) blocks.push(<Kick key="len">How long</Kick>, <Chips key="lc" items={lengths.map((l) => ({ key: `l${l}`, label: l % 60 === 0 ? `${l / 60} hour${l === 60 ? '' : 's'}` : `${l} min`, on: len === l, onPress: () => { setLength(l); if (time && !timesOf(l).includes(time)) setTime(null); } }))} />);
    if (day) blocks.push(<Kick key="t">Pick a time</Kick>, <Chips key="tc" items={timesOf(len).map((t) => ({ label: t, on: time === t, onPress: () => setTime(t) }))} />);
  }

  blocks.push(
    <Kick key="who" top={6}>{who.dropOff ? 'Who’s going · children' : 'Who’s going'}</Kick>,
    <People key="ppl" items={people.map((pp) => {
      const w = why(pp); const on = ticked.has(pp.key) && !w;
      const phone = contacts[pp.key];
      return {
        key: pp.key, name: pp.name, line: w ?? pp.line, on, disabled: Boolean(w), onPress: () => flip(pp),
        extra: !on || pp.adult ? null : [
          ...(ageOf(pp, onDay) == null ? [{ label: 'Add their age or date of birth', color: MOSS, onPress: () => setSheet({ kind: 'dob', key: pp.key }) }] : []),
          ...(who.dropOff ? [{ label: phone ? `Emergency contact · ${phone}` : 'Add an emergency contact', color: phone ? undefined : MOSS, onPress: () => setSheet({ kind: 'contact', key: pp.key }) }] : []),
        ],
      };
    })} />,
    <Rows key="add" items={[{ title: '+ Add someone', sub: 'Someone outside your household', weight: '700', onPress: () => setSheet({ kind: 'add' }) }]} />,
    <Para key="cap" color={(left != null && left <= 3) || (capHit && chosen.length >= cap) ? AMBER_DARK : INK_MUTED}>{capWords}</Para>,
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
    blocks.push(<Kick key="acct" top={6}>Your free account</Kick>,
      <FreeAccount key="acct-b" next={here} line="Just so we can send your booking. No subscription." onLeave={keepDraft} />);
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
  const sheets = sheet?.kind === 'add' ? <AddSomeone onClose={() => setSheet(null)} onAdd={addSomeone} />
    : sheet?.kind === 'dob' ? (
      <AgeSheet onClose={() => setSheet(null)} onSave={(v) => {
        const k = sheet.key;
        if (v.dob) { setDobs((d) => ({ ...d, [k]: v.dob! })); setAges((a) => { const n = { ...a }; delete n[k]; return n; }); }
        else { setAges((a) => ({ ...a, [k]: v.age! })); setDobs((d) => { const n = { ...d }; delete n[k]; return n; }); }
        setSheet(null);
      }} />
    )
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
        <GuestSheet title={payProblemTitle(sheet.kind, declines)} onClose={() => setSheet(null)}>
          <Para>{sheet.kind === 'declined' ? 'Your bank said no. Nothing was taken.' : 'Something went wrong on our side. Nothing was taken.'}</Para>
          <Notice>Everything you filled in is kept.</Notice>
          <Buttons items={[
            { label: 'Try again', tone: 'ink', onPress: () => { setSheet(null); void go(); } },
            { label: 'Use another card', onPress: () => { setSheet(null); setDeclines(0); setMethod('card'); card.current?.clear?.(); } },
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

/** A child's age or date of birth — their choice which (README › Who's going): Age · Date of birth, then the one asked. */
function AgeOrBirthday({ value, onChange }: { value: AgeAnswer; onChange: (v: AgeAnswer) => void }) {
  return (
    <>
      <Seg items={[{ label: 'Age', on: !value.byDob, onPress: () => onChange({ ...value, byDob: false }) }, { label: 'Date of birth', on: value.byDob, onPress: () => onChange({ ...value, byDob: true }) }]} />
      {value.byDob
        ? <BirthdayPicker value={value.dob || null} onChange={(v) => onChange({ ...value, dob: v ?? '' })} label="Date of birth" maxAge={17} clearable={false} />
        : <Field value={value.age} onChange={(v) => onChange({ ...value, age: v })} placeholder="8" keyboardType="numeric" maxLength={2} />}
    </>
  );
}

/** A household child with no age on record: the same age-or-date-of-birth control as + Add someone. */
export function AgeSheet({ onClose, onSave }: { onClose: () => void; onSave: (v: { age: number | null; dob: string | null }) => void }) {
  const [a, setA] = useState<AgeAnswer>({ byDob: false, age: '', dob: '' });
  const got = ageAnswer(a);
  return (
    <GuestSheet title="Their age" onClose={onClose}>
      <AgeOrBirthday value={a} onChange={setA} />
      <Buttons items={[{ label: 'Save', tone: 'ink', disabled: !got, onPress: () => { if (got) onSave(got); } }]} />
    </GuestSheet>
  );
}

/** + Add someone: a name, Adult or Child, and for a child their age or date of birth — their choice. */
export function AddSomeone({ onClose, onAdd }: { onClose: () => void; onAdd: (w: Who) => void }) {
  const [name, setName] = useState('');
  const [child, setChild] = useState(false);
  const [a, setA] = useState<AgeAnswer>({ byDob: false, age: '', dob: '' });
  const got = ageAnswer(a);
  const ok = name.trim().length > 0 && (!child || got != null);
  return (
    <GuestSheet title="Add someone" onClose={onClose}>
      <Field label="Name" value={name} onChange={setName} placeholder="Their first name" maxLength={60} />
      <Seg items={[{ label: 'Adult', on: !child, onPress: () => setChild(false) }, { label: 'Child', on: child, onPress: () => setChild(true) }]} />
      {child ? <AgeOrBirthday value={a} onChange={setA} /> : null}
      <Buttons items={[{
        label: 'Add to this booking', tone: 'ink', onPress: () => {
          if (!ok) return;
          const key = `x${Date.now()}`;
          onAdd(child && got
            ? { key, name: name.trim(), adult: false, age: got.age, dob: got.dob, memberId: null, line: got.age == null ? 'Child · added' : `Age ${got.age} · added` }
            : { key, name: name.trim(), adult: true, age: null, dob: null, memberId: null, line: 'Added' });
        },
      }]} />
    </GuestSheet>
  );
}

/** A child's emergency contact on a drop off: filled from the household, changed here if need be. */
export function ContactSheet({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  const ok = /^\+?[0-9 ]{9,16}$/.test(v.trim());
  return (
    <GuestSheet title="Emergency contact" onClose={onClose}>
      <Field value={v} onChange={setV} placeholder="A mobile number" keyboardType="phone-pad" maxLength={16} error={v && !ok ? 'A phone number, with the area code' : null} />
      <Buttons items={[{ label: 'Save', tone: 'ink', onPress: () => { if (ok) onSave(v.trim()); } }]} />
    </GuestSheet>
  );
}
