/**
 * A host's public profile (Events v4 canvas A1 · A2 · A3 · B1; Hosts and
 * Events P1 · P2), and the trust ladder over it (B2).
 *
 * Person first, then a menu. The intro video is the hero, full bleed, with
 * the type and trust chips over it; then the name, one line of where they are
 * and their rating, the short intro, their credentials as chips, and the
 * offers — each row with its own play badge, because each has its own video.
 * A paused offer keeps its place and greys; a Local · Family host carries the
 * safety line and the children's ages, always visible.
 *
 * Public: answered without a session and drawn outside the shell.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/press';
import { api, HostProfile } from '../api';
import { colors, fonts, spacing, type, BORDER, INK, LIME, LIME_TINT, MOSS } from '../theme';
import { Button, Row, Wrap } from '../components/ui';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { useRouter } from '../router';
import { paths, type Route } from '../routes';
import { HostFace, Kicker, LOCAL_LABEL, NewOnEpic, OfferRow, RatingLine, TRUST_LABEL, TrustBadge, TypeChip, VideoHero, dateOnly } from '../components/hosting';
import { ReportBox } from './ExperienceScreen';

const WIDE = 900;

export function HostProfileScreen({ route }: { route: Extract<Route, { name: 'hostProfile' }> }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { navigate, back } = useRouter();
  const [data, setData] = useState<HostProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.hostProfile(route.hostId)); setError(null); } catch (e: any) { setError(e.message); }
  }, [route.hostId]);
  useEffect(() => { void load(); }, [load]);

  if (error && !data) {
    return (
      <View style={styles.page}>
        <Wordmark height={30} />
        <Text style={type.h2}>Nothing at that address</Text>
        <Text style={type.small}>{error}</Text>
        <Button label="Take me home" kind="secondary" onPress={() => navigate(paths.inspire(), { replace: true })} />
      </View>
    );
  }
  if (!data) return <View style={styles.page}><Wordmark height={30} /><Text style={type.small}>Opening…</Text></View>;

  const { host, offers, reviews } = data;
  const first = host.name.split(' ')[0];

  if (route.layer === 'trust') return <TrustLadder host={host} wide={wide} onBack={() => back(paths.hostProfile(host.id))} />;

  const sub = [host.type === 'expert' ? host.credentials[0] : host.type === 'meetups' && host.localKind ? LOCAL_LABEL[host.localKind] : host.credentials[0] ?? null, host.location].filter(Boolean).join(' · ');
  const running = host.checks === 'running';

  return (
    <ScrollView contentContainerStyle={[styles.scroll, wide && styles.scrollWide]}>
      <VideoHero
        src={host.introVideo} poster={host.photo} height={wide ? 380 : 300}
        label={host.introVideo ? `${first} says hello` : null}
        badgeInset={44}
        badge={<>
          <TypeChip type={host.type} localKind={host.localKind} />
          {host.isNew ? <NewOnEpic /> : null}
          {running ? <TrustBadge trust={host.trust} checks="running" /> : <TrustBadge trust={host.trust} onPress={() => navigate(paths.hostTrust(host.id))} />}
        </>}
      />
      <View style={styles.overBar}>
        <Press onPress={() => back(paths.inspire())} accessibilityRole="button" accessibilityLabel="Back" style={styles.overBtn}><Icon name="back" size={18} color={colors.ink} /></Press>
        <Press onPress={() => void share(host.name)} accessibilityRole="button" accessibilityLabel="Share" style={styles.overBtn}><Icon name="share" size={16} color={colors.ink} /></Press>
      </View>

      <View style={styles.gutter}>
        <Row style={{ alignItems: 'flex-start', gap: spacing.md }}>
          {!host.introVideo ? <HostFace host={host} size={56} /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.title}>{host.name}</Text>
            {sub ? <Text style={type.small}>{sub}</Text> : null}
            <RatingLine host={host} guests />
          </View>
        </Row>

        {host.introText ? <Text style={[type.body, { marginTop: spacing.md }]}>{host.introText}</Text> : null}

        {/* Credentials differ per offer; these are the person's own. */}
        {host.credentials.length || host.languages.length || host.childrenAges.length ? (
          <Wrap style={{ marginTop: spacing.md }}>
            {host.childrenAges.length ? <Tag>Kids {host.childrenAges.join(' and ')}</Tag> : null}
            {host.credentials.map((c) => <Tag key={c}>{c}</Tag>)}
            {host.languages.length ? <Tag>{host.languages.join(' · ')}</Tag> : null}
            {host.type === 'meetups' && host.localKind === 'family' ? <><Tag>Daytime only</Tag><Tag>Public places</Tag></> : null}
          </Wrap>
        ) : null}

        {/* Local · Family carries its own safety line, always visible. */}
        {host.type === 'meetups' && host.localKind === 'family' ? (
          <View style={styles.safety}>
            <Icon name="family" size={16} color={colors.ink} />
            <Text style={[type.small, { flex: 1, color: colors.ink }]}>Family hosting is daytime, in public, with both families together. Never one adult and someone else's child.</Text>
          </View>
        ) : null}
        {host.type === 'meetups' && host.localKind === 'night_out' ? (
          <View style={styles.safety}>
            <Icon name="info" size={16} color={colors.ink} />
            <Text style={[type.small, { flex: 1, color: colors.ink }]}>A night out is over-18s, named public venues, a minimum party, a visible end time and a way to reach us.</Text>
          </View>
        ) : null}

        {/* A new host reads as new, not as untrusted: money is held by Epic either way. */}
        {running ? (
          <View style={styles.checks}>
            <Text style={type.small}>We are checking {first}'s ID{host.credentials.length ? ` and ${host.type === 'expert' ? 'their licence' : 'their qualification'}` : ''}. Until that finishes there is no verified badge — your money is still held by Epic and returned if it does not run.</Text>
          </View>
        ) : host.trust !== 'verified' ? (
          <Press onPress={() => navigate(paths.hostTrust(host.id))} accessibilityRole="button" style={styles.checks}>
            <Text style={type.small}>{host.trust === 'trusted' ? 'Licence and insurance seen. ' : 'Documents seen. '}Tap to see what {TRUST_LABEL[host.trust]} covers ›</Text>
          </Press>
        ) : null}

        {/* The menu. */}
        <View style={styles.menuHead}>
          <Text style={type.h2}>{offers.length === 1 ? `What ${first} hosts` : `${offers.length ? `${count(offers.length)} things` : 'Nothing yet'} ${first} does`}</Text>
          {offers.length > 1 ? <Text style={type.small}>Each with its own video</Text> : null}
        </View>
        {offers.map((o) => <OfferRow key={o.id} item={o} onPress={() => navigate(paths.experience(o.id))} />)}
        {!offers.length ? <Text style={type.small}>{first} has nothing live just now.</Text> : null}

        {reviews.length ? (
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <Kicker>WHAT PEOPLE SAID</Kicker>
            {reviews.slice(0, 6).map((r, i) => (
              <View key={i} style={styles.review}>
                <Row style={{ gap: 2 }}>
                  {[1, 2, 3, 4, 5].map((n) => <Icon key={n} name="favourite" size={12} color={colors.ink} fill={n <= r.stars} />)}
                  <Text style={[type.tiny, { marginLeft: 6 }]}>{r.title ?? ''} · {dateOnly(r.on)}</Text>
                </Row>
                {r.chips.length ? <Text style={type.tiny}>{r.chips.map((c) => c[0].toUpperCase() + c.slice(1)).join(' · ')}</Text> : null}
                {r.text ? <Text style={type.body}>{r.text}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}

        {offers.length ? (
          <View style={{ marginTop: spacing.xl, gap: 6 }}>
            <Button label={offers.length === 1 ? `See ${offers[0].title ?? 'it'}` : `See what ${first} offers`} icon="forward" onPress={() => navigate(paths.experience(offers[0].id))} />
            <Text style={[type.tiny, { textAlign: 'center' }]}>{host.type === 'expert' ? 'Professional rate · licence on file' : host.type === 'meetups' && offers.every((o) => o.priceMode === 'free') ? `Free · ${host.localKind === 'family' ? 'they are' : `${first} is`} not doing this for money` : 'Free to cancel up to 24 hours before'}</Text>
          </View>
        ) : null}

        {reporting ? <ReportBox hostId={host.id} onDone={() => setReporting(false)} /> : (
          <Text style={[type.tiny, { marginTop: spacing.lg }]}>
            <Text style={{ color: colors.accent, fontWeight: '700' }} onPress={() => setReporting(true)}>Report this profile</Text> · cancellation and refund terms are shown before you pay
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const count = (n: number) => ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][n] ?? String(n);

async function share(name: string) {
  const nav: any = (globalThis as any).navigator;
  const url = typeof window !== 'undefined' ? window.location.href : '';
  try {
    if (nav?.share) await nav.share({ title: `${name} on Epic`, url });
    else if (nav?.clipboard) await nav.clipboard.writeText(url);
  } catch { /* closed */ }
}

function Tag({ children }: { children: React.ReactNode }) {
  return <View style={styles.tag}><Text style={styles.tagText}>{children}</Text></View>;
}

/**
 * The trust ladder as a guest sees it (B2). Three levels, what each means,
 * which one this host holds, and the one sentence about New on Epic.
 */
export function TrustLadder({ host, wide, onBack }: { host: HostProfile['host']; wide: boolean; onBack: () => void }) {
  const rungs = [
    { key: 'verified', title: 'Verified', body: 'Identity and contact confirmed against photo ID and the face in their video.', foot: 'Every host on Epic', bg: colors.warm, fg: colors.inkMuted, icon: 'verified' as const },
    { key: 'checked', title: 'Checked', body: 'Documents seen: qualifications, public liability insurance, a licence where the city or the activity needs one, plus references.', foot: 'Required at their place, with children, or above £100', bg: LIME_TINT, fg: MOSS, icon: 'checked' as const },
    { key: 'trusted', title: 'Epic Trusted', body: 'Everything in Checked, plus a sustained record — completed experiences, ratings and no unresolved reports.', foot: 'Earned over time. It carries our name.', bg: INK, fg: LIME, icon: 'trusted' as const },
  ];
  return (
    <ScrollView contentContainerStyle={[styles.scroll, styles.gutter, wide && styles.scrollWide, { paddingTop: spacing.lg }]}>
      <Press onPress={onBack} accessibilityRole="button"><Row><Icon name="back" size={18} /><Text style={type.h3}>Back to {host.name.split(' ')[0]}</Text></Row></Press>
      <Kicker style={{ marginTop: spacing.lg }}>HOW EPIC CHECKS HOSTS</Kicker>
      <Text style={type.title}>Three levels, and what each one means</Text>
      <Text style={[type.small, { marginTop: 4 }]}>Every host clears the first. The other two are earned, and we say which one you are looking at on every card and profile.</Text>
      {rungs.map((r) => {
        const mine = host.trust === r.key && host.checks !== 'running';
        return (
          <View key={r.key} style={[styles.rung, mine && styles.rungOn]}>
            <View style={[styles.rungIcon, { backgroundColor: r.bg }]}><Icon name={r.icon} size={18} color={r.fg} strokeWidth={2.2} /></View>
            <View style={{ flex: 1, gap: 4 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={type.h2}>{r.title}</Text>
                {mine ? <View style={styles.thisHost}><Text style={styles.thisHostText}>THIS HOST</Text></View> : null}
              </Row>
              <Text style={type.small}>{r.body}</Text>
              <Text style={[type.tiny, { color: colors.accent, fontWeight: '600' }]}>{r.foot}</Text>
            </View>
          </View>
        );
      })}
      <View style={styles.newNote}>
        <Text style={type.small}><Text style={{ fontWeight: '700', color: colors.ink }}>New on Epic</Text> is not a fourth level. It means Verified with no reviews yet — your money is held by us either way, and returned if it does not run.</Text>
      </View>
      <Text style={[type.tiny, { marginTop: spacing.md }]}>Report a host from any profile or listing. Cancellation and refund terms are shown before you pay.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  scroll: { paddingBottom: 60, backgroundColor: colors.bg },
  scrollWide: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  gutter: { paddingHorizontal: 20, paddingTop: spacing.lg },
  overBar: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  overBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  tag: { backgroundColor: colors.warm, paddingHorizontal: 10, height: 28, justifyContent: 'center' },
  tagText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.ink },
  safety: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.surfaceMuted, padding: spacing.md, marginTop: spacing.md },
  checks: { backgroundColor: colors.warm, padding: spacing.md, marginTop: spacing.md },
  menuHead: { marginTop: spacing.xl, paddingBottom: spacing.sm, borderBottomWidth: BORDER, borderBottomColor: colors.line, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 },
  review: { gap: 4, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  rung: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', padding: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: colors.ruleSoft },
  rungOn: { borderWidth: BORDER, borderColor: colors.ink },
  rungIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  thisHost: { backgroundColor: colors.selected, paddingHorizontal: 6, height: 20, justifyContent: 'center' },
  thisHostText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.selectedFg },
  newNote: { marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.surfaceMuted },
});
