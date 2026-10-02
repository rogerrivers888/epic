/**
 * Overview › Hosting health (hosting v4, BO8m): four figures, each a link to
 * the Hosting tab where the work is. Nothing is drawn for somebody without
 * view_hosting, and a figure with too little behind it is a dash.
 */

import React from 'react';
import { View } from 'react-native';
import { Press } from '../../components/press';
import { api } from '../../api';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import { Stat } from '../table';
import { useLoad } from './kit';

type Health = { inReview: number; overdue: number | null; payoutsOnTimePct: number | null; payoutsOnTimeReason: string | null; stripeMismatches: number; openComplaints: number };

export function HostingHealth() {
  const { navigate } = useRouter();
  const { data } = useLoad<Health>(() => api.hostingAdmin<Health>('/health'), []);
  if (!data) return null;
  const go = (tab: string) => () => navigate(`${paths.admin('hosting')}?tab=${tab}`);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 36, paddingVertical: 14 }}>
      <Press onPress={go('review')} accessibilityRole="link"><Stat label="Hosting · in review" value={data.overdue ? `${data.inReview} · ${data.overdue} overdue` : String(data.inReview)} tip={['In review', 'Events waiting for a person to read them; overdue once past the review window in Settings.']} /></Press>
      <Press onPress={go('money')} accessibilityRole="link"><Stat label="Payouts on time" value={data.payoutsOnTimePct == null ? '—' : `${data.payoutsOnTimePct}%`} tip={['Payouts on time', data.payoutsOnTimeReason ?? 'Paid within a day of their release time, last 30 days.']} /></Press>
      <Press onPress={go('money')} accessibilityRole="link"><Stat label="Stripe mismatches" value={String(data.stripeMismatches)} tip={['Stripe mismatches', 'Ledger rows whose amount or state Stripe disagrees with at the last reconciliation.']} /></Press>
      <Press onPress={go('safety')} accessibilityRole="link"><Stat label="Open complaints" value={String(data.openComplaints)} tip={['Open complaints', 'Complaints and claims still open; each holds its session’s payout.']} /></Press>
    </View>
  );
}
