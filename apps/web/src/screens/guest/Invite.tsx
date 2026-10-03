/**
 * An invitation (guest handoff G12 on the web, G13 in the app). "Rachel invited
 * you", When and Where, then the reply: Coming · Can't come; who's coming, what
 * the host asked, Bring something (what others are bringing shows as taken), Stay
 * over. On the web there is no tab bar and the epic.day wordmark is the head; a
 * paid one takes your free account and payment inside the reply ("Pay and send
 * reply"). Answered in the app, it becomes a booking that lands in Plans.
 */

import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError, type GuestOptions, type GuestQuote, type HouseholdResponse, type InvitedView } from '../../api';
import { mediaUrl } from '../../components/hosting';
import { paths, withQuery } from '../../routes';
import { useRouter } from '../../router';
import { signedIn } from '../../session';
import {
  Buttons, Chips, Facts, Foot, GuestPage, INK_MUTED, Kick, Para, People, PhotoHead, PriceLines, Seg, Title, Waiting, dayWords, firstName, gbp, useToast,
} from './kit';
import { CardBox, confirmWithCard, finishWithBank, loadStripe } from './pay';

const DIET: Record<string, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', gluten_free: 'Gluten free', nut_allergy: 'Nut allergy', dairy_free: 'Dairy free', halal: 'Halal' };

type Person = { key: string; name: string; line: string; adult: boolean; age: number | null };

/** You first, then the grown-ups, then the children — as on the booking screen. Grown up is 18, from the age the household gave. */
function peopleOf(hh: HouseholdResponse | null): Person[] {
  const rank = (p: Person) => (p.line === 'You' ? 0 : p.adult ? 1 : 2);
  if (!hh?.members?.length) return [{ key: 'you', name: 'You', line: 'You', adult: true, age: null }];
  return hh.members.map((m) => {
    const adult = m.age != null ? m.age >= 18 : !m.isMinor;
    return { key: m.id, name: m.name, line: m.id === hh.me ? 'You' : adult ? 'Adult' : m.age != null ? `Age ${m.age}` : 'Child', adult, age: m.age ?? null };
  }).sort((x, y) => rank(x) - rank(y));
}
const goingOf = (people: Person[], ticked: Set<string>) => people.filter((p) => ticked.has(p.key) || (people.length === 1 && p.key === 'you'));
function partyFrom(going: Person[]) {
  const adults = going.filter((p) => p.adult).length;
  const kids = going.filter((p) => !p.adult).map((p) => ({ name: p.name, age: p.age ?? undefined, memberId: p.key === 'you' ? null : p.key }));
  return { adults: Math.max(adults, kids.length ? 0 : 1), children: kids };
}

