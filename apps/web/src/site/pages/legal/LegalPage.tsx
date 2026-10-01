/**
 * The legal pages — privacy, terms, cookies, accessibility, contact (Technical
 * Foundations › Legal pages): one plain reading layout on cream, the page's
 * name as its one <h1>, each section an <h2>. The words live per locale beside
 * this file and are placeholders until the owner supplies the final ones.
 *
 * Every page has at least one email form (README › Email forms), so each
 * closes with the homepage's, in the homepage's own words — the consent it
 * records is one the API already knows (sources/consentWordings.json).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CREAM, INK, fonts } from '../../../theme';
import { useViewport } from '../../../hooks/useViewport';
import type { SitePageName, SiteLocale } from '../../../routes';
import { pick } from '../../i18n';
import { SiteH1, SiteH2, SiteP } from '../../type';
import { LEGAL_STRINGS } from './LegalPage.strings';
import { InterestForm } from '../../InterestForm';
import { W2_WORDS } from '../home/W2Sorted.strings';

export function LegalPage({ locale, page }: { locale: SiteLocale; page: Exclude<SitePageName, 'host'> }) {
  const doc = pick(LEGAL_STRINGS, locale)[page];
  const join = pick(W2_WORDS, locale);
  const { width } = useViewport();
  const phone = width < 700;
  return (
    <View style={[styles.page, { paddingHorizontal: phone ? 20 : 56, paddingVertical: phone ? 36 : 72 }]}>
      <View style={styles.column}>
        <SiteH1 style={[styles.h1, phone && { fontSize: 52, lineHeight: 52 }]}>{doc.title}</SiteH1>
        {doc.sections.map((s) => (
          <View key={s.heading} style={styles.section}>
            <SiteH2 style={styles.h2}>{s.heading}</SiteH2>
            <SiteP style={[styles.body, phone && { fontSize: 17 }]}>{s.body}</SiteP>
          </View>
        ))}
        <View style={styles.section}>
          <SiteH2 style={styles.h2}>{join.planned}</SiteH2>
          <InterestForm locale={locale} source="home" label={join.formLabel} successMessage={join.success} ground="cream" maxWidth={560} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: CREAM },
  column: { maxWidth: 720, width: '100%', gap: 28 },
  h1: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 72, lineHeight: 72, letterSpacing: -3.2, color: INK },
  section: { gap: 8, borderTopWidth: 2, borderTopColor: INK, paddingTop: 16 },
  h2: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 22, color: INK },
  body: { fontFamily: fonts.body, fontSize: 18, lineHeight: 27, color: INK },
});
