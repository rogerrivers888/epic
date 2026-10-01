/**
 * W6 · Your crew, on ink (Website & Registration › W6). Leads with the crew: a
 * lime "COMING SOON" tag, "Something for everyone. At last.", the line and the
 * form on the left; five people and three of their likes each on the right.
 * The 104px headline is a styled <p> and is on screen at first paint; the page's
 * <h1> sits in the line's place beneath it (owner, 1 Oct 2026). Pills pop in one
 * by one when the crew is first seen — at rest under `prefers-reduced-motion`.
 * On a phone (MB rules) the two columns stack.
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { CREAM, DEEP_GREEN, HAIRLINE, INK, INK_RULE, LIME, LIME_TINT, MOSS, fonts } from '../../../theme';
import { useViewport } from '../../../hooks/useViewport';
import { InterestForm } from '../../InterestForm';
import { SiteH1, SiteP } from '../../type';
import { EASE, animate, onFirstView, usePrefersReducedMotion } from '../../motion';
import { pick } from '../../i18n';
import type { SitePageProps } from '../../page';
import { W6_WORDS } from './W6Crew.strings';

const PHONE = 700;
const HEADER = 84;
// Avatars are initials on brand tones, never photos; the letter takes whichever of ink or cream reads.
const AVATARS: { bg: string; fg: string }[] = [
  { bg: LIME, fg: INK },
  { bg: INK, fg: LIME },
  { bg: HAIRLINE, fg: INK },
  { bg: MOSS, fg: CREAM },
  { bg: DEEP_GREEN, fg: CREAM },
];
const POP: Keyframe[] = [
  { transform: 'scale(0)', opacity: 0 },
  { transform: 'scale(1.12)', opacity: 1, offset: 0.7 },
  { transform: 'scale(1)', opacity: 1 },
];

// Runs before paint on the web, so a pill never shows at rest and then vanishes.
const useBeforePaint = Platform.OS === 'web' ? useLayoutEffect : useEffect;

export function W6Crew({ locale, landingPage }: SitePageProps) {
  const w = pick(W6_WORDS, locale);
  const { width, height } = useViewport();
  const phone = width < PHONE;
  const reduced = usePrefersReducedMotion();

  const list = useRef<View>(null);
  const pills = useRef<(View | null)[]>([]);

  useBeforePaint(() => {
    if (reduced) return;
    // Held at scale 0 (fill: backwards) until the crew is in view, then played.
    const runs = pills.current
      .map((el, i) => animate(el, POP, { duration: 380, delay: i * 90, easing: EASE, fill: 'backwards' }))
      .filter((a): a is Animation => a !== null);
    runs.forEach((a) => a.pause());
    const stop = onFirstView(list.current, () => runs.forEach((a) => a.play()));
    return () => { stop(); runs.forEach((a) => a.cancel()); };
  }, [reduced, locale]);

  const headline = phone ? 60 : 104;
  const body = phone ? 18 : 21;
  const bodyStyle = { fontSize: body, lineHeight: Math.round(body * 1.4) };

  return (
    <View
      style={[
        styles.page,
        phone ? styles.pagePhone : [styles.pageWide, { minHeight: Math.max(0, height - HEADER) }],
      ]}
    >
      <View style={[styles.copy, !phone && { flex: 1.1 }]}>
        <View style={styles.tag}>
          <SiteP style={styles.tagText}>{w.tag}</SiteP>
        </View>
        <SiteP style={[styles.headline, { fontSize: headline, lineHeight: Math.round(headline * 0.9), letterSpacing: -headline * 0.05 }]}>
          {w.headline}
        </SiteP>
        <View style={{ gap: 10 }}>
          <SiteH1 style={[styles.line, bodyStyle]}>{w.h1}</SiteH1>
          <SiteP style={[styles.line, bodyStyle]}>{w.line}</SiteP>
        </View>
        <InterestForm
          locale={locale}
          landingPage={landingPage}
          source="home"
          label={w.cta}
          successMessage={w.success}
          ground="ink"
          maxWidth={560}
        />
      </View>

      <View ref={list} style={[styles.crew, !phone && { flex: 1 }]}>
        {w.crew.map((person, p) => {
          const tone = AVATARS[p % AVATARS.length];
          return (
            <View key={person.name} style={styles.person}>
              <View
                style={[styles.avatar, { backgroundColor: tone.bg }, tone.bg === INK && styles.avatarOnInk]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Text style={[styles.initial, { color: tone.fg }]}>{person.name.charAt(0)}</Text>
              </View>
              <View style={styles.who}>
                <Text style={styles.name}>{person.name}</Text>
                <View style={styles.pills}>
                  {person.likes.map((like, i) => (
                    <View
                      key={like}
                      ref={(el) => { pills.current[p * 3 + i] = el; }}
                      style={[styles.pill, { backgroundColor: i === 0 ? LIME : LIME_TINT }]}
                    >
                      <Text style={styles.pillText}>{like}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: INK, width: '100%' },
  pageWide: { flexDirection: 'row', alignItems: 'center', gap: 64, paddingHorizontal: 56, paddingTop: 0, paddingBottom: 56 },
  pagePhone: { flexDirection: 'column', gap: 40, paddingHorizontal: 20, paddingTop: 32, paddingBottom: 40 },
  copy: { minWidth: 0, gap: 26 },
  tag: { alignSelf: 'flex-start', borderWidth: 2, borderColor: LIME, paddingVertical: 5, paddingHorizontal: 10 },
  tagText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', letterSpacing: 1.12, textTransform: 'uppercase', color: LIME },
  headline: { fontFamily: fonts.heading, fontWeight: '800', color: LIME },
  line: { fontFamily: fonts.body, color: CREAM, maxWidth: 520 },
  crew: { minWidth: 0, borderTopWidth: 2, borderTopColor: CREAM },
  person: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: INK_RULE },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  // The ink tone on the ink ground needs an edge to be seen at all.
  avatarOnInk: { borderWidth: 2, borderColor: LIME },
  initial: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 24 },
  who: { flex: 1, minWidth: 0, gap: 8 },
  name: { fontFamily: fonts.body, fontSize: 18, fontWeight: '700', color: CREAM },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingVertical: 3, paddingHorizontal: 8 },
  pillText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: INK },
});
