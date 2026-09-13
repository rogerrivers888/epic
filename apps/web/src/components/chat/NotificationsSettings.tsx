import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../press';
import { api, ChatPrefs, ChatSettings } from '../../api';
import { colors, fonts, spacing, type } from '../../theme';
import { Icon } from '../Icon';
import { FoldLine, Row, StatusLine } from '../ui';
import { TimeField } from '../TimePicker';

/**
 * Settings → Notifications (E5): every trip and hosted date in one list, plus
 * the daily-digest time and quiet hours. The third route in, for someone who
 * wants the lot in one place; the bell on each chat is the first, and the
 * ellipsis on each question the second.
 */
export function NotificationsSettings({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<ChatSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.chatSettings()); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setTimes = async (patch: { digestAt?: string; quietFrom?: string | null; quietTo?: string | null }) => {
    if (!data) return;
    setData({ ...data, ...patch } as ChatSettings);
    try { await api.setChatSettings(patch); } catch (e: any) { setError(e.message); load(); }
  };
  const setPrefs = async (i: number, patch: Partial<ChatPrefs>) => {
    if (!data) return;
    const c = data.contexts[i];
    const next = { ...c.prefs, ...patch };
    setData({ ...data, contexts: data.contexts.map((x, k) => (k === i ? { ...x, prefs: next } : x)) });
    try { await api.setChatPrefs(c.type, c.id, next); } catch (e: any) { setError(e.message); load(); }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Press onPress={onBack} accessibilityRole="button"><Row><Icon name="back" size={18} /><Text style={type.h3}>You and yours</Text></Row></Press>
      <Text style={type.title}>Notifications</Text>
      <Text style={type.small}>What you get told about on every trip and hosted date, when the digest lands, and when Epic stays quiet. The defaults are the design — nothing here has to be set to be alright.</Text>
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      {data ? (
        <>
          <Text style={styles.kicker}>WHEN</Text>
          <FoldLine label="Daily digest lands at" value={data.digestAt} icon="bell">
            <Text style={type.small}>For any trip or date you switched to one digest a day instead of live pings.</Text>
            <TimeField value={data.digestAt} onChange={(v) => v && setTimes({ digestAt: v })} step={30} label="Digest time" />
          </FoldLine>
          <FoldLine label="Quiet hours" value={data.quietFrom && data.quietTo ? `${data.quietFrom} – ${data.quietTo}` : 'None'} icon="bellOff">
            <Text style={type.small}>Nothing is sent inside these hours; it waits until they end.</Text>
            <Row>
              <View style={{ flex: 1 }}><TimeField value={data.quietFrom ?? ''} onChange={(v) => setTimes({ quietFrom: v || null })} step={30} label="From" placeholder="From" clearable /></View>
              <View style={{ flex: 1 }}><TimeField value={data.quietTo ?? ''} onChange={(v) => setTimes({ quietTo: v || null })} step={30} label="To" placeholder="To" clearable /></View>
            </Row>
          </FoldLine>

          <Text style={styles.kicker}>EVERY TRIP AND HOSTED DATE</Text>
          {!data.contexts.length ? <Text style={type.small}>No trips or bookings yet. Each one appears here as you make it.</Text> : null}
          {data.contexts.map((c, i) => (
            <FoldLine key={`${c.type}:${c.id}`} label={c.when} value={c.name} icon={c.type === 'offer' ? 'host' : 'trips'}>
              <View style={{ gap: 2, paddingBottom: spacing.sm }}>
                <Switch label="Threads I started or replied to" on={c.prefs.started} onChange={(v) => setPrefs(i, { started: v })} />
                <Switch label={c.type === 'offer' ? 'Dates I am booked on' : 'Days I am on'} on={c.prefs.anchors} onChange={(v) => setPrefs(i, { anchors: v })} />
                <Switch label={c.type === 'offer' ? 'Anything from the host' : 'Anything from the organiser'} hint="Cannot be turned off for the day of." on={c.prefs.from_host} onChange={(v) => setPrefs(i, { from_host: v })} />
                <Switch label="Every new question" on={c.prefs.every_topic} onChange={(v) => setPrefs(i, { every_topic: v })} />
                <Switch label="Someone mentions me" on={c.prefs.mentions} onChange={(v) => setPrefs(i, { mentions: v })} />
                <Switch label="One digest a day instead of live pings" on={c.prefs.digest} onChange={(v) => setPrefs(i, { digest: v })} />
              </View>
            </FoldLine>
          ))}
        </>
      ) : !error ? <Text style={type.small}>Opening…</Text> : null}
    </ScrollView>
  );
}

function Switch({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <Press onPress={() => onChange(!on)} accessibilityRole="switch" accessibilityState={{ checked: on }} style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle}>{label}</Text>
        {hint ? <Text style={type.tiny}>{hint}</Text> : null}
      </View>
      <View style={[styles.track, on && styles.trackOn]}><View style={styles.knob} /></View>
    </Press>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: spacing.md, paddingBottom: 60 },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '800', letterSpacing: 0.88, color: colors.inkMuted, marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingVertical: 4 },
  rowTitle: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.ink },
  track: { width: 44, height: 26, backgroundColor: colors.warm, padding: 3, justifyContent: 'center', alignItems: 'flex-start' },
  trackOn: { backgroundColor: colors.lime, alignItems: 'flex-end' },
  knob: { width: 20, height: 20, backgroundColor: colors.ink },
});
