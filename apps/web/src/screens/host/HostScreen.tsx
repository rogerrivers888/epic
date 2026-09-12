/**
 * The Host tab (Host Journey canvas, 13 Sep 2026).
 *
 * Two states, both designed. Not yet a host: the learn layer — two kinds of
 * hosting, three ways to host, what people host, who can come — and nothing
 * to fill in. A host: the dashboard (S4) — who you are, live · booked · to
 * come, your offers as a menu, a full-width lime "Add another thing you do",
 * and what people have asked for that you do not offer yet.
 *
 * The set-up is a separate stack entered from a button (`/host/offers/new`);
 * the profile is its own page (`/host/profile`); the learn layer and the
 * dashboard keep the tab bar.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { api, HostHome, OfferShape, Visibility } from '../../api';
import { colors, fonts, spacing, type, BORDER } from '../../theme';
import { Button, Row, Wrap } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ScreenTop, TopControl } from '../../components/InspireHeader';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths, type Route } from '../../routes';
import { HostFace, OfferRow, RatingLine, SHAPE_ICON, SHAPE_LABEL, TrustBadge, TypeChip, VISIBILITY_CHIP, dateOnly, money } from '../../components/hosting';
import { LearnExample, LearnExamples, LearnHome, LearnShape, LearnWho } from './Learn';
import { OfferWizard } from './OfferWizard';
import { OfferDashboard } from './OfferDashboard';
import { VideoRecorder } from './VideoRecorder';
import { ProfileScreen } from './ProfileScreen';

const WIDE = 900;

export function HostScreen({ route }: { route: Extract<Route, { name: 'host' }> }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { navigate, query } = useRouter();
  const [home, setHome] = useState<HostHome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setHome(await api.hostHome()); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load, route.page]);

  // A new offer: the draft is made on the first tap, then it continues on its own address.
  const creating = useRef(false);
  useEffect(() => {
    if (route.page !== 'new' || creating.current) return;
    creating.current = true;
    const shape = (query.get('shape') as OfferShape | null) ?? 'oneoff';
    const vis = (query.get('vis') as Visibility | null) ?? undefined;
    api.createOffer(shape, vis).then((r) => navigate(paths.hostOfferEdit(r.offer.id, 'plan'), { replace: true })).catch((e) => { setError(e.message); creating.current = false; });
  }, [route.page]);
  // The old four-step onboarding address lands on the profile.
  useEffect(() => { if (route.page === 'start') navigate(paths.hostMe(), { replace: true }); }, [route.page]);

  if (route.page === 'shape' && route.param) return <LearnShape shape={route.param as OfferShape} wide={wide} />;
  if (route.page === 'examples') return <LearnExamples wide={wide} />;
  if (route.page === 'example' && route.param) return <LearnExample exampleKey={route.param} wide={wide} />;
  if (route.page === 'who') return <LearnWho wide={wide} />;
  if ((route.page === 'profile' || route.page === 'start') && home) return <ProfileScreen home={home} onChanged={load} />;
  if (route.page === 'edit' && route.offerId) return <OfferWizard offerId={route.offerId} home={home} onChanged={load} />;
  if (route.page === 'offer' && route.offerId) return <OfferDashboard offerId={route.offerId} hostName={home?.host?.name ?? ''} />;
  if (route.page === 'video') {
    const offerId = query.get('offer');
    return <VideoRecorder offerId={offerId} onDone={() => navigate(offerId ? paths.hostOfferEdit(offerId, 'extract') : paths.hostMe(), { replace: true })} />;
  }
  if (route.page === 'new' || route.page === 'profile') return <View style={styles.centre}><Text style={type.small}>{error ?? 'One moment…'}</Text></View>;

  if (!home) return <View style={styles.centre}><Text style={type.small}>{error ?? 'Loading…'}</Text></View>;
  if (!home.host || !home.offers.length) return <LearnHome wide={wide} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={wide ? styles.wide : undefined}>
        <ScreenTop><TopControl label="Add an offer" icon="add" onPress={() => navigate(paths.hostNewOffer())} /></ScreenTop>
      </View>
      <ScrollView contentContainerStyle={[styles.body, wide && styles.wide]}>
        <Dashboard home={home} />
      </ScrollView>
    </View>
  );
}

/** S4 · live, with room to grow. */
function Dashboard({ home }: { home: HostHome }) {
  const { navigate } = useRouter();
  const h = home.host!;
  const s = home.stats!;
  const order = { live: 0, in_review: 1, paused: 2, draft: 3, ended: 4 } as const;
  const offers = [...home.offers].sort((a, b) => order[a.state] - order[b.state]);
  const bookedOn = (id: string) => home.offers.find((o) => o.id === id)?.bookings.filter((b) => b.state !== 'cancelled').reduce((n, b) => n + b.heads, 0) ?? 0;
  const asks = home.asks ?? [];
  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={type.title}>Hosting</Text>
      <Press onPress={() => navigate(paths.hostMe())} accessibilityRole="button" style={styles.me}>
        <HostFace host={h} size={48} />
        <View style={{ flex: 1, gap: 3 }}>
          <Row style={{ flexWrap: 'wrap', gap: 6 }}><TypeChip type={h.type} localKind={h.localKind} small /><TrustBadge trust={h.trust} checks={h.checks} /></Row>
          <Text style={type.h3}>{h.name}{h.location ? ` · ${h.location}` : ''}</Text>
          <RatingLine host={h} />
        </View>
        <Icon name="more" size={16} color={colors.inkMuted} />
      </Press>

      <Row style={{ gap: spacing.sm }}>
        <Stat n={String(s.live)} label={s.live === 1 ? 'offer live' : 'offers live'} />
        <Stat n={String(s.booked)} label="booked" />
        <Stat n={money(s.toComePence)} label={home.config.payments.ready ? 'to come' : 'recorded'} />
      </Row>

      <View>
        <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: spacing.sm, borderBottomWidth: BORDER, borderBottomColor: colors.line }}>
          <Text style={type.h2}>Your offers</Text>
          {s.nextPayoutOn ? <Text style={type.small}>Next runs {dateOnly(s.nextPayoutOn)}</Text> : null}
        </Row>
        {offers.map((o) => (
          <View key={o.id}>
            <OfferRow item={o} own={{ booked: bookedOn(o.id), visibility: `${VISIBILITY_CHIP[o.visibility]}${o.visibility !== 'public' && o.invites.length ? ` · ${o.invites.filter((i) => i.rsvp === 'yes').length} of ${o.invites.length} said yes` : ''}` }} onPress={() => navigate(o.state === 'draft' ? paths.hostOfferEdit(o.id, 'plan') : paths.hostOffer(o.id))} />
          </View>
        ))}
      </View>

      <Button label="Add another thing you do" icon="add" onPress={() => navigate(paths.hostNewOffer())} />
      <Row style={{ justifyContent: 'center', gap: spacing.sm }}>
        {(['oneoff', 'series', 'anytime'] as OfferShape[]).map((sh) => (
          <Press key={sh} onPress={() => navigate(paths.hostNewOffer(sh))} accessibilityRole="button" style={styles.shapeQuick}>
            <Icon name={SHAPE_ICON[sh]} size={14} color={colors.ink} />
            <Text style={type.tiny}>{SHAPE_LABEL[sh]}</Text>
          </Press>
        ))}
      </Row>

      {asks.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.kicker}>PEOPLE HAVE ASKED {h.name.split(' ')[0].toUpperCase()} ABOUT</Text>
          <Wrap>{asks.map((a, i) => <View key={i} style={styles.ask}><Text style={styles.askText} numberOfLines={2}>{a}</Text></View>)}</Wrap>
          <Text style={type.small}>{asks.length} {asks.length === 1 ? 'person' : 'people'} asked for something when they booked. Each one is a second offer waiting to be written.</Text>
        </View>
      ) : null}

      {!h.introVideo || h.checks === 'running' ? (
        <Text style={type.small}>{h.checks === 'running' ? 'Your checks are running; the profile says so until they pass. ' : ''}{!h.introVideo ? 'No intro video yet — people book the person. Record one from your profile.' : ''}</Text>
      ) : null}
      <Text style={type.tiny}>Guests find you through Inspire and Places — there is nothing to browse here.</Text>
    </View>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statN}>{n}</Text><Text style={type.tiny}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  wide: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  body: { paddingHorizontal: 20, paddingTop: spacing.md, paddingBottom: 40 },
  me: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  stat: { flex: 1, padding: spacing.md, gap: 2, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  statN: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.ink },
  shapeQuick: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderWidth: 1, borderColor: colors.ruleSoft },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: colors.inkMuted },
  ask: { paddingHorizontal: 10, height: 32, justifyContent: 'center', backgroundColor: colors.warm, maxWidth: '100%' },
  askText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
});
