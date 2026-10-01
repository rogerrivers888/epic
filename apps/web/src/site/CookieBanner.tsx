/**
 * The cookie banner — CK3, ink, on every page whatever its ground (owner, 1 Oct
 * 2026: CK3 only, two equal buttons, no Choose panel). Pinned to the bottom of
 * the viewport, full width, so it never covers the page's headline. "Accept all"
 * and "Reject all" are the same lime button on purpose: neither is the easy one.
 * "Cookie settings" in the footer brings it back (`openCookieSettings`).
 *
 * Drawn only when GA4 or Ads is set up (SiteLayout checks TRACKING_ON).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CREAM, INK, LIME, LIME_HOVER, fonts } from '../theme';
import { useViewport } from '../hooks/useViewport';
import { useRouter } from '../router';
import { paths, type SiteLocale } from '../routes';
import { pick, type Strings } from './i18n';
import { readConsent, startTracking, writeConsent } from './consent';

const WORDS: Strings<{ title: string; body: string; policy: string; accept: string; reject: string }> = {
  'en-gb': {
    title: 'Cookies on Epic',
    body: "We'd like to use Google cookies to see how people use epic.day and to measure our ads. Essential cookies are always on.",
    policy: 'Cookie policy', accept: 'Accept all', reject: 'Reject all',
  },
  'en-us': {
    title: 'Cookies on Epic',
    body: "We'd like to use Google cookies to see how people use epic.day and to measure our ads. Essential cookies are always on.",
    policy: 'Cookie policy', accept: 'Accept all', reject: 'Reject all',
  },
};

const listeners = new Set<() => void>();
/** Reopen the banner — the footer's "Cookie settings". */
export const openCookieSettings = () => listeners.forEach((f) => f());

export function CookieBanner({ locale }: { locale: SiteLocale }) {
  const w = pick(WORDS, locale);
  const { width } = useViewport();
  const { navigate } = useRouter();
  const phone = width < 700;
  const [open, setOpen] = useState(() => readConsent() == null);

  useEffect(() => { startTracking(); }, []);
  useEffect(() => { const f = () => setOpen(true); listeners.add(f); return () => { listeners.delete(f); }; }, []);

  if (!open) return null;
  const choose = (granted: boolean) => { writeConsent(granted ? 'granted' : 'denied'); setOpen(false); };

  const button = (label: string, granted: boolean) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      onPress={() => choose(granted)}
      style={({ hovered }: any) => [styles.button, phone ? { flex: 1 } : { width: 190 }, { backgroundColor: hovered ? LIME_HOVER : LIME }]}
    >
      <Text style={styles.buttonText}>{label}</Text>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="square"><Path d="M5 12h14M13 6l6 6-6 6" /></Svg>
    </Pressable>
  );

  return (
    <View
      accessibilityRole={'dialog' as never}
      accessibilityLabel={w.title}
      style={[styles.bar, phone ? styles.barPhone : styles.barWide]}
    >
      <View style={[styles.copy, !phone && { maxWidth: 720, flexShrink: 1 }]}>
        <Text style={[styles.title, phone && { fontSize: 22 }]}>{w.title}</Text>
        <Text style={[styles.body, phone && { fontSize: 15 }]}>
          {w.body}{' '}
          <Text accessibilityRole="link" style={styles.link} onPress={() => navigate(paths.sitePage('cookies', locale))}>{w.policy}</Text>
        </Text>
      </View>
      <View style={[styles.buttons, phone && { width: '100%' }]}>
        {button(w.accept, true)}
        {button(w.reject, false)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: INK, borderTopWidth: 2, borderTopColor: CREAM, zIndex: 50 },
  barWide: { paddingTop: 26, paddingBottom: 28, paddingHorizontal: 56, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 },
  barPhone: { paddingTop: 20, paddingBottom: 24, paddingHorizontal: 20, gap: 16 },
  copy: { gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: 24, fontWeight: '800', color: CREAM },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: CREAM },
  link: { fontWeight: '700', textDecorationLine: 'underline', color: CREAM },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  buttonText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: INK },
});
