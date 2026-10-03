/**
 * Settings › Payments (guest handoff G22): every payment, refund and tip, newest
 * first, each with its status line; each opens a receipt to download. The receipt
 * is made on the phone from the payment Epic holds — nothing is fetched from Stripe.
 */

import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { api, type GuestPayment } from '../../api';
import { CompactBand } from '../../components/Band';
import { DEEP_GREEN, GuestPage, INK, Para, INK_MUTED, Rows, Waiting, gbp, shortDay, useToast } from './kit';

const day = shortDay;
const CAUSE: Record<string, string> = { called_off: 'called off', host_cancelled: 'the host cancelled', guest_cancelled: 'you cancelled', date_changed: 'the date moved', numbers_settled: 'more people came', declined: 'not accepted', lapsed: 'no answer in time' };

function line(p: GuestPayment): { title: string; sub: string; value: string; color?: string } {
  const what = p.title ?? 'A booking';
  // A released hold was never taken: no money back, so never "Refunded" (Codex, 3 Oct 2026).
  if (p.kind === 'release') return { title: what, sub: `${p.state === 'succeeded' ? `Hold released ${day(p.at)} · not charged` : 'Releasing the hold'}${p.cause ? ` · ${CAUSE[p.cause] ?? p.cause.replace(/_/g, ' ')}` : ''}`, value: gbp(p.pence), color: INK_MUTED };
  if (p.kind === 'refund') {
    const state = p.state === 'succeeded' ? `Refunded ${day(p.at)}` : p.state === 'pending' ? 'Refund on its way' : 'Refund waiting on Epic';
    return { title: what, sub: `${state}${p.cause ? ` · ${CAUSE[p.cause] ?? p.cause.replace(/_/g, ' ')}` : ''}`, value: `−${gbp(p.pence)}`, color: DEEP_GREEN };
  }
  if (p.kind === 'tip') return { title: `${what} · tip`, sub: `${day(p.at)}${p.state === 'succeeded' ? '' : ' · not taken'}`, value: gbp(p.pence) };
  if (p.kind === 'hold') return { title: what, sub: `Card held ${day(p.at)} · not charged`, value: gbp(p.pence) };
  return { title: what, sub: `${p.state === 'succeeded' ? 'Paid' : p.state === 'pending' ? 'Paying' : 'Not taken'} ${day(p.at)}`, value: gbp(p.pence) };
}

function receipt(p: GuestPayment): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const l = line(p);
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const html = `<!doctype html><meta charset="utf-8"><title>Epic receipt</title><body style="font-family:Archivo,Arial,sans-serif;max-width:520px;margin:40px auto;color:${INK}">
<h1 style="font-size:28px">Receipt</h1><p>${esc(l.title)}<br>${esc(l.sub)}</p><p style="font-size:22px;font-weight:800">${esc(l.value)}</p>
<p style="color:${INK_MUTED};font-size:13px">Reference ${esc(p.id)}<br>${new Date(p.at).toLocaleString('en-GB')}</p>
<p style="color:${INK_MUTED};font-size:13px">MAKE IT EPIC LIMITED · company 17445225 · 124 City Road, London</p></body>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a'); a.href = url; a.download = `epic-receipt-${p.id.slice(0, 8)}.html`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  return true;
}

export function GuestPayments({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<GuestPayment[] | null>(null);
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.guestPayments().then((r) => { setRows(r.payments); setCapped(r.capped); }).catch((e) => setError(e?.message ?? 'Payments didn’t load.')); }, []);
  if (!rows) return <Waiting error={error} />;
  return (
    <GuestPage head={<CompactBand title="Payments" context="Settings" onBack={onBack} />} overlay={toast.node}>
      {rows.length ? (
        <Rows items={rows.map((p) => { const l = line(p); return { key: p.id, title: l.title, sub: l.sub, value: l.value, valueColor: l.color, onPress: () => { if (receipt(p)) toast.show('Receipt downloaded'); } }; })} />
      ) : <Para color={INK_MUTED}>Nothing paid yet.</Para>}
      {capped ? <Para color={INK_MUTED}>The latest 300.</Para> : null}
    </GuestPage>
  );
}
