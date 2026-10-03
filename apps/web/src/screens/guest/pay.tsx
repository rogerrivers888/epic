/**
 * Paying for a booking or a tip (guest handoff G6–G11, G20, G26, G27), in the
 * browser, with Stripe — in test mode until the owner approves going live.
 *
 * The server makes the PaymentIntent (routes/guestBookings.js); the browser
 * confirms it here and the server reads it back (`guestPaid`, the webhook's
 * twin). Nothing about a card ever reaches Epic's API.
 *
 *   Card         Stripe's own card field, confirmed against the intent. A bank that
 *                wants the guest to approve it (3-D Secure) leaves the intent
 *                waiting: the screen shows "Confirm with your bank" (G27) and
 *                Stripe's own step finishes it.
 *   Apple Pay ·  The wallet sheet must open on the tap itself (browsers refuse it
 *   Google Pay   later), so it opens first and the booking is made once a card
 *                comes back from the wallet.
 *
 * A card that is declined, or anything else that fails, keeps every answer and
 * the same intent: Try again confirms it again, never books twice (G26).
 */

import React, { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { api } from '../../api';
import { HAIRLINE, INK } from './kit';
import { GUEST_PLACEHOLDER } from '../../theme';

type StripeJs = any;
let loader: Promise<StripeJs | null> | null = null;
let loadedKey: string | null = null;

/** Stripe.js, once, for the publishable key the server hands out; null when payments are not switched on. */
export function loadStripe(): Promise<StripeJs | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return Promise.resolve(null);
  if (loader) return loader;
  loader = api.paymentsConfig().then((cfg) => new Promise<StripeJs | null>((resolve) => {
    if (!cfg.ready || !cfg.publishableKey) { resolve(null); return; }
    loadedKey = cfg.publishableKey;
    const w = window as any;
    if (w.Stripe) { resolve(w.Stripe(cfg.publishableKey)); return; }
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.async = true;
    s.onload = () => resolve(w.Stripe ? w.Stripe(cfg.publishableKey) : null);
    s.onerror = () => { loader = null; resolve(null); };
    document.head.appendChild(s);
  })).catch(() => { loader = null; return null; });
  return loader;
}

export const stripeKeyLoaded = () => loadedKey;

/** What a confirmation came to. */
export type PayOutcome =
  | { state: 'paid'; paymentIntent: string }
  | { state: 'bank'; paymentIntent: string }          // 3-D Secure: waiting for the bank (G27)
  | { state: 'processing'; paymentIntent: string }    // the bank hasn't answered yet: not paid until it has
  | { state: 'declined'; message: string }            // the bank said no (G26)
  | { state: 'failed'; message: string };             // anything else (G26, second line)

const outcomeOf = (r: any): PayOutcome => {
  if (r?.error) {
    const declined = r.error.code === 'card_declined' || r.error.type === 'card_error';
    return declined ? { state: 'declined', message: r.error.message ?? 'Your bank said no.' } : { state: 'failed', message: r.error.message ?? 'Something went wrong.' };
  }
  const pi = r?.paymentIntent;
  if (!pi) return { state: 'failed', message: 'Something went wrong.' };
  // Paid means settled (or a card hold that's in place) — exactly what the server confirms on (Codex, 3 Oct 2026).
  if (pi.status === 'succeeded' || pi.status === 'requires_capture') return { state: 'paid', paymentIntent: pi.id };
  if (pi.status === 'processing') return { state: 'processing', paymentIntent: pi.id };
  if (pi.status === 'requires_action') return { state: 'bank', paymentIntent: pi.id };
  return { state: 'failed', message: 'Payment didn’t go through.' };
};

/** Confirm with the card field; the bank's own step is left for "I've approved it". */
export async function confirmWithCard(stripe: StripeJs, clientSecret: string, card: any): Promise<PayOutcome> {
  return outcomeOf(await stripe.confirmCardPayment(clientSecret, { payment_method: { card } }, { handleActions: false }));
}

/** The bank's step (3-D Secure): Stripe shows its own challenge if one is needed, then the intent is read again. */
export async function finishWithBank(stripe: StripeJs, clientSecret: string): Promise<PayOutcome> {
  return outcomeOf(await stripe.handleNextAction({ clientSecret }));
}

