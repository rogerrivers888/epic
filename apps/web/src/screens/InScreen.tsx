/**
 * Set your credentials (L4), epic.day/in/<token> — where a staff invitation and
 * a password reset land (Website & Registration › L4). Public and noindex: the
 * single-use link in the address is the credential.
 *
 *  - **Invite** — "Set up your login, {first name}." The address is fixed; they
 *    either use Google with that address or set a password.
 *  - **Reset** — "Choose a new password." Password only. Saving signs every
 *    other device out (the API does that).
 *
 * Saving uses the link up and signs them in; they land where their role can
 * open, exactly as the other doors land them. A spent or expired link says so in
 * one line and offers the way back to log in.
 */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CREAM, INK, INK_HOVER, INK_MUTED, LIME, LIME_TINT, MOSS, HAIRLINE, fonts } from '../theme';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { useRouter } from '../router';
import { paths } from '../routes';
import { API_URL, api, ApiError, type CredentialsLink } from '../api';
import { firstAdminScreen } from '../admin/AdminApp';

const MIN = 10;

export function InScreen({ token }: { token: string }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, query } = useRouter();
  // Google came back with a different address than the one invited (authGoogle.js).
  const googleAs = query.get('e') === 'google-mismatch' ? query.get('as') : null;
  const googleFailed = query.get('e') === 'failed';
  const [link, setLink] = useState<CredentialsLink | null>(null);
  const [spent, setSpent] = useState(false);
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoadErr(null);
    // Only the API saying so makes a link spent; a dropped connection, a 429 or a
    // 500 is "try again", never "ask for a new one" (Codex, 1 Oct 2026).
    api.credentialsLink(token).then((l) => { if (live) setLink(l); }).catch((e) => {
      if (!live) return;
      if (e instanceof ApiError && e.status === 404) setSpent(true);
      else setLoadErr(e instanceof ApiError && e.status === 429 ? 'Too many tries just now. Wait a few minutes, then try again.' : 'Could not reach Epic. Check your connection and try again.');
    });
    return () => { live = false; };
  }, [token, attempt]);

  const long = pw.length >= MIN;
  const invite = link?.mode === 'invite';

  const save = async () => {
    if (busy) return;
    if (!long) { setErr('Use at least 10 characters.'); return; }
    setErr(null); setBusy(true);
    try {
      const st = await api.setCredentials(token, pw);
      const screen = firstAdminScreen(st.access);
      navigate(st.access?.doors?.includes('admin')
        ? (screen === 'filing' ? paths.filing('categories') : paths.admin(screen))
        : paths.account(), { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'too_short') setErr('Use at least 10 characters.');
      else if (e instanceof ApiError && e.code === 'link_spent') setSpent(true);
      else setErr('Could not reach Epic. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  // Google with the invited address — an external hand-off to the API's OIDC
  // flow, carrying the invitation so the API can check Google returns the
  // address invited and spend the link only then.
  const useGoogle = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    window.location.assign(`${API_URL}/api/auth/google?invite=${encodeURIComponent(token)}`);
  };

  const title = spent ? 'That link has been used.' : loadErr && !link ? "We couldn't open that link." : !link ? '' : invite ? `Set up your login${link.firstName ? `, ${link.firstName}` : ''}.` : 'Choose a new password.';

  return (
    <View style={[styles.root, wide && { flexDirection: 'row' }]}>
      <ScrollView style={{ flex: 1, backgroundColor: CREAM }} contentContainerStyle={[styles.left, wide && { paddingHorizontal: 64 }]} keyboardShouldPersistTaps="handled">
        <Wordmark height={30} ink={INK} ground={CREAM} />
        <View style={styles.body}>
          {title ? <Text style={[styles.h1, !wide && { fontSize: 46, lineHeight: 46 }]} {...(Platform.OS === 'web' ? ({ role: 'heading', 'aria-level': 1 } as object) : {})}>{title}</Text> : null}
          {spent ? (
            <View style={styles.rule}>
              <Text style={styles.copy}>It works once, and only for a while. Ask for a new one from the log-in page.</Text>
              <Pressable accessibilityRole="link" onPress={() => navigate(paths.login(), { replace: true })}>
                {({ hovered }: any) => <Text style={[styles.action, hovered && { color: MOSS }]}>Back to log in</Text>}
              </Pressable>
            </View>
          ) : loadErr ? (
            <View style={styles.rule}>
              <Text style={styles.copy} accessibilityLiveRegion="polite">{loadErr}</Text>
              <Pressable accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)}>
                {({ hovered }: any) => <Text style={[styles.action, hovered && { color: MOSS }]}>Try again</Text>}
              </Pressable>
            </View>
          ) : link ? (
            <>
              <View style={styles.as}>
                <Text style={styles.asLabel}>You'll log in as</Text>
                <Text style={styles.asEmail}>{link.email}</Text>
              </View>
              {invite && Platform.OS === 'web' ? (
                <>
                  <Pressable accessibilityRole="button" onPress={useGoogle} style={({ hovered }: any) => [styles.google, hovered && { backgroundColor: LIME_TINT }]}>
                    <GoogleG />
                    <Text style={styles.googleLabel}>Use Google instead</Text>
                  </Pressable>
                  {googleAs ? <Text style={styles.error} accessibilityLiveRegion="polite">That Google account is {googleAs}. Use {link.email}, or set a password instead.</Text>
                    : googleFailed ? <Text style={styles.error} accessibilityLiveRegion="polite">Sorry — we couldn't sign you in with Google. Try again, or set a password instead.</Text> : null}
                  <View style={styles.or}><View style={styles.orRule} /><Text style={styles.orText}>or set a password</Text><View style={styles.orRule} /></View>
                </>
              ) : null}
              <View style={{ gap: 10 }}>
                <Text style={styles.label}>{invite ? 'Password' : 'New password'}</Text>
                <View style={styles.pwBox}>
                  <TextInput
                    value={pw}
                    onChangeText={(t) => { setPw(t); if (err) setErr(null); }}
                    onSubmitEditing={save}
                    secureTextEntry={!show}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel={invite ? 'Password' : 'New password'}
                    {...(Platform.OS === 'web' ? ({ autoComplete: 'new-password' } as object) : {})}
                    style={[styles.pwInput, Platform.OS === 'web' && ({ outlineWidth: 0 } as object)]}
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow((s) => !s)} style={({ hovered }: any) => [styles.toggle, hovered && { backgroundColor: LIME_TINT }]}>
                    <Text style={styles.toggleText}>{show ? 'Hide' : 'Show'}</Text>
                  </Pressable>
                </View>
                {/* The one rule, live: grey with a dash until long enough, then moss with a tick. */}
                <View style={styles.ruleLine}>
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={long ? MOSS : INK_MUTED} strokeWidth={3} strokeLinecap="square"><Path d={long ? 'M4 12l5 5L20 6' : 'M5 12h14'} /></Svg>
                  <Text style={[styles.ruleText, { color: long ? MOSS : INK_MUTED }]}>At least 10 characters</Text>
                </View>
                {err ? <Text style={styles.error} accessibilityLiveRegion="polite">{err}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={({ hovered }: any) => [styles.cta, hovered && { backgroundColor: INK_HOVER }]}>
                  <Text style={styles.ctaText}>Save and log in</Text>
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={CREAM} strokeWidth={2.4} strokeLinecap="square"><Path d="M5 12h14M13 6l6 6-6 6" /></Svg>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
      {wide ? (
        <View style={styles.right}>
          <View style={styles.grid}>{TILES.map((bg, i) => <View key={i} style={[styles.tile, { backgroundColor: bg }]} />)}</View>
          <View style={styles.band}><Text style={styles.bandText}>Every place worth going.</Text></View>
        </View>
      ) : null}
    </View>
  );
}

function GoogleG() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z" />
      <Path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z" />
      <Path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </Svg>
  );
}

const TILES = [MOSS, INK, HAIRLINE, LIME, INK, HAIRLINE, LIME, MOSS, INK, HAIRLINE, MOSS, LIME];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CREAM },
  left: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 48, gap: 24 },
  body: { flex: 1, justifyContent: 'center', gap: 22, maxWidth: 460, width: '100%' },
  h1: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 64, lineHeight: 61, letterSpacing: -2.9, color: INK },
  as: { borderTopWidth: 2, borderTopColor: INK, borderBottomWidth: 1, borderBottomColor: HAIRLINE, paddingVertical: 12, gap: 2 },
  asLabel: { fontFamily: fonts.body, fontSize: 13, color: INK_MUTED },
  asEmail: { fontFamily: fonts.body, fontSize: 18, fontWeight: '700', color: INK },
  google: { height: 58, borderWidth: 2, borderColor: INK, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18 },
  googleLabel: { fontFamily: fonts.body, fontSize: 17, fontWeight: '700', color: INK },
  or: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  orRule: { flex: 1, height: 2, backgroundColor: INK },
  orText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: INK },
  label: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: INK },
  pwBox: { flexDirection: 'row', borderWidth: 2, borderColor: INK, backgroundColor: CREAM },
  pwInput: { flex: 1, minWidth: 0, height: 50, paddingHorizontal: 18, fontFamily: fonts.body, fontSize: 18, color: INK },
  toggle: { paddingHorizontal: 16, justifyContent: 'center', borderLeftWidth: 2, borderLeftColor: INK },
  toggleText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: INK },
  ruleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600' },
  error: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: MOSS },
  cta: { height: 58, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 6 },
  ctaText: { fontFamily: fonts.body, fontSize: 17, fontWeight: '700', color: CREAM },
  rule: { borderTopWidth: 2, borderTopColor: INK, paddingTop: 16, gap: 14 },
  copy: { fontFamily: fonts.body, fontSize: 19, lineHeight: 27, color: INK },
  action: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: INK },
  right: { flex: 1, backgroundColor: LIME, position: 'relative', overflow: 'hidden' },
  grid: { position: 'absolute', top: -1.5, left: -1.5, right: -1.5, bottom: -1.5, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: CREAM },
  tile: { width: '33.3333%', height: '25%', borderWidth: 1.5, borderColor: CREAM },
  band: { position: 'absolute', left: 0, right: 0, top: '50%', transform: [{ translateY: -52 }], backgroundColor: LIME, paddingVertical: 30, paddingHorizontal: 40 },
  bandText: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 44, letterSpacing: -1.76, lineHeight: 44, color: INK },
});
