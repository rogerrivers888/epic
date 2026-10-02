/**
 * Host home (option 4e, signed off) and a lane's own screen (hosting v7).
 *
 * 4e: a lime hero — "Host it." and "A one-off, something weekly, a course, or
 * time people book." — over a 2×2 of block colours filling the space down to
 * the tab bar: One-off ink, Weekly deep green, Course lime tint, On request
 * warm grey. Each block: a lime tag, a faint expand mark, a centred title with
 * no full stop and two lines of examples. On a desktop, hovering a block
 * brightens its mark and lights its phrase in the hero, ink on lime. A tap
 * opens the lane.
 *
 * The lane: its colour band, title and line, the animated card (the host
 * page's own — what running it looks like), "Hosts are running", and
 * Start · {lane}.
 */

import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { useViewport } from '../../../hooks/useViewport';
import { CREAM, HAIRLINE, INK, LIME, fonts } from '../../../theme';
import { KindCard } from '../../../site/pages/HostKindCards';
import { STRINGS as HOST_PAGE } from '../../../site/pages/HostLanding.strings';
import { ActionBar, pointer, tx, hx } from './kit';
import { HERO_SEGMENTS, LANES, LANE_ORDER, type HostLane } from './model';

const web = Platform.OS === 'web';
const pre = (web ? { whiteSpace: 'pre' } : {}) as TextStyle;
const nowrap = (web ? { whiteSpace: 'nowrap' } : {}) as TextStyle;
const CARD_KEY: Record<HostLane, 'one-off' | 'weekly' | 'course' | 'on-request'> = { oneoff: 'one-off', weekly: 'weekly', course: 'course', onrequest: 'on-request' };

export function HostLanes({ yours = 0 }: { yours?: number }) {
  const { navigate } = useRouter();
  const { width } = useViewport();
  const wide = width >= 900;
  const [hover, setHover] = useState<number | null>(null);
  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.hero}>
        <Text style={hx(50, -0.055, 0.9)}>Host it.</Text>
        <Text style={tx(15, '600', INK, { lineHeight: 21 })}>
          {HERO_SEGMENTS.map(([t, i], n) => (
            <Text key={n} style={i != null && i === hover ? { backgroundColor: INK, color: LIME } : null}>{t}</Text>
          ))}
        </Text>
        {yours ? (
          <Press onPress={() => navigate(paths.hostManage())} accessibilityRole="button" style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2 }, pointer]}>
            <Text style={tx(13.5, '700')}>Your offers and drafts · {yours}</Text>
            <Icon name="more" size={16} color={INK} strokeWidth={2.2} />
          </Press>
        ) : null}
      </View>
      <View style={styles.grid}>
        {[0, 2].map((row) => (
          <View key={row} style={styles.gridRow}>
            {LANE_ORDER.slice(row, row + 2).map((lane, j) => {
              const i = row + j; const look = LANES[lane];
              return (
                <Press key={lane} onPress={() => navigate(paths.hostLane(lane))} onHoverIn={() => setHover(i)} onHoverOut={() => setHover((h) => (h === i ? null : h))}
                  accessibilityRole="button" accessibilityLabel={`${look.tag}: ${look.short.replace('\n', ' ')}`}
                  style={[styles.block, { backgroundColor: look.bg }, pointer]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={styles.tag}><Text style={styles.tagText}>{look.tag}</Text></View>
                    <View style={{ opacity: hover === i ? 0.95 : 0.5 }}><Icon name="expandOut" size={16} color={look.fg} strokeWidth={2} /></View>
                  </View>
                  <Text style={[hx(21, -0.035, 1, look.fg), { textAlign: 'center' }, pre]}>{look.short}</Text>
                  <View style={{ alignItems: 'center' }}>
                    {look.rows.map((r) => <Text key={r} style={[tx(11, '600', look.sub, { lineHeight: 15.4 }), nowrap]}>{r}</Text>)}
                  </View>
                </Press>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

export function LaneScreen({ lane }: { lane: HostLane }) {
  const { navigate } = useRouter();
  const { width } = useViewport();
  const wide = width >= 900;
  const look = LANES[lane];
  const page = HOST_PAGE['en-gb'];
  const card = page.kinds.find((k) => k.key === CARD_KEY[lane]);
  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={{ backgroundColor: look.bg, paddingTop: 10, paddingHorizontal: 20, paddingBottom: 18, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Press onPress={() => navigate(paths.hostLanes())} accessibilityRole="button" accessibilityLabel="Back to Host" style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, pointer]}>
            <Icon name="previous" size={20} color={look.fg} strokeWidth={2.2} />
            <Text style={tx(14, '700', look.fg)}>Host</Text>
          </Press>
          <View style={styles.tag}><Text style={styles.tagText}>{look.tag}</Text></View>
        </View>
        <Text style={[hx(32, -0.035, 1, look.fg), pre]}>{look.title}</Text>
        <Text style={tx(15, '400', look.sub, { lineHeight: 21.75 })}>{look.line}</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 18, paddingHorizontal: 20, gap: 16 }}>
        {card ? <View style={{ height: 430 }}><KindCard k={card} strip={page.strip} delay={0} /></View> : null}
        <View>
          <Text style={[tx(12, '700', INK, { letterSpacing: 0.72, textTransform: 'uppercase', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: HAIRLINE }), { fontFamily: fonts.heading }]}>Hosts are running</Text>
          {look.eg.map((e) => <Text key={e} style={tx(15, '600', INK, { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE })}>{e}</Text>)}
        </View>
      </ScrollView>
      <ActionBar label={`Start · ${look.tag}`} onPress={() => navigate(paths.hostCompose(lane))} bordered />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: CREAM },
  wide: { maxWidth: 720, width: '100%', alignSelf: 'center' },
  hero: { backgroundColor: LIME, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 16, gap: 8 },
  grid: { flex: 1, minHeight: 360 },
  gridRow: { flex: 1, flexDirection: 'row' },
  block: { flex: 1, paddingTop: 16, paddingHorizontal: 14, paddingBottom: 14, justifyContent: 'space-between' },
  tag: { backgroundColor: LIME, paddingVertical: 3, paddingHorizontal: 7 },
  tagText: { fontFamily: fonts.heading, fontSize: 13, fontWeight: '800', color: INK },
});
