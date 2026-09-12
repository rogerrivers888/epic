/**
 * The Host tab before you are a host: the learn layer (Host Journey canvas,
 * 13 Sep 2026 — HB-3, L1, L2, L3, V1). Teach first, then ask.
 *
 *   home      "Two kinds of hosting" — you are organising something, or you
 *             are good at something. Then three ways to host, tappable.
 *   shape     one shape explained, with two private and two public worked
 *             examples, and Show me more examples.
 *   examples  what people host: none of them unusual.
 *   example   one person, with exactly what they wrote, said and charged.
 *   who       who can come — the dial that decides whether we need a video.
 *
 * Nothing here has a field. The one button asks for nothing, and the set-up
 * is a separate stack entered from it.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { OfferShape } from '../../api';
import { colors, fonts, spacing, type, BORDER, INK, LIME, LIME_TINT } from '../../theme';
import { Button, Row, Wrap } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ScreenTop, TopControl } from '../../components/InspireHeader';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import { SHAPE_ICON, SHAPE_LABEL, TypeChip, VISIBILITY_LABEL } from '../../components/hosting';
import { EXAMPLES, MORE_PASSIONS, SHAPE_STORIES } from './examples';

/** L1 · HB-3: the tab as a non-host first sees it. */
export function LearnHome({ wide }: { wide: boolean }) {
  const { navigate } = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={wide ? styles.wide : undefined}>
        <ScreenTop><TopControl label="Questions?" icon="info" onPress={() => navigate(paths.hostWho())} /></ScreenTop>
      </View>
      <ScrollView contentContainerStyle={[styles.body, wide && styles.wide]}>
        <Text style={styles.hero}>Two kinds of hosting</Text>
        <Row style={{ gap: spacing.sm }}>
          <View style={[styles.tile, { backgroundColor: LIME }]}><Text style={styles.tileText}>You are organising something</Text></View>
          <View style={[styles.tile, { backgroundColor: LIME_TINT }]}><Text style={styles.tileText}>You are good at something</Text></View>
        </Row>
        <Text style={type.small}>One is an occasion. One is a skill. Both start the same way.</Text>

        <Text style={styles.kicker}>THREE WAYS TO HOST — TAP ANY ONE</Text>
        {(Object.keys(SHAPE_STORIES) as OfferShape[]).map((k) => {
          const s = SHAPE_STORIES[k];
          return (
            <Press key={k} onPress={() => navigate(paths.hostLearn(k))} accessibilityRole="button" style={styles.way}>
              <View style={styles.wayIcon}><Icon name={SHAPE_ICON[k]} size={18} color={colors.ink} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.wayTag}>{s.tag}</Text>
                <Text style={type.h3}>{s.title}</Text>
                <Text style={type.small}>{s.eg}</Text>
                <Text style={styles.link}>{s.link}</Text>
              </View>
            </Press>
          );
        })}
        <Button label="Show me what people host" icon="forward" onPress={() => navigate(paths.hostExamples())} style={{ marginTop: spacing.md }} />
        <Text style={[type.tiny, { textAlign: 'center' }]}>Still nothing to fill in</Text>
      </ScrollView>
    </View>
  );
}

/** One shape, explained: the title, the note, two private and two public examples. */
export function LearnShape({ shape, wide }: { shape: OfferShape; wide: boolean }) {
  const { navigate, back } = useRouter();
  const s = SHAPE_STORIES[shape];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={[styles.body, wide && styles.wide]}>
        <Press onPress={() => back(paths.host())} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}><Row><Icon name="back" size={18} /><Text style={type.h3}>{SHAPE_LABEL[shape]}</Text></Row></Press>
        <Text style={styles.hero}>{s.sTitle}</Text>
        <Text style={type.body}>{s.sBlurb}</Text>
        <View style={styles.note}><Text style={[type.small, { color: colors.ink }]}>{s.note}</Text></View>
        <Text style={styles.kicker}>PEOPLE DOING THIS</Text>
        {s.egs.map((e, i) => (
          <View key={i} style={styles.eg}>
            <View style={[styles.egTag, { backgroundColor: e.vis === 'PUBLIC' ? LIME : colors.warm }]}><Text style={[styles.egTagText, { color: e.vis === 'PUBLIC' ? INK : colors.inkMuted }]}>{e.vis}</Text></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.h3}>{e.title}</Text>
              <Text style={type.small}>{e.meta}</Text>
            </View>
          </View>
        ))}
        <Button label="Show me more examples" kind="secondary" icon="forward" onPress={() => navigate(paths.hostExamples())} />
        <Button label={`Set up a ${SHAPE_LABEL[shape].toLowerCase()}`} icon="host" onPress={() => navigate(paths.hostNewOffer(shape))} />
      </ScrollView>
    </View>
  );
}

