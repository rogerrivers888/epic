/**
 * Back office › Hosting (hosting v4, BO8a–BO8r): one screen, its sub-tabs and
 * every drill-down as query state on /admin/hosting, so any view is a link
 * you can send. Review · Hosts · Events · Money · Safety · Settings · Reports
 * · Changes; the older review screen (offers made before the four lanes) is
 * kept as the last tab until the owner says it can go.
 */

import React from 'react';
import { View } from 'react-native';
import { api } from '../../api';
import { useQueryState, asOneOf, useRouter } from '../../router';
import { Hosting as OlderOffers } from '../screens/Hosting';
import { HostingTabs, useLoad } from './kit';
import { ReviewTab } from './Review';
import { HostsTab } from './Hosts';
import { EventsTab } from './Events';
import { MoneyTab } from './Money';
import { SafetyTab } from './Safety';
import { SettingsTab } from './Settings';
import { ReportsTab } from './Reports';
import { ChangesTab } from './Changes';

export const HOSTING_TABS = ['review', 'hosts', 'events', 'money', 'safety', 'settings', 'reports', 'changes', 'older'] as const;
export type HostingTabKey = typeof HOSTING_TABS[number];

export function HostingTab({ canManage }: { canManage: boolean }) {
  const [tab] = useQueryState<HostingTabKey>('tab', 'review', asOneOf(HOSTING_TABS, 'review'));
  const { query, setQuery } = useRouter();
  // What waits on a person behind each sub-tab, as a lime count (handoff §2). A failed read draws no count, never a nought.
  const { data: health } = useLoad(() => api.hostingAdmin<{ tabs?: Partial<Record<HostingTabKey, number>> }>('/health'), [tab]);
  // A sub-tab is a fresh page: whatever the last one had open — an event, a host, a sort, a filter — is not carried across,
  // because Review and Events both read ?event= and would otherwise open each other's detail.
  const pick = (t: HostingTabKey) => {
    const patch: Record<string, string | null> = {};
    query.forEach((_v, k) => { patch[k] = null; });
    setQuery({ ...patch, tab: t === 'review' ? null : t }, { replace: false });
  };
  return (
    <View style={{ gap: 0 }}>
      <HostingTabs value={tab} onPick={pick} counts={health?.tabs ?? null} />
      {tab === 'review' ? <ReviewTab canManage={canManage} /> : null}
      {tab === 'hosts' ? <HostsTab canManage={canManage} /> : null}
      {tab === 'events' ? <EventsTab /> : null}
      {tab === 'money' ? <MoneyTab /> : null}
      {tab === 'safety' ? <SafetyTab canManage={canManage} /> : null}
      {tab === 'settings' ? <SettingsTab /> : null}
      {tab === 'reports' ? <ReportsTab /> : null}
      {tab === 'changes' ? <ChangesTab /> : null}
      {tab === 'older' ? <OlderOffers canManage={canManage} /> : null}
    </View>
  );
}
