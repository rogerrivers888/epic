/**
 * Change how many are going (attendee README › Every booking page › Manage: "add places only if there's room;
 * remove under the refund policy"), the sheet at `/bookings/<id>/party`.
 *
 *   Who's going   everyone on the booking, ticked, then the rest of the household — the same rules as Book:
 *                 greyed with the reason when someone can't go, never more than the places left, + Add someone
 *   The quote     the server's, shown before confirming, as a lime line: "You'll pay £12 more" or
 *                 "You'll get £8 back · Moderate policy"
 *   Keep it ·     on one row. More places paid now go through the card step Book uses (G26 declined, G27 the
 *   confirm       bank's check); the places are held 30 minutes while that happens, one change at a time
 *
 * The money is the server's (routes/guestBookings.js partyQuote · changeParty); nothing is priced here.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { api, ApiError, type GuestBooking, type GuestOptions, type GuestPartyQuote, type HouseholdResponse } from '../../api';
import { AddSomeone, AgeSheet, ContactSheet } from './Book';
import { AMBER, AMBER_DARK, Buttons, GuestSheet, INK_MUTED, Kick, LIME, LIME_TINT, MOSS, Notice, Para, People, Rows, dayWords, gbp, useToast } from './kit';
import { CardBox, confirmWithCard, finishWithBank, loadStripe, type PayOutcome } from './pay';
import { ageOn, cannotGo, partyBody, partyCapToast, partyCap, partyPeople, partyQuoteWords, payProblemTitle, roomForOneMore, type Who, type WhoRules } from './whoGoing';

/** A change waiting on its payment: its places are held for 30 minutes from `at`. */
export type PendingParty = { changeId: string; clientSecret: string; paymentIntent: string; pence: number; toHeads: number; at: number; retry?: boolean };
export const PARTY_HOLD_MS = 30 * 60 * 1000;

