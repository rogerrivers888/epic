/**
 * The frame every public page sits in (Website & Registration › Shared web
 * layout, Footer FT1): the header, the page's body, the footer. A page draws
 * only its body; this draws the rest, the same way on every page.
 *
 * The header takes the page's ground, as each design draws it — ink on cream
 * (W1, W2, the legal pages), ink on lime (W3, W5), lime on ink (W6) — and W4's
 * links float over its lime column rather than sitting in a row. The host page
 * has its own lime header: the wordmark, a rule, "FOR HOSTS", and Log in only,
 * because its wordmark is the way back. On a phone it is always the wordmark and
 * Log in (MB rules); "Become a host" moves into the page.
 *
 * The page scrolls here, not in the document: the app shell does not scroll.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CREAM, HAIRLINE, INK, INK_HOVER, INK_RULE, LIME, LIME_TINT, ON_INK_MUTED, fonts } from '../theme';
import { SiteWordmark as Wordmark } from './SiteWordmark';
import { useViewport } from '../hooks/useViewport';
import { useRouter } from '../router';
import { LIVE_SITE_LOCALES, paths, type SiteLocale, type SitePageName } from '../routes';
import { COMPANY, TRACKING_ON } from './config';
import { HTML_LANG, LOCALE_LABEL, pick, type Strings } from './i18n';
import { CookieBanner, openCookieSettings } from './CookieBanner';

export type HeaderTone = 'cream' | 'lime' | 'ink';
export type HeaderStyle = { tone: HeaderTone; left?: 'wordmark' | 'domain'; float?: boolean; host?: boolean };

const WORDS: Strings<{
  becomeHost: string; logIn: string; forHosts: string; countryLanguage: string;
  links: Record<'privacy' | 'terms' | 'cookies' | 'cookieSettings' | 'accessibility' | 'contact', string>;
  registered: string;
}> = {
  'en-gb': {
    becomeHost: 'Become a host', logIn: 'Log in', forHosts: 'For hosts', countryLanguage: 'Country and language',
    links: { privacy: 'Privacy', terms: 'Terms', cookies: 'Cookies', cookieSettings: 'Cookie settings', accessibility: 'Accessibility', contact: 'Contact' },
    registered: 'Company no. {number} · Registered office: {office}',
  },
  'en-us': {
    becomeHost: 'Become a host', logIn: 'Log in', forHosts: 'For hosts', countryLanguage: 'Country and language',
    links: { privacy: 'Privacy', terms: 'Terms', cookies: 'Cookies', cookieSettings: 'Cookie settings', accessibility: 'Accessibility', contact: 'Contact' },
    registered: 'Company no. {number} · Registered office: {office}',
  },
};

const fill = (s: string, values: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

export function SiteLayout({ locale, header, children }: { locale: SiteLocale; header: HeaderStyle; children: React.ReactNode }) {
  // The page's language for assistive tech and the browser (the server writes the
  // same into the HTML it sends, so a crawler never depends on this).
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[locale];
  }, [locale]);

  // One layout serves every public page, so its scroll view outlives a move
  // between them: a new page starts at its top, not where the footer link that
  // led there was (Codex, 1 Oct 2026). Keyed on the path, so a filter or a
  // campaign query does not jump the page.
  const { path } = useRouter();
  const scroller = useRef<ScrollView>(null);
  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: false }); }, [path]);

  return (
    <View style={styles.root}>
      <ScrollView ref={scroller} style={styles.root} contentContainerStyle={{ flexGrow: 1 }}>
        <SiteHeader locale={locale} header={header} />
        <View style={{ flexGrow: 1 }}>{children}</View>
        <SiteFooter locale={locale} />
      </ScrollView>
      {TRACKING_ON ? <CookieBanner locale={locale} /> : null}
    </View>
  );
}

function SiteHeader({ locale, header }: { locale: SiteLocale; header: HeaderStyle }) {
  const w = pick(WORDS, locale);
  const { width } = useViewport();
  const { navigate } = useRouter();
  const phone = width < 700;
  const onInk = header.tone === 'ink';
  const ink = onInk ? LIME : INK;
  const ground = header.tone === 'cream' ? CREAM : header.tone === 'lime' ? LIME : INK;

  const right = (
    <View style={[styles.headRight, phone && { gap: 0 }]}>
      {!phone && !header.host ? (
        <Pressable accessibilityRole="link" onPress={() => navigate(paths.siteHost(locale))}>
          {({ hovered }: any) => <Text style={[styles.headLink, { color: ink }, hovered && styles.underline]}>{w.becomeHost}</Text>}
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="link"
        onPress={() => navigate(paths.login())}
        style={({ hovered }: any) => [styles.logIn, { borderColor: ink }, hovered && { backgroundColor: onInk ? INK_HOVER : LIME_TINT }]}
      >
        <Text style={[styles.headLink, { color: ink }]}>{w.logIn}</Text>
      </Pressable>
    </View>
  );

  if (header.float && !phone) {
    // W4: no header row — the links sit at the top right, over the lime column.
    return <View style={styles.floatRight}>{right}</View>;
  }

  return (
    <View style={[styles.head, { backgroundColor: ground, height: phone ? 64 : 84, paddingHorizontal: phone ? 20 : 56 }]}>
      <Pressable accessibilityRole="link" accessibilityLabel="Epic" onPress={() => navigate(paths.siteHome(locale))} style={styles.headLeft}>
        {header.left === 'domain' && !phone
          ? <Text style={[styles.domain, { color: ink }]}>epic.day</Text>
          : <Wordmark height={phone ? 26 : 30} ink={ink} ground={ground} />}
        {header.host && !phone ? (
          <>
            <View style={[styles.hostRule, { backgroundColor: INK }]} />
            <Text style={styles.forHosts}>{w.forHosts}</Text>
          </>
        ) : null}
      </Pressable>
      {right}
    </View>
  );
}

function SiteFooter({ locale }: { locale: SiteLocale }) {
  const w = pick(WORDS, locale);
  const { width } = useViewport();
  const { navigate } = useRouter();
  const phone = width < 700;
  const [picking, setPicking] = useState(false);

  const page = (p: SitePageName) => () => navigate(paths.sitePage(p, locale));
  const links: { label: string; go: () => void }[] = [
    { label: w.becomeHost, go: () => navigate(paths.siteHost(locale)) },
    { label: w.logIn, go: () => navigate(paths.login()) },
    { label: w.links.privacy, go: page('privacy') },
    { label: w.links.terms, go: page('terms') },
    { label: w.links.cookies, go: page('cookies') },
    // On every page, because the cookie notice sends people to it (owner, 2 Oct
    // 2026). With the banner on it reopens the banner; while nothing tracks
    // (banner off until GA4/Ads) it opens the notice, which lists what is stored.
    { label: w.links.cookieSettings, go: TRACKING_ON ? openCookieSettings : page('cookies') },
    { label: w.links.accessibility, go: page('accessibility') },
    { label: w.links.contact, go: page('contact') },
  ];

  const choose = (to: SiteLocale) => {
    setPicking(false);
    // Remembered for a year, so epic.day/ sends them here next time (J3).
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.cookie = `epic_locale=${to}; Max-Age=31536000; Path=/; SameSite=Lax`;
    }
    if (to !== locale) navigate(paths.siteHome(to));
  };

  // The compact footer (owner, 2 Oct 2026: "a third of the size, smaller text,
  // smaller everything, and spread out across the rows"): the links run along one
  // line and wrap only where they must, each still a 44px tap target on a phone.
  const linkRow = (
    <View accessibilityRole="list" style={[styles.linkRow, phone && { columnGap: 18, rowGap: 0 }]}>
      {links.map((l) => (
        <Pressable key={l.label} accessibilityRole="link" onPress={l.go} style={[styles.footLinkCell, phone && { minHeight: 44 }]}>
          {({ hovered }: any) => <Text style={[styles.footLink, hovered && { color: LIME }]}>{l.label}</Text>}
        </Pressable>
      ))}
    </View>
  );

  const switcher = (
    <View style={{ position: 'relative', zIndex: 2, minWidth: phone ? undefined : 220 }}>
      {picking ? (
        // Opens upwards, above the box, the current choice on lime.
        <View style={styles.pickList}>
          {LIVE_SITE_LOCALES.map((l) => (
            <Pressable key={l} accessibilityRole="button" onPress={() => choose(l)} style={({ hovered }: any) => [styles.pickRow, l === locale ? { backgroundColor: LIME } : hovered && { backgroundColor: LIME_TINT }]}>
              <Text style={[styles.pickText, l === locale && { fontWeight: '800' }]}>{LOCALE_LABEL[l]}</Text>
              {l === locale ? <Tick /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${w.countryLanguage}: ${LOCALE_LABEL[locale]}`}
        accessibilityState={{ expanded: picking }}
        onPress={() => setPicking((p) => !p)}
        style={({ hovered }: any) => [styles.pickBox, hovered && { backgroundColor: INK_HOVER }]}
      >
        <Text style={styles.pickBoxText}>{LOCALE_LABEL[locale]}</Text>
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={CREAM} strokeWidth={2.4} strokeLinecap="square">
          <Path d={picking ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
        </Svg>
      </Pressable>
    </View>
  );

  const smallPrint = (
    <Text style={styles.smallPrint}>
      {COMPANY.name} · {fill(w.registered, { number: COMPANY.number, office: COMPANY.office })}
    </Text>
  );

  return (
    <View style={[styles.foot, phone ? { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20, gap: 16 } : { paddingHorizontal: 56, paddingTop: 28, paddingBottom: 20, gap: 20 }]}>
      {phone ? (
        <>
          <Wordmark height={26} ink={CREAM} ground={INK} />
          {linkRow}
          {switcher}
        </>
      ) : (
        <View style={styles.footRow}>
          <Wordmark height={28} ink={CREAM} ground={INK} />
          <View style={{ flex: 1, minWidth: 0 }}>{linkRow}</View>
          {switcher}
        </View>
      )}
      <View style={styles.smallRule}>{smallPrint}</View>
    </View>
  );
}

function Tick() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="square"><Path d="M4 12l5 5L20 6" /></Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CREAM },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 28 },
  headLink: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700' },
  underline: { textDecorationLine: 'underline' },
  logIn: { height: 44, borderWidth: 2, paddingHorizontal: 18, justifyContent: 'center' },
  domain: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700' },
  hostRule: { width: 2, height: 28 },
  forHosts: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', letterSpacing: 1.12, textTransform: 'uppercase', color: INK },
  floatRight: { position: 'absolute', top: 22, right: 56, zIndex: 3 },

  foot: { backgroundColor: INK },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 40 },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, rowGap: 6 },
  footLinkCell: { justifyContent: 'center' },
  footLink: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: CREAM },
  pickBox: { height: 36, borderWidth: 1, borderColor: ON_INK_MUTED, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 12 },
  pickBoxText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: CREAM },
  pickList: { position: 'absolute', left: 0, right: 0, bottom: 38, backgroundColor: CREAM, borderWidth: 2, borderColor: INK },
  pickRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  pickText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '500', color: INK },
  smallRule: { borderTopWidth: 1, borderTopColor: INK_RULE, paddingTop: 12 },
  smallPrint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: ON_INK_MUTED },
});
