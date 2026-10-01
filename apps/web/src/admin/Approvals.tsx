/**
 * The Approvals queue (G11, 1 Oct 2026).
 *
 * An agent that needs a privileged action files a request; the owner, signed in
 * personally, approves or declines it with one click — logged with his name. An
 * approved request lets that one call through once. The buttons are shown to
 * everyone but work only when elevated; otherwise they say how.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Approval, api, ApiError } from '../api';
import { useSession } from '../hooks/useSession';
import { colors, spacing, type } from '../theme';
import { Button } from '../components/ui';
import { Panel, ago } from './kit';

export function Approvals() {
  const { access } = useSession();
  const elevated = Boolean(access?.elevated);
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await api.approvals('pending')).approvals); } catch { setRows(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, decision: 'approved' | 'declined') => {
    setBusy(id); setError(null);
    try { await api.decideApproval(id, decision); await load(); } catch (e: any) {
      setError(e instanceof ApiError ? e.message : 'Could not reach Epic.');
    } finally { setBusy(null); }
  };

  if (!rows || (rows.length === 0 && elevated)) return null;
  return (
    <Panel title="Waiting for you" sub="An agent has asked to do something only you may authorise.">
      {error ? <Text style={[type.small, { color: colors.overrun }]}>{error}</Text> : null}
      {!elevated ? (
        <Text style={[type.small, { color: colors.ink }]}>Sign in with your e-mail link to approve or decline these.</Text>
      ) : null}
      {rows.length ? rows.map((r) => (
        <View key={r.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, gap: 4 }}>
          <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{r.description}</Text>
          <Text style={type.tiny} numberOfLines={1}>
            {`${r.request}${r.numbers ? ` · ${Object.entries(r.numbers).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''} · ${r.requested_label ?? r.session_label ?? 'an agent'} · ${ago(r.created_at)}`}
          </Text>
          {elevated ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 2 }}>
              <Button kind="primary" label="Approve" loading={busy === r.id} onPress={() => void decide(r.id, 'approved')} />
              <Button kind="secondary" label="Decline" loading={busy === r.id} onPress={() => void decide(r.id, 'declined')} />
            </View>
          ) : null}
        </View>
      )) : <Text style={type.small}>Nothing waiting.</Text>}
    </Panel>
  );
}