export function ChangeParty({ booking: b, opt, pending, setPending, onClose, onChanged }: {
  booking: GuestBooking; opt: GuestOptions | null;
  pending: PendingParty | null; setPending: (p: PendingParty | null) => void;
  onClose: () => void; onChanged: (words: string) => void;
}) {
  const toast = useToast();
  const [hh, setHh] = useState<HouseholdResponse | null | undefined>(undefined);
  const [extra, setExtra] = useState<Who[]>([]);
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [ages, setAges] = useState<Record<string, { age: number | null; dob: string | null }>>({});
  const [over18, setOver18] = useState(false);
  const [capHit, setCapHit] = useState(false);
  const [quote, setQuote] = useState<null | 'loading' | GuestPartyQuote | { error: string }>(null);
  const [sub, setSub] = useState<null | { kind: 'add' } | { kind: 'dob' | 'contact'; key: string } | { kind: 'declined' | 'failed'; message: string } | { kind: 'bank' }>(null);
  const [busy, setBusy] = useState(false);
  const [declines, setDeclines] = useState(0);
  const [payReady, setPayReady] = useState<boolean | null>(null);
  const stripe = useRef<any>(null);
  const card = useRef<any>(null);

  useEffect(() => { api.household().then(setHh).catch(() => setHh(null)); }, []);
  useEffect(() => { void loadStripe().then((s) => { stripe.current = s; setPayReady(Boolean(s)); }); }, []);

  // Who could be on it: the booking as it stands, then the household; with any age given here for a child who had none.
  const base = useMemo(() => (hh === undefined ? null : partyPeople(b.who, hh?.members ?? [], hh?.me ?? null)), [hh, b.who]);
  const people: Who[] = useMemo(() => [...(base?.people ?? []), ...extra].map((w) => (ages[w.key] ? { ...w, ...ages[w.key] } : w)), [base, extra, ages]);
  // Everyone on the booking starts ticked, once, when who can go is known.
  useEffect(() => { if (base && ticked == null) setTicked(new Set(base.onBooking)); }, [base, ticked]);

  const live = b.sessions.filter((s) => s.booked && s.state === 'scheduled' && !s.finished);
  const onDay = live[0]?.date ?? null;
  // The event's rules; read from the booking options when they loaded, and left to the server when they didn't.
  const rules: WhoRules = opt?.who ?? { ageMin: null, ageMax: null, partyMax: b.event.partyMax ?? null, dropOff: b.dropOff, adultsOnly: false };
  const why = (p: Who) => cannotGo(p, rules, onDay);
  const on = ticked ?? new Set<string>();
  const chosen = people.filter((p) => on.has(p.key) && !why(p));
  const kids = chosen.filter((p) => !p.adult);
  const lefts = live.map((s) => opt?.sessions.find((x) => x.id === s.id)?.placesLeft ?? null);
  const knownLeft = lefts.filter((n): n is number => n != null);
  const left = knownLeft.length ? Math.min(...knownLeft) : null;
  const cap = partyCap(b.who.heads, lefts, rules.partyMax);
  const capWords = left != null && left <= 3 ? `${left} more ${left === 1 ? 'place' : 'places'} left` : `Up to ${rules.partyMax ?? 4} from one household`;

  const contactOf = (k: Who) => (contacts[k.key] ?? k.emergencyContact ?? '').trim();
  const missing = !chosen.length ? 'Choose who’s going'
    : kids.some((k) => ageOn(k, onDay) == null) ? 'Add each child’s age or date of birth'
      : rules.dropOff && kids.some((k) => !/^\+?[0-9 ]{9,16}$/.test(contactOf(k))) ? 'Add an emergency contact for each child'
        : rules.adultsOnly && !over18 ? 'Tick to say you’re 18 or over' : null;
  const now = { heads: b.who.heads, children: b.who.children.length };
  const unchanged = chosen.length === now.heads && kids.length === now.children;
  const body = partyBody(chosen, { dropOff: rules.dropOff, contacts, adultConfirmed: over18 });
  const bodyKey = JSON.stringify(body);

  // The quote, asked again a moment after the ticks settle. Only a well-formed answer is a quote: anything else says why.
  useEffect(() => {
    if (ticked == null || missing || unchanged || pending) { setQuote(null); return undefined; }
    setQuote('loading');
    let gone = false;
    const t = setTimeout(() => {
      api.guestPartyQuote(b.id, body)
        .then((q) => { if (!gone) setQuote(typeof q?.chargePence === 'number' && typeof q?.refundPence === 'number' ? q : { error: 'That couldn’t be worked out just now. Try again in a moment.' }); })
        .catch((e) => { if (!gone) setQuote({ error: e instanceof ApiError ? e.message : 'That couldn’t be worked out just now. Try again in a moment.' }); });
    }, 300);
    return () => { gone = true; clearTimeout(t); };
  }, [bodyKey, missing, unchanged, b.id, ticked == null, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const flip = (p: Who) => {
    if (why(p) || pending) return;
    if (on.has(p.key)) { setTicked((t) => { const n = new Set(t ?? []); n.delete(p.key); return n; }); setCapHit(false); return; }
    if (!roomForOneMore(chosen.length, cap)) { setCapHit(true); toast.show(partyCapToast(b.who.heads, left, cap)); return; }
    setTicked((t) => new Set([...(t ?? []), p.key]));
  };
  const addSomeone = (w: Who) => {
    setExtra((x) => [...x, w]);
    setSub(null);
    if (why(w)) return;
    if (!roomForOneMore(chosen.length, cap)) { setCapHit(true); toast.show(partyCapToast(b.who.heads, left, cap)); return; }
    setTicked((t) => new Set([...(t ?? []), w.key]));
  };

  const q = quote && quote !== 'loading' && !('error' in quote) ? quote : null;
  const payNow = Boolean(q && q.chargePence > 0 && !q.later) || Boolean(pending);
  const cardOff = payNow && payReady === false;

  const done = (toHeads: number, refund: number) =>
    onChanged(`${toHeads} going${refund ? ` · ${gbp(refund)} back to your card` : ''}`);

  // What a card confirmation came to (as Book's settle): paid is read back by the server before it is called done.
  const settle = async (p: PendingParty, out: PayOutcome) => {
    if (out.state === 'paid') {
      const r = await api.guestPaid(b.id, out.paymentIntent).catch(() => null);
      setPending(null);
      if (r) done(p.toHeads, 0); else onChanged('Paid · we’re confirming it');
      return;
    }
    if (out.state === 'processing') { toast.show('Your bank is still processing it'); return; }
    if (out.state === 'bank') { setSub({ kind: 'bank' }); return; }
    // Declined or failed: tell the server now, so a refused payment lets its places go; the next try asks again
    // and is handed this one back only if it is still waiting (`change_waiting`).
    await api.guestPaid(b.id, p.paymentIntent).catch(() => null);
    setPending({ ...p, retry: true });
    setDeclines((n) => (out.state === 'declined' ? n + 1 : n));
    setSub({ kind: out.state, message: out.message });
  };

  const confirm = async () => {
    if (busy) return;
    if (!pending && (!q || missing || unchanged)) return;
    if (payNow) {
      if (!stripe.current) { toast.show(Platform.OS === 'web' ? 'Card payments aren’t switched on yet' : 'Add places on epic.day for now'); return; }
      if (!card.current) { toast.show('Add your card'); return; }
    }
    setBusy(true);
    try {
      // A change past its 30 minutes has let its places go: ask again rather than pay for one that's gone.
      let p = pending && !pending.retry && Date.now() < pending.at + PARTY_HOLD_MS ? pending : null;
      if (!p) {
        try {
          const r = await api.guestChangeParty(b.id, body);
          if (!r.pay) { setPending(null); done(r.change.toHeads, r.change.refundPence); return; }
          if (!r.pay.clientSecret) { toast.show('Paying isn’t ready yet'); return; }
          p = { changeId: r.change.id, clientSecret: r.pay.clientSecret, paymentIntent: r.pay.paymentIntent, pence: r.pay.amountPence, toHeads: r.change.toHeads, at: Date.now() };
          setPending(p);
        } catch (e) {
          // The last change is still waiting on its payment: pay that one, never a second beside it.
          if (e instanceof ApiError && e.code === 'change_waiting' && pending) { p = { ...pending, retry: false }; setPending(p); }
          else throw e;
        }
      }
      await settle(p, await confirmWithCard(stripe.current, p.clientSecret, card.current));
    } catch (e: any) {
      toast.show(e instanceof ApiError ? e.message : e?.message ?? 'That didn’t go through.');
    } finally { setBusy(false); }
  };

  // ---- the sheet
  const blocks: React.ReactNode[] = [];
  if (pending) {
    const until = new Date(pending.at + PARTY_HOLD_MS).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    blocks.push(<Notice key="pend" bg={AMBER} weight="700">{pending.retry
      ? `Paying ${gbp(pending.pence)} for ${pending.toHeads} going didn’t go through`
      : `${pending.toHeads} going once you’ve paid ${gbp(pending.pence)} · the places are held until ${until}`}</Notice>);
  } else if (ticked == null) {
    blocks.push(<Para key="wait" color={INK_MUTED}>Working out who’s on it…</Para>);
  } else {
    blocks.push(
      <Kick key="who">{rules.dropOff ? 'Who’s going · children' : 'Who’s going'}</Kick>,
      <People key="ppl" items={people.map((pp) => {
        const w = why(pp); const ticks = on.has(pp.key) && !w;
        const phone = contacts[pp.key] ?? pp.emergencyContact ?? null;
        return {
          key: pp.key, name: pp.name, line: w ?? pp.line, on: ticks, disabled: Boolean(w), onPress: () => flip(pp),
          extra: !ticks || pp.adult ? null : [
            ...(ageOn(pp, onDay) == null ? [{ label: 'Add their age or date of birth', color: MOSS, onPress: () => setSub({ kind: 'dob', key: pp.key }) }] : []),
            ...(rules.dropOff ? [{ label: phone ? `Emergency contact · ${phone}` : 'Add an emergency contact', color: phone ? undefined : MOSS, onPress: () => setSub({ kind: 'contact', key: pp.key }) }] : []),
          ],
        };
      })} />,
      <Rows key="add" items={[{ title: '+ Add someone', sub: 'Someone outside your household', weight: '700', onPress: () => setSub({ kind: 'add' }) }]} />,
      <Para key="cap" color={(left != null && left <= 3) || (capHit && chosen.length >= cap) ? AMBER_DARK : INK_MUTED}>{capWords}</Para>,
    );
    if (rules.adultsOnly) blocks.push(<People key="18" items={[{ key: '18', name: 'I’m 18 or over', line: 'Everyone on this booking', on: over18, onPress: () => setOver18(!over18) }]} />);
  }
  // The quote before confirming (G19's refund line, for a change).
  const line = pending ? null
    : missing && ticked != null ? missing
      : unchanged ? null
        : quote === 'loading' ? 'Working it out…'
          : quote && 'error' in quote ? quote.error
            : q ? partyQuoteWords(q, b.money.refundPolicy ?? b.event.refundPolicy ?? null, gbp, b.money.later?.chargeOn ? dayWords(b.money.later.chargeOn.slice(0, 10)) : null) : null;
  if (line) blocks.push(<Notice key="q" bg={q && !missing && !unchanged ? LIME : LIME_TINT} weight="800">{line}</Notice>);
  if (payNow) {
    if (cardOff) blocks.push(<Notice key="np">{Platform.OS === 'web' ? 'Card payments aren’t switched on yet.' : 'Add places on epic.day for now.'}</Notice>);
    else blocks.push(<CardBox key="card" stripe={stripe.current} onReady={(c) => { card.current = c; }} />);
  }
  const ready = pending ? !cardOff : Boolean(q) && !missing && !unchanged && !cardOff;
  const confirmLabel = busy ? '…' : pending ? `Pay ${gbp(pending.pence)}` : q && q.chargePence > 0 && !q.later ? `Pay ${gbp(q.chargePence)}` : q ? `Change to ${q.toHeads}` : 'Change';
  blocks.push(<Buttons key="go" row items={[
    // Keep it after a refused payment lets that try go; the server gives its places back.
    { label: 'Keep it', onPress: () => { if (pending?.retry) setPending(null); onClose(); } },
    { label: confirmLabel, tone: 'ink', disabled: !ready || busy, onPress: () => { void confirm(); } },
  ]} />);

  const subSheet = sub?.kind === 'add' ? <AddSomeone onClose={() => setSub(null)} onAdd={addSomeone} />
    : sub?.kind === 'dob' ? <AgeSheet onClose={() => setSub(null)} onSave={(v) => { setAges((a) => ({ ...a, [sub.key]: v })); setSub(null); }} />
      : sub?.kind === 'contact' ? <ContactSheet initial={contacts[sub.key] ?? people.find((x) => x.key === sub.key)?.emergencyContact ?? hh?.members.find((m) => m.id === hh.me)?.mobile ?? ''} onClose={() => setSub(null)} onSave={(v) => { setContacts((c) => ({ ...c, [sub.key]: v })); setSub(null); }} />
        : sub?.kind === 'bank' ? (
          <GuestSheet title="Confirm with your bank" onClose={() => setSub(null)}>
            <Para>Your bank wants to check it’s you. Approve the payment in your banking app, then come back.</Para>
            <Notice bg={LIME_TINT} weight="700">Waiting for your bank…</Notice>
            <Buttons items={[
              { label: 'I’ve approved it', tone: 'ink', onPress: async () => { if (!pending || !stripe.current) return; setSub(null); await settle(pending, await finishWithBank(stripe.current, pending.clientSecret)); } },
              { label: 'Use another card', onPress: () => { setSub(null); card.current?.clear?.(); } },
            ]} />
          </GuestSheet>
        ) : sub?.kind === 'declined' || sub?.kind === 'failed' ? (
          <GuestSheet title={payProblemTitle(sub.kind, declines)} onClose={() => setSub(null)}>
            <Para>{sub.kind === 'declined' ? 'Your bank said no. Nothing was taken.' : 'Something went wrong on our side. Nothing was taken.'}</Para>
            <Notice>Who you chose is kept.</Notice>
            <Buttons items={[
              { label: 'Try again', tone: 'ink', onPress: () => { setSub(null); void confirm(); } },
              { label: 'Use another card', onPress: () => { setSub(null); setDeclines(0); card.current?.clear?.(); } },
            ]} />
          </GuestSheet>
        ) : null;

  return (
    <>
      <GuestSheet title="Change how many are going" onClose={onClose}>{blocks}</GuestSheet>
      {subSheet}
      {toast.node}
    </>
  );
}
