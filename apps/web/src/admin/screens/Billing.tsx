/**
 * Billing — Commercial › Billing (back-office design handover, 3 Oct 2026, §9).
 *
 * Three tabs as a tab bar with no page heading: Membership · Hosting ·
 * Recovery. Every money value lives here and nowhere else (§1 rule 5).
 *
 * Only Membership is built so far, and it is the plans screen that used to sit
 * under Admin (Roger, 3 Oct 2026: "the plans screen becomes Billing ›
 * Membership"). Hosting and Recovery join the bar when they are built — a tab
 * that opens nothing is a dead end, which the back office does not have.
 */
import React, { useEffect } from 'react';
import { asOneOf, useQueryState } from '../../router';
import { BILLING_TABS, type BillingTab } from '../../routes';
import { AdminPage, TabBar } from '../kit';
import { Plans } from './Governance';

const TABS: { key: BillingTab; label: string }[] = [{ key: 'membership', label: 'Membership' }];

export function Billing({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useQueryState<BillingTab>('tab', 'membership', asOneOf(BILLING_TABS, 'membership'));
  const shown: BillingTab = TABS.some((t) => t.key === tab) ? tab : 'membership';
  // The address says what is drawn (Codex, 3 Oct 2026): a tab not built yet is
  // rewritten to Membership rather than left claiming something else.
  useEffect(() => { if (shown !== tab) setTab(shown, { replace: true }); }, [shown, tab, setTab]);
  return (
    <AdminPage>
      <TabBar tabs={TABS} value={shown} onPick={setTab} />
      {shown === 'membership' ? <Plans canManage={canManage} embedded /> : null}
    </AdminPage>
  );
}
