/**
 * Log in — epic.day/login (Website & Registration v2, L1 and L2).
 *
 * One door for customers and staff: Log in with Google, or email + password.
 * Where you land is decided by the account's role, never here and never by the
 * e-mail's domain — staff to the first back-office screen their role opens,
 * customers to their account page. Wrong email and wrong password are one line
 * ("Wrong email or password."), and "Forgot your password?" (L2, `?step=forgot`)
 * answers the same whether or not the address has an account, so neither can
 * be used to find out who Epic's customers are.
 *
 * Google is staff only until launch — the API decides, and bounces anyone else
 * back here with `?e=no-account`. The e-mail link (`?step=link`) stays a way in
 * until the owner has signed in with Google and lifted the hold (owner, 1 Oct
 * 2026); then it goes.
 *
 * A fixed-light design, like the opening and the navigation band: cream ground,
 * ink type, the one lime field on the right. Its colours are the pack's brand
 * constants rather than palette tokens, because it does not follow the app's
 * light/dark setting.
 */

import { insetBottom, insetLeft, insetRight, insetTop } from '../insets';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import { Icon } from '../components/Icon';
import Svg, { Path } from 'react-native-svg';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { useRouter } from '../router';
import { paths } from '../routes';
import { firstAdminScreen } from '../admin/AdminApp';
import { useSession } from '../hooks/useSession';
import { rememberNext } from '../afterSignIn';
import { API_URL, api, ApiError } from '../api';
import { CREAM, INK, LIME, LIME_TINT, MOSS, fonts, HAIRLINE } from '../theme';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Only an in-app path is a safe place to land after sign-in: one leading slash,
 * then never a second (`//host`), and no backslash, whitespace or control
 * character anywhere — a browser drops a newline and reads "\\" as "/", so
 * "/\\host" or "/%0A/host" would resolve cross-origin and throw in
 * history.replaceState after a successful exchange (Codex, 1 Oct 2026).
 */
export const safeNext = (value?: string | null) => {
  const s = String(value || '');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f\\#]/.test(s)) return null; // `#`: a fragment is never a page, and would hide a sign-in door
  if (!/^\/[^/]/.test(s)) return null;
  // Never back into a sign-in door, and never carrying a credential: a crafted
  // `next=/login?code=…` or `…?signin=…` would spend somebody else's handoff
  // right after this person signed in and swap their session (login CSRF;
  // Codex, 1 Oct 2026).
  const [path, query = ''] = s.split('?');
  // No dot segment: a browser resolves `/x/../login` (or `%2e%2e`) to /login.
  let segs: string[];
  try { segs = path.split('/').filter(Boolean).map((x) => decodeURIComponent(x).toLowerCase()); } catch { return null; }
  if (segs.some((x) => x === '.' || x === '..')) return null;
  if (segs[0] === 'login' || segs[0] === 'in') return null;
  const q = new URLSearchParams(query);
  if (q.has('code') || q.has('signin')) return null;
  return s;
};

/** The one heading on the page, said as one on the web. */
const H1 = Platform.OS === 'web' ? ({ role: 'heading', 'aria-level': 1 } as object) : {};

