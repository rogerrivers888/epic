/**
 * Log in — epic.day/login (Supporting docs › EPIC staff management, L1/L2).
 *
 * One screen for customers and staff: enter an email, get a single-use link.
 * Where you land afterwards is decided by the account, not here — staff go to
 * the back office, customers to their own account page — because this screen
 * never learns whether the address even has an account. It answers the same
 * either way ("If … has an Epic account, a login link is on its way"), so it
 * cannot be used to find out who Epic's customers are.
 *
 * A fixed-light design, like the opening and the navigation band: cream ground,
 * ink type, the one lime field on the right. Its colours are the pack's brand
 * constants rather than palette tokens, because it does not follow the app's
 * light/dark setting.
 */

import React, { useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { api, ApiError } from '../api';
import { CREAM, INK, LIME, MOSS, fonts, HAIRLINE } from '../theme';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LoginScreen() {
  const { width } = useViewport();
  const wide = width >= 900;

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
  const [step, setStep] = useState<'email' | 'sent'>('email');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [resent, setResent] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const value = email.trim();
    if (!EMAIL.test(value)) return setErr("That email doesn't look right.");
    setErr(''); setBusy(true);
    try { await api.requestSignInLink(value); setResent(false); setStep('sent'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not send a link just now.'); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    try { await api.requestSignInLink(email.trim()); } catch { /* answered the same either way */ }
    setResent(true);
  };

  return (
    <View style={[styles.root, wide && styles.rootWide]}>
      <View style={[styles.left, wide && styles.leftWide]}>
        <Wordmark height={30} ink={INK} ground={CREAM} />
        <View style={styles.leftBody}>
          {step === 'email' ? (
            <>
              <Text style={styles.h1}>Log in.</Text>
              <View style={{ gap: 12 }}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={(v) => { setEmail(v); setErr(''); }}
                  onSubmitEditing={send}
                  placeholder="you@example.com"
                  placeholderTextColor="#9B9797"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  style={[styles.input, focused && ({ boxShadow: `0 0 0 4px ${LIME}` } as object)]}
                />
                {err ? <Text style={styles.error}>{err}</Text> : null}
                <Press onPress={send} disabled={busy} style={({ hovered }: any) => [styles.cta, hovered && styles.ctaHover]}>
                  <Text style={styles.ctaLabel}>Send me a login link</Text>
                  <Icon name="forward" size={20} color={CREAM} strokeWidth={2.4} />
                </Press>
              </View>
              <View style={styles.rule}>
                <Text style={styles.ruleText}>
                  No account yet?{' '}
                  <Text style={styles.link} onPress={registerInterest}>Register your interest</Text>
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.h1}>Check your email.</Text>
              <Text style={styles.sentBody}>
                If <Text style={{ fontWeight: '800' }}>{email}</Text> has an Epic account, a login link is on its way. It works once, for 15 minutes.
              </Text>
              <View style={styles.rule}>
                <View style={styles.sentActions}>
                  <Press onPress={resend} effect="none"><Text style={styles.link}>{resent ? 'Sent again' : 'Send it again'}</Text></Press>
                  <Press onPress={() => { setStep('email'); setResent(false); }} effect="none"><Text style={styles.link}>Use a different email</Text></Press>
                </View>
              </View>
            </>
          )}
        </View>
      </View>

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

// Placeholder tiles in the brand palette — the design's photo grid, which its
// own note calls placeholders. No external image is pulled in.
const TILES = [MOSS, INK, '#D7D3D3', LIME, INK, '#D7D3D3', LIME, MOSS, INK, '#D7D3D3', MOSS, LIME];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CREAM },
  rootWide: { flexDirection: 'row' },
  left: { flex: 1, backgroundColor: CREAM, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 48, gap: 24 },
  leftWide: { paddingHorizontal: 64 },
  leftBody: { flex: 1, justifyContent: 'center', gap: 28, maxWidth: 460, width: '100%' },
  h1: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 72, letterSpacing: -3.2, lineHeight: 68, color: INK },
  label: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: INK },
  input: { height: 58, borderWidth: 2, borderColor: INK, backgroundColor: CREAM, paddingHorizontal: 18, fontFamily: fonts.body, fontSize: 18, color: INK },
  error: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: MOSS },
  cta: { height: 58, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 4 },
  ctaHover: { backgroundColor: '#3A3735' },
  ctaLabel: { fontFamily: fonts.body, fontSize: 17, fontWeight: '700', color: CREAM },
  rule: { borderTopWidth: 2, borderTopColor: INK, paddingTop: 16 },
  ruleText: { fontFamily: fonts.body, fontSize: 16, color: INK },
  link: { fontFamily: fonts.body, fontWeight: '700', color: INK },
  sentBody: { fontFamily: fonts.body, fontSize: 19, lineHeight: 28, color: INK },
  sentActions: { flexDirection: 'row', gap: 28 },

  right: { flex: 1, backgroundColor: LIME, position: 'relative', overflow: 'hidden' },
  grid: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: CREAM },
  tile: { width: '33.3333%', height: '25%', borderWidth: 1.5, borderColor: CREAM },
  band: { position: 'absolute', left: 0, right: 0, top: '50%', transform: [{ translateY: -44 }], backgroundColor: LIME, paddingVertical: 30, paddingHorizontal: 40 },
  bandText: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 44, letterSpacing: -1.76, lineHeight: 44, color: INK },
});
