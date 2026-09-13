import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../press';
import { api, ChatInbox, ChatInboxItem } from '../../api';
import { colors, fonts, ON_LIME, TARGET } from '../../theme';
import { Icon } from '../Icon';
import { StatusLine } from '../ui';
import { useViewport } from '../../hooks/useViewport';
import { TOP_INSET } from '../InspireHeader';
import { SHAPE_LABEL } from '../hosting';
import { ago } from './words';

/**
 * The host inbox (C5): every question across every offer, waiting first,
 * grouped by offer, private ones marked, and repeat questions counted —
 * "asked 3 times" — so the host can see what is worth answering once and for
 * good. Three or more gets the nudge.
 */
type Tab = 'waiting' | 'answered' | 'private' | 'all';

export function HostInbox({ onBack, onOpen }: { onBack: () => void; onOpen: (offerId: string, topicId: string) => void }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [data, setData] = useState<ChatInbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('waiting');
  const load = useCallback(async () => {
    try { setData(await api.chatInbox()); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const passes = (t: ChatInboxItem) => (tab === 'all' ? true : t.flags[tab]);
  const offers = (data?.offers ?? []).map((o) => ({ ...o, topics: o.topics.filter(passes) })).filter((o) => o.topics.length);
  const waiting = data?.counts.waiting ?? 0;

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.head}>
        <Press onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back"><Icon name="back" size={22} color={colors.ink} strokeWidth={2} /></Press>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Questions</Text>
          <Text style={styles.sub}>{data ? (waiting ? `${waiting} waiting on you` : 'Nothing waiting on you') : ''}</Text>
        </View>
      </View>
      {data ? (
        <View style={styles.tabs}>
          {([['waiting', 'Waiting', data.counts.waiting], ['answered', 'Answered', data.counts.answered], ['private', 'Private', data.counts.private], ['all', 'All', data.counts.all]] as const).map(([k, label, n]) => (
            <Press key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[styles.tab, tab === k && styles.tabOn]}>
              <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{label}{n && k !== 'all' && k !== 'answered' ? ` ${n}` : ''}</Text>
            </Press>
          ))}
        </View>
      ) : null}
      {error ? <View style={{ paddingHorizontal: 20 }}><StatusLine tone="warn">{error}</StatusLine></View> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {data && !offers.length ? <Text style={styles.empty}>{data.host ? 'Nothing here. Questions people ask on your offers land in this list, waiting first.' : 'You are not hosting yet.'}</Text> : null}
        {offers.map((o) => (
          <View key={o.id}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle} numberOfLines={1}>{(o.title ?? 'Untitled').toUpperCase()} · {o.topics.length}</Text>
              <Text style={styles.groupAside}>{SHAPE_LABEL[o.shape as keyof typeof SHAPE_LABEL] ?? o.shape}</Text>
            </View>
            {o.topics.map((t) => (
              <Press key={t.id} onPress={() => onOpen(o.id, t.id)} accessibilityRole="button" style={styles.row}>
                <View style={[styles.tile, t.audience === 'host_only' ? styles.tileGrey : t.state === 'answered' ? styles.tileInk : styles.tileLime]}>
                  {t.audience === 'host_only' ? <Icon name="locked" size={16} color={colors.ink} strokeWidth={2} /> : t.state === 'answered' ? <Icon name="check" size={16} color={colors.bg} strokeWidth={3} /> : <Text style={styles.tileMark}>?</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <View style={styles.kickers}>
                    {t.tag.label ? <View style={styles.kickerTint}><Text style={styles.kickerText} numberOfLines={1}>{t.tag.label.toUpperCase()}</Text></View> : null}
                    {t.audience === 'host_only' ? <View style={styles.kickerGrey}><Text style={styles.kickerText}>PRIVATE</Text></View> : null}
                  </View>
                  <Text style={styles.rowTitle}>{t.title}</Text>
                  <Text style={styles.rowMeta}>{t.askedTimes >= 2 ? `Asked ${t.askedTimes} times · Last: ${ago(t.lastAt)}` : `${t.author.name.split(/\s+/)[0]} · ${ago(t.at)}`}</Text>
                </View>
              </Press>
            ))}
          </View>
        ))}
      </ScrollView>
      <View style={styles.foot}>
        <Icon name="faq" size={18} color={colors.ink} strokeWidth={2} />
        <Text style={styles.footText}><Text style={{ fontWeight: '800' }}>Asked {data?.suggestPublishAt ?? 3} times or more</Text> gets a nudge to answer it once, publicly, for good.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: TOP_INSET, paddingHorizontal: 12, paddingBottom: 8 },
  back: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 10, flexWrap: 'wrap' },
  tab: { paddingHorizontal: 12, minHeight: 34, justifyContent: 'center', backgroundColor: colors.warm },
  tabOn: { backgroundColor: colors.selected },
  tabText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  tabTextOn: { color: ON_LIME },
  list: { paddingHorizontal: 20, paddingBottom: 120 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted, lineHeight: 20, paddingVertical: 20 },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, paddingTop: 14, paddingBottom: 6 },
  groupTitle: { flexShrink: 1, fontFamily: fonts.body, fontSize: 11, fontWeight: '800', letterSpacing: 0.88, color: colors.ink },
  groupAside: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  tile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  tileLime: { backgroundColor: colors.lime },
  tileInk: { backgroundColor: colors.ink },
  tileGrey: { backgroundColor: colors.warm, borderWidth: 1, borderColor: colors.ruleSoft },
  tileMark: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: ON_LIME },
  kickers: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  kickerTint: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 6, paddingVertical: 2, maxWidth: '100%' },
  kickerGrey: { backgroundColor: colors.warm, paddingHorizontal: 6, paddingVertical: 2 },
  kickerText: { fontFamily: fonts.body, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, color: colors.ink },
  rowTitle: { fontFamily: fonts.heading, fontSize: 16, fontWeight: '800', letterSpacing: -0.3, lineHeight: 21, color: colors.ink },
  rowMeta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceMuted, margin: 20, padding: 14 },
  footText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink, lineHeight: 19 },
});
