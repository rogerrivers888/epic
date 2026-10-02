/**
 * "Register your interest" — the one email form every public page carries
 * (Website & Registration › Registration). It behaves the same everywhere:
 *
 *  - an email field and a button joined in one 2px box: side by side (`inline`)
 *    or one over the other (`stacked`); always stacked on a phone (MB rules);
 *  - validated on submit only, with one line under the box;
 *  - on success the form is replaced in place by a tick and the page's message;
 *  - a repeat sign-up is answered as a success, so the form never says who has
 *    already signed up.
 *
 * It sends what the waitlist needs to judge a campaign — the page's locale, the
 * landing page, the referrer, the UTM tags, gclid/fbclid — and the words the
 * person agreed to: the button they pressed is the consent (UK PECR). A hidden
 * honeypot field catches bots; whatever fills it is thanked and kept nowhere.
 *
 * Two looks. `boxed` (the default) is the one above. `flat` is the homepage v3's
 * (approved 2 Oct 2026): no border — a cream field and an ink button on lime, a
 * dark field and a lime button on ink; on a phone the field and the button are
 * two blocks 6px apart; the success line replaces the form with no tick.
 */
import React, { useId, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CREAM, INK, INK_FIELD, INK_HOVER, LIME, LIME_HOVER, LIME_TINT, MOSS, PLACEHOLDER, PLACEHOLDER_ON_INK, fonts } from '../theme';
import { api, type InterestSignup } from '../api';
import { type SiteLocale } from '../routes';
import { useRouter } from '../router';
import { useViewport } from '../hooks/useViewport';
import { pick, type Strings } from './i18n';

export type HostKind = NonNullable<InterestSignup['hostKind']>;
export type FormGround = 'cream' | 'lime' | 'ink';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const WORDS: Strings<{ placeholder: string; bad: string; failed: string }> = {
  'en-gb': { placeholder: 'Your email', bad: "That email doesn't look right.", failed: "That didn't go through. Try again in a moment." },
  'en-us': { placeholder: 'Your email', bad: "That email doesn't look right.", failed: "That didn't go through. Try again in a moment." },
};

