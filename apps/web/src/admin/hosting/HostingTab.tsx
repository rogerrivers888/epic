/**
 * Back office › Hosting (hosting v4, BO8a–BO8r): one screen, its sub-tabs and
 * every drill-down as query state on /admin/hosting, so any view is a link
 * you can send. Review · Hosts · Events · Money · Safety · Settings · Reports
 * · Changes; the older review screen (offers made before the four lanes) is
 * kept as the last tab until the owner says it can go.
 */

import React from 'react';
import { View } from 'react-native';
import { useQueryState, asOneOf } from '../../router';
import { Hosting as OlderOffers } from '../screens/Hosting';
import { HostingTabs } from './kit';
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
  const [tab, setTab] = useQueryState<HostingTabKey>('tab', 'review', asOneOf(HOSTING_TABS, 'review'));
  return (
    <View style={{ gap: 0 }}>
      <HostingTabs value={tab} onPick={(t) => setTab(t, { replace: false })} />
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