/**
 * A wallet sheet made ready before the tap (Codex, 3 Oct 2026): `request` is shown by `payWithWallet` straight from
 * the tap, and `kind` says whether this browser has Apple Pay, Google Pay or neither. Update its total with
 * `request.update({ total })` as the booking changes.
 */
export function prepareWallet(stripe: StripeJs, label: string, amountPence: number): { request: any; kind: Promise<'apple' | 'google' | null> } {
  const request = stripe.paymentRequest({ country: 'GB', currency: 'gbp', total: { label, amount: amountPence }, requestPayerName: false, requestPayerEmail: false });
  const kind = request.canMakePayment().then((c: any) => (c?.applePay ? 'apple' : c?.googlePay ? 'google' : null)).catch(() => null);
  return { request, kind };
}

/**
 * Apple Pay or Google Pay: opens the wallet now, on the tap. `start` makes the
 * booking once the wallet hands back a card and returns its client secret; the
 * wallet is told whether it went through. Null when this browser has no wallet.
 */
export function payWithWallet(stripe: StripeJs, pr: any, { start }: { start: () => Promise<string | null> }): Promise<PayOutcome | null> {
  // Nothing is awaited before show(): it must run inside the tap. The sheet is reused, so last time's listeners go first.
  // Stripe detaches a listener only by the very function it was given, so last time's are kept to remove (Codex, 3 Oct 2026).
  const was = pr.__epic as { pm: any; cancel: any } | undefined;
  if (was) { try { pr.off('paymentmethod', was.pm); pr.off('cancel', was.cancel); } catch { /* already gone */ } }
  return new Promise<PayOutcome>((resolve) => {
    const pm = async (ev: any) => {
      try {
        const secret = await start();
        if (!secret) { ev.complete('fail'); resolve({ state: 'failed', message: 'Nothing to pay.' }); return; }
        const first = outcomeOf(await stripe.confirmCardPayment(secret, { payment_method: ev.paymentMethod.id }, { handleActions: false }));
        ev.complete(first.state === 'paid' || first.state === 'bank' || first.state === 'processing' ? 'success' : 'fail');
        resolve(first.state === 'bank' ? await finishWithBank(stripe, secret) : first);
      } catch (e: any) { ev.complete('fail'); resolve({ state: 'failed', message: e?.message ?? 'Something went wrong.' }); }
    };
    const cancel = () => resolve({ state: 'failed', message: 'Cancelled.' });
    pr.__epic = { pm, cancel };
    pr.on('paymentmethod', pm);
    pr.on('cancel', cancel);
    try { pr.show(); } catch (e: any) { resolve({ state: 'failed', message: e?.message ?? 'The wallet didn’t open.' }); }
  });
}

/** Whether this browser offers Apple Pay or Google Pay, so the segment can say which. */
export async function walletKind(stripe: StripeJs | null): Promise<'apple' | 'google' | null> {
  if (!stripe) return null;
  const pr = stripe.paymentRequest({ country: 'GB', currency: 'gbp', total: { label: 'Epic', amount: 100 } });
  const can = await pr.canMakePayment().catch(() => null);
  return can?.applePay ? 'apple' : can?.googlePay ? 'google' : null;
}

/** Stripe's card field, drawn as the kit's field: a 1px box, Archivo inside. Hands its element back for confirming. */
export function CardBox({ stripe, onReady }: { stripe: StripeJs | null; onReady: (card: any | null) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!stripe || !box.current) { onReady(null); return undefined; }
    const card = stripe.elements({ fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;600' }] })
      .create('card', { hidePostalCode: true, style: { base: { fontFamily: 'Archivo, sans-serif', fontSize: '14.5px', color: INK, '::placeholder': { color: GUEST_PLACEHOLDER } } } });
    card.mount(box.current);
    onReady(card);
    return () => { card.destroy(); onReady(null); };
  }, [stripe]); // eslint-disable-line react-hooks/exhaustive-deps
  if (Platform.OS !== 'web') return null;
  return (
    <View>{React.createElement('div', { ref: box, style: { border: `1px solid ${HAIRLINE}`, padding: '14px 13px' } })}</View>
  );
}
