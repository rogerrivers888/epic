/**
 * An invitation (guest handoff G12 on the web, G13 in the app). "Rachel invited
 * you", When and Where, then the reply: Coming · Can't come; who's coming, what
 * the host asked, Bring something (what others are bringing shows as taken), Stay
 * over. On the web there is no tab bar and the epic.day wordmark is the head; a
 * paid one takes your free account and payment inside the reply ("Pay and send
 * reply"). Answered in the app, it becomes a booking that lands in Plans.
 */

import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError, type GuestOptions, type HouseholdResponse, type InvitedView } from '../../api';
import { mediaUrl } from '../../components/hosting';
import { paths, withQuery } from '../../routes';
import { useRouter } from '../../router';
import { signedIn } from '../../session';
import {
  Buttons, Chips, Facts, Foot, GuestPage, INK_MUTED, Kick, Para, People, PhotoHead, PriceLines, Seg, Title, Waiting, dayWords, firstName, gbp, useToast,
} from './kit';
import { CardBox, confirmWithCard, finishWithBank, loadStripe } from './pay';

const DIET: Record<string, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', gluten_free: 'Gluten free', nut_allergy: 'Nut allergy', dairy_free: 'Dairy free', halal: 'Halal' };

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
  const stripe = useRef<any>(null);
  const card = useRef<any>(null);

  useEffect(() => {
    api.invited(token).then((r) => { setV(r); api.guestOptions(r.offer.id, { i: token }).then(setOpt).catch(() => setOpt(null)); }).catch((e) => setError(e?.message ?? 'That invitation didn’t open.'));
    if (signedIn() && !webPage) api.household().then((h) => { setHh(h); if (h.me) setTicked(new Set([h.me])); }).catch(() => null);
    void loadStripe().then((s) => { stripe.current = s; });
  }, [token, webPage]);
  if (!v) return <Waiting error={error} />;

  const o = v.offer;
  const host = firstName(o.host?.name);
  const each = opt?.price.mode && opt.price.mode !== 'free' ? opt.price.pence ?? 0 : 0;
  // You first, then the grown-ups, then the children — as on the booking screen.
  const rank = (p: { line: string; adult: boolean }) => (p.line === 'You' ? 0 : p.adult ? 1 : 2);
  const people = hh?.members?.length ? hh.members.map((m) => ({ key: m.id, name: m.name, line: m.id === hh.me ? 'You' : m.isMinor ? (m.age != null ? `Age ${m.age}` : 'Child') : 'Adult', adult: !m.isMinor, age: m.age ?? null })).sort((x, y) => rank(x) - rank(y))
    : [{ key: 'you', name: 'You', line: 'You', adult: true, age: null as number | null }];
  const going = people.filter((p) => ticked.has(p.key) || (people.length === 1 && p.key === 'you'));
  const heads = Math.max(1, going.length);
  const q = opt?.questions ?? {};
  const taken = new Set(v.taken ?? []);
  const when = `${o.startsOn ? dayWords(o.startsOn) : ''}${o.startsAt ? ` · ${o.startsAt}` : ''}`;
  const here = webPage ? paths.invited(token) : paths.invited(token);
  const logIn = () => navigate(`${paths.login()}?next=${encodeURIComponent(here)}`);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!signedIn()) {
        // No account and nothing to pay: the answer is recorded against the invitation itself.
        if (each > 0 && reply === 'yes') { toast.show('Make your free account first'); return; }
        await api.invitedReply(token, { rsvp: reply, heads });
        toast.show(reply === 'yes' ? `${host} knows you’re coming` : `${host} knows you can’t make it`);
        return;
      }
      if (reply === 'no') { await api.invitedBook(token, { rsvp: 'no' }); toast.show(`${host} knows you can’t make it`); return; }
      const adults = going.filter((p) => p.adult).length;
      const kids = going.filter((p) => !p.adult).map((p) => ({ name: p.name, age: p.age ?? undefined, memberId: p.key === 'you' ? null : p.key }));
      const r = await api.invitedBook(token, {
        rsvp: 'yes', when: { kind: opt?.kinds[0] ?? 'whole' }, party: { adults: Math.max(adults, kids.length ? 0 : 1), children: kids },
        answers: { ...(diet.size ? { dietary: [...diet].map((d) => DIET[d] ?? d) } : {}), ...(bring ? { bring } : {}), ...(stay ? { stay } : {}) },
      });
      if (r.pay?.clientSecret && r.booking) {
        if (!stripe.current || !card.current) { toast.show('Add your card'); return; }
        let out = await confirmWithCard(stripe.current, r.pay.clientSecret, card.current);
        if (out.state === 'bank') out = await finishWithBank(stripe.current, r.pay.clientSecret);
        if (out.state !== 'paid') { toast.show(out.state === 'bank' ? 'Approve it in your banking app, then try again' : out.message); return; }
        await api.guestPaid(r.booking.id, out.paymentIntent).catch(() => null);
      }
      if (r.booking) navigate(withQuery(paths.booking(r.booking.id), { done: '1' }), { replace: true });
      else toast.show(`${host} knows you’re coming`);
    } catch (e: any) { toast.show(e instanceof ApiError ? e.message : 'That didn’t send.'); } finally { setBusy(false); }
  };

  const blocks: React.ReactNode[] = [
    <Para key="kind" color={INK_MUTED}>{webPage ? 'epic.day · invite' : 'Invite'}</Para>,
    <Title key="t" title={`${host} invited you`} line={`${o.title ?? 'An invitation'}${each ? ` · ${gbp(each)} a head` : ''}`} />,
    <Facts key="f" items={[{ label: 'When', value: when }, { label: 'Where', value: o.venueLabel ?? o.venueArea ?? '' }]} />,
    <Kick key="r" top={4}>Your reply</Kick>,
    <Seg key="rs" items={[{ label: 'Coming', on: reply === 'yes', onPress: () => setReply('yes') }, { label: 'Can’t come', on: reply === 'no', onPress: () => setReply('no') }]} />,
  ];
  if (reply === 'yes') {
    blocks.push(<Kick key="w" top={4}>Who’s coming</Kick>, <People key="wp" items={people.map((p) => ({ key: p.key, name: p.name, line: p.line, on: ticked.has(p.key) || people.length === 1, onPress: () => setTicked((t) => { const n = new Set(t); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; }) }))} />);
    if (q.diet?.on) blocks.push(<Kick key="qa" top={4}>{`${host} asked`}</Kick>, <Chips key="diet" items={(q.diet.ticks?.length ? q.diet.ticks : Object.keys(DIET)).map((k: string) => ({ key: k, label: DIET[k] ?? k, on: diet.has(k), onPress: () => setDiet((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }) }))} />);
    if (q.bring?.on && q.bring.items?.length) blocks.push(<Para key="bt">Bring something</Para>, <Chips key="bring" items={q.bring.items.map((it: { id: string; name: string }) => (taken.has(it.name)
      ? { key: it.id, label: `${it.name} · taken`, on: false, disabled: true, onPress: () => {} }
      : { key: it.id, label: it.name, on: bring === it.name, onPress: () => setBring(bring === it.name ? null : it.name) }))} />);
    if (q.stay?.on && q.stay.places?.length) blocks.push(<Para key="st">Stay over</Para>, <Chips key="stay" items={q.stay.places.map((pl: { id: string; name: string }) => ({ key: pl.id, label: pl.name, on: stay === pl.name, onPress: () => setStay(stay === pl.name ? null : pl.name) }))} />);
    if (!signedIn()) {
      blocks.push(<Kick key="acct" top={6}>Your free account</Kick>, <Para key="al" color={INK_MUTED}>No app needed. Your reply lands in Plans if you get the app later.</Para>,
        <Buttons key="ab" items={[{ label: 'Continue with Google', onPress: logIn }, { label: 'Use my email', onPress: logIn }]} />);
    }
    if (each > 0) {
      blocks.push(<Kick key="pay" top={6}>Pay</Kick>, <PriceLines key="pl" items={[{ label: `${gbp(each)} × ${heads}`, value: gbp(each * heads) }, { label: 'Total', value: gbp(each * heads), bold: true }]} />);
      if (signedIn()) blocks.push(<CardBox key="card" stripe={stripe.current} onReady={(c) => { card.current = c; }} />);
    }
  }
  return (
    <GuestPage head={<PhotoHead uri={mediaUrl(o.photos[0] ?? null)} webPage={webPage} onBack={() => back(paths.trips())} />}
               foot={<Foot label={busy ? '…' : webPage && reply === 'yes' && each > 0 ? 'Pay and send reply' : 'Send reply'} onPress={send} disabled={busy} />}
               overlay={toast.node}>
      {blocks}
    </GuestPage>
  );
}
