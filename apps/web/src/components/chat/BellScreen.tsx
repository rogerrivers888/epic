import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../press';
import { ChatContext, ChatPrefs } from '../../api';
import { colors, fonts, BORDER, TARGET } from '../../theme';
import { Icon } from '../Icon';
import { StatusLine } from '../ui';
import { useViewport } from '../../hooks/useViewport';
import { TOP_INSET } from '../InspireHeader';
import { ChatDoor } from './door';

/**
 * What you get told about, for one trip or one hosted date (C9, E5).
 *
 * The defaults are the design: you hear about things you started or replied
 * to, the days and activities you are on, anything from the organiser or
 * host, and mentions. "Every new question" is off by default — on, that is
 * fourteen pings. Nobody has to find this to be alright; the bell is for
 * turning things up, or muting a trip you are only half on.
 *
 * Announcements from the host or organiser bypass all of this on the day of
 * the event, and the row says so.
 */

/** "Tagged Mon · Uffizi and Tue · cooking" — the anchors this person is on. */
const anchorsHint = (ctx: ChatContext, anchors: string[]) =>
  (anchors.length ? `Tagged ${anchors.join(' and ')}.` : ctx.type === 'offer' ? 'The dates you are booked on.' : 'Any day or activity on this trip.');
const mentionHint = (ctx: ChatContext) => `@${(ctx.me?.name ?? 'you').split(/\s+/)[0]}, wherever it appears.`;

export function BellScreen({ door, onBack, onSettings }: {
  door: ChatDoor;
  onBack: () => void;
  /** Settings → Notifications: every trip and hosted date in one list. Absent for a guest. */
  onSettings?: () => void;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [data, setData] = useState<{ prefs: ChatPrefs; digestAt: string; anchorsOn: string[]; context: ChatContext } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!door.prefs) return;
    try { setData(await door.prefs() as any); setError(null); } catch (e: any) { setError(e.message); }
  }, [door]);
  useEffect(() => { load(); }, [load]);

  const set = async (patch: Partial<ChatPrefs>) => {
    if (!data || !door.setPrefs) return;
    const next = { ...data.prefs, ...patch };
    setData({ ...data, prefs: next });
    try { await door.setPrefs(next); setError(null); } catch (e: any) { setError(e.message); load(); }
  };

  const ctx = data?.context;
  const role = ctx?.host?.role ?? 'organiser';
  const questions = ctx ? 'all the questions on it' : '';

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.head}>
        <Press onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back"><Icon name="back" size={22} color={colors.ink} strokeWidth={2} /></Press>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>What you get told about</Text>
          <Text style={styles.sub} numberOfLines={1}>{ctx ? `${ctx.name}${ctx.subtitle ? `, ${ctx.subtitle}` : ''} · ${ctx.sub}` : ''}</Text>
        </View>
      </View>
      {error ? <View style={{ paddingHorizontal: 20 }}><StatusLine tone="warn">{error}</StatusLine></View> : null}
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>By default you only hear about things you started, replied to, or that are tagged to a day you are on. Nobody is pinged by {questions || 'every thread'}.</Text>
        {data && ctx ? (
          <>
            <Row title="Threads I started or replied to" hint="You are following these automatically." on={data.prefs.started} onChange={(v) => set({ started: v })} />
            <Row title={ctx.type === 'offer' ? 'Dates I am booked on' : 'Days I am on'} hint={anchorsHint(ctx, data.anchorsOn)} on={data.prefs.anchors} onChange={(v) => set({ anchors: v })} />
            <Row title={`Anything from the ${role}`} hint="The coach-time sort of message. Cannot be turned off for the day of." on={data.prefs.from_host} onChange={(v) => set({ from_host: v })} />
            <Row title={ctx.type === 'offer' ? 'Every new question on this date' : 'Every new question on this trip'} hint={`Off by default. On, this is ${ctx.type === 'offer' ? 'every question anybody booked asks' : 'a ping for every question on the trip'}.`} on={data.prefs.every_topic} onChange={(v) => set({ every_topic: v })} />
            <Row title="Someone mentions me" hint={mentionHint(ctx)} on={data.prefs.mentions} onChange={(v) => set({ mentions: v })} />

            <View style={styles.note}>
              <Icon name="preview" size={16} color={colors.inkMuted} />
              <Text style={styles.noteText}><Text style={{ fontWeight: '700' }}>Seen by.</Text> Opening a topic marks <Text style={{ fontWeight: '700' }}>every reply in it</Text> seen — the count on a topic is how many people have opened it, and the count under a reply is how many have scrolled past it. Nobody is told who has not read.</Text>
            </View>

            <Press onPress={() => set({ digest: !data.prefs.digest })} accessibilityRole="switch" accessibilityState={{ checked: data.prefs.digest }} style={[styles.digest, data.prefs.digest && styles.digestOn]}>
              <Icon name="bell" size={16} color={colors.accent} strokeWidth={2.2} />
              <Text style={styles.digestText}>
                {data.prefs.digest ? <><Text style={{ fontWeight: '700' }}>One digest a day</Text> instead of live pings — <Text style={{ fontWeight: '700' }}>at {data.digestAt}</Text>. Tap to go back to live.</> : <>One digest a day instead of live pings — <Text style={{ fontWeight: '700' }}>at {data.digestAt}</Text>. Tap to switch.</>}
              </Text>
            </Press>
            {onSettings ? (
              <Press onPress={onSettings} accessibilityRole="link" style={styles.link}>
                <Text style={styles.linkText}>Every trip and hosted date in one list, the digest time and quiet hours ›</Text>
              </Press>
            ) : null}
          </>
        ) : !error ? <Text style={styles.intro}>Opening…</Text> : null}
      </ScrollView>
    </View>
  );
}

/** The lime switch: a lime track with an ink square when on, warm grey when off. */
function Row({ title, hint, on, onChange }: { title: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <Press onPress={() => onChange(!on)} accessibilityRole="switch" accessibilityState={{ checked: on }} style={styles.row}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: TOP_INSET, paddingHorizontal: 12, paddingBottom: 8 },
  back: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  body: { paddingHorizontal: 20, paddingBottom: 40, gap: 4 },
  intro: { fontFamily: fonts.body, fontSize: 14, color: colors.ink, lineHeight: 21, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  rowTitle: { fontFamily: fonts.heading, fontSize: 16, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  rowHint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, lineHeight: 18 },
  track: { width: 50, height: 30, backgroundColor: colors.warm, padding: 3, justifyContent: 'center', alignItems: 'flex-start' },
  trackOn: { backgroundColor: colors.lime, alignItems: 'flex-end' },
  knob: { width: 24, height: 24, backgroundColor: colors.ink },
  knobOn: {},
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.warm, padding: 14, marginTop: 16 },
  noteText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink, lineHeight: 19 },
  digest: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceMuted, padding: 14, marginTop: 10 },
  digestOn: { borderWidth: BORDER, borderColor: colors.line },
  digestText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink, lineHeight: 19 },
  link: { paddingVertical: 14 },
  linkText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: colors.accent },
});