export function LoginScreen() {
  const { width } = useViewport();
  const wide = width >= 900;
  // How the page is set travels in the query (routes.ts): `?e=` why the API
  // bounced a Google sign-in back (`no-account` or `failed`), `?code=` the
  // one-time code a successful one handed back, `?next=` where to land.
  const { query, navigate } = useRouter();
  const reason = query.get('e');
  const code = query.get('code');
  const next = query.get('next');
  const [handoffFailed, setHandoffFailed] = useState(false);
  const shown = handoffFailed ? 'failed' : reason;
  const googleError = shown === 'no-account' ? "There's no Epic account for that Google address."
    : shown === 'failed' ? "Sorry — we couldn't sign you in. Try again." : null;
  // An e-mail link that no longer works lands here too (App.tsx › Gate).
  const linkError = reason === 'link' ? 'That link does not work any more. Ask for a new one below.' : null;

  /**
   * Google is a full-page hand-off to the API, which runs the OIDC handshake and
   * sends the browser on to Google — an external navigation, like a payment
   * page, so it writes `window.location` rather than the router.
   */
  const startGoogle = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const to = safeNext(next) ? `?next=${encodeURIComponent(next as string)}` : '';
    window.location.assign(`${API_URL}/api/auth/google${to}`);
  };

  // The callback handed back a one-time code: swap it for a session and land
  // where it said (the back office for staff). Any failure falls back to this
  // screen with the one generic line, never saying which step went wrong.
  // The code is single-use, so it is posted once however often the effect runs
  // (StrictMode sets effects up twice in development), and the
  // answer is acted on while the screen is still mounted (Codex, 1 Oct 2026).
  const exchanged = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    // Once per screen: a second code arriving on the same mount is never spent.
    if (!code || exchanged.current !== null) return;
    exchanged.current = code;
    // The code leaves the address bar before it is posted, as the magic link's
    // does: a failed exchange must not leave a live credential to be copied,
    // bookmarked or retried by a refresh (Codex, 1 Oct 2026). `next` stays.
    const target = safeNext(next);
    navigate(target ? `${paths.login()}?next=${encodeURIComponent(target)}` : paths.login(), { replace: true });
    (async () => {
      try {
        const st = await api.googleExchange(code);
        if (!mounted.current) return;
        if (target) { navigate(target, { replace: true }); return; }
        // No `next`: land where the magic link would — the first back-office
        // screen this role can open (a Support member has the admin door but not
        // Reporting), or a customer's own account page (Codex, 1 Oct 2026).
        const screen = firstAdminScreen(st.access);
        navigate(st.access?.doors?.includes('admin')
          ? (screen === 'filing' ? paths.filing('categories') : paths.admin(screen))
          : paths.account(), { replace: true });
      } catch {
        if (mounted.current) setHandoffFailed(true);
      }
    })();
  }, [code, next, navigate]);

  // "Register your interest" leaves the app for the marketing homepage's form
  // (out of scope here, Epic Website.dc.html). A real document navigation to the
  // public site root, not an in-app route — `/inspire` is gated and an internal
  // navigate would land a signed-out visitor on the lock screen (Codex, 1 Oct
  // 2026). A deliberate exit from the SPA, which is the one time a screen leaves
  // the router behind.
  const registerInterest = () => {
    const root = Platform.OS === 'web' && typeof window !== 'undefined' ? `${window.location.origin}/` : 'https://epic.day/';
    void Linking.openURL(root);
  };
  // Which step of the door is open travels in the query (routes.ts): none is
  // L1, `?step=forgot` is L2, `?step=link` the e-mail link kept until the owner
  // lifts the hold. The "sent" states are what happened, not a place, so they
  // live here and a reload is back on the form.
  const { setQuery } = useRouter();
  const stepParam = query.get('step');
  const step: 'login' | 'forgot' | 'link' = stepParam === 'forgot' || stepParam === 'link' ? stepParam : 'login';
  const go = (to: 'login' | 'forgot' | 'link') => { setSent(false); setResent(false); setErr(''); setPwErr(''); setQuery({ step: to === 'login' ? null : to }); };
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [resent, setResent] = useState(false);
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);
  const [busy, setBusy] = useState(false);

  /** Where a session lands: `next` if it is safe, else by role — never by the e-mail's domain. */
  const land = (st: { access?: { doors?: string[]; capabilities?: string[] } | null }) => {
    const target = safeNext(next);
    if (target) { navigate(target, { replace: true }); return; }
    const screen = firstAdminScreen(st.access);
    navigate(st.access?.doors?.includes('admin')
      ? (screen === 'filing' ? paths.filing('categories') : paths.admin(screen))
      : paths.account(), { replace: true });
  };

  // Somebody already signed in is never asked again: /login sends them on to
  // where they were going, exactly as a fresh sign-in would (owner, 2 Oct 2026:
  // "never asked to sign in again while I'm signed in"). Not while a Google code
  // is being exchanged — that lands by itself.
  const session = useSession();
  useEffect(() => {
    if (!code && session.state === 'in' && session.access) land({ access: session.access });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, session.state, session.access]);

  // L1: email + password. Wrong together, never separately (the API's one line).
  const logIn = async () => {
    const value = email.trim();
    const badEmail = !EMAIL.test(value);
    setErr(badEmail ? "That email doesn't look right." : '');
    setPwErr(!badEmail && !password ? 'Enter your password.' : '');
    if (badEmail || !password) return;
    setBusy(true);
    try { land(await api.passwordLogin(value, password)); }
    catch (e) {
      setPwErr(e instanceof ApiError && e.status === 401 ? 'Wrong email or password.'
        : e instanceof ApiError && e.status === 429 ? (e.message || 'Too many tries. Wait a few minutes and try again.')
        : 'Could not reach Epic. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  // L2 and the e-mail link: both answer the same whether or not the address has an account.
  const send = async () => {
    const value = email.trim();
    if (!EMAIL.test(value)) return setErr("That email doesn't look right.");
    setErr(''); setBusy(true);
    try {
      if (step === 'forgot') await api.forgotPassword(value);
      else { rememberNext(safeNext(next)); await api.requestSignInLink(value); }
      setResent(false); setSent(true);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not send a link just now.'); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    try { if (step === 'forgot') await api.forgotPassword(email.trim()); else await api.requestSignInLink(email.trim()); } catch { /* answered the same either way */ }
    setResent(true);
  };

  const emailField = (onSubmit: () => void) => (
    <View style={{ gap: 10 }}>
      <Text style={styles.label}>Email</Text>
      <TextInput
        value={email}
        onChangeText={(v) => { setEmail(v); setErr(''); }}
        onSubmitEditing={onSubmit}
        placeholder="you@example.com"
        placeholderTextColor="#9B9797"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        accessibilityLabel="Email"
        {...(Platform.OS === 'web' ? ({ autoComplete: 'email' } as object) : {})}
        onFocus={() => setFocused('email')}
        onBlur={() => setFocused(null)}
        style={[styles.input, focused === 'email' && ({ boxShadow: `0 0 0 4px ${LIME}` } as object)]}
      />
      {err ? <Text style={styles.error}>{err}</Text> : null}
    </View>
  );

  return (
    <View style={[styles.root, wide && styles.rootWide]}>
      {/* Scrolls, so every control stays reachable on a short viewport or with
          the keyboard open — the shell itself does not scroll. */}
      <ScrollView style={styles.leftScroll} contentContainerStyle={[styles.left, wide && styles.leftWide, { paddingTop: insetTop(32), paddingBottom: insetBottom(48), paddingLeft: insetLeft(wide ? 64 : 24), paddingRight: insetRight(wide ? 64 : 24) }]} keyboardShouldPersistTaps="handled">
        <Wordmark height={30} ink={INK} ground={CREAM} />
        <View style={styles.leftBody}>
          {step === 'login' ? (
            <>
              <Text style={styles.h1} {...H1}>Log in.</Text>
              {linkError ? <Text style={styles.error} accessibilityLiveRegion="polite">{linkError}</Text> : null}
              {/* Google is a web hand-off to the API; the native apps have no
                  handoff yet, so the button is drawn only where it works. */}
              {Platform.OS === 'web' ? (<>
              <View style={{ gap: 12 }}>
                <Press onPress={startGoogle} accessibilityRole="button" accessibilityLabel="Log in with Google" style={({ hovered }: any) => [styles.google, hovered && styles.googleHover]}>
                  <GoogleG />
                  <Text style={styles.googleLabel}>Log in with Google</Text>
                </Press>
                {googleError ? <Text style={styles.error} accessibilityLiveRegion="polite">{googleError}</Text> : null}
              </View>
              <View style={styles.or}>
                <View style={styles.orRule} />
                <Text style={styles.orText}>or</Text>
                <View style={styles.orRule} />
              </View>
              </>) : null}
              {emailField(logIn)}
              <View style={{ gap: 10 }}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Password</Text>
                  <Press onPress={() => go('forgot')} effect="none" accessibilityRole="link">
                    <Text style={[styles.label, { textDecorationLine: 'underline' }]}>Forgot your password?</Text>
                  </Press>
                </View>
                <View style={[styles.pwBox, focused === 'password' && ({ boxShadow: `0 0 0 4px ${LIME}` } as object)]}>
                  <TextInput
                    value={password}
                    onChangeText={(v) => { setPassword(v); setPwErr(''); }}
                    onSubmitEditing={logIn}
                    secureTextEntry={!show}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Password"
                    {...(Platform.OS === 'web' ? ({ autoComplete: 'current-password' } as object) : {})}
                    onFocus={() => setFocused('password')}
                    onBlur={() => setFocused(null)}
                    style={[styles.pwInput, Platform.OS === 'web' && ({ outlineWidth: 0 } as object)]}
                  />
                  <Press onPress={() => setShow((v) => !v)} effect="none" accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} style={({ hovered }: any) => [styles.toggle, hovered && styles.googleHover]}>
                    <Text style={styles.toggleText}>{show ? 'Hide' : 'Show'}</Text>
                  </Press>
                </View>
                {pwErr ? <Text style={styles.error} accessibilityLiveRegion="polite">{pwErr}</Text> : null}
              </View>
              <Press onPress={logIn} disabled={busy} accessibilityRole="button" style={({ hovered }: any) => [styles.cta, hovered && styles.ctaHover]}>
                <Text style={styles.ctaLabel}>Log in</Text>
                <Icon name="forward" size={20} color={CREAM} strokeWidth={2.4} />
              </Press>
              <View style={styles.rule}>
                <Text style={styles.ruleText}>
                  No account yet?{' '}
                  <Text style={styles.link} onPress={registerInterest}>Register your interest</Text>
                </Text>
                {/* The e-mail link stays a way in until the owner has signed in
                    with Google and lifted the hold (owner, 1 Oct 2026). */}
                <Press onPress={() => go('link')} effect="none" accessibilityRole="link">
                  <Text style={[styles.ruleText, { marginTop: 12, textDecorationLine: 'underline' }]}>Email me a login link instead</Text>
                </Press>
              </View>
            </>
          ) : !sent ? (
            <>
              <Text style={styles.h1} {...H1}>{step === 'forgot' ? 'Forgot your password?' : 'Email me a link.'}</Text>
              <Text style={styles.sentBody}>{step === 'forgot'
                ? "Enter your email and we'll send you a link to set a new one."
                : "Enter your email and we'll send you a link that logs you in."}</Text>
              {emailField(send)}
              <Press onPress={send} disabled={busy} accessibilityRole="button" style={({ hovered }: any) => [styles.cta, hovered && styles.ctaHover]}>
                <Text style={styles.ctaLabel}>{step === 'forgot' ? 'Send me a reset link' : 'Send me a login link'}</Text>
                <Icon name="forward" size={20} color={CREAM} strokeWidth={2.4} />
              </Press>
              <View style={styles.rule}>
                <Press onPress={() => go('login')} effect="none" accessibilityRole="link"><Text style={styles.link}>Back to log in</Text></Press>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.h1} {...H1}>Check your email.</Text>
              <Text style={styles.sentBody}>
                If <Text style={{ fontWeight: '800' }}>{email}</Text> has an Epic account, {step === 'forgot'
                  ? 'a link to set a new password is on its way. It works once, for 30 minutes.'
                  : 'a login link is on its way. It works once, for 15 minutes.'}
              </Text>
              <View style={styles.rule}>
                <View style={styles.sentActions}>
                  <Press onPress={resend} effect="none" accessibilityRole="button"><Text style={styles.link}>{resent ? 'Sent again' : 'Send it again'}</Text></Press>
                  <Press onPress={() => go('login')} effect="none" accessibilityRole="link"><Text style={styles.link}>Back to log in</Text></Press>
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {wide ? (
        <View style={styles.right}>
          <View style={styles.grid}>
            {TILES.map((bg, i) => <View key={i} style={[styles.tile, { backgroundColor: bg }]} />)}
          </View>
          <View style={styles.band}>
            <Text style={styles.bandText}>Every place worth going.</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** The standard four-colour Google "G" (Google's branding rules for the button). */
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

// Placeholder tiles in the brand palette — the design's photo grid, which its
// own note calls placeholders. No external image is pulled in.
const TILES = [MOSS, INK, '#D7D3D3', LIME, INK, '#D7D3D3', LIME, MOSS, INK, '#D7D3D3', MOSS, LIME];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CREAM },
  rootWide: { flexDirection: 'row' },
  leftScroll: { flex: 1, backgroundColor: CREAM },
  left: { flexGrow: 1, backgroundColor: CREAM, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 48, gap: 24 },
  leftWide: { paddingHorizontal: 64 },
  leftBody: { flex: 1, justifyContent: 'center', gap: 28, maxWidth: 460, width: '100%' },
  h1: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 72, letterSpacing: -3.2, lineHeight: 68, color: INK },
  label: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: INK },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  // The password box (L1): the input's own box, with Show/Hide behind a 2px ink rule.
  pwBox: { flexDirection: 'row', height: 54, borderWidth: 2, borderColor: INK, backgroundColor: CREAM },
  pwInput: { flex: 1, minWidth: 0, paddingHorizontal: 18, fontFamily: fonts.body, fontSize: 18, color: INK },
  toggle: { paddingHorizontal: 16, justifyContent: 'center', borderLeftWidth: 2, borderLeftColor: INK },
  toggleText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: INK },
  input: { height: 54, borderWidth: 2, borderColor: INK, backgroundColor: CREAM, paddingHorizontal: 18, fontFamily: fonts.body, fontSize: 18, color: INK },
  error: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: MOSS },
  cta: { height: 58, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 4 },
  ctaHover: { backgroundColor: '#3A3735' },
  // The Google button (L1): 58px, 2px ink outline, the G then the label, flush left.
  google: { height: 58, borderWidth: 2, borderColor: INK, backgroundColor: CREAM, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18 },
  googleHover: { backgroundColor: LIME_TINT },
  googleLabel: { fontFamily: fonts.body, fontSize: 17, fontWeight: '700', color: INK },
  or: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  orRule: { flex: 1, height: 2, backgroundColor: INK },
  orText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: INK },
  ctaLabel: { fontFamily: fonts.body, fontSize: 17, fontWeight: '700', color: CREAM },
  rule: { borderTopWidth: 2, borderTopColor: INK, paddingTop: 16 },
  ruleText: { fontFamily: fonts.body, fontSize: 16, color: INK },
  // 16px set here, not inherited: L2's "Send it again" / "Use a different
  // email" sit outside any sized parent and fell to the 14px default.
  link: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: INK },
  sentBody: { fontFamily: fonts.body, fontSize: 19, lineHeight: 28, color: INK },
  sentActions: { flexDirection: 'row', gap: 28 },

  right: { flex: 1, backgroundColor: LIME, position: 'relative', overflow: 'hidden' },
  // Inset by the tile border so the cream gap lines stay between tiles and
  // never along the outer edges — the design's grid is full-bleed.
  grid: { position: 'absolute', top: -1.5, left: -1.5, right: -1.5, bottom: -1.5, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: CREAM },
  tile: { width: '33.3333%', height: '25%', borderWidth: 1.5, borderColor: CREAM },
  // −52 = half the band (30 + 44-line + 30), so it truly centres on the column.
  band: { position: 'absolute', left: 0, right: 0, top: '50%', transform: [{ translateY: -52 }], backgroundColor: LIME, paddingVertical: 30, paddingHorizontal: 40 },
  bandText: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 44, letterSpacing: -1.76, lineHeight: 44, color: INK },
});
