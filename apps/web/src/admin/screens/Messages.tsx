/**
 * Messages and emails — System › Messages and emails (back-office design
 * handover, 3 Oct 2026, §7).
 *
 * One template system with an editor (Templates, the default tab) and the
 * record of what was actually sent (Sent — the old Mail screen, Roger, 3 Oct
 * 2026). Templates joins the bar when its editor is built; until then the
 * screen opens on Sent, because a tab that opens nothing is a dead end.
 */
import React, { useEffect } from 'react';
import { asOneOf, useQueryState, useRouter } from '../../router';
import { MESSAGES_TABS, type MessagesTab } from '../../routes';
import { AdminPage, PageHead, TabBar } from '../kit';
import { Mail } from './Mail';

const TABS: { key: MessagesTab; label: string }[] = [{ key: 'sent', label: 'Sent' }];

export function Messages({ canSend }: { canSend: boolean }) {
  const [tab, setTab] = useQueryState<MessagesTab>('tab', 'templates', asOneOf(MESSAGES_TABS, 'templates'));
  const shown: MessagesTab = TABS.some((t) => t.key === tab) ? tab : TABS[0].key;
  // The address says what is drawn (Codex, 3 Oct 2026): while Templates is
  // unbuilt, a bare /admin/messages is rewritten to the tab it shows.
  const raw = useRouter().query.get('tab');
  useEffect(() => {
    // Against the raw query too, so an unknown `?tab=foo` — which reads as the default — is cleaned away.
    if (shown !== tab || (raw != null && raw !== shown)) setTab(shown, { replace: true });
  }, [shown, tab, raw, setTab]);
  return (
    <AdminPage>
      <PageHead title="Messages and emails" />
      <TabBar tabs={TABS} value={shown} onPick={setTab} />
      {shown === 'sent' ? <Mail canSend={canSend} embedded /> : null}
    </AdminPage>
  );
}
