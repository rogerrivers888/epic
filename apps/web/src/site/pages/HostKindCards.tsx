/**
 * Section 01 of the host page, "Four ways to host." (v6, signed off 2 Oct 2026):
 * One-off · Weekly · Course · On request, each with a card whose strip plays a
 * short loop of what the host would see on Epic.
 *
 * Wide, the four sit in shared rows — tag, title and line, card, "Hosts are
 * running" — so the columns line up whatever each one's words run to (the
 * design: "build this as one grid, not four independent cards"). Each row is a
 * flex row of cells, which stretch to the row's tallest. On a phone each kind is
 * one column in the same order.
 *
 * The loop (6s, ends on a 4.6s end state): the chip drops in at 0.7s, the numbers
 * roll from 1.3s to 2.6s, the result rises at 2.7s, and the strip dips and resets
 * at 5.5s. Cards start 350ms apart left to right, only once 40% in view, pause
 * while hidden, stop after three loops, replay on a click, and show only the end
 * state under reduced motion (site/motion.ts › useStoryboard).
 *
 * The photos are the v3 handoff's ("Webstie & host v3", 2 Oct 2026): Unsplash
 * placeholders, downloaded and served from public/site/host (its README says
 * which is which), to be swapped for licensed photography before launch. The
 * strip's figures carry a star, a tick and arrows drawn from the icon set, never
 * glyph characters.
 */
import React, { useRef } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { CREAM, DEEP_GREEN, HAIRLINE, INACTIVE, INK, INK_MUTED, LIGHT_GREY, LIME, LIME_PALE, LIME_TINT, TRACK, fonts } from '../../theme';
import { Icon } from '../../components/Icon';
import { useStoryboard } from '../motion';
import type { HostKindWords, HostLandingStrings, KindKey } from './HostLanding.strings';
import { stripAt } from './hostStrip';

const LOOP = 6000;
const END = 4600;
const LOOPS = 3;
const STAGGER = 350;
/** The result chip's colours, by the name the strip gives them. */
const RESULT = { lime: { backgroundColor: LIME, color: INK }, tint: { backgroundColor: LIME_TINT, color: DEEP_GREEN }, cream: { backgroundColor: CREAM, color: INK } } as const;
/** Each card's photo (public/site/host/README.md); the ground under it is the design's #D7D3D3 while it loads. */
const PHOTO: Record<KindKey, string> = {
  'one-off': '/site/host/host-one-off-durdle-door-700.jpg',
  weekly: '/site/host/host-weekly-pottery-wheel-700.jpg',
  course: '/site/host/host-course-swimming-goggles-700.jpg',
  'on-request': '/site/host/host-on-request-cooking-kitchen-700.jpg',
};

const nowrap = (Platform.OS === 'web' ? { whiteSpace: 'nowrap' } : {}) as TextStyle;
const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export function HostKindCards({ kinds, strip, running, cols }: { kinds: HostKindWords[]; strip: HostLandingStrings['strip']; running: string; cols: 1 | 2 | 4 }) {
  if (cols === 1) {
    return (
      <View style={{ gap: 44 }}>
        {kinds.map((k) => (
          <View key={k.key} style={{ gap: 18 }}>
            <Tag text={k.tag} />
            <TitleAndLine k={k} gap={18} />
            <KindCard k={k} strip={strip} delay={0} />
            <Running title={running} items={k.eg} />
          </View>
        ))}
      </View>
    );
  }
  // Wide: rows of `cols`, each row of cells sharing its height with its neighbours.
  const groups: HostKindWords[][] = [];
  for (let i = 0; i < kinds.length; i += cols) groups.push(kinds.slice(i, i + cols));
  const row = (cells: React.ReactNode[], key: string, stretch = false) => (
    <View key={key} style={[styles.row, stretch && { alignItems: 'stretch' }]}>
      {cells.map((c, i) => <View key={i} style={[styles.cell, stretch && { flexDirection: 'column' }]}>{c}</View>)}
    </View>
  );
  return (
    <View style={{ gap: 48 }}>
      {groups.map((g, gi) => (
        <View key={gi} style={{ gap: 18 }}>
          {row(g.map((k) => <Tag key={k.key} text={k.tag} />), 'tag')}
          {row(g.map((k) => <TitleAndLine key={k.key} k={k} />), 'title')}
          {row(g.map((k, i) => <KindCard key={k.key} k={k} strip={strip} delay={cols === 4 ? i * STAGGER : 0} />), 'card', true)}
          {row(g.map((k) => <Running key={k.key} title={running} items={k.eg} />), 'running')}
        </View>
      ))}
    </View>
  );
}