export function Invite({ token, webPage }: { token: string; webPage: boolean }) {
  const { navigate, back } = useRouter();
  const toast = useToast();
  const [v, setV] = useState<InvitedView | null>(null);
  const [opt, setOpt] = useState<GuestOptions | null>(null);
  const [hh, setHh] = useState<HouseholdResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<'yes' | 'no'>('yes');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [diet, setDiet] = useState<Set<string>>(new Set());
  const [bring, setBring] = useState<string | null>(null);
  const [stay, setStay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // In state, so the card field draws once Stripe has loaded (Codex, 3 Oct 2026).
  const [stripe, setStripe] = useState<any>(null);
  const card = useRef<any>(null);
  // The server's own total for this party, never one worked out here (Codex, 3 Oct 2026).
  const [quote, setQuote] = useState<GuestQuote | null>(null);
  // A paid reply already made: paying again confirms that booking, never answers twice (Codex, 3 Oct 2026).
  const [pending, setPending] = useState<{ bookingId: string; clientSecret: string } | null>(null);

  useEffect(() => {
    api.invited(token).then((r) => { setV(r); api.guestOptions(r.offer.id, { i: token }).then(setOpt).catch(() => setOpt(null)); }).catch((e) => setError(e?.message ?? 'That invitation didn’t open.'));
    if (signedIn() && !webPage) api.household().then((h) => { setHh(h); if (h.me) setTicked(new Set([h.me])); }).catch(() => null);
    void loadStripe().then(setStripe);
  }, [token, webPage]);
  // The total for who is ticked, from the server's quote.
  const quoteKey = `${opt ? 1 : 0}|${[...ticked].sort().join(',')}|${hh ? hh.members.length : 0}`;
  useEffect(() => {
    if (!v || !opt || !signedIn() || !(opt.price.mode && opt.price.mode !== 'free' && opt.price.throughEpic)) { setQuote(null); return undefined; }
    let live = true;
    api.guestQuote(v.offer.id, { when: { kind: opt.kinds[0] ?? 'whole' }, party: partyFrom(goingOf(peopleOf(hh), ticked)), inviteToken: token })
      .then((r) => { if (live) setQuote(r); }).catch(() => { if (live) setQuote(null); });
    return () => { live = false; };
  }, [quoteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <Waiting error={error} />;

  const o = v.offer;
  const host = firstName(o.host?.name);
  const paidHere = Boolean(opt?.price.mode && opt.price.mode !== 'free' && opt.price.throughEpic);
  const people = peopleOf(hh);
  const going = goingOf(people, ticked);
  const heads = Math.max(1, going.length);
  const q = opt?.questions ?? {};
  const taken = new Set(v.taken ?? []);
  const when = `${o.startsOn ? dayWords(o.startsOn) : ''}${o.startsAt ? ` · ${o.startsAt}` : ''}`;
  const here = webPage ? paths.invited(token) : paths.invited(token);
  const logIn = () => navigate(`${paths.login()}?next=${encodeURIComponent(here)}`);

  const partyOf = () => partyFrom(going);
  const total = quote?.valuePence ?? null;

  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!signedIn()) {
        // No account and nothing to pay: the answer is recorded against the invitation itself.
        if (paidHere && reply === 'yes') { toast.show('Make your free account first'); return; }
        await api.invitedReply(token, { rsvp: reply, heads });
        toast.show(reply === 'yes' ? `${host} knows you’re coming` : `${host} knows you can’t make it`);
        return;
      }
      if (reply === 'no') { await api.invitedBook(token, { rsvp: 'no' }); toast.show(`${host} knows you can’t make it`); return; }
      // Ready to pay before anything is made, so a missing card never leaves a booking stranded.
      if (paidHere && (!stripe || !card.current)) { toast.show(stripe ? 'Add your card' : 'Card payments aren’t switched on yet'); return; }
      let made = pending;
      if (!made) {
        const r = await api.invitedBook(token, {
          rsvp: 'yes', when: { kind: opt?.kinds[0] ?? 'whole' }, party: partyOf(),
          answers: { ...(diet.size ? { dietary: [...diet].map((d) => DIET[d] ?? d) } : {}), ...(bring ? { bring } : {}), ...(stay ? { stay } : {}) },
        });
        if (!r.booking) { toast.show(`${host} knows you’re coming`); return; }
        if (!r.pay?.clientSecret) { navigate(withQuery(paths.booking(r.booking.id), { done: '1' }), { replace: true }); return; }
        made = { bookingId: r.booking.id, clientSecret: r.pay.clientSecret };
        setPending(made);
      }
      let out = await confirmWithCard(stripe, made.clientSecret, card.current);
      if (out.state === 'bank') out = await finishWithBank(stripe, made.clientSecret);
      // Still with the bank: the booking page says where it stands, never "You're booked" before it is.
      if (out.state === 'processing') { navigate(paths.booking(made.bookingId), { replace: true }); return; }
      if (out.state !== 'paid') {
        // Declined: the server lets that booking go, and the next press answers afresh; otherwise the same one is paid.
        const back = await api.guestPaid(made.bookingId, '').catch(() => null);
        if (back && back.state === 'cancelled') setPending(null);
        toast.show(out.state === 'bank' ? 'Approve it in your banking app, then try again' : out.message);
        return;
      }
      const paid = await api.guestPaid(made.bookingId, out.paymentIntent).catch(() => null);
      navigate(paid && paid.state === 'confirmed' ? withQuery(paths.booking(made.bookingId), { done: '1' }) : paths.booking(made.bookingId), { replace: true });
    } catch (e: any) { toast.show(e instanceof ApiError ? e.message : 'That didn’t send.'); } finally { setBusy(false); }
  };

  const blocks: React.ReactNode[] = [
    <Para key="kind" color={INK_MUTED}>{webPage ? 'epic.day · invite' : 'Invite'}</Para>,
    <Title key="t" title={`${host} invited you`} line={o.title ?? 'An invitation'} />,
    <Facts key="f" items={[{ label: 'When', value: when }, { label: 'Where', value: o.venueLabel ?? o.venueArea ?? '' }]} />,
    <Kick key="r" top={4}>Your reply</Kick>,
    <Seg key="rs" items={[{ label: 'Coming', on: reply === 'yes', onPress: () => setReply('yes') }, { label: 'Can’t come', on: reply === 'no', onPress: () => setReply('no') }]} />,
  ];
  if (reply === 'yes') {
    blocks.push(<Kick key="w" top={4}>Who’s coming</Kick>, <People key="wp" items={people.map((p) => ({ key: p.key, name: p.name, line: p.line, on: ticked.has(p.key) || people.length === 1, onPress: () => setTicked((t) => { const n = new Set(t); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; }) }))} />);
    // What the host asked goes with a booking, so only to someone signed in; a reply without an account is yes or no and how many (Codex, 3 Oct 2026).
    if (signedIn() && q.diet?.on) blocks.push(<Kick key="qa" top={4}>{`${host} asked`}</Kick>, <Chips key="diet" items={(q.diet.ticks?.length ? q.diet.ticks : Object.keys(DIET)).map((k: string) => ({ key: k, label: DIET[k] ?? k, on: diet.has(k), onPress: () => setDiet((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }) }))} />);
    if (signedIn() && q.bring?.on && q.bring.items?.length) blocks.push(<Para key="bt">Bring something</Para>, <Chips key="bring" items={q.bring.items.map((it: { id: string; name: string }) => (taken.has(it.name)
      ? { key: it.id, label: `${it.name} · taken`, on: false, disabled: true, onPress: () => {} }
      : { key: it.id, label: it.name, on: bring === it.name, onPress: () => setBring(bring === it.name ? null : it.name) }))} />);
    if (signedIn() && q.stay?.on && q.stay.places?.length) blocks.push(<Para key="st">Stay over</Para>, <Chips key="stay" items={q.stay.places.map((pl: { id: string; name: string }) => ({ key: pl.id, label: pl.name, on: stay === pl.name, onPress: () => setStay(stay === pl.name ? null : pl.name) }))} />);
    if (!signedIn()) {
      blocks.push(<Kick key="acct" top={6}>Your free account</Kick>, <Para key="al" color={INK_MUTED}>No app needed. Your reply lands in Plans if you get the app later.</Para>,
        <Buttons key="ab" items={[{ label: 'Continue with Google', onPress: logIn }, { label: 'Use my email', onPress: logIn }]} />);
    }
    if (paidHere) {
      blocks.push(<Kick key="pay" top={6}>Pay</Kick>);
      if (quote) blocks.push(<PriceLines key="pl" items={[...quote.lines.map((l) => ({ label: `${l.label} · ${gbp(l.each)} × ${l.count}`, value: gbp(l.pence) })), ...(quote.discountPence ? [{ label: 'Group discount', value: `−${gbp(quote.discountPence)}` }] : []), { label: 'Total', value: gbp(quote.valuePence), bold: true }]} />);
      else if (signedIn()) blocks.push(<Para key="pl" color={INK_MUTED}>Working out the total…</Para>);
      if (signedIn()) blocks.push(<CardBox key="card" stripe={stripe} onReady={(c) => { card.current = c; }} />);
    }
  }
  return (
    <GuestPage head={<PhotoHead uri={mediaUrl(o.photos[0] ?? null)} webPage={webPage} onBack={() => back(paths.trips())} />}
               foot={<Foot label={busy ? '…' : reply === 'yes' && paidHere && total ? `Pay ${gbp(total)} and send reply` : 'Send reply'} onPress={send} disabled={busy} />}
               overlay={toast.node}>
      {blocks}
    </GuestPage>
  );
}
