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
import { Panel, ago } from './kit';

const numbersLine = (n: Approval['numbers']) =>
  n && typeof n === 'object' ? Object.entries(n).map(([k, v]) => `${v} ${k}`).join(', ') : '';

export function Approvals() {
  const { access } = useSession();
  const elevated = Boolean(access?.elevated);
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await api.approvals('review')).approvals); } catch { setRows(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, decision: 'approved' | 'declined') => {
    setBusy(id); setError(null);
    try { await api.decideApproval(id, decision); await load(); } catch (e: any) {
      setError(e instanceof ApiError ? e.message : 'Could not reach Epic.');
    } finally { setBusy(null); }
  };

  if (!rows || rows.length === 0) return null;
  return (
    <Panel title="Waiting for you" sub="An agent has asked to do something only you may authorise.">
      {error ? <Text style={[type.small, { color: colors.overrun }]}>{error}</Text> : null}
      {!elevated ? (
        <Text style={[type.small, { color: colors.ink }]}>Sign in with your e-mail link to approve or decline these.</Text>
      ) : null}
      {rows.map((r) => {
        const nums = numbersLine(r.numbers);
        const failed = r.state === 'failed';
        const unknown = r.state === 'unknown';
        return (
          <View key={r.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, gap: 4 }}>
            {/* What it will do, in plain English, and the numbers affected. */}
            <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{r.description}</Text>
            <Text style={type.tiny} numberOfLines={2}>
              {`${nums ? `${nums} · ` : ''}${r.request} · ${r.requested_label ?? r.session_label ?? 'an agent'} · ${ago(r.created_at)}`}
            </Text>
            {/* The exact call that will run, so the owner authorises what he sees —
                the description is the agent's claim; this is what executes. */}
            {r.payload != null && Object.keys(r.payload as object).length > 0 ? (
              <Text style={[type.tiny, { color: colors.inkMuted, fontFamily: 'monospace' as any }]} numberOfLines={4}>
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