function Tag({ text }: { text: string }) {
  return <View style={{ flexDirection: 'row' }}><Text style={styles.tag}>{text}</Text></View>;
}

/** The design's `row` layout keeps title and line 10px apart; its `single` layout spaces them like everything else, 18. */
function TitleAndLine({ k, gap = 10 }: { k: HostKindWords; gap?: number }) {
  return (
    <View style={{ gap }}>
      <Text style={styles.title}>{k.title}</Text>
      <Text style={styles.line}>{k.line}</Text>
    </View>
  );
}

function Running({ title, items }: { title: string; items: string[] }) {
  return (
    <View>
      <Text style={styles.runningHead}>{title}</Text>
      {items.map((e) => <Text key={e} style={[styles.runningItem, nowrap]}>{e}</Text>)}
    </View>
  );
}

function KindCard({ k, strip, delay }: { k: HostKindWords; strip: HostLandingStrings['strip']; delay: number }) {
  const node = useRef<View>(null);
  const { t, looped, replay } = useStoryboard(node, { loop: LOOP, end: END, loops: LOOPS, delay });
  const s = stripAt(k.key, t, looped, strip);
  return (
    <Pressable ref={node} onPress={replay} accessibilityRole="none" style={[styles.card, Platform.OS === 'web' && ({ cursor: 'default' } as object)]}>
      <View aria-hidden style={styles.photo}>
        <Image source={{ uri: PHOTO[k.key] }} accessible={false} resizeMode="cover" style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.body}>
        <Text style={styles.kicker}>{k.kicker}</Text>
        <Text style={styles.cardTitle}>{k.card}</Text>
        <View style={styles.pills}>{k.pills.map((p) => <Text key={p} style={[styles.pill, nowrap]}>{p}</Text>)}</View>
      </View>
      <View style={[styles.strip, { opacity: s.stripOpacity }]}>
        <View style={[styles.stripRow, { height: 26, justifyContent: 'space-between' }]}>
          <Text style={styles.example}>{strip.example}</Text>
          <View style={[styles.chip, { opacity: s.chip, transform: [{ translateY: (1 - s.chip) * -10 }] }]}>
            <View style={styles.tick}><Icon name="check" size={11} color={INK} strokeWidth={3.4} /></View>
            <Text style={[styles.chipText, nowrap]}><Text style={{ fontWeight: '700' }}>{k.who}</Text><Text style={{ color: INK_MUTED }}> · {k.when}</Text></Text>
          </View>
        </View>
        <View style={[styles.stripRow, { height: 20, gap: 4 }]} accessibilityLabel={k.key === 'on-request' ? strip.onRequest.statusSaid : undefined}>
          {k.key === 'on-request' ? <View aria-hidden><Icon name="favourite" size={14} color={INK} fill strokeWidth={2} /></View> : null}
          <Text style={[styles.status, tabular, nowrap]}>{s.status}</Text>
        </View>
        <View style={{ height: 34, justifyContent: 'center', gap: 5 }}>
          {k.key === 'one-off' ? (
            <View style={styles.bar8}><View style={{ height: '100%', width: `${s.pct ?? 0}%`, backgroundColor: s.full ? LIME : LIME_PALE }} /></View>
          ) : null}
          {k.key === 'weekly' && s.spark ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, height: 34 }}>
              <Text style={[styles.money, tabular, nowrap]}>{s.money} <Text style={styles.thisWeek}>{strip.weekly.thisWeek}</Text></Text>
              <View aria-hidden style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 30 }}>
                {s.spark.map((b, i) => <View key={i} style={{ width: 6, height: b.h, backgroundColor: b.current ? (s.full ? LIME : LIME_PALE) : LIGHT_GREY }} />)}
              </View>
            </View>
          ) : null}
          {k.key === 'course' ? (
            <View aria-hidden style={{ flexDirection: 'row', gap: 3 }}>
              {Array.from({ length: 10 }, (_, i) => <View key={i} style={{ flex: 1, height: 8, backgroundColor: LIME_PALE }} />)}
            </View>
          ) : null}
          {k.key === 'on-request' && s.progress ? (
            <>
              <Text style={[styles.progress, tabular, nowrap]}>{s.progress}</Text>
              <View style={styles.bar6}><View style={{ height: '100%', width: `${s.pct ?? 0}%`, backgroundColor: LIME }} /></View>
            </>
          ) : null}
        </View>
        <View style={[styles.stripRow, { height: 24, opacity: s.rise, transform: [{ translateY: (1 - s.rise) * 6 }] }]}>
          <Result kind={k.key} strip={strip} colours={RESULT[s.result]} />
        </View>
      </View>
    </Pressable>
  );
}

