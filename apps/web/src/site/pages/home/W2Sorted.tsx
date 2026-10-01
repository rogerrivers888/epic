/**
 * W2 · Sorted. (Website & Registration › Homepage › W2). All type: an ink
 * "COMING SOON" tag, then "Saturday, / sorted." at 168px/800 with the first line
 * a word on a lime block that changes every 2.4s, sliding up from below in
 * 520ms. Under a 2px rule, three equal columns: what it plans, hosting, the form.
 *
 * Owner overrides on the design:
 *  - the page's one <h1> is the first line of the bottom row's first column,
 *    styled as that column's copy, which stays beneath it; "COMING SOON" is a <p>;
 *  - the lime block is held at the width of its widest word, so nothing shifts;
 *  - the word loop pauses while the tab is hidden and stops for good after three
 *    passes through the list, on the first word (WCAG 2.2.2). Reduced motion
 *    shows that final state and never moves.
 *
 * Phone (<700): MB rules — 20px sides, the headline scaled to fit the widest
 * word at 390, the bottom row stacked with 2px rules between.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { CREAM, INK, LIME, fonts } from '../../../theme';
import { useViewport } from '../../../hooks/useViewport';
import { InterestForm } from '../../InterestForm';
import { SiteH1, SiteP } from '../../type';
import { EASE, animate, usePrefersReducedMotion, useTabVisible } from '../../motion';
import { pick } from '../../i18n';
import type { SitePageProps } from '../../page';
import { W2_WORDS } from './W2Sorted.strings';

const PHONE = 700;
const BODY_HEIGHT = 736; // the 1280 × 820 frame less the 84px header
const EVERY = 2400;
const PASSES = 3;
const hidden = Platform.OS === 'web' ? ({ 'aria-hidden': true } as object) : { importantForAccessibility: 'no-hide-descendants' as const };

export function W2Sorted({ locale, landingPage }: SitePageProps) {
  const w = pick(W2_WORDS, locale);
  const { width } = useViewport();
  const phone = width < PHONE;
  const reduced = usePrefersReducedMotion();
  const visible = useTabVisible();

  // `step` counts changes; the loop ends when it has been round the list PASSES times.
  const [step, setStep] = useState(0);
  const last = w.rotating.length * PASSES;
  const running = !reduced && visible && step < last;
  const word = reduced ? w.rotating[0] : w.rotating[step % w.rotating.length];
  const wordRef = useRef<Text | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setStep((s) => s + 1), EVERY);
    return () => clearTimeout(t);
  }, [running, step]);

  useEffect(() => {
    if (step === 0 || reduced) return;
    const a = animate(wordRef.current, [{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 520, easing: EASE });
    return () => a?.cancel();
  }, [step, reduced]);

  // 168px at 1280; on a phone, as large as lets the widest word fit (README: closing headlines 60px).
  const size = phone ? Math.min(60, Math.floor((width - 40 - 44) / 7)) : Math.min(168, Math.floor((Math.min(width, 1280) - 112 - 44) / 6.7));
  const big = { fontSize: size, letterSpacing: -size * 0.055, lineHeight: Math.round(size * 0.88) };
  // The design's 14px under the word, plus what Archivo's descender needs below
  // a 0.88 line box (about 0.11em), so the "y" of birthday is never trimmed by
  // the band's own mask — the mask is there for the word sliding up.
  const tail = Math.round(size * 0.11);
  const pad = phone ? { paddingTop: 4, paddingBottom: 8 + tail, paddingHorizontal: 12, marginLeft: -12 } : { paddingTop: 6, paddingBottom: 14 + tail, paddingHorizontal: 22, marginLeft: -22 };

  return (
    <View style={[styles.page, !phone && styles.pageWide]}>
      <View style={[styles.hero, phone ? styles.heroPhone : styles.heroWide]}>
        <SiteP style={styles.tag}>{w.comingSoon}</SiteP>
        <View style={styles.headline}>
          <View style={[styles.block, pad]}>
            {/* Every word, laid out at no height: the block takes the widest and never resizes. */}
            {w.rotating.map((r) => (
              <View key={r} style={styles.sizer} {...hidden}>
                <Text style={[styles.big, big, styles.nowrap]}>{r}</Text>
              </View>
            ))}
            <Text ref={wordRef} style={[styles.big, big, styles.nowrap]}>{word}</Text>
          </View>
          <Text style={[styles.big, big]}>{w.sorted}</Text>
        </View>
      </View>

      <View style={styles.rule}>
        <View style={[styles.bottom, phone ? styles.bottomPhone : styles.bottomWide]}>
          <View style={[styles.cell, phone ? styles.cellPhone : [styles.cellWide, styles.first]]}>
            <SiteH1 style={[styles.copy, phone && styles.copyPhone]}>{w.h1}</SiteH1>
            <SiteP style={[styles.copy, phone && styles.copyPhone]}>{w.planned}</SiteP>
          </View>
          <View style={[styles.cell, phone ? [styles.cellPhone, styles.ruleTop] : [styles.cellWide, styles.middle]]}>
            <SiteP style={[styles.copy, phone && styles.copyPhone]}>{w.host}</SiteP>
          </View>
          <View style={[styles.cell, styles.formCell, phone ? [styles.cellPhone, styles.ruleTop] : [styles.cellWide, styles.last]]}>
            <InterestForm locale={locale} source="home" label={w.formLabel} successMessage={w.success} variant="stacked" ground="cream" landingPage={landingPage} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: CREAM },
  pageWide: { minHeight: BODY_HEIGHT },
  hero: { width: '100%', maxWidth: 1280, alignSelf: 'center', justifyContent: 'center', gap: 22 },
  heroWide: { flex: 1, paddingHorizontal: 56, paddingVertical: 40 },
  heroPhone: { paddingHorizontal: 20, paddingVertical: 40 },
  tag: {
    alignSelf: 'flex-start', backgroundColor: INK, color: CREAM, fontFamily: fonts.body, fontSize: 14, fontWeight: '700',
    letterSpacing: 1.12, textTransform: 'uppercase', paddingVertical: 6, paddingHorizontal: 10,
  },
  headline: { alignItems: 'flex-start' },
  block: { backgroundColor: LIME, overflow: 'hidden' },
  // One line, as the design's `white-space: nowrap` — not numberOfLines, which on
  // the web also clips the text to its 0.88 line box and cut the descenders off.
  nowrap: { whiteSpace: 'nowrap' } as object,
  sizer: { height: 0, overflow: 'hidden' },
  big: { fontFamily: fonts.heading, fontWeight: '800', color: INK, ...(Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as object) : {}) },
  rule: { borderTopWidth: 2, borderTopColor: INK },
  bottom: { width: '100%', maxWidth: 1280, alignSelf: 'center' },
  bottomWide: { flexDirection: 'row' },
  bottomPhone: {},
  cell: { gap: 10 },
  cellWide: { flex: 1, minWidth: 0 },
  cellPhone: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 },
  first: { paddingTop: 24, paddingRight: 32, paddingBottom: 32, paddingLeft: 56, borderRightWidth: 2, borderRightColor: INK },
  middle: { paddingTop: 24, paddingHorizontal: 32, paddingBottom: 32, borderRightWidth: 2, borderRightColor: INK },
  last: { paddingTop: 20, paddingRight: 56, paddingBottom: 28, paddingLeft: 32 },
  formCell: { justifyContent: 'center' },
  ruleTop: { borderTopWidth: 2, borderTopColor: INK },
  copy: { fontFamily: fonts.body, fontSize: 20, fontWeight: '600', lineHeight: 27, color: INK },
  copyPhone: { fontSize: 18, lineHeight: 24 },
});
