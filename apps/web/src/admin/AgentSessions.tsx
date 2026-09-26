/**
 * The agent sessions, and the owner's grant of paid hours.
 *
 * Owner, 26 Sep 2026 (G8): "Agent sessions get a zero paid budget unless I
 * grant one." An agent is anything holding the passcode that is not the app on
 * somebody's device — a script, a coding session, a headless browser. Each row
 * says who it called itself, when it was last here and what it spent in the
 * last day; one tap gives it 24 hours of paid calls, one takes them away. The
 * API refuses the grant from an agent's own session, so an agent cannot give
 * itself a budget. Hidden for a session without `manage_settings`.
 *
 * Only the sessions seen in the last 24 hours, and any still holding a grant,
 * with a link to the rest (owner, 26 Sep 2026: "Trim the Agent sessions panel
 * to sessions seen in the last 24 hours, with a link to show all").
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Press } from '../components/press';
import { AgentSession, api, ApiError } from '../api';
import { colors, spacing, type } from '../theme';
import { Button } from '../components/ui';
import { Panel, ago, money } from './kit';

export function AgentSessions() {
  const [rows, setRows] = useState<AgentSession[] | null>(null);
  const [total, setTotal] = useState(0);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Only the latest ask may draw: a slow "all" answer arriving after a switch
  // back to the last 24 hours, or after a grant's reload, would otherwise
  // replace the list with the wrong one (Codex, 26 Sep 2026). `mode` is read
  // through a ref so a grant's reload asks for the view on screen now.
  const asked = useRef(0);
  const mode = useRef(all);
  mode.current = all;
  const load = useCallback(async () => {
    const n = ++asked.current;
    try {
      const out = await api.agentSessions(mode.current);
      if (n === asked.current) { setRows(out.sessions); setTotal(out.total); }
    } catch { if (n === asked.current) setRows(null); }
  }, []);
  useEffect(() => { void load(); }, [load, all]);
  useEffect(() => { void load(); }, [load]);

  const grant = async (id: string, hours: number) => {
    setBusy(id); setError(null);
    try { await api.grantAgent(id, hours); await load(); } catch (e: any) {
      setError(e instanceof ApiError ? e.message : 'Could not reach Epic.');
    } finally { setBusy(null); }
  };

  if (!rows) return null;
  const granted = (r: AgentSession) => Boolean(r.paid_grant_until && new Date(r.paid_grant_until) > new Date());
  return (
    <Panel title="Agent sessions" sub="No paid calls unless you allow them.">
      {error ? <Text style={[type.small, { color: colors.overrun }]}>{error}</Text> : null}
      {rows.length ? rows.map((r) => (
        <View key={r.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.lineSoft }}>
          <View style={{ flexGrow: 1, flexBasis: 180, gap: 1 }}>
            <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]} numberOfLines={1}>{r.label ?? 'No name given'}</Text>
            <Text style={type.tiny}>
              {`${ago(r.last_seen_at ?? r.created_at)} · ${money(r.spent_24h_usd)} in 24 h`}
              {granted(r) ? ` · paid until ${new Date(r.paid_grant_until!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </Text>
          </View>
          {granted(r)
            ? <Button kind="secondary" label="Stop paid calls" loading={busy === r.id} onPress={() => void grant(r.id, 0)} />
            : <Button kind="secondary" label="Allow 24 hours" loading={busy === r.id} onPress={() => void grant(r.id, 24)} />}
        </View>
      )) : <Text style={type.small}>{all ? 'None signed in.' : 'None seen in the last 24 hours.'}</Text>}
      {total > rows.length || all ? (
        <Press onPress={() => setAll((a) => !a)} accessibilityRole="link" style={{ paddingTop: spacing.sm }}>
          <Text style={[type.small, { color: colors.ink, textDecorationLine: 'underline' }]}>
            {all ? 'Show the last 24 hours only' : `Show all ${total}`}
          </Text>
        </Press>
      ) : null}
    </Panel>
  );
}