/** The chip that rises at the end of a strip: words, with the tick or arrows the design draws as glyphs. */
function Result({ kind, strip, colours }: { kind: KindKey; strip: HostLandingStrings['strip']; colours: { backgroundColor: string; color: string } }) {
  const ink = colours.color;
  const icon = (name: 'check' | 'ascending' | 'forward') => <View aria-hidden><Icon name={name} size={13} color={ink} strokeWidth={3} /></View>;
  const words = (t: string) => <Text style={[styles.result, nowrap, { color: ink }]}>{t}</Text>;
  const said = kind === 'one-off' ? strip.oneOffSaid : kind === 'weekly' ? strip.weeklySaid : kind === 'on-request' ? strip.onRequest.resultSaid : strip.course.result;
  return (
    <View accessibilityLabel={said} style={[styles.resultChip, { backgroundColor: colours.backgroundColor }]}>
      {kind === 'one-off' ? <>{words(strip.oneOff.result)}{icon('check')}</> : null}
      {kind === 'weekly' ? <>{icon('ascending')}{words(strip.weekly.result)}</> : null}
      {kind === 'course' ? words(strip.course.result) : null}
      {kind === 'on-request' ? <>{words(strip.onRequest.result[0])}{icon('forward')}{words(strip.onRequest.result[1])}</> : null}
    </View>
  );
}

const H = fonts.heading;
const B = fonts.body;
/** Text the design gives no line height of its own sits at the page's 1.55 (measured: the card is 455px tall at 271 wide). */
const text = (size: number, weight: TextStyle['fontWeight'], extra?: TextStyle): TextStyle => ({ fontFamily: B, fontSize: size, fontWeight: weight, color: INK, lineHeight: Math.round(size * 1.55 * 10) / 10, ...extra });

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 28, alignItems: 'flex-start' },
  cell: { flex: 1, minWidth: 0 },
  tag: text(14, '800', { backgroundColor: LIME, paddingVertical: 4, paddingHorizontal: 8 }),
  title: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 36, letterSpacing: -36 * 0.035, lineHeight: 36, ...(Platform.OS === 'web' ? ({ textWrap: 'balance', whiteSpace: 'pre-line' } as object) : {}) },
  line: text(17, '400', { lineHeight: 17 * 1.45, ...(Platform.OS === 'web' ? ({ textWrap: 'pretty' } as object) : {}) }),
  runningHead: text(13, '700', { letterSpacing: 13 * 0.06, textTransform: 'uppercase', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: HAIRLINE }),
  runningItem: text(15, '600', { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }),

  card: { flex: 1, borderWidth: 1, borderColor: HAIRLINE, backgroundColor: CREAM },
  photo: { height: 160, overflow: 'hidden', backgroundColor: HAIRLINE },
  body: { flex: 1, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  kicker: text(12, '700', { letterSpacing: 12 * 0.06, textTransform: 'uppercase', color: INK_MUTED }),
  cardTitle: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 21, letterSpacing: -21 * 0.02, lineHeight: 21 * 1.15, minHeight: 21 * 1.15 * 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: text(13, '600', { paddingVertical: 3, paddingHorizontal: 8, backgroundColor: INACTIVE }),

  strip: { backgroundColor: INACTIVE, paddingTop: 12, paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  stripRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  example: text(10.5, '700', { letterSpacing: 10.5 * 0.07, textTransform: 'uppercase', color: INK_MUTED, borderWidth: 1, borderColor: LIGHT_GREY, paddingVertical: 2, paddingHorizontal: 6 }),
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CREAM, paddingTop: 4, paddingBottom: 4, paddingLeft: 5, paddingRight: 9, overflow: 'hidden', flexShrink: 1 },
  tick: { width: 16, height: 16, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center' },
  chipText: text(12.5, '400'),
  status: text(15, '700'),
  bar8: { height: 8, backgroundColor: TRACK },
  bar6: { height: 6, backgroundColor: TRACK },
  money: { fontFamily: H, fontWeight: '800', fontSize: 20, letterSpacing: -20 * 0.02, lineHeight: 20, color: INK },
  thisWeek: text(13, '600', { letterSpacing: 0, lineHeight: 20 }),
  progress: text(12.5, '600', { lineHeight: 12.5 }),
  resultChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8 },
  result: text(13.5, '800'),
});