/** L2 · what people host. None of these are unusual. */
export function LearnExamples({ wide }: { wide: boolean }) {
  const { navigate, back } = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={[styles.body, wide && styles.wide]}>
        <Press onPress={() => back(paths.host())} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}><Row><Icon name="back" size={18} /><Text style={type.h3}>What people host</Text></Row></Press>
        <Text style={styles.hero}>None of these are unusual</Text>
        <Text style={type.body}>Every one is somebody ordinary who is properly into one thing. Tap one to see exactly what they wrote, said and charged.</Text>
        {EXAMPLES.map((e) => (
          <Press key={e.key} onPress={() => navigate(paths.hostExample(e.key))} accessibilityRole="button" style={styles.person}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.h3}>{e.passion}</Text>
              <Text style={type.small}>{e.who}</Text>
            </View>
            <Icon name="more" size={16} color={colors.inkMuted} />
          </Press>
        ))}
        <Wrap style={{ marginTop: spacing.sm }}>
          {MORE_PASSIONS.map((p) => <View key={p} style={styles.chip}><Text style={styles.chipText}>{p}</Text></View>)}
          <View style={styles.chip}><Text style={styles.chipText}>+ 40 more</Text></View>
        </Wrap>
        <Button label={`Show me the ${EXAMPLES[0].passion.toLowerCase()} one`} icon="forward" onPress={() => navigate(paths.hostExample(EXAMPLES[0].key))} style={{ marginTop: spacing.md }} />
        <Text style={[type.tiny, { textAlign: 'center' }]}>Still nothing to fill in</Text>
      </ScrollView>
    </View>
  );
}

/** L3 · one worked example: the words, the script, the price, and why it works. */
export function LearnExample({ exampleKey, wide }: { exampleKey: string; wide: boolean }) {
  const { navigate, back } = useRouter();
  const e = EXAMPLES.find((x) => x.key === exampleKey) ?? EXAMPLES[0];
  const others = EXAMPLES.filter((x) => x.key !== e.key);
  const next = others[Math.floor(Math.random() * others.length)];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={[styles.body, wide && styles.wide]}>
        <Press onPress={() => back(paths.hostExamples())} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}><Row><Icon name="back" size={18} /><Text style={type.h3}>{e.passion}</Text></Row></Press>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <TypeChip type={e.kind} localKind={e.sub ?? null} />
          <View style={[styles.egTag, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.ink }]}><Text style={[styles.egTagText, { color: colors.ink }]}>{SHAPE_LABEL[e.shape].toUpperCase()}</Text></View>
          <View style={[styles.egTag, { backgroundColor: e.visibility === 'public' ? LIME : colors.warm }]}><Text style={styles.egTagText}>{VISIBILITY_LABEL[e.visibility].toUpperCase()}</Text></View>
        </Row>
        <Text style={styles.hero}>{e.title}</Text>
        <Text style={type.small}>{e.line}</Text>
        <Text style={styles.kicker}>WHAT {e.line.split(',')[0].split(' ')[0].toUpperCase()} SAID IN THE VIDEO · {e.seconds} SECONDS</Text>
        <View style={styles.quote}><Text style={styles.quoteText}>“{e.said}”</Text></View>
        <Text style={styles.kicker}>WHY IT WORKS</Text>
        {e.why.map((w, i) => (
          <Row key={i} style={{ alignItems: 'flex-start' }}>
            <View style={styles.tick}><Icon name="check" size={12} color={colors.selectedFg} strokeWidth={3} /></View>
            <View style={{ flex: 1 }}><Text style={type.h3}>{w.t}</Text><Text style={type.small}>{w.s}</Text></View>
          </Row>
        ))}
        <Button label="I could do something like this" icon="host" onPress={() => navigate(paths.hostNewOffer(e.shape))} style={{ marginTop: spacing.md }} />
        <Button label="Show me another example" kind="ghost" onPress={() => navigate(paths.hostExample(next.key), { replace: true })} />
      </ScrollView>
    </View>
  );
}

