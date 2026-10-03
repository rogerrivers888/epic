/**
 * Your account — where a magic link lands a household customer (L3).
 *
 * Staff land in the back office; a customer lands here, their own small hub: who
 * they are, who is in their household, what they are on, and one big way into the
 * app. A fixed-light brand design (cream, ink, the one lime band), drawn from the
 * pack's constants rather than palette tokens, like the login screen it follows.
 */

import { insetBottom, insetLeft, insetRight, insetTop } from '../insets';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Image } from 'react-native';
import { Press } from '../components/press';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { useRouter } from '../router';
import { paths } from '../routes';
import { api, type AccountSummary, type Member } from '../api';
import { CREAM, INK, LIME, MOSS, fonts, HAIRLINE, INK_MUTED } from '../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fullDate = (iso?: string | null) => {
  if (!iso) return '—';
  // trial_ends_on is a calendar date ("2026-10-01"), not an instant. new Date()
  // would read it as UTC midnight and the local getters would then show the day
  // before west of UTC, so the components are read straight off the string
  // (Codex, 1 Oct 2026).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const firstName = (name?: string | null) => String(name || '').trim().split(/\s+/)[0] || 'there';
const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function AccountScreen() {
  const { width } = useViewport();
  const { navigate } = useRouter();
  const wide = width >= 900;
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [crew, setCrew] = useState<Member[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const st = await api.sessionState();
        if (st.account) setAccount(st.account);
      } catch { /* the gate handles a lost session */ }
      try {
        const h = await api.household();
        setCrew(h.members ?? []);
      } catch { /* a household with nothing in it yet */ }
    })();
  }, []);

  const logOut = useCallback(async (everywhere = false) => {
    try { await api.signOut({ everywhere }); } catch { /* signed out regardless */ }
    navigate(paths.login());
  }, [navigate]);

  const planLabel = account?.plan === 'trial' ? 'Free trial' : titleCase(account?.plan || '');
  const sidePad = wide ? 64 : 24;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ flexGrow: 1, paddingBottom: insetBottom(0) }}>
      {/* top bar */}
      <View style={[styles.topBar, { paddingLeft: insetLeft(sidePad), paddingRight: insetRight(sidePad), paddingTop: insetTop(28) }]}>
        <Wordmark height={30} ink={INK} ground={CREAM} />
        <View style={styles.topRight}>
          <Text style={styles.email}>{account?.email || ''}</Text>
          <Press onPress={() => logOut(false)} effect="none"><Text style={styles.logout}>Log out</Text></Press>
        </View>
      </View>

      {/* lime band */}
      <View style={[styles.band, { paddingLeft: insetLeft(sidePad), paddingRight: insetRight(sidePad) }, !wide && { flexDirection: 'column', alignItems: 'flex-start', gap: 20 }]}>
        <Text style={styles.hi}>Hi, {firstName(account?.name)}.</Text>
        <Press onPress={() => navigate(paths.inspire())} style={({ hovered }: any) => [styles.openBtn, !wide && { width: '100%' }, hovered && styles.openBtnHover]}>
          <Text style={styles.openLabel}>Open Epic</Text>
          <Icon name="forward" size={20} color={CREAM} strokeWidth={2.4} />
        </Press>
      </View>

      {/* three columns */}
      <View style={[styles.columns, { paddingLeft: insetLeft(sidePad), paddingRight: insetRight(sidePad) }, !wide && { flexDirection: 'column' }]}>
        <Column wide={wide} first title="Your details">
          <Detail label="Name" value={account?.name || '—'} />
          <Detail label="Email" value={account?.email || '—'} />
          <Press onPress={() => navigate(paths.settings('preferences'))} effect="none"><Text style={styles.action}>Edit</Text></Press>
        </Column>

        <Column wide={wide} title="Your crew">
          {crew.length ? crew.map((m) => (
            <View key={m.id} style={styles.crewRow}>
              {m.avatarUrl ? (
                <Image source={{ uri: m.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarBlank]} />
              )}
              <Text style={styles.crewName}>{m.name}{m.isMinor && m.age != null ? `, ${m.age}` : ''}</Text>
            </View>
          )) : <Text style={styles.detailValue}>Just you, so far.</Text>}
        </Column>

        <Column wide={wide} last title="Membership">
          <Detail label="Your membership" value={planLabel || 'Free trial'} />
          <Detail label="Ends" value={fullDate(account?.trialEndsOn)} />
          <Press onPress={() => logOut(true)} effect="none"><Text style={styles.action}>Log out on every device</Text></Press>
        </Column>
      </View>
    </ScrollView>
  );
}

function Column({ title, children, wide, first, last }: { title: string; children: React.ReactNode; wide: boolean; first?: boolean; last?: boolean }) {
  return (
    <View style={[
      styles.column,
      wide && { flex: 1, borderRightWidth: last ? 0 : 2, borderRightColor: INK, paddingLeft: first ? 0 : 32, paddingRight: last ? 0 : 32 },
    ]}>
      <Text style={styles.colHead}>{title}</Text>
      {children}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CREAM },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 28, borderBottomWidth: 2, borderBottomColor: INK },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 28 },
  email: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: INK },
  logout: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: INK },

  band: { backgroundColor: LIME, paddingTop: 40, paddingBottom: 34, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  hi: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 72, letterSpacing: -3.2, lineHeight: 68, color: INK },
  openBtn: { height: 56, width: 300, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  openBtnHover: { backgroundColor: '#3A3735' },
  openLabel: { fontFamily: fonts.body, fontSize: 17, fontWeight: '700', color: CREAM },

  columns: { flexDirection: 'row', paddingVertical: 0 },
  column: { paddingVertical: 28, gap: 4 },
  colHead: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: INK, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: INK, marginBottom: 6 },

  detail: { gap: 2, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  detailLabel: { fontFamily: fonts.body, fontSize: 13, color: INK_MUTED },
  detailValue: { fontFamily: fonts.body, fontSize: 17, fontWeight: '700', color: INK },
  action: { fontFamily: fonts.body, fontSize: 15, fontWeight: '700', color: INK, paddingTop: 12 },

  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarBlank: { backgroundColor: '#D7D3D3' },
  crewName: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: INK },
});