export function InterestForm({
  locale, source, label, successMessage, variant = 'inline', ground = 'cream', hostKind = null, landingPage = null, maxWidth = 520, look = 'boxed', gap = 10,
}: {
  locale: SiteLocale;
  source: 'home' | 'host';
  /** The button's words, as drawn on this page ("Remind me", "Count me in" …). */
  label: string;
  /** What replaces the form once they're on the list. */
  successMessage: string;
  variant?: 'inline' | 'stacked';
  ground?: FormGround;
  hostKind?: HostKind | null;
  /** The campaign landing page this form sits on (`/go/{name}`), recorded on the sign-up. */
  landingPage?: string | null;
  maxWidth?: number;
  /** `flat` is the homepage v3's borderless form (see above); `boxed` everywhere else. */
  look?: 'boxed' | 'flat';
  /** Flat look only: the space between the form and its error line (the page's own gap). */
  gap?: number;
}) {
  const w = pick(WORDS, locale);
  const { query } = useRouter();
  const { width } = useViewport();
  const stacked = variant === 'stacked' || width < 700;
  const onInk = ground === 'ink';

  const [email, setEmail] = useState('');
  const [trap, setTrap] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [focused, setFocused] = useState(false);
  // Two forms on one page (the homepage's hero and close) each need their own id.
  const errId = `interest-err-${source}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const submit = async () => {
    if (busy) return;
    const value = email.trim();
    if (!EMAIL.test(value)) { setErr(w.bad); return; }
    setErr(null); setBusy(true);
    const q = (k: string) => query.get(k) || null;
    try {
      await api.registerInterest({
        email: value, source, hostKind, locale, landingPage,
        referrer: Platform.OS === 'web' && typeof document !== 'undefined' ? document.referrer || null : null,
        utmSource: q('utm_source'), utmMedium: q('utm_medium'), utmCampaign: q('utm_campaign'),
        utmTerm: q('utm_term'), utmContent: q('utm_content'), gclid: q('gclid'), fbclid: q('fbclid'),
        consentWording: `${label} — ${successMessage}`,
        website: trap,
      });
      setDone(true);
    } catch {
      setErr(w.failed);
    } finally { setBusy(false); }
  };

  const ink = onInk ? CREAM : INK;
  const errColor = ground === 'cream' ? MOSS : ground === 'lime' ? INK : LIME;
  const focusRing = Platform.OS === 'web'
    ? (stacked ? ({ backgroundColor: onInk ? 'transparent' : LIME_TINT } as object) : ({ boxShadow: `inset 0 -4px 0 ${onInk ? LIME : INK}` } as object))
    : null;

  if (look === 'flat') {
    const h = stacked ? 54 : 58;
    const field = onInk ? INK_FIELD : CREAM;
    const accent = onInk ? LIME : INK;
    if (done) {
      return (
        <View style={[stacked ? null : styles.flatDone, { maxWidth }]} accessibilityLiveRegion="polite">
          <Text style={[styles.doneText, { color: accent, fontSize: stacked ? 17 : 19 }]}>{successMessage}</Text>
        </View>
      );
    }
    return (
      <View style={{ gap, maxWidth, width: '100%' }}>
        <View style={stacked ? { gap: 6 } : { flexDirection: 'row', backgroundColor: field }}>
          <TextInput
            value={email}
            onChangeText={(t) => { setEmail(t); if (err) setErr(null); }}
            onSubmitEditing={submit}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={w.placeholder}
            placeholderTextColor={onInk ? PLACEHOLDER_ON_INK : PLACEHOLDER}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={w.placeholder}
            {...(Platform.OS === 'web' ? ({ autoComplete: 'email', 'aria-describedby': err ? errId : undefined } as object) : {})}
            style={[
              styles.input,
              { color: onInk ? CREAM : INK, height: h, paddingHorizontal: stacked ? 16 : 18, fontSize: stacked ? 17 : 18 },
              stacked ? { backgroundColor: field } : { flex: 1, minWidth: 0 },
              focused && Platform.OS === 'web' && ({ boxShadow: `inset 0 -3px 0 ${accent}` } as object),
              Platform.OS === 'web' && ({ outlineWidth: 0 } as object),
            ]}
          />
          {/* The honeypot, as in the boxed look. */}
          <TextInput
            value={trap}
            onChangeText={setTrap}
            style={styles.trap}
            {...(Platform.OS === 'web' ? ({ tabIndex: -1, 'aria-hidden': true, autoComplete: 'off', name: 'website' } as object) : {})}
          />
          <Pressable
            onPress={submit}
            disabled={busy}
            accessibilityRole="button"
            style={({ hovered }: any) => [
              styles.button,
              { height: h, paddingHorizontal: stacked ? 18 : 20, backgroundColor: onInk ? (hovered ? LIME_HOVER : LIME) : (hovered ? INK_HOVER : INK) },
              stacked ? { justifyContent: 'space-between' } : { gap: 24, flexShrink: 0 },
            ]}
          >
            <Text style={[styles.buttonText, { color: onInk ? INK : CREAM, fontSize: stacked ? 16 : 17 }]}>{label}</Text>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={onInk ? INK : CREAM} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 12h14M13 6l6 6-6 6" /></Svg>
          </Pressable>
        </View>
        {err ? (
          <Text nativeID={errId} style={[styles.err, { color: accent, fontSize: stacked ? 14 : 15 }]} accessibilityLiveRegion="polite">{err}</Text>
        ) : null}
      </View>
    );
  }

  if (done) {
    return (
      <View style={[styles.done, { borderTopColor: ink, maxWidth }]} accessibilityLiveRegion="polite">
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth={3} strokeLinecap="square"><Path d="M4 12l5 5L20 6" /></Svg>
        <Text style={[styles.doneText, { color: ink }]}>{successMessage}</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 10, maxWidth, width: '100%' }}>
      <View style={[styles.box, { borderColor: ink, flexDirection: stacked ? 'column' : 'row', backgroundColor: onInk ? 'transparent' : CREAM }]}>
        <TextInput
          value={email}
          onChangeText={(t) => { setEmail(t); if (err) setErr(null); }}
          onSubmitEditing={submit}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={w.placeholder}
          placeholderTextColor={onInk ? '#9B9797' : '#8a8685'}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={w.placeholder}
          {...(Platform.OS === 'web' ? ({ autoComplete: 'email', 'aria-describedby': err ? errId : undefined } as object) : {})}
          style={[
            styles.input,
            { color: ink, height: stacked ? 56 : 58 },
            stacked && { borderBottomWidth: 2, borderBottomColor: ink },
            !stacked && { flex: 1, minWidth: 0 },
            focused && focusRing,
            Platform.OS === 'web' && ({ outlineWidth: 0 } as object),
          ]}
        />
        {/* The honeypot: invisible to people and to screen readers, filled only by bots. */}
        <TextInput
          value={trap}
          onChangeText={setTrap}
          style={styles.trap}
          {...(Platform.OS === 'web' ? ({ tabIndex: -1, 'aria-hidden': true, autoComplete: 'off', name: 'website' } as object) : {})}
        />
        <Pressable
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          style={({ hovered }: any) => [
            styles.button,
            { height: stacked ? 56 : 58, backgroundColor: onInk ? (hovered ? LIME_HOVER : LIME) : (hovered ? INK_HOVER : INK) },
            stacked ? { justifyContent: 'space-between' } : { gap: 24 },
          ]}
        >
          <Text style={[styles.buttonText, { color: onInk ? INK : CREAM }]}>{label}</Text>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={onInk ? INK : CREAM} strokeWidth={2.4} strokeLinecap="square"><Path d="M5 12h14M13 6l6 6-6 6" /></Svg>
        </Pressable>
      </View>
      {err ? (
        <Text nativeID={errId} style={[styles.err, { color: errColor }]} accessibilityLiveRegion="polite">{err}</Text>
      ) : null}
      {/* No privacy link under the box (owner, 2 Oct 2026: "We've already got privacy.
          We don't need to say it under every email box") — it is in the footer. */}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 2 },
  input: { paddingHorizontal: 18, fontFamily: fonts.body, fontSize: 18, backgroundColor: 'transparent' },
  trap: { position: 'absolute', left: -10000, width: 1, height: 1, opacity: 0 },
  button: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  buttonText: { fontFamily: fonts.body, fontSize: 17, fontWeight: '700' },
  err: { fontFamily: fonts.body, fontSize: 15, fontWeight: '700' },
  done: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, borderTopWidth: 2, paddingTop: 14 },
  flatDone: { minHeight: 58, justifyContent: 'center' },
  doneText: { fontFamily: fonts.body, fontSize: 20, fontWeight: '700', flexShrink: 1 },
});