/** V1 · who can come: a wedding and a skate jam are the same machinery. What differs is who can get in. */
export function LearnWho({ wide }: { wide: boolean }) {
  const { back } = useRouter();
  const rows = [
    { icon: 'locked' as const, t: 'Only people I invite', s: 'You add the names. Nobody else can see it, even with the link.', egs: ['A wedding', 'A christening'], money: 'You can collect everyone’s share — you keep none of it' },
    { icon: 'share' as const, t: 'Anyone with the link', s: 'You share it once; they pass it on. Not listed anywhere on Epic.', egs: ['A stag weekend', 'School dads up Snowdon'], money: 'Same — split costs, nobody profits' },
    { icon: 'web' as const, t: 'Anyone on Epic', s: 'Listed in Inspire and Places. Anyone can find it and book.', egs: ['A skate jam', 'A supper club'], money: 'You set a price and we pay you out' },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={[styles.body, wide && styles.wide]}>
        <Press onPress={() => back(paths.host())} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}><Row><Icon name="back" size={18} /><Text style={type.h3}>Who can come</Text></Row></Press>
        <Text style={styles.hero}>Anything you organise, for anyone you choose</Text>
        <Text style={type.body}>A wedding and a skate jam are the same machinery. What differs is who can get in.</Text>
        {rows.map((r) => (
          <View key={r.t} style={styles.who}>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={styles.wayIcon}><Icon name={r.icon} size={16} color={colors.ink} /></View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={type.h3}>{r.t}</Text>
                <Text style={type.small}>{r.s}</Text>
                <Row style={{ gap: 6, flexWrap: 'wrap' }}>{r.egs.map((x) => <View key={x} style={styles.chip}><Text style={styles.chipText}>{x}</Text></View>)}</Row>
                <Text style={[type.tiny, { color: colors.accent, fontWeight: '600' }]}>{r.money}</Text>
              </View>
            </Row>
          </View>
        ))}
        <Text style={type.small}>Public means it is public, so we check who you are, we hold the money, and we need a video — we cannot advertise a person nobody has seen. Invite-only and link-only need none of the three.</Text>
        <Button label="Got it" onPress={() => back(paths.host())} style={{ marginTop: spacing.md }} />
        <Text style={[type.tiny, { textAlign: 'center' }]}>You pick this in the set-up, and can change it</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wide: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  body: { paddingHorizontal: 20, paddingTop: spacing.md, paddingBottom: 40, gap: spacing.md },
  hero: { fontFamily: fonts.heading, fontSize: 28, fontWeight: '800', letterSpacing: -0.98, lineHeight: 32, color: colors.ink },
  tile: { flex: 1, minHeight: 64, padding: spacing.md, justifyContent: 'center' },
  tileText: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', letterSpacing: -0.3, color: INK },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: colors.inkMuted, marginTop: spacing.sm },
  way: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  wayIcon: { width: 36, height: 36, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  wayTag: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.inkMuted },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.accent, marginTop: 2 },
  note: { backgroundColor: colors.surfaceMuted, padding: spacing.md },
  eg: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  egTag: { paddingHorizontal: 7, height: 20, justifyContent: 'center', alignSelf: 'flex-start' },
  egTagText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: INK },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  chip: { paddingHorizontal: 10, height: 30, justifyContent: 'center', borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  chipText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
  quote: { borderLeftWidth: 3, borderLeftColor: LIME, paddingLeft: spacing.md },
  quoteText: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.ink },
  tick: { width: 22, height: 22, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  who: { padding: spacing.md, borderWidth: BORDER, borderColor: colors.ruleSoft },
});
