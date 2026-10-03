/**
 * Overview › Hosting (hosting v4, BO8m): four health figures, then the
 * hosting rows of "Needs you" — each a link to the Hosting tab where the work
 * is. A figure with too little behind it is a dash; a read that failed says
 * so on hover rather than vanishing, so a broken call never reads as calm.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../components/press';
import { api, ApiError } from '../../api';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import { colors, fonts } from '../../theme';
import { Explain } from '../explain';
import { Stat } from '../table';
import { amberTone } from './kit';

type Health = {
  inReview: number; overdue: number | null; payoutsOnTimePct: number | null; payoutsOnTimeReason: string | null;
  stripeMismatches: number | null; openComplaints: number; payoutsWaiting?: number; refundsWaiting?: number;
};

export function HostingHealth() {
  const { navigate } = useRouter();
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    api.hostingAdmin<Health>('/health').then(setData).catch((e) => {
      // Somebody without view_hosting sees nothing here, as before; any other failure is said on hover.
      if (e instanceof ApiError && e.status === 403) setAllowed(false); else setError(e?.message ?? 'That didn’t load.');
    });
  }, []);
  const go = (tab: string, extra = '') => () => navigate(`${paths.admin('hosting')}?tab=${tab}${extra}`);
  const failed = error ? ` The read failed: ${error}` : '';
  const v = (x: string | null) => (data ? x ?? '—' : '—');
  const needs = data ? [
    data.overdue ? { n: data.overdue, words: 'events past the review window', tab: 'review', red: true } : null,
    data.inReview && data.inReview !== data.overdue ? { n: data.inReview - (data.overdue ?? 0), words: 'events waiting for review', tab: 'review' } : null,
    data.payoutsWaiting ? { n: data.payoutsWaiting, words: 'payouts held or failed', tab: 'money', extra: '&mview=payouts' } : null,
    data.refundsWaiting ? { n: data.refundsWaiting, words: 'refunds Stripe refused', tab: 'money', extra: '&mview=payouts', red: true } : null,
    data.stripeMismatches ? { n: data.stripeMismatches, words: 'Stripe mismatches', tab: 'money', extra: '&mview=ledger&mstripe=mismatch', red: true } : null,
    data.openComplaints ? { n: data.openComplaints, words: 'complaints and claims open', tab: 'safety' } : null,
  ].filter(Boolean) as { n: number; words: string; tab: string; extra?: string; red?: boolean }[] : [];
  if (!allowed) return null;
  return (
    <View style={{ paddingVertical: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 36 }}>
        <Press onPress={go('review')} accessibilityRole="link"><Stat label="Hosting · in review" value={v(data ? (data.overdue ? `${data.inReview} · ${data.overdue} overdue` : String(data.inReview)) : null)} tip={['In review', `Events waiting for a person to read them; overdue once past the review window in Settings.${failed}`]} /></Press>
        <Press onPress={go('money', '&mview=payouts')} accessibilityRole="link"><Stat label="Payouts on time" value={v(data?.payoutsOnTimePct == null ? null : `${data.payoutsOnTimePct}%`)} tip={['Payouts on time', `${data?.payoutsOnTimeReason ?? 'Paid within a day of their release time, last 30 days.'}${failed}`]} /></Press>
        <Press onPress={go('money', '&mview=ledger&mstripe=mismatch')} accessibilityRole="link"><Stat label="Stripe mismatches" value={v(data?.stripeMismatches == null ? null : String(data.stripeMismatches))} tip={['Stripe mismatches', `Movements Stripe disagrees with at the last reconciliation; a dash before it has run.${failed}`]} /></Press>
        <Press onPress={go('safety')} accessibilityRole="link"><Stat label="Open complaints" value={v(data ? String(data.openComplaints) : null)} tip={['Open complaints', `Complaints and claims still open; each holds its session’s payout.${failed}`]} /></Press>
      </View>
      {needs.length ? (
        <View>
          <Explain tip={['Needs you · Hosting', 'Hosting work waiting on a person, most urgent first. Each opens where it is done.']}>
            <Text style={{ fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: colors.inkMuted, textTransform: 'uppercase', paddingBottom: 6 }}>Needs you · Hosting</Text>
          </Explain>
          {needs.map((x) => (
            <Press key={x.words} onPress={go(x.tab, x.extra)} accessibilityRole="link"
                   style={{ flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '800', minWidth: 28, textAlign: 'right', fontVariant: ['tabular-nums'], color: x.red ? colors.overrun : amberTone() }}>{x.n.toLocaleString()}</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: colors.ink }} numberOfLines={1}>{x.words}</Text>
            </Press>
          ))}
        </View>
      ) : null}
    </View>
  );
}
