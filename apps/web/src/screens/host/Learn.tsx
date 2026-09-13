/**
 * The Host tab before you are a host: the learn layer, drawn to the canvases
 * (Host Journey HB-3 · L2 · L3 · V1 and the prototype's home and shape
 * screens, 13 Sep 2026). Teach first, then ask.
 *
 *   home      "Two kinds of hosting" — you are organising something, or you
 *             are good at something. Then three ways to host, tappable.
 *   shape     one shape explained, with two private and two public worked
 *             examples, and Show me more examples.
 *   examples  what people host: none of them unusual.
 *   example   one person, with exactly what they wrote, said and charged.
 *   who       who can come — the dial that decides whether we need a video.
 *
 * Nothing here has a field. Every size is the artboard's, through the kit.
 */

import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { OfferShape } from '../../api';
import { colors, LIME, INK } from '../../theme';
import { Icon, IconName } from '../../components/Icon';
import { ScreenTop } from '../../components/InspireHeader';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import { SHAPE_ICON, SHAPE_LABEL, TYPE_LABEL, LOCAL_LABEL } from '../../components/hosting';
import { Cta, Tag, k, t } from '../../components/hostKit';
import { EXAMPLES, MORE_PASSIONS, SHAPE_STORIES } from './examples';

/** HB-3 · the tab as a non-host first sees it. */
export function LearnHome({ wide }: { wide: boolean }) {
  const { navigate } = useRouter();
  return (
    <View style={k.page}>
      <View style={wide ? k.wide : undefined}>
        <ScreenTop><Press onPress={() => navigate(paths.hostWho())} accessibilityRole="button" hitSlop={8}><Text style={[t.label, { fontWeight: '600', color: colors.accent }]}>Questions?</Text></Press></ScreenTop>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
        <View style={[k.gutter, { paddingTop: 16 }]}>
          <View style={k.limeBlock}>
            <Text style={[t.h29, { color: INK }]}>Two kinds of hosting</Text>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              <View style={styles.kindTile}><Text style={styles.kindTileText}>You are organising something</Text></View>
              <View style={styles.kindTile}><Text style={styles.kindTileText}>You are good at something</Text></View>
            </View>
            <Text style={[t.sub, { lineHeight: 20, color: colors.onLime }]}>One is an occasion. One is a skill. Both start the same way.</Text>
          </View>
        </View>
        <View style={[k.gutter, { paddingTop: 18, gap: 8 }]}>
          <Text style={t.kicker}>Three ways to host — tap any one</Text>
          <View style={{ marginTop: -2 }}>
            {(Object.keys(SHAPE_STORIES) as OfferShape[]).map((key) => {
              const s = SHAPE_STORIES[key];
              return (
                <Press key={key} onPress={() => navigate(paths.hostLearn(key))} accessibilityRole="button" style={[styles.way, k.rule]}>
                  <View style={[k.tile38, k.warm, { borderWidth: 1, borderColor: colors.ruleSoft }]}><Icon name={SHAPE_ICON[key]} size={19} color={INK} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wayTag}>{s.tag}</Text>
                    <Text style={[t.h18, { marginTop: 1 }]}>{s.title}</Text>
                    <Text style={[t.sub, { lineHeight: 20, marginTop: 3 }]}>{s.eg}</Text>
                    <Text style={[t.link, { marginTop: 5 }]}>{s.link}</Text>
                  </View>
                  <Icon name="more" size={17} color={colors.inkMuted} strokeWidth={2} />
                </Press>
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View style={wide ? k.wide : undefined}>
        <Cta quiet label="Show me what people host" onPress={() => navigate(paths.hostExamples())} style={{ paddingBottom: 14 }} />
      </View>
    </View>
  );
}

/** One shape, explained: its title and blurb, two private and two public worked examples, and the way in. */
export function LearnShape({ shape, wide }: { shape: OfferShape; wide: boolean }) {
  const { navigate, back } = useRouter();
  const s = SHAPE_STORIES[shape];
  return (
    <View style={k.page}>
      <View style={[wide && k.wide, { paddingTop: TOP }]}>
        <View style={k.nav}>
          <Press onPress={() => back(paths.host())} accessibilityRole="button" accessibilityLabel="Back" style={k.navBtn} hitSlop={8}><Icon name="previous" size={22} color={colors.ink} strokeWidth={2} /></Press>
          <Text style={t.nav}>{SHAPE_LABEL[shape]}</Text>
          <View style={{ width: 30 }} />
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
        <View style={[k.gutter, { paddingTop: 14, gap: 6 }]}>
          <Text style={t.h25}>{s.sTitle}</Text>
          <Text style={t.sub}>{s.sBlurb}</Text>
        </View>
        <View style={[k.gutter, { paddingTop: 14, gap: 11 }]}>
          <Text style={t.kicker}>People doing this</Text>
          <View style={{ marginTop: -6 }}>
            {s.egs.map((e, i) => (
              <View key={i} style={[styles.eg, k.rule]}>
                <View style={[styles.egThumb, { backgroundColor: e.vis === 'PUBLIC' ? colors.surfaceMuted : colors.warm }]}><Icon name={SHAPE_ICON[shape]} size={18} color={colors.inkMuted} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={[styles.egTag, { backgroundColor: e.vis === 'PUBLIC' ? LIME : colors.warm }]}><Text style={[styles.egTagText, { color: e.vis === 'PUBLIC' ? INK : colors.inkMuted }]}>{e.vis}</Text></View>
                  <Text style={[t.body, { fontSize: 14, fontWeight: '600', lineHeight: 18, marginTop: 3 }]}>{e.title}</Text>
                  <Text style={[t.tiny, { fontSize: 11.5, lineHeight: 15, marginTop: 1 }]}>{e.meta}</Text>
                </View>
              </View>
            ))}
          </View>
          <Press onPress={() => navigate(paths.hostExamples())} accessibilityRole="button" style={styles.more}>
            <Text style={[t.body, { fontSize: 14, fontWeight: '600' }]}>Show me more examples</Text>
            <Icon name="expand" size={15} color={colors.ink} strokeWidth={2} />
          </Press>
        </View>
      </ScrollView>
      <View style={wide ? k.wide : undefined}>
        <Cta label="Make it epic" onPress={() => navigate(paths.hostNewOffer(shape))} style={{ paddingBottom: 14 }} />
      </View>
    </View>
  );
}

const EXAMPLE_ICON: Record<string, IconName> = { skateboarding: 'cycle', cooking: 'restaurant', homeschool: 'faq', 'family-day': 'household', 'history-walk': 'attraction' };

/** L2 · what people host. None of these are unusual. */
export function LearnExamples({ wide }: { wide: boolean }) {
  const { navigate, back } = useRouter();
  const first = EXAMPLES[0];
  return (
    <View style={k.page}>
      <View style={[wide && k.wide, { paddingTop: TOP }]}>
        <View style={k.nav}>
          <Press onPress={() => back(paths.host())} accessibilityRole="button" accessibilityLabel="Back" style={k.navBtn} hitSlop={8}><Icon name="previous" size={22} color={colors.ink} strokeWidth={2} /></Press>
          <Text style={t.nav}>What people host</Text>
          <View style={{ width: 30 }} />
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
        <View style={[k.gutter, { paddingTop: 14, gap: 6 }]}>
          <Text style={[t.h26, { letterSpacing: -0.78, lineHeight: 28 }]}>None of these are unusual</Text>
          <Text style={t.sub}>Every one is somebody ordinary who is properly into one thing. Tap one to see exactly what they wrote, said and charged.</Text>
        </View>
        <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
          <View style={styles.grid}>
            {EXAMPLES.map((e) => (
              <Press key={e.key} onPress={() => navigate(paths.hostExample(e.key))} accessibilityRole="button" style={styles.person}>
                <View style={[k.tile34, k.tint]}><Icon name={EXAMPLE_ICON[e.key] ?? 'host'} size={17} color={INK} strokeWidth={2} /></View>
                <View>
                  <Text style={[t.body, { fontSize: 15, fontWeight: '700', lineHeight: 18 }]}>{e.passion}</Text>
                  <Text style={[t.tiny, { marginTop: 3, lineHeight: 16 }]}>{e.who}</Text>
                </View>
              </Press>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {MORE_PASSIONS.map((p) => <Tag key={p}>{p}</Tag>)}
            <Tag>+ 40 more</Tag>
          </View>
        </View>
      </ScrollView>
      <View style={wide ? k.wide : undefined}>
        <Cta label={`Show me the ${first.passion.toLowerCase()} one`} sub="Still nothing to fill in" onPress={() => navigate(paths.hostExample(first.key))} style={{ paddingBottom: 14 }} />
      </View>
    </View>
  );
}

/** L3 · one worked example: the words, the script, the price, and why it works. */
export function LearnExample({ exampleKey, wide }: { exampleKey: string; wide: boolean }) {
  const { navigate, back } = useRouter();
  const e = EXAMPLES.find((x) => x.key === exampleKey) ?? EXAMPLES[0];
  const others = EXAMPLES.filter((x) => x.key !== e.key);
  const next = others[Math.floor(Math.random() * others.length)];
  const first = e.line.split(',')[0].split(' ')[0];
  return (
    <View style={k.page}>
      <View style={[wide && k.wide, { paddingTop: TOP }]}>
        <View style={k.nav}>
          <Press onPress={() => back(paths.hostExamples())} accessibilityRole="button" accessibilityLabel="Back" style={k.navBtn} hitSlop={8}><Icon name="previous" size={22} color={colors.ink} strokeWidth={2} /></Press>
          <Text style={t.nav}>{e.passion}</Text>
          <View style={{ width: 30 }} />
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
        <View style={[k.gutter, { paddingTop: 12 }]}>
          <View style={styles.hero}><Icon name={EXAMPLE_ICON[e.key] ?? 'host'} size={40} color={colors.inkMuted} strokeWidth={1.6} /></View>
        </View>
        <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
          <View>
            <View style={{ flexDirection: 'row', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
              <Tag tone="tint">{`${TYPE_LABEL[e.kind]}${e.sub ? ` · ${LOCAL_LABEL[e.sub]}` : ''}`.toUpperCase()}</Tag>
              <Tag tone="ink">{SHAPE_LABEL[e.shape].toUpperCase()}</Tag>
            </View>
            <Text style={t.h22}>{e.title}</Text>
            <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, marginTop: 4 }]}>{e.line}</Text>
          </View>
          <View style={{ gap: 7 }}>
            <Text style={t.kicker}>What {first} said in the video · {e.seconds} seconds</Text>
            <Text style={styles.quote}>“{e.said}”</Text>
          </View>
          <View style={{ gap: 7 }}>
            <Text style={t.kicker}>Why it works</Text>
            <View style={{ gap: 7, marginTop: -2 }}>
              {e.why.map((w) => (
                <View key={w.t} style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
                  <View style={styles.whyTick}><Icon name="check" size={11} color={INK} strokeWidth={3.4} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.sub, { fontWeight: '600', color: colors.ink, lineHeight: 18 }]}>{w.t}</Text>
                    <Text style={[t.small, { lineHeight: 17 }]}>{w.s}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
      <View style={[wide && k.wide, k.ctaWrap, { paddingBottom: 14, gap: 8 }]}>
        <Press onPress={() => navigate(paths.hostNewOffer(e.shape))} accessibilityRole="button" style={k.cta}>
          <Text style={k.ctaText}>I could do something like this</Text>
          <Icon name="forward" size={18} color={colors.primaryFg} strokeWidth={2} />
        </Press>
        <Press onPress={() => navigate(paths.hostExample(next.key), { replace: true })} accessibilityRole="button" style={k.ctaLow}><Text style={k.ctaLowText}>Show me another example</Text></Press>
      </View>
    </View>
  );
}

/** V1 · who can come: a wedding and a skate jam are the same machinery. What differs is who can get in. */
export function LearnWho({ wide }: { wide: boolean }) {
  const { back } = useRouter();
  const rows: { icon: IconName; t: string; s: string; egs: string[]; money: string }[] = [
    { icon: 'locked', t: 'Only people I invite', s: 'You add the names. Nobody else can see it, even with the link.', egs: ['A wedding', 'A christening'], money: 'You can collect everyone’s share — you keep none of it' },
    { icon: 'link', t: 'Anyone with the link', s: 'You share it once; they pass it on. Not listed anywhere on Epic.', egs: ['A stag weekend', 'School dads up Snowdon'], money: 'Same — split costs, nobody profits' },
    { icon: 'everyone', t: 'Anyone on Epic', s: 'Listed in Inspire and Places. Anyone can find it and book.', egs: ['A skate jam', 'A supper club'], money: 'You set a price and we pay you out' },
  ];
  return (
    <View style={k.page}>
      <View style={[wide && k.wide, { paddingTop: TOP }]}>
        <View style={k.nav}>
          <Press onPress={() => back(paths.host())} accessibilityRole="button" accessibilityLabel="Back" style={k.navBtn} hitSlop={8}><Icon name="previous" size={22} color={colors.ink} strokeWidth={2} /></Press>
          <Text style={t.nav}>Who can come</Text>
          <View style={{ width: 30 }} />
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
        <View style={[k.gutter, { paddingTop: 14, gap: 6 }]}>
          <Text style={[t.h26, { lineHeight: 28 }]}>Anything you organise, for anyone you choose</Text>
          <Text style={t.sub}>A wedding and a skate jam are the same machinery. What differs is who can get in.</Text>
        </View>
        <View style={[k.gutter, { paddingTop: 14, gap: 9 }]}>
          {rows.map((r) => (
            <View key={r.t} style={k.card}>
              <View style={[k.tile36, k.warm]}><Icon name={r.icon} size={18} color={INK} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={t.h17}>{r.t}</Text>
                <Text style={[t.small, { lineHeight: 17, marginTop: 2 }]}>{r.s}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>{r.egs.map((x) => <View key={x} style={k.tag}><Text style={[k.tagText, { color: colors.ink }]}>{x}</Text></View>)}</View>
                <Text style={[t.tiny, { fontWeight: '600', color: colors.accent, marginTop: 6 }]}>{r.money}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={wide ? k.wide : undefined}>
        <Cta quiet label="Got it" sub="You pick this in the set-up, and can change it" onPress={() => back(paths.host())} style={{ paddingBottom: 14 }} />
      </View>
    </View>
  );
}

const TOP = (Platform.OS === 'web' ? 'max(8px, var(--epic-sat))' : 8) as any;

const styles = StyleSheet.create({
  scroll: { paddingBottom: 16 },
  kindTile: { flex: 1, backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 11 },
  kindTileText: { ...t.label, fontSize: 13.5, lineHeight: 18 },
  way: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 11 },
  wayTag: { ...t.kicker, fontFamily: undefined, fontSize: 10.5, textTransform: 'none', lineHeight: 13 },
  eg: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10 },
  egThumb: { width: 62, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  egTag: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2 },
  egTagText: { fontFamily: t.label.fontFamily, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.48, lineHeight: 12 },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderWidth: 1, borderColor: colors.ruleSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  person: { width: '48%', flexGrow: 1, gap: 8, padding: 13, borderWidth: 1, borderColor: colors.ruleSoft },
  hero: { height: 150, borderRadius: 10, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  quote: { ...t.sub, lineHeight: 21, borderLeftWidth: 3, borderLeftColor: LIME, paddingVertical: 2, paddingLeft: 13 },
  whyTick: { width: 18, height: 18, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
