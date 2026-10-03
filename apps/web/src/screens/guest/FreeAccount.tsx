/**
 * Your free account (guest handoff G21, G24, G30; owner 3 Oct 2026).
 *
 * "Ask to book and joining a waiting list create the same free account as
 * booking (bookings, messages, payments only)." One step, used by the booking
 * screen (before Pay), the event page's Ask and waiting-list sheets, and an
 * invitation:
 *
 *   Continue with Google — the API's guest door (`?intent=guest`), which signs
 *                          in an account the address already has or makes the
 *                          free one, then comes back to `next`;
 *   Use my email         — a small box; a link is sent, and opening it makes the
 *                          account (or signs in the one the address has) and
 *                          comes back to `next`. "Check your email" until then.
 *
 * Apple comes later. Google is a full-page hand-off to the API, like a payment
 * page, so it is the one place this leaves the router behind — as LoginScreen
 * and InScreen do. The phone apps have no Google handoff yet, so the button is
 * drawn only on the web.
 */

import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { api, ApiError } from '../../api';
import { rememberNext } from '../../afterSignIn';
import { Buttons, Field, INK_MUTED, LIME_TINT, Notice, Para } from './kit';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Leave for the API's guest door, which hands back to `next` once signed in. */
function startGoogle(next: string) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.location.assign(api.guestGoogleUrl(next));
}

export function FreeAccount({ next, line, onLeave }: {
  next: string; line?: string | null;
  /** Called just before leaving for Google or sending the link — the booking screen keeps its form then. */
  onLeave?: () => void;
}) {
  const google = () => { onLeave?.(); startGoogle(next); };
  // Google is offered only once the server says it is switched on; until then email is the way in.
  const [googleOn, setGoogleOn] = useState(false);
  useEffect(() => {
    let live = true;
    api.guestAccountOptions().then((o) => { if (live) setGoogleOn(Boolean(o?.google)); }).catch(() => null);
    return () => { live = false; };
  }, []);
  const offerGoogle = Platform.OS === 'web' && googleOn;
  const [step, setStep] = useState<'choose' | 'email' | 'sent'>('choose');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  const send = async (again = false) => {
    const value = email.trim();
    if (!EMAIL.test(value)) { setErr('That email doesn’t look right.'); return; }
    setErr(null); setBusy(true);
    try {
      // Kept on this device too, so the link lands back here even if it loses its way (afterSignIn.ts).
      rememberNext(next);
      onLeave?.();
      await api.guestAccountLink(value, next);
      setStep('sent'); setResent(again);
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 429 ? (e.message || 'Too many tries. Wait a few minutes and try again.')
        : e instanceof ApiError && e.status === 400 ? (e.message || 'That email doesn’t look right.')
        : 'Couldn’t send a link just now. Try again.');
    } finally { setBusy(false); }
  };

  if (step === 'sent') {
    return (
      <View style={{ gap: 10 }}>
        <Notice bg={LIME_TINT} weight="700">Check your email</Notice>
        <Para color={INK_MUTED}>{`We sent a link to ${email.trim()}. Open it on this device and you’ll come straight back here. It works once, for 15 minutes.`}</Para>
        {resent ? <Para color={INK_MUTED}>Sent again.</Para> : null}
        {err ? <Para>{err}</Para> : null}
        <Buttons items={[
          { label: busy ? '…' : 'Send it again', onPress: () => { if (!busy) void send(true); } },
          { label: 'Use a different email', onPress: () => { setStep('email'); setResent(false); } },
        ]} />
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {line ? <Para color={INK_MUTED}>{line}</Para> : null}
      {step === 'email' ? (
        <>
          <Field label="Your email" value={email} onChange={(v) => { setEmail(v); setErr(null); }} placeholder="you@example.com"
                 keyboardType="email-address" maxLength={254} error={err} onSubmit={() => { if (!busy) void send(); }} />
          <Buttons items={[
            { label: busy ? '…' : 'Send me a link', tone: 'ink', disabled: busy, onPress: () => { void send(); } },
            ...(offerGoogle ? [{ label: 'Continue with Google', onPress: google }] : []),
          ]} />
        </>
      ) : (
        <Buttons items={[
          ...(offerGoogle ? [{ label: 'Continue with Google', onPress: google }] : []),
          { label: 'Use my email', onPress: () => setStep('email') },
        ]} />
      )}
    </View>
  );
}
