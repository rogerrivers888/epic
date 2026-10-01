/**
 * W5 · Lime poster (Website & Registration › W5). The quietest homepage: full
 * lime, the wordmark at 440px, then one ruled row — "Coming soon.", the line,
 * and the stacked form. The wordmark is not the heading; the page's <h1> sits in
 * the middle column with the design's own line under it (owner, 1 Oct 2026).
 * On a phone (MB rules) the row stacks and the wordmark drops to about 96px.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { INK, LIME, fonts } from '../../../theme';
import { SiteWordmark as Wordmark } from '../../SiteWordmark';
import { useViewport } from '../../../hooks/useViewport';
import { InterestForm } from '../../InterestForm';
import { SiteH1, SiteP } from '../../type';
import { pick } from '../../i18n';
import type { SitePageProps } from '../../page';
import { W5_WORDS } from './W5Poster.strings';

const PHONE = 700;
const HEADER = 84;
// The word "Epic" sets about 1.8em wide; below 1280 the 440px mark shrinks to fit.
const WORD_EMS = 1.8;

export function W5Poster({ locale, landingPage }: SitePageProps) {
  const w = pick(W5_WORDS, locale);
  const { width, height } = useViewport();
  const phone = width < PHONE;

  const typeSize = phone ? 96 : Math.min(440, Math.floor((width - 80) / WORD_EMS));
  // Wordmark's `height` is its type size ÷ 1.05.
  const markHeight = Math.round(typeSize / 1.05);
  const body = phone ? 18 : 20;

  return (
    <View style={[styles.page, !phone && { minHeight: Math.max(0, height - HEADER) }]}>
      <View style={[styles.stage, phone ? styles.stagePhone : styles.stageWide]}>
        <Wordmark height={markHeight} ink={INK} ground={LIME} />
      </View>

      <View style={[styles.row, { flexDirection: phone ? 'column' : 'row' }]}>
        <View style={[phone ? styles.cellPhone : [styles.cell, styles.ruleRight, { paddingLeft: 56 }]]}>
          <SiteP style={styles.soon}>{w.comingSoon}</SiteP>
        </View>
        <View style={[phone ? [styles.cellPhone, styles.ruleTop] : [styles.cell, styles.ruleRight], { gap: 10 }]}>
          <SiteH1 style={[styles.line, { fontSize: body, lineHeight: Math.round(body * 1.35) }]}>{w.h1}</SiteH1>
          <SiteP style={[styles.line, { fontSize: body, lineHeight: Math.round(body * 1.35) }]}>{w.line}</SiteP>
        </View>
        <View style={phone ? [styles.cellPhone, styles.ruleTop] : styles.formCell}>
          <InterestForm
            locale={locale}
            landingPage={landingPage}
            source="home"
            label={w.cta}
            successMessage={w.success}
            variant="stacked"
            ground="lime"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: LIME, width: '100%' },
  stage: { flexGrow: 1, justifyContent: 'center', overflow: 'hidden' },
  // The design's 110px top pad, less the extra half-leading Wordmark's 1.15 line box adds over the poster's 0.8.
  stageWide: { paddingHorizontal: 40, paddingTop: 33, paddingBottom: 0 },
  stagePhone: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 20 },
  row: { borderTopWidth: 2, borderTopColor: INK },
  cell: { flex: 1, minWidth: 0, paddingTop: 24, paddingRight: 32, paddingBottom: 32, paddingLeft: 32 },
  formCell: { flex: 1, minWidth: 0, paddingTop: 20, paddingRight: 56, paddingBottom: 28, paddingLeft: 32, justifyContent: 'center' },
  cellPhone: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 },
  ruleRight: { borderRightWidth: 2, borderRightColor: INK },
  ruleTop: { borderTopWidth: 2, borderTopColor: INK },
  soon: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 44, letterSpacing: -1.54, lineHeight: 44, color: INK },
  line: { fontFamily: fonts.body, fontWeight: '600', color: INK },
});
