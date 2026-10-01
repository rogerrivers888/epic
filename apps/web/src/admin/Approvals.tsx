/**
 * The Approvals queue (G11, 1 Oct 2026).
 *
 * An agent that needs a privileged action files a request; the owner, signed in
 * personally, approves or declines with one click — logged with his name. On
 * approval the server runs exactly the recorded call under the owner's identity
 * and shows the result; a failed one can be approved again. The buttons are
 * shown to everyone but work only when elevated.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Approval, api, ApiError } from '../api';
import { useSession } from '../hooks/useSession';
import { colors, spacing, type } from '../theme';
import { Button } from '../components/ui';
import { AdminPage, PageHead, Panel, ago } from './kit';

const numbersLine = (n: Approval['numbers']) =>
  n && typeof n === 'object' ? Object.entries(n).map(([k, v]) => `${v} ${k}`).join(', ') : '';

/**
 * @param standalone  On its own rail screen it always draws, with an empty
 *   state, so the owner who clicked "Approvals" is never shown a blank page.
 *   Embedded on the Overview it stays silent (returns null) when nothing waits.
 * @param onCount  Reports the number in review after every load, so the rail's
 *   "Approvals (n)" badge keeps up with an approval decided here.
 */
export function Approvals({ standalone = false, onCount }: { standalone?: boolean; onCount?: (n: number) => void } = {}) {
  const { access } = useSession();
  const elevated = Boolean(access?.elevated);
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const got = (await api.approvals('review')).approvals;
      setRows(got);
      onCount?.(got.length);
    } catch { setRows(null); }
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, decision: 'approved' | 'declined') => {
    const was = rows?.find((r) => r.id === id);
    setBusy(id); setError(null);
    try {
      const out = await api.decideApproval(id, decision);
      // Show what happened before the card clears from the review list.
      const d = was?.description ?? 'The request';
      if (decision === 'declined') setNotice(`${d} — ${was?.state === 'unknown' ? 'closed' : 'declined'}.`);
      else if (out.result?.ok) setNotice(`${d} — done. ${out.result.message}`);
      else if (out.approval.state === 'unknown') setNotice(`${d} — outcome unknown: ${out.result?.message ?? ''} Check before retrying.`);
      else setNotice(`${d} — did not run (${out.result?.status}): ${out.result?.message ?? ''} It can be approved again.`);
      await load();
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : 'Could not reach Epic.');
    } finally { setBusy(null); }
  };

  // Embedded on the Overview, stay out of the way when nothing waits. On its
  // own rail screen, always draw — the owner who clicked "Approvals" gets an
  // answer, not a blank page.
  if (!standalone && (!rows || (rows.length === 0 && !notice))) return null;
  const list = rows ?? [];
  const empty = list.length === 0 && !notice && !error;
  return (
    <Panel title="Waiting for you" sub="An agent has asked to do something only you may authorise.">
      {error ? <Text style={[type.small, { color: colors.overrun }]}>{error}</Text> : null}
      {notice ? <Text style={[type.small, { color: colors.ink }]}>{notice}</Text> : null}
      {!elevated ? (
        <Text style={[type.small, { color: colors.ink }]}>Sign in with your e-mail link to approve or decline these.</Text>
      ) : null}
      {empty ? (
        <Text style={type.small}>Nothing is waiting for you right now. When an agent asks to do something only you may authorise, it appears here.</Text>
      ) : null}
      {list.map((r) => {
        const nums = numbersLine(r.numbers);
        const failed = r.state === 'failed';
        const unknown = r.state === 'unknown';
        return (
          <View key={r.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, gap: 4 }}>
            {/* What it will do, in plain English, and the numbers affected. */}
            <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{r.description}</Text>
            {/* The exact call, in full — the owner authorises what he can see. */}
            <Text style={type.tiny}>
              {`${nums ? `${nums} · ` : ''}${r.request}`}
            </Text>
            <Text style={type.tiny}>{`${r.requested_label ?? r.session_label ?? 'an agent'} · ${ago(r.created_at)}`}</Text>
            {/* The exact call that will run, so the owner authorises what he sees —
                the description is the agent's claim; this is what executes. */}
            {r.payload != null && Object.keys(r.payload as object).length > 0 ? (
              <Text style={[type.tiny, { color: colors.inkMuted, fontFamily: 'monospace' as any }]}>
                {`It will send: ${JSON.stringify(r.payload)}`}
              </Text>
            ) : null}
            {failed && r.result ? (
              <Text style={[type.tiny, { color: colors.overrun }]}>{`Last run failed (${r.result.status}): ${r.result.message} — approve to try again.`}</Text>
            ) : null}
            {unknown && r.result ? (
              <Text style={[type.tiny, { color: colors.overrun }]}>{`Ran, but the outcome is unknown: ${r.result.message} Check whether it happened before doing anything — it will NOT run again automatically.`}</Text>
            ) : null}
            {elevated ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 2 }}>
                {/* An unknown run must not be re-run blindly: only close it once checked. */}
                {unknown ? null : <Button kind="primary" label={failed ? 'Approve & run again' : 'Approve & run'} loading={busy === r.id} onPress={() => void decide(r.id, 'approved')} />}
                <Button kind="secondary" label={unknown ? 'Checked — close' : 'Decline'} loading={busy === r.id} onPress={() => void decide(r.id, 'declined')} />
              </View>
            ) : null}
          </View>
        );
      })}
    </Panel>
  );
}

/**
 * The rail's Approvals screen — the panel on its own page, with a heading, so
 * "Approvals" in the menu lands somewhere that explains itself whether or not
 * anything is waiting (owner, 1 Oct 2026: "put the approvals list somewhere
 * obvious"). The queue used to live only on the unlisted estate Overview.
 */
export function ApprovalsScreen({ onCount }: { onCount?: (n: number) => void }) {
  return (
    <AdminPage>
      <PageHead
        title="Approvals"
        sub="Actions an agent has asked you to authorise. Approving runs the exact recorded call under your name and shows the result; declining closes it."
      />
      <Approvals standalone onCount={onCount} />
    </AdminPage>
  );
}
